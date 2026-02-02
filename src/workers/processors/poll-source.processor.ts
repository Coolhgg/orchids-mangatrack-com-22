import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { scrapers, ScraperError, validateSourceUrl, RateLimitError, ProxyBlockedError } from '@/lib/scrapers';
import { chapterIngestQueue, getNotificationSystemHealth } from '@/lib/queues';
import { sourceRateLimiter, negativeResultCache } from '@/lib/rate-limiter';
import { BACKOFF_CONFIG } from '@/lib/job-config';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import {
  // Bug 161-162: Monotonic clock
  getMonotonicTimestamp,
  calculateSafeDelay,
  // Bug 170-171: Global concurrency cap
  canStartJob,
  recordJobStart,
  recordJobEnd,
  getConcurrencyStats,
  // Bug 179: Dynamic scheduler configuration
  getSchedulerConfig,
  // Bug 192: Feature flags
  isFeatureEnabled,
  // v5 Audit Bug 9: Robust progress merge
  normalizeProgress,
} from '@/lib/bug-fixes-extended';

// =============================================================================
// V5 AUDIT BUG FIXES 51-80: Import utilities
// =============================================================================
import {
  // Bug 53: Check if source is active before processing
  isSourceActive,
  // Bug 64: Create failure-aware processor wrapper
  createFailureAwareProcessor,
  shouldFailJob,
  // Bug 78: Stale job protection
  isJobStale,
} from '@/lib/bug-fixes/v5-audit-bugs-51-80';

// Bug 30: Max chapters per sync guard
const MAX_CONSECUTIVE_FAILURES = 5;
const RATE_LIMIT_TIMEOUT_MS = 60000;
const MAX_INGEST_QUEUE_SIZE = 50000;
const MAX_CHAPTERS_PER_SYNC = 500; // Bug 30: Prevent memory exhaustion from massive chapter lists

// Bug 51: Job schema versioning
const JOB_SCHEMA_VERSION = 1;

// Bug 78: Maximum job age (24 hours)
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000;

const PollSourceDataSchema = z.object({
  seriesSourceId: z.string().uuid(),
  targetChapters: z.array(z.number()).optional(),
  schemaVersion: z.number().optional(), // Bug 51: Schema version for job payloads
  enqueuedAt: z.number().optional(), // Bug 78: Timestamp when job was enqueued
});

export interface PollSourceData {
  seriesSourceId: string;
  targetChapters?: number[];
  schemaVersion?: number;
  enqueuedAt?: number;
}

// Bug 60: Worker heartbeat tracking
interface WorkerHeartbeat {
  jobId: string;
  sourceId: string;
  startedAt: Date;
  lastHeartbeat: Date;
}

const activeJobs = new Map<string, WorkerHeartbeat>();

function updateHeartbeat(jobId: string, sourceId: string) {
  activeJobs.set(jobId, {
    jobId,
    sourceId,
    startedAt: activeJobs.get(jobId)?.startedAt || new Date(),
    lastHeartbeat: new Date(),
  });
}

function clearHeartbeat(jobId: string) {
  activeJobs.delete(jobId);
}

// Bug 60: Expose stalled jobs for monitoring
export function getStalledJobs(thresholdMs: number = 300000): WorkerHeartbeat[] {
  const now = Date.now();
  const stalled: WorkerHeartbeat[] = [];
  
  for (const [, heartbeat] of activeJobs) {
    if (now - heartbeat.lastHeartbeat.getTime() > thresholdMs) {
      stalled.push(heartbeat);
    }
  }
  
  return stalled;
}

// Bug 40: Post-sync invariant verification
interface SyncInvariantResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

async function verifySyncInvariants(
  sourceId: string,
  expectedChapterCount: number
): Promise<SyncInvariantResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Check source exists
    const source = await prisma.seriesSource.findUnique({
      where: { id: sourceId },
      select: { 
        id: true, 
        source_chapter_count: true, 
        failure_count: true,
        series_id: true 
      }
    });

    if (!source) {
      errors.push('Source not found after sync');
      return { valid: false, errors, warnings };
    }

    // Verify chapter count is reasonable
    if (source.source_chapter_count !== null && source.source_chapter_count < 0) {
      errors.push('Negative chapter count detected');
    }

    // Check for orphaned state
    if (source.series_id && expectedChapterCount > 0) {
      const actualChapterCount = await prisma.chapterSource.count({
        where: { series_source_id: sourceId }
      });

      if (actualChapterCount === 0 && expectedChapterCount > 0) {
        warnings.push(`Expected ${expectedChapterCount} chapters but found 0`);
      }
    }

    // Check failure count isn't stuck
    if (source.failure_count > MAX_CONSECUTIVE_FAILURES * 2) {
      warnings.push(`Abnormally high failure count: ${source.failure_count}`);
    }

  } catch (error) {
    errors.push(`Invariant check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// Bug 26: Detect and handle chapter deletions
async function detectChapterDeletions(
  sourceId: string,
  scrapedChapterNumbers: number[]
): Promise<number> {
  if (scrapedChapterNumbers.length === 0) {
    return 0;
  }

  const scrapedSet = new Set(scrapedChapterNumbers.map(n => n.toString()));
  
  // Get existing chapters for this source
  const existingChapters = await prisma.chapterSource.findMany({
    where: { 
      series_source_id: sourceId,
      is_available: true 
    },
    select: {
      id: true,
      chapter: {
        select: { chapter_number: true }
      }
    }
  });

  // Find chapters that exist in DB but not in scraped data
  const missingChapters = existingChapters.filter(
    ch => !scrapedSet.has(ch.chapter.chapter_number)
  );

  if (missingChapters.length > 0) {
    // Mark as unavailable (soft delete)
    await prisma.chapterSource.updateMany({
      where: {
        id: { in: missingChapters.map(ch => ch.id) }
      },
      data: {
        is_available: false,
        last_checked_at: new Date()
      }
    });

    logger.info(`[PollSource] Marked ${missingChapters.length} chapters as unavailable for source ${sourceId}`);
  }

  return missingChapters.length;
}

// v5 Audit Bug 7: Assert monotonic chapter growth
// Verify new chapters are newer and non-overlapping
interface ChapterMonotonicityResult {
  valid: boolean;
  warnings: string[];
  outOfOrderChapters: number[];
}

async function assertMonotonicChapterGrowth(
  sourceId: string,
  newChapterNumbers: number[]
): Promise<ChapterMonotonicityResult> {
  const warnings: string[] = [];
  const outOfOrderChapters: number[] = [];
  
  if (newChapterNumbers.length === 0) {
    return { valid: true, warnings, outOfOrderChapters };
  }

  // Get the highest existing chapter number for this source
  const existingChapters = await prisma.chapterSource.findMany({
    where: { series_source_id: sourceId },
    select: {
      chapter: { select: { chapter_number: true } },
      detected_at: true,
    },
    orderBy: { detected_at: 'desc' },
    take: 100, // Last 100 chapters
  });

  if (existingChapters.length === 0) {
    // First sync - no monotonicity check needed
    return { valid: true, warnings, outOfOrderChapters };
  }

  const existingNumbers = existingChapters.map(c => parseFloat(c.chapter.chapter_number));
  const maxExisting = Math.max(...existingNumbers);
  
  // Check if any "new" chapters are actually older than recent ones
  for (const newChNum of newChapterNumbers) {
    // Flag chapters that are significantly older than most recent
    if (newChNum < maxExisting - 10) {
      warnings.push(`Chapter ${newChNum} is significantly older than most recent (${maxExisting})`);
      outOfOrderChapters.push(newChNum);
    }
  }

  // Check for potential duplicates / overlapping chapters
  const newSet = new Set(newChapterNumbers);
  const existingSet = new Set(existingNumbers);
  const overlapping = [...newSet].filter(n => existingSet.has(n));
  
  if (overlapping.length > newChapterNumbers.length * 0.5) {
    // More than 50% overlap - likely a re-sync, not new chapters
    warnings.push(`High overlap detected (${overlapping.length}/${newChapterNumbers.length}), may be re-sync`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
    outOfOrderChapters
  };
}

// v5 Audit Bug 8: Compound chapter identity
// Generate compound identity key for chapter deduplication
function generateChapterIdentityKey(
  seriesSourceId: string,
  chapterNumber: number | string,
  sourceChapterId?: string | null
): string {
  // Primary identity: source_id + chapter_number
  const baseKey = `${seriesSourceId}:${chapterNumber}`;
  
  // If source provides a chapter ID, use it as secondary identity
  // This helps when sources reuse chapter numbers
  if (sourceChapterId) {
    return `${baseKey}:${sourceChapterId}`;
  }
  
  return baseKey;
}

// v5 Audit Bug 9: Robust progress merge for floats
// Handle floating point chapter numbers like 10.5, 10.50, specials
function normalizeChapterNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return 0;
  
  // Round to 2 decimal places for consistent comparison
  return Math.round(numValue * 100) / 100;
}

function compareChapterNumbers(a: number | string, b: number | string): number {
  const normA = normalizeChapterNumber(a);
  const normB = normalizeChapterNumber(b);
  return normA - normB;
}

// v5 Audit Bug 10: Guard against empty chapter payload
interface ChapterPayloadValidation {
  valid: boolean;
  errors: string[];
}

function validateChapterPayload(chapters: any[]): ChapterPayloadValidation {
  const errors: string[] = [];
  
  if (!chapters) {
    errors.push('Chapter payload is null/undefined');
    return { valid: false, errors };
  }
  
  if (!Array.isArray(chapters)) {
    errors.push('Chapter payload is not an array');
    return { valid: false, errors };
  }
  
  // Empty array is valid but should be noted
  if (chapters.length === 0) {
    // This is valid - could be a series with no chapters yet
    return { valid: true, errors };
  }
  
  // Validate structure of each chapter
  for (let i = 0; i < Math.min(chapters.length, 5); i++) {
    const ch = chapters[i];
    if (!ch) {
      errors.push(`Chapter at index ${i} is null/undefined`);
      continue;
    }
    if (ch.chapterNumber === undefined && ch.chapterUrl === undefined) {
      errors.push(`Chapter at index ${i} missing both chapterNumber and chapterUrl`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

export async function processPollSource(job: Job<PollSourceData>) {
    const jobId = job.id || 'unknown';
    const sourceName = 'poll-source';
    
    if (!job.data || !job.data.seriesSourceId || job.data.seriesSourceId === 'undefined') {
      console.error(`[PollSource][${jobId}] CRITICAL: Received job with null/undefined seriesSourceId. Data:`, JSON.stringify(job.data));
      // Bug 64: Throw error to mark job as failed, don't silently return
      throw new Error('Invalid job data: missing seriesSourceId');
    }

    // Bug 78: Check if job is stale (too old)
    if (isJobStale(job.data.enqueuedAt, MAX_JOB_AGE_MS)) {
      logger.warn(`[PollSource][${jobId}] Skipping stale job (age: ${job.data.enqueuedAt ? Date.now() - job.data.enqueuedAt : 'unknown'}ms)`);
      return; // Don't throw - just skip stale jobs
    }

    // Bug 170-171: Check global concurrency limits before processing
    if (!canStartJob('sync-source', sourceName)) {
      const stats = getConcurrencyStats();
      logger.warn(`[PollSource][${jobId}] Concurrency limit reached (${stats.globalActive}/${stats.utilization.toFixed(2)}), rescheduling`);
      // Re-throw to let BullMQ retry with backoff
      throw new Error('Concurrency limit reached');
    }
    
    // Record job start for concurrency tracking
    recordJobStart('sync-source', sourceName);

    const seriesSourceId = job.data.seriesSourceId;
  
  // Bug 60: Register heartbeat
  updateHeartbeat(jobId, seriesSourceId);
  
  // Track sync success for v5 Bug 6: Only update last_sync_at on FULL success
  let syncFullySuccessful = false;
  let chaptersProcessed = 0;
  
  try {
    console.log(`[PollSource][${jobId}] Starting process for source ID: ${seriesSourceId}`);

    // Bug 51: Check job schema version
    const jobSchemaVersion = job.data.schemaVersion || 0;
    if (jobSchemaVersion < JOB_SCHEMA_VERSION) {
      logger.warn(`[PollSource][${jobId}] Job has outdated schema version ${jobSchemaVersion}, current is ${JOB_SCHEMA_VERSION}`);
      // Continue processing but log the discrepancy
    }

    const parseResult = PollSourceDataSchema.safeParse(job.data);
    if (!parseResult.success) {
      console.error(`[PollSource][${jobId}] Invalid job payload:`, parseResult.error.format());
      // Bug 64: Throw error to mark job as failed
      throw new Error(`Invalid job payload: ${parseResult.error.message}`);
    }

    // =======================================================================
    // BUG 53 FIX: Re-check source status at processing time
    // Source may have been disabled after job was scheduled
    // =======================================================================
    const sourceActiveCheck = await isSourceActive(prisma, seriesSourceId);
    if (!sourceActiveCheck.active) {
      logger.info(`[PollSource][${jobId}] Source ${seriesSourceId} is not active: ${sourceActiveCheck.reason}`);
      return; // Skip processing - source was disabled
    }

    const source = await prisma.seriesSource.findUnique({
      where: { id: seriesSourceId },
      include: { series: true }
    });

    if (!source) {
      console.warn(`[PollSource][${jobId}] Source ${seriesSourceId} not found, skipping`);
      return;
    }

    // Bug 60: Update heartbeat after DB query
    updateHeartbeat(jobId, seriesSourceId);

    const systemHealth = await getNotificationSystemHealth();
    const ingestQueueCounts = await chapterIngestQueue.getJobCounts('waiting');
    
    if (systemHealth.isCritical || ingestQueueCounts.waiting > MAX_INGEST_QUEUE_SIZE) {
      console.warn(`[PollSource][${jobId}] System under high load (waiting: ${ingestQueueCounts.waiting}), delaying poll for ${source.source_title || source.source_url}`);
      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          next_check_at: new Date(Date.now() + 15 * 60 * 1000),
        }
      });
      return;
    }

    if (source.failure_count >= MAX_CONSECUTIVE_FAILURES) {
      const lastChecked = source.last_checked_at ? new Date(source.last_checked_at).getTime() : 0;
      const cooldownPeriod = 60 * 60 * 1000;

      if (Date.now() - lastChecked > cooldownPeriod) {
        console.info(`[PollSource][${jobId}] Cooldown expired for ${seriesSourceId}, attempting auto-reset probe`);
      } else {
        console.warn(`[PollSource][${jobId}] Circuit breaker open for ${seriesSourceId} (${source.failure_count} failures). Cooldown active (60m).`);
        await prisma.seriesSource.update({
          where: { id: source.id },
          data: {
            sync_priority: 'COLD',
            source_status: 'broken',
            next_check_at: new Date(Date.now() + 60 * 60 * 1000),
          }
        });
        return;
      }
    }

    if (!validateSourceUrl(source.source_url)) {
      console.error(`[PollSource][${jobId}] Invalid source URL for ${seriesSourceId}`);
      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          failure_count: { increment: 1 },
          last_checked_at: new Date(),
        }
      });
      // Bug 64: Throw error for invalid URL
      throw new Error(`Invalid source URL for ${seriesSourceId}`);
    }

    const scraper = scrapers[source.source_name.toLowerCase()];
    if (!scraper) {
      console.error(`[PollSource][${jobId}] No scraper for source ${source.source_name}`);
      // Bug 64: Throw error if no scraper available
      throw new Error(`No scraper available for ${source.source_name}`);
    }

    const sourceNameLower = source.source_name.toLowerCase();
    console.log(`[PollSource][${jobId}] Waiting for rate limit token for ${sourceNameLower}...`);
    
    // Bug 60: Update heartbeat before potentially blocking operation
    updateHeartbeat(jobId, seriesSourceId);
    
    const tokenAcquired = await sourceRateLimiter.acquireToken(sourceNameLower, RATE_LIMIT_TIMEOUT_MS);
    
    if (!tokenAcquired) {
      console.warn(`[PollSource][${jobId}] Rate limit timeout for ${sourceNameLower}, rescheduling`);
      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          next_check_at: new Date(Date.now() + 5 * 60 * 1000),
        }
      });
      // Bug 64: Throw to trigger retry instead of silently returning
      throw new Error(`Rate limit timeout for ${sourceNameLower}`);
    }

    try {
      console.log(`[PollSource][${jobId}] Polling ${source.source_name} for ${source.source_title || source.source_url}...`);
      
      // Bug 60: Update heartbeat before scraping
      updateHeartbeat(jobId, seriesSourceId);
      
      const scrapedData = await scraper.scrapeSeries(source.source_id, job.data.targetChapters);
      
      // Bug 60: Update heartbeat after scraping
      updateHeartbeat(jobId, seriesSourceId);
      
      // v5 Audit Bug 10: Validate chapter payload before processing
      const payloadValidation = validateChapterPayload(scrapedData.chapters);
      if (!payloadValidation.valid) {
        logger.error(`[PollSource][${jobId}] Invalid chapter payload:`, { errors: payloadValidation.errors });
        // Don't update sync metadata for invalid payloads
        await prisma.seriesSource.update({
          where: { id: source.id },
          data: {
            failure_count: { increment: 1 },
            last_checked_at: new Date(),
          }
        });
        // Bug 64: Throw error to mark job as failed
        throw new Error(`Invalid chapter payload: ${payloadValidation.errors.join(', ')}`);
      }
      
      if (scrapedData.sourceId !== source.source_id && source.source_name.toLowerCase() === 'mangadex') {
        console.log(`[PollSource][${jobId}] Updating sourceId for ${source.id} from ${source.source_id} to ${scrapedData.sourceId}`);
        await prisma.seriesSource.update({
          where: { id: source.id },
          data: { source_id: scrapedData.sourceId }
        });
      }

      const isEmpty = scrapedData.chapters.length === 0;
      await negativeResultCache.recordResult(seriesSourceId, isEmpty);

      if (isEmpty) {
        console.log(`[PollSource][${jobId}] No chapters found for ${source.source_title || source.source_url}, recording negative result`);
        // v5 Bug 6: Still update timestamps even for empty result (this is a successful sync)
        syncFullySuccessful = true;
        await prisma.seriesSource.update({
          where: { id: source.id },
          data: {
            last_checked_at: new Date(),
            last_success_at: new Date(),
            failure_count: 0,
          }
        });
        return;
      }

      // Bug 30: Limit chapters per sync to prevent memory exhaustion
      let chaptersToProcess = scrapedData.chapters;
      if (chaptersToProcess.length > MAX_CHAPTERS_PER_SYNC) {
        logger.warn(`[PollSource][${jobId}] Scraped ${chaptersToProcess.length} chapters, limiting to ${MAX_CHAPTERS_PER_SYNC}`);
        // Sort by chapter number descending and take the most recent ones
        chaptersToProcess = chaptersToProcess
          .sort((a, b) => b.chapterNumber - a.chapterNumber)
          .slice(0, MAX_CHAPTERS_PER_SYNC);
      }

      // v5 Audit Bug 7: Assert monotonic chapter growth
      const scrapedChapterNumbers = chaptersToProcess.map(ch => ch.chapterNumber);
      const monotonicityCheck = await assertMonotonicChapterGrowth(source.id, scrapedChapterNumbers);
      if (!monotonicityCheck.valid) {
        logger.warn(`[PollSource][${jobId}] Monotonicity warnings:`, { warnings: monotonicityCheck.warnings });
        // Continue processing but log the warning
      }

      // Bug 26: Detect chapter deletions
      const deletedCount = await detectChapterDeletions(source.id, scrapedChapterNumbers);
      if (deletedCount > 0) {
        logger.info(`[PollSource][${jobId}] Detected ${deletedCount} deleted chapters for source ${source.id}`);
      }

      const ingestJobs: Array<{
        name: string;
        data: any;
        opts: { jobId: string; attempts: number; backoff: { type: 'exponential'; delay: number } };
      }> = [];
      
      // PERFORMANCE FIX: Use Set for O(1) dedup key lookup instead of creating duplicate job entries
      const seenDedupKeys = new Set<string>();
      
      for (const chapter of chaptersToProcess) {
        // v5 Audit Bug 9: Use normalized chapter numbers
        const normalizedChNum = normalizeChapterNumber(chapter.chapterNumber);
        const chapterNumberStr = normalizedChNum.toString();
        
        // v5 Audit Bug 8: Use compound identity key
        const dedupKey = generateChapterIdentityKey(
          source.id, 
          chapterNumberStr,
          chapter.sourceChapterId
        );
        
        // Skip duplicates within the same batch
        if (seenDedupKeys.has(dedupKey)) {
          continue;
        }
        seenDedupKeys.add(dedupKey);
        
        ingestJobs.push({
          name: `ingest-${dedupKey}`,
          data: {
            seriesSourceId: source.id,
            seriesId: source.series_id || null,
            chapterNumber: normalizedChNum,
            chapterTitle: chapter.chapterTitle || null,
            chapterUrl: chapter.chapterUrl,
            sourceChapterId: chapter.sourceChapterId || null,
            publishedAt: chapter.publishedAt ? chapter.publishedAt.toISOString() : null,
            traceId: jobId,
            schemaVersion: JOB_SCHEMA_VERSION, // Bug 51: Include schema version
            enqueuedAt: Date.now(), // Bug 78: Include enqueue timestamp
          },
          opts: {
            jobId: `ingest-${dedupKey}`,
            attempts: 3,
            backoff: {
              type: 'exponential' as const,
              delay: 1000,
            }
          }
        });
      }
      
      // Clear the set to free memory immediately
      seenDedupKeys.clear();

      if (ingestJobs.length > 0) {
        await chapterIngestQueue.addBulk(ingestJobs);
        chaptersProcessed = ingestJobs.length;
        console.log(`[PollSource][${jobId}] Enqueued ${ingestJobs.length} ingestion jobs for ${source.source_title || source.source_url}`);
      }

      // v5 Audit Bug 6: Only mark as fully successful after all chapters are enqueued
      syncFullySuccessful = true;

      // v5 Bug 6: Update sync timestamps only on FULL success
      // We update at the end after all chapters have been successfully enqueued
      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          last_checked_at: new Date(),
          last_success_at: new Date(), // Only set if we reach here
          failure_count: 0,
        }
      });

      // Bug 40: Post-sync invariant verification
      const invariantResult = await verifySyncInvariants(source.id, chaptersToProcess.length);
      if (!invariantResult.valid) {
        logger.error(`[PollSource][${jobId}] Post-sync invariant check failed:`, { errors: invariantResult.errors });
      }
      if (invariantResult.warnings.length > 0) {
        logger.warn(`[PollSource][${jobId}] Post-sync warnings:`, { warnings: invariantResult.warnings });
      }

    } catch (error) {
      // v5 Bug 6: Sync was not fully successful if we reach here
      syncFullySuccessful = false;
      
      let isRetryable = true;
      let nextCheckDelayMs = 15 * 60 * 1000;

      if (error instanceof ScraperError && error.code === 'PROVIDER_NOT_IMPLEMENTED') {
        console.info(`[PollSource][${jobId}] Source ${source.source_name} is not implemented yet. Marking as inactive.`);
        await prisma.seriesSource.update({
          where: { id: source.id },
          data: {
            source_status: 'inactive',
            last_checked_at: new Date(),
            next_check_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }
        });
        return;
      }

      if (error instanceof RateLimitError) {
        console.warn(`[PollSource][${jobId}] Rate limited by source ${source.source_name}, backing off 1 hour`);
        nextCheckDelayMs = BACKOFF_CONFIG.RATE_LIMIT_MS;
        isRetryable = true;
      } else if (error instanceof ProxyBlockedError) {
        console.warn(`[PollSource][${jobId}] Proxy blocked for ${source.source_name}, backing off 2 hours`);
        nextCheckDelayMs = BACKOFF_CONFIG.PROXY_BLOCKED_MS;
        isRetryable = true;
      } else if (error instanceof ScraperError) {
        if (error.code === 'FORBIDDEN' || error.code === 'CLOUDFLARE_BLOCKED') {
          nextCheckDelayMs = BACKOFF_CONFIG.FORBIDDEN_MS;
        }
        isRetryable = error.isRetryable;
      }
      
      console.error(`[PollSource][${jobId}] Error polling source ${source.id}:`, error);
      
      // v5 Bug 6: On partial failure, only update last_checked_at, NOT last_success_at
      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          last_checked_at: new Date(),
          failure_count: { increment: 1 },
          next_check_at: new Date(Date.now() + nextCheckDelayMs),
          // NOTE: We do NOT update last_success_at here
        }
      });

      // Bug 64: Always re-throw errors to mark job as failed
      // This ensures BullMQ knows the job failed
      throw error;
    }
  } finally {
      // Bug 60: Clear heartbeat when job completes
      clearHeartbeat(jobId);
      // Bug 170-171: Record job end for concurrency tracking
      recordJobEnd('sync-source', sourceName);
      
      // Log final sync status
      if (syncFullySuccessful) {
        logger.info(`[PollSource][${jobId}] Sync completed successfully: ${chaptersProcessed} chapters processed`);
      } else {
        logger.warn(`[PollSource][${jobId}] Sync completed with issues or partial failure`);
      }
    }
  }
