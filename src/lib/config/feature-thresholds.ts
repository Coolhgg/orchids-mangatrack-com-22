/**
 * CENTRALIZED FEATURE THRESHOLDS & CONFIGURATION
 * v5 Audit Bug 48: Feature thresholds duplicated across files
 * 
 * This file centralizes all feature thresholds to prevent inconsistencies
 * when values need to be updated. Import from here instead of duplicating values.
 */

// =============================================================================
// SIMILARITY THRESHOLDS
// =============================================================================

export const SIMILARITY_THRESHOLDS = {
  /** Perfect match (identical after normalization) */
  EXACT_MATCH: 1.0,
  
  /** High confidence - safe to auto-match */
  HIGH_CONFIDENCE: 0.85,
  
  /** Medium confidence - requires review */
  MEDIUM_CONFIDENCE: 0.7,
  
  /** Low confidence - likely needs manual intervention */
  LOW_CONFIDENCE: 0.5,
  
  /** Below this, reject the match entirely */
  REJECT_THRESHOLD: 0.3,
} as const;

// =============================================================================
// RETRY CONFIGURATION
// =============================================================================

export const RETRY_CONFIG = {
  /** Maximum attempts for metadata enrichment */
  MAX_METADATA_RETRIES: 3,
  
  /** Maximum attempts for sync jobs */
  MAX_SYNC_RETRIES: 5,
  
  /** Base delay for retry backoff (in ms) */
  RETRY_BACKOFF_BASE_MS: 60000, // 1 minute
  
  /** Multiplier for exponential backoff */
  RETRY_BACKOFF_MULTIPLIER: 2,
  
  /** Maximum retry delay (in ms) */
  MAX_RETRY_DELAY_MS: 3600000, // 1 hour
  
  /** Cooldown period after too many failures (in ms) */
  FAILURE_COOLDOWN_MS: 3600000, // 1 hour
  
  /** Number of consecutive failures before circuit breaker opens */
  CIRCUIT_BREAKER_THRESHOLD: 5,
} as const;

// =============================================================================
// RATE LIMITING
// =============================================================================

export const RATE_LIMIT_CONFIG = {
  /** API requests per minute per user */
  API_REQUESTS_PER_MINUTE: 60,
  
  /** Sync jobs per minute (global) */
  SYNC_JOBS_PER_MINUTE: 100,
  
  /** Import jobs per user per hour */
  IMPORT_JOBS_PER_HOUR: 10,
  
  /** Status updates per user per minute */
  STATUS_UPDATES_PER_MINUTE: 30,
  
  /** Library additions per user per minute */
  LIBRARY_ADDS_PER_MINUTE: 30,
  
  /** XP grants per user per minute (anti-abuse) */
  XP_GRANTS_PER_MINUTE: 5,
} as const;

// =============================================================================
// SCHEDULER CONFIGURATION
// =============================================================================

export const SCHEDULER_CONFIG = {
  /** Maximum sources to process per scheduler run */
  MAX_BATCH_SIZE: 500,
  
  /** Minimum time between source syncs (in hours) */
  MIN_SYNC_INTERVAL_HOURS: 0.5,
  
  /** Minimum time between source syncs (in ms) */
  MIN_SYNC_INTERVAL_MS: 30 * 60 * 1000, // 30 minutes
  
  /** Whether scheduler halts on errors */
  HALT_ON_ERROR: false,
  
  /** Maximum errors before halting scheduler */
  MAX_ERRORS_BEFORE_HALT: 10,
  
  // Tier-specific intervals (in hours)
  TIER_INTERVALS: {
    A: {
      HOT: 0.5,   // 30 min
      WARM: 0.75, // 45 min
      COLD: 1,    // 1 hour
    },
    B: {
      HOT: 6,
      WARM: 9,
      COLD: 12,
    },
    C: {
      HOT: 48,
      WARM: 72,
      COLD: 168, // 7 days
    },
  },
} as const;

// =============================================================================
// TRUST SCORE CONFIGURATION
// =============================================================================

export const TRUST_SCORE_CONFIG = {
  /** Default trust score for new users */
  DEFAULT: 1.0,
  
  /** Minimum allowed trust score */
  MIN: 0.5,
  
  /** Maximum allowed trust score */
  MAX: 1.0,
  
  /** Trust score decay rate per day of inactivity */
  DECAY_RATE_PER_DAY: 0.01,
  
  /** Trust score recovery rate per day of good behavior */
  RECOVERY_RATE_PER_DAY: 0.05,
  
  // Violation penalties
  VIOLATIONS: {
    RAPID_READS: 0.1,
    API_SPAM: 0.15,
    STATUS_TOGGLE: 0.05,
    LARGE_JUMP: 0.08,
  },
} as const;

// =============================================================================
// PAGINATION CONFIGURATION
// =============================================================================

export const PAGINATION_CONFIG = {
  /** Default page size */
  DEFAULT_PAGE_SIZE: 20,
  
  /** Maximum page size allowed */
  MAX_PAGE_SIZE: 100,
  
  /** Default offset */
  DEFAULT_OFFSET: 0,
  
  /** Maximum items to return in a batch operation */
  MAX_BATCH_ITEMS: 500,
  
  /** Maximum items for retry-all operations */
  MAX_RETRY_ALL_BATCH: 100,
} as const;

// =============================================================================
// QUEUE CONFIGURATION
// =============================================================================

export const QUEUE_CONFIG = {
  /** Maximum ingest queue size before backpressure */
  MAX_INGEST_QUEUE_SIZE: 50000,
  
  /** Maximum chapters per sync job (memory protection) */
  MAX_CHAPTERS_PER_SYNC: 500,
  
  /** Default job timeout (in ms) */
  DEFAULT_JOB_TIMEOUT_MS: 60000, // 1 minute
  
  /** Long-running job timeout (in ms) */
  LONG_JOB_TIMEOUT_MS: 300000, // 5 minutes
  
  /** Default job retention count */
  JOB_RETENTION_COUNT: 100,
  
  /** Default failed job retention time (in seconds) */
  FAILED_JOB_RETENTION_SECONDS: 24 * 3600, // 24 hours
} as const;

// =============================================================================
// GAMIFICATION CONFIGURATION
// =============================================================================

export const GAMIFICATION_CONFIG = {
  /** XP awarded for completing a series */
  XP_SERIES_COMPLETED: 50,
  
  /** XP awarded for reading a chapter */
  XP_CHAPTER_READ: 10,
  
  /** XP multiplier for streaks */
  STREAK_XP_MULTIPLIER: 1.5,
  
  /** Minimum chapters for migration bonus */
  MIN_CHAPTERS_FOR_MIGRATION_BONUS: 1,
  
  /** XP per chapter for migration bonus (capped) */
  MIGRATION_XP_PER_CHAPTER: 5,
  
  /** Maximum XP from migration bonus */
  MAX_MIGRATION_XP: 5000,
} as const;

// =============================================================================
// TIMEOUT CONFIGURATION
// =============================================================================

export const TIMEOUT_CONFIG = {
  /** Database transaction timeout (in ms) */
  DB_TRANSACTION_TIMEOUT_MS: 60000, // 1 minute
  
  /** API request timeout (in ms) */
  API_TIMEOUT_MS: 30000, // 30 seconds
  
  /** Source reachability check timeout (in ms) */
  REACHABILITY_CHECK_TIMEOUT_MS: 5000, // 5 seconds
  
  /** Redis operation timeout (in ms) */
  REDIS_TIMEOUT_MS: 5000, // 5 seconds
  
  /** Scraper timeout (in ms) */
  SCRAPER_TIMEOUT_MS: 30000, // 30 seconds
} as const;

// =============================================================================
// DEDUPLICATION CONFIGURATION
// =============================================================================

export const DEDUPE_CONFIG = {
  /** Import deduplication TTL (in seconds) */
  IMPORT_DEDUPE_TTL_SECONDS: 300, // 5 minutes
  
  /** Job idempotency key TTL (in seconds) */
  JOB_IDEMPOTENCY_TTL_SECONDS: 3600, // 1 hour
  
  /** API idempotency key TTL (in seconds) */
  API_IDEMPOTENCY_TTL_SECONDS: 3600, // 1 hour
} as const;

// =============================================================================
// EXPORT ALL AS A SINGLE OBJECT
// =============================================================================

export const APP_CONFIG = {
  similarity: SIMILARITY_THRESHOLDS,
  retry: RETRY_CONFIG,
  rateLimit: RATE_LIMIT_CONFIG,
  scheduler: SCHEDULER_CONFIG,
  trustScore: TRUST_SCORE_CONFIG,
  pagination: PAGINATION_CONFIG,
  queue: QUEUE_CONFIG,
  gamification: GAMIFICATION_CONFIG,
  timeout: TIMEOUT_CONFIG,
  dedupe: DEDUPE_CONFIG,
} as const;

export type AppConfig = typeof APP_CONFIG;

export default APP_CONFIG;
