/**
 * V5 AUDIT BUG FIXES (Bugs 81-100) - FINAL AUDIT PASS
 * 
 * This module implements fixes for bugs 81-100 identified in the v5 fresh audit:
 * 
 * FEATURE FLAGS / CONSTANTS:
 * - Bug 81: Resolution thresholds duplicated instead of imported
 * 
 * ENUMS / CONSTANT DEFINITIONS:
 * - Bug 82: MetadataStatus enum values not validated at runtime
 * 
 * ERROR TYPES / CUSTOM ERRORS:
 * - Bug 83: UnrecoverableError is thrown without contextual metadata
 * 
 * DATE / TIME HELPERS:
 * - Bug 84: Retry scheduling uses Date.now inconsistently
 * 
 * SEARCH INDEX / CACHE HELPERS:
 * - Bug 85: Cache key construction does not include filter set
 * 
 * API RESPONSE TYPES:
 * - Bug 86: API responses not typed end-to-end
 * 
 * FRONTEND DATA FETCHING:
 * - Bug 87: Client-side fetch retries not bounded
 * 
 * COMPONENT STATE:
 * - Bug 88: UI state not reset on library entry deletion
 * 
 * LOGGING HELPERS:
 * - Bug 89: Logger does not redact sensitive fields
 * 
 * SCRIPTING / MAINTENANCE:
 * - Bug 90: Maintenance scripts bypass soft-delete rules
 * 
 * TEST CONFIGURATION:
 * - Bug 91: Test environment does not mirror production flags
 * 
 * TYPESCRIPT CONFIG:
 * - Bug 92: TS config allows implicit index signatures
 * 
 * BUILD / DEPLOY:
 * - Bug 93: Build does not enforce Prisma generate freshness
 * 
 * DATABASE CONNECTION HANDLING:
 * - Bug 94: Prisma client reused across worker shutdown
 * 
 * FINAL EDGE CASES:
 * - Bug 95: No safeguard against duplicate cron triggers
 * - Bug 96: Background jobs do not record execution duration
 * - Bug 97: Worker health check ignores queue backlog
 * - Bug 98: No cap on retry history growth
 * - Bug 99: No invariant check ensuring source ↔ series consistency
 * - Bug 100: No end-to-end consistency verification job
 */

import { z } from 'zod';
import crypto from 'crypto';

// =============================================================================
// BUG 81: Resolution thresholds duplicated instead of imported
// =============================================================================

/**
 * Centralized resolution thresholds - SINGLE SOURCE OF TRUTH
 * All processors and schedulers should import from here
 */
export const RESOLUTION_THRESHOLDS = {
  // Similarity thresholds
  EXACT_MATCH: 1.0,
  HIGH_CONFIDENCE: 0.85,
  MEDIUM_CONFIDENCE: 0.75,
  LOW_CONFIDENCE: 0.60,
  MINIMUM_ACCEPTABLE: 0.50,
  
  // Retry limits
  MAX_RETRIES: 5,
  MAX_RECOVERY_ATTEMPTS: 3,
  
  // Timing (ms)
  MIN_RETRY_DELAY: 60000,         // 1 minute
  MAX_RETRY_DELAY: 86400000,      // 24 hours
  RECOVERY_DELAYS: [
    86400000,                      // 1 day
    259200000,                     // 3 days
    604800000,                     // 7 days
  ],
  
  // Batch sizes
  MAX_CANDIDATES_STRICT: 5,
  MAX_CANDIDATES_FUZZY: 10,
  MAX_CANDIDATES_AGGRESSIVE: 20,
  
  // Search strategy by attempt
  STRATEGIES: {
    1: { threshold: 0.85, maxCandidates: 5, variation: 'normal' as const },
    2: { threshold: 0.75, maxCandidates: 10, variation: 'normal' as const },
    3: { threshold: 0.70, maxCandidates: 15, variation: 'simplified' as const },
    4: { threshold: 0.60, maxCandidates: 20, variation: 'aggressive' as const },
  },
} as const;

/**
 * Get resolution strategy for a given attempt count
 */
export function getResolutionStrategy(attemptCount: number) {
  const attempt = Math.min(attemptCount, 4);
  return RESOLUTION_THRESHOLDS.STRATEGIES[attempt as keyof typeof RESOLUTION_THRESHOLDS.STRATEGIES] 
    || RESOLUTION_THRESHOLDS.STRATEGIES[4];
}

// =============================================================================
// BUG 82: MetadataStatus enum values not validated at runtime
// =============================================================================

/**
 * Valid metadata status values - matches Prisma enum
 */
export const METADATA_STATUS_VALUES = ['pending', 'enriched', 'unavailable', 'failed'] as const;
export type MetadataStatus = typeof METADATA_STATUS_VALUES[number];

/**
 * Zod schema for runtime validation
 */
export const MetadataStatusSchema = z.enum(METADATA_STATUS_VALUES);

/**
 * Validate metadata status at runtime
 */
export function validateMetadataStatus(value: unknown): MetadataStatus {
  const result = MetadataStatusSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid metadata status: ${value}. Valid values: ${METADATA_STATUS_VALUES.join(', ')}`);
  }
  return result.data;
}

/**
 * Check if a value is a valid metadata status
 */
export function isValidMetadataStatus(value: unknown): value is MetadataStatus {
  return MetadataStatusSchema.safeParse(value).success;
}

/**
 * Additional enum validators for other common enums
 */
export const SYNC_PRIORITY_VALUES = ['HOT', 'WARM', 'COLD'] as const;
export type SyncPriority = typeof SYNC_PRIORITY_VALUES[number];
export const SyncPrioritySchema = z.enum(SYNC_PRIORITY_VALUES);

export const CATALOG_TIER_VALUES = ['A', 'B', 'C', 'D'] as const;
export type CatalogTier = typeof CATALOG_TIER_VALUES[number];
export const CatalogTierSchema = z.enum(CATALOG_TIER_VALUES);

export const SOURCE_STATUS_VALUES = ['active', 'broken', 'inactive', 'pending'] as const;
export type SourceStatus = typeof SOURCE_STATUS_VALUES[number];
export const SourceStatusSchema = z.enum(SOURCE_STATUS_VALUES);

// =============================================================================
// BUG 83: UnrecoverableError is thrown without contextual metadata
// =============================================================================

/**
 * Context metadata for errors
 */
export interface ErrorContext {
  libraryEntryId?: string;
  seriesId?: string;
  sourceId?: string;
  sourceUrl?: string;
  userId?: string;
  attemptNumber?: number;
  timestamp?: string;
  jobId?: string;
  queueName?: string;
  operation?: string;
  additionalData?: Record<string, unknown>;
}

/**
 * Enhanced UnrecoverableError with full context
 */
export class UnrecoverableError extends Error {
  public readonly code: string = 'UNRECOVERABLE_ERROR';
  public readonly isRecoverable: boolean = false;
  public readonly context: ErrorContext;
  public readonly originalError?: Error;
  public readonly timestamp: string;

  constructor(
    message: string,
    context: ErrorContext = {},
    originalError?: Error
  ) {
    super(message);
    this.name = 'UnrecoverableError';
    this.timestamp = new Date().toISOString();
    this.context = {
      ...context,
      timestamp: this.timestamp,
    };
    this.originalError = originalError;
    
    // Preserve original stack trace if available
    if (originalError?.stack) {
      this.stack = `${this.stack}\n\nCaused by:\n${originalError.stack}`;
    }
    
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Get serializable error data for logging
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      isRecoverable: this.isRecoverable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message,
      } : undefined,
    };
  }
}

/**
 * Enhanced TransientError with context
 */
export class TransientError extends Error {
  public readonly code: string = 'TRANSIENT_ERROR';
  public readonly isRecoverable: boolean = true;
  public readonly context: ErrorContext;
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    context: ErrorContext = {},
    retryAfterMs?: number
  ) {
    super(message);
    this.name = 'TransientError';
    this.context = {
      ...context,
      timestamp: new Date().toISOString(),
    };
    this.retryAfterMs = retryAfterMs;
    Error.captureStackTrace(this, this.constructor);
  }
}

// =============================================================================
// BUG 84: Retry scheduling uses Date.now inconsistently
// =============================================================================

/**
 * Consistent timestamp provider
 * Uses a single source (database time or system time) consistently
 */
export class TimestampProvider {
  private static useDbTime: boolean = false;
  private static dbTimeOffset: number = 0;

  /**
   * Initialize with database time offset
   * Call this once at startup after querying SELECT NOW() from DB
   */
  static async initializeFromDb(getDbTime: () => Promise<Date>): Promise<void> {
    try {
      const systemNow = Date.now();
      const dbTime = await getDbTime();
      this.dbTimeOffset = dbTime.getTime() - systemNow;
      this.useDbTime = true;
    } catch {
      // Fall back to system time
      this.useDbTime = false;
      this.dbTimeOffset = 0;
    }
  }

  /**
   * Get current timestamp in milliseconds
   */
  static now(): number {
    return Date.now() + (this.useDbTime ? this.dbTimeOffset : 0);
  }

  /**
   * Get current timestamp as Date
   */
  static nowDate(): Date {
    return new Date(this.now());
  }

  /**
   * Calculate delay from now
   */
  static delayFromNow(futureTime: Date | number): number {
    const futureMs = typeof futureTime === 'number' ? futureTime : futureTime.getTime();
    return Math.max(0, futureMs - this.now());
  }

  /**
   * Check if a timestamp is in the past
   */
  static isPast(time: Date | number): boolean {
    const timeMs = typeof time === 'number' ? time : time.getTime();
    return timeMs < this.now();
  }

  /**
   * Add duration to current time
   */
  static addMs(ms: number): Date {
    return new Date(this.now() + ms);
  }

  /**
   * Format for comparison with DB timestamps
   */
  static toISOString(): string {
    return this.nowDate().toISOString();
  }
}

/**
 * Calculate retry delay with consistent timestamps
 */
export function calculateRetryDelay(
  attemptNumber: number,
  options: {
    baseDelayMs?: number;
    maxDelayMs?: number;
    jitterPercent?: number;
  } = {}
): { delayMs: number; nextAttemptAt: Date } {
  const {
    baseDelayMs = RESOLUTION_THRESHOLDS.MIN_RETRY_DELAY,
    maxDelayMs = RESOLUTION_THRESHOLDS.MAX_RETRY_DELAY,
    jitterPercent = 0.2,
  } = options;

  // Exponential backoff
  const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber - 1);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  
  // Add jitter (±jitterPercent)
  const jitterRange = cappedDelay * jitterPercent;
  const jitter = (Math.random() * 2 - 1) * jitterRange;
  const finalDelay = Math.round(cappedDelay + jitter);

  return {
    delayMs: finalDelay,
    nextAttemptAt: TimestampProvider.addMs(finalDelay),
  };
}

// =============================================================================
// BUG 85: Cache key construction does not include filter set
// =============================================================================

/**
 * Search filter parameters
 */
export interface SearchFilters {
  query?: string;
  genres?: string[];
  tags?: string[];
  status?: string;
  type?: string;
  contentRating?: string;
  year?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

/**
 * Generate deterministic cache key including all filter parameters
 */
export function generateSearchCacheKey(
  prefix: string,
  filters: SearchFilters,
  userId?: string | null
): string {
  // Normalize and sort filters for deterministic key
  const normalizedFilters: Record<string, string> = {};
  
  if (filters.query) normalizedFilters.q = filters.query.toLowerCase().trim();
  if (filters.genres?.length) normalizedFilters.g = filters.genres.sort().join(',');
  if (filters.tags?.length) normalizedFilters.t = filters.tags.sort().join(',');
  if (filters.status) normalizedFilters.s = filters.status;
  if (filters.type) normalizedFilters.ty = filters.type;
  if (filters.contentRating) normalizedFilters.cr = filters.contentRating;
  if (filters.year) normalizedFilters.y = String(filters.year);
  if (filters.sortBy) normalizedFilters.sb = filters.sortBy;
  if (filters.sortOrder) normalizedFilters.so = filters.sortOrder;
  if (filters.page) normalizedFilters.p = String(filters.page);
  if (filters.limit) normalizedFilters.l = String(filters.limit);
  
  // Create sorted query string
  const sortedParams = Object.entries(normalizedFilters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  
  // Hash long filter strings to keep key manageable
  const filterHash = sortedParams.length > 100
    ? crypto.createHash('md5').update(sortedParams).digest('hex').substring(0, 16)
    : sortedParams;
  
  // Include user scope
  const userScope = userId || 'public';
  
  return `${prefix}:${userScope}:${filterHash}`;
}

/**
 * Generate cache key for library queries
 */
export function generateLibraryCacheKey(
  userId: string,
  filters: {
    status?: string;
    sort?: string;
    page?: number;
    limit?: number;
    query?: string;
  }
): string {
  const parts = ['library', userId];
  
  if (filters.status) parts.push(`st:${filters.status}`);
  if (filters.sort) parts.push(`s:${filters.sort}`);
  if (filters.query) parts.push(`q:${filters.query.toLowerCase()}`);
  if (filters.page) parts.push(`p:${filters.page}`);
  if (filters.limit) parts.push(`l:${filters.limit}`);
  
  return parts.join(':');
}

// =============================================================================
// BUG 86: API responses not typed end-to-end
// =============================================================================

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

/**
 * Library entry response type
 */
export const LibraryEntryResponseSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  series_id: z.string().uuid().nullable(),
  imported_title: z.string().nullable(),
  source_url: z.string().nullable(),
  status: z.string(),
  last_read_chapter: z.number().nullable(),
  metadata_status: MetadataStatusSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  series: z.object({
    id: z.string().uuid(),
    title: z.string(),
    cover_url: z.string().nullable(),
    status: z.string().nullable(),
    type: z.string().nullable(),
  }).nullable().optional(),
});

export type LibraryEntryResponse = z.infer<typeof LibraryEntryResponseSchema>;

/**
 * Series response type
 */
export const SeriesResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  alternative_titles: z.array(z.string()).nullable(),
  description: z.string().nullable(),
  cover_url: z.string().nullable(),
  status: z.string().nullable(),
  type: z.string().nullable(),
  content_rating: z.string().nullable(),
  year: z.number().nullable(),
  original_language: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type SeriesResponse = z.infer<typeof SeriesResponseSchema>;

/**
 * Create typed API response
 */
export function createApiResponse<T>(
  data: T,
  meta?: ApiResponse<T>['meta']
): ApiResponse<T> {
  return {
    success: true,
    data,
    meta,
  };
}

/**
 * Create error API response
 */
export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown
): ApiResponse<never> {
  return {
    success: false,
    error: { code, message, details },
  };
}

/**
 * Validate response data against schema
 */
export function validateApiResponse<T>(
  schema: z.ZodType<T>,
  data: unknown
): { valid: true; data: T } | { valid: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}

// =============================================================================
// BUG 87: Client-side fetch retries not bounded
// =============================================================================

/**
 * Fetch retry configuration
 */
export interface FetchRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOnStatusCodes: number[];
  timeoutMs: number;
}

export const DEFAULT_FETCH_RETRY_CONFIG: FetchRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryOnStatusCodes: [408, 429, 500, 502, 503, 504],
  timeoutMs: 30000,
};

/**
 * Bounded fetch with retry logic
 */
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit = {},
  config: Partial<FetchRetryConfig> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_FETCH_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), finalConfig.timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Check if we should retry this status code
        if (
          finalConfig.retryOnStatusCodes.includes(response.status) &&
          attempt < finalConfig.maxRetries
        ) {
          const delay = Math.min(
            finalConfig.baseDelayMs * Math.pow(2, attempt),
            finalConfig.maxDelayMs
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < finalConfig.maxRetries) {
        const delay = Math.min(
          finalConfig.baseDelayMs * Math.pow(2, attempt),
          finalConfig.maxDelayMs
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }

  throw lastError || new Error('Fetch failed after max retries');
}

// =============================================================================
// BUG 88: UI state not reset on library entry deletion
// =============================================================================

/**
 * Library state event types
 */
export type LibraryStateEvent = 
  | { type: 'ENTRY_ADDED'; entryId: string; entry: LibraryEntryResponse }
  | { type: 'ENTRY_UPDATED'; entryId: string; updates: Partial<LibraryEntryResponse> }
  | { type: 'ENTRY_DELETED'; entryId: string }
  | { type: 'ENTRIES_BULK_DELETED'; entryIds: string[] }
  | { type: 'STATE_RESET' };

/**
 * Library state manager for client-side state consistency
 */
export class LibraryStateManager {
  private listeners: Set<(event: LibraryStateEvent) => void> = new Set();
  private entries: Map<string, LibraryEntryResponse> = new Map();

  /**
   * Subscribe to state changes
   */
  subscribe(listener: (event: LibraryStateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners
   */
  private notify(event: LibraryStateEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  /**
   * Add or update entry
   */
  setEntry(entry: LibraryEntryResponse): void {
    const isNew = !this.entries.has(entry.id);
    this.entries.set(entry.id, entry);
    
    if (isNew) {
      this.notify({ type: 'ENTRY_ADDED', entryId: entry.id, entry });
    } else {
      this.notify({ type: 'ENTRY_UPDATED', entryId: entry.id, updates: entry });
    }
  }

  /**
   * Delete entry and notify listeners
   */
  deleteEntry(entryId: string): void {
    if (this.entries.has(entryId)) {
      this.entries.delete(entryId);
      this.notify({ type: 'ENTRY_DELETED', entryId });
    }
  }

  /**
   * Bulk delete entries
   */
  deleteEntries(entryIds: string[]): void {
    const deletedIds: string[] = [];
    for (const id of entryIds) {
      if (this.entries.has(id)) {
        this.entries.delete(id);
        deletedIds.push(id);
      }
    }
    if (deletedIds.length > 0) {
      this.notify({ type: 'ENTRIES_BULK_DELETED', entryIds: deletedIds });
    }
  }

  /**
   * Reset all state
   */
  reset(): void {
    this.entries.clear();
    this.notify({ type: 'STATE_RESET' });
  }

  /**
   * Get entry by ID
   */
  getEntry(entryId: string): LibraryEntryResponse | undefined {
    return this.entries.get(entryId);
  }

  /**
   * Get all entries
   */
  getAllEntries(): LibraryEntryResponse[] {
    return Array.from(this.entries.values());
  }
}

// Singleton instance
export const libraryStateManager = new LibraryStateManager();

// =============================================================================
// BUG 89: Logger does not redact sensitive fields
// =============================================================================

/**
 * Sensitive field patterns to redact
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // API keys and tokens
  { pattern: /api[_-]?key[=:]\s*['"]?([^'"&\s]+)/gi, replacement: 'api_key=[REDACTED]' },
  { pattern: /bearer\s+([a-zA-Z0-9_.-]+)/gi, replacement: 'Bearer [REDACTED]' },
  { pattern: /token[=:]\s*['"]?([^'"&\s]+)/gi, replacement: 'token=[REDACTED]' },
  { pattern: /secret[=:]\s*['"]?([^'"&\s]+)/gi, replacement: 'secret=[REDACTED]' },
  
  // Passwords
  { pattern: /password[=:]\s*['"]?([^'"&\s]+)/gi, replacement: 'password=[REDACTED]' },
  
  // URLs with credentials
  { pattern: /https?:\/\/([^:]+):([^@]+)@/gi, replacement: 'https://[USER]:[REDACTED]@' },
  
  // Email addresses (partial redaction)
  { pattern: /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi, replacement: '[EMAIL]@$2' },
  
  // IP addresses (optionally redact last octet)
  { pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, replacement: '$1.xxx' },
  
  // Session IDs
  { pattern: /session[_-]?id[=:]\s*['"]?([^'"&\s]+)/gi, replacement: 'session_id=[REDACTED]' },
  
  // Database connection strings
  { pattern: /postgres(ql)?:\/\/[^:]+:[^@]+@/gi, replacement: 'postgresql://[USER]:[REDACTED]@' },
  { pattern: /redis:\/\/[^:]+:[^@]+@/gi, replacement: 'redis://[USER]:[REDACTED]@' },
];

/**
 * Sensitive object keys to redact
 */
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'apikey', 'api_key', 'apiKey',
  'authorization', 'auth', 'cookie', 'session', 'sessionid', 'session_id',
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'private_key', 'privateKey', 'client_secret', 'clientSecret',
  'database_url', 'databaseUrl', 'redis_url', 'redisUrl',
  'supabase_key', 'supabaseKey', 'service_role_key',
]);

/**
 * Redact sensitive data from a string
 */
export function redactString(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Redact sensitive data from an object (deep)
 */
export function redactObject(obj: unknown, maxDepth: number = 10): unknown {
  if (maxDepth <= 0) return '[MAX_DEPTH_EXCEEDED]';
  
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return redactString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, maxDepth - 1));
  }
  
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactObject(value, maxDepth - 1);
      }
    }
    return result;
  }
  
  return obj;
}

/**
 * Enhanced logger with automatic redaction
 */
export class SecureLogger {
  private isProduction = process.env.NODE_ENV === 'production';

  private formatMessage(level: string, message: string, context?: Record<string, unknown>) {
    const timestamp = new Date().toISOString();
    const redactedContext = context ? redactObject(context) : undefined;
    
    const logData = {
      timestamp,
      level: level.toUpperCase(),
      message: redactString(message),
      ...redactedContext as Record<string, unknown>,
    };

    if (this.isProduction) {
      return JSON.stringify(logData);
    }

    const contextStr = redactedContext ? ` ${JSON.stringify(redactedContext)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${redactString(message)}${contextStr}`;
  }

  info(message: string, context?: Record<string, unknown>) {
    console.info(this.formatMessage('info', message, context));
  }

  warn(message: string, context?: Record<string, unknown>) {
    console.warn(this.formatMessage('warn', message, context));
  }

  error(message: string, context?: Record<string, unknown>) {
    console.error(this.formatMessage('error', message, context));
  }

  debug(message: string, context?: Record<string, unknown>) {
    if (!this.isProduction) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }
}

export const secureLogger = new SecureLogger();

// =============================================================================
// BUG 90: Maintenance scripts bypass soft-delete rules
// =============================================================================

/**
 * Query builder that automatically applies soft-delete filters
 */
export interface SoftDeleteOptions {
  includeDeleted?: boolean;
  deletedAtColumn?: string;
}

/**
 * Add soft-delete filter to Prisma where clause
 */
export function withSoftDeleteFilter<T extends Record<string, unknown>>(
  where: T,
  options: SoftDeleteOptions = {}
): T & { deleted_at?: null | { not: null } } {
  const { includeDeleted = false, deletedAtColumn = 'deleted_at' } = options;
  
  if (includeDeleted) {
    return where;
  }
  
  return {
    ...where,
    [deletedAtColumn]: null,
  };
}

/**
 * Validation helper for scripts to ensure soft-delete compliance
 */
export function validateScriptQuery(
  queryDescription: string,
  where: Record<string, unknown>,
  options: SoftDeleteOptions = {}
): void {
  const { includeDeleted = false, deletedAtColumn = 'deleted_at' } = options;
  
  if (!includeDeleted && !(deletedAtColumn in where)) {
    console.warn(
      `[Script Warning] Query "${queryDescription}" does not filter soft-deleted records. ` +
      `Add "${deletedAtColumn}: null" or set includeDeleted: true`
    );
  }
}

/**
 * Safe script query executor
 */
export async function safeScriptQuery<T>(
  description: string,
  query: () => Promise<T>,
  options: { requireConfirmation?: boolean; dryRun?: boolean } = {}
): Promise<T | null> {
  const { requireConfirmation = false, dryRun = false } = options;
  
  console.log(`[Script] ${dryRun ? '[DRY RUN] ' : ''}Executing: ${description}`);
  
  if (requireConfirmation) {
    // In a real implementation, this would prompt for confirmation
    console.log('[Script] Confirmation required for this operation');
  }
  
  if (dryRun) {
    console.log('[Script] Dry run mode - skipping actual execution');
    return null;
  }
  
  const startTime = Date.now();
  try {
    const result = await query();
    console.log(`[Script] Completed in ${Date.now() - startTime}ms`);
    return result;
  } catch (error) {
    console.error(`[Script] Failed after ${Date.now() - startTime}ms:`, error);
    throw error;
  }
}

// =============================================================================
// BUG 91: Test environment does not mirror production flags
// =============================================================================

/**
 * Feature flags with environment-aware defaults
 */
export const FEATURE_FLAGS = {
  // Core features
  metadata_resolution: { dev: true, test: true, prod: true },
  chapter_sync: { dev: true, test: true, prod: true },
  notifications: { dev: true, test: true, prod: true },
  
  // Security features
  rate_limiting: { dev: false, test: true, prod: true },
  csrf_protection: { dev: false, test: true, prod: true },
  memory_guards: { dev: false, test: true, prod: true },
  
  // Experimental features
  recommendations_v2: { dev: true, test: true, prod: false },
  social_features: { dev: true, test: false, prod: false },
  
  // Debug features
  verbose_logging: { dev: true, test: false, prod: false },
  query_logging: { dev: true, test: false, prod: false },
} as const;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;

/**
 * Get feature flag value for current environment
 */
export function getFeatureFlag(name: FeatureFlagName): boolean {
  const env = process.env.NODE_ENV || 'development';
  const flags = FEATURE_FLAGS[name];
  
  switch (env) {
    case 'production':
      return flags.prod;
    case 'test':
      return flags.test;
    default:
      return flags.dev;
  }
}

/**
 * Assert feature flags match between test and prod
 */
export function validateTestEnvironmentFlags(): {
  valid: boolean;
  mismatches: Array<{ flag: string; testValue: boolean; prodValue: boolean }>;
} {
  const mismatches: Array<{ flag: string; testValue: boolean; prodValue: boolean }> = [];
  
  for (const [name, values] of Object.entries(FEATURE_FLAGS)) {
    // Skip explicitly different flags (like debug features)
    if (name === 'verbose_logging' || name === 'query_logging') continue;
    
    if (values.test !== values.prod) {
      mismatches.push({
        flag: name,
        testValue: values.test,
        prodValue: values.prod,
      });
    }
  }
  
  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}

// =============================================================================
// BUG 92: TS config allows implicit index signatures
// NOTE: This is a config change - noUncheckedIndexedAccess should be true
// =============================================================================

/**
 * Safe object access helper for when noUncheckedIndexedAccess is enabled
 */
export function safeGet<T, K extends keyof T>(
  obj: T,
  key: K
): T[K] | undefined {
  return obj[key];
}

/**
 * Safe array access
 */
export function safeArrayAccess<T>(
  arr: T[],
  index: number
): T | undefined {
  return arr[index];
}

/**
 * Safe object key access with default
 */
export function getOrDefault<T>(
  obj: Record<string, T>,
  key: string,
  defaultValue: T
): T {
  return key in obj ? obj[key]! : defaultValue;
}

// =============================================================================
// BUG 93: Build does not enforce Prisma generate freshness
// =============================================================================

/**
 * Prisma schema hash for version checking
 */
export async function getPrismaSchemaHash(): Promise<string> {
  const fs = await import('fs');
  const path = await import('path');
  
  try {
    const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
    const content = fs.readFileSync(schemaPath, 'utf-8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch {
    return 'unknown';
  }
}

/**
 * Check if Prisma client is fresh
 */
export async function checkPrismaFreshness(): Promise<{
  fresh: boolean;
  schemaHash: string;
  clientHash?: string;
  error?: string;
}> {
  const schemaHash = await getPrismaSchemaHash();
  
  // In a real implementation, compare with stored hash from last generate
  // This is a simplified version
  const clientHashPath = '.prisma-hash';
  
  try {
    const fs = await import('fs');
    if (fs.existsSync(clientHashPath)) {
      const clientHash = fs.readFileSync(clientHashPath, 'utf-8').trim();
      return {
        fresh: clientHash === schemaHash,
        schemaHash,
        clientHash,
      };
    }
    return {
      fresh: false,
      schemaHash,
      error: 'No client hash found - run prisma generate',
    };
  } catch (error) {
    return {
      fresh: false,
      schemaHash,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// BUG 94: Prisma client reused across worker shutdown
// =============================================================================

/**
 * Prisma client lifecycle manager
 */
export class PrismaLifecycleManager {
  private static isShuttingDown = false;
  private static shutdownPromise: Promise<void> | null = null;

  /**
   * Register shutdown handlers
   */
  static registerShutdownHandlers(prisma: { $disconnect: () => Promise<void> }): void {
    const shutdown = async () => {
      if (this.isShuttingDown) return this.shutdownPromise;
      
      this.isShuttingDown = true;
      console.log('[Prisma] Initiating graceful shutdown...');
      
      this.shutdownPromise = (async () => {
        try {
          await prisma.$disconnect();
          console.log('[Prisma] Disconnected successfully');
        } catch (error) {
          console.error('[Prisma] Error during disconnect:', error);
        }
      })();
      
      return this.shutdownPromise;
    };

    process.on('SIGINT', () => shutdown().then(() => process.exit(0)));
    process.on('SIGTERM', () => shutdown().then(() => process.exit(0)));
    process.on('beforeExit', () => shutdown());
  }

  /**
   * Check if shutdown is in progress
   */
  static get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Wait for shutdown to complete
   */
  static async waitForShutdown(): Promise<void> {
    if (this.shutdownPromise) {
      await this.shutdownPromise;
    }
  }
}

// =============================================================================
// BUG 95: No safeguard against duplicate cron triggers
// =============================================================================

/**
 * Distributed lock for cron jobs
 */
export interface CronLock {
  acquired: boolean;
  lockId: string;
  expiresAt: Date;
}

/**
 * Acquire a cron lock to prevent duplicate triggers
 */
export async function acquireCronLock(
  redis: { set: (key: string, value: string, mode: string, px: string, time: number, flag: string) => Promise<string | null>; get: (key: string) => Promise<string | null> },
  jobName: string,
  ttlMs: number = 60000
): Promise<CronLock> {
  const lockKey = `cron:lock:${jobName}`;
  const lockId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Try to acquire lock with NX (only if not exists)
  const result = await redis.set(lockKey, lockId, 'PX', 'NX', ttlMs, 'NX');
  
  return {
    acquired: result === 'OK',
    lockId,
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

/**
 * Release a cron lock
 */
export async function releaseCronLock(
  redis: { get: (key: string) => Promise<string | null>; del: (key: string) => Promise<number> },
  jobName: string,
  lockId: string
): Promise<boolean> {
  const lockKey = `cron:lock:${jobName}`;
  
  // Only release if we own the lock
  const currentLock = await redis.get(lockKey);
  if (currentLock === lockId) {
    await redis.del(lockKey);
    return true;
  }
  
  return false;
}

// =============================================================================
// BUG 96: Background jobs do not record execution duration
// =============================================================================

/**
 * Job execution metrics
 */
export interface JobMetrics {
  jobId: string;
  queueName: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  success: boolean;
  error?: string;
  attempts: number;
}

/**
 * Job metrics collector
 */
export class JobMetricsCollector {
  private metrics: Map<string, JobMetrics> = new Map();
  private readonly maxEntries: number = 10000;

  /**
   * Record job start
   */
  startJob(jobId: string, queueName: string, attempts: number = 1): void {
    // Cleanup old entries if needed
    if (this.metrics.size >= this.maxEntries) {
      const keysToDelete = Array.from(this.metrics.keys()).slice(0, 1000);
      keysToDelete.forEach(k => this.metrics.delete(k));
    }

    this.metrics.set(jobId, {
      jobId,
      queueName,
      startTime: Date.now(),
      success: false,
      attempts,
    });
  }

  /**
   * Record job completion
   */
  completeJob(jobId: string, success: boolean, error?: string): JobMetrics | undefined {
    const metrics = this.metrics.get(jobId);
    if (metrics) {
      metrics.endTime = Date.now();
      metrics.durationMs = metrics.endTime - metrics.startTime;
      metrics.success = success;
      if (error) metrics.error = error;
    }
    return metrics;
  }

  /**
   * Get metrics for a job
   */
  getMetrics(jobId: string): JobMetrics | undefined {
    return this.metrics.get(jobId);
  }

  /**
   * Get summary stats
   */
  getSummary(): {
    totalJobs: number;
    successfulJobs: number;
    failedJobs: number;
    avgDurationMs: number;
    slowJobs: number;
  } {
    let total = 0;
    let successful = 0;
    let failed = 0;
    let totalDuration = 0;
    let slowJobs = 0;
    const SLOW_THRESHOLD_MS = 30000;

    for (const m of this.metrics.values()) {
      if (m.durationMs !== undefined) {
        total++;
        totalDuration += m.durationMs;
        if (m.success) successful++;
        else failed++;
        if (m.durationMs > SLOW_THRESHOLD_MS) slowJobs++;
      }
    }

    return {
      totalJobs: total,
      successfulJobs: successful,
      failedJobs: failed,
      avgDurationMs: total > 0 ? Math.round(totalDuration / total) : 0,
      slowJobs,
    };
  }
}

export const jobMetricsCollector = new JobMetricsCollector();

// =============================================================================
// BUG 97: Worker health check ignores queue backlog
// =============================================================================

/**
 * Queue health thresholds
 */
export const QUEUE_HEALTH_THRESHOLDS = {
  WARNING_BACKLOG: 1000,
  CRITICAL_BACKLOG: 5000,
  WARNING_FAILED_RATIO: 0.1,  // 10%
  CRITICAL_FAILED_RATIO: 0.25, // 25%
  STALE_JOB_HOURS: 24,
};

/**
 * Queue health status
 */
export interface QueueHealthStatus {
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  failedRatio: number;
  hasStaleJobs: boolean;
  issues: string[];
}

/**
 * Check queue health including backlog
 * 
 * Bug fix: Only consider failure rate critical if there's active work or recent backlog.
 * Historic failed jobs with no pending/active work should not trigger critical status.
 */
export async function checkQueueHealth(
  queue: {
    name: string;
    getJobCounts: () => Promise<{
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    }>;
    getJobs: (types: string[], start: number, end: number) => Promise<Array<{ timestamp?: number }>>;
  }
): Promise<QueueHealthStatus> {
  const counts = await queue.getJobCounts();
  const issues: string[] = [];
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';

  // Check backlog
  const totalBacklog = counts.waiting + counts.delayed;
  if (totalBacklog >= QUEUE_HEALTH_THRESHOLDS.CRITICAL_BACKLOG) {
    status = 'critical';
    issues.push(`Critical backlog: ${totalBacklog} jobs waiting`);
  } else if (totalBacklog >= QUEUE_HEALTH_THRESHOLDS.WARNING_BACKLOG) {
    status = 'warning';
    issues.push(`High backlog: ${totalBacklog} jobs waiting`);
  }

  // Check failed ratio - only consider it critical if there's active work or pending jobs
  // Historic failures without current activity shouldn't trigger critical status
  const totalProcessed = counts.completed + counts.failed;
  const failedRatio = totalProcessed > 0 ? counts.failed / totalProcessed : 0;
  const hasActiveWork = counts.waiting > 0 || counts.active > 0 || counts.delayed > 0;
  const hasRecentCompletions = counts.completed > 0;
  
  // Only flag failure rate as critical/warning if:
  // 1. There's active work (jobs pending/active) AND high failure rate, OR
  // 2. There are recent completions AND high failure rate
  // Historic failures alone (no pending/active/completed) are just informational
  const shouldCheckFailureRate = hasActiveWork || hasRecentCompletions;
  
  if (shouldCheckFailureRate) {
    if (failedRatio >= QUEUE_HEALTH_THRESHOLDS.CRITICAL_FAILED_RATIO) {
      status = 'critical';
      issues.push(`Critical failure rate: ${(failedRatio * 100).toFixed(1)}%`);
    } else if (failedRatio >= QUEUE_HEALTH_THRESHOLDS.WARNING_FAILED_RATIO) {
      if (status === 'healthy') status = 'warning';
      issues.push(`High failure rate: ${(failedRatio * 100).toFixed(1)}%`);
    }
  } else if (counts.failed > 0 && !hasRecentCompletions) {
    // Informational: there are historic failures but no current activity
    // Don't mark as critical/warning - it's just cleanup needed
    if (counts.failed > 1000) {
      issues.push(`Historic failures: ${counts.failed} (consider cleanup)`);
    }
  }

  // Check for stale jobs
  let hasStaleJobs = false;
  try {
    const waitingJobs = await queue.getJobs(['waiting'], 0, 100);
    const staleThreshold = Date.now() - QUEUE_HEALTH_THRESHOLDS.STALE_JOB_HOURS * 60 * 60 * 1000;
    hasStaleJobs = waitingJobs.some(job => (job.timestamp || 0) < staleThreshold);
    
    if (hasStaleJobs) {
      if (status === 'healthy') status = 'warning';
      issues.push(`Stale jobs detected (older than ${QUEUE_HEALTH_THRESHOLDS.STALE_JOB_HOURS}h)`);
    }
  } catch {
    // Ignore errors when checking stale jobs
  }

  return {
    name: queue.name,
    status,
    ...counts,
    failedRatio,
    hasStaleJobs,
    issues,
  };
}

// =============================================================================
// BUG 98: No cap on retry history growth
// =============================================================================

/**
 * Retry history limits
 */
export const RETRY_HISTORY_LIMITS = {
  MAX_RETRY_COUNT: 10,
  MAX_ERROR_HISTORY_LENGTH: 5,
  MAX_ERROR_MESSAGE_LENGTH: 500,
  PRUNE_AFTER_DAYS: 30,
};

/**
 * Pruned retry record
 */
export interface PrunedRetryRecord {
  count: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  recentErrors: string[];
}

/**
 * Prune retry history to prevent unbounded growth
 */
export function pruneRetryHistory(
  currentCount: number,
  errorMessage: string | null,
  existingErrors: string[] = []
): PrunedRetryRecord {
  // Cap retry count
  const cappedCount = Math.min(currentCount, RETRY_HISTORY_LIMITS.MAX_RETRY_COUNT);
  
  // Truncate error message
  const truncatedError = errorMessage
    ? errorMessage.substring(0, RETRY_HISTORY_LIMITS.MAX_ERROR_MESSAGE_LENGTH)
    : null;
  
  // Maintain limited error history
  let recentErrors = [...existingErrors];
  if (truncatedError) {
    recentErrors.unshift(truncatedError);
  }
  recentErrors = recentErrors.slice(0, RETRY_HISTORY_LIMITS.MAX_ERROR_HISTORY_LENGTH);

  return {
    count: cappedCount,
    lastError: truncatedError,
    lastAttemptAt: new Date(),
    recentErrors,
  };
}

// =============================================================================
// BUG 99: No invariant check ensuring source ↔ series consistency
// =============================================================================

/**
 * Source-series consistency check result
 */
export interface ConsistencyCheckResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate source-series relationship consistency
 */
export async function validateSourceSeriesConsistency(
  tx: {
    seriesSource: {
      findMany: (args: { where: { series_id: string }; select: { id: boolean; series_id: boolean; source_name: boolean } }) => Promise<Array<{ id: string; series_id: string; source_name: string }>>;
    };
    series: {
      findUnique: (args: { where: { id: string }; select: { id: boolean; deleted_at: boolean } }) => Promise<{ id: string; deleted_at: Date | null } | null>;
    };
  },
  seriesId: string
): Promise<ConsistencyCheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check series exists
  const series = await tx.series.findUnique({
    where: { id: seriesId },
    select: { id: true, deleted_at: true },
  });

  if (!series) {
    errors.push(`Series ${seriesId} does not exist`);
    return { valid: false, errors, warnings };
  }

  if (series.deleted_at) {
    warnings.push(`Series ${seriesId} is soft-deleted`);
  }

  // Check sources reference correct series
  const sources = await tx.seriesSource.findMany({
    where: { series_id: seriesId },
    select: { id: true, series_id: true, source_name: true },
  });

  for (const source of sources) {
    if (source.series_id !== seriesId) {
      errors.push(`Source ${source.id} references wrong series: ${source.series_id} != ${seriesId}`);
    }
  }

  // Check for duplicate sources (same source_name for same series)
  const sourceNames = sources.map(s => s.source_name);
  const duplicates = sourceNames.filter((name, idx) => sourceNames.indexOf(name) !== idx);
  if (duplicates.length > 0) {
    warnings.push(`Duplicate source names for series ${seriesId}: ${[...new Set(duplicates)].join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// =============================================================================
// BUG 100: No end-to-end consistency verification job
// =============================================================================

/**
 * Comprehensive consistency verification result
 */
export interface VerificationResult {
  type: string;
  checked: number;
  issues: number;
  fixed: number;
  errors: string[];
}

/**
 * End-to-end consistency verification job
 */
export async function runConsistencyVerification(
  prisma: any,
  options: { fix?: boolean; limit?: number } = {}
): Promise<{
  success: boolean;
  results: VerificationResult[];
  summary: { totalIssues: number; totalFixed: number; duration: number };
}> {
  const startTime = Date.now();
  const results: VerificationResult[] = [];
  const { fix = false, limit = 1000 } = options;

  // 1. Check library entries with invalid series references
  const orphanedEntries = await prisma.$queryRaw<any[]>`
    SELECT le.id, le.series_id
    FROM library_entries le
    LEFT JOIN series s ON le.series_id = s.id
    WHERE le.series_id IS NOT NULL
      AND s.id IS NULL
      AND le.deleted_at IS NULL
    LIMIT ${limit}
  `;
  
  let entriesFixed = 0;
  if (fix && orphanedEntries.length > 0) {
    await prisma.libraryEntry.updateMany({
      where: { id: { in: orphanedEntries.map((e: any) => e.id) } },
      data: { series_id: null, metadata_status: 'pending', needs_review: true },
    });
    entriesFixed = orphanedEntries.length;
  }
  
  results.push({
    type: 'orphaned_library_entries',
    checked: limit,
    issues: orphanedEntries.length,
    fixed: entriesFixed,
    errors: orphanedEntries.slice(0, 10).map((e: any) => `Entry ${e.id} references missing series ${e.series_id}`),
  });

  // 2. Check series sources with invalid series references
  const orphanedSources = await prisma.$queryRaw<any[]>`
    SELECT ss.id, ss.series_id
    FROM series_sources ss
    LEFT JOIN series s ON ss.series_id = s.id
    WHERE s.id IS NULL
    LIMIT ${limit}
  `;
  
  let sourcesFixed = 0;
  if (fix && orphanedSources.length > 0) {
    await prisma.seriesSource.deleteMany({
      where: { id: { in: orphanedSources.map((s: any) => s.id) } },
    });
    sourcesFixed = orphanedSources.length;
  }
  
  results.push({
    type: 'orphaned_series_sources',
    checked: limit,
    issues: orphanedSources.length,
    fixed: sourcesFixed,
    errors: orphanedSources.slice(0, 10).map((s: any) => `Source ${s.id} references missing series ${s.series_id}`),
  });

  // 3. Check chapters with invalid source references
  const orphanedChapters = await prisma.$queryRaw<any[]>`
    SELECT cs.id, cs.series_source_id
    FROM chapter_sources cs
    LEFT JOIN series_sources ss ON cs.series_source_id = ss.id
    WHERE ss.id IS NULL
    LIMIT ${limit}
  `;
  
  let chaptersFixed = 0;
  if (fix && orphanedChapters.length > 0) {
    await prisma.chapterSource.deleteMany({
      where: { id: { in: orphanedChapters.map((c: any) => c.id) } },
    });
    chaptersFixed = orphanedChapters.length;
  }
  
  results.push({
    type: 'orphaned_chapter_sources',
    checked: limit,
    issues: orphanedChapters.length,
    fixed: chaptersFixed,
    errors: orphanedChapters.slice(0, 10).map((c: any) => `Chapter source ${c.id} references missing series source ${c.series_source_id}`),
  });

  // 4. Check for duplicate library entries
  const duplicateEntries = await prisma.$queryRaw<any[]>`
    SELECT user_id, series_id, COUNT(*) as count
    FROM library_entries
    WHERE series_id IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY user_id, series_id
    HAVING COUNT(*) > 1
    LIMIT ${limit}
  `;
  
  results.push({
    type: 'duplicate_library_entries',
    checked: limit,
    issues: duplicateEntries.length,
    fixed: 0, // Duplicate fixing is complex, handled separately
    errors: duplicateEntries.slice(0, 10).map((d: any) => `User ${d.user_id} has ${d.count} entries for series ${d.series_id}`),
  });

  // 5. Check metadata status consistency
  const inconsistentMetadata = await prisma.$queryRaw<any[]>`
    SELECT id, series_id, metadata_status
    FROM library_entries
    WHERE series_id IS NOT NULL
      AND metadata_status != 'enriched'
      AND deleted_at IS NULL
    LIMIT ${limit}
  `;
  
  let metadataFixed = 0;
  if (fix && inconsistentMetadata.length > 0) {
    await prisma.libraryEntry.updateMany({
      where: { id: { in: inconsistentMetadata.map((e: any) => e.id) } },
      data: { metadata_status: 'enriched' },
    });
    metadataFixed = inconsistentMetadata.length;
  }
  
  results.push({
    type: 'inconsistent_metadata_status',
    checked: limit,
    issues: inconsistentMetadata.length,
    fixed: metadataFixed,
    errors: inconsistentMetadata.slice(0, 10).map((e: any) => `Entry ${e.id} has series_id but status is ${e.metadata_status}`),
  });

  const totalIssues = results.reduce((sum, r) => sum + r.issues, 0);
  const totalFixed = results.reduce((sum, r) => sum + r.fixed, 0);
  const duration = Date.now() - startTime;

  return {
    success: totalIssues === 0 || (fix && totalFixed === totalIssues),
    results,
    summary: {
      totalIssues,
      totalFixed,
      duration,
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const V5AuditBugFixes81To100 = {
  // Bug 81
  RESOLUTION_THRESHOLDS,
  getResolutionStrategy,
  
  // Bug 82
  METADATA_STATUS_VALUES,
  MetadataStatusSchema,
  validateMetadataStatus,
  isValidMetadataStatus,
  SYNC_PRIORITY_VALUES,
  SyncPrioritySchema,
  CATALOG_TIER_VALUES,
  CatalogTierSchema,
  SOURCE_STATUS_VALUES,
  SourceStatusSchema,
  
  // Bug 83
  UnrecoverableError,
  TransientError,
  
  // Bug 84
  TimestampProvider,
  calculateRetryDelay,
  
  // Bug 85
  generateSearchCacheKey,
  generateLibraryCacheKey,
  
  // Bug 86
  LibraryEntryResponseSchema,
  SeriesResponseSchema,
  createApiResponse,
  createErrorResponse,
  validateApiResponse,
  
  // Bug 87
  DEFAULT_FETCH_RETRY_CONFIG,
  fetchWithRetry,
  
  // Bug 88
  LibraryStateManager,
  libraryStateManager,
  
  // Bug 89
  redactString,
  redactObject,
  SecureLogger,
  secureLogger,
  
  // Bug 90
  withSoftDeleteFilter,
  validateScriptQuery,
  safeScriptQuery,
  
  // Bug 91
  FEATURE_FLAGS,
  getFeatureFlag,
  validateTestEnvironmentFlags,
  
  // Bug 92
  safeGet,
  safeArrayAccess,
  getOrDefault,
  
  // Bug 93
  getPrismaSchemaHash,
  checkPrismaFreshness,
  
  // Bug 94
  PrismaLifecycleManager,
  
  // Bug 95
  acquireCronLock,
  releaseCronLock,
  
  // Bug 96
  JobMetricsCollector,
  jobMetricsCollector,
  
  // Bug 97
  QUEUE_HEALTH_THRESHOLDS,
  checkQueueHealth,
  
  // Bug 98
  RETRY_HISTORY_LIMITS,
  pruneRetryHistory,
  
  // Bug 99
  validateSourceSeriesConsistency,
  
  // Bug 100
  runConsistencyVerification,
};

export default V5AuditBugFixes81To100;
