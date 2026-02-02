/**
 * RECONCILIATION SCHEDULER
 * 
 * Bug 80 Fix: Automated reconciliation task
 * Periodically checks and fixes data integrity issues:
 * - Orphaned library entries
 * - Duplicate library entries per user/series
 * - Chapters referencing deleted sources
 * - Stale cache entries
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import {
  reconcileLibraryOrphans,
  reconcileDuplicateEntries,
  trackFailure,
  clearFailureTracking,
  type ReconciliationResult,
} from '@/lib/bug-fixes/v5-audit-bugs-51-80';

// Configuration
const RECONCILIATION_INTERVAL_HOURS = 6;
const MAX_FIXES_PER_RUN = 100;

/**
 * Run all reconciliation tasks
 */
export async function runReconciliationScheduler(): Promise<void> {
  const startTime = Date.now();
  logger.info('[Reconciliation] Starting scheduled reconciliation...');

  const results: ReconciliationResult[] = [];

  try {
    // Run reconciliation in a transaction to ensure consistency
    await prisma.$transaction(async (tx) => {
      // 1. Fix orphaned library entries
        const orphanResult = await reconcileLibraryOrphans(tx as any, { fix: true });
        results.push(orphanResult);
        
        if (orphanResult.count > 0) {
          logger.warn(`[Reconciliation] Found ${orphanResult.count} orphaned library entries, fixed ${orphanResult.fixed}`);
        }

        // 2. Fix duplicate library entries
        const duplicateResult = await reconcileDuplicateEntries(tx as any, { fix: true });
      results.push(duplicateResult);
      
      if (duplicateResult.count > 0) {
        logger.warn(`[Reconciliation] Found ${duplicateResult.count} duplicate library entries, fixed ${duplicateResult.fixed}`);
      }

      // 3. Clean up chapters from soft-deleted sources
      const chapterOrphanResult = await reconcileChapterOrphans(tx);
      results.push(chapterOrphanResult);
      
      if (chapterOrphanResult.count > 0) {
        logger.warn(`[Reconciliation] Found ${chapterOrphanResult.count} chapters from deleted sources, fixed ${chapterOrphanResult.fixed}`);
      }

      // 4. Clean up stale metadata retry counts
      const retryResetResult = await resetStaleRetryCounters(tx);
      results.push(retryResetResult);

    }, {
      timeout: 120000, // 2 minute timeout for reconciliation
      isolationLevel: 'ReadCommitted'
    });

    // Log summary
    const totalFound = results.reduce((sum, r) => sum + r.count, 0);
    const totalFixed = results.reduce((sum, r) => sum + r.fixed, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    const duration = Date.now() - startTime;
    logger.info(`[Reconciliation] Completed in ${duration}ms: found ${totalFound} issues, fixed ${totalFixed}, errors ${totalErrors}`);

    // Clear failure tracking if reconciliation succeeds
    clearFailureTracking('system', 'reconciliation');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[Reconciliation] Failed:', { error: errorMsg });
    trackFailure('system', 'reconciliation', errorMsg);
    throw error;
  }
}

/**
 * Fix chapters referencing soft-deleted sources
 */
async function reconcileChapterOrphans(
  tx: any
): Promise<ReconciliationResult> {
  // Find chapter_sources referencing deleted series_sources
  const orphans = await tx.$queryRaw<any[]>`
    SELECT cs.id, cs.series_source_id
    FROM chapter_sources cs
    INNER JOIN series_sources ss ON cs.series_source_id = ss.id
    WHERE ss.deleted_at IS NOT NULL
    LIMIT ${MAX_FIXES_PER_RUN}
  `;

  let fixed = 0;
  const errors: string[] = [];

  if (orphans.length > 0) {
      try {
        // Mark chapter_sources as unavailable
        const orphanIds = orphans.map((o: { id: string }) => o.id);
      await tx.$executeRaw`
        UPDATE chapter_sources
        SET is_available = false, last_checked_at = NOW()
        WHERE id = ANY(${orphanIds}::uuid[])
      `;
      fixed = orphans.length;
    } catch (error) {
      errors.push(`Failed to fix chapter orphans: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return {
    type: 'chapter_orphans',
    count: orphans.length,
    fixed,
    errors
  };
}

/**
 * Reset stale metadata retry counters
 * Entries that have been stuck in pending for too long get a fresh start
 */
async function resetStaleRetryCounters(
  tx: any
): Promise<ReconciliationResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Find entries stuck in pending with high retry counts
  const stale = await tx.$queryRaw<any[]>`
    SELECT id
    FROM library_entries
    WHERE metadata_status = 'pending'
      AND metadata_retry_count >= 5
      AND last_metadata_attempt_at < ${sevenDaysAgo}
      AND deleted_at IS NULL
    LIMIT ${MAX_FIXES_PER_RUN}
  `;

  let fixed = 0;
  const errors: string[] = [];

  if (stale.length > 0) {
      try {
        const staleIds = stale.map((s: { id: string }) => s.id);
      await tx.$executeRaw`
        UPDATE library_entries
        SET metadata_retry_count = 0, metadata_status = 'pending'
        WHERE id = ANY(${staleIds}::uuid[])
      `;
      fixed = stale.length;
    } catch (error) {
      errors.push(`Failed to reset retry counters: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return {
    type: 'source_orphans', // Reusing type for retry reset
    count: stale.length,
    fixed,
    errors
  };
}

/**
 * Get reconciliation stats (for monitoring)
 */
export async function getReconciliationStats(): Promise<{
  orphanedEntries: number;
  duplicateEntries: number;
  orphanedChapters: number;
  staleRetries: number;
}> {
  const [orphanedEntries, duplicateEntries, orphanedChapters, staleRetries] = await Promise.all([
    // Count orphaned library entries
    prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count
      FROM library_entries le
      LEFT JOIN series s ON le.series_id = s.id
      WHERE le.series_id IS NOT NULL
        AND s.id IS NULL
        AND le.deleted_at IS NULL
    `.then(r => Number(r[0]?.count || 0)),

    // Count duplicate library entries
    prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count FROM (
        SELECT user_id, series_id
        FROM library_entries
        WHERE series_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY user_id, series_id
        HAVING COUNT(*) > 1
      ) as duplicates
    `.then(r => Number(r[0]?.count || 0)),

    // Count chapters from deleted sources
    prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count
      FROM chapter_sources cs
      INNER JOIN series_sources ss ON cs.series_source_id = ss.id
      WHERE ss.deleted_at IS NOT NULL
    `.then(r => Number(r[0]?.count || 0)),

    // Count stale retries
    prisma.$queryRaw<any[]>`
      SELECT COUNT(*) as count
      FROM library_entries
      WHERE metadata_status = 'pending'
        AND metadata_retry_count >= 5
        AND deleted_at IS NULL
    `.then(r => Number(r[0]?.count || 0)),
  ]);

  return {
    orphanedEntries,
    duplicateEntries,
    orphanedChapters,
    staleRetries,
  };
}
