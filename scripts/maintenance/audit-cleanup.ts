import { prisma } from '@/lib/prisma';

/**
 * Audit Log Retention Cleanup Script
 * 
 * Deletes link_submission_audit entries older than 90 days.
 * Recommended for maintenance to prevent table bloat.
 */
async function cleanupAuditLogs() {
  console.log('[Maintenance] Starting link_submission_audit cleanup...');
  
  const retentionDays = 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  try {
    const deletedCount = await prisma.linkSubmissionAudit.deleteMany({
      where: {
        created_at: {
          lt: cutoffDate,
        },
      },
    });
    
    console.log(`[Maintenance] Successfully deleted ${deletedCount.count} audit log entries older than ${retentionDays} days.`);
  } catch (err) {
    console.error('[Maintenance] Failed to cleanup audit logs:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupAuditLogs();
