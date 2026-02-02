import { prisma } from '@/lib/prisma';
import { refreshCoverQueue } from '@/lib/queues';
import { isValidCoverUrl } from '@/lib/cover-resolver';

/**
 * Identifies MangaDex sources that need cover refreshes
 * and adds them to the refresh-cover queue.
 */
export async function runCoverRefreshScheduler() {
  console.log('[Scheduler] Running Cover Refresh Scheduler...');

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Priority 1: Series with null/invalid covers that have MangaDex sources
  const seriesNeedingCovers = await prisma.seriesSource.findMany({
    where: {
      source_name: 'mangadex',
      series: {
        OR: [
          { cover_url: null },
          { cover_url: '' },
        ],
      },
    },
    select: {
      series_id: true,
      source_id: true,
      source_name: true,
    },
    take: 100,
  });

  // Priority 2: Stale sources (haven't been updated in 24 hours)
  const existingSeriesIds = seriesNeedingCovers
    .map(s => s.series_id)
    .filter((id): id is string => id !== null);
  
  const staleSources = await prisma.seriesSource.findMany({
    where: {
      source_name: 'mangadex',
      OR: [
        { cover_updated_at: { lt: twentyFourHoursAgo } },
        { cover_updated_at: null },
      ],
      series_id: {
        notIn: existingSeriesIds,
      },
    },
    select: {
      series_id: true,
      source_id: true,
      source_name: true,
    },
    take: 100,
    orderBy: {
      cover_updated_at: 'asc',
    },
  });

  const sourcesToRefresh = [...seriesNeedingCovers, ...staleSources];

  if (sourcesToRefresh.length === 0) {
    console.log('[Scheduler] No covers need refreshing');
    return;
  }

  console.log(`[Scheduler] Queueing ${sourcesToRefresh.length} covers for refresh`);

  for (const source of sourcesToRefresh) {
    await refreshCoverQueue.add(
      `refresh-${source.series_id}`,
      {
        seriesId: source.series_id,
        sourceId: source.source_id,
        sourceName: source.source_name,
      },
      {
        jobId: `refresh-${source.source_name}-${source.source_id}`,
        removeOnComplete: true,
      }
    );
  }

  console.log('[Scheduler] Cover refresh jobs queued');
}
