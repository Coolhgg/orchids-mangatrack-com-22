import { Queue } from 'bullmq';
import { prisma } from './prisma';
import { isQueueHealthy } from './queues';
import { redis, REDIS_KEY_PREFIX } from './redis';

/**
 * Normalize search queries according to requirements:
 * - lowercase
 * - trim whitespace
 * - collapse multiple spaces
 * - remove non-alphanumeric characters (diacritics are decomposed and removed)
 * - produce normalized_key (string)
 */
export function normalizeSearchQuery(query: string): string {
  return query
    .toLowerCase()
    .normalize('NFD') // Decompose diacritics
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9 ]/g, '') // Remove non-alphanumeric except spaces
    .trim()
    .replace(/\s+/g, ' '); // Collapse spaces
}

export interface EnqueueRulesOptions {
  isAdminOrSystem?: boolean;
}

export type EnqueueDecision = {
  shouldEnqueue: boolean;
  reason?: 'queue_unhealthy' | 'resolved' | 'below_threshold' | 'cooldown' | 'active_job';
};

export const SEARCH_QUEUE_HEALTH_THRESHOLD = 5000;

/**
 * External search job intent collapse and enqueue rules (ALL must pass):
 * 1. Queue Health: checkSourceQueue must be healthy.
 * 2. Resolution state: resolved === false in DB.
 * 3. Heat threshold: total_searches >= 2 OR unique_users >= 2 OR admin/system.
 * 4. Intent Collapse Window: Allow ONLY one job per 30 seconds.
 *    - Check DB last_enqueued_at for the 30s window.
 *    - Check BullMQ for active/waiting jobs with the same jobId (normalizedKey).
 */
export async function shouldEnqueueExternalSearch(
  normalizedKey: string,
  queue: Queue,
  options: EnqueueRulesOptions = {}
): Promise<EnqueueDecision> {
  // 1. Check queue health
  const healthy = await isQueueHealthy(queue, SEARCH_QUEUE_HEALTH_THRESHOLD);
  if (!healthy) return { shouldEnqueue: false, reason: 'queue_unhealthy' };

  // 2. Fetch stats from DB
  const stats = await prisma.queryStats.findUnique({
    where: { normalized_key: normalizedKey }
  });

  // If already resolved, we don't need external search
  if (stats?.resolved) return { shouldEnqueue: false, reason: 'resolved' };

  // 3. Heat threshold removed - always allow external search for any user query
  // This ensures first-time searches immediately trigger MangaDex lookups
  const meetsThreshold = true;

  // 4. Intent Collapse: 30-second window check (Application Layer)
  if (stats?.last_enqueued_at) {
    const now = new Date();
    const cooldownPeriod = 30 * 1000;
    const timeSinceLastEnqueue = now.getTime() - stats.last_enqueued_at.getTime();
    if (timeSinceLastEnqueue < cooldownPeriod) {
      return { shouldEnqueue: false, reason: 'cooldown' };
    }
  }

  // 5. Intent Collapse: Queue Layer Check
  // Even if 30s passed, if a job is currently active/waiting, don't duplicate.
  const existingJob = await queue.getJob(normalizedKey);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      return { shouldEnqueue: false, reason: 'active_job' };
    }
  }

  return { shouldEnqueue: true };
}

/**
 * Update query statistics:
 * - Increment total_searches
 * - Increment unique_users if user not seen for this key (tracked in Redis)
 * - Update last_searched_at
 * - Reset deferred to false (active user interest)
 */
export async function recordSearchIntent(
  normalizedKey: string,
  userId?: string
): Promise<void> {
  const usersKey = `${REDIS_KEY_PREFIX}query:users:${normalizedKey}`;
  
  let isUniqueUser = false;
  if (userId) {
    const added = await redis.sadd(usersKey, userId);
    if (added === 1) {
      isUniqueUser = true;
      await redis.expire(usersKey, 86400 * 7); // 7 days retention for uniqueness
    }
  }

  await prisma.queryStats.upsert({
    where: { normalized_key: normalizedKey },
    create: {
      normalized_key: normalizedKey,
      total_searches: 1,
      unique_users: isUniqueUser ? 1 : 0,
      last_searched_at: new Date(),
      deferred: false,
    },
    update: {
      total_searches: { increment: 1 },
      unique_users: isUniqueUser ? { increment: 1 } : undefined,
      last_searched_at: new Date(),
      deferred: false,
    },
  });
}

/**
 * Mark a query as deferred for background resolution.
 */
export async function markQueryDeferred(normalizedKey: string): Promise<void> {
  await prisma.queryStats.update({
    where: { normalized_key: normalizedKey },
    data: { deferred: true }
  });
}

/**
 * Mark a query as enqueued.
 */
export async function markQueryEnqueued(normalizedKey: string): Promise<void> {
  await prisma.queryStats.update({
    where: { normalized_key: normalizedKey },
    data: { last_enqueued_at: new Date() }
  });
}

/**
 * Mark a query as resolved.
 */
export async function markQueryResolved(normalizedKey: string): Promise<void> {
  await prisma.queryStats.upsert({
    where: { normalized_key: normalizedKey },
    create: {
      normalized_key: normalizedKey,
      resolved: true,
      last_searched_at: new Date(),
    },
    update: {
      resolved: true
    }
  });
}
