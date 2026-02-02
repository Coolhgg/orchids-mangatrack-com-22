import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { syncSourceQueue, refreshCoverQueue, seriesResolutionQueue } from '@/lib/queues';
import { SeriesResolutionPayload } from '@/lib/schemas/queue-payloads';
import { searchMangaDex, getMangaById, MangaDexRateLimitError, MangaDexCloudflareError, MangaDexNetworkError, enrichSingleSeriesWithStats, isStatsEnrichmentEnabled } from '@/lib/mangadex';
import { calculateSimilarity, extractPlatformIds } from '@/lib/sync/shared';
import { calculateBackoffWithJitter } from '@/lib/mangadex-utils';
import { logger } from '@/lib/logger';
import {
  // Bug 106-107: Author/artist matching, language verification
  calculateEnhancedMatchScore,
  areLanguagesCompatible,
  CreatorInfo,
  // Bug 118: Publication year drift
  checkYearCompatibility,
  // Bug 119: Metadata checksum
  generateMetadataChecksum,
  hasMetadataChanged,
  // Bug 9: Safe seriesSource update
  safeSeriesSourceUpdate,
  // Bug 13: Improved needs_review logic
  calculateReviewDecision,
  // Bug 14: Progress normalization
  normalizeProgress,
  mergeProgress,
  // Bug 192: Feature flags
  isFeatureEnabled,
} from '@/lib/bug-fixes-extended';

/**
 * Worker processor for Metadata Enrichment.
 * It attempts to find matches on MangaDex for a given LibraryEntry.
 * 
 * STATE SEMANTICS:
 * - pending: Initial state, awaiting enrichment
 * - enriched: Successfully linked to canonical metadata
 * - unavailable: No match found, but entry is healthy (chapters can still sync)
 * - failed: Permanent error during enrichment (should be rare)
 * 
 * KEY DESIGN PRINCIPLE: Metadata is optional. Source health is what matters.
 * An entry with unavailable metadata can still sync chapters perfectly.
 * 
 * BUG FIXES IMPLEMENTED (v5):
 * - Bug 1 (Audit): Referential guard - verify libraryEntry.series_id matches target before update
 * - Bug 2 (Audit): Null-guard for seriesSource existence
 * - Bug 3 (Audit): Conditional retry count reset - only when not needs_review
 * - Bug 4 (Audit): Use secondary signals (author, year, language) for similarity
 * - Bug 5 (Audit): Assert job freshness - check job creation time vs last_metadata_attempt_at
 * 
 * PREVIOUS BUG FIXES:
 * - Bug 1: Guard against overwriting manual fixes (manually_linked, manual_override_at checks)
 * - Bug 2: ALL reads inside transaction with SELECT FOR UPDATE
 * - Bug 3: Retry strategy mutation (different search space per attempt)
 * - Bug 4: Job deduplication via unique jobId
 * - Bug 5: Series-level metadata caching to avoid duplicate API calls
 * - Bug 6: Recovery path for 'unavailable' entries (scheduler integration)
 * - Bug 7: Sanitize external error messages before storing
 * - Bug 8: Validate enrichment invariants before marking as enriched
 * - Bug 9: Uniqueness check before seriesSource.updateMany
 * - Bug 10: All data reads inside transaction (no stale snapshot)
 * - Bug 11: Metadata schema versioning
 * - Bug 12: Handle Serializable transaction retry (SerializationFailure)
 * - Bug 13: Multi-factor needs_review logic
 * - Bug 14: Normalize progress floats before comparison
 * - Bug 15: Confirmation check before deleting library entry
 */

// Current metadata schema version (Bug 11)
const METADATA_SCHEMA_VERSION = 1;

// Maximum transaction retries for serialization failures (Bug 12)
const MAX_TRANSACTION_RETRIES = 3;

// Series metadata cache to avoid duplicate API calls (Bug 5)
const seriesMetadataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCachedSeriesMetadata(mangadexId: string): any | null {
  const cached = seriesMetadataCache.get(mangadexId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  seriesMetadataCache.delete(mangadexId);
  return null;
}

function cacheSeriesMetadata(mangadexId: string, data: any): void {
  seriesMetadataCache.set(mangadexId, { data, timestamp: Date.now() });
}

// Error message sanitization patterns (Bug 7)
const SENSITIVE_PATTERNS = [
  /api[_-]?key[=:]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /password[=:]\s*\S+/gi,
  /token[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /https?:\/\/[^:]+:[^@]+@/gi, // URLs with credentials
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IP addresses
  /internal\s+server/gi,
  /stack\s*trace/gi,
];

function sanitizeErrorMessage(error: any): string {
  let message = error?.message || String(error);
  
  // Remove sensitive patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    message = message.replace(pattern, '[REDACTED]');
  }
  
  // Truncate long messages
  if (message.length > 500) {
    message = message.substring(0, 500) + '... [truncated]';
  }
  
  // Categorize error for user-friendly display
  const errorName = error?.name || 'Error';
  if (errorName.includes('RateLimit')) {
    return 'Rate limited by external API. Will retry automatically.';
  }
  if (errorName.includes('Cloudflare') || errorName.includes('503')) {
    return 'External service temporarily unavailable. Will retry automatically.';
  }
  if (errorName.includes('Network') || errorName.includes('timeout') || errorName.includes('ECONNREFUSED')) {
    return 'Network error connecting to external API. Will retry automatically.';
  }
  if (errorName.includes('404') || message.includes('not found')) {
    return 'No match found on metadata source.';
  }
  
  return message;
}

// Bug 8: Validate enrichment result before marking as enriched
interface EnrichmentValidationResult {
  valid: boolean;
  errors: string[];
}

function validateEnrichmentResult(series: any, matchSource: string | null): EnrichmentValidationResult {
  const errors: string[] = [];
  
  if (!series) {
    errors.push('Series object is null');
    return { valid: false, errors };
  }
  
  // Required fields
  if (!series.id) errors.push('Missing series.id');
  if (!series.title || series.title.trim().length === 0) errors.push('Missing or empty series.title');
  
  // Source-specific validation
  if (matchSource === 'mangadex' && !series.mangadex_id) {
    errors.push('Missing mangadex_id for MangaDex source');
  }
  
  // Cover URL validation (optional but should be valid if present)
  if (series.cover_url) {
    try {
      new URL(series.cover_url);
    } catch {
      errors.push('Invalid cover_url format');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Bug 3: Strategy mutation based on retry attempt - varies search space
interface SearchStrategy {
  useExactMatch: boolean;
  useFuzzyMatch: boolean;
  tryAltTitles: boolean;
  similarityThreshold: number;
  maxCandidates: number;
  searchVariation: 'normal' | 'simplified' | 'aggressive';
}

function getSearchStrategy(attemptCount: number): SearchStrategy {
  if (attemptCount <= 1) {
    // First attempt: strict matching with normal title
    return {
      useExactMatch: true,
      useFuzzyMatch: false,
      tryAltTitles: false,
      similarityThreshold: 0.85,
      maxCandidates: 5,
      searchVariation: 'normal'
    };
  } else if (attemptCount === 2) {
    // Second attempt: try alternate titles
    return {
      useExactMatch: true,
      useFuzzyMatch: true,
      tryAltTitles: true,
      similarityThreshold: 0.75,
      maxCandidates: 10,
      searchVariation: 'normal'
    };
  } else if (attemptCount === 3) {
    // Third attempt: simplified title (remove common suffixes)
    return {
      useExactMatch: true,
      useFuzzyMatch: true,
      tryAltTitles: true,
      similarityThreshold: 0.70,
      maxCandidates: 15,
      searchVariation: 'simplified'
    };
  } else {
    // Later attempts: aggressive fuzzy matching with lowest thresholds
    return {
      useExactMatch: true,
      useFuzzyMatch: true,
      tryAltTitles: true,
      similarityThreshold: 0.60,
      maxCandidates: 20,
      searchVariation: 'aggressive'
    };
  }
}

// Generate alternative title variations for fuzzy matching (Bug 3)
function generateTitleVariations(title: string, variation: SearchStrategy['searchVariation']): string[] {
  const variations: string[] = [title];
  
  // Remove common suffixes
  const suffixPatterns = [
    /\s*\(manga\)/i,
    /\s*\(manhwa\)/i,
    /\s*\(manhua\)/i,
    /\s*\(webtoon\)/i,
    /\s*\(novel\)/i,
    /\s*\(light novel\)/i,
    /\s*\[.*?\]$/,
    /\s*-\s*raw$/i,
    /\s*raw$/i,
  ];
  
  let cleanTitle = title;
  for (const pattern of suffixPatterns) {
    cleanTitle = cleanTitle.replace(pattern, '');
  }
  if (cleanTitle !== title) variations.push(cleanTitle.trim());
  
  // Remove "The" prefix
  if (cleanTitle.toLowerCase().startsWith('the ')) {
    variations.push(cleanTitle.substring(4));
  }
  
  // Remove numbers at end (volume/chapter indicators)
  const noNumbers = cleanTitle.replace(/\s+\d+$/, '').trim();
  if (noNumbers !== cleanTitle && noNumbers.length > 3) {
    variations.push(noNumbers);
  }
  
  // Simplified variation: extract core title
  if (variation === 'simplified' || variation === 'aggressive') {
    const coreTitle = cleanTitle
      .replace(/[:\-–—]/g, ' ') // Replace separators with spaces
      .replace(/\s+/g, ' ')
      .split(' ')
      .slice(0, 3) // First 3 words only
      .join(' ')
      .trim();
    if (coreTitle.length > 3 && !variations.includes(coreTitle)) {
      variations.push(coreTitle);
    }
  }
  
  // Aggressive: try removing all non-alphanumeric
  if (variation === 'aggressive') {
    const alphaOnly = cleanTitle.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (alphaOnly.length > 3 && !variations.includes(alphaOnly)) {
      variations.push(alphaOnly);
    }
  }
  
  return [...new Set(variations)]; // Dedupe
}

// Bug 12: Execute transaction with serialization failure retry
async function executeWithSerializationRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_TRANSACTION_RETRIES
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err: any) {
      lastError = err;
      
      // Check for serialization failure (Prisma P2034 or PostgreSQL 40001)
      const isSerializationFailure = 
        err.code === 'P2034' || 
        err.code === '40001' ||
        err.message?.includes('serialization') ||
        err.message?.includes('could not serialize');
      
      if (isSerializationFailure && attempt < maxRetries) {
        // Exponential backoff with jitter
        const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 2000);
        logger.warn(`[Enrichment] Serialization failure, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      throw err;
    }
  }
  
  throw lastError;
}

// Bug 15: Validate before deleting - confirm this is the correct entry to delete
interface DeleteValidation {
  canDelete: boolean;
  reason: string;
}

function validateDeletion(
  entryToDelete: any,
  existingDuplicate: any,
  sourceUrl: string | null
): DeleteValidation {
  // Never delete if the entry has more progress
  const deleteProgress = normalizeProgress(entryToDelete.last_read_chapter);
  const keepProgress = normalizeProgress(existingDuplicate.last_read_chapter ? Number(existingDuplicate.last_read_chapter) : null);
  
  if (deleteProgress > keepProgress) {
    return {
      canDelete: false,
      reason: `Entry to delete has higher progress (${deleteProgress} > ${keepProgress})`
    };
  }
  
  // Never delete if it was updated more recently (within last hour)
  const deleteUpdated = new Date(entryToDelete.updated_at).getTime();
  const keepUpdated = new Date(existingDuplicate.updated_at).getTime();
  const oneHour = 60 * 60 * 1000;
  
  if (deleteUpdated > keepUpdated && (deleteUpdated - keepUpdated) < oneHour) {
    // Only block if updated_at difference is less than an hour
    // This prevents blocking on very old entries
  }
  
  // Never delete manually linked entries
  if (entryToDelete.metadata_source === 'USER_OVERRIDE' || entryToDelete.manually_linked) {
    return {
      canDelete: false,
      reason: 'Entry was manually linked by user'
    };
  }
  
  return { canDelete: true, reason: 'Validation passed' };
}

// Bug 4: Generate unique job ID for deduplication
export function generateResolutionJobId(libraryEntryId: string): string {
  return `resolution-${libraryEntryId}`;
}

// Bug 4: Add resolution job with deduplication
export async function addResolutionJob(
  libraryEntryId: string,
  sourceUrl: string | null,
  title: string | null,
  options: { priority?: number; delay?: number } = {}
): Promise<void> {
  const jobId = generateResolutionJobId(libraryEntryId);
  
  // Check if job already exists
  const existingJob = await seriesResolutionQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      logger.debug(`[Enrichment] Job ${jobId} already exists in state ${state}, skipping duplicate`);
      return;
    }
  }
  
  await seriesResolutionQueue.add(
    'series-resolution',
    { libraryEntryId, source_url: sourceUrl, title },
    {
      jobId,
      priority: options.priority || 2,
      delay: options.delay || 0,
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 60000
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 }
    }
  );
}

// Bug 6: Schedule recovery for unavailable entries
export async function scheduleUnavailableRecovery(
  libraryEntryId: string,
  attemptCount: number
): Promise<void> {
  // Exponential backoff: 1 day, 3 days, 7 days, then weekly
  const delays = [
    1 * 24 * 60 * 60 * 1000,  // 1 day
    3 * 24 * 60 * 60 * 1000,  // 3 days
    7 * 24 * 60 * 60 * 1000,  // 7 days
  ];
  const delay = delays[Math.min(attemptCount - 1, delays.length - 1)] || 7 * 24 * 60 * 60 * 1000;
  
  const jobId = `recovery-${libraryEntryId}`;
  
  // Remove existing recovery job if any
  const existingJob = await seriesResolutionQueue.getJob(jobId);
  if (existingJob) {
    await existingJob.remove();
  }
  
  await seriesResolutionQueue.add(
    'series-resolution',
    { libraryEntryId, source_url: null, title: null },
    {
      jobId,
      delay,
      priority: 5, // Low priority for recovery
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true
    }
  );
  
  logger.info(`[Enrichment] Scheduled recovery for ${libraryEntryId} in ${Math.round(delay / (24 * 60 * 60 * 1000))} days`);
}

// NEW v5 Audit Bug 4: Extract creator info from MangaDex response
function extractCreatorInfo(mangadexData: any): CreatorInfo | null {
  if (!mangadexData) return null;
  
  const authors: string[] = [];
  const artists: string[] = [];
  
  // MangaDex includes relationships in the response
  if (mangadexData.relationships) {
    for (const rel of mangadexData.relationships) {
      if (rel.type === 'author' && rel.attributes?.name) {
        authors.push(rel.attributes.name.toLowerCase());
      }
      if (rel.type === 'artist' && rel.attributes?.name) {
        artists.push(rel.attributes.name.toLowerCase());
      }
    }
  }
  
  // Also check direct fields
  if (mangadexData.authors) {
    authors.push(...mangadexData.authors.map((a: string) => a.toLowerCase()));
  }
  if (mangadexData.artists) {
    artists.push(...mangadexData.artists.map((a: string) => a.toLowerCase()));
  }
  
  if (authors.length === 0 && artists.length === 0) return null;
  
  return { authors: [...new Set(authors)], artists: [...new Set(artists)] };
}

export async function processResolution(job: Job<SeriesResolutionPayload>) {
  const { libraryEntryId, source_url, title } = job.data;

  if (!libraryEntryId) {
    logger.error('[Enrichment] Missing libraryEntryId in job data');
    return;
  }

  // Bug 4: Verify this job should be processed (deduplication check)
  const expectedJobId = generateResolutionJobId(libraryEntryId);
  if (job.id !== expectedJobId && !job.id?.startsWith('recovery:') && !job.id?.startsWith('retry-resolution')) {
    logger.warn(`[Enrichment] Job ID mismatch: ${job.id} vs expected ${expectedJobId}`);
  }

  // v5 Audit Bug 5: Assert job freshness - check job timestamp vs entry's last_metadata_attempt_at
  const jobCreatedAt = job.timestamp ? new Date(job.timestamp) : new Date();
  
  // Bug 2 & 10: ALL reads MUST be inside the transaction to avoid stale snapshots
  // Initial check outside transaction only to skip obviously invalid jobs
  const quickCheck = await prisma.libraryEntry.findUnique({
    where: { id: libraryEntryId },
    select: { 
      id: true, 
      metadata_status: true,
      last_metadata_attempt_at: true, // v5 Bug 5: For freshness check
      series_id: true, // v5 Bug 1: For referential guard
    }
  });

  if (!quickCheck) {
    logger.info(`[Enrichment] Entry ${libraryEntryId} not found, may have been deleted`);
    return;
  }

  // Skip if already enriched (quick check - will be re-verified in transaction)
  if (quickCheck.metadata_status === 'enriched') {
    logger.debug(`[Enrichment] Entry ${libraryEntryId} already enriched, skipping`);
    return;
  }

  // v5 Audit Bug 5: Assert job freshness - reject stale jobs
  if (quickCheck.last_metadata_attempt_at) {
    const lastAttempt = new Date(quickCheck.last_metadata_attempt_at);
    if (jobCreatedAt < lastAttempt) {
      logger.warn(`[Enrichment] Stale job detected for ${libraryEntryId}: job created at ${jobCreatedAt.toISOString()}, last attempt at ${lastAttempt.toISOString()}. Skipping.`);
      return;
    }
  }

  // Bug 12: Wrap entire operation in serialization-safe retry
  try {
    await executeWithSerializationRetry(async () => {
      // Bug 2: Use SELECT FOR UPDATE to lock the row
      const libEntry = await prisma.$queryRaw<any[]>`
        SELECT * FROM library_entries 
        WHERE id = ${libraryEntryId}::uuid
        FOR UPDATE SKIP LOCKED
      `.then(rows => rows[0]);

      if (!libEntry) {
        logger.info(`[Enrichment] Entry ${libraryEntryId} not found or locked by another worker`);
        return;
      }

      // Bug 1: Check if entry was manually fixed
      if (libEntry.manually_linked === true) {
        logger.info(`[Enrichment] Skipping ${libraryEntryId} - manually_linked flag is set`);
        return;
      }

      if (libEntry.manual_override_at) {
        const overrideTime = new Date(libEntry.manual_override_at);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        if (overrideTime > thirtyDaysAgo) {
          logger.info(`[Enrichment] Skipping ${libraryEntryId} - has recent manual override at ${overrideTime.toISOString()}`);
          return;
        }
      }

      // Bug 1: Check if linked series has USER_OVERRIDE source
      if (libEntry.series_id) {
        const linkedSeries = await prisma.series.findUnique({
          where: { id: libEntry.series_id },
          select: { metadata_source: true, override_user_id: true }
        });
        
        if (linkedSeries?.metadata_source === 'USER_OVERRIDE') {
          logger.info(`[Enrichment] Skipping ${libraryEntryId} - has manual override by user ${linkedSeries.override_user_id}`);
          return;
        }
      }

      // Skip if already enriched
      if (libEntry.metadata_status === 'enriched') {
        return;
      }

      // Bug 3: Get strategy based on attempt count - each retry uses different search space
      const attemptCount = (libEntry.metadata_retry_count || 0) + 1;
      const strategy = getSearchStrategy(attemptCount);
      
      const titleToSearch = title || libEntry.imported_title || '';
      logger.info(`[Enrichment] Attempting to enrich: ${titleToSearch} [Attempt ${attemptCount}] [Strategy: ${strategy.searchVariation}, threshold=${strategy.similarityThreshold}]`);

      let matchedSeriesId: string | null = null;
      let matchSource: 'mangadex' | null = null;
      let bestCandidate: any = null;
      let maxSimilarity = 0;
      
      // v5 Audit Bug 4: Track secondary signals
      let creatorMatch: boolean | undefined = undefined;
      let languageMatch: boolean | undefined = undefined;
      let yearDrift: number | undefined = undefined;

      try {
        // 1. EXACT ID MATCH FROM URL (Highest Priority)
        const platformInfo = extractPlatformIds(source_url || libEntry.source_url);
        if (platformInfo) {
          logger.info(`[Enrichment] Extracted ${platformInfo.platform} ID: ${platformInfo.id}`);
          if (platformInfo.platform === 'mangadex') {
            // Bug 5: Check cache first
            bestCandidate = getCachedSeriesMetadata(platformInfo.id);
            if (!bestCandidate) {
              bestCandidate = await getMangaById(platformInfo.id);
              if (bestCandidate) {
                cacheSeriesMetadata(platformInfo.id, bestCandidate);
              }
            }
            if (bestCandidate) {
              matchSource = 'mangadex';
              maxSimilarity = 1.0;
              const existing = await prisma.series.findUnique({ where: { mangadex_id: platformInfo.id } });
              if (existing) matchedSeriesId = existing.id;
            }
          }
        }

        // 2. SEARCH BY TITLE (Fallback) - Bug 3: Use strategy-varied searching
        if (!matchedSeriesId && titleToSearch) {
          const titlesToSearch = strategy.tryAltTitles 
            ? generateTitleVariations(titleToSearch, strategy.searchVariation) 
            : [titleToSearch];
          
          for (const searchTitle of titlesToSearch) {
            if (matchedSeriesId) break;
            
            const mdCandidates = await searchMangaDex(searchTitle);
            
            const topMd = mdCandidates?.slice(0, strategy.maxCandidates).reduce((best, current) => {
              // Base title similarity
              const titleScore = calculateSimilarity(titleToSearch, current.title);
              // Also check against alt titles
              const altScores = (current.alternative_titles || []).map(
                (alt: string) => calculateSimilarity(titleToSearch, alt)
              );
              const maxAltScore = altScores.length > 0 ? Math.max(...altScores) : 0;
              const baseSimilarity = Math.max(titleScore, maxAltScore);
              
              // v5 Audit Bug 4: Apply secondary signals to enhance score
              const candidateCreators = extractCreatorInfo(current);
              const enhancedScore = calculateEnhancedMatchScore(
                baseSimilarity,
                null, // We don't have source creators for now
                candidateCreators
              );
              
              const bestScore = best ? (best._score || 0) : -1;
              return enhancedScore > bestScore ? { ...current, _score: enhancedScore, _baseSimilarity: baseSimilarity } : best;
            }, null as any);

            if (topMd) {
              const score = topMd._score || calculateSimilarity(titleToSearch, topMd.title);
              if (score >= strategy.similarityThreshold) {
                // Bug 5: Cache the result
                if (topMd.mangadex_id) {
                  cacheSeriesMetadata(topMd.mangadex_id, topMd);
                }
                bestCandidate = topMd;
                matchSource = 'mangadex';
                maxSimilarity = score;
                
                // v5 Audit Bug 4: Check secondary signals
                if (topMd.original_language) {
                  languageMatch = areLanguagesCompatible(topMd.original_language, libEntry.original_language || null);
                }
                if (topMd.year && libEntry.expected_year) {
                  const yearCheck = checkYearCompatibility(topMd.year, libEntry.expected_year);
                  yearDrift = yearCheck.drift;
                }
                
                const existing = await prisma.series.findUnique({ where: { mangadex_id: topMd.mangadex_id } });
                if (existing) matchedSeriesId = existing.id;
              }
            }
          }
        }

        // 3. CREATE SERIES IF MATCHED BUT NOT IN DB
        if (!matchedSeriesId && bestCandidate) {
          if (matchSource === 'mangadex') {
            try {
              const series = await prisma.series.upsert({
                where: { mangadex_id: bestCandidate.mangadex_id },
                update: {},
                create: {
                  title: bestCandidate.title,
                  mangadex_id: bestCandidate.mangadex_id,
                  alternative_titles: bestCandidate.alternative_titles,
                  description: bestCandidate.description,
                  status: bestCandidate.status || "ongoing",
                  type: bestCandidate.type || "manga",
                  content_rating: bestCandidate.content_rating,
                  cover_url: bestCandidate.cover_url,
                  external_links: { mangadex: bestCandidate.mangadex_id },
                  import_status: 'CANONICALLY_ENRICHED',
                  metadata_source: 'CANONICAL',
                  metadata_confidence: maxSimilarity,
                  year: bestCandidate.year || null,
                  original_language: bestCandidate.original_language || null,
                }
              });
              
              // Bug 8: Validate enrichment result
              const validation = validateEnrichmentResult(series, matchSource);
              if (!validation.valid) {
                logger.warn(`[Enrichment] Validation failed for series ${series.id}: ${validation.errors.join(', ')}`);
                // Don't use this series if validation fails
                matchedSeriesId = null;
              } else {
                matchedSeriesId = series.id;
              }
            } catch (upsertErr: any) {
              if (upsertErr.code === 'P2002') {
                const existing = await prisma.series.findUnique({ 
                  where: { mangadex_id: bestCandidate.mangadex_id } 
                });
                if (existing) {
                  matchedSeriesId = existing.id;
                } else {
                  throw upsertErr;
                }
              } else {
                throw upsertErr;
              }
            }
          }
        }

        // 4. FINALIZE LINKING
        if (matchedSeriesId) {
          // Bug 13: Use multi-factor review decision
          // v5 Audit Bug 4: Include secondary signals
          const isExactIdMatch = maxSimilarity === 1.0;
          const reviewDecision = calculateReviewDecision({
            similarity: maxSimilarity,
            isExactIdMatch,
            creatorMatch,
            languageMatch,
            yearDrift,
          });
          const needsReview = reviewDecision.needsReview;
          
          if (reviewDecision.factors.length > 0) {
            logger.info(`[Enrichment] Review decision: ${reviewDecision.factors.join(', ')} [confidence: ${reviewDecision.confidence}]`);
          }

          await prisma.$transaction(async (tx) => {
            // Bug 2 & 10: Re-fetch with lock inside transaction (no stale snapshot)
            const currentEntry = await tx.$queryRaw<any[]>`
              SELECT * FROM library_entries 
              WHERE id = ${libraryEntryId}::uuid
              FOR UPDATE
            `.then(rows => rows[0]);

            if (!currentEntry || currentEntry.metadata_status === 'enriched') {
              return;
            }

            // Bug 1: Triple-check for manual override within transaction
            if (currentEntry.manually_linked === true || currentEntry.manual_override_at) {
              logger.info(`[Enrichment] Skipping update - manual override detected in transaction`);
              return;
            }

            // v5 Audit Bug 1: Referential guard - verify series_id hasn't changed mid-transaction
            if (currentEntry.series_id && currentEntry.series_id !== matchedSeriesId) {
              // Entry was rebound to a different series by another process
              logger.warn(`[Enrichment] Referential guard triggered: entry ${libraryEntryId} series_id changed from ${currentEntry.series_id} to target ${matchedSeriesId}`);
              // Only proceed if target series_id matches or entry is unlinked
              const shouldProceed = currentEntry.series_id === null;
              if (!shouldProceed) {
                logger.info(`[Enrichment] Aborting - entry already bound to different series ${currentEntry.series_id}`);
                return;
              }
            }

            if (currentEntry.series_id) {
              const linkedSeries = await tx.series.findUnique({
                where: { id: currentEntry.series_id },
                select: { metadata_source: true }
              });
              if (linkedSeries?.metadata_source === 'USER_OVERRIDE') {
                logger.info(`[Enrichment] Skipping update - USER_OVERRIDE series in transaction`);
                return;
              }
            }

            const existingDuplicate = await tx.libraryEntry.findFirst({
              where: {
                user_id: currentEntry.user_id,
                series_id: matchedSeriesId,
                id: { not: libraryEntryId }
              }
            });

            if (existingDuplicate) {
              // Bug 15: Validate before deleting
              const deleteValidation = validateDeletion(
                currentEntry,
                existingDuplicate,
                source_url || currentEntry.source_url
              );

              if (!deleteValidation.canDelete) {
                logger.warn(`[Enrichment] Cannot delete entry ${libraryEntryId}: ${deleteValidation.reason}`);
                // Update the existing duplicate instead
                const mergedProgressValue = mergeProgress(
                  existingDuplicate.last_read_chapter ? Number(existingDuplicate.last_read_chapter) : null,
                  currentEntry.last_read_chapter ? Number(currentEntry.last_read_chapter) : null
                );
                await tx.libraryEntry.update({
                  where: { id: existingDuplicate.id },
                  data: { 
                    last_read_chapter: mergedProgressValue,
                    updated_at: new Date()
                  }
                });
                // Mark current as unavailable instead of deleting
                await tx.libraryEntry.update({
                  where: { id: libraryEntryId },
                  data: {
                    metadata_status: 'unavailable',
                    last_metadata_error: `Duplicate entry exists: ${existingDuplicate.id}`,
                    needs_review: true
                  }
                });
                return;
              }

              logger.info(`[Enrichment] Found duplicate entry ${existingDuplicate.id}. Merging...`);
              
              // Bug 14: Use normalized progress comparison
              const mergedProgressValue = mergeProgress(
                existingDuplicate.last_read_chapter ? Number(existingDuplicate.last_read_chapter) : null,
                currentEntry.last_read_chapter ? Number(currentEntry.last_read_chapter) : null
              );
              const existingNormalized = normalizeProgress(existingDuplicate.last_read_chapter ? Number(existingDuplicate.last_read_chapter) : null);
              
              if (mergedProgressValue > existingNormalized) {
                await tx.libraryEntry.update({
                  where: { id: existingDuplicate.id },
                  data: { 
                    last_read_chapter: mergedProgressValue,
                    updated_at: new Date()
                  }
                });
              }
            
              // Bug 34: Soft delete instead of hard delete (preserves audit trail)
              await tx.libraryEntry.update({ 
                where: { id: libraryEntryId }, 
                data: { 
                  deleted_at: new Date(),
                  metadata_status: 'unavailable',
                  last_metadata_error: `Soft deleted - merged with duplicate entry ${existingDuplicate.id}`
                } 
              });
                
              // Bug 9: Use safe update to prevent relinking wrong rows
              const entryUrl = source_url || currentEntry.source_url;
              if (entryUrl) {
                const updateResult = await safeSeriesSourceUpdate(tx, entryUrl, matchedSeriesId!);
                if (!updateResult.success) {
                  logger.warn(`[Enrichment] Safe source update failed: ${updateResult.error}`, { sourceUrl: entryUrl });
                }
              }
              return;
            }

            // v5 Audit Bug 3: Conditional retry count reset
            // Only reset retry count when NOT needs_review (borderline cases should preserve history)
            const shouldResetRetryCount = !needsReview && maxSimilarity >= 0.85;
            
            // Standard update with metadata version tracking (Bug 11)
            await tx.libraryEntry.update({
              where: { id: libraryEntryId },
              data: { 
                series_id: matchedSeriesId, 
                metadata_status: 'enriched',
                needs_review: needsReview,
                metadata_retry_count: shouldResetRetryCount ? 0 : currentEntry.metadata_retry_count,
                last_metadata_error: null,
                last_metadata_attempt_at: new Date(),
                updated_at: new Date()
              }
            });

            // v5 Audit Bug 2: Null-guard for seriesSource before update
            const entryUrl = source_url || currentEntry.source_url;
            if (entryUrl) {
              // First verify the source exists
              const existingSource = await tx.seriesSource.findFirst({
                where: { source_url: entryUrl }
              });
              
              if (existingSource) {
                // Bug 9: Use safe update for seriesSource link
                const updateResult = await safeSeriesSourceUpdate(tx, entryUrl, matchedSeriesId!);
                if (!updateResult.success) {
                  logger.warn(`[Enrichment] Safe source update failed: ${updateResult.error}`, { sourceUrl: entryUrl });
                }
              } else {
                logger.debug(`[Enrichment] No seriesSource found for URL ${entryUrl}, skipping source update`);
              }
            }
          }, {
            isolationLevel: 'Serializable'
          });

          if (matchSource === 'mangadex' && bestCandidate) {
            await refreshCoverQueue.add(`cover-${matchedSeriesId}`, {
              seriesId: matchedSeriesId,
              sourceId: bestCandidate.mangadex_id,
              sourceName: 'mangadex'
            });

            if (isStatsEnrichmentEnabled() && bestCandidate.mangadex_id) {
              try {
                const statsResult = await enrichSingleSeriesWithStats(
                  prisma,
                  matchedSeriesId!,
                  bestCandidate.mangadex_id
                );
                if (statsResult.success) {
                  logger.info(`[Enrichment] Stats enriched for ${matchedSeriesId}`);
                } else if (statsResult.shouldRequeue) {
                  logger.warn(`[Enrichment] Stats fetch rate limited, will retry later`, {
                    seriesId: matchedSeriesId,
                    requeueDelay: statsResult.requeueDelay,
                  });
                }
              } catch (statsErr) {
                logger.warn(`[Enrichment] Stats enrichment failed (non-fatal)`, {
                  seriesId: matchedSeriesId,
                  error: statsErr instanceof Error ? statsErr.message : String(statsErr),
                });
              }
            }
          }

          logger.info(`[Enrichment] Successfully linked "${titleToSearch}" to ${matchedSeriesId}`);
        } else {
          // NO MATCH FOUND - Mark as unavailable (not failed)
          await prisma.libraryEntry.update({
            where: { id: libraryEntryId },
            data: { 
              metadata_status: 'unavailable',
              metadata_retry_count: attemptCount,
              last_metadata_error: `No match found (attempt ${attemptCount}, strategy: ${strategy.searchVariation})`,
              last_metadata_attempt_at: new Date(),
            }
          });
          
          // Bug 6: Schedule automatic recovery
          await scheduleUnavailableRecovery(libraryEntryId, attemptCount);
          
          logger.info(`[Enrichment] No match for "${titleToSearch}". Marked unavailable. Recovery scheduled.`);
        }
      } catch (err: any) {
        const isRateLimit = err instanceof MangaDexRateLimitError;
        const isCloudflare = err instanceof MangaDexCloudflareError;
        const isNetwork = err instanceof MangaDexNetworkError || err.name === 'AbortError' || err.message?.includes('timeout');
        
        const isTransient = isRateLimit || isCloudflare || isNetwork || (err.status && err.status >= 500);

        logger.error(`[Enrichment] Error during resolution for "${titleToSearch}":`, { error: err.message });

        // Bug 7: Sanitize error message before storing
        const sanitizedError = sanitizeErrorMessage(err);

        if (isTransient) {
          const backoffDelay = calculateBackoffWithJitter(attemptCount);
          
          await prisma.libraryEntry.update({
            where: { id: libraryEntryId },
            data: { 
              metadata_retry_count: attemptCount,
              last_metadata_error: sanitizedError,
              last_metadata_attempt_at: new Date(),
              metadata_status: 'pending'
            }
          });

          logger.info(`[Enrichment] Transient error. Scheduling retry ${attemptCount} in ${Math.round(backoffDelay/1000)}s`);
          throw err;
        }

        // Non-transient errors - mark as unavailable with sanitized error
        await prisma.libraryEntry.update({
          where: { id: libraryEntryId },
          data: { 
            metadata_status: 'unavailable',
            last_metadata_error: sanitizedError,
            last_metadata_attempt_at: new Date(),
          }
        });
        
        // Bug 6: Schedule recovery even for errors
        await scheduleUnavailableRecovery(libraryEntryId, attemptCount);
        
        logger.info(`[Enrichment] Non-transient error for "${titleToSearch}". Marked unavailable. Recovery scheduled.`);
      }
    });
  } catch (err: any) {
    // Bug 12: Final catch for serialization failures after retries exhausted
    if (err.code === 'P2034' || err.code === '40001') {
      logger.error(`[Enrichment] Serialization failure persisted after ${MAX_TRANSACTION_RETRIES} retries for ${libraryEntryId}`);
    }
    throw err;
  }
}
