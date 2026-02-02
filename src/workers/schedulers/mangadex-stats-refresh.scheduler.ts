/**
 * MangaDex Statistics Refresh Scheduler
 * 
 * Periodically refreshes statistics (follows, ratings) for series with MangaDex IDs.
 * Uses a tiered approach to prioritize popular/active series:
 * 
 * - Tier A (High Priority): series.total_follows >= TIER_A_THRESHOLD OR stats_last_fetched_at IS NULL
 * - Tier B (Medium Priority): Next chunk sorted by total_follows desc
 * - Tier C (Low Priority): Sample of older rarely-updated series
 * 
 * @see MangaDexStatsClient for batch fetching implementation
 */

import { prisma } from '@/lib/prisma';
import { mangadexStatsRefreshQueue } from '@/lib/queues';
import { logger } from '@/lib/logger';

// Configuration from environment variables with defaults
const TIER_A_THRESHOLD = parseInt(process.env.MANGADEX_STATS_TIER_A_THRESHOLD || '10000', 10);
const REFRESH_BATCH_SIZE = parseInt(process.env.MANGADEX_STATS_REFRESH_BATCH_SIZE || '200', 10);

// Refresh intervals (how old stats_last_fetched_at must be to trigger refresh)
const TIER_A_STALE_HOURS = parseInt(process.env.MANGADEX_STATS_TIER_A_STALE_HOURS || '24', 10);
const TIER_B_STALE_HOURS = parseInt(process.env.MANGADEX_STATS_TIER_B_STALE_HOURS || '168', 10); // 7 days
const TIER_C_STALE_HOURS = parseInt(process.env.MANGADEX_STATS_TIER_C_STALE_HOURS || '720', 10); // 30 days

export interface StatsRefreshJobData {
  tier: 'A' | 'B' | 'C';
  seriesIds: string[];
  mangadexIds: string[];
  scheduledAt: string;
}

/**
 * Find Tier A candidates: High-priority series (popular or never-fetched)
 */
async function findTierACandidates(limit: number): Promise<Array<{ id: string; mangadex_id: string }>> {
  const tierAStaleDate = new Date(Date.now() - TIER_A_STALE_HOURS * 60 * 60 * 1000);

  // Tier A: High follows OR never fetched stats (first-pass)
  const candidates = await prisma.series.findMany({
    where: {
      mangadex_id: { not: null },
      deleted_at: null,
      OR: [
        // High-priority: popular series that are stale
        {
          AND: [
            { total_follows: { gte: TIER_A_THRESHOLD } },
            {
              OR: [
                { stats_last_fetched_at: null },
                { stats_last_fetched_at: { lt: tierAStaleDate } },
              ],
            },
          ],
        },
        // First-pass: never fetched stats
        { stats_last_fetched_at: null },
      ],
    },
    select: {
      id: true,
      mangadex_id: true,
    },
    orderBy: [
      { stats_last_fetched_at: { sort: 'asc', nulls: 'first' } },
      { total_follows: 'desc' },
    ],
    take: limit,
  });

  return candidates
    .filter(s => s.mangadex_id !== null)
    .map(s => ({ id: s.id, mangadex_id: s.mangadex_id as string }));
}

/**
 * Find Tier B candidates: Medium-priority series (sorted by follows)
 */
async function findTierBCandidates(
  limit: number,
  excludeIds: string[]
): Promise<Array<{ id: string; mangadex_id: string }>> {
  const tierBStaleDate = new Date(Date.now() - TIER_B_STALE_HOURS * 60 * 60 * 1000);

  const candidates = await prisma.series.findMany({
    where: {
      mangadex_id: { not: null },
      deleted_at: null,
      id: { notIn: excludeIds },
      total_follows: { lt: TIER_A_THRESHOLD, gt: 0 },
      OR: [
        { stats_last_fetched_at: null },
        { stats_last_fetched_at: { lt: tierBStaleDate } },
      ],
    },
    select: {
      id: true,
      mangadex_id: true,
    },
    orderBy: [
      { total_follows: 'desc' },
      { stats_last_fetched_at: { sort: 'asc', nulls: 'first' } },
    ],
    take: limit,
  });

  return candidates
    .filter(s => s.mangadex_id !== null)
    .map(s => ({ id: s.id, mangadex_id: s.mangadex_id as string }));
}

/**
 * Find Tier C candidates: Low-priority series (sample of older, rarely-updated)
 */
async function findTierCCandidates(
  limit: number,
  excludeIds: string[]
): Promise<Array<{ id: string; mangadex_id: string }>> {
  const tierCStaleDate = new Date(Date.now() - TIER_C_STALE_HOURS * 60 * 60 * 1000);

    // Tier C: Older series with few/no follows that haven't been updated recently
    const candidates = await prisma.series.findMany({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        id: { notIn: excludeIds },
        total_follows: { equals: 0 },
        OR: [{ stats_last_fetched_at: null }, { stats_last_fetched_at: { lt: tierCStaleDate } }],
      },
    select: {
      id: true,
      mangadex_id: true,
    },
    orderBy: {
      stats_last_fetched_at: { sort: 'asc', nulls: 'first' },
    },
    take: limit,
  });

  return candidates
    .filter(s => s.mangadex_id !== null)
    .map(s => ({ id: s.id, mangadex_id: s.mangadex_id as string }));
}

/**
 * Run the MangaDex statistics refresh scheduler.
 * 
 * This scheduler:
 * 1. Finds series that need stats refresh based on tier
 * 2. Queues batch jobs for the stats refresh worker
 * 3. Respects rate limits by batching appropriately
 */
export async function runMangadexStatsRefreshScheduler(): Promise<void> {
  logger.info('[MangaDexStatsScheduler] Running stats refresh scheduler...');

  const scheduledAt = new Date().toISOString();
  let totalQueued = 0;

  try {
    // Find Tier A candidates (high priority)
    const tierABatchLimit = Math.ceil(REFRESH_BATCH_SIZE * 0.5); // 50% of batch for Tier A
    const tierACandidates = await findTierACandidates(tierABatchLimit);
    
    if (tierACandidates.length > 0) {
      logger.info(`[MangaDexStatsScheduler] Found ${tierACandidates.length} Tier A candidates`);
      
      await mangadexStatsRefreshQueue.add(
        'stats-refresh-tier-a',
        {
          tier: 'A',
          seriesIds: tierACandidates.map(c => c.id),
          mangadexIds: tierACandidates.map(c => c.mangadex_id),
          scheduledAt,
        } satisfies StatsRefreshJobData,
        {
          jobId: `stats-refresh-a-${Date.now()}`,
          priority: 1, // Highest priority
          removeOnComplete: { count: 50, age: 3600 },
          removeOnFail: { count: 100, age: 86400 },
        }
      );
      totalQueued += tierACandidates.length;
    }

    const processedIds = tierACandidates.map(c => c.id);

    // Find Tier B candidates (medium priority)
    const tierBBatchLimit = Math.ceil(REFRESH_BATCH_SIZE * 0.3); // 30% of batch for Tier B
    const tierBCandidates = await findTierBCandidates(tierBBatchLimit, processedIds);
    
    if (tierBCandidates.length > 0) {
      logger.info(`[MangaDexStatsScheduler] Found ${tierBCandidates.length} Tier B candidates`);
      
      await mangadexStatsRefreshQueue.add(
        'stats-refresh-tier-b',
        {
          tier: 'B',
          seriesIds: tierBCandidates.map(c => c.id),
          mangadexIds: tierBCandidates.map(c => c.mangadex_id),
          scheduledAt,
        } satisfies StatsRefreshJobData,
        {
          jobId: `stats-refresh-b-${Date.now()}`,
          priority: 5, // Medium priority
          removeOnComplete: { count: 50, age: 3600 },
          removeOnFail: { count: 100, age: 86400 },
        }
      );
      totalQueued += tierBCandidates.length;
      processedIds.push(...tierBCandidates.map(c => c.id));
    }

    // Find Tier C candidates (low priority)
    const tierCBatchLimit = Math.ceil(REFRESH_BATCH_SIZE * 0.2); // 20% of batch for Tier C
    const tierCCandidates = await findTierCCandidates(tierCBatchLimit, processedIds);
    
    if (tierCCandidates.length > 0) {
      logger.info(`[MangaDexStatsScheduler] Found ${tierCCandidates.length} Tier C candidates`);
      
      await mangadexStatsRefreshQueue.add(
        'stats-refresh-tier-c',
        {
          tier: 'C',
          seriesIds: tierCCandidates.map(c => c.id),
          mangadexIds: tierCCandidates.map(c => c.mangadex_id),
          scheduledAt,
        } satisfies StatsRefreshJobData,
        {
          jobId: `stats-refresh-c-${Date.now()}`,
          priority: 10, // Lowest priority
          removeOnComplete: { count: 50, age: 3600 },
          removeOnFail: { count: 100, age: 86400 },
        }
      );
      totalQueued += tierCCandidates.length;
    }

    if (totalQueued === 0) {
      logger.info('[MangaDexStatsScheduler] No series need stats refresh');
    } else {
      logger.info(`[MangaDexStatsScheduler] Queued ${totalQueued} series for stats refresh`);
    }
  } catch (error) {
    logger.error('[MangaDexStatsScheduler] Failed to run stats refresh scheduler', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get statistics about series needing stats refresh.
 * Useful for monitoring and debugging.
 */
export async function getMangadexStatsRefreshStatus(): Promise<{
  tierA: { total: number; stale: number };
  tierB: { total: number; stale: number };
  tierC: { total: number; stale: number };
  neverFetched: number;
}> {
  const tierAStaleDate = new Date(Date.now() - TIER_A_STALE_HOURS * 60 * 60 * 1000);
  const tierBStaleDate = new Date(Date.now() - TIER_B_STALE_HOURS * 60 * 60 * 1000);
  const tierCStaleDate = new Date(Date.now() - TIER_C_STALE_HOURS * 60 * 60 * 1000);

  const [tierATotal, tierAStale, tierBTotal, tierBStale, tierCTotal, tierCStale, neverFetched] = await Promise.all([
    // Tier A total
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        total_follows: { gte: TIER_A_THRESHOLD },
      },
    }),
    // Tier A stale
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        total_follows: { gte: TIER_A_THRESHOLD },
        OR: [
          { stats_last_fetched_at: null },
          { stats_last_fetched_at: { lt: tierAStaleDate } },
        ],
      },
    }),
    // Tier B total
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        total_follows: { lt: TIER_A_THRESHOLD, gt: 0 },
      },
    }),
    // Tier B stale
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        total_follows: { lt: TIER_A_THRESHOLD, gt: 0 },
        OR: [
          { stats_last_fetched_at: null },
          { stats_last_fetched_at: { lt: tierBStaleDate } },
        ],
      },
    }),
    // Tier C total
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        total_follows: { equals: 0 },
      },
    }),
    // Tier C stale
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        total_follows: { equals: 0 },
        OR: [{ stats_last_fetched_at: null }, { stats_last_fetched_at: { lt: tierCStaleDate } }],
      },
    }),
    // Never fetched
    prisma.series.count({
      where: {
        mangadex_id: { not: null },
        deleted_at: null,
        stats_last_fetched_at: null,
      },
    }),
  ]);

  return {
    tierA: { total: tierATotal, stale: tierAStale },
    tierB: { total: tierBTotal, stale: tierBStale },
    tierC: { total: tierCTotal, stale: tierCStale },
    neverFetched,
  };
}
