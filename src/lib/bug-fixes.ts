/**
 * BUG FIXES UTILITY LIBRARY
 * 
 * This file contains comprehensive fixes for the remaining EXISTS bugs:
 * - Bug 103-104: Unicode/locale normalization
 * - Bug 115-116: Multi-source metadata reconciliation
 * - Bug 117: Status regression prevention
 * - Bug 123: Progress bounds checking
 * - Bug 173: Adaptive scheduling
 * - Bug 191: Environment validation
 * 
 * Also includes validation and utilities for PARTIALLY_FIXED bugs
 */

import { z } from 'zod';
import { logger } from './logger';

// ============================================================================
// BUG 103-104: UNICODE/LOCALE NORMALIZATION
// ============================================================================

/**
 * Normalizes a string for consistent comparison across locales.
 * 
 * Bug 103: Alt-title normalization not locale-safe
 * Bug 104: Unicode normalization not applied before similarity scoring
 * 
 * Steps:
 * 1. Apply NFD normalization to decompose characters
 * 2. Remove combining diacritical marks
 * 3. Apply NFC normalization for consistent representation
 * 4. Convert to lowercase using locale-aware method
 * 5. Normalize whitespace
 */
export function normalizeForComparison(str: string, locale: string = 'en'): string {
  if (!str) return '';
  
  try {
    return str
      // Step 1: NFD decomposition (separate base characters from diacritics)
      .normalize('NFD')
      // Step 2: Remove combining diacritical marks (accents, etc.)
      .replace(/[\u0300-\u036f]/g, '')
      // Step 3: NFC normalization for consistent representation
      .normalize('NFC')
      // Step 4: Locale-aware lowercase
      .toLocaleLowerCase(locale)
      // Step 5: Normalize whitespace (collapse multiple spaces, trim)
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    // Fallback for environments without full Unicode support
    return str.toLowerCase().trim();
  }
}

/**
 * Removes punctuation from a string for cleaner similarity comparison.
 * 
 * Bug 105: Similarity scoring sensitive to punctuation ordering
 */
export function removePunctuation(str: string): string {
  if (!str) return '';
  return str.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Prepares a title for similarity matching with full normalization.
 */
export function prepareForSimilarity(title: string, locale: string = 'en'): string {
  const normalized = normalizeForComparison(title, locale);
  return removePunctuation(normalized);
}

/**
 * Calculates string similarity with proper Unicode handling.
 * Uses Sørensen–Dice coefficient for better fuzzy matching.
 */
export function calculateNormalizedSimilarity(a: string, b: string, locale: string = 'en'): number {
  const normA = prepareForSimilarity(a, locale);
  const normB = prepareForSimilarity(b, locale);
  
  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;
  
  // Create bigrams
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  
  for (let i = 0; i < normA.length - 1; i++) {
    bigramsA.add(normA.slice(i, i + 2));
  }
  
  for (let i = 0; i < normB.length - 1; i++) {
    bigramsB.add(normB.slice(i, i + 2));
  }
  
  // Calculate intersection
  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) intersection++;
  }
  
  // Sørensen–Dice coefficient
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// ============================================================================
// BUG 115-116: MULTI-SOURCE METADATA RECONCILIATION
// ============================================================================

/**
 * Metadata source priority (higher = more authoritative)
 */
export const METADATA_SOURCE_PRIORITY: Record<string, number> = {
  'USER_OVERRIDE': 100,  // Always highest - user manually set
  'ANILIST': 80,         // Highly curated
  'MYANIMELIST': 75,     // Well-maintained
  'MANGADEX': 70,        // Good community curation
  'MANGAUPDATES': 65,    // Good for publication info
  'CANONICAL': 60,       // Generic canonical source
  'INFERRED': 10,        // Auto-detected, lowest confidence
};

/**
 * Interface for metadata from any source
 */
export interface SourceMetadata {
  source: string;
  title?: string;
  description?: string;
  cover_url?: string;
  status?: string;
  genres?: string[];
  tags?: string[];
  authors?: string[];
  artists?: string[];
  year?: number;
  original_language?: string;
  confidence?: number;
  updated_at?: Date;
}

/**
 * Reconciles metadata from multiple sources deterministically.
 * 
 * Bug 115: Multiple metadata sources not reconciled deterministically
 * Bug 116: Metadata conflict resolution not defined
 * 
 * Rules:
 * 1. USER_OVERRIDE always wins
 * 2. Higher priority source wins for conflicts
 * 3. For same priority, more recent update wins
 * 4. For arrays (genres, tags), merge and dedupe
 * 5. For confidence, use weighted average
 */
export function reconcileMetadata(sources: SourceMetadata[]): SourceMetadata {
  if (sources.length === 0) {
    return { source: 'UNKNOWN' };
  }
  
  if (sources.length === 1) {
    return sources[0];
  }
  
  // Sort by priority (descending) then by updated_at (descending)
  const sorted = [...sources].sort((a, b) => {
    const priorityA = METADATA_SOURCE_PRIORITY[a.source] || 0;
    const priorityB = METADATA_SOURCE_PRIORITY[b.source] || 0;
    
    if (priorityA !== priorityB) {
      return priorityB - priorityA;
    }
    
    // Same priority: use more recent update
    const dateA = a.updated_at?.getTime() || 0;
    const dateB = b.updated_at?.getTime() || 0;
    return dateB - dateA;
  });
  
  // Check for USER_OVERRIDE first - it always wins completely
  const userOverride = sorted.find(s => s.source === 'USER_OVERRIDE');
  if (userOverride) {
    return userOverride;
  }
  
  // Reconcile fields
  const result: SourceMetadata = {
    source: sorted[0].source,
    confidence: 0,
  };
  
  // Helper to get first non-empty value from sorted sources
  const getFirst = <T>(getter: (s: SourceMetadata) => T | undefined): T | undefined => {
    for (const source of sorted) {
      const val = getter(source);
      if (val !== undefined && val !== null && val !== '') {
        return val;
      }
    }
    return undefined;
  };
  
  // Scalar fields: use highest priority source
  result.title = getFirst(s => s.title);
  result.description = getFirst(s => s.description);
  result.cover_url = getFirst(s => s.cover_url);
  result.status = getFirst(s => s.status);
  result.year = getFirst(s => s.year);
  result.original_language = getFirst(s => s.original_language);
  
  // Array fields: merge and dedupe
  const mergeArrays = (getter: (s: SourceMetadata) => string[] | undefined): string[] => {
    const all = new Set<string>();
    for (const source of sorted) {
      const arr = getter(source);
      if (arr) {
        arr.forEach(item => all.add(normalizeForComparison(item)));
      }
    }
    return Array.from(all);
  };
  
  result.genres = mergeArrays(s => s.genres);
  result.tags = mergeArrays(s => s.tags);
  result.authors = mergeArrays(s => s.authors);
  result.artists = mergeArrays(s => s.artists);
  
  // Calculate weighted confidence
  let totalWeight = 0;
  let weightedConfidence = 0;
  
  for (const source of sorted) {
    const priority = METADATA_SOURCE_PRIORITY[source.source] || 1;
    const confidence = source.confidence || 0.5;
    totalWeight += priority;
    weightedConfidence += priority * confidence;
  }
  
  result.confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0.5;
  result.updated_at = new Date();
  
  return result;
}

// ============================================================================
// BUG 117: STATUS REGRESSION PREVENTION
// ============================================================================

/**
 * Valid series status values
 */
export const SERIES_STATUS = {
  ONGOING: 'ongoing',
  HIATUS: 'hiatus',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  UNKNOWN: 'unknown',
} as const;

export type SeriesStatus = typeof SERIES_STATUS[keyof typeof SERIES_STATUS];

/**
 * Status transition rules.
 * Key is current status, value is array of allowed new statuses.
 * 
 * Bug 117: Series status (ongoing/completed) can regress
 */
const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  [SERIES_STATUS.UNKNOWN]: [SERIES_STATUS.ONGOING, SERIES_STATUS.HIATUS, SERIES_STATUS.COMPLETED, SERIES_STATUS.CANCELLED, SERIES_STATUS.UNKNOWN],
  [SERIES_STATUS.ONGOING]: [SERIES_STATUS.ONGOING, SERIES_STATUS.HIATUS, SERIES_STATUS.COMPLETED, SERIES_STATUS.CANCELLED],
  [SERIES_STATUS.HIATUS]: [SERIES_STATUS.HIATUS, SERIES_STATUS.ONGOING, SERIES_STATUS.COMPLETED, SERIES_STATUS.CANCELLED],
  [SERIES_STATUS.COMPLETED]: [SERIES_STATUS.COMPLETED], // Cannot regress from completed
  [SERIES_STATUS.CANCELLED]: [SERIES_STATUS.CANCELLED], // Cannot regress from cancelled
};

/**
 * Checks if a status transition is valid.
 */
export function isValidStatusTransition(currentStatus: string | null | undefined, newStatus: string): boolean {
  const current = currentStatus || SERIES_STATUS.UNKNOWN;
  const allowed = VALID_STATUS_TRANSITIONS[current] || [];
  return allowed.includes(newStatus);
}

/**
 * Validates and returns the appropriate status, preventing regression.
 * Returns the new status if valid, otherwise returns the current status.
 */
export function validateStatusTransition(
  currentStatus: string | null | undefined,
  newStatus: string | null | undefined
): string {
  if (!newStatus) {
    return currentStatus || SERIES_STATUS.UNKNOWN;
  }
  
  const current = currentStatus || SERIES_STATUS.UNKNOWN;
  
  if (isValidStatusTransition(current, newStatus)) {
    return newStatus;
  }
  
  logger.warn('Status regression prevented', {
    currentStatus: current,
    attemptedStatus: newStatus,
  });
  
  return current;
}

// ============================================================================
// BUG 123: PROGRESS BOUNDS CHECKING
// ============================================================================

/**
 * Validates and bounds a chapter progress value.
 * 
 * Bug 123: User progress can exceed latest chapter
 * 
 * @param progress - The progress value to validate
 * @param maxChapter - The maximum chapter number (if known)
 * @param minChapter - The minimum chapter number (default 0)
 * @returns The bounded progress value
 */
export function validateProgressBounds(
  progress: number | null | undefined,
  maxChapter: number | null | undefined,
  minChapter: number = 0
): number {
  // Handle null/undefined
  if (progress === null || progress === undefined || isNaN(progress)) {
    return minChapter;
  }
  
  // Ensure progress is not negative
  let bounded = Math.max(minChapter, progress);
  
  // If maxChapter is known, ensure progress doesn't exceed it
  if (maxChapter !== null && maxChapter !== undefined && !isNaN(maxChapter)) {
    bounded = Math.min(bounded, maxChapter);
  }
  
  return bounded;
}

/**
 * Validates progress update against series chapter count.
 * Returns an error message if invalid, null if valid.
 */
export function validateProgressUpdate(
  newProgress: number,
  currentProgress: number | null,
  totalChapters: number | null,
  options: {
    allowRegression?: boolean;
    maxJump?: number;
  } = {}
): string | null {
  const { allowRegression = true, maxJump } = options;
  
  // Check for negative progress
  if (newProgress < 0) {
    return 'Progress cannot be negative';
  }
  
  // Check for regression if not allowed
  if (!allowRegression && currentProgress !== null && newProgress < currentProgress) {
    return 'Progress cannot decrease';
  }
  
  // Check against total chapters
  if (totalChapters !== null && newProgress > totalChapters) {
    return `Progress cannot exceed total chapters (${totalChapters})`;
  }
  
  // Check for suspiciously large jumps
  if (maxJump !== undefined && currentProgress !== null) {
    const jump = newProgress - currentProgress;
    if (jump > maxJump) {
      return `Progress jump too large (${jump} > ${maxJump})`;
    }
  }
  
  return null;
}

// ============================================================================
// BUG 173: ADAPTIVE SCHEDULING
// ============================================================================

/**
 * Scheduling factors for adaptive scheduling
 */
export interface SchedulingFactors {
  queueDepth: number;          // Current queue size
  errorRate: number;           // Recent error rate (0-1)
  avgProcessingTime: number;   // Average job processing time in ms
  systemLoad: number;          // System load (0-1)
  timeOfDay: number;           // Hour of day (0-23)
}

/**
 * Default scheduling configuration
 */
const DEFAULT_SCHEDULING_CONFIG = {
  baseIntervalMs: 5 * 60 * 1000,      // 5 minutes base
  minIntervalMs: 1 * 60 * 1000,       // 1 minute minimum
  maxIntervalMs: 60 * 60 * 1000,      // 1 hour maximum
  queueDepthThreshold: 1000,          // Queue depth at which to slow down
  errorRateThreshold: 0.1,            // Error rate at which to back off
  peakHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], // 9am-9pm
};

/**
 * Calculates an adaptive scheduling interval based on system state.
 * 
 * Bug 173: No adaptive scheduling based on backlog
 * 
 * Factors:
 * 1. Queue depth: Higher depth = longer interval
 * 2. Error rate: Higher errors = longer interval (back off)
 * 3. System load: Higher load = longer interval
 * 4. Time of day: Non-peak hours = can be more aggressive
 */
export function calculateAdaptiveInterval(
  factors: Partial<SchedulingFactors>,
  config = DEFAULT_SCHEDULING_CONFIG
): number {
  let multiplier = 1.0;
  
  // Factor 1: Queue depth
  if (factors.queueDepth !== undefined) {
    const depthRatio = factors.queueDepth / config.queueDepthThreshold;
    if (depthRatio > 1) {
      // Queue is overloaded, slow down significantly
      multiplier *= Math.min(4, 1 + Math.log2(depthRatio));
    } else if (depthRatio < 0.1) {
      // Queue is nearly empty, can speed up
      multiplier *= 0.5;
    }
  }
  
  // Factor 2: Error rate
  if (factors.errorRate !== undefined && factors.errorRate > config.errorRateThreshold) {
    // Exponential back-off based on error rate
    multiplier *= 1 + (factors.errorRate * 5);
  }
  
  // Factor 3: System load
  if (factors.systemLoad !== undefined && factors.systemLoad > 0.8) {
    multiplier *= 1.5 + (factors.systemLoad - 0.8) * 2;
  }
  
  // Factor 4: Time of day (less aggressive during off-peak)
  if (factors.timeOfDay !== undefined) {
    const isPeak = config.peakHours.includes(factors.timeOfDay);
    if (!isPeak) {
      // Off-peak: can be more aggressive
      multiplier *= 0.75;
    }
  }
  
  // Calculate final interval
  const interval = config.baseIntervalMs * multiplier;
  
  // Clamp to min/max
  return Math.max(
    config.minIntervalMs,
    Math.min(config.maxIntervalMs, interval)
  );
}

/**
 * Priority levels for job scheduling
 */
export const JOB_PRIORITY = {
  CRITICAL: 1,
  HIGH: 2,
  NORMAL: 3,
  LOW: 4,
  BACKGROUND: 5,
} as const;

/**
 * Calculates job priority based on various factors
 */
export function calculateJobPriority(factors: {
  isUserInitiated?: boolean;
  failureCount?: number;
  lastAttemptAge?: number;  // ms since last attempt
  sourceReliability?: number;  // 0-1
}): number {
  let priority: number = JOB_PRIORITY.NORMAL;
  
  // User-initiated jobs get high priority
  if (factors.isUserInitiated) {
    priority = JOB_PRIORITY.HIGH;
  }
  
  // Jobs that haven't been attempted in a while get higher priority
  if (factors.lastAttemptAge !== undefined) {
    const hours = factors.lastAttemptAge / (1000 * 60 * 60);
    if (hours > 24) {
      priority = Math.max(1, priority - 1);
    }
  }
  
  // Jobs with many failures get lower priority
  if (factors.failureCount !== undefined && factors.failureCount > 3) {
    priority = Math.min(5, priority + 1);
  }
  
  // Low reliability sources get lower priority
  if (factors.sourceReliability !== undefined && factors.sourceReliability < 0.5) {
    priority = Math.min(5, priority + 1);
  }
  
  return priority;
}

// ============================================================================
// BUG 191: ENVIRONMENT VALIDATION
// ============================================================================

/**
 * Environment variable schema for validation
 */
export const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  DATABASE_READ_URL: z.string().url().optional(),
  
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  
  // Redis
  REDIS_URL: z.string().optional(),
  
  // Security
  INTERNAL_API_SECRET: z.string().min(32, 'INTERNAL_API_SECRET must be at least 32 characters').optional(),
  INTERNAL_API_ALLOWED_CIDRS: z.string().optional(),
  
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  
  // Rate limiting
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).pipe(z.number().positive()).optional(),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).pipe(z.number().positive()).optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Cached validated environment
 */
let validatedEnv: EnvConfig | null = null;

/**
 * Validates environment variables at startup.
 * 
 * Bug 191: Environment variables not validated at startup
 * 
 * @throws Error if required environment variables are missing or invalid
 */
export function validateEnvironment(): EnvConfig {
  if (validatedEnv) {
    return validatedEnv;
  }
  
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
    
    // In development, log warnings but don't crash
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Environment validation warnings:', { errors });
      // Return a partial config with defaults
      validatedEnv = {
        DATABASE_URL: process.env.DATABASE_URL || '',
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        NODE_ENV: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
      };
      return validatedEnv;
    }
    
    // In production, throw an error
    throw new Error(`Environment validation failed:\n${errors.join('\n')}`);
  }
  
  validatedEnv = result.data;
  return validatedEnv;
}

/**
 * Gets a validated environment variable with type safety
 */
export function getEnv<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
  const env = validateEnvironment();
  return env[key];
}

/**
 * Checks if all required services are available
 */
export async function checkRequiredServices(): Promise<{
  healthy: boolean;
  services: Record<string, { available: boolean; error?: string }>;
}> {
  const services: Record<string, { available: boolean; error?: string }> = {};
  
  // Check database
  try {
    const { prisma } = await import('./prisma');
    await prisma.$queryRaw`SELECT 1`;
    services.database = { available: true };
  } catch (error) {
    services.database = { 
      available: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
  
  // Check Redis (optional)
  if (process.env.REDIS_URL) {
    try {
      const { redis, waitForRedis } = await import('./redis');
      const ready = await waitForRedis(redis, 5000);
      services.redis = { available: ready };
      if (!ready) {
        services.redis.error = 'Redis connection timeout';
      }
    } catch (error) {
      services.redis = { 
        available: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  } else {
    services.redis = { available: true }; // Optional, skip if not configured
  }
  
  // Overall health
  const healthy = Object.values(services).every(s => s.available);
  
  return { healthy, services };
}

// ============================================================================
// TRANSACTION ISOLATION HELPERS
// ============================================================================

/**
 * Prisma transaction options with proper isolation
 */
export const SERIALIZABLE_TX_OPTIONS = {
  isolationLevel: 'Serializable' as const,
  timeout: 30000,
};

export const READ_COMMITTED_TX_OPTIONS = {
  isolationLevel: 'ReadCommitted' as const,
  timeout: 15000,
};

// ============================================================================
// CURSOR PAGINATION HELPERS
// ============================================================================

/**
 * Creates a stable cursor from multiple sort fields
 */
export function createCursor(values: Record<string, string | number | Date>): string {
  const normalized = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => {
      if (v instanceof Date) {
        return `${k}:${v.toISOString()}`;
      }
      return `${k}:${v}`;
    })
    .join('|');
  
  return Buffer.from(normalized).toString('base64url');
}

/**
 * Parses a cursor back into its component values
 */
export function parseCursor(cursor: string): Record<string, string> | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const pairs = decoded.split('|');
    const result: Record<string, string> = {};
    
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split(':');
      if (key) {
        result[key] = valueParts.join(':'); // Rejoin in case value contained ':'
      }
    }
    
    return result;
  } catch {
    return null;
  }
}

// ============================================================================
// SOFT DELETE HELPERS
// ============================================================================

/**
 * Models that support soft delete
 */
export const SOFT_DELETE_MODELS = [
  'LibraryEntry',
  'Series',
  'Chapter',
  'ChapterSource',
] as const;

/**
 * Adds soft delete filter to a where clause
 */
export function withSoftDeleteFilter<T extends Record<string, any>>(
  where: T,
  includeSoftDeleted: boolean = false
): T & { deleted_at?: null | { not: null } } {
  if (includeSoftDeleted) {
    return where;
  }
  
  return {
    ...where,
    deleted_at: null,
  };
}
