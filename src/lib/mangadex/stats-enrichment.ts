/**
 * MangaDex Statistics Enrichment Helper
 *
 * Provides batch statistics enrichment for Series records with:
 * - Retry logic for transient errors
 * - Requeue support for RateLimitError
 * - Environment-based feature toggle
 * - Prisma transaction support for batched upserts
 */

import { mangadexStatsClient, RateLimitError, StatsClientError, type MangaStats } from './stats';
import { logger } from '@/lib/logger';
import type { PrismaClient } from '@prisma/client';

const ENABLE_STATS_UPSERT = process.env.ENABLE_MANGADEX_STATS_UPSERT === 'true';
const _MAX_STATS_RETRY_ATTEMPTS = 3;

export interface StatsEnrichmentResult {
  success: boolean;
  enrichedCount: number;
  failedCount: number;
  error?: string;
  shouldRequeue?: boolean;
  requeueDelay?: number;
}

export interface SeriesStatsInput {
  seriesId: string;
  mangadexId: string;
}

/**
 * Enrich a batch of series with MangaDex statistics.
 * 
 * @param prisma - Prisma client or transaction
 * @param seriesList - Array of {seriesId, mangadexId} to enrich
 * @returns StatsEnrichmentResult with success status and counts
 * 
 * @example
 * ```typescript
 * const result = await enrichSeriesWithStats(prisma, [
 *   { seriesId: 'uuid-1', mangadexId: 'md-uuid-1' },
 *   { seriesId: 'uuid-2', mangadexId: 'md-uuid-2' },
 * ]);
 * 
 * if (!result.success && result.shouldRequeue) {
 *   // Requeue job with delay
 *   await queue.add('stats-enrich', data, { delay: result.requeueDelay });
 * }
 * ```
 */
export async function enrichSeriesWithStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  seriesList: SeriesStatsInput[]
): Promise<StatsEnrichmentResult> {
  if (!ENABLE_STATS_UPSERT) {
    logger.debug('[StatsEnrichment] Skipped - ENABLE_MANGADEX_STATS_UPSERT is not enabled');
    return { success: true, enrichedCount: 0, failedCount: 0 };
  }

  if (seriesList.length === 0) {
    return { success: true, enrichedCount: 0, failedCount: 0 };
  }

  const mangadexIds = seriesList.map(s => s.mangadexId);
  const idToSeriesMap = new Map(seriesList.map(s => [s.mangadexId, s.seriesId]));

  let statsMap: Map<string, MangaStats>;

  try {
    statsMap = await mangadexStatsClient.getStatisticsBatch(mangadexIds);
  } catch (error) {
    if (error instanceof RateLimitError) {
      logger.warn('[StatsEnrichment] Rate limited by MangaDex', {
        consecutive429s: error.consecutive429s,
        retryAfter: error.retryAfter,
      });

      return {
        success: false,
        enrichedCount: 0,
        failedCount: seriesList.length,
        error: error.message,
        shouldRequeue: true,
        requeueDelay: (error.retryAfter || 60) * 1000,
      };
    }

    if (error instanceof StatsClientError) {
      logger.error('[StatsEnrichment] Stats client error', {
        statusCode: error.statusCode,
        attempts: error.attempts,
        message: error.message,
      });

        const isRetryable = error.statusCode !== undefined && error.statusCode >= 500;
      return {
        success: false,
        enrichedCount: 0,
        failedCount: seriesList.length,
        error: error.message,
        shouldRequeue: isRetryable,
        requeueDelay: isRetryable ? 30000 : undefined,
      };
    }

    logger.error('[StatsEnrichment] Unexpected error fetching stats', { error });
    return {
      success: false,
      enrichedCount: 0,
      failedCount: seriesList.length,
      error: error instanceof Error ? error.message : String(error),
      shouldRequeue: false,
    };
  }

  let enrichedCount = 0;
  let failedCount = 0;

  for (const [mangadexId, stats] of statsMap) {
    const seriesId = idToSeriesMap.get(mangadexId);
    if (!seriesId) continue;

    try {
      await (prisma as PrismaClient).series.update({
        where: { id: seriesId },
        data: {
          total_follows: stats.follows || 0,
          average_rating: stats.rating ?? null,
          stats_last_fetched_at: new Date(),
          updated_at: new Date(),
        },
      });

      logger.info('[StatsEnrichment] stats-upsert', {
        seriesId,
        follows: stats.follows,
        rating: stats.rating,
      });

      enrichedCount++;
    } catch (dbError) {
      logger.error('[StatsEnrichment] Failed to update series stats', {
        seriesId,
        mangadexId,
        error: dbError instanceof Error ? dbError.message : String(dbError),
      });
      failedCount++;
    }
  }

  const missingCount = seriesList.length - statsMap.size;
  if (missingCount > 0) {
    logger.warn('[StatsEnrichment] Some series had no stats returned', {
      requested: seriesList.length,
      received: statsMap.size,
      missing: missingCount,
    });
    failedCount += missingCount;
  }

  return {
    success: failedCount === 0,
    enrichedCount,
    failedCount,
  };
}

/**
 * Enrich a single series with MangaDex statistics.
 * Convenience wrapper around enrichSeriesWithStats.
 */
export async function enrichSingleSeriesWithStats(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  seriesId: string,
  mangadexId: string
): Promise<StatsEnrichmentResult> {
  return enrichSeriesWithStats(prisma, [{ seriesId, mangadexId }]);
}

/**
 * Check if stats enrichment is enabled via environment variable.
 */
export function isStatsEnrichmentEnabled(): boolean {
  return ENABLE_STATS_UPSERT;
}
