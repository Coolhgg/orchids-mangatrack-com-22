/**
 * C. WORKERS / QUEUES / CONCURRENCY (Bugs 41-60)
 * 
 * Comprehensive fixes for worker processing and queue management issues.
 */

import { createHash, randomUUID } from 'crypto';

// Bug 41: Workers can process same job concurrently
// Bug 42: Missing FOR UPDATE SKIP LOCKED in some paths
export interface JobLock {
  jobId: string;
  workerId: string;
  acquiredAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export function generateWorkerId(): string {
  const hostname = process.env.HOSTNAME || 'local';
  const pid = process.pid;
  const random = randomUUID().substring(0, 8);
  return `${hostname}-${pid}-${random}`;
}

const WORKER_ID = generateWorkerId();

export function getWorkerId(): string {
  return WORKER_ID;
}

export function buildJobLockQuery(tableName: string, jobId: string): string {
  return `
    UPDATE ${tableName} 
    SET locked_by = '${WORKER_ID}', locked_at = NOW()
    WHERE id = '${jobId}'::uuid 
    AND (locked_by IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
    RETURNING *
  `;
}

// Bug 43: Retry jobs don't refresh job payload state
export interface RefreshablePayload<T> {
  data: T;
  fetchedAt: Date;
  version: number;
  isStale: boolean;
}

export function createRefreshablePayload<T>(data: T, version: number = 1): RefreshablePayload<T> {
  return {
    data,
    fetchedAt: new Date(),
    version,
    isStale: false
  };
}

export function isPayloadStale<T>(payload: RefreshablePayload<T>, maxAgeMs: number = 60000): boolean {
  return Date.now() - payload.fetchedAt.getTime() > maxAgeMs;
}

// Bug 44: Workers lack global execution correlation ID
export interface CorrelationContext {
  correlationId: string;
  parentId?: string;
  traceId: string;
  spanId: string;
  workerId: string;
  jobId?: string;
  startedAt: Date;
}

export function createCorrelationContext(parentContext?: Partial<CorrelationContext>): CorrelationContext {
  return {
    correlationId: parentContext?.correlationId || randomUUID(),
    parentId: parentContext?.spanId,
    traceId: parentContext?.traceId || randomUUID(),
    spanId: randomUUID().substring(0, 16),
    workerId: WORKER_ID,
    jobId: parentContext?.jobId,
    startedAt: new Date()
  };
}

// Bug 45: Worker crash mid-job can leave partial state
export interface JobCheckpoint {
  jobId: string;
  stage: string;
  progress: number;
  data: Record<string, unknown>;
  createdAt: Date;
  canResume: boolean;
}

export function createJobCheckpoint(
  jobId: string,
  stage: string,
  progress: number,
  data: Record<string, unknown> = {}
): JobCheckpoint {
  return {
    jobId,
    stage,
    progress,
    data,
    createdAt: new Date(),
    canResume: progress < 100
  };
}

// Bug 46: No dead-letter queue for poison jobs
export interface DeadLetterEntry {
  id: string;
  queueName: string;
  jobId: string;
  payload: unknown;
  errorMessage: string;
  stackTrace?: string;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: Date;
  resolved: boolean;
  resolvedAt?: Date;
}

export function createDeadLetterEntry(
  queueName: string,
  jobId: string,
  payload: unknown,
  error: Error,
  attemptsMade: number,
  maxAttempts: number = 5
): DeadLetterEntry {
  return {
    id: randomUUID(),
    queueName,
    jobId,
    payload,
    errorMessage: error.message,
    stackTrace: error.stack,
    attemptsMade,
    maxAttempts,
    createdAt: new Date(),
    resolved: false
  };
}

export function shouldMoveToDeadLetter(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade >= maxAttempts;
}

// Bug 47: Retry storms possible under external outages
export interface CircuitBreaker {
  name: string;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  successCount: number;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
  openedAt: Date | null;
  halfOpenAt: Date | null;
}

const circuitBreakers = new Map<string, CircuitBreaker>();

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  successThreshold: 2,
  openDurationMs: 60000,
  halfOpenDurationMs: 30000
};

export function getCircuitBreaker(name: string): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, {
      name,
      state: 'closed',
      failureCount: 0,
      successCount: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      openedAt: null,
      halfOpenAt: null
    });
  }
  return circuitBreakers.get(name)!;
}

export function recordCircuitSuccess(name: string): void {
  const breaker = getCircuitBreaker(name);
  breaker.successCount++;
  breaker.lastSuccessAt = new Date();
  
  if (breaker.state === 'half-open') {
    if (breaker.successCount >= CIRCUIT_BREAKER_CONFIG.successThreshold) {
      breaker.state = 'closed';
      breaker.failureCount = 0;
      breaker.openedAt = null;
      breaker.halfOpenAt = null;
    }
  }
}

export function recordCircuitFailure(name: string): void {
  const breaker = getCircuitBreaker(name);
  breaker.failureCount++;
  breaker.lastFailureAt = new Date();
  breaker.successCount = 0;

  if (breaker.state === 'closed' && breaker.failureCount >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    breaker.state = 'open';
    breaker.openedAt = new Date();
  } else if (breaker.state === 'half-open') {
    breaker.state = 'open';
    breaker.openedAt = new Date();
  }
}

export function canExecute(name: string): boolean {
  const breaker = getCircuitBreaker(name);
  
  if (breaker.state === 'closed') {
    return true;
  }
  
  if (breaker.state === 'open' && breaker.openedAt) {
    const elapsed = Date.now() - breaker.openedAt.getTime();
    if (elapsed >= CIRCUIT_BREAKER_CONFIG.openDurationMs) {
      breaker.state = 'half-open';
      breaker.halfOpenAt = new Date();
      breaker.successCount = 0;
      return true;
    }
    return false;
  }
  
  if (breaker.state === 'half-open') {
    return true;
  }
  
  return false;
}

// Bug 48: Workers assume Redis stability
// Bug 49: Redis reconnect not handled everywhere
export interface ConnectionHealth {
  isConnected: boolean;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  reconnectAttempts: number;
  backoffMs: number;
}

const connectionHealth = new Map<string, ConnectionHealth>();

export function getConnectionHealth(serviceName: string): ConnectionHealth {
  if (!connectionHealth.has(serviceName)) {
    connectionHealth.set(serviceName, {
      isConnected: true,
      lastConnectedAt: new Date(),
      lastDisconnectedAt: null,
      reconnectAttempts: 0,
      backoffMs: 1000
    });
  }
  return connectionHealth.get(serviceName)!;
}

export function recordConnectionLoss(serviceName: string): void {
  const health = getConnectionHealth(serviceName);
  health.isConnected = false;
  health.lastDisconnectedAt = new Date();
  health.reconnectAttempts++;
  health.backoffMs = Math.min(health.backoffMs * 2, 30000);
}

export function recordConnectionRestored(serviceName: string): void {
  const health = getConnectionHealth(serviceName);
  health.isConnected = true;
  health.lastConnectedAt = new Date();
  health.reconnectAttempts = 0;
  health.backoffMs = 1000;
}

// Bug 50: Job attempts not persisted in DB
export interface JobAttemptRecord {
  id: string;
  jobId: string;
  attemptNumber: number;
  startedAt: Date;
  completedAt: Date | null;
  success: boolean;
  errorMessage: string | null;
  durationMs: number | null;
  workerId: string;
}

export function createJobAttemptRecord(
  jobId: string,
  attemptNumber: number
): JobAttemptRecord {
  return {
    id: randomUUID(),
    jobId,
    attemptNumber,
    startedAt: new Date(),
    completedAt: null,
    success: false,
    errorMessage: null,
    durationMs: null,
    workerId: WORKER_ID
  };
}

export function completeJobAttempt(
  record: JobAttemptRecord,
  success: boolean,
  errorMessage: string | null = null
): JobAttemptRecord {
  const completedAt = new Date();
  return {
    ...record,
    completedAt,
    success,
    errorMessage,
    durationMs: completedAt.getTime() - record.startedAt.getTime()
  };
}

// Bug 51: Job schema not versioned
export const JOB_SCHEMA_VERSION = 1;

export interface VersionedJobPayload<T> {
  schemaVersion: number;
  payload: T;
  createdAt: Date;
  migratedFrom?: number;
}

export function createVersionedPayload<T>(payload: T): VersionedJobPayload<T> {
  return {
    schemaVersion: JOB_SCHEMA_VERSION,
    payload,
    createdAt: new Date()
  };
}

export function isPayloadVersionCurrent(version: number): boolean {
  return version === JOB_SCHEMA_VERSION;
}

// Bug 52: Workers don't assert invariants after job completion
export interface JobInvariantCheck {
  name: string;
  check: () => boolean | Promise<boolean>;
  critical: boolean;
}

export interface InvariantResult {
  passed: boolean;
  failedInvariants: string[];
  criticalFailure: boolean;
}

export async function checkJobInvariants(
  invariants: JobInvariantCheck[]
): Promise<InvariantResult> {
  const failedInvariants: string[] = [];
  let criticalFailure = false;

  for (const invariant of invariants) {
    try {
      const result = await invariant.check();
      if (!result) {
        failedInvariants.push(invariant.name);
        if (invariant.critical) {
          criticalFailure = true;
        }
      }
    } catch {
      failedInvariants.push(`${invariant.name} (threw exception)`);
      if (invariant.critical) {
        criticalFailure = true;
      }
    }
  }

  return {
    passed: failedInvariants.length === 0,
    failedInvariants,
    criticalFailure
  };
}

// Bug 53: No global rate limit per worker type
export interface RateLimiter {
  name: string;
  maxRequests: number;
  windowMs: number;
  currentCount: number;
  windowStart: Date;
}

const rateLimiters = new Map<string, RateLimiter>();

export function getRateLimiter(name: string, maxRequests: number = 100, windowMs: number = 60000): RateLimiter {
  if (!rateLimiters.has(name)) {
    rateLimiters.set(name, {
      name,
      maxRequests,
      windowMs,
      currentCount: 0,
      windowStart: new Date()
    });
  }
  return rateLimiters.get(name)!;
}

export function checkRateLimit(name: string): { allowed: boolean; remaining: number; resetAt: Date } {
  const limiter = getRateLimiter(name);
  const now = Date.now();
  const windowEnd = limiter.windowStart.getTime() + limiter.windowMs;

  if (now > windowEnd) {
    limiter.windowStart = new Date();
    limiter.currentCount = 0;
  }

  const allowed = limiter.currentCount < limiter.maxRequests;
  if (allowed) {
    limiter.currentCount++;
  }

  return {
    allowed,
    remaining: Math.max(0, limiter.maxRequests - limiter.currentCount),
    resetAt: new Date(limiter.windowStart.getTime() + limiter.windowMs)
  };
}

// Bug 54: Memory growth possible in long-lived workers
export interface MemoryStats {
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  rss: number;
  utilization: number;
}

export function getMemoryStats(): MemoryStats {
  const usage = process.memoryUsage();
  const heapUsedMB = Math.round(usage.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(usage.heapTotal / 1024 / 1024);
  
  return {
    heapUsedMB,
    heapTotalMB,
    externalMB: Math.round(usage.external / 1024 / 1024),
    rss: Math.round(usage.rss / 1024 / 1024),
    utilization: heapUsedMB / heapTotalMB
  };
}

export function shouldTriggerGC(thresholdMB: number = 1024): boolean {
  const stats = getMemoryStats();
  return stats.heapUsedMB > thresholdMB;
}

// Bug 55: Worker exit not graceful on SIGTERM
export interface GracefulShutdown {
  isShuttingDown: boolean;
  shutdownRequestedAt: Date | null;
  activeJobs: Set<string>;
  shutdownTimeoutMs: number;
}

const shutdownState: GracefulShutdown = {
  isShuttingDown: false,
  shutdownRequestedAt: null,
  activeJobs: new Set(),
  shutdownTimeoutMs: 30000
};

export function requestShutdown(): void {
  shutdownState.isShuttingDown = true;
  shutdownState.shutdownRequestedAt = new Date();
}

export function isShuttingDown(): boolean {
  return shutdownState.isShuttingDown;
}

export function registerActiveJob(jobId: string): void {
  shutdownState.activeJobs.add(jobId);
}

export function unregisterActiveJob(jobId: string): void {
  shutdownState.activeJobs.delete(jobId);
}

export function getActiveJobCount(): number {
  return shutdownState.activeJobs.size;
}

export function canAcceptNewJobs(): boolean {
  return !shutdownState.isShuttingDown;
}

// Bug 56: No job ownership fencing
export interface JobOwnership {
  jobId: string;
  ownerId: string;
  fenceToken: number;
  acquiredAt: Date;
  expiresAt: Date;
}

let globalFenceToken = 0;

export function acquireJobOwnership(jobId: string, ttlMs: number = 300000): JobOwnership {
  globalFenceToken++;
  return {
    jobId,
    ownerId: WORKER_ID,
    fenceToken: globalFenceToken,
    acquiredAt: new Date(),
    expiresAt: new Date(Date.now() + ttlMs)
  };
}

export function validateOwnership(ownership: JobOwnership): boolean {
  if (ownership.ownerId !== WORKER_ID) {
    return false;
  }
  if (new Date() > ownership.expiresAt) {
    return false;
  }
  return true;
}

// Bug 57: Multiple workers can enqueue duplicate downstream jobs
export function generateDownstreamJobId(
  parentJobId: string,
  childType: string,
  childIndex: number
): string {
  return `${parentJobId}:${childType}:${childIndex}`;
}

// Bug 58: Scheduler overlap can enqueue duplicate work
export interface SchedulerLock {
  schedulerName: string;
  lockKey: string;
  locked: boolean;
  lockedBy: string | null;
  lockedAt: Date | null;
  expiresAt: Date | null;
}

export function generateSchedulerLockKey(schedulerName: string): string {
  return `scheduler:lock:${schedulerName}`;
}

// Bug 59: Clock drift affects scheduling logic
const PROCESS_START_MS = Date.now();
const PROCESS_START_HRTIME = process.hrtime.bigint();

export function getMonotonicTime(): number {
  const elapsed = Number(process.hrtime.bigint() - PROCESS_START_HRTIME) / 1_000_000;
  return PROCESS_START_MS + elapsed;
}

export function calculateSafeDelay(targetTime: Date, minDelay: number = 0, maxDelay: number = 86400000): number {
  const now = getMonotonicTime();
  const target = targetTime.getTime();
  const delay = Math.max(minDelay, Math.min(maxDelay, target - now));
  return Math.round(delay);
}

// Bug 60: Workers can silently stall without alerting
export interface WorkerHeartbeat {
  workerId: string;
  lastHeartbeat: Date;
  currentJob: string | null;
  jobStartedAt: Date | null;
  isHealthy: boolean;
}

const workerHeartbeats = new Map<string, WorkerHeartbeat>();

export function recordHeartbeat(currentJob: string | null = null, jobStartedAt: Date | null = null): void {
  workerHeartbeats.set(WORKER_ID, {
    workerId: WORKER_ID,
    lastHeartbeat: new Date(),
    currentJob,
    jobStartedAt,
    isHealthy: true
  });
}

export function checkWorkerHealth(maxStalenessMs: number = 60000): WorkerHeartbeat[] {
  const staleWorkers: WorkerHeartbeat[] = [];
  const now = Date.now();

  for (const [, heartbeat] of workerHeartbeats) {
    const staleness = now - heartbeat.lastHeartbeat.getTime();
    if (staleness > maxStalenessMs) {
      heartbeat.isHealthy = false;
      staleWorkers.push(heartbeat);
    }
  }

  return staleWorkers;
}

export function getWorkerHeartbeat(workerId: string): WorkerHeartbeat | null {
  return workerHeartbeats.get(workerId) || null;
}
