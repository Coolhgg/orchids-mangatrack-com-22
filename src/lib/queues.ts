import { Queue, QueueOptions, WorkerOptions } from 'bullmq';
import { redisWorker, REDIS_KEY_PREFIX, redisMode, redisConnection } from './redis';

// ==========================================
// BUG 42: Queue options with visibility timeout tuning
// ==========================================
import { QUEUE_CONFIGS, getQueueConfig } from './audit-pass3-fixes';

export const SYNC_SOURCE_QUEUE = 'sync-source';
export const CHECK_SOURCE_QUEUE = 'check-source';
export const NOTIFICATION_QUEUE = 'notifications';
export const NOTIFICATION_DELIVERY_QUEUE = 'notification-delivery';
export const NOTIFICATION_DELIVERY_PREMIUM_QUEUE = 'notification-delivery-premium';
export const NOTIFICATION_DIGEST_QUEUE = 'notification-digest';
export const CANONICALIZE_QUEUE = 'canonicalize';
export const REFRESH_COVER_QUEUE = 'refresh-cover';
export const CHAPTER_INGEST_QUEUE = 'chapter-ingest';
export const GAP_RECOVERY_QUEUE = 'gap-recovery';
export const SERIES_RESOLUTION_QUEUE = 'series-resolution';
export const IMPORT_QUEUE = 'import';
export const FEED_FANOUT_QUEUE = 'feed-fanout';
export const LATEST_FEED_QUEUE = 'latest-feed';
export const NOTIFICATION_TIMING_QUEUE = 'notification-timing';
export const MANGADEX_STATS_REFRESH_QUEUE = 'mangadex-stats-refresh';
export const FEED_INGEST_QUEUE = 'feed-ingest';

/**
 * Queue options using the Worker Redis instance.
 * 
 * CRITICAL: BullMQ Queues and Workers MUST be on the same Redis instance.
 * Queues use Worker Redis because workers process jobs from this Redis.
 * 
 * Connection Balance Strategy:
 * - API Redis (redis-11509): Caching, rate limiting, search cache, heartbeat
 * - Worker Redis (redis-16672): BullMQ queues, workers, locks, scheduler
 * 
 * The queues share the `redisWorker` connection (not creating new ones).
 * Workers create their own blocking connections (unavoidable in BullMQ).
 */
const queueOptions: QueueOptions = {
  connection: redisWorker as any,
  prefix: REDIS_KEY_PREFIX,
};

console.log('[Queues] Redis mode: %s, using Worker Redis for BullMQ', redisMode);

// Singleton pattern for Next.js hot reload protection
const globalForQueues = globalThis as unknown as {
  queues: Record<string, Queue>;
};

if (!globalForQueues.queues) {
  globalForQueues.queues = {};
}

/**
 * Lazy-load helper to initialize queues only when needed.
 * This saves connections in the API process if only some queues are used.
 */
function getQueue(name: string, options: Partial<QueueOptions> = {}): Queue {
  if (globalForQueues.queues[name]) {
    return globalForQueues.queues[name];
  }

  console.log(`[Queues] Initializing queue: ${name}`);
  const queue = new Queue(name, {
    ...queueOptions,
    ...options,
  });

  globalForQueues.queues[name] = queue;
  return queue;
}

/**
 * Creates a proxy for a queue to delay its initialization until it's actually used.
 */
function createLazyQueue(name: string, options: Partial<QueueOptions> = {}): Queue {
  return new Proxy({} as Queue, {
    get(target, prop, receiver) {
      const queue = getQueue(name, options);
      const value = Reflect.get(queue, prop, receiver);
      return typeof value === 'function' ? value.bind(queue) : value;
    }
  });
}

/**
 * BUG 42 FIX: Get worker options with proper lockDuration settings.
 * This ensures long-running jobs don't get re-processed due to lock expiry.
 * 
 * @param queueName The name of the queue
 * @param overrides Optional worker option overrides
 * @returns WorkerOptions with proper lockDuration and stalledInterval
 */
export function getWorkerOptions(
  queueName: string, 
  overrides: Partial<WorkerOptions> = {}
): WorkerOptions {
  const config = getQueueConfig(queueName);
  
  return {
    connection: redisConnection,
    prefix: REDIS_KEY_PREFIX,
    lockDuration: config.lockDuration,
    stalledInterval: config.stalledInterval,
    maxStalledCount: config.maxStalledCount,
    ...overrides,
  };
}

// Exported lazy getters using Proxy
export const syncSourceQueue = createLazyQueue(SYNC_SOURCE_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 5000 }, 
  },
});

export const chapterIngestQueue = createLazyQueue(CHAPTER_INGEST_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500, age: 3600 },
    removeOnFail: { count: 10000 },
  },
});

export const checkSourceQueue = createLazyQueue(CHECK_SOURCE_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 1000 },
  },
});

export const notificationQueue = createLazyQueue(NOTIFICATION_QUEUE, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 5000 },
  },
});

export const notificationDeliveryQueue = createLazyQueue(NOTIFICATION_DELIVERY_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500, age: 3600 },
    removeOnFail: { count: 10000 },
  },
});

export const notificationDeliveryPremiumQueue = createLazyQueue(NOTIFICATION_DELIVERY_PREMIUM_QUEUE, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { count: 20000 },
  },
});

export const notificationDigestQueue = createLazyQueue(NOTIFICATION_DIGEST_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const canonicalizeQueue = createLazyQueue(CANONICALIZE_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const refreshCoverQueue = createLazyQueue(REFRESH_COVER_QUEUE, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 50, age: 3600 },
    removeOnFail: { count: 100, age: 86400 },
  },
});

export const gapRecoveryQueue = createLazyQueue(GAP_RECOVERY_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 500, age: 86400 },
  },
});

export const seriesResolutionQueue = createLazyQueue(SERIES_RESOLUTION_QUEUE, {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
  },
});

export const importQueue = createLazyQueue(IMPORT_QUEUE, {
  defaultJobOptions: {
    // QA FIX: Increased attempts from 2 to 5 for large CSV imports
    // User-triggered imports should have more retries due to large file handling
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 100, age: 86400 },
    removeOnFail: { count: 100, age: 604800 },
  },
});

export const feedFanoutQueue = createLazyQueue(FEED_FANOUT_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 1000, age: 86400 },
  },
});

export const latestFeedQueue = createLazyQueue(LATEST_FEED_QUEUE, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: { count: 50, age: 3600 },
    removeOnFail: { count: 100, age: 86400 },
  },
});

export const notificationTimingQueue = createLazyQueue(NOTIFICATION_TIMING_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 1000, age: 86400 },
  },
});

export const mangadexStatsRefreshQueue = createLazyQueue(MANGADEX_STATS_REFRESH_QUEUE, {
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { count: 50, age: 3600 },
    removeOnFail: { count: 100, age: 86400 },
  },
});

export const feedIngestQueue = createLazyQueue(FEED_INGEST_QUEUE, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { count: 200, age: 86400 },
  },
});

/**
 * Gets the overall system health for notifications.
 */
export async function getNotificationSystemHealth(): Promise<{ 
  totalWaiting: number; 
  isOverloaded: boolean;
  isCritical: boolean;
  isRejected: boolean;
}> {
  try {
    const freeCounts = await notificationDeliveryQueue.getJobCounts('waiting');
    const premiumCounts = await notificationDeliveryPremiumQueue.getJobCounts('waiting');
    const totalWaiting = freeCounts.waiting + premiumCounts.waiting;

    return {
      totalWaiting,
      isOverloaded: totalWaiting > 10000,
      isCritical: totalWaiting > 50000,
      isRejected: totalWaiting > 100000,
    };
  } catch (error) {
    console.error('[Queue] Health check failed:', error);
    return { totalWaiting: 0, isOverloaded: false, isCritical: false, isRejected: false };
  }
}

/**
 * Checks if a specific queue is healthy based on a waiting threshold.
 */
export async function isQueueHealthy(queue: Queue, threshold: number): Promise<boolean> {
  const counts = await queue.getJobCounts('waiting');
  return counts.waiting < threshold;
}

/**
 * Gets the total queue depth across all critical queues.
 * Used by feed ingest workers to pause non-critical crawls when overloaded.
 */
export async function getTotalQueueDepth(): Promise<{
  total: number;
  isOverloaded: boolean;
  isCritical: boolean;
  breakdown: Record<string, number>;
}> {
  try {
    const [syncCounts, ingestCounts, feedIngestCounts, resolutionCounts] = await Promise.all([
      syncSourceQueue.getJobCounts('waiting', 'active'),
      chapterIngestQueue.getJobCounts('waiting', 'active'),
      feedIngestQueue.getJobCounts('waiting', 'active'),
      seriesResolutionQueue.getJobCounts('waiting', 'active'),
    ]);

    const total = 
      (syncCounts.waiting || 0) + (syncCounts.active || 0) +
      (ingestCounts.waiting || 0) + (ingestCounts.active || 0) +
      (feedIngestCounts.waiting || 0) + (feedIngestCounts.active || 0) +
      (resolutionCounts.waiting || 0) + (resolutionCounts.active || 0);

    return {
      total,
      isOverloaded: total > 5000,
      isCritical: total > 10000,
      breakdown: {
        sync: (syncCounts.waiting || 0) + (syncCounts.active || 0),
        ingest: (ingestCounts.waiting || 0) + (ingestCounts.active || 0),
        feedIngest: (feedIngestCounts.waiting || 0) + (feedIngestCounts.active || 0),
        resolution: (resolutionCounts.waiting || 0) + (resolutionCounts.active || 0),
      },
    };
  } catch (error) {
    console.error('[Queue] Total depth check failed:', error);
    return { total: 0, isOverloaded: false, isCritical: false, breakdown: {} };
  }
}
