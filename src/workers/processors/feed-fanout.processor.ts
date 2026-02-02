import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { feedFanoutQueue, isQueueHealthy } from '@/lib/queues';
import { z } from 'zod';

/**
 * Fan-out Limits and Batching Design
 * 
 * THRESHOLDS:
 * - BATCH_INSERT_SIZE: 500 users per DB insert (SQL parameter limit)
 * - MAX_INLINE_FANOUT: 10,000 users - processed in single job
 * - MAX_TOTAL_FANOUT: 100,000 users - hard cap per event
 * - BATCH_JOB_SIZE: 5,000 users per child job for large fan-outs
 * 
 * BACKPRESSURE:
 * - Queue health check before spawning child jobs
 * - Exponential backoff on queue overload
 * - Graceful degradation: skip non-critical fan-outs when system stressed
 * 
 * FAILURE HANDLING:
 * - Partial success tracking via job progress
 * - Child jobs are idempotent (ON CONFLICT DO NOTHING)
 * - Failed batches can be retried independently
 */

// Fan-out configuration constants
const FANOUT_CONFIG = {
  /** Max users per single DB INSERT (SQL parameter safety) */
  BATCH_INSERT_SIZE: 500,
  /** Max users to process inline in parent job */
  MAX_INLINE_FANOUT: 10_000,
  /** Max total users per event (hard cap) */
  MAX_TOTAL_FANOUT: 100_000,
  /** Users per child job for large fan-outs */
  BATCH_JOB_SIZE: 5_000,
  /** Queue waiting threshold for backpressure */
  QUEUE_HEALTH_THRESHOLD: 50_000,
  /** Delay between batch job spawns (ms) */
  BATCH_SPAWN_DELAY: 100,
} as const;

const FeedFanoutDataSchema = z.object({
  sourceId: z.string().uuid(),
  seriesId: z.string().uuid(),
  chapterId: z.string().uuid(),
  discoveredAt: z.string().datetime(),
  // Optional batch fields for child jobs
  userIds: z.array(z.string().uuid()).optional(),
  eventWeight: z.number().optional(),
  isBatchJob: z.boolean().optional(),
});

export type FeedFanoutData = z.infer<typeof FeedFanoutDataSchema>;

/**
 * Main fan-out processor
 * Handles both parent coordination and child batch execution
 */
export async function processFeedFanout(job: Job<FeedFanoutData>) {
  const parseResult = FeedFanoutDataSchema.safeParse(job.data);
  if (!parseResult.success) {
    throw new Error(`Invalid job payload: ${parseResult.error.message}`);
  }

  const data = parseResult.data;

  // Route to appropriate handler
  if (data.isBatchJob && data.userIds && data.eventWeight !== undefined) {
    return processBatchFanout(job, {
      ...data,
      userIds: data.userIds,
      eventWeight: data.eventWeight,
    });
  }

  return processParentFanout(job, data);
}

/**
 * Parent job: coordinates fan-out strategy
 */
async function processParentFanout(job: Job<FeedFanoutData>, data: FeedFanoutData) {
  const { sourceId, seriesId, chapterId, discoveredAt } = data;
  const timestamp = new Date(discoveredAt);

  // 1. Calculate event weight
  const otherSourcesCount = await prisma.chapterSource.count({
    where: {
      chapter_id: chapterId,
      detected_at: { lt: timestamp },
    },
  });
  const eventWeight = otherSourcesCount === 0 ? 3 : 2;

  // 2. Count followers who haven't read this chapter
  const followerCount = await prisma.libraryEntry.count({
    where: {
      series_id: seriesId,
      status: 'reading',
      deleted_at: null,
      user: {
        chapter_reads_v2: {
          none: {
            chapter_id: chapterId,
            is_read: true,
          }
        }
      }
    },
  });

  if (followerCount === 0) {
    console.log(`[FeedFanout] No eligible followers for series ${seriesId} / chapter ${chapterId}, skipping`);
    return { processed: 0, strategy: 'skip' };
  }

  // 3. Apply hard cap
  if (followerCount > FANOUT_CONFIG.MAX_TOTAL_FANOUT) {
    console.warn(
      `[FeedFanout] Series ${seriesId} has ${followerCount} followers, ` +
      `exceeding cap of ${FANOUT_CONFIG.MAX_TOTAL_FANOUT}. Truncating.`
    );
  }

  const effectiveLimit = Math.min(followerCount, FANOUT_CONFIG.MAX_TOTAL_FANOUT);

  // 4. Choose strategy based on fan-out size
  if (effectiveLimit <= FANOUT_CONFIG.MAX_INLINE_FANOUT) {
    // Small fan-out: process inline
    return processInlineFanout(job, {
      sourceId,
      seriesId,
      chapterId,
      timestamp,
      eventWeight,
      limit: effectiveLimit,
    });
  }

  // Large fan-out: spawn batch jobs
  return spawnBatchJobs(job, {
    sourceId,
    seriesId,
    chapterId,
    discoveredAt,
    eventWeight,
    totalFollowers: effectiveLimit,
  });
}

/**
 * Inline fan-out for small audiences (≤10k users)
 * Processes all users in the current job
 */
async function processInlineFanout(
  job: Job<FeedFanoutData>,
  params: {
    sourceId: string;
    seriesId: string;
    chapterId: string;
    timestamp: Date;
    eventWeight: number;
    limit: number;
  }
) {
  const { sourceId, seriesId, chapterId, timestamp, eventWeight, limit } = params;

  // Fetch all user IDs who haven't read this chapter
  const followers = await prisma.libraryEntry.findMany({
    where: {
      series_id: seriesId,
      status: 'reading',
      deleted_at: null,
      user: {
        chapter_reads_v2: {
          none: {
            chapter_id: chapterId,
            is_read: true,
          }
        }
      }
    },
    select: { user_id: true },
    take: limit,
  });

  const userIds = followers.map(f => f.user_id);
  let processed = 0;

    // Process in DB-safe chunks
    for (let i = 0; i < userIds.length; i += FANOUT_CONFIG.BATCH_INSERT_SIZE) {
      const chunk = userIds.slice(i, i + FANOUT_CONFIG.BATCH_INSERT_SIZE);

      await prisma.$transaction([
        prisma.$executeRaw`
          INSERT INTO user_availability_feed (user_id, series_id, chapter_id, source_id, event_weight, discovered_at)
          SELECT 
            u.id, 
            ${seriesId}::uuid, 
            ${chapterId}::uuid, 
            ${sourceId}::uuid, 
            ${eventWeight}, 
            ${timestamp}
          FROM unnest(${chunk}::uuid[]) as u(id)
          WHERE NOT EXISTS (
            SELECT 1 FROM user_chapter_reads_v2 ucr
            WHERE ucr.user_id = u.id 
            AND ucr.chapter_id = ${chapterId}::uuid
            AND ucr.is_read = true
          )
          ON CONFLICT DO NOTHING;
        `,
        prisma.$executeRaw`
          INSERT INTO notifications_queue (user_id, series_id, chapter_id, notify_after)
          SELECT 
            u.id, 
            ${seriesId}::uuid, 
            ${chapterId}::uuid, 
            now() + interval '10 minutes'
          FROM unnest(${chunk}::uuid[]) as u(id)
          JOIN library_entries le ON le.user_id = u.id AND le.series_id = ${seriesId}::uuid
          WHERE le.notify_new_chapters = true
            AND le.status != 'dropped'
            AND NOT EXISTS (
              SELECT 1 FROM user_chapter_reads_v2 ucr
              WHERE ucr.user_id = u.id 
              AND ucr.chapter_id = ${chapterId}::uuid
              AND ucr.is_read = true
            )
          ON CONFLICT (user_id, chapter_id) DO NOTHING;
        `
      ]);

      processed += chunk.length;
      await job.updateProgress(Math.round((processed / userIds.length) * 100));
    }

  console.log(`[FeedFanout] Inline completed: ${processed} users for source ${sourceId}`);
  return { processed, strategy: 'inline' };
}

/**
 * Spawn batch jobs for large audiences (>10k users)
 * Creates child jobs that each handle a subset of users
 */
async function spawnBatchJobs(
  job: Job<FeedFanoutData>,
  params: {
    sourceId: string;
    seriesId: string;
    chapterId: string;
    discoveredAt: string;
    eventWeight: number;
    totalFollowers: number;
  }
) {
  const { sourceId, seriesId, chapterId, discoveredAt, eventWeight, totalFollowers } = params;

  // Check queue health before spawning
  const isHealthy = await isQueueHealthy(feedFanoutQueue, FANOUT_CONFIG.QUEUE_HEALTH_THRESHOLD);
  if (!isHealthy) {
    console.warn(`[FeedFanout] Queue overloaded, deferring large fan-out for ${sourceId}`);
    throw new Error('Queue overloaded - will retry with backoff');
  }

  // Fetch user IDs in pages and spawn batch jobs
  const batchSize = FANOUT_CONFIG.BATCH_JOB_SIZE;
  let offset = 0;
  let batchCount = 0;

  while (offset < totalFollowers) {
    const followers = await prisma.libraryEntry.findMany({
      where: {
        series_id: seriesId,
        status: 'reading',
        deleted_at: null,
        user: {
          chapter_reads_v2: {
            none: {
              chapter_id: chapterId,
              is_read: true,
            }
          }
        }
      },
      select: { user_id: true },
      skip: offset,
      take: batchSize,
    });

    if (followers.length === 0) break;

    const userIds = followers.map(f => f.user_id);
    const batchJobId = `fanout-batch-${sourceId}-${batchCount}`;

    await feedFanoutQueue.add(
      batchJobId,
      {
        sourceId,
        seriesId,
        chapterId,
        discoveredAt,
        userIds,
        eventWeight,
        isBatchJob: true,
      },
      {
        jobId: batchJobId,
        delay: batchCount * FANOUT_CONFIG.BATCH_SPAWN_DELAY,
      }
    );

    offset += followers.length;
    batchCount++;

    // Update parent progress
    await job.updateProgress(Math.round((offset / totalFollowers) * 100));
  }

  console.log(
    `[FeedFanout] Spawned ${batchCount} batch jobs for source ${sourceId} ` +
    `(${totalFollowers} total users)`
  );

  return { 
    processed: totalFollowers, 
    strategy: 'batched', 
    batchCount,
  };
}

/**
 * Child batch job: processes a specific subset of users
 * Idempotent via ON CONFLICT DO NOTHING
 */
async function processBatchFanout(
  job: Job<FeedFanoutData>,
  data: FeedFanoutData & { userIds: string[]; eventWeight: number }
) {
  const { sourceId, seriesId, chapterId, discoveredAt, userIds, eventWeight } = data;
  const timestamp = new Date(discoveredAt);

  let processed = 0;

    // Process in DB-safe chunks
    for (let i = 0; i < userIds.length; i += FANOUT_CONFIG.BATCH_INSERT_SIZE) {
      const chunk = userIds.slice(i, i + FANOUT_CONFIG.BATCH_INSERT_SIZE);

      await prisma.$transaction([
        prisma.$executeRaw`
          INSERT INTO user_availability_feed (user_id, series_id, chapter_id, source_id, event_weight, discovered_at)
          SELECT 
            u.id, 
            ${seriesId}::uuid, 
            ${chapterId}::uuid, 
            ${sourceId}::uuid, 
            ${eventWeight}, 
            ${timestamp}
          FROM unnest(${chunk}::uuid[]) as u(id)
          WHERE NOT EXISTS (
            SELECT 1 FROM user_chapter_reads_v2 ucr
            WHERE ucr.user_id = u.id 
            AND ucr.chapter_id = ${chapterId}::uuid
            AND ucr.is_read = true
          )
          ON CONFLICT DO NOTHING;
        `,
        prisma.$executeRaw`
          INSERT INTO notifications_queue (user_id, series_id, chapter_id, notify_after)
          SELECT 
            u.id, 
            ${seriesId}::uuid, 
            ${chapterId}::uuid, 
            now() + interval '10 minutes'
          FROM unnest(${chunk}::uuid[]) as u(id)
          JOIN library_entries le ON le.user_id = u.id AND le.series_id = ${seriesId}::uuid
          WHERE le.notify_new_chapters = true
            AND le.status != 'dropped'
            AND NOT EXISTS (
              SELECT 1 FROM user_chapter_reads_v2 ucr
              WHERE ucr.user_id = u.id 
              AND ucr.chapter_id = ${chapterId}::uuid
              AND ucr.is_read = true
            )
          ON CONFLICT (user_id, chapter_id) DO NOTHING;
        `
      ]);

      processed += chunk.length;
      await job.updateProgress(Math.round((processed / userIds.length) * 100));
    }

  console.log(`[FeedFanout] Batch completed: ${processed} users for source ${sourceId}`);
  return { processed, strategy: 'batch-child' };
}
