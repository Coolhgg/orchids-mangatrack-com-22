/**
 * MangaDex Statistics Refresh Processor
 * 
 * Processes batched stats refresh jobs queued by the scheduler.
 * Fetches statistics from MangaDex API and updates Series records.
 * 
 * Features:
 * - Batch processing with MangaDexStatsClient
 * - Handles RateLimitError with requeue and exponential delay
 * - Transient error retry (up to 3 times)
 * - Non-blocking: stats failures don't affect series data
 */

import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { mangadexStatsRefreshQueue } from '@/lib/queues';
import { enrichSeriesWithStats, type SeriesStatsInput } from '@/lib/mangadex/stats-enrichment';
import { logger } from '@/lib/logger';
import type { StatsRefreshJobData } from '@/workers/schedulers/mangadex-stats-refresh.scheduler';

const ENABLE_STATS_REFRESH = process.env.ENABLE_MANGADEX_STATS_UPSERT === 'true';

export async function processMangadexStatsRefresh(job: Job<StatsRefreshJobData>): Promise<void> {
  const { tier, seriesIds, mangadexIds, scheduledAt } = job.data;

  if (!ENABLE_STATS_REFRESH) {
    logger.debug('[MangaDexStatsProcessor] Skipped - ENABLE_MANGADEX_STATS_UPSERT is not enabled');
    return;
  }

  if (!seriesIds || seriesIds.length === 0) {
    logger.warn('[MangaDexStatsProcessor] No series IDs in job data');
    return;
  }

  logger.info('[MangaDexStatsProcessor] Processing stats refresh', {
    tier,
    count: seriesIds.length,
    scheduledAt,
    jobId: job.id,
  });

  const seriesList: SeriesStatsInput[] = seriesIds.map((seriesId, index) => ({
    seriesId,
    mangadexId: mangadexIds[index],
  }));

  const result = await enrichSeriesWithStats(prisma, seriesList);

  if (!result.success) {
    logger.warn('[MangaDexStatsProcessor] Stats refresh completed with errors', {
      tier,
      enrichedCount: result.enrichedCount,
      failedCount: result.failedCount,
      error: result.error,
      shouldRequeue: result.shouldRequeue,
    });

    if (result.shouldRequeue && result.requeueDelay) {
      const retryCount = job.attemptsMade || 0;
      if (retryCount < 3) {
        logger.info('[MangaDexStatsProcessor] Requeueing job with delay', {
          delay: result.requeueDelay,
          retryCount: retryCount + 1,
        });

        await mangadexStatsRefreshQueue.add(
          `stats-refresh-retry-${tier}-${Date.now()}`,
          job.data,
          {
            delay: result.requeueDelay,
            priority: tier === 'A' ? 2 : tier === 'B' ? 5 : 10,
            removeOnComplete: { count: 50, age: 3600 },
            removeOnFail: { count: 100, age: 86400 },
          }
        );
      } else {
        logger.error('[MangaDexStatsProcessor] Max retries exceeded, giving up', {
          tier,
          seriesCount: seriesIds.length,
        });
      }
    }
  } else {
    logger.info('[MangaDexStatsProcessor] Stats refresh completed successfully', {
      tier,
      enrichedCount: result.enrichedCount,
      failedCount: result.failedCount,
    });
  }
}
