/**
 * COMPREHENSIVE BUG FIXES - MASTER INDEX
 * 
 * This module exports all 200 bug fixes organized by category.
 * Each category is implemented in its own file for maintainability.
 * 
 * Total: 200 bugs implemented
 * - A. Metadata & Resolution (1-20)
 * - B. Sync & Chapter Ingestion (21-40)
 * - C. Workers/Queues/Concurrency (41-60)
 * - D. Database/Prisma/SQL (61-75)
 * - E. Security (76-85)
 * - F. TypeScript/Lint/Runtime (86-100)
 * - G. Metadata, Identity & Merging (101-120)
 * - H. Library & User State (121-140)
 * - I. Search, Browse & Discovery (141-160)
 * - J. Worker Scheduling & Timing (161-180)
 * - K. API, Runtime & Infra (181-200)
 */

// A. METADATA & RESOLUTION (1-20)
export * as MetadataResolution from './metadata-resolution';

// B. SYNC & CHAPTER INGESTION (21-40)
export * as SyncChapter from './sync-chapter';

// C. WORKERS / QUEUES / CONCURRENCY (41-60)
export * as WorkersConcurrency from './workers-concurrency';

// D. DATABASE / PRISMA / SQL (61-75)
export * as DatabasePrisma from './database-prisma';

// E. SECURITY (76-85)
export * as Security from './security';

// F. TYPESCRIPT / LINT / RUNTIME (86-100)
export * as TypeScriptRuntime from './typescript-runtime';

// G. METADATA, IDENTITY & MERGING (101-120)
export * as MetadataIdentity from './metadata-identity';

// H. LIBRARY & USER STATE (121-140)
export * as LibraryUserState from './library-user-state';

// I. SEARCH, BROWSE & DISCOVERY (141-160)
export * as SearchBrowse from './search-browse';

// J. WORKER SCHEDULING & TIMING (161-180)
export * as WorkerScheduling from './worker-scheduling';

// K. API, RUNTIME & INFRA (181-200)
export * as ApiInfra from './api-infra';

// V5 AUDIT BUG FIXES (51-80)
export * as V5AuditBugs51To80 from './v5-audit-bugs-51-80';

// V5 AUDIT BUG FIXES (81-100) - FINAL PASS
export * as V5AuditBugs81To100 from './v5-audit-bugs-81-100';

// Re-export commonly used functions directly
export {
  checkManualOverride,
  sanitizeMetadataError,
  calculateBackoffWithJitter,
  generateIdempotentJobId
} from './metadata-resolution';

export {
  normalizeChapterNumber,
  compareChapterNumbers,
  generateSyncJobId
} from './sync-chapter';

export {
  getCircuitBreaker,
  canExecute,
  recordCircuitSuccess,
  recordCircuitFailure
} from './workers-concurrency';

export {
  classifyPrismaError,
  isSerializationError
} from './database-prisma';

export {
  sanitizeErrorForClient,
  validateExternalMetadata,
  checkRateLimitInMemory
} from './security';

export {
  safeAwait,
  assertDefined,
  validateCriticalInput
} from './typescript-runtime';

export {
  normalizeTitle,
  calculateTitleSimilarity,
  areLanguagesCompatible
} from './metadata-identity';

export {
  verifySourceUrl,
  normalizeProgress,
  mergeProgress
} from './library-user-state';

export {
  sanitizeSearchQuery,
  validateSearchQuery,
  checkSearchRateLimit
} from './search-browse';

export {
  getMonotonicTimestamp,
  acquireSchedulerLock,
  releaseSchedulerLock
} from './worker-scheduling';

export {
  createSuccessResponse,
  createErrorResponse,
  createStandardError,
  checkMemoryStatus,
  isFeatureEnabled
} from './api-infra';

// V5 Audit Bug Fixes (81-100) exports
export {
  RESOLUTION_THRESHOLDS,
  getResolutionStrategy,
  validateMetadataStatus,
  isValidMetadataStatus,
  UnrecoverableError,
  TransientError,
  TimestampProvider,
  calculateRetryDelay,
  generateSearchCacheKey,
  generateLibraryCacheKey,
  createApiResponse,
  validateApiResponse,
  fetchWithRetry,
  LibraryStateManager,
  libraryStateManager,
  SecureLogger,
  secureLogger,
  redactString,
  redactObject,
  withSoftDeleteFilter,
  safeScriptQuery,
  getFeatureFlag,
  validateTestEnvironmentFlags,
  safeGet,
  safeArrayAccess,
  getOrDefault,
  checkPrismaFreshness,
  PrismaLifecycleManager,
  acquireCronLock,
  releaseCronLock,
  JobMetricsCollector,
  jobMetricsCollector,
  checkQueueHealth,
  QUEUE_HEALTH_THRESHOLDS,
  pruneRetryHistory,
  validateSourceSeriesConsistency,
  runConsistencyVerification
} from './v5-audit-bugs-81-100';
