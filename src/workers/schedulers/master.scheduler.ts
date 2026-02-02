import { prisma } from '@/lib/prisma';
import { syncSourceQueue } from '@/lib/queues';
import { withLock, redisApi, REDIS_KEY_PREFIX } from '@/lib/redis';
import { SyncSourceSchema } from '@/lib/schemas/queue-payloads';
import { CrawlGatekeeper } from '@/lib/crawl-gatekeeper';
import { negativeResultCache } from '@/lib/rate-limiter';
import { JOB_PRIORITIES, type PriorityMetadata } from '@/lib/job-config';
import { runCoverRefreshScheduler } from './cover-refresh.scheduler';
import { runDeferredSearchScheduler } from './deferred-search.scheduler';
import { runNotificationDigestScheduler } from './notification-digest.scheduler';
import { runSafetyMonitor } from './safety-monitor.scheduler';
import { runCleanupScheduler } from './cleanup.scheduler';
import { runTierMaintenanceScheduler } from './tier-maintenance.scheduler';
import { runLatestFeedScheduler } from './latest-feed.scheduler';
import { runNotificationTimingScheduler } from './notification-timing.scheduler';
import { runRecommendationsScheduler } from './recommendations.scheduler';
import { runTrustScoreDecayScheduler } from './trust-decay.scheduler';
import { runMetadataHealingScheduler } from './metadata-healing.scheduler';
import { runMangadexStatsRefreshScheduler } from './mangadex-stats-refresh.scheduler';
import { runFeedIngestScheduler } from './feed-ingest.scheduler';
import { logger } from '@/lib/logger';

// =============================================================================
// V5 AUDIT BUG FIXES INTEGRATION (Bugs 35-37)
// =============================================================================
import {
  SCHEDULER_CONFIG,
  wasRecentlySynced,
  SchedulerErrorAccumulator,
  FEATURE_THRESHOLDS,
} from '@/lib/bug-fixes/v5-audit-bugs-21-50';

export const SYNC_INTERVALS_BY_TIER = {
  A: {
    HOT: 30 * 60 * 1000,
    WARM: 45 * 60 * 1000,
    COLD: 60 * 60 * 1000,
  },
  B: {
    HOT: 6 * 60 * 60 * 1000,
    WARM: 9 * 60 * 60 * 1000,
    COLD: 12 * 60 * 60 * 1000,
  },
  C: {
    HOT: 48 * 60 * 60 * 1000,
    WARM: 72 * 60 * 60 * 1000,
    COLD: 7 * 24 * 60 * 60 * 1000,
  },
} as const;

type SyncPriority = 'HOT' | 'WARM' | 'COLD';

const GATEKEEPER_BATCH_SIZE = 50;

// v5 Audit Bug 12: Scheduling watermark key
const SCHEDULER_WATERMARK_KEY = `${REDIS_KEY_PREFIX}scheduler:watermark`;
const SCHEDULER_RUN_HISTORY_KEY = `${REDIS_KEY_PREFIX}scheduler:run_history`;

/**
 * v5 Audit Bug 12: Persist scheduling watermark
 * Tracks which sources have been scheduled to prevent re-scheduling on crash
 */
interface SchedulerWatermark {
  lastRunAt: string;
  lastProcessedSourceId: string | null;
  sourcesScheduled: number;
  runId: string;
}

async function getSchedulerWatermark(): Promise<SchedulerWatermark | null> {
  try {
    const data = await redisApi.get(SCHEDULER_WATERMARK_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('[Scheduler] Failed to get watermark:', { error: error instanceof Error ? error.message : String(error) });
  }
  return null;
}

async function setSchedulerWatermark(watermark: SchedulerWatermark): Promise<void> {
  try {
    await redisApi.setex(SCHEDULER_WATERMARK_KEY, 600, JSON.stringify(watermark)); // 10 min TTL
  } catch (error) {
    logger.error('[Scheduler] Failed to set watermark:', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function clearSchedulerWatermark(): Promise<void> {
  try {
    await redisApi.del(SCHEDULER_WATERMARK_KEY);
  } catch (error) {
    logger.error('[Scheduler] Failed to clear watermark:', { error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * v5 Audit Bug 11: Select candidates with row lock (FOR UPDATE SKIP LOCKED)
 * v5 Audit Bug 35: Enforces maximum batch size from SCHEDULER_CONFIG
 * Prevents multiple schedulers from selecting the same sources concurrently
 */
async function selectCandidatesWithLock(now: Date, limit: number = SCHEDULER_CONFIG.MAX_BATCH_SIZE): Promise<any[]> {
  // Bug 35: Enforce maximum batch size
  const effectiveLimit = Math.min(limit, SCHEDULER_CONFIG.MAX_BATCH_SIZE);
  
    // Use raw SQL with FOR UPDATE SKIP LOCKED to prevent concurrent selection
    // IMPORTANT: Only select 'mangadex' sources with 'active' status - other sources are external links, not scrapeable
    const candidates = await prisma.$queryRaw<any[]>`
      SELECT 
        ss.id,
        ss.source_url,
        ss.sync_priority,
        ss.source_name,
        ss.series_id,
        ss.last_success_at,
        s.catalog_tier,
        s.total_follows,
        s.last_chapter_at
      FROM series_sources ss
      INNER JOIN series s ON ss.series_id = s.id
      WHERE s.catalog_tier IN ('A', 'B', 'C')
        AND s.deleted_at IS NULL
        AND ss.source_status = 'active'
        AND ss.source_name = 'mangadex'
        AND (ss.next_check_at <= ${now} OR ss.next_check_at IS NULL)
      ORDER BY 
        CASE s.catalog_tier 
          WHEN 'A' THEN 1 
          WHEN 'B' THEN 2 
          ELSE 3 
        END,
        ss.sync_priority DESC,
        ss.last_checked_at ASC NULLS FIRST
      LIMIT ${effectiveLimit}
      FOR UPDATE OF ss SKIP LOCKED
    `;
  
  return candidates;
}

async function maintenancePriorities() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  logger.info('[Scheduler] Running priority maintenance...');

  const popularPromotions = await prisma.seriesSource.updateMany({
    where: {
      sync_priority: { not: 'HOT' },
      series: {
        stats: {
          total_readers: { gt: 100 }
        }
      }
    },
    data: { sync_priority: 'HOT' }
  });

  const hotDowngrades = await prisma.seriesSource.updateMany({
    where: {
      sync_priority: 'HOT',
      last_success_at: { lt: oneDayAgo },
      series: {
        OR: [
          { stats: { total_readers: { lte: 100 } } },
          { stats: null }
        ]
      }
    },
    data: { sync_priority: 'WARM' }
  });

  const warmDowngrades = await prisma.seriesSource.updateMany({
    where: {
      sync_priority: 'WARM',
      last_success_at: { lt: sevenDaysAgo }
    },
    data: { sync_priority: 'COLD' }
  });

  logger.info(`[Scheduler] Maintenance complete: ${popularPromotions.count} promoted to HOT, ${hotDowngrades.count} downgraded to WARM, ${warmDowngrades.count} downgraded to COLD`);
}

/**
 * v5 Audit Bug 37: Run scheduler task with error accumulation
 * Errors don't halt the run immediately, but are accumulated
 */
async function runSchedulerTask(
  name: string, 
  task: () => Promise<void>,
  errorAccumulator: SchedulerErrorAccumulator
): Promise<void> {
  try {
    await task();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    errorAccumulator.addError(err, name);
    logger.error(`[Scheduler] ${name} failed:`, { error: err.message });
    
    // Bug 37: Check if we should halt after accumulating errors
    if (errorAccumulator.shouldHalt()) {
      logger.error(`[Scheduler] Too many errors (${errorAccumulator.getErrorCount()}), halting scheduler run`);
      throw new Error(`Scheduler halted: ${errorAccumulator.getErrorCount()} errors accumulated`);
    }
  }
}

export async function runMasterScheduler() {
  return await withLock('scheduler:master', 360000, async () => {
    const startTime = Date.now();
    const runId = `run_${startTime}`;
    logger.info(`[Scheduler] Running master scheduler... (runId: ${runId})`);

    const now = new Date();
    
    // Bug 37: Initialize error accumulator for this run
    const errorAccumulator = new SchedulerErrorAccumulator(
      SCHEDULER_CONFIG.HALT_ON_ERROR,
      SCHEDULER_CONFIG.MAX_ERRORS_BEFORE_HALT
    );

    // v5 Audit Bug 12: Check for stale watermark from previous crash
    const previousWatermark = await getSchedulerWatermark();
    if (previousWatermark) {
      const watermarkAge = Date.now() - new Date(previousWatermark.lastRunAt).getTime();
      if (watermarkAge < 300000) { // 5 minutes
        logger.warn(`[Scheduler] Found recent watermark from ${previousWatermark.runId}, may indicate crash recovery`);
        // Clear the watermark to start fresh
        await clearSchedulerWatermark();
      }
    }

    // Bug 37: Run scheduler tasks with error accumulation
    await runSchedulerTask('Priority maintenance', maintenancePriorities, errorAccumulator);
    await runSchedulerTask('Cover refresh scheduler', runCoverRefreshScheduler, errorAccumulator);
    await runSchedulerTask('Deferred search scheduler', runDeferredSearchScheduler, errorAccumulator);
    await runSchedulerTask('Notification digest scheduler', runNotificationDigestScheduler, errorAccumulator);
    await runSchedulerTask('Safety monitor', runSafetyMonitor, errorAccumulator);
    await runSchedulerTask('Cleanup scheduler', runCleanupScheduler, errorAccumulator);
    await runSchedulerTask('Tier maintenance scheduler', runTierMaintenanceScheduler, errorAccumulator);
    await runSchedulerTask('Latest feed scheduler', runLatestFeedScheduler, errorAccumulator);
    await runSchedulerTask('Notification timing scheduler', runNotificationTimingScheduler, errorAccumulator);
    await runSchedulerTask('Recommendations scheduler', runRecommendationsScheduler, errorAccumulator);
    await runSchedulerTask('Trust score decay scheduler', runTrustScoreDecayScheduler, errorAccumulator);
    // Bug 3 Fix: Automated metadata healing for failed/unavailable entries
    await runSchedulerTask('Metadata healing scheduler', runMetadataHealingScheduler, errorAccumulator);
// MangaDex statistics refresh (tiered: A daily, B weekly, C monthly)
      await runSchedulerTask('MangaDex stats refresh scheduler', runMangadexStatsRefreshScheduler, errorAccumulator);
      // Feed ingest scheduler (MangaDex latest chapters, MangaUpdates releases)
      await runSchedulerTask('Feed ingest scheduler', async () => {
        const result = await runFeedIngestScheduler();
        if (result.scheduled > 0) {
          logger.info(`[Scheduler] Feed ingest: ${result.scheduled} scheduled, ${result.skipped} skipped`);
        }
      }, errorAccumulator);

    try {
      // v5 Audit Bug 11: Use FOR UPDATE SKIP LOCKED to prevent duplicate scheduling
      // v5 Audit Bug 35: Use configured batch size
      const sourcesToUpdate = await selectCandidatesWithLock(now, SCHEDULER_CONFIG.MAX_BATCH_SIZE);

      if (sourcesToUpdate.length === 0) {
        logger.info('[Scheduler] No sources due for sync.');
        return;
      }

      // v5 Audit Bug 12: Initialize watermark for this run
      await setSchedulerWatermark({
        lastRunAt: now.toISOString(),
        lastProcessedSourceId: null,
        sourcesScheduled: 0,
        runId,
      });

      const updatesByTierAndPriority: Record<string, Record<string, string[]>> = {
        A: { HOT: [], WARM: [], COLD: [] },
        B: { HOT: [], WARM: [], COLD: [] },
        C: { HOT: [], WARM: [], COLD: [] },
      };

      const jobs: Array<{
        name: string;
        data: { seriesSourceId: string };
        opts: { jobId: string; priority: number; removeOnComplete: boolean; removeOnFail: { age: number } };
      }> = [];
      let skippedCount = 0;
      let negativeSkipped = 0;
      let recentlySyncedSkipped = 0;
      let sourcesProcessed = 0;

      for (let i = 0; i < sourcesToUpdate.length; i += GATEKEEPER_BATCH_SIZE) {
        const batch = sourcesToUpdate.slice(i, i + GATEKEEPER_BATCH_SIZE);
        
        for (const source of batch) {
          const tier = source.catalog_tier || 'C';
          const priority = (source.sync_priority as SyncPriority) || 'COLD';
          
          if (updatesByTierAndPriority[tier]?.[priority]) {
            updatesByTierAndPriority[tier][priority].push(source.id);
          } else if (updatesByTierAndPriority[tier]) {
            updatesByTierAndPriority[tier].COLD.push(source.id);
          }

          // Bug 36: Skip recently synced sources
          if (wasRecentlySynced(source.last_success_at, SCHEDULER_CONFIG.MIN_SYNC_INTERVAL_MS)) {
            recentlySyncedSkipped++;
            continue;
          }

          const shouldSkipNegative = await negativeResultCache.shouldSkip(source.id);
          if (shouldSkipNegative) {
            negativeSkipped++;
            continue;
          }

          const metadata: PriorityMetadata = {
            trackerCount: source.total_follows ?? 0,
            lastActivity: source.last_chapter_at ?? null,
            isDiscovery: false,
          };

          const decision = await CrawlGatekeeper.shouldEnqueue(source.id, tier, 'PERIODIC', metadata);

          if (!decision.allowed) {
            skippedCount++;
            continue;
          }

          const validation = SyncSourceSchema.safeParse({ seriesSourceId: source.id });

          if (!validation.success) {
            logger.error(`[Validation][Skipped] queue=sync-source reason="Invalid ID" id=${source.id}`);
            continue;
          }

          jobs.push({
            name: `sync-${source.id}`,
            data: { seriesSourceId: validation.data.seriesSourceId },
            opts: {
              jobId: `sync-${source.id}`,
              priority: JOB_PRIORITIES[decision.jobPriority],
              removeOnComplete: true,
              removeOnFail: { age: 24 * 3600 }
            }
          });

          sourcesProcessed++;
          
          // v5 Audit Bug 12: Update watermark periodically during processing
          if (sourcesProcessed % 100 === 0) {
            await setSchedulerWatermark({
              lastRunAt: now.toISOString(),
              lastProcessedSourceId: source.id,
              sourcesScheduled: jobs.length,
              runId,
            });
          }
        }
      }

      const updatePromises: Promise<{ count: number }>[] = [];
      for (const [tier, priorities] of Object.entries(updatesByTierAndPriority)) {
        for (const [priority, ids] of Object.entries(priorities)) {
          if (ids.length === 0) continue;
          
          const tierIntervals = SYNC_INTERVALS_BY_TIER[tier as keyof typeof SYNC_INTERVALS_BY_TIER];
          const interval = tierIntervals[priority as SyncPriority];
          const nextCheck = new Date(now.getTime() + interval);

          updatePromises.push(
            prisma.seriesSource.updateMany({
              where: { id: { in: ids } },
              data: { next_check_at: nextCheck }
            })
          );
        }
      }

      await Promise.all(updatePromises);

      if (jobs.length > 0) {
        await syncSourceQueue.addBulk(jobs);
        logger.info(`[Scheduler] Queued ${jobs.length} jobs, skipped ${skippedCount} by gatekeeper, ${negativeSkipped} by negative cache, ${recentlySyncedSkipped} recently synced (Bug 36), updated next_check_at for ${sourcesToUpdate.length} sources`);
      } else {
        logger.info(`[Scheduler] No jobs to enqueue (skipped ${skippedCount} gatekeeper, ${negativeSkipped} negative, ${recentlySyncedSkipped} recent), updated next_check_at for ${sourcesToUpdate.length} sources`);
      }

      // v5 Audit Bug 12: Clear watermark on successful completion
      await clearSchedulerWatermark();

      // Record successful run in history (for debugging)
      try {
        await redisApi.lpush(SCHEDULER_RUN_HISTORY_KEY, JSON.stringify({
          runId,
          completedAt: new Date().toISOString(),
          jobsQueued: jobs.length,
          skipped: skippedCount,
          negative: negativeSkipped,
          recentlySynced: recentlySyncedSkipped,
          duration: Date.now() - startTime,
          errors: errorAccumulator.getErrorCount(),
        }));
        await redisApi.ltrim(SCHEDULER_RUN_HISTORY_KEY, 0, 99); // Keep last 100 runs
      } catch (historyError) {
        logger.warn('[Scheduler] Failed to record run history:', { error: historyError });
      }

    } catch (error) {
      // Bug 37: Add to error accumulator
      const err = error instanceof Error ? error : new Error(String(error));
      errorAccumulator.addError(err, 'sync-source-scheduler');
      logger.error('[Scheduler] Sync source scheduler failed:', { error: err.message });
    }

    const duration = Date.now() - startTime;
    const errorCount = errorAccumulator.getErrorCount();
    
    if (errorCount > 0) {
      logger.warn(`[Scheduler] Master scheduler completed with ${errorCount} errors in ${duration}ms`);
    } else {
      logger.info(`[Scheduler] Master scheduler completed successfully in ${duration}ms`);
    }
  });
}
