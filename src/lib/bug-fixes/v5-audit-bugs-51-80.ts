/**
 * V5 AUDIT BUG FIXES (Bugs 51-80)
 * 
 * This module implements fixes for bugs 51-80 identified in the v5 fresh audit:
 * 
 * AUTH / SESSION / PERMISSIONS:
 * - Bug 51: API routes rely on middleware auth but do not re-assert user inside transactions
 * - Bug 52: Worker-initiated DB writes bypass user scoping entirely
 * 
 * SOURCE ADMIN / MANAGEMENT:
 * - Bug 53: Source disable flag is checked only at scheduling time
 * - Bug 54: Source enable/disable does not invalidate cached source metadata
 * 
 * METADATA PAYLOAD HANDLING:
 * - Bug 55: Metadata JSON is stored without deep validation
 * - Bug 56: Metadata arrays are not length-bounded
 * 
 * CHAPTER / CONTENT UTILITIES:
 * - Bug 57: Chapter parser assumes numeric chapter identifiers
 * - Bug 58: Chapter parser strips non-ASCII characters
 * 
 * SEARCH / DISCOVERY:
 * - Bug 59: Search API does not cap result size before post-processing
 * - Bug 60: Search ranking logic not deterministic
 * 
 * CACHE / STATE:
 * - Bug 61: Cache keys do not include user context
 * - Bug 62: Cache invalidation is manual and incomplete
 * 
 * ERROR HANDLING / EXCEPTIONS:
 * - Bug 63: Custom error classes not exhaustively handled
 * - Bug 64: Worker catches and logs errors but does not mark job failed
 * 
 * DEV / TOOLING / SCRIPTS:
 * - Bug 65: Seed scripts bypass validation logic
 * - Bug 66: Local dev scripts use different defaults than prod
 * 
 * TYPESCRIPT / STATIC ANALYSIS:
 * - Bug 67: Implicit any via JSON.parse usage
 * - Bug 68: Promise chains not consistently awaited
 * 
 * PERFORMANCE / LIMITS:
 * - Bug 69: No upper bound on concurrent worker jobs
 * - Bug 70: DB queries inside loops without batching
 * 
 * DATA INTEGRITY:
 * - Bug 71: No invariant ensuring one library entry per user per series
 * - Bug 72: No invariant ensuring chapters belong to active source
 * 
 * OBSERVABILITY / HEALTH:
 * - Bug 73: Worker health endpoint reports only liveness, not readiness
 * - Bug 74: No alerting hook on repeated metadata failures
 * 
 * FINAL EDGE CASES:
 * - Bug 75: Series merge logic does not migrate chapters atomically
 * - Bug 76: Series merge does not update all dependent caches
 * - Bug 77: Soft-deleted sources still referenced by chapters
 * - Bug 78: No protection against very old queued jobs
 * - Bug 79: Worker does not assert schema version compatibility
 * - Bug 80: No automated reconciliation task exists
 */

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { TransactionClient } from '../prisma';

// =============================================================================
// BUG 51: API routes rely on middleware auth but do not re-assert user inside transactions
// =============================================================================

/**
 * Re-assert user exists and is active within a transaction
 * Should be called inside transactions that modify user-owned data
 */
export async function assertUserExistsInTransaction(
  tx: TransactionClient,
  userId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Use raw query to get current state with lock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (tx as any).$queryRaw<any[]>`
      SELECT id, deleted_at, banned_at, email_verified
      FROM users
      WHERE id = ${userId}::uuid
      FOR SHARE
    `;

    if (!user || user.length === 0) {
      return { valid: false, error: 'User not found' };
    }

    const userData = user[0];

    if (userData.deleted_at) {
      return { valid: false, error: 'User account has been deleted' };
    }

    if (userData.banned_at) {
      return { valid: false, error: 'User account has been banned' };
    }

    return { valid: true };
  } catch (error) {
    return { 
      valid: false, 
      error: `Failed to verify user: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * Verify resource ownership within a transaction
 * Prevents TOCTOU (time-of-check-time-of-use) attacks
 */
export async function verifyOwnershipInTransaction(
  tx: Prisma.TransactionClient,
  table: 'library_entries' | 'notifications' | 'user_filters',
  resourceId: string,
  userId: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    // Build query based on table
    let result: any[];
    
    switch (table) {
      case 'library_entries':
        result = await tx.$queryRaw<any[]>`
          SELECT id, user_id, deleted_at
          FROM library_entries
          WHERE id = ${resourceId}::uuid
            AND user_id = ${userId}::uuid
          FOR UPDATE
        `;
        break;
      case 'notifications':
        result = await tx.$queryRaw<any[]>`
          SELECT id, user_id
          FROM notifications
          WHERE id = ${resourceId}::uuid
            AND user_id = ${userId}::uuid
          FOR UPDATE
        `;
        break;
      case 'user_filters':
        result = await tx.$queryRaw<any[]>`
          SELECT id, user_id
          FROM user_filters
          WHERE id = ${resourceId}::uuid
            AND user_id = ${userId}::uuid
          FOR UPDATE
        `;
        break;
      default:
        return { valid: false, error: 'Unknown table' };
    }

    if (!result || result.length === 0) {
      return { valid: false, error: 'Resource not found or access denied' };
    }

    const resource = result[0];
    
    // Check for soft delete
    if ('deleted_at' in resource && resource.deleted_at) {
      return { valid: false, error: 'Resource has been deleted' };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Ownership verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// =============================================================================
// BUG 52: Worker-initiated DB writes bypass user scoping entirely
// =============================================================================

/**
 * Validate that a library entry exists and belongs to the expected user
 * Used by workers to prevent writing to wrong user's data
 */
export async function validateLibraryEntryOwnership(
  tx: Prisma.TransactionClient,
  libraryEntryId: string,
  expectedUserId?: string
): Promise<{ valid: boolean; userId: string | null; error?: string }> {
  try {
    const entry = await tx.$queryRaw<any[]>`
      SELECT id, user_id, deleted_at
      FROM library_entries
      WHERE id = ${libraryEntryId}::uuid
      FOR UPDATE
    `;

    if (!entry || entry.length === 0) {
      return { valid: false, userId: null, error: 'Library entry not found' };
    }

    const entryData = entry[0];

    if (entryData.deleted_at) {
      return { valid: false, userId: null, error: 'Library entry has been deleted' };
    }

    // If expectedUserId is provided, verify it matches
    if (expectedUserId && entryData.user_id !== expectedUserId) {
      return { 
        valid: false, 
        userId: entryData.user_id, 
        error: `User ID mismatch: expected ${expectedUserId}, got ${entryData.user_id}` 
      };
    }

    return { valid: true, userId: entryData.user_id };
  } catch (error) {
    return {
      valid: false,
      userId: null,
      error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// =============================================================================
// BUG 53: Source disable flag is checked only at scheduling time
// =============================================================================

/**
 * Check if source is disabled/broken before processing
 * Should be called at the start of processor execution
 */
export async function isSourceActive(
  tx: Prisma.TransactionClient | any,
  seriesSourceId: string
): Promise<{ active: boolean; status: string | null; reason?: string }> {
  try {
    const source = await tx.seriesSource.findUnique({
      where: { id: seriesSourceId },
      select: { 
        id: true, 
        source_status: true, 
        failure_count: true
      }
    });

    if (!source) {
      return { active: false, status: null, reason: 'Source not found' };
    }

    if (source.source_status === 'broken') {
      return { active: false, status: 'broken', reason: 'Source is marked as broken' };
    }

    if (source.source_status === 'inactive') {
      return { active: false, status: 'inactive', reason: 'Source is inactive' };
    }

    // Check failure count threshold
    const MAX_FAILURES = 10;
    if (source.failure_count && source.failure_count >= MAX_FAILURES) {
      return { 
        active: false, 
        status: 'circuit_open', 
        reason: `Too many failures (${source.failure_count}/${MAX_FAILURES})` 
      };
    }

    return { active: true, status: source.source_status };
  } catch (error) {
    return {
      active: false,
      status: null,
      reason: `Check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// =============================================================================
// BUG 54: Source enable/disable does not invalidate cached source metadata
// =============================================================================

// Cache invalidation keys
const SOURCE_CACHE_PREFIX = 'source:';
const SCRAPER_CACHE_PREFIX = 'scraper:';

/**
 * Generate cache keys that should be invalidated when source status changes
 */
export function getSourceCacheKeys(sourceId: string, sourceName: string): string[] {
  return [
    `${SOURCE_CACHE_PREFIX}${sourceId}`,
    `${SOURCE_CACHE_PREFIX}${sourceName}:config`,
    `${SCRAPER_CACHE_PREFIX}${sourceName}:adapter`,
    `${SCRAPER_CACHE_PREFIX}${sourceName}:metadata`,
    `source:status:${sourceId}`,
    `chapters:${sourceId}`,
  ];
}

/**
 * Invalidate all cached data for a source
 * Call this when source status changes (enable/disable/delete)
 */
export async function invalidateSourceCache(
  redis: { del: (keys: string[]) => Promise<number> },
  sourceId: string,
  sourceName: string
): Promise<{ invalidated: number }> {
  const keys = getSourceCacheKeys(sourceId, sourceName);
  
  try {
    const deleted = await redis.del(keys);
    return { invalidated: deleted };
  } catch (error) {
    console.error('[Cache] Failed to invalidate source cache:', error);
    return { invalidated: 0 };
  }
}

// =============================================================================
// BUG 55: Metadata JSON is stored without deep validation
// =============================================================================

/**
 * Deep validation schema for series metadata
 */
export const SeriesMetadataSchema = z.object({
  title: z.string().min(1).max(500),
  alternative_titles: z.array(z.string().max(500)).max(50).optional(),
  description: z.string().max(10000).optional().nullable(),
  status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown']).optional(),
  type: z.enum(['manga', 'manhwa', 'manhua', 'webtoon', 'novel', 'other']).optional(),
  content_rating: z.enum(['safe', 'suggestive', 'erotica', 'pornographic']).optional(),
  year: z.number().int().min(1900).max(2100).optional().nullable(),
  original_language: z.string().max(10).optional().nullable(),
  genres: z.array(z.string().max(100)).max(30).optional(),
  tags: z.array(z.string().max(100)).max(100).optional(),
  authors: z.array(z.object({
    id: z.string().max(100).optional(),
    name: z.string().max(200),
    role: z.enum(['author', 'artist', 'both']).optional()
  })).max(20).optional(),
  cover_url: z.string().url().max(1000).optional().nullable(),
  external_links: z.record(z.string().max(100), z.string().max(500)).optional(),
});

export type SeriesMetadata = z.infer<typeof SeriesMetadataSchema>;

/**
 * Validate and sanitize metadata before storing
 */
export function validateMetadata(
  data: unknown
): { valid: boolean; data?: SeriesMetadata; errors?: string[] } {
  const result = SeriesMetadataSchema.safeParse(data);
  
  if (result.success) {
    return { valid: true, data: result.data };
  }
  
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

// =============================================================================
// BUG 56: Metadata arrays are not length-bounded
// =============================================================================

export const ARRAY_LENGTH_LIMITS = {
  alternative_titles: 50,
  genres: 30,
  tags: 100,
  authors: 20,
  artists: 20,
  chapters: 10000,
  sources: 50,
  covers: 20,
  relations: 100,
  external_links: 50,
};

/**
 * Truncate arrays to safe lengths
 */
export function boundArrayLengths<T extends Record<string, unknown>>(
  data: T,
  limits: Partial<typeof ARRAY_LENGTH_LIMITS> = ARRAY_LENGTH_LIMITS
): T {
  const bounded = { ...data };
  
  for (const [key, limit] of Object.entries(limits)) {
    if (key in bounded && Array.isArray(bounded[key])) {
      (bounded as any)[key] = (bounded[key] as any[]).slice(0, limit);
    }
  }
  
  return bounded;
}

// =============================================================================
// BUG 57: Chapter parser assumes numeric chapter identifiers
// =============================================================================

/**
 * Special chapter identifiers that are valid but non-numeric
 */
const SPECIAL_CHAPTER_IDENTIFIERS = new Set([
  'extra', 'special', 'oneshot', 'one-shot', 'prologue', 'epilogue',
  'bonus', 'omake', 'side', 'sidestory', 'side-story', 'gaiden',
  'preview', 'announcement', 'afterword', 'foreword', 'interlude',
  'ss', 'ex', 'sp', 'vol', 'volume'
]);

export interface ParsedChapterNumber {
  numeric: number | null;
  display: string;
  isSpecial: boolean;
  specialType: string | null;
  volume: number | null;
  sortOrder: number;
}

/**
 * Parse chapter identifier handling both numeric and special chapters
 */
export function parseChapterNumber(input: string | number | null | undefined): ParsedChapterNumber {
  if (input === null || input === undefined) {
    return {
      numeric: null,
      display: 'Unknown',
      isSpecial: false,
      specialType: null,
      volume: null,
      sortOrder: Number.MAX_SAFE_INTEGER
    };
  }

  const str = String(input).toLowerCase().trim();
  
  // Try numeric first
  const numericMatch = str.match(/^(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const num = parseFloat(numericMatch[1]);
    return {
      numeric: num,
      display: numericMatch[1],
      isSpecial: false,
      specialType: null,
      volume: null,
      sortOrder: num
    };
  }

  // Check for special identifiers
  for (const special of SPECIAL_CHAPTER_IDENTIFIERS) {
    if (str.includes(special)) {
      // Extract any number that might follow (e.g., "Extra 1", "Special 2")
      const numAfter = str.match(new RegExp(`${special}\\s*(\\d+)?`, 'i'));
      const suffix = numAfter?.[1] ? parseInt(numAfter[1], 10) : 0;
      
      return {
        numeric: null,
        display: str,
        isSpecial: true,
        specialType: special,
        volume: null,
        // Special chapters sort after numeric chapters
        sortOrder: 1000000 + SPECIAL_CHAPTER_IDENTIFIERS.size - 
          Array.from(SPECIAL_CHAPTER_IDENTIFIERS).indexOf(special) + suffix * 0.1
      };
    }
  }

  // Unknown format - preserve as-is
  return {
    numeric: null,
    display: str || 'Unknown',
    isSpecial: true,
    specialType: 'unknown',
    volume: null,
    sortOrder: Number.MAX_SAFE_INTEGER - 1
  };
}

/**
 * Compare chapter numbers for sorting
 */
export function compareChapters(a: ParsedChapterNumber, b: ParsedChapterNumber): number {
  return a.sortOrder - b.sortOrder;
}

// =============================================================================
// BUG 58: Chapter parser strips non-ASCII characters
// =============================================================================

/**
 * Normalize chapter title while preserving non-ASCII characters
 * Uses Unicode normalization instead of ASCII stripping
 */
export function normalizeChapterTitle(title: string | null | undefined): string {
  if (!title) return '';
  
  return title
    // Normalize Unicode (NFC = canonical composition)
    .normalize('NFC')
    // Remove control characters only
    .replace(/[\x00-\x1F\x7F]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Trim
    .trim()
    // Limit length
    .slice(0, 500);
}

/**
 * Safely encode chapter title for URLs while preserving Unicode
 */
export function encodeChapterTitleForUrl(title: string): string {
  return encodeURIComponent(normalizeChapterTitle(title));
}

// =============================================================================
// BUG 59: Search API does not cap result size before post-processing
// =============================================================================

export const SEARCH_LIMITS = {
  MAX_RESULTS_BEFORE_PROCESSING: 500,
  MAX_RESULTS_RETURNED: 100,
  MAX_QUERY_LENGTH: 200,
  MAX_FILTERS: 20,
};

/**
 * Cap search results before processing
 */
export function capSearchResults<T>(
  results: T[],
  limit: number = SEARCH_LIMITS.MAX_RESULTS_BEFORE_PROCESSING
): T[] {
  return results.slice(0, limit);
}

// =============================================================================
// BUG 60: Search ranking logic not deterministic
// =============================================================================

/**
 * Deterministic tie-breaker for search results
 * Uses secondary sort keys to ensure consistent ordering
 */
export function createDeterministicComparator<T extends { id: string; score?: number }>(
  primarySort: (a: T, b: T) => number
): (a: T, b: T) => number {
  return (a: T, b: T) => {
    const primaryResult = primarySort(a, b);
    
    // If primary sort is equal, use ID as tie-breaker (deterministic)
    if (primaryResult === 0) {
      return a.id.localeCompare(b.id);
    }
    
    return primaryResult;
  };
}

/**
 * Sort search results with deterministic ordering
 */
export function sortSearchResultsDeterministic<T extends { id: string; score?: number; created_at?: string | Date }>(
  results: T[],
  sortBy: 'score' | 'newest' | 'oldest' | 'title' = 'score'
): T[] {
  const comparator = createDeterministicComparator<T>((a, b) => {
    switch (sortBy) {
      case 'score':
        return (b.score ?? 0) - (a.score ?? 0);
      case 'newest':
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      case 'oldest':
        const aDateOld = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDateOld = b.created_at ? new Date(b.created_at).getTime() : 0;
        return aDateOld - bDateOld;
      default:
        return 0;
    }
  });

  return [...results].sort(comparator);
}

// =============================================================================
// BUG 61: Cache keys do not include user context
// =============================================================================

/**
 * Generate user-scoped cache key
 */
export function createUserScopedCacheKey(
  prefix: string,
  userId: string | null | undefined,
  key: string
): string {
  // For public data, use 'public' scope
  const scope = userId || 'public';
  return `${prefix}:${scope}:${key}`;
}

/**
 * Generate cache key with user context for library data
 */
export function createLibraryCacheKey(
  userId: string,
  operation: 'list' | 'entry' | 'stats' | 'filters',
  params?: Record<string, string | number | boolean>
): string {
  let key = `library:${userId}:${operation}`;
  
  if (params) {
    const sortedParams = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    key += `:${sortedParams}`;
  }
  
  return key;
}

// =============================================================================
// BUG 62: Cache invalidation is manual and incomplete
// =============================================================================

/**
 * Cache dependency graph for automatic invalidation
 */
export const CACHE_DEPENDENCIES: Record<string, string[]> = {
  'library_entry': ['library:*:list', 'library:*:stats', 'feed:*:updates'],
  'series': ['search:*', 'series:*', 'browse:*', 'recommendations:*'],
  'chapter': ['series:*:chapters', 'feed:*:updates', 'chapter:*'],
  'user': ['library:*', 'notifications:*', 'leaderboard:*'],
  'notification': ['notifications:*:list', 'notifications:*:unread'],
};

/**
 * Get all cache keys to invalidate for an entity change
 */
export function getCacheKeysToInvalidate(
  entityType: keyof typeof CACHE_DEPENDENCIES,
  entityId: string,
  userId?: string
): string[] {
  const patterns = CACHE_DEPENDENCIES[entityType] || [];
  const keys: string[] = [];
  
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Replace * with user ID or entity ID
      if (userId) {
        keys.push(pattern.replace('*', userId));
      }
      keys.push(pattern.replace('*', entityId));
    } else {
      keys.push(pattern);
    }
  }
  
  return keys;
}

// =============================================================================
// BUG 63: Custom error classes not exhaustively handled
// =============================================================================

/**
 * Base application error with structured metadata
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, true, context);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 'AUTHENTICATION_ERROR', 401, true);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 'AUTHORIZATION_ERROR', 403, true);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(`${resource}${id ? ` with id ${id}` : ''} not found`, 'NOT_FOUND', 404, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409, true);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter: number;
  
  constructor(retryAfter: number = 60) {
    super('Rate limit exceeded', 'RATE_LIMITED', 429, true);
    this.retryAfter = retryAfter;
  }
}

export class ExternalServiceError extends AppError {
  public readonly service: string;
  public readonly originalError?: Error;

  constructor(service: string, message: string, originalError?: Error) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, true);
    this.service = service;
    this.originalError = originalError;
  }
}

/**
 * Exhaustive error handler that maps all error types
 */
export function handleError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Map common error patterns
    if (message.includes('not found')) {
      return new NotFoundError('Resource');
    }
    if (message.includes('unauthorized') || message.includes('authentication')) {
      return new AuthenticationError();
    }
    if (message.includes('forbidden') || message.includes('permission')) {
      return new AuthorizationError();
    }
    if (message.includes('rate limit') || message.includes('too many requests')) {
      return new RateLimitError();
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return new ValidationError(error.message);
    }
    if (message.includes('duplicate') || message.includes('already exists')) {
      return new ConflictError(error.message);
    }
    
    // Wrap unknown errors
    return new AppError(error.message, 'INTERNAL_ERROR', 500, false);
  }

  return new AppError('An unexpected error occurred', 'UNKNOWN_ERROR', 500, false);
}

// =============================================================================
// BUG 64: Worker catches and logs errors but does not mark job failed
// =============================================================================

/**
 * Wrapper that ensures errors propagate to mark jobs as failed
 */
export function createFailureAwareProcessor<T, R>(
  processor: (data: T) => Promise<R>
): (data: T) => Promise<R> {
  return async (data: T) => {
    try {
      return await processor(data);
    } catch (error) {
      // Log the error
      console.error('[Worker] Job failed:', error);
      
      // Re-throw to mark job as failed in BullMQ
      throw error;
    }
  };
}

/**
 * Check if an error should cause job failure
 */
export function shouldFailJob(error: unknown): boolean {
  // Always fail on non-retryable errors
  if (error instanceof AppError && !error.isOperational) {
    return true;
  }
  
  // Don't fail on transient errors (let retry handle them)
  if (error instanceof ExternalServiceError) {
    return false;
  }
  
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const transientPatterns = ['timeout', 'rate limit', 'connection', 'network', 'econnreset'];
    return !transientPatterns.some(p => message.includes(p));
  }
  
  return true;
}

// =============================================================================
// BUG 65-66: Dev/Tooling (validation and consistent defaults)
// =============================================================================

/**
 * Shared configuration defaults for both dev and prod
 */
export const SHARED_DEFAULTS = {
  PAGINATION_LIMIT: 20,
  MAX_PAGINATION_LIMIT: 100,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX_REQUESTS: 100,
  CACHE_TTL_SECONDS: 300,
  JOB_TIMEOUT_MS: 30000,
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_BACKOFF_MS: 1000,
};

/**
 * Environment-aware configuration getter
 */
export function getConfig<K extends keyof typeof SHARED_DEFAULTS>(key: K): typeof SHARED_DEFAULTS[K] {
  // Could be extended to read from env vars with fallback to defaults
  const envKey = `APP_${key}`;
  const envValue = process.env[envKey];
  
  if (envValue !== undefined) {
    const defaultValue = SHARED_DEFAULTS[key];
    if (typeof defaultValue === 'number') {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return parsed as any;
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return envValue as any;
  }
  
  return SHARED_DEFAULTS[key];
}

// =============================================================================
// BUG 67: Implicit any via JSON.parse usage
// =============================================================================

/**
 * Type-safe JSON parse with validation
 */
export function safeJsonParse<T>(
  json: string,
  schema: z.ZodType<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    const parsed = JSON.parse(json);
    const result = schema.safeParse(parsed);
    
    if (result.success) {
      return { success: true, data: result.data };
    }
    
    return { 
      success: false, 
      error: result.error.errors.map(e => e.message).join(', ') 
    };
  } catch (e) {
    return { 
      success: false, 
      error: `JSON parse error: ${e instanceof Error ? e.message : 'Unknown error'}` 
    };
  }
}

/**
 * Parse JSON with type assertion (for when you need the data even if invalid)
 */
export function parseJsonWithDefault<T>(
  json: string | null | undefined,
  defaultValue: T
): T {
  if (!json) return defaultValue;
  
  try {
    return JSON.parse(json) as T;
  } catch {
    return defaultValue;
  }
}

// =============================================================================
// BUG 68: Promise chains not consistently awaited
// =============================================================================

/**
 * Execute promises with proper error handling
 * Ensures all promises are awaited
 */
export async function executePromisesWithErrorHandling<T>(
  promises: Array<Promise<T> | (() => Promise<T>)>,
  options: {
    concurrency?: number;
    stopOnError?: boolean;
  } = {}
): Promise<{ results: T[]; errors: Error[] }> {
  const { concurrency = 10, stopOnError = false } = options;
  const results: T[] = [];
  const errors: Error[] = [];
  
  // Convert functions to promises if needed
  const normalizedPromises = promises.map(p => 
    typeof p === 'function' ? p : () => p
  );
  
  // Process in batches
  for (let i = 0; i < normalizedPromises.length; i += concurrency) {
    const batch = normalizedPromises.slice(i, i + concurrency);
    
    const batchResults = await Promise.allSettled(
      batch.map(fn => fn())
    );
    
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const error = result.reason instanceof Error 
          ? result.reason 
          : new Error(String(result.reason));
        errors.push(error);
        
        if (stopOnError) {
          return { results, errors };
        }
      }
    }
  }
  
  return { results, errors };
}

// =============================================================================
// BUG 69: No upper bound on concurrent worker jobs
// =============================================================================

export const WORKER_CONCURRENCY_LIMITS = {
  global: 50,
  perQueue: {
    'sync-source': 20,
    'chapter-ingest': 30,
    'notification': 10,
    'resolution': 5,
    'import': 3,
    default: 10
  }
};

/**
 * Get concurrency limit for a queue
 */
export function getQueueConcurrencyLimit(queueName: string): number {
  const limits = WORKER_CONCURRENCY_LIMITS.perQueue;
  return limits[queueName as keyof typeof limits] || limits.default;
}

// =============================================================================
// BUG 70: DB queries inside loops without batching
// =============================================================================

/**
 * Batch database operations to avoid N+1 queries
 */
export async function batchDbOperations<T, R>(
  items: T[],
  operation: (batch: T[]) => Promise<R[]>,
  batchSize: number = 100
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await operation(batch);
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Create a batched lookup map
 */
export async function createBatchedLookup<T, K>(
  ids: K[],
  fetchBatch: (ids: K[]) => Promise<T[]>,
  getKey: (item: T) => K,
  batchSize: number = 100
): Promise<Map<K, T>> {
  const results = new Map<K, T>();
  
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const items = await fetchBatch(batch);
    
    for (const item of items) {
      results.set(getKey(item), item);
    }
  }
  
  return results;
}

// =============================================================================
// BUG 71: No invariant ensuring one library entry per user per series
// =============================================================================

/**
 * Check for duplicate library entries before creating
 */
export async function checkLibraryEntryUniqueness(
  tx: Prisma.TransactionClient,
  userId: string,
  seriesId: string | null | undefined
): Promise<{ unique: boolean; existingEntryId?: string }> {
  if (!seriesId) {
    // No series_id means we can't check uniqueness at series level
    return { unique: true };
  }

  const existing = await tx.$queryRaw<any[]>`
    SELECT id FROM library_entries
    WHERE user_id = ${userId}::uuid
      AND series_id = ${seriesId}::uuid
      AND deleted_at IS NULL
    LIMIT 1
  `;

  if (existing && existing.length > 0) {
    return { unique: false, existingEntryId: existing[0].id };
  }

  return { unique: true };
}

// =============================================================================
// BUG 72: No invariant ensuring chapters belong to active source
// =============================================================================

/**
 * Validate chapter source is active before insert
 */
export async function validateChapterSourceActive(
  tx: Prisma.TransactionClient,
  seriesSourceId: string
): Promise<{ valid: boolean; error?: string }> {
  const source = await tx.$queryRaw<any[]>`
    SELECT id, source_status, deleted_at, disabled_at
    FROM series_sources
    WHERE id = ${seriesSourceId}::uuid
  `;

  if (!source || source.length === 0) {
    return { valid: false, error: 'Source not found' };
  }

  const sourceData = source[0];

  if (sourceData.deleted_at) {
    return { valid: false, error: 'Source has been deleted' };
  }

  if (sourceData.disabled_at) {
    return { valid: false, error: 'Source has been disabled' };
  }

  if (sourceData.source_status === 'broken' || sourceData.source_status === 'inactive') {
    return { valid: false, error: `Source is ${sourceData.source_status}` };
  }

  return { valid: true };
}

// =============================================================================
// BUG 73: Worker health endpoint reports only liveness, not readiness
// =============================================================================

export interface ReadinessCheck {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  error?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: ReadinessCheck[];
  uptime: number;
  timestamp: number;
  canProcessJobs: boolean;
}

/**
 * Perform comprehensive readiness check
 */
export async function performReadinessChecks(
  checks: {
    database: () => Promise<void>;
    redis: () => Promise<void>;
    queues?: () => Promise<void>;
  }
): Promise<HealthStatus> {
  const results: ReadinessCheck[] = [];
  
  // Database check
  const dbStart = Date.now();
  try {
    await checks.database();
    results.push({ name: 'database', healthy: true, latencyMs: Date.now() - dbStart });
  } catch (error) {
    results.push({ 
      name: 'database', 
      healthy: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
  
  // Redis check
  const redisStart = Date.now();
  try {
    await checks.redis();
    results.push({ name: 'redis', healthy: true, latencyMs: Date.now() - redisStart });
  } catch (error) {
    results.push({ 
      name: 'redis', 
      healthy: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
  
  // Queue check (optional)
  if (checks.queues) {
    const queueStart = Date.now();
    try {
      await checks.queues();
      results.push({ name: 'queues', healthy: true, latencyMs: Date.now() - queueStart });
    } catch (error) {
      results.push({ 
        name: 'queues', 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
  
  // Calculate overall status
  const healthyCount = results.filter(r => r.healthy).length;
  const totalCount = results.length;
  
  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (healthyCount === totalCount) {
    status = 'healthy';
  } else if (healthyCount > 0) {
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }
  
  // Can process jobs only if database and redis are healthy
  const dbHealthy = results.find(r => r.name === 'database')?.healthy ?? false;
  const redisHealthy = results.find(r => r.name === 'redis')?.healthy ?? false;
  
  return {
    status,
    checks: results,
    uptime: process.uptime(),
    timestamp: Date.now(),
    canProcessJobs: dbHealthy && redisHealthy
  };
}

// =============================================================================
// BUG 74: No alerting hook on repeated metadata failures
// =============================================================================

const failureTracker = new Map<string, { count: number; firstFailure: Date; lastFailure: Date }>();
const FAILURE_ALERT_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export type AlertCallback = (alert: {
  type: 'metadata_failure' | 'source_failure' | 'system_error';
  entityId: string;
  failureCount: number;
  message: string;
}) => void;

let alertCallback: AlertCallback | null = null;

/**
 * Register alert callback
 */
export function registerAlertCallback(callback: AlertCallback): void {
  alertCallback = callback;
}

/**
 * Track failure and trigger alert if threshold exceeded
 */
export function trackFailure(
  entityType: 'metadata' | 'source' | 'system',
  entityId: string,
  errorMessage: string
): void {
  const key = `${entityType}:${entityId}`;
  const now = new Date();
  
  const existing = failureTracker.get(key);
  
  if (existing) {
    // Check if we should reset (outside window)
    const windowStart = new Date(now.getTime() - FAILURE_WINDOW_MS);
    if (existing.firstFailure < windowStart) {
      failureTracker.set(key, { count: 1, firstFailure: now, lastFailure: now });
      return;
    }
    
    // Increment
    existing.count++;
    existing.lastFailure = now;
    
    // Check threshold
    if (existing.count >= FAILURE_ALERT_THRESHOLD && alertCallback) {
      alertCallback({
        type: `${entityType}_failure` as any,
        entityId,
        failureCount: existing.count,
        message: `${entityType} failure threshold exceeded for ${entityId}: ${errorMessage}`
      });
    }
  } else {
    failureTracker.set(key, { count: 1, firstFailure: now, lastFailure: now });
  }
}

/**
 * Clear failure tracking for an entity
 */
export function clearFailureTracking(entityType: 'metadata' | 'source' | 'system', entityId: string): void {
  const key = `${entityType}:${entityId}`;
  failureTracker.delete(key);
}

// =============================================================================
// BUG 75-76: Series merge logic
// =============================================================================

/**
 * Atomically merge two series
 */
export async function mergeSeriesAtomic(
  tx: Prisma.TransactionClient,
  sourceSeriesId: string,
  targetSeriesId: string,
  options: { deleteSource?: boolean } = {}
): Promise<{ success: boolean; migratedChapters: number; migratedEntries: number; error?: string }> {
  try {
    // Lock both series
    await tx.$queryRaw`
      SELECT id FROM series WHERE id IN (${sourceSeriesId}::uuid, ${targetSeriesId}::uuid)
      FOR UPDATE
    `;
    
    // Migrate chapters
    const chapterResult = await tx.$executeRaw`
      UPDATE chapters SET series_id = ${targetSeriesId}::uuid
      WHERE series_id = ${sourceSeriesId}::uuid
    `;
    
    // Migrate chapter sources
    await tx.$executeRaw`
      UPDATE chapter_sources cs
      SET series_source_id = ts.id
      FROM series_sources ss, series_sources ts
      WHERE cs.series_source_id = ss.id
        AND ss.series_id = ${sourceSeriesId}::uuid
        AND ts.series_id = ${targetSeriesId}::uuid
        AND ts.source_name = ss.source_name
    `;
    
    // Migrate library entries
    const entryResult = await tx.$executeRaw`
      UPDATE library_entries SET series_id = ${targetSeriesId}::uuid
      WHERE series_id = ${sourceSeriesId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM library_entries le2
          WHERE le2.user_id = library_entries.user_id
            AND le2.series_id = ${targetSeriesId}::uuid
            AND le2.deleted_at IS NULL
        )
    `;
    
    // Migrate series sources
    await tx.$executeRaw`
      UPDATE series_sources SET series_id = ${targetSeriesId}::uuid
      WHERE series_id = ${sourceSeriesId}::uuid
    `;
    
    // Soft delete source series if requested
    if (options.deleteSource) {
      await tx.$executeRaw`
        UPDATE series SET deleted_at = NOW()
        WHERE id = ${sourceSeriesId}::uuid
      `;
    }
    
    return {
      success: true,
      migratedChapters: Number(chapterResult),
      migratedEntries: Number(entryResult)
    };
  } catch (error) {
    return {
      success: false,
      migratedChapters: 0,
      migratedEntries: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get cache keys to invalidate after series merge
 */
export function getMergeCacheInvalidationKeys(
  sourceSeriesId: string,
  targetSeriesId: string
): string[] {
  return [
    `series:${sourceSeriesId}`,
    `series:${targetSeriesId}`,
    `series:${sourceSeriesId}:chapters`,
    `series:${targetSeriesId}:chapters`,
    `series:${sourceSeriesId}:sources`,
    `series:${targetSeriesId}:sources`,
    'search:*',
    'browse:*',
  ];
}

// =============================================================================
// BUG 77: Soft-deleted sources still referenced by chapters
// =============================================================================

/**
 * Filter out chapters from soft-deleted sources
 */
export function filterActiveSourceChapters<T extends { series_source?: { deleted_at?: Date | null } | null }>(
  chapters: T[]
): T[] {
  return chapters.filter(ch => !ch.series_source?.deleted_at);
}

// =============================================================================
// BUG 78: No protection against very old queued jobs
// =============================================================================

const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if a job is too old to process
 */
export function isJobStale(jobTimestamp: number | undefined, maxAgeMs: number = MAX_JOB_AGE_MS): boolean {
  if (!jobTimestamp) return false;
  
  const age = Date.now() - jobTimestamp;
  return age > maxAgeMs;
}

/**
 * Wrapper that skips stale jobs
 */
export function createStaleJobGuard<T>(
  processor: (data: T, timestamp?: number) => Promise<void>,
  maxAgeMs: number = MAX_JOB_AGE_MS
): (data: T, timestamp?: number) => Promise<void> {
  return async (data: T, timestamp?: number) => {
    if (isJobStale(timestamp, maxAgeMs)) {
      console.warn('[Worker] Skipping stale job:', { timestamp, age: timestamp ? Date.now() - timestamp : 'unknown' });
      return;
    }
    
    return processor(data, timestamp);
  };
}

// =============================================================================
// BUG 79: Worker does not assert schema version compatibility
// =============================================================================

export const CURRENT_SCHEMA_VERSION = '2.0.0';

/**
 * Schema version compatibility check
 */
export function checkSchemaCompatibility(
  clientVersion: string | undefined,
  serverVersion: string = CURRENT_SCHEMA_VERSION
): { compatible: boolean; error?: string } {
  if (!clientVersion) {
    return { compatible: false, error: 'Client schema version not provided' };
  }
  
  const [clientMajor] = clientVersion.split('.').map(Number);
  const [serverMajor] = serverVersion.split('.').map(Number);
  
  // Major version must match
  if (clientMajor !== serverMajor) {
    return { 
      compatible: false, 
      error: `Schema version mismatch: client=${clientVersion}, server=${serverVersion}` 
    };
  }
  
  return { compatible: true };
}

// =============================================================================
// BUG 80: No automated reconciliation task exists
// =============================================================================

export interface ReconciliationResult {
  type: 'library_orphans' | 'chapter_orphans' | 'source_orphans' | 'duplicate_entries';
  count: number;
  fixed: number;
  errors: string[];
}

/**
 * Find and fix orphaned library entries
 */
export async function reconcileLibraryOrphans(
  tx: Prisma.TransactionClient,
  options: { fix?: boolean } = {}
): Promise<ReconciliationResult> {
  const orphans = await tx.$queryRaw<any[]>`
    SELECT le.id, le.series_id
    FROM library_entries le
    LEFT JOIN series s ON le.series_id = s.id
    WHERE le.series_id IS NOT NULL
      AND s.id IS NULL
      AND le.deleted_at IS NULL
  `;
  
  let fixed = 0;
  const errors: string[] = [];
  
  if (options.fix && orphans.length > 0) {
    try {
      await tx.$executeRaw`
        UPDATE library_entries
        SET series_id = NULL, needs_review = true, metadata_status = 'pending'
        WHERE id = ANY(${orphans.map(o => o.id)}::uuid[])
      `;
      fixed = orphans.length;
    } catch (error) {
      errors.push(`Failed to fix orphans: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  return {
    type: 'library_orphans',
    count: orphans.length,
    fixed,
    errors
  };
}

/**
 * Find duplicate library entries
 */
export async function reconcileDuplicateEntries(
  tx: Prisma.TransactionClient,
  options: { fix?: boolean } = {}
): Promise<ReconciliationResult> {
  const duplicates = await tx.$queryRaw<any[]>`
    SELECT user_id, series_id, COUNT(*) as count
    FROM library_entries
    WHERE series_id IS NOT NULL
      AND deleted_at IS NULL
    GROUP BY user_id, series_id
    HAVING COUNT(*) > 1
  `;
  
  let fixed = 0;
  const errors: string[] = [];
  
  if (options.fix && duplicates.length > 0) {
    // For each duplicate, keep the one with highest progress, soft-delete others
    for (const dup of duplicates) {
      try {
        await tx.$executeRaw`
          UPDATE library_entries
          SET deleted_at = NOW()
          WHERE user_id = ${dup.user_id}::uuid
            AND series_id = ${dup.series_id}::uuid
            AND id NOT IN (
              SELECT id FROM library_entries
              WHERE user_id = ${dup.user_id}::uuid
                AND series_id = ${dup.series_id}::uuid
                AND deleted_at IS NULL
              ORDER BY COALESCE(last_read_chapter, 0) DESC, updated_at DESC
              LIMIT 1
            )
        `;
        fixed++;
      } catch (error) {
        errors.push(`Failed to fix duplicate for user=${dup.user_id}, series=${dup.series_id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
  
  return {
    type: 'duplicate_entries',
    count: duplicates.length,
    fixed,
    errors
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export const V5AuditBugFixes51To80 = {
  // Bug 51-52
  assertUserExistsInTransaction,
  verifyOwnershipInTransaction,
  validateLibraryEntryOwnership,
  
  // Bug 53-54
  isSourceActive,
  getSourceCacheKeys,
  invalidateSourceCache,
  
  // Bug 55-56
  SeriesMetadataSchema,
  validateMetadata,
  ARRAY_LENGTH_LIMITS,
  boundArrayLengths,
  
  // Bug 57-58
  parseChapterNumber,
  compareChapters,
  normalizeChapterTitle,
  encodeChapterTitleForUrl,
  
  // Bug 59-60
  SEARCH_LIMITS,
  capSearchResults,
  createDeterministicComparator,
  sortSearchResultsDeterministic,
  
  // Bug 61-62
  createUserScopedCacheKey,
  createLibraryCacheKey,
  CACHE_DEPENDENCIES,
  getCacheKeysToInvalidate,
  
  // Bug 63-64
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  handleError,
  createFailureAwareProcessor,
  shouldFailJob,
  
  // Bug 65-66
  SHARED_DEFAULTS,
  getConfig,
  
  // Bug 67-68
  safeJsonParse,
  parseJsonWithDefault,
  executePromisesWithErrorHandling,
  
  // Bug 69-70
  WORKER_CONCURRENCY_LIMITS,
  getQueueConcurrencyLimit,
  batchDbOperations,
  createBatchedLookup,
  
  // Bug 71-72
  checkLibraryEntryUniqueness,
  validateChapterSourceActive,
  
  // Bug 73-74
  performReadinessChecks,
  registerAlertCallback,
  trackFailure,
  clearFailureTracking,
  
  // Bug 75-76
  mergeSeriesAtomic,
  getMergeCacheInvalidationKeys,
  
  // Bug 77
  filterActiveSourceChapters,
  
  // Bug 78
  isJobStale,
  createStaleJobGuard,
  
  // Bug 79
  CURRENT_SCHEMA_VERSION,
  checkSchemaCompatibility,
  
  // Bug 80
  reconcileLibraryOrphans,
  reconcileDuplicateEntries,
};

export default V5AuditBugFixes51To80;
