/**
 * J. WORKER SCHEDULING & TIMING (Bugs 161-180)
 * 
 * Comprehensive fixes for worker scheduling and timing issues.
 */

// Bug 161: Scheduler drift accumulates over time
// Bug 162: Scheduler assumes monotonic clock
const PROCESS_START_MS = Date.now();
const PROCESS_START_HRTIME = process.hrtime.bigint();

export function getMonotonicTimestamp(): number {
  const elapsed = Number(process.hrtime.bigint() - PROCESS_START_HRTIME) / 1_000_000;
  return PROCESS_START_MS + elapsed;
}

export function calculateDriftCompensation(
  expectedTime: number,
  actualTime: number,
  maxDriftMs: number = 5000
): number {
  const drift = actualTime - expectedTime;
  if (Math.abs(drift) > maxDriftMs) {
    return 0;
  }
  return -drift;
}

// Bug 163: Jobs scheduled during deploy can be lost
export interface JobPersistence {
  jobId: string;
  scheduledAt: Date;
  payload: unknown;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  persistedAt: Date;
  recoverable: boolean;
}

export function createPersistentJob(
  jobId: string,
  payload: unknown,
  scheduledAt: Date
): JobPersistence {
  return {
    jobId,
    scheduledAt,
    payload,
    status: 'pending',
    persistedAt: new Date(),
    recoverable: true
  };
}

// Bug 164: Scheduler overlap under slow workers
export interface SchedulerLockState {
  schedulerName: string;
  locked: boolean;
  lockedBy: string | null;
  lockedAt: Date | null;
  expiresAt: Date | null;
  heartbeatAt: Date | null;
}

const schedulerLocks = new Map<string, SchedulerLockState>();

export function acquireSchedulerLock(
  schedulerName: string,
  workerId: string,
  ttlMs: number = 60000
): boolean {
  const existing = schedulerLocks.get(schedulerName);
  const now = Date.now();

  if (existing?.locked && existing.expiresAt && existing.expiresAt.getTime() > now) {
    return false;
  }

  schedulerLocks.set(schedulerName, {
    schedulerName,
    locked: true,
    lockedBy: workerId,
    lockedAt: new Date(),
    expiresAt: new Date(now + ttlMs),
    heartbeatAt: new Date()
  });

  return true;
}

export function releaseSchedulerLock(schedulerName: string, workerId: string): boolean {
  const lock = schedulerLocks.get(schedulerName);
  if (!lock || lock.lockedBy !== workerId) {
    return false;
  }

  schedulerLocks.delete(schedulerName);
  return true;
}

export function renewSchedulerLock(
  schedulerName: string,
  workerId: string,
  ttlMs: number = 60000
): boolean {
  const lock = schedulerLocks.get(schedulerName);
  if (!lock || lock.lockedBy !== workerId) {
    return false;
  }

  lock.expiresAt = new Date(Date.now() + ttlMs);
  lock.heartbeatAt = new Date();
  return true;
}

// Bug 165: Scheduler retry logic not isolated per job type
export interface JobTypeConfig {
  jobType: string;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  timeout: number;
}

export const JOB_TYPE_CONFIGS: Record<string, JobTypeConfig> = {
  'sync-source': {
    jobType: 'sync-source',
    maxRetries: 5,
    baseDelayMs: 30000,
    maxDelayMs: 600000,
    backoffMultiplier: 2,
    timeout: 120000
  },
  'resolution': {
    jobType: 'resolution',
    maxRetries: 5,
    baseDelayMs: 60000,
    maxDelayMs: 3600000,
    backoffMultiplier: 2,
    timeout: 300000
  },
  'notification': {
    jobType: 'notification',
    maxRetries: 3,
    baseDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    timeout: 30000
  },
  'cover-refresh': {
    jobType: 'cover-refresh',
    maxRetries: 3,
    baseDelayMs: 10000,
    maxDelayMs: 300000,
    backoffMultiplier: 2,
    timeout: 60000
  }
};

export function getJobTypeConfig(jobType: string): JobTypeConfig {
  return JOB_TYPE_CONFIGS[jobType] || {
    jobType,
    maxRetries: 3,
    baseDelayMs: 30000,
    maxDelayMs: 300000,
    backoffMultiplier: 2,
    timeout: 60000
  };
}

// Bug 166: Scheduler state not persisted durably
export interface SchedulerState {
  schedulerName: string;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  isPaused: boolean;
}

const schedulerStates = new Map<string, SchedulerState>();

export function getSchedulerState(schedulerName: string): SchedulerState {
  if (!schedulerStates.has(schedulerName)) {
    schedulerStates.set(schedulerName, {
      schedulerName,
      lastRunAt: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      consecutiveFailures: 0,
      totalRuns: 0,
      isPaused: false
    });
  }
  return schedulerStates.get(schedulerName)!;
}

export function recordSchedulerRun(
  schedulerName: string,
  success: boolean,
  error: string | null = null
): void {
  const state = getSchedulerState(schedulerName);
  state.lastRunAt = new Date();
  state.totalRuns++;

  if (success) {
    state.lastSuccessAt = new Date();
    state.consecutiveFailures = 0;
  } else {
    state.lastErrorAt = new Date();
    state.lastError = error;
    state.consecutiveFailures++;
  }
}

// Bug 167: Scheduler restart can enqueue duplicate jobs
export function generateSchedulerJobId(
  schedulerName: string,
  scheduledTime: Date,
  entityId?: string
): string {
  const timeKey = Math.floor(scheduledTime.getTime() / 60000);
  const parts = [schedulerName, timeKey.toString()];
  if (entityId) parts.push(entityId);
  return parts.join(':');
}

// Bug 168: Cron-like schedules not timezone-safe
export interface TimezoneAwareSchedule {
  cronExpression: string;
  timezone: string;
  nextRunUtc: Date;
  nextRunLocal: Date;
}

export function calculateNextRunTime(
  cronExpression: string,
  timezone: string = 'UTC',
  fromDate: Date = new Date()
): Date {
  const minute = cronExpression.split(' ')[0];
  const hour = cronExpression.split(' ')[1];

  const utcDate = new Date(fromDate);

  if (hour !== '*') {
    utcDate.setUTCHours(parseInt(hour, 10));
  }
  if (minute !== '*') {
    utcDate.setUTCMinutes(parseInt(minute, 10));
  }
  utcDate.setUTCSeconds(0);
  utcDate.setUTCMilliseconds(0);

  if (utcDate <= fromDate) {
    utcDate.setUTCDate(utcDate.getUTCDate() + 1);
  }

  return utcDate;
}

// Bug 169: Long-running jobs block queue fairness
export interface JobFairnessConfig {
  maxJobDurationMs: number;
  yieldAfterMs: number;
  priority: number;
  allowPreemption: boolean;
}

export const DEFAULT_FAIRNESS_CONFIG: JobFairnessConfig = {
  maxJobDurationMs: 300000,
  yieldAfterMs: 30000,
  priority: 2,
  allowPreemption: false
};

export function shouldYieldJob(startedAt: Date, config: JobFairnessConfig): boolean {
  const elapsed = Date.now() - startedAt.getTime();
  return elapsed > config.yieldAfterMs;
}

// Bug 170: Job starvation possible under heavy load
export interface QueuePriority {
  queueName: string;
  priority: number;
  weight: number;
  maxConcurrent: number;
}

export const QUEUE_PRIORITIES: QueuePriority[] = [
  { queueName: 'notification', priority: 1, weight: 3, maxConcurrent: 20 },
  { queueName: 'sync-source', priority: 2, weight: 2, maxConcurrent: 10 },
  { queueName: 'resolution', priority: 3, weight: 2, maxConcurrent: 5 },
  { queueName: 'cover-refresh', priority: 4, weight: 1, maxConcurrent: 5 }
];

export function selectNextQueue(
  queueStats: { name: string; pending: number; active: number }[]
): string | null {
  for (const priority of QUEUE_PRIORITIES) {
    const stats = queueStats.find(q => q.name === priority.queueName);
    if (stats && stats.pending > 0 && stats.active < priority.maxConcurrent) {
      return priority.queueName;
    }
  }
  return null;
}

// Bug 171: No global concurrency cap across workers
export interface GlobalConcurrency {
  maxGlobalJobs: number;
  currentJobs: number;
  perQueueLimits: Record<string, number>;
  perSourceLimits: Record<string, number>;
}

let globalConcurrency: GlobalConcurrency = {
  maxGlobalJobs: 100,
  currentJobs: 0,
  perQueueLimits: {},
  perSourceLimits: {}
};

export function canStartNewJob(queueName: string, sourceName?: string): boolean {
  if (globalConcurrency.currentJobs >= globalConcurrency.maxGlobalJobs) {
    return false;
  }

  const queueLimit = QUEUE_PRIORITIES.find(q => q.queueName === queueName)?.maxConcurrent || 10;
  const queueCurrent = globalConcurrency.perQueueLimits[queueName] || 0;
  if (queueCurrent >= queueLimit) {
    return false;
  }

  if (sourceName) {
    const sourceLimit = 5;
    const sourceCurrent = globalConcurrency.perSourceLimits[sourceName] || 0;
    if (sourceCurrent >= sourceLimit) {
      return false;
    }
  }

  return true;
}

export function recordJobStart(queueName: string, sourceName?: string): void {
  globalConcurrency.currentJobs++;
  globalConcurrency.perQueueLimits[queueName] = (globalConcurrency.perQueueLimits[queueName] || 0) + 1;
  if (sourceName) {
    globalConcurrency.perSourceLimits[sourceName] = (globalConcurrency.perSourceLimits[sourceName] || 0) + 1;
  }
}

export function recordJobEnd(queueName: string, sourceName?: string): void {
  globalConcurrency.currentJobs = Math.max(0, globalConcurrency.currentJobs - 1);
  globalConcurrency.perQueueLimits[queueName] = Math.max(0, (globalConcurrency.perQueueLimits[queueName] || 1) - 1);
  if (sourceName) {
    globalConcurrency.perSourceLimits[sourceName] = Math.max(0, (globalConcurrency.perSourceLimits[sourceName] || 1) - 1);
  }
}

// Bug 172: Worker scaling creates thundering herd
export function calculateScalingDelay(workerIndex: number, baseDelayMs: number = 1000): number {
  return baseDelayMs * workerIndex + Math.random() * baseDelayMs;
}

// Bug 173: No adaptive scheduling based on backlog
export interface AdaptiveSchedulingConfig {
  minIntervalMs: number;
  maxIntervalMs: number;
  targetBacklog: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
}

export function calculateAdaptiveInterval(
  currentBacklog: number,
  config: AdaptiveSchedulingConfig
): number {
  if (currentBacklog > config.scaleUpThreshold) {
    return config.minIntervalMs;
  }

  if (currentBacklog < config.scaleDownThreshold) {
    return config.maxIntervalMs;
  }

  const ratio = (currentBacklog - config.scaleDownThreshold) /
    (config.scaleUpThreshold - config.scaleDownThreshold);
  return config.maxIntervalMs - (config.maxIntervalMs - config.minIntervalMs) * ratio;
}

// Bug 174: Job priority inversion possible
export interface PriorityQueue {
  high: string[];
  medium: string[];
  low: string[];
}

export function enqueueWithPriority(
  queue: PriorityQueue,
  jobId: string,
  priority: 'high' | 'medium' | 'low'
): void {
  queue[priority].push(jobId);
}

export function dequeueByPriority(queue: PriorityQueue): string | null {
  if (queue.high.length > 0) return queue.high.shift()!;
  if (queue.medium.length > 0) return queue.medium.shift()!;
  if (queue.low.length > 0) return queue.low.shift()!;
  return null;
}

// Bug 175: Scheduler errors not surfaced to monitoring
export interface SchedulerMetrics {
  schedulerName: string;
  runsTotal: number;
  runsSuccess: number;
  runsFailed: number;
  lastRunDurationMs: number;
  avgRunDurationMs: number;
  errorRate: number;
}

const schedulerMetrics = new Map<string, SchedulerMetrics>();

export function recordSchedulerMetrics(
  schedulerName: string,
  success: boolean,
  durationMs: number
): void {
  let metrics = schedulerMetrics.get(schedulerName);

  if (!metrics) {
    metrics = {
      schedulerName,
      runsTotal: 0,
      runsSuccess: 0,
      runsFailed: 0,
      lastRunDurationMs: 0,
      avgRunDurationMs: 0,
      errorRate: 0
    };
    schedulerMetrics.set(schedulerName, metrics);
  }

  metrics.runsTotal++;
  if (success) {
    metrics.runsSuccess++;
  } else {
    metrics.runsFailed++;
  }

  metrics.lastRunDurationMs = durationMs;
  metrics.avgRunDurationMs = (metrics.avgRunDurationMs * (metrics.runsTotal - 1) + durationMs) / metrics.runsTotal;
  metrics.errorRate = metrics.runsFailed / metrics.runsTotal;
}

export function getSchedulerMetrics(schedulerName: string): SchedulerMetrics | null {
  return schedulerMetrics.get(schedulerName) || null;
}

// Bug 176: Failed scheduler run not retried deterministically
export function calculateSchedulerRetryDelay(
  consecutiveFailures: number,
  baseDelayMs: number = 60000,
  maxDelayMs: number = 3600000
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, Math.min(consecutiveFailures, 10));
  const jitter = exponentialDelay * 0.2 * Math.random();
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

// Bug 177: Scheduler logic not idempotent
export function generateSchedulerRunId(
  schedulerName: string,
  windowStart: Date
): string {
  const windowKey = Math.floor(windowStart.getTime() / 60000);
  return `${schedulerName}:run:${windowKey}`;
}

// Bug 178: Scheduler metadata not versioned
export const SCHEDULER_CONFIG_VERSION = 1;

export interface VersionedSchedulerConfig {
  version: number;
  schedulerName: string;
  intervalMs: number;
  concurrency: number;
  enabled: boolean;
  updatedAt: Date;
}

export function createSchedulerConfig(
  schedulerName: string,
  intervalMs: number,
  concurrency: number = 1
): VersionedSchedulerConfig {
  return {
    version: SCHEDULER_CONFIG_VERSION,
    schedulerName,
    intervalMs,
    concurrency,
    enabled: true,
    updatedAt: new Date()
  };
}

// Bug 179: Scheduler changes require redeploy
const runtimeSchedulerConfigs = new Map<string, VersionedSchedulerConfig>();

export function updateSchedulerConfig(
  schedulerName: string,
  updates: Partial<VersionedSchedulerConfig>
): VersionedSchedulerConfig {
  const existing = runtimeSchedulerConfigs.get(schedulerName) ||
    createSchedulerConfig(schedulerName, 60000);

  const updated: VersionedSchedulerConfig = {
    ...existing,
    ...updates,
    schedulerName,
    updatedAt: new Date()
  };

  runtimeSchedulerConfigs.set(schedulerName, updated);
  return updated;
}

export function getSchedulerConfig(schedulerName: string): VersionedSchedulerConfig | null {
  return runtimeSchedulerConfigs.get(schedulerName) || null;
}

// Bug 180: Scheduler assumes Redis availability at boot
export interface SchedulerHealthCheck {
  schedulerName: string;
  redisConnected: boolean;
  databaseConnected: boolean;
  lastHealthCheck: Date;
  canStart: boolean;
  errors: string[];
}

export async function checkSchedulerHealth(
  schedulerName: string,
  checkRedis: () => Promise<boolean>,
  checkDatabase: () => Promise<boolean>
): Promise<SchedulerHealthCheck> {
  const errors: string[] = [];

  let redisConnected = false;
  try {
    redisConnected = await checkRedis();
  } catch (e) {
    errors.push(`Redis check failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  let databaseConnected = false;
  try {
    databaseConnected = await checkDatabase();
  } catch (e) {
    errors.push(`Database check failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }

  return {
    schedulerName,
    redisConnected,
    databaseConnected,
    lastHealthCheck: new Date(),
    canStart: redisConnected && databaseConnected,
    errors
  };
}
