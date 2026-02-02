import { prisma } from '@/lib/prisma';
import { checkSourceQueue, isQueueHealthy } from '@/lib/queues';
import { areWorkersOnline } from '@/lib/redis';
import { detectSearchIntent } from '@/lib/search-intent';
import { SEARCH_PRIORITY } from '@/lib/search-cache';
import { CheckSourceSchema } from '@/lib/schemas/queue-payloads';

const BATCH_SIZE = 10;

/**
 * Deferred Search Scheduler:
 * Processes cold or skipped search queries that were marked for later resolution.
 * 
 * Logic:
 * 1. Checks system capacity (workers online, queue healthy).
 * 2. Fetches candidates from QueryStats in FIFO order (ascending last_searched_at).
 * 3. Enqueues jobs and resets the deferred flag.
 * 
 * Safety Guards:
 * - Queue Health Check: Only runs if queue isn't saturated.
 * - Deduplication: Skips if already resolved or if a job is currently active/queued.
 * - FIFO Order: Ensures older user intents are processed first.
 * - Batch Limit: Max 10 per run to prevent burst overhead.
 */
export async function runDeferredSearchScheduler() {
  console.log('[DeferredSearch] Checking for deferred queries...');

  // 1. Capacity & Health Check
  const [workersOnline, queueHealthy] = await Promise.all([
    areWorkersOnline(),
    isQueueHealthy(checkSourceQueue, 5000)
  ]);

  if (!workersOnline || !queueHealthy) {
    console.log(`[DeferredSearch] Skipping cycle: workersOnline=${workersOnline}, queueHealthy=${queueHealthy}`);
    return;
  }

  // 2. Fetch candidates in FIFO order
  // Requirements: resolved === false, deferred === true, total_searches >= 1
  const candidates = await prisma.queryStats.findMany({
    where: {
      deferred: true,
      resolved: false,
      total_searches: { gte: 1 }
    },
    orderBy: {
      last_searched_at: 'asc' // FIFO: older searches first
    },
    take: BATCH_SIZE
  });

  if (candidates.length === 0) {
    console.log('[DeferredSearch] No deferred queries found.');
    return;
  }

  let processed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      // 3. Final Deduplication Check
      // Even if deferred=true, it might have been resolved recently or have an active job
      const existingJob = await checkSourceQueue.getJob(candidate.normalized_key);
      if (existingJob) {
        const state = await existingJob.getState();
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          console.log(`[DeferredSearch] Skip: Job ${state} for ${candidate.normalized_key}`);
          await prisma.queryStats.update({
            where: { normalized_key: candidate.normalized_key },
            data: { deferred: false }
          });
          skipped++;
          continue;
        }
      }

      // 4. Enqueue for resolution
      // Use LOW priority for background resolution unless we decide otherwise
      const priority = SEARCH_PRIORITY.LOW;
      const intent = detectSearchIntent(candidate.normalized_key, []);
      
      const payload = {
        query: candidate.normalized_key, // Using normalized key as query for background
        normalizedKey: candidate.normalized_key,
        intent,
        trigger: 'deferred_resolution',
        userId: undefined, // Background job
        isPremium: false
      };

      const validation = CheckSourceSchema.safeParse(payload);
      if (!validation.success) {
        console.error(`[DeferredSearch] Validation failed for ${candidate.normalized_key}:`, validation.error.message);
        skipped++;
        continue;
      }

      await checkSourceQueue.add('check-source', payload, {
        jobId: candidate.normalized_key,
        priority,
        removeOnComplete: true
      });

      // 5. Update state
      await prisma.queryStats.update({
        where: { normalized_key: candidate.normalized_key },
        data: { 
          deferred: false,
          last_enqueued_at: new Date()
        }
      });

      console.log(`[DeferredSearch] Enqueued: ${candidate.normalized_key}`);
      processed++;
    } catch (err) {
      console.error(`[DeferredSearch] Error processing ${candidate.normalized_key}:`, err);
    }
  }

  console.log(`[DeferredSearch] Cycle complete: processed=${processed}, skipped=${skipped}`);
}
