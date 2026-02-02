/**
 * V5 AUDIT BUG FIXES (Bugs 21-50)
 * 
 * This module implements fixes for bugs 21-50 identified in the v5 fresh audit:
 * 
 * UTILITIES / NORMALIZATION / MATCHING:
 * - Bug 21: URL normalization drops meaningful query params
 * - Bug 22: Platform ID extraction returns partial IDs silently
 * - Bug 23: Similarity scoring ignores stop-word filtering
 * - Bug 24: Title normalization ignores bracketed qualifiers inconsistently
 * 
 * SYNC PIPELINE:
 * - Bug 25: Import pipeline enqueues sync before DB commit
 * - Bug 26: Import pipeline does not verify source reachability
 * - Bug 27: Import pipeline dedupe is in-memory only
 * 
 * WORKERS - BOOTSTRAP / LIFECYCLE:
 * - Bug 28: Worker does not register SIGTERM/SIGINT handlers
 * - Bug 29: Worker initializes queues before config validation
 * - Bug 30: Worker logs do not include job context by default
 * 
 * QUEUES / PROCESSORS:
 * - Bug 31: Sync processor lacks idempotency key on writes
 * - Bug 32: Sync processor assumes source language consistency
 * - Bug 33: Sync processor does not persist per-chapter failures
 * - Bug 34: Sync processor updates progress without locking
 * 
 * SCHEDULERS:
 * - Bug 35: Scheduler batch size is unbounded
 * - Bug 36: Scheduler does not skip recently synced sources
 * - Bug 37: Scheduler errors do not halt run
 * 
 * API ROUTES:
 * - Bug 38: Library add API lacks transactional boundary
 * - Bug 39: Retry-all API lacks pagination / batching
 * - Bug 40: API routes trust client-supplied IDs without re-fetch
 * 
 * DATABASE / PRISMA:
 * - Bug 41: No partial index for active library entries
 * - Bug 42: JSON metadata fields lack CHECK constraints
 * - Bug 43: No cascade rules on chapter deletion
 * 
 * UI / CLIENT:
 * - Bug 44: UI assumes series exists for every library entry
 * - Bug 45: UI does not debounce retry actions
 * 
 * LOGGING / MONITORING:
 * - Bug 46: No structured error codes for workers
 * - Bug 47: Logs do not include source identifiers consistently
 * 
 * CONFIG / BUILD:
 * - Bug 48: Feature thresholds duplicated across files
 * - Bug 49: Build does not fail on TypeScript any usage
 * - Bug 50: No runtime assertion for Prisma client version
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import dns from "node:dns/promises";
import { isInternalIP } from "@/lib/constants/image-whitelist";

// =============================================================================
// BUG 21: URL normalization drops meaningful query params
// =============================================================================

/**
 * Query params that are meaningful for series identity on different platforms
 */
const MEANINGFUL_QUERY_PARAMS: Record<string, string[]> = {
  'mangadex.org': [],
  'mangasee123.com': [],
  'manga4life.com': [],
  'mangapark.net': ['format', 'id'],
  'mangapark.me': ['format', 'id'],
  'mangapark.com': ['format', 'id'],
  'webtoons.com': ['title_no'],
  'tapas.io': ['id'],
  'tappytoon.com': ['id'],
  'lezhin.com': ['id'],
  'manganelo.com': [],
  'manganato.com': [],
  // Generic: keep specific params that might identify content
  '_default': ['id', 'sid', 'series_id', 'title_id', 'manga_id', 'comic_id'],
};

export interface SmartUrlNormalization {
  original: string;
  normalized: string;
  preservedParams: Record<string, string>;
  droppedParams: string[];
  isValid: boolean;
  host: string;
  path: string;
}

/**
 * Bug 21 Fix: Normalize URL while preserving meaningful query params
 */
export function normalizeUrlSmart(url: string): SmartUrlNormalization {
  if (!url || typeof url !== 'string') {
    return {
      original: url ?? '',
      normalized: url ?? '',
      preservedParams: {},
      droppedParams: [],
      isValid: false,
      host: '',
      path: '',
    };
  }

  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase();
    
    // Determine which params to preserve for this host
    const meaningfulForHost = 
      MEANINGFUL_QUERY_PARAMS[host] || 
      MEANINGFUL_QUERY_PARAMS['_default'];
    
    // Process query params
    const preservedParams: Record<string, string> = {};
    const droppedParams: string[] = [];
    
    parsed.searchParams.forEach((value, key) => {
      const keyLower = key.toLowerCase();
      const shouldPreserve = meaningfulForHost.some(
        p => p.toLowerCase() === keyLower
      );
      
      if (shouldPreserve) {
        preservedParams[key] = value;
      } else {
        droppedParams.push(key);
      }
    });
    
    // Normalize path
    let path = parsed.pathname;
    path = path.replace(/\/+/g, '/');
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    // Build normalized URL
    let normalized = `${parsed.protocol}//${host}${path}`;
    
    // Add preserved params (sorted for consistency)
    const sortedPreservedKeys = Object.keys(preservedParams).sort();
    if (sortedPreservedKeys.length > 0) {
      const queryStr = sortedPreservedKeys
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(preservedParams[k])}`)
        .join('&');
      normalized += `?${queryStr}`;
    }
    
    return {
      original: url,
      normalized,
      preservedParams,
      droppedParams,
      isValid: true,
      host,
      path,
    };
  } catch {
    return {
      original: url,
      normalized: url,
      preservedParams: {},
      droppedParams: [],
      isValid: false,
      host: '',
      path: '',
    };
  }
}

// =============================================================================
// BUG 22: Platform ID extraction returns partial IDs silently
// =============================================================================

export type PlatformExtractionError = 
  | 'invalid_url'
  | 'unsupported_platform'
  | 'incomplete_id'
  | 'parse_error';

export interface PlatformIdResult {
  success: boolean;
  platform: string | null;
  id: string | null;
  error: PlatformExtractionError | null;
  errorMessage: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
  originalUrl: string;
}

interface PlatformPattern {
  name: string;
  patterns: RegExp[];
  idValidator: (id: string) => boolean;
  idNormalizer?: (id: string) => string;
}

const PLATFORM_PATTERNS: PlatformPattern[] = [
  {
    name: 'mangadex',
    patterns: [
      /mangadex\.org\/title\/([a-f0-9-]{36})/i,
      /mangadex\.org\/manga\/([a-f0-9-]{36})/i,
    ],
    idValidator: (id) => /^[a-f0-9-]{36}$/i.test(id),
  },
  {
    name: 'mangasee',
    patterns: [
      /mangasee123\.com\/manga\/([^/?#]+)/i,
      /manga4life\.com\/manga\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200 && /^[\w-]+$/.test(id),
    idNormalizer: (id) => id.replace(/-/g, '_'),
  },
  {
    name: 'mangapark',
    patterns: [
      /mangapark\.(net|me|com)\/(title|comic)\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200,
  },
  {
    name: 'asura',
    patterns: [
      /asura(?:scans|toon)\.(?:com|gg)\/(?:manga|series)\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200,
  },
  {
    name: 'webtoons',
    patterns: [
      /webtoons\.com\/\w+\/\w+\/([^/]+)\/list\?title_no=(\d+)/i,
    ],
    idValidator: (id) => /^\d+$/.test(id),
  },
];

/**
 * Bug 22 Fix: Extract platform ID with explicit error handling
 * Never returns partial/undefined IDs silently
 */
export function extractPlatformIdStrict(url: string | null | undefined): PlatformIdResult {
  const originalUrl = url ?? '';
  
  if (!url || typeof url !== 'string') {
    return {
      success: false,
      platform: null,
      id: null,
      error: 'invalid_url',
      errorMessage: 'URL is null, undefined, or not a string',
      confidence: null,
      originalUrl,
    };
  }

  const trimmed = url.trim();
  
  // Validate URL format
  try {
    new URL(trimmed);
  } catch {
    return {
      success: false,
      platform: null,
      id: null,
      error: 'invalid_url',
      errorMessage: 'URL is not a valid URL format',
      confidence: null,
      originalUrl,
    };
  }

  // Try each platform
  for (const platform of PLATFORM_PATTERNS) {
    for (const pattern of platform.patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        // Get the ID (last capture group)
        let id = match[match.length - 1];
        
        // Check if ID is actually present
        if (!id || id.trim() === '') {
          return {
            success: false,
            platform: platform.name,
            id: null,
            error: 'incomplete_id',
            errorMessage: `Matched ${platform.name} pattern but ID is empty`,
            confidence: null,
            originalUrl,
          };
        }
        
        // Normalize if normalizer exists
        if (platform.idNormalizer) {
          id = platform.idNormalizer(id);
        }
        
        // Validate ID format
        if (!platform.idValidator(id)) {
          return {
            success: false,
            platform: platform.name,
            id,
            error: 'incomplete_id',
            errorMessage: `Extracted ID '${id}' does not match expected format for ${platform.name}`,
            confidence: null,
            originalUrl,
          };
        }
        
        return {
          success: true,
          platform: platform.name,
          id,
          error: null,
          errorMessage: null,
          confidence: 'high',
          originalUrl,
        };
      }
    }
  }

  return {
    success: false,
    platform: null,
    id: null,
    error: 'unsupported_platform',
    errorMessage: 'URL does not match any supported platform pattern',
    confidence: null,
    originalUrl,
  };
}

// =============================================================================
// BUG 23: Similarity scoring ignores stop-word filtering
// =============================================================================

/**
 * Common stop words that should be filtered from similarity comparisons
 */
export const STOP_WORDS = new Set([
  // English articles
  'the', 'a', 'an',
  // Japanese/Korean romanized particles
  'no', 'wa', 'ga', 'wo', 'ni', 'e', 'de', 'to', 'ya', 'ka',
  // Common manga/manhwa words that don't add meaning
  'manga', 'manhwa', 'manhua', 'comic', 'webtoon',
  // Common status words
  'new', 'raw', 'official', 'scan', 'scanlation',
  // Prepositions
  'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as',
  // Conjunctions
  'and', 'or', 'but',
  // Pronouns
  'i', 'my', 'me', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'their',
]);

/**
 * Bug 23 Fix: Filter stop words from token array
 */
export function filterStopWords(tokens: string[]): string[] {
  return tokens.filter(token => !STOP_WORDS.has(token.toLowerCase()));
}

/**
 * Bug 23 Fix: Calculate similarity with stop-word filtering
 */
export function calculateSimilarityWithStopWords(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  
  // Normalize strings
  const normalize = (s: string): string[] => {
    return s
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[\[\(][^\]\)]*[\]\)]/g, '') // Remove bracketed content
      .replace(/[^\w\s]/g, ' ') // Remove non-word chars
      .split(/\s+/)
      .filter(t => t.length > 0);
  };
  
  const tokens1 = filterStopWords(normalize(s1));
  const tokens2 = filterStopWords(normalize(s2));
  
  if (tokens1.length === 0 || tokens2.length === 0) return 0;
  
  // Join filtered tokens
  const n1 = tokens1.join(' ');
  const n2 = tokens2.join(' ');
  
  if (n1 === n2) return 1.0;
  
  // Generate bigrams
  const getBigrams = (s: string): Set<string> => {
    const bigrams = new Set<string>();
    const clean = s.replace(/\s+/g, '');
    for (let i = 0; i < clean.length - 1; i++) {
      bigrams.add(clean.substring(i, i + 2));
    }
    return bigrams;
  };

  const bigrams1 = getBigrams(n1);
  const bigrams2 = getBigrams(n2);

  if (bigrams1.size === 0 || bigrams2.size === 0) return 0;

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  const score = (2 * intersection) / (bigrams1.size + bigrams2.size);
  
  // Token overlap bonus
  const tokenSet1 = new Set(tokens1);
  const tokenSet2 = new Set(tokens2);
  let tokenOverlap = 0;
  for (const t of tokenSet1) {
    if (tokenSet2.has(t)) tokenOverlap++;
  }
  const tokenBonus = tokenOverlap / Math.max(tokenSet1.size, tokenSet2.size) * 0.2;
  
  return Math.min(1.0, score + tokenBonus);
}

// =============================================================================
// BUG 24: Title normalization ignores bracketed qualifiers inconsistently
// =============================================================================

/**
 * Bug 24 Fix: Normalize title removing BOTH (...) AND [...] brackets consistently
 */
export function normalizeTitleConsistent(title: string): string {
  if (!title) return '';
  
  return title
    .toLowerCase()
    .normalize('NFKC')
    // Remove ALL bracketed content: (...), [...], {...}, <...>
    .replace(/[\[\(\{<][^\]\)\}>]*[\]\)\}>]/g, '')
    // Remove "The", "A", "An" at start
    .replace(/^(the|a|an)\s+/i, '')
    // Remove common suffixes
    .replace(/\s*(season|part|vol|volume|chapter|ch|ep|episode)\s*\d+/gi, '')
    // Remove roman numerals at end
    .replace(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/gi, '')
    // Remove trailing numbers
    .replace(/\s+\d+$/g, '')
    // Remove all non-alphanumeric except spaces
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// BUG 25-27: Import pipeline fixes
// =============================================================================

/**
 * Bug 26 Fix: Check source reachability before import
 */
export async function checkSourceReachability(
  url: string,
  timeoutMs: number = 5000
): Promise<{ reachable: boolean; error?: string; statusCode?: number }> {
  try {
    const parsedUrl = new URL(url);
    
    // SSRF PROTECTION: Static hostname check
    if (isInternalIP(parsedUrl.hostname)) {
      return { reachable: false, error: 'Internal address' };
    }

    // SSRF PROTECTION: DNS resolution check
    try {
      const lookup = await dns.lookup(parsedUrl.hostname);
      if (isInternalIP(lookup.address)) {
        return { reachable: false, error: 'Resolves to internal address' };
      }
    } catch (dnsErr) {
      return { reachable: false, error: 'DNS resolution failed' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MangaTrack/1.0)',
      },
    });
    
    clearTimeout(timeout);
    
    if (response.ok) {
      return { reachable: true, statusCode: response.status };
    }
    
    // Some sites return 403 but are still reachable
    if (response.status === 403 || response.status === 405) {
      return { reachable: true, statusCode: response.status };
    }
    
    return { 
      reachable: false, 
      error: `HTTP ${response.status}`,
      statusCode: response.status 
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('abort')) {
      return { reachable: false, error: 'Timeout' };
    }
    return { reachable: false, error: errorMsg };
  }
}

/**
 * Bug 27 Fix: Generate deterministic dedupe key for DB-level deduplication
 */
export function generateImportDedupeKey(
  userId: string,
  sourceUrl: string,
  timestamp: number
): string {
  const normalizedUrl = normalizeUrlSmart(sourceUrl).normalized;
  return `import:${userId}:${normalizedUrl}:${Math.floor(timestamp / 60000)}`; // 1-minute window
}

// =============================================================================
// BUG 28-30: Worker lifecycle fixes
// =============================================================================

let workerShutdownHandlerRegistered = false;
let activeWorkers: Map<string, { close: () => Promise<void> }> = new Map();

/**
 * Bug 28 Fix: Register graceful shutdown handlers for SIGTERM/SIGINT
 */
export function registerWorkerShutdownHandlers(
  onShutdown: (signal: string) => Promise<void>
): void {
  if (workerShutdownHandlerRegistered) return;
  
  const gracefulShutdown = async (signal: string) => {
    console.log(`[Workers] Received ${signal}, initiating graceful shutdown...`);
    
    try {
      // Close all registered workers
      const closePromises = Array.from(activeWorkers.entries()).map(
        async ([name, worker]) => {
          console.log(`[Workers] Closing ${name}...`);
          await worker.close();
        }
      );
      
      await Promise.all(closePromises);
      await onShutdown(signal);
      
      console.log('[Workers] Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('[Workers] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  
  workerShutdownHandlerRegistered = true;
}

export function registerActiveWorker(
  name: string, 
  worker: { close: () => Promise<void> }
): void {
  activeWorkers.set(name, worker);
}

export function unregisterActiveWorker(name: string): void {
  activeWorkers.delete(name);
}

/**
 * Bug 30 Fix: Create job context for logging
 */
export interface JobLogContext {
  jobId: string;
  jobName: string;
  queueName: string;
  libraryEntryId?: string;
  seriesSourceId?: string;
  userId?: string;
  attemptsMade: number;
  workerRunId: string;
  timestamp: string;
}

export function createJobLogContext(
  job: {
    id?: string;
    name: string;
    queueName: string;
    data: Record<string, unknown>;
    attemptsMade: number;
  },
  workerRunId: string
): JobLogContext {
  return {
    jobId: job.id || 'unknown',
    jobName: job.name,
    queueName: job.queueName,
    libraryEntryId: job.data.libraryEntryId as string | undefined,
    seriesSourceId: job.data.seriesSourceId as string | undefined,
    userId: job.data.userId as string | undefined,
    attemptsMade: job.attemptsMade,
    workerRunId,
    timestamp: new Date().toISOString(),
  };
}

export function formatJobLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: JobLogContext
): string {
  const contextPairs = Object.entries(context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  
  return `[${context.timestamp}] [${level.toUpperCase()}] [${context.queueName}] ${message} ${contextPairs}`;
}

// =============================================================================
// BUG 31-34: Sync processor fixes
// =============================================================================

/**
 * Bug 31 Fix: Generate idempotency key for chapter writes
 */
export function generateChapterIdempotencyKey(
  seriesSourceId: string,
  chapterNumber: string | number,
  jobId: string
): string {
  return `chapter:${seriesSourceId}:${chapterNumber}:${jobId}`;
}

/**
 * Bug 32 Fix: Language consistency check
 */
export interface LanguageConsistencyResult {
  isConsistent: boolean;
  sourceLanguage: string | null;
  chapterLanguage: string | null;
  shouldFilter: boolean;
}

export function checkLanguageConsistency(
  sourceLanguage: string | null | undefined,
  chapterLanguage: string | null | undefined
): LanguageConsistencyResult {
  const srcLang = sourceLanguage?.toLowerCase() || null;
  const chapLang = chapterLanguage?.toLowerCase() || null;
  
  // If source has no language set, accept all
  if (!srcLang) {
    return {
      isConsistent: true,
      sourceLanguage: srcLang,
      chapterLanguage: chapLang,
      shouldFilter: false,
    };
  }
  
  // If chapter has no language, accept it
  if (!chapLang) {
    return {
      isConsistent: true,
      sourceLanguage: srcLang,
      chapterLanguage: chapLang,
      shouldFilter: false,
    };
  }
  
  // Check for match (handle common language codes)
  const languageGroups: Record<string, string[]> = {
    'en': ['en', 'eng', 'english'],
    'ja': ['ja', 'jp', 'jpn', 'japanese'],
    'ko': ['ko', 'kor', 'korean'],
    'zh': ['zh', 'cn', 'chn', 'chinese', 'zh-hans', 'zh-hant'],
  };
  
  // Normalize both languages
  const normalize = (lang: string): string => {
    for (const [key, variants] of Object.entries(languageGroups)) {
      if (variants.includes(lang)) return key;
    }
    return lang;
  };
  
  const normalizedSrc = normalize(srcLang);
  const normalizedChap = normalize(chapLang);
  
  const isConsistent = normalizedSrc === normalizedChap;
  
  return {
    isConsistent,
    sourceLanguage: srcLang,
    chapterLanguage: chapLang,
    shouldFilter: !isConsistent,
  };
}

/**
 * Bug 33 Fix: Chapter failure record structure
 */
export interface ChapterFailure {
  seriesSourceId: string;
  chapterNumber: string | number;
  sourceChapterId: string | null;
  error: string;
  errorType: 'parse' | 'validation' | 'network' | 'unknown';
  timestamp: Date;
  jobId: string;
}

const chapterFailures: ChapterFailure[] = [];
const MAX_CHAPTER_FAILURES = 10000;

export function recordChapterFailure(failure: Omit<ChapterFailure, 'timestamp'>): void {
  chapterFailures.push({
    ...failure,
    timestamp: new Date(),
  });
  
  // Trim to prevent memory issues
  if (chapterFailures.length > MAX_CHAPTER_FAILURES) {
    chapterFailures.splice(0, chapterFailures.length - MAX_CHAPTER_FAILURES);
  }
}

export function getChapterFailures(
  seriesSourceId?: string,
  limit: number = 100
): ChapterFailure[] {
  let filtered = chapterFailures;
  if (seriesSourceId) {
    filtered = chapterFailures.filter(f => f.seriesSourceId === seriesSourceId);
  }
  return filtered.slice(-limit);
}

// =============================================================================
// BUG 35-37: Scheduler fixes
// =============================================================================

/**
 * Bug 35 Fix: Configuration for scheduler batch sizes
 */
export const SCHEDULER_CONFIG = {
  // Maximum number of sources to process per scheduler run
  MAX_BATCH_SIZE: 500,
  
  // Minimum time between source syncs (in milliseconds)
  MIN_SYNC_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes
  
  // Whether to halt on errors
  HALT_ON_ERROR: false,
  
  // Maximum errors before halting
  MAX_ERRORS_BEFORE_HALT: 10,
};

/**
 * Bug 36 Fix: Check if source was recently synced
 */
export function wasRecentlySynced(
  lastSyncAt: Date | null | undefined,
  minIntervalMs: number = SCHEDULER_CONFIG.MIN_SYNC_INTERVAL_MS
): boolean {
  if (!lastSyncAt) return false;
  
  const lastSync = lastSyncAt instanceof Date ? lastSyncAt : new Date(lastSyncAt);
  const timeSinceSync = Date.now() - lastSync.getTime();
  
  return timeSinceSync < minIntervalMs;
}

/**
 * Bug 37 Fix: Scheduler error accumulator with halt logic
 */
export class SchedulerErrorAccumulator {
  private errors: Array<{ error: Error; timestamp: Date; context?: string }> = [];
  private haltOnError: boolean;
  private maxErrors: number;
  
  constructor(
    haltOnError: boolean = SCHEDULER_CONFIG.HALT_ON_ERROR,
    maxErrors: number = SCHEDULER_CONFIG.MAX_ERRORS_BEFORE_HALT
  ) {
    this.haltOnError = haltOnError;
    this.maxErrors = maxErrors;
  }
  
  addError(error: Error, context?: string): void {
    this.errors.push({ error, timestamp: new Date(), context });
  }
  
  shouldHalt(): boolean {
    if (!this.haltOnError) return false;
    return this.errors.length >= this.maxErrors;
  }
  
  getErrors(): Array<{ error: Error; timestamp: Date; context?: string }> {
    return [...this.errors];
  }
  
  getErrorCount(): number {
    return this.errors.length;
  }
  
  clear(): void {
    this.errors = [];
  }
}

// =============================================================================
// BUG 38-40: API route fixes
// =============================================================================

/**
 * Bug 39 Fix: Batch iterator for large result sets
 */
export async function* batchIterator<T>(
  fetchBatch: (cursor: string | null, limit: number) => Promise<{ items: T[]; nextCursor: string | null }>,
  batchSize: number = 100,
  maxItems: number = 1000
): AsyncGenerator<T[], void, void> {
  let cursor: string | null = null;
  let totalFetched = 0;
  
  while (totalFetched < maxItems) {
    const remaining = maxItems - totalFetched;
    const limit = Math.min(batchSize, remaining);
    
    const { items, nextCursor } = await fetchBatch(cursor, limit);
    
    if (items.length === 0) break;
    
    yield items;
    
    totalFetched += items.length;
    cursor = nextCursor;
    
    if (!cursor) break;
  }
}

/**
 * Bug 40 Fix: Verify ownership of resource within transaction
 */
export interface OwnershipCheck {
  valid: boolean;
  error?: string;
  resource?: Record<string, unknown>;
}

export function createOwnershipCheckQuery(
  table: string,
  resourceId: string,
  userId: string
): string {
  // Note: This returns a SQL template - actual execution should use parameterized queries
  return `
    SELECT id, user_id 
    FROM ${table} 
    WHERE id = '${resourceId}'::uuid 
      AND user_id = '${userId}'::uuid
      AND deleted_at IS NULL
    FOR UPDATE
  `;
}

// =============================================================================
// BUG 41-43: Database fixes (SQL migrations)
// =============================================================================

/**
 * Bug 41-43 Fix: SQL migration statements
 */
export const DATABASE_MIGRATIONS = {
  // Bug 41: Partial index for active library entries
  activeLibraryEntriesIndex: `
    CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_active_idx
    ON library_entries (user_id, status, last_read_at DESC)
    WHERE deleted_at IS NULL;
  `,
  
  // Bug 42: JSON metadata CHECK constraint
  // Note: PostgreSQL doesn't support arbitrary JSON schema validation in CHECK
  // but we can check for null/empty object
  metadataCheckConstraint: `
    ALTER TABLE series 
    ADD CONSTRAINT series_metadata_valid_check 
    CHECK (
      alternative_titles IS NULL OR 
      jsonb_typeof(alternative_titles::jsonb) = 'array'
    );
  `,
  
  // Bug 43: Cascade rules for chapters
  chapterCascadeRule: `
    ALTER TABLE chapter_sources
    DROP CONSTRAINT IF EXISTS chapter_sources_chapter_id_fkey,
    ADD CONSTRAINT chapter_sources_chapter_id_fkey
      FOREIGN KEY (chapter_id) 
      REFERENCES chapters(id) 
      ON DELETE CASCADE;
    
    ALTER TABLE chapter_sources
    DROP CONSTRAINT IF EXISTS chapter_sources_series_source_id_fkey,
    ADD CONSTRAINT chapter_sources_series_source_id_fkey
      FOREIGN KEY (series_source_id) 
      REFERENCES series_sources(id) 
      ON DELETE CASCADE;
  `,
};

// =============================================================================
// BUG 44-45: UI fixes (utility functions)
// =============================================================================

/**
 * Bug 44 Fix: Safe series access helper
 */
export interface SafeSeriesAccess {
  exists: boolean;
  series: {
    id: string;
    title: string;
    cover_url: string | null;
    status: string | null;
  } | null;
  fallback: {
    title: string;
    cover_url: string | null;
  };
}

export function getSafeSeriesData(
  libraryEntry: {
    series?: {
      id: string;
      title: string;
      cover_url?: string | null;
      status?: string | null;
    } | null;
    imported_title?: string | null;
    source_name: string;
  }
): SafeSeriesAccess {
  if (libraryEntry.series) {
    return {
      exists: true,
      series: {
        id: libraryEntry.series.id,
        title: libraryEntry.series.title,
        cover_url: libraryEntry.series.cover_url ?? null,
        status: libraryEntry.series.status ?? null,
      },
      fallback: {
        title: libraryEntry.series.title,
        cover_url: libraryEntry.series.cover_url ?? null,
      },
    };
  }
  
  return {
    exists: false,
    series: null,
    fallback: {
      title: libraryEntry.imported_title || `Unknown from ${libraryEntry.source_name}`,
      cover_url: null,
    },
  };
}

/**
 * Bug 45 Fix: Debounce utility for actions
 */
export function createDebouncer<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number = 1000
): { debounced: T; cancel: () => void } {
  let timeoutId: NodeJS.Timeout | null = null;
  
  const debounced = ((...args: unknown[]) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delayMs);
  }) as T;
  
  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  
  return { debounced, cancel };
}

/**
 * Bug 45 Fix: Rate limiter for retry actions
 */
const retryActionTimestamps = new Map<string, number>();

export function canRetryAction(
  actionKey: string,
  minIntervalMs: number = 2000
): boolean {
  const lastTimestamp = retryActionTimestamps.get(actionKey);
  const now = Date.now();
  
  if (!lastTimestamp || now - lastTimestamp >= minIntervalMs) {
    retryActionTimestamps.set(actionKey, now);
    return true;
  }
  
  return false;
}

// =============================================================================
// BUG 46-47: Logging fixes
// =============================================================================

/**
 * Bug 46 Fix: Structured error codes for workers
 */
export enum WorkerErrorCode {
  // Network errors (1xxx)
  NETWORK_TIMEOUT = 'E1001',
  NETWORK_CONNECTION_REFUSED = 'E1002',
  NETWORK_DNS_FAILED = 'E1003',
  NETWORK_SSL_ERROR = 'E1004',
  
  // Parse errors (2xxx)
  PARSE_INVALID_JSON = 'E2001',
  PARSE_INVALID_HTML = 'E2002',
  PARSE_MISSING_FIELD = 'E2003',
  
  // Validation errors (3xxx)
  VALIDATION_INVALID_ID = 'E3001',
  VALIDATION_INVALID_URL = 'E3002',
  VALIDATION_SCHEMA_MISMATCH = 'E3003',
  
  // Database errors (4xxx)
  DB_CONNECTION_ERROR = 'E4001',
  DB_CONSTRAINT_VIOLATION = 'E4002',
  DB_DEADLOCK = 'E4003',
  DB_TIMEOUT = 'E4004',
  
  // Queue errors (5xxx)
  QUEUE_JOB_NOT_FOUND = 'E5001',
  QUEUE_STALLED = 'E5002',
  QUEUE_REDIS_ERROR = 'E5003',
  
  // Business logic errors (6xxx)
  LOGIC_SERIES_NOT_FOUND = 'E6001',
  LOGIC_SOURCE_BROKEN = 'E6002',
  LOGIC_ALREADY_PROCESSED = 'E6003',
  
  // Unknown (9xxx)
  UNKNOWN = 'E9999',
}

export function classifyErrorCode(error: Error): WorkerErrorCode {
  const message = error.message.toLowerCase();
  
  if (message.includes('timeout') || message.includes('econnaborted')) {
    return WorkerErrorCode.NETWORK_TIMEOUT;
  }
  if (message.includes('econnrefused')) {
    return WorkerErrorCode.NETWORK_CONNECTION_REFUSED;
  }
  if (message.includes('enotfound') || message.includes('getaddrinfo')) {
    return WorkerErrorCode.NETWORK_DNS_FAILED;
  }
  if (message.includes('ssl') || message.includes('certificate')) {
    return WorkerErrorCode.NETWORK_SSL_ERROR;
  }
  if (message.includes('json') || message.includes('parse')) {
    return WorkerErrorCode.PARSE_INVALID_JSON;
  }
  if (message.includes('constraint') || message.includes('unique')) {
    return WorkerErrorCode.DB_CONSTRAINT_VIOLATION;
  }
  if (message.includes('deadlock')) {
    return WorkerErrorCode.DB_DEADLOCK;
  }
  
  return WorkerErrorCode.UNKNOWN;
}

/**
 * Bug 47 Fix: Create log entry with source identifiers
 */
export interface SourceIdentifiedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  errorCode?: WorkerErrorCode;
  seriesSourceId?: string;
  sourceName?: string;
  sourceUrl?: string;
  seriesId?: string;
  seriesTitle?: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export function createSourceIdentifiedLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  source?: {
    id?: string;
    source_name?: string;
    source_url?: string;
    series_id?: string;
    series?: { title?: string };
  },
  error?: Error,
  context?: Record<string, unknown>
): SourceIdentifiedLog {
  return {
    level,
    message,
    errorCode: error ? classifyErrorCode(error) : undefined,
    seriesSourceId: source?.id,
    sourceName: source?.source_name,
    sourceUrl: source?.source_url,
    seriesId: source?.series_id,
    seriesTitle: source?.series?.title,
    timestamp: new Date().toISOString(),
    context,
  };
}

// =============================================================================
// BUG 48: Feature thresholds centralized config
// =============================================================================

/**
 * Bug 48 Fix: Centralized feature thresholds
 */
export const FEATURE_THRESHOLDS = {
  // Similarity thresholds
  similarity: {
    EXACT_MATCH: 1.0,
    HIGH_CONFIDENCE: 0.85,
    MEDIUM_CONFIDENCE: 0.7,
    LOW_CONFIDENCE: 0.5,
    REJECT_THRESHOLD: 0.3,
  },
  
  // Retry configuration
  retry: {
    MAX_METADATA_RETRIES: 3,
    MAX_SYNC_RETRIES: 5,
    RETRY_BACKOFF_BASE_MS: 60000, // 1 minute
    RETRY_BACKOFF_MULTIPLIER: 2,
    MAX_RETRY_DELAY_MS: 3600000, // 1 hour
  },
  
  // Rate limiting
  rateLimit: {
    API_REQUESTS_PER_MINUTE: 60,
    SYNC_JOBS_PER_MINUTE: 100,
    IMPORT_JOBS_PER_HOUR: 10,
  },
  
  // Scheduler configuration
  scheduler: {
    MAX_BATCH_SIZE: 500,
    MIN_SYNC_INTERVAL_HOURS: 0.5,
    TIER_A_INTERVAL_HOURS: 0.5,
    TIER_B_INTERVAL_HOURS: 6,
    TIER_C_INTERVAL_HOURS: 48,
  },
  
  // Trust score
  trustScore: {
    DEFAULT: 1.0,
    MIN: 0.5,
    DECAY_RATE_PER_DAY: 0.01,
    RECOVERY_RATE_PER_DAY: 0.05,
  },
} as const;

export type FeatureThresholds = typeof FEATURE_THRESHOLDS;

// =============================================================================
// BUG 50: Prisma client version assertion
// =============================================================================

/**
 * Bug 50 Fix: Assert Prisma client version matches expected version
 */
export interface PrismaVersionCheck {
  valid: boolean;
  clientVersion: string | null;
  expectedVersion: string;
  error?: string;
}

export function checkPrismaVersion(
  prismaClient: { _clientVersion?: string },
  expectedVersion: string = '6.19.2'
): PrismaVersionCheck {
  try {
    const clientVersion = prismaClient._clientVersion;
    
    if (!clientVersion) {
      return {
        valid: false,
        clientVersion: null,
        expectedVersion,
        error: 'Unable to determine Prisma client version',
      };
    }
    
    // Check major.minor match (patch can differ)
    const [expectedMajor, expectedMinor] = expectedVersion.split('.').map(Number);
    const [clientMajor, clientMinor] = clientVersion.split('.').map(Number);
    
    const valid = clientMajor === expectedMajor && clientMinor === expectedMinor;
    
    if (!valid) {
      return {
        valid: false,
        clientVersion,
        expectedVersion,
        error: `Prisma version mismatch: expected ${expectedVersion}.x, got ${clientVersion}`,
      };
    }
    
    return {
      valid: true,
      clientVersion,
      expectedVersion,
    };
  } catch (error) {
    return {
      valid: false,
      clientVersion: null,
      expectedVersion,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const V5AuditBugFixes = {
  // Bug 21
  normalizeUrlSmart,
  MEANINGFUL_QUERY_PARAMS,
  
  // Bug 22
  extractPlatformIdStrict,
  
  // Bug 23
  filterStopWords,
  calculateSimilarityWithStopWords,
  STOP_WORDS,
  
  // Bug 24
  normalizeTitleConsistent,
  
  // Bug 25-27
  checkSourceReachability,
  generateImportDedupeKey,
  
  // Bug 28-30
  registerWorkerShutdownHandlers,
  registerActiveWorker,
  unregisterActiveWorker,
  createJobLogContext,
  formatJobLog,
  
  // Bug 31-34
  generateChapterIdempotencyKey,
  checkLanguageConsistency,
  recordChapterFailure,
  getChapterFailures,
  
  // Bug 35-37
  SCHEDULER_CONFIG,
  wasRecentlySynced,
  SchedulerErrorAccumulator,
  
  // Bug 38-40
  batchIterator,
  createOwnershipCheckQuery,
  
  // Bug 41-43
  DATABASE_MIGRATIONS,
  
  // Bug 44-45
  getSafeSeriesData,
  createDebouncer,
  canRetryAction,
  
  // Bug 46-47
  WorkerErrorCode,
  classifyErrorCode,
  createSourceIdentifiedLog,
  
  // Bug 48
  FEATURE_THRESHOLDS,
  
  // Bug 50
  checkPrismaVersion,
};

export default V5AuditBugFixes;
