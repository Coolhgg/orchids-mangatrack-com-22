import { notificationDigestQueue } from '@/lib/queues';

/**
 * Triggers the notification digest processor.
 * Should be called periodically by the master scheduler.
 */
export async function runNotificationDigestScheduler() {
  console.log('[Notification-Digest-Scheduler] Checking for eligible digests...');
  
  await notificationDigestQueue.add(
    'process-digests',
    {},
    {
      jobId: 'process-digests-trigger', // Singleton job to avoid concurrent master runs
      removeOnComplete: true,
    }
  );
}
