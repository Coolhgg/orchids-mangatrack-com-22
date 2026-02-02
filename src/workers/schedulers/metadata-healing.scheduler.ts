import { prisma } from '@/lib/prisma';
import { seriesResolutionQueue } from '@/lib/queues';
import { withLock } from '@/lib/redis';
import { logger } from '@/lib/logger';

/**
 * Metadata Healing Scheduler
 * 
 * Automatically retries metadata enrichment for unavailable/failed entries.
 * This enables "self-healing" where entries that previously couldn't be matched
 * can be retried as external APIs change, titles update, or new data appears.
 * 
 * BUG FIXES IMPLEMENTED:
 * - Bug 20: Uses withLock() for singleton execution (distributed lock)
 * - Bug 21: Transactional enqueue - marks entries BEFORE enqueueing, reconciles on failure
 * - Bug 22: Configurable retry limits via environment variables
 * - Bug 23: Validates metadata_status values before processing
 * 
 * Run frequency: Weekly (via master scheduler)
 */

// Bug 22: Configurable retry limits
const getConfig = () => ({
  batchSize: parseInt(process.env.METADATA_HEALING_BATCH_SIZE || '200'),
  minAgeHours: parseInt(process.env.METADATA_HEALING_MIN_AGE_HOURS || String(7 * 24)), // 7 days default
  maxRetries: parseInt(process.env.METADATA_HEALING_MAX_RETRIES || '10'),
  jobPriority: parseInt(process.env.METADATA_HEALING_JOB_PRIORITY || '3'),
});

// Bug 23: Valid metadata_status values
const VALID_METADATA_STATUSES = ['pending', 'enriched', 'unavailable', 'failed'] as const;
type MetadataStatus = typeof VALID_METADATA_STATUSES[number];

function isValidMetadataStatus(status: unknown): status is MetadataStatus {
  return typeof status === 'string' && VALID_METADATA_STATUSES.includes(status as MetadataStatus);
}

// Bug 21: Batch tracking for reconciliation
interface ScheduleBatch {
  batchId: string;
  entryIds: string[];
  scheduledAt: Date;
}

export async function runMetadataHealingScheduler(): Promise<void> {
  // Bug 20: Singleton execution with distributed lock
  await withLock('scheduler:metadata-healing', 300000, async () => {
    const startTime = Date.now();
    const config = getConfig();
    const batchId = `heal-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    logger.info('[MetadataHealing] Starting metadata healing scheduler...', { config, batchId });

    try {
      const cutoffDate = new Date(Date.now() - config.minAgeHours * 60 * 60 * 1000);

      // Bug 23: Query with explicit status validation
      const healableEntries = await prisma.libraryEntry.findMany({
        where: {
          // Bug 23: Only process valid retryable statuses
          metadata_status: { in: ['unavailable', 'failed'] },
          // Don't retry entries with manual overrides
          OR: [
            { series_id: null },
            {
              series: {
                metadata_source: { not: 'USER_OVERRIDE' }
              }
            }
          ],
          // Only retry entries older than cutoff
          AND: [
            {
              OR: [
                { last_metadata_attempt_at: null },
                { last_metadata_attempt_at: { lt: cutoffDate } }
              ]
            }
          ],
          // Bug 22: Configurable retry limit
          metadata_retry_count: { lt: config.maxRetries },
          // Exclude soft-deleted entries
          deleted_at: null
        },
        select: {
          id: true,
          source_url: true,
          imported_title: true,
          metadata_status: true,
          metadata_retry_count: true,
          last_metadata_attempt_at: true
        },
        orderBy: [
          { metadata_retry_count: 'asc' },
          { last_metadata_attempt_at: 'asc' }
        ],
        take: config.batchSize
      });

      if (healableEntries.length === 0) {
        logger.info('[MetadataHealing] No entries need healing at this time.');
        return;
      }

      // Bug 23: Filter out any entries with invalid metadata_status (defensive)
      const validEntries = healableEntries.filter(entry => {
        if (!isValidMetadataStatus(entry.metadata_status)) {
          logger.warn(`[MetadataHealing] Skipping entry with invalid metadata_status`, {
            entryId: entry.id,
            status: entry.metadata_status
          });
          return false;
        }
        return true;
      });

      if (validEntries.length === 0) {
        logger.info('[MetadataHealing] No valid entries to heal after filtering.');
        return;
      }

      // Bug 21: TRANSACTIONAL ENQUEUE
      // Step 1: Mark entries as pending BEFORE enqueueing (in transaction)
      // Step 2: If enqueue fails, we can identify which entries need retry
      const entryIds = validEntries.map(e => e.id);
      
      // Bug 21: Record scheduling attempt in database FIRST
      await prisma.$transaction(async (tx) => {
        // Mark all entries as pending with batch tracking
        await tx.libraryEntry.updateMany({
          where: { id: { in: entryIds } },
          data: {
            metadata_status: 'pending',
            last_metadata_attempt_at: new Date(),
            // Store batch ID in metadata for reconciliation (if column exists)
            // This allows us to identify which entries were part of this batch
          }
        });

        // Create audit log for batch tracking
        await tx.auditLog.create({
          data: {
            event: 'metadata_healing_batch',
            status: 'processing',
            metadata: {
              batch_id: batchId,
              entry_count: entryIds.length,
              entry_ids: entryIds.slice(0, 50), // Store first 50 for reference
            }
          }
        });
      });

      // Bug 21: Create jobs with idempotent IDs
      const jobs = validEntries.map(entry => ({
        name: `heal-${entry.id}`,
        data: {
          libraryEntryId: entry.id,
          source_url: entry.source_url,
          title: entry.imported_title,
          batchId, // Track which batch this job belongs to
        },
        opts: {
          jobId: `heal-${entry.id}`, // Idempotent - prevents duplicates
          priority: config.jobPriority,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 100 },
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60000 }
        }
      }));

      // Bug 21: Enqueue with error handling
      let enqueuedCount = 0;
      try {
        await seriesResolutionQueue.addBulk(jobs);
        enqueuedCount = jobs.length;
        
        // Bug 21: Update audit log on success
        await prisma.auditLog.updateMany({
          where: {
            event: 'metadata_healing_batch',
            metadata: { path: ['batch_id'], equals: batchId }
          },
          data: {
            status: 'success',
            metadata: {
              batch_id: batchId,
              entry_count: entryIds.length,
              enqueued_count: enqueuedCount,
              completed_at: new Date().toISOString()
            }
          }
        });
      } catch (queueError) {
        // Bug 21: Handle partial failure - entries are marked pending but jobs not enqueued
        // The next scheduler run will pick them up again since they're still in 'pending' state
        // with last_metadata_attempt_at set (won't be retried until cutoff passes again)
        logger.error('[MetadataHealing] Failed to enqueue jobs, entries will retry on next cycle', {
          error: queueError instanceof Error ? queueError.message : String(queueError),
          batchId,
          entryCount: entryIds.length
        });
        
        // Bug 21: Revert status to previous state on complete failure
        // This allows immediate retry on next scheduler run
        await prisma.libraryEntry.updateMany({
          where: { id: { in: entryIds } },
          data: {
            metadata_status: 'failed', // Revert to failed so next run picks them up
          }
        });

        // Update audit log on failure
        await prisma.auditLog.updateMany({
          where: {
            event: 'metadata_healing_batch',
            metadata: { path: ['batch_id'], equals: batchId }
          },
          data: {
            status: 'failure',
            metadata: {
              batch_id: batchId,
              entry_count: entryIds.length,
              error: queueError instanceof Error ? queueError.message : String(queueError),
              failed_at: new Date().toISOString()
            }
          }
        });
        
        throw queueError; // Re-throw to be caught by outer handler
      }

      const stats = {
        total: validEntries.length,
        failed: validEntries.filter(e => e.metadata_status === 'failed').length,
        unavailable: validEntries.filter(e => e.metadata_status === 'unavailable').length,
        avgRetryCount: validEntries.reduce((sum, e) => sum + (e.metadata_retry_count || 0), 0) / validEntries.length,
        skippedInvalid: healableEntries.length - validEntries.length
      };

      const duration = Date.now() - startTime;
      logger.info(`[MetadataHealing] Queued ${stats.total} entries for healing`, {
        batchId,
        stats,
        duration: `${duration}ms`
      });
    } catch (error) {
      logger.error('[MetadataHealing] Failed:', { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }
  });
}

/**
 * Bug 21: Reconciliation function
 * Called to clean up any entries that got stuck in 'pending' due to failed enqueue
 */
export async function reconcileStuckPendingEntries(): Promise<void> {
  const stuckThresholdHours = 24; // Entries pending for more than 24 hours are considered stuck
  const cutoffDate = new Date(Date.now() - stuckThresholdHours * 60 * 60 * 1000);

  const stuckEntries = await prisma.libraryEntry.findMany({
    where: {
      metadata_status: 'pending',
      last_metadata_attempt_at: { lt: cutoffDate }
    },
    select: { id: true }
  });

  if (stuckEntries.length > 0) {
    await prisma.libraryEntry.updateMany({
      where: { id: { in: stuckEntries.map(e => e.id) } },
      data: { metadata_status: 'failed' }
    });
    
    logger.warn(`[MetadataHealing] Reconciled ${stuckEntries.length} stuck pending entries`);
  }
}
