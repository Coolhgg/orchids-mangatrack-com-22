import { latestFeedQueue } from '@/lib/queues';
import { withLock } from '@/lib/redis';

/**
 * Scheduler for latest feed discovery.
 * Polls "Latest Updates" pages of major sources every 10 minutes.
 */
export async function runLatestFeedScheduler() {
  return await withLock('scheduler:latest-feed', 300000, async () => {
    console.log('[LatestFeedScheduler] Enqueuing latest feed discovery job...');
    
    // Add a single job to the queue
    await latestFeedQueue.add(
      'latest-feed-discovery',
      {},
      {
        jobId: 'latest-feed-discovery', // Deduped
        removeOnComplete: true,
      }
    );
  });
}
