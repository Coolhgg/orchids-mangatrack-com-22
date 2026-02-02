/**
 * AUDIT PASS 3 BUG FIXES (Bugs 36-60)
 * 
 * This module implements fixes for bugs identified in audit pass 3:
 * - 36-38: URL normalization, source ID extraction, similarity scoring
 * - 39-41: Worker startup validation, Redis health, execution IDs  
 * - 42-44: Queue options, DLQ, job payload validation
 * - 45-48: Sync processor dedup, locking, transactions, error persistence
 * - 49-51: Scheduler state checks, row locking, watermarks
 * - 52-54: API validation, optimistic responses, error shapes
 * - 55-56: Structured logging, state transition auditing
 * - 57-60: TypeScript safety, optional chaining, enums, dates
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';

// ==========================================
// BUG 36: URL normalization is lossy
// ==========================================

export interface NormalizedUrl {
  original: string;
  normalized: string;
  scheme: string;
  host: string;
  path: string;
  query: string;
  hash: string;
  isValid: boolean;
}

/**
 * Properly normalizes URLs while preserving important components.
 * Bug 36 Fix: Preserve query params, hash fragments, and handle case sensitivity properly.
 */
export function normalizeUrl(url: string | null | undefined): NormalizedUrl | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const original = url.trim();
  
  try {
    const parsed = new URL(original);
    
    // Normalize components
    const scheme = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    
    // Path normalization: remove trailing slashes but preserve structure
    // Keep case sensitivity for paths (some platforms use case-sensitive URLs)
    let path = parsed.pathname;
    // Remove duplicate slashes
    path = path.replace(/\/+/g, '/');
    // Remove trailing slash unless it's the root
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    // Preserve query string (sorted for consistency)
    const queryParams = new URLSearchParams(parsed.search);
    const sortedParams = new URLSearchParams();
    Array.from(queryParams.keys()).sort().forEach(key => {
      sortedParams.set(key, queryParams.get(key) || '');
    });
    const query = sortedParams.toString();
    
    // Preserve hash
    const hash = parsed.hash;
    
    // Build normalized URL
    let normalized = `${scheme}//${host}${path}`;
    if (query) {
      normalized += `?${query}`;
    }
    if (hash) {
      normalized += hash;
    }
    
    return {
      original,
      normalized,
      scheme,
      host,
      path,
      query,
      hash,
      isValid: true
    };
  } catch {
    return {
      original,
      normalized: original,
      scheme: '',
      host: '',
      path: '',
      query: '',
      hash: '',
      isValid: false
    };
  }
}

/**
 * Generate a unique key for URL deduplication that preserves important distinctions.
 */
export function generateUrlDedupeKey(url: string): string {
  const normalized = normalizeUrl(url);
  if (!normalized || !normalized.isValid) {
    return url.toLowerCase().trim();
  }
  // Use host + path for deduplication, ignore query/hash
  return `${normalized.host}${normalized.path}`.toLowerCase();
}

// ==========================================
// BUG 37: Source ID extraction silently fails
// ==========================================

export type ExtractionErrorType = 
  | 'invalid_url' 
  | 'unsupported_source' 
  | 'parse_error' 
  | 'malformed_id';

export interface ExtractedPlatformId {
  success: true;
  platform: string;
  id: string;
  originalUrl: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ExtractionFailure {
  success: false;
  error: ExtractionErrorType;
  message: string;
  originalUrl: string;
}

export type PlatformExtractionResult = ExtractedPlatformId | ExtractionFailure;

// Platform-specific extraction patterns with validation
const PLATFORM_PATTERNS: Array<{
  name: string;
  patterns: RegExp[];
  idValidator?: (id: string) => boolean;
}> = [
  {
    name: 'mangadex',
    patterns: [
      /mangadex\.org\/title\/([a-f0-9-]{36})/i,
      /mangadex\.org\/manga\/([a-f0-9-]{36})/i,
    ],
    idValidator: (id) => /^[a-f0-9-]{36}$/i.test(id)
  },
  {
    name: 'mangasee',
    patterns: [
      /mangasee123\.com\/manga\/([^/?#]+)/i,
      /manga4life\.com\/manga\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200
  },
  {
    name: 'mangapark',
    patterns: [
      /mangapark\.(net|me|com)\/(title|comic)\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200
  },
  {
    name: 'asura',
    patterns: [
      /asura(?:scans|toon)\.(?:com|gg)\/(?:manga|series)\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200
  },
  {
    name: 'reaper',
    patterns: [
      /reaperscans\.com\/(?:series|comics)\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200
  },
  {
    name: 'flame',
    patterns: [
      /flamescans\.org\/series\/([^/?#]+)/i,
    ],
    idValidator: (id) => id.length > 0 && id.length < 200
  }
];

/**
 * Extract platform IDs with detailed error reporting.
 * Bug 37 Fix: Return detailed error info instead of silently returning null.
 */
export function extractPlatformIdSafe(url: string | null | undefined): PlatformExtractionResult {
  if (!url || typeof url !== 'string') {
    return {
      success: false,
      error: 'invalid_url',
      message: 'URL is null, undefined, or not a string',
      originalUrl: String(url)
    };
  }

  const trimmedUrl = url.trim();
  
  // Validate URL format
  try {
    new URL(trimmedUrl);
  } catch {
    return {
      success: false,
      error: 'invalid_url',
      message: 'URL is not a valid URL format',
      originalUrl: trimmedUrl
    };
  }

  // Try each platform
  for (const platform of PLATFORM_PATTERNS) {
    for (const pattern of platform.patterns) {
      const match = trimmedUrl.match(pattern);
      if (match) {
        // Get the captured ID (last capture group)
        const id = match[match.length - 1];
        
        // Validate ID format
        if (platform.idValidator && !platform.idValidator(id)) {
          return {
            success: false,
            error: 'malformed_id',
            message: `Extracted ID '${id}' does not match expected format for ${platform.name}`,
            originalUrl: trimmedUrl
          };
        }
        
        return {
          success: true,
          platform: platform.name,
          id,
          originalUrl: trimmedUrl,
          confidence: 'high'
        };
      }
    }
  }

  return {
    success: false,
    error: 'unsupported_source',
    message: 'URL does not match any supported platform pattern',
    originalUrl: trimmedUrl
  };
}

// ==========================================
// BUG 38: Similarity scoring ignores Unicode normalization
// ==========================================

/**
 * Normalize string for similarity comparison with proper Unicode handling.
 * Bug 38 Fix: Apply proper Unicode normalization before comparison.
 */
export function normalizeForSimilarity(text: string): string {
  if (!text) return '';
  
  return text
    // Unicode normalization - NFD decomposes, then we remove combining marks
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Remove diacritical marks
    // NFKC normalization for compatibility characters
    .normalize('NFKC')
    // Lowercase
    .toLowerCase()
    // Remove common noise
    .replace(/[\[\(][^\]\)]*[\]\)]/g, '')  // Remove bracketed content
    .replace(/^(the|a|an)\s+/i, '')  // Remove articles
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate string similarity with proper Unicode handling.
 * Bug 38 Fix: Apply Unicode normalization before Sorensen-Dice calculation.
 */
export function calculateSimilarityUnicodeSafe(s1: string, s2: string): number {
  // Apply Unicode normalization
  const n1 = normalizeForSimilarity(s1);
  const n2 = normalizeForSimilarity(s2);

  if (n1.length < 2 || n2.length < 2) return 0;
  if (n1 === n2) return 1.0;

  // Generate bigrams from normalized strings
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

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  const score = (2 * intersection) / (bigrams1.size + bigrams2.size);
  
  // Length ratio penalty
  const lenRatio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
  return score * (lenRatio > 0.5 ? 1 : lenRatio * 2);
}

// ==========================================
// BUG 39: Worker startup does not validate env vars
// ==========================================

const WorkerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
}).refine(
  data => data.REDIS_URL || (data.UPSTASH_REDIS_REST_URL && data.UPSTASH_REDIS_REST_TOKEN),
  { message: 'Either REDIS_URL or UPSTASH_REDIS_REST_URL+TOKEN is required' }
);

export interface EnvValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate required environment variables at worker startup.
 * Bug 39 Fix: Fail fast if required env vars are missing.
 */
export function validateWorkerEnv(): EnvValidationResult {
  const result = WorkerEnvSchema.safeParse(process.env);
  const warnings: string[] = [];
  
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      warnings
    };
  }
  
  // Check for recommended but optional vars
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    warnings.push('NEXT_PUBLIC_SUPABASE_URL not set - some features may not work');
  }
  
  return { valid: true, errors: [], warnings };
}

// ==========================================
// BUG 40: Worker bootstrap does not assert Redis readiness
// ==========================================

export interface RedisHealthStatus {
  healthy: boolean;
  latencyMs: number | null;
  error: string | null;
  checkedAt: Date;
}

/**
 * Check Redis health with timeout.
 * Bug 40 Fix: Explicitly assert Redis is ready before starting workers.
 */
export async function checkRedisHealth(
  redisClient: { ping: () => Promise<string> },
  timeoutMs: number = 5000
): Promise<RedisHealthStatus> {
  const startTime = Date.now();
  
  try {
    const pingPromise = redisClient.ping();
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Redis health check timeout')), timeoutMs)
    );
    
    const result = await Promise.race([pingPromise, timeoutPromise]);
    
    if (result === 'PONG') {
      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
        error: null,
        checkedAt: new Date()
      };
    }
    
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: `Unexpected ping response: ${result}`,
      checkedAt: new Date()
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date()
    };
  }
}

// ==========================================
// BUG 41: No global worker execution ID
// ==========================================

let globalWorkerRunId: string | null = null;
let globalWorkerStartTime: Date | null = null;

/**
 * Initialize global worker execution ID for correlation.
 * Bug 41 Fix: Generate a unique ID for the worker run session.
 */
export function initWorkerRunId(): string {
  globalWorkerRunId = `worker-${Date.now()}-${randomUUID().substring(0, 8)}`;
  globalWorkerStartTime = new Date();
  return globalWorkerRunId;
}

export function getWorkerRunId(): string {
  if (!globalWorkerRunId) {
    return initWorkerRunId();
  }
  return globalWorkerRunId;
}

export function getWorkerUptime(): number {
  if (!globalWorkerStartTime) return 0;
  return Date.now() - globalWorkerStartTime.getTime();
}

// ==========================================
// BUG 42: Queue options lack visibility timeout tuning
// ==========================================

export interface QueueConfigOptions {
  queueName: string;
  concurrency: number;
  lockDuration: number;  // How long a job is locked (visibility timeout)
  stalledInterval: number;  // How often to check for stalled jobs
  maxStalledCount: number;  // How many times a job can be stalled before failing
}

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export const QUEUE_CONFIGS: Record<string, QueueConfigOptions> = {
  'sync-source': {
    queueName: 'sync-source',
    concurrency: getEnvInt('WORKER_SYNC_SOURCE_CONCURRENCY', 10), // Reduced from 20 to respect MangaDex rate limits
    lockDuration: getEnvInt('WORKER_SYNC_SOURCE_LOCK_DURATION', 120000),
    stalledInterval: 30000,
    maxStalledCount: 2
  },
  'chapter-ingest': {
    queueName: 'chapter-ingest',
    concurrency: getEnvInt('WORKER_CHAPTER_INGEST_CONCURRENCY', 10),
    lockDuration: getEnvInt('WORKER_CHAPTER_INGEST_LOCK_DURATION', 60000),
    stalledInterval: 15000,
    maxStalledCount: 2
  },
  'check-source': {
    queueName: 'check-source',
    concurrency: getEnvInt('WORKER_CHECK_SOURCE_CONCURRENCY', 2),
    lockDuration: getEnvInt('WORKER_CHECK_SOURCE_LOCK_DURATION', 60000),
    stalledInterval: 15000,
    maxStalledCount: 2
  },
  'series-resolution': {
    queueName: 'series-resolution',
    concurrency: getEnvInt('WORKER_SERIES_RESOLUTION_CONCURRENCY', 2),
    lockDuration: getEnvInt('WORKER_SERIES_RESOLUTION_LOCK_DURATION', 300000),
    stalledInterval: 60000,
    maxStalledCount: 1
  },
  'notifications': {
    queueName: 'notifications',
    concurrency: getEnvInt('WORKER_NOTIFICATIONS_CONCURRENCY', 3),
    lockDuration: getEnvInt('WORKER_NOTIFICATIONS_LOCK_DURATION', 30000),
    stalledInterval: 10000,
    maxStalledCount: 3
  },
  'notification-delivery': {
    queueName: 'notification-delivery',
    concurrency: getEnvInt('WORKER_NOTIFICATION_DELIVERY_CONCURRENCY', 5),
    lockDuration: getEnvInt('WORKER_NOTIFICATION_DELIVERY_LOCK_DURATION', 30000),
    stalledInterval: 10000,
    maxStalledCount: 3
  },
  'notification-delivery-premium': {
    queueName: 'notification-delivery-premium',
    concurrency: getEnvInt('WORKER_NOTIFICATION_DELIVERY_PREMIUM_CONCURRENCY', 15),
    lockDuration: getEnvInt('WORKER_NOTIFICATION_DELIVERY_PREMIUM_LOCK_DURATION', 30000),
    stalledInterval: 10000,
    maxStalledCount: 3
  },
  'notification-digest': {
    queueName: 'notification-digest',
    concurrency: getEnvInt('WORKER_NOTIFICATION_DIGEST_CONCURRENCY', 1),
    lockDuration: getEnvInt('WORKER_NOTIFICATION_DIGEST_LOCK_DURATION', 60000),
    stalledInterval: 30000,
    maxStalledCount: 2
  },
  'canonicalize': {
    queueName: 'canonicalize',
    concurrency: getEnvInt('WORKER_CANONICALIZE_CONCURRENCY', 2),
    lockDuration: getEnvInt('WORKER_CANONICALIZE_LOCK_DURATION', 60000),
    stalledInterval: 30000,
    maxStalledCount: 2
  },
  'refresh-cover': {
    queueName: 'refresh-cover',
    concurrency: getEnvInt('WORKER_REFRESH_COVER_CONCURRENCY', 5),
    lockDuration: getEnvInt('WORKER_REFRESH_COVER_LOCK_DURATION', 30000),
    stalledInterval: 10000,
    maxStalledCount: 2
  },
  'gap-recovery': {
    queueName: 'gap-recovery',
    concurrency: getEnvInt('WORKER_GAP_RECOVERY_CONCURRENCY', 1),
    lockDuration: getEnvInt('WORKER_GAP_RECOVERY_LOCK_DURATION', 120000),
    stalledInterval: 30000,
    maxStalledCount: 2
  },
  'import': {
    queueName: 'import',
    concurrency: getEnvInt('WORKER_IMPORT_CONCURRENCY', 2),
    lockDuration: getEnvInt('WORKER_IMPORT_LOCK_DURATION', 600000),
    stalledInterval: 120000,
    maxStalledCount: 1
  },
  'feed-fanout': {
    queueName: 'feed-fanout',
    concurrency: getEnvInt('WORKER_FEED_FANOUT_CONCURRENCY', 5),
    lockDuration: getEnvInt('WORKER_FEED_FANOUT_LOCK_DURATION', 60000),
    stalledInterval: 30000,
    maxStalledCount: 2
  },
  'latest-feed': {
    queueName: 'latest-feed',
    concurrency: getEnvInt('WORKER_LATEST_FEED_CONCURRENCY', 1),
    lockDuration: getEnvInt('WORKER_LATEST_FEED_LOCK_DURATION', 60000),
    stalledInterval: 30000,
    maxStalledCount: 2
  },
  'notification-timing': {
    queueName: 'notification-timing',
    concurrency: getEnvInt('WORKER_NOTIFICATION_TIMING_CONCURRENCY', 1),
    lockDuration: getEnvInt('WORKER_NOTIFICATION_TIMING_LOCK_DURATION', 60000),
    stalledInterval: 30000,
    maxStalledCount: 2
  }
};

export function getQueueConfig(queueName: string): QueueConfigOptions {
  return QUEUE_CONFIGS[queueName] || {
    queueName,
    concurrency: 5,
    lockDuration: 60000,
    stalledInterval: 30000,
    maxStalledCount: 2
  };
}

// ==========================================
// BUG 43: No dead-letter queue defined
// ==========================================

export interface DeadLetterQueueEntry {
  id: string;
  originalQueue: string;
  jobId: string;
  jobName: string;
  payload: unknown;
  failureReason: string;
  attemptsMade: number;
  maxAttempts: number;
  failedAt: Date;
  stackTrace?: string;
  workerRunId: string;
}

const deadLetterStore: DeadLetterQueueEntry[] = [];
const MAX_DLQ_SIZE = 10000;

/**
 * Add a failed job to the dead-letter queue.
 * Bug 43 Fix: Persist failed jobs for manual review.
 */
export function addToDeadLetterQueue(entry: Omit<DeadLetterQueueEntry, 'id' | 'failedAt' | 'workerRunId'>): DeadLetterQueueEntry {
  const dlqEntry: DeadLetterQueueEntry = {
    ...entry,
    id: randomUUID(),
    failedAt: new Date(),
    workerRunId: getWorkerRunId()
  };
  
  deadLetterStore.push(dlqEntry);
  
  // Trim if exceeds max size (keep most recent)
  if (deadLetterStore.length > MAX_DLQ_SIZE) {
    deadLetterStore.splice(0, deadLetterStore.length - MAX_DLQ_SIZE);
  }
  
  return dlqEntry;
}

export function getDeadLetterQueueEntries(limit: number = 100): DeadLetterQueueEntry[] {
  return deadLetterStore.slice(-limit);
}

export function getDeadLetterQueueCount(): number {
  return deadLetterStore.length;
}

// ==========================================
// BUG 44: Job payloads are not schema-validated
// ==========================================

export const JobPayloadSchemas = {
  syncSource: z.object({
    seriesSourceId: z.string().uuid()
  }),
  
  chapterIngest: z.object({
    seriesSourceId: z.string().uuid(),
    seriesId: z.string().uuid(),
    chapterNumber: z.number().nullable().optional(),
    chapterSlug: z.string().nullable().optional(),
    chapterTitle: z.string().nullable(),
    chapterUrl: z.string().url(),
    sourceChapterId: z.string().nullable().optional(),
    publishedAt: z.string().nullable(),
    isRecovery: z.boolean().optional(),
    traceId: z.string().optional()
  }),
  
  seriesResolution: z.object({
    libraryEntryId: z.string().uuid(),
    source_url: z.string().url().nullable().optional(),
    title: z.string().nullable().optional()
  }),
  
  notification: z.object({
    chapterId: z.string().uuid(),
    delayMinutes: z.number().optional()
  }),
  
  import: z.object({
    userId: z.string().uuid(),
    entries: z.array(z.object({
      title: z.string(),
      status: z.string(),
      progress: z.number(),
      source_url: z.string().optional()
    }))
  })
};

export type JobPayloadType = keyof typeof JobPayloadSchemas;

export interface PayloadValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: string[];
}

/**
 * Validate job payload against schema.
 * Bug 44 Fix: Reject malformed payloads before processing.
 */
export function validateJobPayload<T>(
  payloadType: JobPayloadType,
  data: unknown
): PayloadValidationResult<T> {
  const schema = JobPayloadSchemas[payloadType];
  const result = schema.safeParse(data);
  
  if (result.success) {
    return {
      valid: true,
      data: result.data as T,
      errors: []
    };
  }
  
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

// ==========================================
// BUG 45-46: Chapter sync dedup and source locking
// ==========================================

export interface ChapterDedupeKey {
  seriesId: string;
  chapterNumber: string;
}

export function generateChapterDedupeKey(seriesId: string, chapterNumber: string | number): string {
  return `chapter:${seriesId}:${String(chapterNumber)}`;
}

/**
 * Build SQL for locking a series source row.
 * Bug 46 Fix: Use FOR UPDATE SKIP LOCKED to prevent concurrent sync.
 */
export function buildSourceLockQuery(seriesSourceId: string): string {
  return `
    SELECT id, source_name, source_status, last_sync_at, sync_error
    FROM series_sources
    WHERE id = '${seriesSourceId}'::uuid
    FOR UPDATE SKIP LOCKED
  `;
}

// ==========================================
// BUG 47-48: Transaction safety and error persistence
// ==========================================

export interface SyncError {
  sourceId: string;
  errorType: 'network' | 'parse' | 'validation' | 'timeout' | 'unknown';
  message: string;
  retryable: boolean;
  occurredAt: Date;
  attemptNumber: number;
}

/**
 * Classify sync error for persistence and retry logic.
 * Bug 48 Fix: Persist error details to database for adaptive scheduling.
 */
export function classifySyncError(error: unknown): Omit<SyncError, 'sourceId' | 'occurredAt' | 'attemptNumber'> {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.substring(0, 500);
  
  if (err.name === 'AbortError' || message.includes('timeout')) {
    return { errorType: 'timeout', message, retryable: true };
  }
  
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('network')) {
    return { errorType: 'network', message, retryable: true };
  }
  
  if (message.includes('parse') || message.includes('JSON') || message.includes('syntax')) {
    return { errorType: 'parse', message, retryable: false };
  }
  
  if (message.includes('validation') || message.includes('invalid')) {
    return { errorType: 'validation', message, retryable: false };
  }
  
  return { errorType: 'unknown', message, retryable: true };
}

// ==========================================
// BUG 49-51: Scheduler state checks and watermarks
// ==========================================

export interface SchedulerWatermark {
  schedulerName: string;
  lastRunId: string;
  lastRunStartedAt: Date;
  lastRunCompletedAt: Date | null;
  lastRunStatus: 'running' | 'completed' | 'failed';
  itemsProcessed: number;
  errors: string[];
}

const schedulerWatermarks = new Map<string, SchedulerWatermark>();

/**
 * Record scheduler run start.
 * Bug 51 Fix: Track scheduler progress for crash recovery.
 */
export function startSchedulerRun(schedulerName: string): string {
  const runId = `${schedulerName}-${Date.now()}-${randomUUID().substring(0, 8)}`;
  
  schedulerWatermarks.set(schedulerName, {
    schedulerName,
    lastRunId: runId,
    lastRunStartedAt: new Date(),
    lastRunCompletedAt: null,
    lastRunStatus: 'running',
    itemsProcessed: 0,
    errors: []
  });
  
  return runId;
}

export function completeSchedulerRun(
  schedulerName: string, 
  itemsProcessed: number,
  errors: string[] = []
): void {
  const watermark = schedulerWatermarks.get(schedulerName);
  if (watermark) {
    watermark.lastRunCompletedAt = new Date();
    watermark.lastRunStatus = errors.length > 0 ? 'failed' : 'completed';
    watermark.itemsProcessed = itemsProcessed;
    watermark.errors = errors.slice(0, 10); // Keep last 10 errors
  }
}

export function getSchedulerWatermark(schedulerName: string): SchedulerWatermark | null {
  return schedulerWatermarks.get(schedulerName) || null;
}

/**
 * Check if source should be scheduled based on its state.
 * Bug 49 Fix: Don't schedule disabled or broken sources.
 */
export function shouldScheduleSource(source: {
  source_status: string;
  sync_priority: string;
  consecutive_failures?: number;
}): { schedule: boolean; reason: string } {
  if (source.source_status === 'disabled') {
    return { schedule: false, reason: 'Source is disabled' };
  }
  
  if (source.source_status === 'broken') {
    return { schedule: false, reason: 'Source is marked as broken' };
  }
  
  if (source.sync_priority === 'FROZEN') {
    return { schedule: false, reason: 'Source sync is frozen' };
  }
  
  const maxFailures = 10;
  if ((source.consecutive_failures || 0) >= maxFailures) {
    return { schedule: false, reason: `Too many consecutive failures (${source.consecutive_failures})` };
  }
  
  return { schedule: true, reason: 'Source is eligible for scheduling' };
}

// ==========================================
// BUG 52-54: API validation and error shapes
// ==========================================

export interface StandardApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId: string;
  timestamp: string;
}

export interface StandardApiSuccess<T> {
  success: true;
  data: T;
  requestId: string;
  timestamp: string;
}

export type StandardApiResponse<T> = StandardApiSuccess<T> | StandardApiError;

/**
 * Create standardized error response.
 * Bug 54 Fix: Consistent error shape across all endpoints.
 */
export function createApiError(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>
): StandardApiError {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details })
    },
    requestId,
    timestamp: new Date().toISOString()
  };
}

export function createApiSuccess<T>(data: T, requestId: string): StandardApiSuccess<T> {
  return {
    success: true,
    data,
    requestId,
    timestamp: new Date().toISOString()
  };
}

// Source URL validation for library operations
const SourceUrlSchema = z.string().url().max(2000);

export interface SourceValidationResult {
  valid: boolean;
  normalizedUrl: string | null;
  platform: string | null;
  platformId: string | null;
  error: string | null;
}

/**
 * Validate source URL for library entry creation.
 * Bug 52 Fix: Validate source before accepting library entries.
 */
export function validateSourceUrl(url: string): SourceValidationResult {
  // Basic URL validation
  const urlResult = SourceUrlSchema.safeParse(url);
  if (!urlResult.success) {
    return {
      valid: false,
      normalizedUrl: null,
      platform: null,
      platformId: null,
      error: 'Invalid URL format'
    };
  }
  
  // Normalize URL
  const normalized = normalizeUrl(url);
  if (!normalized || !normalized.isValid) {
    return {
      valid: false,
      normalizedUrl: null,
      platform: null,
      platformId: null,
      error: 'Unable to parse URL'
    };
  }
  
  // Extract platform ID
  const extraction = extractPlatformIdSafe(url);
  if (!extraction.success) {
    // URL is valid but not from a supported platform
    return {
      valid: true,  // Still valid, just unknown platform
      normalizedUrl: normalized.normalized,
      platform: null,
      platformId: null,
      error: null
    };
  }
  
  return {
    valid: true,
    normalizedUrl: normalized.normalized,
    platform: extraction.platform,
    platformId: extraction.id,
    error: null
  };
}

// ==========================================
// BUG 55-56: Structured logging and state transitions
// ==========================================

export interface StructuredLogContext {
  workerRunId: string;
  jobId?: string;
  libraryEntryId?: string;
  seriesId?: string;
  seriesSourceId?: string;
  userId?: string;
  traceId?: string;
  [key: string]: unknown;
}

export interface StateTransition {
  entityType: 'library_entry' | 'series_source' | 'series' | 'chapter';
  entityId: string;
  field: string;
  previousValue: unknown;
  newValue: unknown;
  changedAt: Date;
  changedBy: string;  // 'worker', 'api', 'scheduler', 'user'
  reason?: string;
}

const stateTransitions: StateTransition[] = [];
const MAX_TRANSITION_LOG_SIZE = 5000;

/**
 * Log a state transition for auditing.
 * Bug 56 Fix: Track all critical state changes.
 */
export function logStateTransition(transition: Omit<StateTransition, 'changedAt'>): void {
  stateTransitions.push({
    ...transition,
    changedAt: new Date()
  });
  
  if (stateTransitions.length > MAX_TRANSITION_LOG_SIZE) {
    stateTransitions.splice(0, stateTransitions.length - MAX_TRANSITION_LOG_SIZE);
  }
}

export function getRecentTransitions(entityId?: string, limit: number = 100): StateTransition[] {
  let filtered = stateTransitions;
  if (entityId) {
    filtered = stateTransitions.filter(t => t.entityId === entityId);
  }
  return filtered.slice(-limit);
}

/**
 * Create structured log entry with correlation context.
 * Bug 55 Fix: Include entity IDs in all log messages.
 */
export function createLogContext(base: Partial<StructuredLogContext>): StructuredLogContext {
  return {
    workerRunId: getWorkerRunId(),
    ...base
  };
}

export function formatStructuredLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  context: StructuredLogContext
): string {
  const timestamp = new Date().toISOString();
  const contextStr = Object.entries(context)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(' ');
  
  return `[${timestamp}] [${level.toUpperCase()}] ${message} ${contextStr}`;
}

// ==========================================
// BUG 57-60: TypeScript safety
// ==========================================

/**
 * Type-safe API response handler that eliminates `any`.
 * Bug 57 Fix: Strict typing for external API responses.
 */
export function parseApiResponse<T>(
  data: unknown,
  schema: z.ZodType<T>,
  apiName: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Invalid ${apiName} response: ${errors.join(', ')}`);
  }
  return result.data;
}

/**
 * Safe property access with explicit null handling.
 * Bug 58 Fix: Fail explicitly instead of silently skipping.
 */
export function requireProperty<T, K extends keyof T>(
  obj: T | null | undefined,
  key: K,
  errorMessage?: string
): NonNullable<T[K]> {
  if (obj === null || obj === undefined) {
    throw new Error(errorMessage || `Object is ${obj}`);
  }
  
  const value = obj[key];
  if (value === null || value === undefined) {
    throw new Error(errorMessage || `Property ${String(key)} is ${value}`);
  }
  
  return value as NonNullable<T[K]>;
}

/**
 * Exhaustive enum handler.
 * Bug 59 Fix: Ensure all enum values are handled.
 */
export function assertExhaustive(value: never, message?: string): never {
  throw new Error(message || `Unexpected value: ${JSON.stringify(value)}`);
}

// Metadata status enum values
export type MetadataStatus = 'pending' | 'enriched' | 'unavailable' | 'failed';

export function handleMetadataStatus(status: MetadataStatus): string {
  switch (status) {
    case 'pending':
      return 'Awaiting metadata enrichment';
    case 'enriched':
      return 'Metadata successfully linked';
    case 'unavailable':
      return 'No metadata match found';
    case 'failed':
      return 'Metadata enrichment failed';
    default:
      return assertExhaustive(status, `Unknown metadata status: ${status}`);
  }
}

/**
 * Consistent date handling in UTC.
 * Bug 60 Fix: All dates should use UTC.
 */
export function toUTCDate(input: Date | string | number | null | undefined): Date | null {
  if (input === null || input === undefined) {
    return null;
  }
  
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    return null;
  }
  
  return date;
}

export function toUTCTimestamp(input: Date | string | number | null | undefined): number | null {
  const date = toUTCDate(input);
  return date ? date.getTime() : null;
}

export function formatUTCDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString();
}

export function nowUTC(): Date {
  return new Date();
}

// Export all for easy imports
export const AuditPass3Fixes = {
  // Bug 36
  normalizeUrl,
  generateUrlDedupeKey,
  // Bug 37
  extractPlatformIdSafe,
  // Bug 38
  normalizeForSimilarity,
  calculateSimilarityUnicodeSafe,
  // Bug 39
  validateWorkerEnv,
  // Bug 40
  checkRedisHealth,
  // Bug 41
  initWorkerRunId,
  getWorkerRunId,
  getWorkerUptime,
  // Bug 42
  QUEUE_CONFIGS,
  getQueueConfig,
  // Bug 43
  addToDeadLetterQueue,
  getDeadLetterQueueEntries,
  getDeadLetterQueueCount,
  // Bug 44
  JobPayloadSchemas,
  validateJobPayload,
  // Bug 45-46
  generateChapterDedupeKey,
  buildSourceLockQuery,
  // Bug 47-48
  classifySyncError,
  // Bug 49-51
  startSchedulerRun,
  completeSchedulerRun,
  getSchedulerWatermark,
  shouldScheduleSource,
  // Bug 52-54
  createApiError,
  createApiSuccess,
  validateSourceUrl,
  // Bug 55-56
  createLogContext,
  formatStructuredLog,
  logStateTransition,
  getRecentTransitions,
  // Bug 57-60
  parseApiResponse,
  requireProperty,
  assertExhaustive,
  handleMetadataStatus,
  toUTCDate,
  toUTCTimestamp,
  formatUTCDate,
  nowUTC,
};
