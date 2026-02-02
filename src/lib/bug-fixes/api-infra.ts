/**
 * K. API, RUNTIME & INFRA (Bugs 181-200)
 * 
 * Comprehensive fixes for API, runtime, and infrastructure issues.
 */

import { z } from 'zod';

// Bug 181: API handlers lack strict input validation
export const ApiInputSchemas = {
  libraryEntryId: z.string().uuid(),
  userId: z.string().uuid(),
  seriesId: z.string().uuid(),
  page: z.number().int().min(1).max(1000).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  status: z.enum(['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read']),
  sourceUrl: z.string().url().max(2000),
  searchQuery: z.string().min(2).max(200)
};

export function validateApiInput<T>(
  data: unknown,
  schema: z.ZodType<T>,
  inputName: string
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = result.error.errors.map(e => `${e.path.join('.') || inputName}: ${e.message}`);
  return { success: false, error: errors.join('; ') };
}

// Bug 182: Zod / validation schemas incomplete
export const LibraryEntryCreateSchema = z.object({
  source_url: z.string().url().max(2000),
  source_name: z.string().min(1).max(50),
  imported_title: z.string().max(500).optional(),
  status: z.enum(['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read']).default('plan_to_read'),
  last_read_chapter: z.number().min(0).max(10000).optional()
});

export const LibraryEntryUpdateSchema = z.object({
  status: z.enum(['reading', 'completed', 'on_hold', 'dropped', 'plan_to_read']).optional(),
  last_read_chapter: z.number().min(0).max(10000).optional(),
  user_rating: z.number().int().min(1).max(10).optional(),
  notify_new_chapters: z.boolean().optional()
});

export const ProgressUpdateSchema = z.object({
  chapter_number: z.number().min(0).max(10000),
  device_id: z.string().max(100).optional(),
  timestamp: z.string().datetime().optional()
});

// Bug 183: Request bodies not size-limited
export const REQUEST_SIZE_LIMITS = {
  default: 1024 * 100,
  import: 1024 * 1024 * 5,
  bulkUpdate: 1024 * 500,
  search: 1024 * 10
};

export function checkRequestSize(
  contentLength: number | undefined,
  endpoint: keyof typeof REQUEST_SIZE_LIMITS
): { allowed: boolean; limit: number } {
  const limit = REQUEST_SIZE_LIMITS[endpoint] || REQUEST_SIZE_LIMITS.default;
  return {
    allowed: !contentLength || contentLength <= limit,
    limit
  };
}

// Bug 184: API responses not schema-validated
export const ApiResponseSchemas = {
  success: z.object({
    success: z.literal(true),
    data: z.unknown()
  }),
  error: z.object({
    success: z.literal(false),
    error: z.string(),
    code: z.string().optional(),
    requestId: z.string().optional()
  }),
  paginated: z.object({
    data: z.array(z.unknown()),
    pagination: z.object({
      page: z.number(),
      limit: z.number(),
      total: z.number(),
      hasMore: z.boolean()
    })
  })
};

export function createSuccessResponse<T>(data: T): { success: true; data: T } {
  return { success: true, data };
}

export function createErrorResponse(
  error: string,
  code?: string,
  requestId?: string
): { success: false; error: string; code?: string; requestId?: string } {
  return { success: false, error, code, requestId };
}

export function createPaginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total: number
): { data: T[]; pagination: { page: number; limit: number; total: number; hasMore: boolean } } {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      hasMore: page * limit < total
    }
  };
}

// Bug 185: Error responses inconsistent across endpoints
export interface StandardErrorResponse {
  success: false;
  error: string;
  code: string;
  requestId: string;
  timestamp: string;
}

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

export function createStandardError(
  code: keyof typeof ERROR_CODES,
  message: string,
  requestId: string
): StandardErrorResponse {
  return {
    success: false,
    error: message,
    code: ERROR_CODES[code],
    requestId,
    timestamp: new Date().toISOString()
  };
}

// Bug 186: Some endpoints return 200 on failure
export function getHttpStatusForError(code: string): number {
  switch (code) {
    case 'VALIDATION_ERROR': return 400;
    case 'NOT_FOUND': return 404;
    case 'UNAUTHORIZED': return 401;
    case 'FORBIDDEN': return 403;
    case 'RATE_LIMITED': return 429;
    case 'CONFLICT': return 409;
    case 'INTERNAL_ERROR': return 500;
    default: return 500;
  }
}

// Bug 187: API rate limits missing on heavy endpoints
export interface EndpointRateLimit {
  endpoint: string;
  windowMs: number;
  maxRequests: number;
  keyBy: 'user' | 'ip' | 'both';
}

export const ENDPOINT_RATE_LIMITS: EndpointRateLimit[] = [
  { endpoint: '/api/library/import', windowMs: 3600000, maxRequests: 5, keyBy: 'user' },
  { endpoint: '/api/library/retry-all-metadata', windowMs: 3600000, maxRequests: 3, keyBy: 'user' },
  { endpoint: '/api/series/search', windowMs: 60000, maxRequests: 60, keyBy: 'both' },
  { endpoint: '/api/series/browse', windowMs: 60000, maxRequests: 100, keyBy: 'ip' }
];

export function getEndpointRateLimit(endpoint: string): EndpointRateLimit | null {
  return ENDPOINT_RATE_LIMITS.find(r => endpoint.startsWith(r.endpoint)) || null;
}

// Bug 188: API logs lack request correlation IDs
export function generateCorrelationId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

export interface ApiLogEntry {
  correlationId: string;
  method: string;
  path: string;
  userId: string | null;
  ip: string;
  userAgent: string | null;
  statusCode: number;
  durationMs: number;
  timestamp: Date;
  error: string | null;
}

export function createApiLogEntry(
  correlationId: string,
  method: string,
  path: string,
  userId: string | null,
  ip: string,
  userAgent: string | null
): ApiLogEntry {
  return {
    correlationId,
    method,
    path,
    userId,
    ip,
    userAgent,
    statusCode: 0,
    durationMs: 0,
    timestamp: new Date(),
    error: null
  };
}

// Bug 189: API errors swallowed in middleware
export function wrapApiHandler<T>(
  handler: () => Promise<T>,
  correlationId: string
): Promise<T | StandardErrorResponse> {
  return handler().catch((error: unknown) => {
    console.error(`[${correlationId}] API error:`, error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return createStandardError('INTERNAL_ERROR', message, correlationId);
  });
}

// Bug 190: Node process memory not bounded
export const MEMORY_LIMITS = {
  maxHeapMB: 1536,
  warningThreshold: 0.85,
  criticalThreshold: 0.95
};

export interface MemoryStatus {
  heapUsedMB: number;
  heapTotalMB: number;
  utilization: number;
  status: 'healthy' | 'warning' | 'critical';
  shouldRejectRequests: boolean;
}

export function checkMemoryStatus(): MemoryStatus {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  const utilization = heapUsedMB / MEMORY_LIMITS.maxHeapMB;

  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (utilization >= MEMORY_LIMITS.criticalThreshold) {
    status = 'critical';
  } else if (utilization >= MEMORY_LIMITS.warningThreshold) {
    status = 'warning';
  }

  return {
    heapUsedMB,
    heapTotalMB,
    utilization,
    status,
    shouldRejectRequests: status === 'critical'
  };
}

// Bug 191: Environment variables not validated at startup
export const RequiredEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  REDIS_URL: z.string().url().optional()
});

export function validateEnvAtStartup(): { valid: boolean; errors: string[] } {
  const result = RequiredEnvSchema.safeParse(process.env);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
  return { valid: false, errors };
}

// Bug 192: Feature flags not centralized
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  enabledForUsers?: string[];
  enabledPercentage?: number;
  expiresAt?: Date;
}

const featureFlags = new Map<string, FeatureFlag>([
  ['enhanced_metadata_matching', { name: 'enhanced_metadata_matching', enabled: true }],
  ['adaptive_scheduling', { name: 'adaptive_scheduling', enabled: true }],
  ['memory_guards', { name: 'memory_guards', enabled: true }],
  ['response_validation', { name: 'response_validation', enabled: false }]
]);

export function isFeatureEnabled(flagName: string, userId?: string): boolean {
  const flag = featureFlags.get(flagName);
  if (!flag || !flag.enabled) return false;
  if (flag.expiresAt && new Date() > flag.expiresAt) return false;
  if (flag.enabledForUsers && userId) {
    return flag.enabledForUsers.includes(userId);
  }
  if (flag.enabledPercentage !== undefined && userId) {
    const hash = userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    return (hash % 100) < flag.enabledPercentage;
  }
  return flag.enabled;
}

export function setFeatureFlag(flag: FeatureFlag): void {
  featureFlags.set(flag.name, flag);
}

// Bug 193: Partial deploy can mismatch worker/API logic
export const API_VERSION = '1.0.0';
export const SCHEMA_VERSION = 1;

export interface DeploymentInfo {
  apiVersion: string;
  schemaVersion: number;
  deployedAt: Date;
  commitHash: string | null;
}

export function getDeploymentInfo(): DeploymentInfo {
  return {
    apiVersion: API_VERSION,
    schemaVersion: SCHEMA_VERSION,
    deployedAt: new Date(),
    commitHash: process.env.VERCEL_GIT_COMMIT_SHA || null
  };
}

// Bug 194: Prisma client reused unsafely across contexts
export interface PrismaClientConfig {
  maxConnections: number;
  connectionTimeout: number;
  queryTimeout: number;
  retryCount: number;
}

export const DEFAULT_PRISMA_CONFIG: PrismaClientConfig = {
  maxConnections: 20,
  connectionTimeout: 10000,
  queryTimeout: 30000,
  retryCount: 3
};

// Bug 195: Connection pool exhaustion under worker spikes
export interface ConnectionPoolStatus {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  isHealthy: boolean;
}

export function evaluatePoolHealth(status: ConnectionPoolStatus): {
  healthy: boolean;
  recommendation: string;
} {
  const utilization = status.activeConnections / status.totalConnections;

  if (utilization > 0.9 || status.waitingRequests > 10) {
    return {
      healthy: false,
      recommendation: 'Consider increasing pool size or reducing concurrent operations'
    };
  }

  if (utilization > 0.7) {
    return {
      healthy: true,
      recommendation: 'Pool utilization high, monitor closely'
    };
  }

  return {
    healthy: true,
    recommendation: 'Pool operating normally'
  };
}

// Bug 196: DB migrations not backward-compatible
export interface MigrationCheck {
  name: string;
  isBackwardCompatible: boolean;
  requiresDowntime: boolean;
  risks: string[];
}

const HIGH_RISK_OPERATIONS = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /ALTER\s+COLUMN.*TYPE/i,
  /TRUNCATE/i
];

export function analyzeMigration(sql: string): MigrationCheck {
  const risks: string[] = [];
  let requiresDowntime = false;
  let isBackwardCompatible = true;

  for (const pattern of HIGH_RISK_OPERATIONS) {
    if (pattern.test(sql)) {
      risks.push(`High-risk operation detected: ${pattern.source}`);
      isBackwardCompatible = false;
      if (/DROP\s+TABLE|TRUNCATE/i.test(sql)) {
        requiresDowntime = true;
      }
    }
  }

  return {
    name: '',
    isBackwardCompatible,
    requiresDowntime,
    risks
  };
}

// Bug 197: Infra config drift not detected
export interface InfraConfig {
  name: string;
  expectedValue: string;
  actualValue: string | null;
  matches: boolean;
}

export function checkInfraConfig(
  configs: { name: string; expected: string; actual: string | null }[]
): InfraConfig[] {
  return configs.map(c => ({
    name: c.name,
    expectedValue: c.expected,
    actualValue: c.actual,
    matches: c.expected === c.actual
  }));
}

// Bug 198: Missing health checks for workers
export interface WorkerHealthCheck {
  workerId: string;
  queueName: string;
  isHealthy: boolean;
  lastHeartbeat: Date | null;
  currentJob: string | null;
  uptime: number;
  processedJobs: number;
  failedJobs: number;
}

const workerHealthChecks = new Map<string, WorkerHealthCheck>();

export function recordWorkerHealth(
  workerId: string,
  queueName: string,
  currentJob: string | null
): void {
  const existing = workerHealthChecks.get(workerId);
  workerHealthChecks.set(workerId, {
    workerId,
    queueName,
    isHealthy: true,
    lastHeartbeat: new Date(),
    currentJob,
    uptime: existing?.uptime || 0,
    processedJobs: existing?.processedJobs || 0,
    failedJobs: existing?.failedJobs || 0
  });
}

export function getWorkerHealth(workerId: string): WorkerHealthCheck | null {
  return workerHealthChecks.get(workerId) || null;
}

export function getAllWorkerHealth(): WorkerHealthCheck[] {
  return Array.from(workerHealthChecks.values());
}

// Bug 199: App can start without required services
export interface ServiceDependency {
  name: string;
  required: boolean;
  check: () => Promise<boolean>;
}

export async function checkRequiredServices(
  dependencies: ServiceDependency[]
): Promise<{ canStart: boolean; failures: string[] }> {
  const failures: string[] = [];

  for (const dep of dependencies) {
    try {
      const isHealthy = await dep.check();
      if (!isHealthy && dep.required) {
        failures.push(`${dep.name}: Not available`);
      }
    } catch (error) {
      if (dep.required) {
        failures.push(`${dep.name}: ${error instanceof Error ? error.message : 'Check failed'}`);
      }
    }
  }

  return {
    canStart: failures.length === 0,
    failures
  };
}

// Bug 200: No automated invariant verification job
export interface InvariantCheck {
  name: string;
  category: string;
  query: string;
  expectedResult: 'zero' | 'non_zero' | 'specific';
  expectedValue?: number;
}

export const SYSTEM_INVARIANTS: InvariantCheck[] = [
  {
    name: 'No orphaned library entries',
    category: 'data_integrity',
    query: "SELECT COUNT(*) FROM library_entries WHERE user_id NOT IN (SELECT id FROM users)",
    expectedResult: 'zero'
  },
  {
    name: 'No duplicate library entries per user',
    category: 'uniqueness',
    query: "SELECT COUNT(*) FROM (SELECT user_id, source_url, COUNT(*) FROM library_entries WHERE deleted_at IS NULL GROUP BY user_id, source_url HAVING COUNT(*) > 1) t",
    expectedResult: 'zero'
  },
  {
    name: 'All enriched entries have series',
    category: 'data_integrity',
    query: "SELECT COUNT(*) FROM library_entries WHERE metadata_status = 'enriched' AND series_id IS NULL",
    expectedResult: 'zero'
  }
];

export function evaluateInvariantResult(
  check: InvariantCheck,
  actualValue: number
): { passed: boolean; message: string } {
  switch (check.expectedResult) {
    case 'zero':
      return {
        passed: actualValue === 0,
        message: actualValue === 0 ? 'OK' : `Expected 0, got ${actualValue}`
      };
    case 'non_zero':
      return {
        passed: actualValue > 0,
        message: actualValue > 0 ? 'OK' : 'Expected non-zero value'
      };
    case 'specific':
      return {
        passed: actualValue === check.expectedValue,
        message: actualValue === check.expectedValue ? 'OK' : `Expected ${check.expectedValue}, got ${actualValue}`
      };
    default:
      return { passed: false, message: 'Unknown expected result type' };
  }
}
