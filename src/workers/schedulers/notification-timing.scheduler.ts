import { notificationTimingQueue } from '@/lib/queues';
import { withLock } from '@/lib/redis';

/**
 * Scheduler for Notification Timing Queue.
 * Runs every minute to check for notifications ready to be sent.
 */
export async function runNotificationTimingScheduler() {
  return await withLock('scheduler:notification-timing', 45000, async () => {
    console.log('[NotificationTimingScheduler] Enqueuing timing processor job...');
    
    await notificationTimingQueue.add(
      'process-pending-notifications',
      {},
      {
        jobId: 'process-pending-notifications', // Deduped
        removeOnComplete: true,
      }
    );
  });
}
