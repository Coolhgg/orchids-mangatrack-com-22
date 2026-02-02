import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Cleanup Scheduler
 * 1. Identifies and fails stuck jobs
 * 2. Prunes old temporal data (Activity Feed, Audit Logs, Worker Failures)
 */
export async function runCleanupScheduler() {
  logger.info('[Cleanup-Scheduler] Running stuck job cleanup and data pruning...');

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const stuckImportJobs = await prisma.importJob.updateMany({
      where: {
        status: { in: ['pending', 'processing'] },
        created_at: { lt: oneHourAgo }
      },
      data: {
        status: 'failed',
        error_log: {
          error: 'Job timed out',
          message: 'This job was stuck for over an hour and was automatically failed by the cleanup scheduler.'
        },
        completed_at: now
      }
    });

    if (stuckImportJobs.count > 0) {
      logger.info(`[Cleanup-Scheduler] Automatically failed ${stuckImportJobs.count} stuck import jobs.`);
    }

    const prunedAvailability = await prisma.$executeRaw`
      DELETE FROM user_availability_feed 
      WHERE discovered_at < ${ninetyDaysAgo}
    `;
    
    const prunedLibraryEntries = await prisma.libraryEntry.deleteMany({
      where: {
        deleted_at: { lt: ninetyDaysAgo }
      }
    });

    const prunedFeedEntries = await prisma.feedEntry.deleteMany({
      where: {
        created_at: { lt: ninetyDaysAgo }
      }
    });

    const prunedNotifications = await prisma.notification.deleteMany({
      where: {
        created_at: { lt: ninetyDaysAgo }
      }
    });

    const prunedAuditLogs = await prisma.auditLog.deleteMany({
      where: {
        created_at: { lt: ninetyDaysAgo }
      }
    });

    const prunedFailures = await prisma.workerFailure.deleteMany({
      where: {
        created_at: { lt: thirtyDaysAgo }
      }
    });

    logger.info('[Cleanup-Scheduler] Pruning complete:', {
      user_availability_feed: prunedAvailability,
      library_entries: prunedLibraryEntries.count,
      feed_entries: prunedFeedEntries.count,
      notifications: prunedNotifications.count,
      audit_logs: prunedAuditLogs.count,
      worker_failures: prunedFailures.count
    });

  } catch (error) {
    logger.error('[Cleanup-Scheduler] Failed to run cleanup/pruning:', { error: error instanceof Error ? error.message : String(error) });
  }
}
