import { notificationDeliveryQueue, notificationDeliveryPremiumQueue } from '@/lib/queues';
import { logger } from '@/lib/logger';

/**
 * Safety Monitor Scheduler
 * Implements anti-starvation and health checks for the notification system.
 */
export async function runSafetyMonitor() {
  logger.info('[Safety-Monitor] Running health checks...');

  try {
    const freeQueueCounts = await notificationDeliveryQueue.getJobCounts('waiting', 'active', 'delayed');
    const freeWaiting = freeQueueCounts.waiting;
    
    const premiumQueueCounts = await notificationDeliveryPremiumQueue.getJobCounts('waiting', 'active', 'delayed');
    const premiumWaiting = premiumQueueCounts.waiting;

    logger.info('[Safety-Monitor] Queue Depths', { freeWaiting, premiumWaiting });

    if (freeWaiting > 10000) {
      logger.error(`[Safety-Monitor] CRITICAL: Free queue depth exceeded threshold (10,000)`, { current: freeWaiting });
    }

    const oldestFreeJobs = await notificationDeliveryQueue.getJobs(['waiting'], 0, 0, true);
    if (oldestFreeJobs.length > 0) {
      const oldestJob = oldestFreeJobs[0];
      const ageMs = Date.now() - oldestJob.timestamp;
      const ageMinutes = ageMs / (1000 * 60);

      if (ageMinutes > 5) {
        logger.error(`[Safety-Monitor] CRITICAL: Free queue oldest job age exceeded threshold (5 minutes)`, { ageMinutes: ageMinutes.toFixed(2) });
      }
    }

    const totalWaiting = freeWaiting + premiumWaiting;
    if (totalWaiting > 50000) {
      logger.warn(`[Safety-Monitor] WARNING: System-wide notification backlog detected`, { totalWaiting });
    }

  } catch (error) {
    logger.error('[Safety-Monitor] Failed to run health checks:', { error: error instanceof Error ? error.message : String(error) });
  }
}
