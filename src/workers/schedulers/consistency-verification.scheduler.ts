/**
 * CONSISTENCY VERIFICATION SCHEDULER
 * 
 * Bug 100 Fix: End-to-end consistency verification job
 * 
 * Periodically verifies data integrity across:
 * - Library entries
 * - Series
 * - Sources
 * - Chapters
 * - Metadata consistency
 */

import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { withLock } from '@/lib/redis';
import {
  runConsistencyVerification,
  validateSourceSeriesConsistency,
  jobMetricsCollector,
  TimestampProvider,
  secureLogger,
} from '@/lib/bug-fixes/v5-audit-bugs-81-100';

// Configuration
const VERIFICATION_LOCK_TTL = 600000; // 10 minutes
const MAX_FIXES_PER_RUN = 500;

/**
 * Run the consistency verification scheduler
 */
export async function runConsistencyVerificationScheduler(): Promise<void> {
  const jobId = `consistency-verification-${Date.now()}`;
  
  return await withLock('scheduler:consistency-verification', VERIFICATION_LOCK_TTL, async () => {
    const startTime = TimestampProvider.now();
    jobMetricsCollector.startJob(jobId, 'consistency-verification');
    
    secureLogger.info('[Consistency] Starting scheduled verification...');

    try {
      // Run the comprehensive verification
      const result = await runConsistencyVerification(prisma, {
        fix: true, // Auto-fix issues
        limit: MAX_FIXES_PER_RUN,
      });

      // Log results
      for (const verification of result.results) {
        if (verification.issues > 0) {
          secureLogger.warn(`[Consistency] ${verification.type}: found ${verification.issues} issues, fixed ${verification.fixed}`, {
            type: verification.type,
            issues: verification.issues,
            fixed: verification.fixed,
            sampleErrors: verification.errors.slice(0, 3),
          });
        } else {
          secureLogger.info(`[Consistency] ${verification.type}: OK (checked ${verification.checked})`);
        }
      }

      // Summary
      secureLogger.info(`[Consistency] Verification complete`, {
        totalIssues: result.summary.totalIssues,
        totalFixed: result.summary.totalFixed,
        durationMs: result.summary.duration,
        success: result.success,
      });

      // Record metrics
      jobMetricsCollector.completeJob(jobId, result.success);

      // Additional source-series consistency checks for a sample of series
      await runSampleSourceConsistencyChecks();

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      secureLogger.error('[Consistency] Verification failed', { error: errorMsg });
      jobMetricsCollector.completeJob(jobId, false, errorMsg);
      throw error;
    }

    const duration = TimestampProvider.now() - startTime;
    secureLogger.info(`[Consistency] Scheduler completed in ${duration}ms`);
  });
}

/**
 * Run source-series consistency checks on a sample of series
 */
async function runSampleSourceConsistencyChecks(): Promise<void> {
  // Get a sample of recently updated series
  const sampleSeries = await prisma.series.findMany({
    where: {
      deleted_at: null,
      updated_at: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      },
    },
    select: { id: true },
    take: 100,
    orderBy: { updated_at: 'desc' },
  });

  let issueCount = 0;

  for (const series of sampleSeries) {
    const result = await validateSourceSeriesConsistency(prisma as any, series.id);
    
    if (!result.valid) {
      issueCount++;
      secureLogger.warn(`[Consistency] Series ${series.id} has consistency issues`, {
        errors: result.errors,
        warnings: result.warnings,
      });
    }
  }

  if (issueCount > 0) {
    secureLogger.warn(`[Consistency] Source-series check: ${issueCount}/${sampleSeries.length} series have issues`);
  } else {
    secureLogger.info(`[Consistency] Source-series check: all ${sampleSeries.length} sampled series OK`);
  }
}

/**
 * Run a quick integrity check (for use in health endpoints)
 */
export async function runQuickIntegrityCheck(): Promise<{
  healthy: boolean;
  orphanedEntries: number;
  orphanedSources: number;
  duplicateEntries: number;
}> {
  const [orphanedEntries, orphanedSources, duplicateEntries] = await Promise.all([
    // Count orphaned library entries
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM library_entries le
      LEFT JOIN series s ON le.series_id = s.id
      WHERE le.series_id IS NOT NULL
        AND s.id IS NULL
        AND le.deleted_at IS NULL
      LIMIT 1
    `.then(r => Number(r[0]?.count || 0)),

    // Count orphaned series sources
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM series_sources ss
      LEFT JOIN series s ON ss.series_id = s.id
      WHERE s.id IS NULL
      LIMIT 1
    `.then(r => Number(r[0]?.count || 0)),

    // Count duplicate library entries
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM (
        SELECT user_id, series_id
        FROM library_entries
        WHERE series_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY user_id, series_id
        HAVING COUNT(*) > 1
        LIMIT 100
      ) as duplicates
    `.then(r => Number(r[0]?.count || 0)),
  ]);

  return {
    healthy: orphanedEntries === 0 && orphanedSources === 0 && duplicateEntries === 0,
    orphanedEntries,
    orphanedSources,
    duplicateEntries,
  };
}
