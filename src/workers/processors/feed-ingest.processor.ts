/**
 * Feed Ingest Processor
 * 
 * Polls official sources (MangaDex, MangaUpdates) for chapter releases and updates
 * series.last_chapter_released_at atomically using GREATEST().
 * 
 * DESIGN PRINCIPLES:
 * 1. Only use official APIs (MangaDex, MangaPlus, MangaUpdates) - NO pirate scraping
 * 2. Idempotent: dedupe by (series_id, chapter_number, source_name, external_event_id)
 * 3. Atomic updates: Use GREATEST() to prevent race conditions
 * 4. Tier-based sync frequency:
 *    - Tier A: 30 min (popular/active series)
 *    - Tier B: 2 hours (moderate activity)
 *    - Tier C: 6 hours (low activity)
 * 5. Queue depth monitoring: Pause non-critical crawls when depth > 5000
 */

import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { MangaDexClient } from '@/lib/mangadex/client';
import { getTotalQueueDepth } from '@/lib/queues';

const mangadexClient = new MangaDexClient();

const BATCH_SIZE = 50;
const MAX_EVENTS_PER_RUN = 100;

export type FeedIngestSource = 'mangadex' | 'mangaupdates';
export type FeedIngestTier = 'A' | 'B' | 'C';

export interface FeedIngestJobData {
  source: FeedIngestSource;
  tier: FeedIngestTier;
  limit?: number;
}

export interface FeedIngestResult {
  source: string;
  tier: string;
  runId: string;
  events_fetched: number;
  events_created: number;
  events_skipped: number;
  series_updated: number;
  errors: number;
  rate_limit_hits: number;
  duration_ms: number;
  paused_due_to_queue_depth?: boolean;
}

async function checkQueueHealth(): Promise<{ healthy: boolean; depth: number }> {
  const { total, isOverloaded } = await getTotalQueueDepth();
  return { healthy: !isOverloaded, depth: total };
}

async function createIngestRun(source: string, tier: string): Promise<string> {
  const run = await prisma.feedIngestRun.create({
    data: {
      source_name: source,
      tier,
      status: 'running',
    },
  });
  return run.id;
}

async function completeIngestRun(
  runId: string,
  result: Partial<FeedIngestResult>,
  error?: string
) {
  await prisma.feedIngestRun.update({
    where: { id: runId },
    data: {
      completed_at: new Date(),
      status: error ? 'failed' : 'completed',
      events_fetched: result.events_fetched || 0,
      events_created: result.events_created || 0,
      events_skipped: result.events_skipped || 0,
      series_updated: result.series_updated || 0,
      error_count: result.errors || 0,
      error_message: error || null,
      rate_limit_hits: result.rate_limit_hits || 0,
      api_calls_made: 1,
    },
  });
}

async function ingestMangaDexChapters(
  runId: string,
  tier: FeedIngestTier,
  limit: number
): Promise<Omit<FeedIngestResult, 'source' | 'tier' | 'runId' | 'duration_ms'>> {
  const result = {
    events_fetched: 0,
    events_created: 0,
    events_skipped: 0,
    series_updated: 0,
    errors: 0,
    rate_limit_hits: 0,
  };

  try {
    const response = await mangadexClient.fetchLatestChapters({
      limit: Math.min(limit, 100),
      translatedLanguage: ['en'],
      includeManga: true,
    });

    result.events_fetched = response.data.length;
    console.log(`[FeedIngest][${runId}] Fetched ${result.events_fetched} chapters from MangaDex`);

    for (let i = 0; i < response.data.length; i += BATCH_SIZE) {
      const batch = response.data.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (chapter) => {
        try {
          const mangaRel = chapter.relationships.find(r => r.type === 'manga');
          if (!mangaRel) {
            result.events_skipped++;
            return;
          }

          const mangadexId = mangaRel.id;
          const chapterNumber = chapter.attributes.chapter || '0';
          const externalEventId = chapter.id;

          const series = await prisma.series.findUnique({
            where: { mangadex_id: mangadexId },
            select: { id: true, last_chapter_released_at: true },
          });

          if (!series) {
            result.events_skipped++;
            return;
          }

          const publishedAt = chapter.attributes.publishAt 
            ? new Date(chapter.attributes.publishAt)
            : null;
          const discoveredAt = new Date();

          const scanlationGroup = chapter.relationships.find(r => r.type === 'scanlation_group');
          const externalUrl = `https://mangadex.org/chapter/${chapter.id}`;

          try {
            await prisma.chapterAvailabilityEvent.create({
              data: {
                series_id: series.id,
                chapter_number: chapterNumber,
                source_name: 'mangadex',
                external_event_id: externalEventId,
                discovered_at: discoveredAt,
                published_at: publishedAt,
                chapter_title: chapter.attributes.title || null,
                volume_number: chapter.attributes.volume ? parseInt(chapter.attributes.volume, 10) : null,
                language: chapter.attributes.translatedLanguage || 'en',
                external_url: externalUrl,
                process_status: 'processed',
                processed_at: new Date(),
                raw_payload: {
                  mangadex_chapter_id: chapter.id,
                  scanlation_group: scanlationGroup?.attributes?.name || null,
                  pages: chapter.attributes.pages,
                },
              },
            });
            result.events_created++;

            const shouldUpdate = !series.last_chapter_released_at || 
              discoveredAt > series.last_chapter_released_at;

            if (shouldUpdate) {
              await prisma.$executeRaw`
                UPDATE series 
                SET last_chapter_released_at = GREATEST(
                  COALESCE(last_chapter_released_at, '1970-01-01'::timestamptz),
                  ${discoveredAt}::timestamptz
                )
                WHERE id = ${series.id}::uuid
                  AND deleted_at IS NULL
              `;
              result.series_updated++;
            }
          } catch (err: unknown) {
            if (err instanceof Error && err.message.includes('Unique constraint')) {
              result.events_skipped++;
            } else {
              result.errors++;
              console.error(`[FeedIngest][${runId}] Error processing chapter ${chapter.id}:`, err);
            }
          }
        } catch (err) {
          result.errors++;
          console.error(`[FeedIngest][${runId}] Error in batch processing:`, err);
        }
      }));
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('429')) {
      result.rate_limit_hits++;
      console.warn(`[FeedIngest][${runId}] MangaDex rate limit hit`);
    } else {
      throw err;
    }
  }

  return result;
}

async function ingestMangaUpdatesReleases(
  runId: string,
  tier: FeedIngestTier,
  limit: number
): Promise<Omit<FeedIngestResult, 'source' | 'tier' | 'runId' | 'duration_ms'>> {
  const result = {
    events_fetched: 0,
    events_created: 0,
    events_skipped: 0,
    series_updated: 0,
    errors: 0,
    rate_limit_hits: 0,
  };

  try {
    const recentReleases = await prisma.mangaUpdatesRelease.findMany({
      where: {
        series_id: { not: null },
        created_at: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      include: {
        series: {
          select: { id: true, last_chapter_released_at: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });

    result.events_fetched = recentReleases.length;
    console.log(`[FeedIngest][${runId}] Found ${result.events_fetched} recent MangaUpdates releases`);

    for (const release of recentReleases) {
      if (!release.series) {
        result.events_skipped++;
        continue;
      }

      try {
        const discoveredAt = release.created_at;

        await prisma.chapterAvailabilityEvent.create({
          data: {
            series_id: release.series.id,
            chapter_number: release.chapter || '0',
            source_name: 'mangaupdates',
            external_event_id: release.mangaupdates_release_id,
            discovered_at: discoveredAt,
            published_at: release.published_at,
            chapter_title: release.title,
            volume_number: release.volume ? parseInt(release.volume, 10) : null,
            language: release.language || 'en',
            process_status: 'processed',
            processed_at: new Date(),
            raw_payload: release.metadata || {},
          },
        });
        result.events_created++;

        const shouldUpdate = !release.series.last_chapter_released_at || 
          discoveredAt > release.series.last_chapter_released_at;

        if (shouldUpdate) {
          await prisma.$executeRaw`
            UPDATE series 
            SET last_chapter_released_at = GREATEST(
              COALESCE(last_chapter_released_at, '1970-01-01'::timestamptz),
              ${discoveredAt}::timestamptz
            )
            WHERE id = ${release.series.id}::uuid
              AND deleted_at IS NULL
          `;
          result.series_updated++;
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('Unique constraint')) {
          result.events_skipped++;
        } else {
          result.errors++;
          console.error(`[FeedIngest][${runId}] Error processing MU release:`, err);
        }
      }
    }
  } catch (err) {
    result.errors++;
    console.error(`[FeedIngest][${runId}] Error fetching MangaUpdates releases:`, err);
  }

  return result;
}

export async function processFeedIngest(job: Job<FeedIngestJobData>): Promise<FeedIngestResult> {
  const { source, tier, limit = MAX_EVENTS_PER_RUN } = job.data;
  const jobId = job.id || 'unknown';
  const startTime = Date.now();

  console.log(`[FeedIngest][${jobId}] Starting ${source} ingest (tier: ${tier}, limit: ${limit})`);

  const { healthy, depth } = await checkQueueHealth();
  if (!healthy) {
    console.warn(`[FeedIngest][${jobId}] Queue depth too high (${depth}), pausing non-critical ingest`);
    return {
      source,
      tier,
      runId: '',
      events_fetched: 0,
      events_created: 0,
      events_skipped: 0,
      series_updated: 0,
      errors: 0,
      rate_limit_hits: 0,
      duration_ms: Date.now() - startTime,
      paused_due_to_queue_depth: true,
    };
  }

  const runId = await createIngestRun(source, tier);

  try {
    let result: Omit<FeedIngestResult, 'source' | 'tier' | 'runId' | 'duration_ms'>;

    switch (source) {
      case 'mangadex':
        result = await ingestMangaDexChapters(runId, tier, limit);
        break;
      case 'mangaupdates':
        result = await ingestMangaUpdatesReleases(runId, tier, limit);
        break;
      default:
        throw new Error(`Unknown feed source: ${source}`);
    }

    const finalResult: FeedIngestResult = {
      source,
      tier,
      runId,
      ...result,
      duration_ms: Date.now() - startTime,
    };

    await completeIngestRun(runId, finalResult);

    console.log(
      `[FeedIngest][${jobId}] Completed: ${result.events_created} created, ` +
      `${result.events_skipped} skipped, ${result.series_updated} series updated, ` +
      `${result.errors} errors in ${finalResult.duration_ms}ms`
    );

    return finalResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await completeIngestRun(runId, { errors: 1 }, errorMessage);
    throw error;
  }
}
