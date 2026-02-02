/**
 * MangaUpdates Metadata Worker - MangaTrack
 *
 * Use official API V1 — do not scrape.
 *
 * BullMQ worker that processes `mangaupdates:fetch-metadata` jobs to fetch
 * and upsert series metadata from the MangaUpdates API.
 *
 * Features:
 * - 24h cache TTL to avoid redundant API calls
 * - Rate limit handling with exponential backoff
 * - Automatic re-enqueue on transient failures
 */

import 'dotenv/config';
import { Job, Worker } from 'bullmq';
import { prisma } from '@/lib/prisma';
import {
  mangaupdatesClient,
  SeriesData,
  RateLimitError,
  NotFoundError,
  MangaUpdatesError,
} from '@/lib/mangaupdates';
import {
  mangaupdatesCache,
  seriesCacheKey,
  CACHE_TTL,
} from '@/lib/mangaupdates/cache';
import { redisWorker, REDIS_KEY_PREFIX, waitForRedis } from '@/lib/redis';

// ============================================================================
// Configuration
// ============================================================================

const QUEUE_NAME = 'mangaupdates-fetch-metadata';
const CACHE_TTL_HOURS = 24;
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 5000;

// ============================================================================
// Job Types
// ============================================================================

interface MetadataJobData {
  seriesId: number;
  enqueuedAt?: number;
  retryAttempt?: number;
}

interface MetadataJobResult {
  success: boolean;
  seriesId: number;
  cached: boolean;
  error?: string;
}

// ============================================================================
// Cache Helpers
// ============================================================================

async function isRecentlyFetched(seriesId: number): Promise<boolean> {
  const cacheKey = seriesCacheKey(seriesId);
  if (await mangaupdatesCache.has(cacheKey)) {
    return true;
  }

  try {
    const series = await prisma.series.findFirst({
      where: {
        mangaupdates_series_id: BigInt(seriesId),
      },
      select: {
        mu_last_fetched_at: true,
      },
    });

    if (series?.mu_last_fetched_at) {
      const hoursSinceFetch =
        (Date.now() - new Date(series.mu_last_fetched_at).getTime()) / (1000 * 60 * 60);
      return hoursSinceFetch < CACHE_TTL_HOURS;
    }
  } catch {
    // Field doesn't exist or query failed
  }

  return false;
}

async function cacheMetadata(seriesId: number, metadata: SeriesData): Promise<void> {
  const cacheKey = seriesCacheKey(seriesId);
  await mangaupdatesCache.set(cacheKey, metadata, CACHE_TTL.SERIES_METADATA);
}

// ============================================================================
// Database Operations
// ============================================================================

async function upsertSeriesMetadata(metadata: SeriesData): Promise<void> {
  const altTitles = metadata.associated.map((a) => a.title);
  const genres = metadata.genres.map((g) => g.genre);
  const authors = metadata.authors.map((a) => ({
    name: a.name,
    id: a.author_id,
    type: a.type,
  }));

  const muMetadata = {
    seriesId: metadata.series_id,
    url: metadata.url,
    type: metadata.type,
    bayesianRating: metadata.bayesian_rating,
    ratingVotes: metadata.rating_votes,
    latestChapter: metadata.latest_chapter,
    licensed: metadata.licensed,
    completed: metadata.completed,
    authors,
    publishers: metadata.publishers,
    categories: metadata.categories.slice(0, 20),
    rank: metadata.rank,
    image: metadata.image,
  };

  const existing = await prisma.series.findFirst({
    where: {
      mangaupdates_series_id: BigInt(metadata.series_id),
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.series.update({
      where: { id: existing.id },
      data: {
        alternative_titles: altTitles,
        description: metadata.description || undefined,
        genres: genres,
        status: metadata.status || undefined,
        year: metadata.year ? parseInt(metadata.year, 10) : undefined,
        mu_metadata: muMetadata,
        mu_last_fetched_at: new Date(),
        updated_at: new Date(),
      },
    });
    console.log(`[MangaUpdates Metadata] Updated series ${existing.id} (MU: ${metadata.series_id})`);
  } else {
    await prisma.series.create({
      data: {
        title: metadata.title,
        alternative_titles: altTitles,
        description: metadata.description || null,
        type: metadata.type || 'manga',
        genres: genres,
        status: metadata.status || null,
        year: metadata.year ? parseInt(metadata.year, 10) : null,
        cover_url: metadata.image?.url?.original || null,
        mangaupdates_series_id: BigInt(metadata.series_id),
        mu_metadata: muMetadata,
        mu_last_fetched_at: new Date(),
      },
    });
    console.log(`[MangaUpdates Metadata] Created series for MU: ${metadata.series_id} - ${metadata.title}`);
  }
}

// ============================================================================
// Job Processor
// ============================================================================

async function processMetadataJob(job: Job<MetadataJobData>): Promise<MetadataJobResult> {
  const { seriesId } = job.data;
  const jobId = job.id || 'unknown';

  console.log(`[MangaUpdates Metadata][${jobId}] Processing series ${seriesId}`);

  if (await isRecentlyFetched(seriesId)) {
    console.log(`[MangaUpdates Metadata][${jobId}] Series ${seriesId} recently fetched, skipping`);
    return {
      success: true,
      seriesId,
      cached: true,
    };
  }

  try {
    console.log(`[MangaUpdates Metadata][${jobId}] Fetching metadata for series ${seriesId}`);
    const metadata = await mangaupdatesClient.fetchSeriesMetadata(seriesId);

    await cacheMetadata(seriesId, metadata);
    await upsertSeriesMetadata(metadata);

    console.log(`[MangaUpdates Metadata][${jobId}] Successfully processed series ${seriesId}`);
    return {
      success: true,
      seriesId,
      cached: false,
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      console.warn(`[MangaUpdates Metadata][${jobId}] Series ${seriesId} not found on MangaUpdates`);
      return {
        success: false,
        seriesId,
        cached: false,
        error: 'Series not found',
      };
    }

    if (error instanceof RateLimitError) {
      console.warn(
        `[MangaUpdates Metadata][${jobId}] Rate limited, will retry after ${error.retryAfter}s`
      );
      throw error;
    }

    if (error instanceof MangaUpdatesError) {
      console.error(
        `[MangaUpdates Metadata][${jobId}] API error (${error.status}): ${error.message}`
      );
      throw error;
    }

    console.error(`[MangaUpdates Metadata][${jobId}] Unexpected error:`, error);
    throw error;
  }
}

// ============================================================================
// Worker Setup
// ============================================================================

let worker: Worker | null = null;

async function startWorker(): Promise<void> {
  console.log('[MangaUpdates Metadata] Starting worker...');

  const redisReady = await waitForRedis(redisWorker, 10000);
  if (!redisReady) {
    console.error('[MangaUpdates Metadata] Redis not available, exiting');
    process.exit(1);
  }

  worker = new Worker<MetadataJobData, MetadataJobResult>(
    QUEUE_NAME,
    processMetadataJob,
    {
      connection: redisWorker as any,
      prefix: REDIS_KEY_PREFIX,
      concurrency: 1,
      limiter: {
        max: 1,
        duration: 1000,
      },
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          return INITIAL_BACKOFF_MS * Math.pow(2, attemptsMade - 1);
        },
      },
    }
  );

  worker.on('completed', (job, result) => {
    console.log(
      `[MangaUpdates Metadata] Job ${job.id} completed:`,
      result.cached ? 'cached' : 'fetched'
    );
  });

  worker.on('failed', (job, error) => {
    const jobId = job?.id || 'unknown';
    const attemptsMade = job?.attemptsMade || 0;

    if (error instanceof RateLimitError) {
      console.warn(
        `[MangaUpdates Metadata] Job ${jobId} rate limited (attempt ${attemptsMade}/${MAX_RETRIES})`
      );
    } else {
      console.error(
        `[MangaUpdates Metadata] Job ${jobId} failed (attempt ${attemptsMade}/${MAX_RETRIES}):`,
        error.message
      );
    }

    if (attemptsMade >= MAX_RETRIES) {
      console.error(
        `[MangaUpdates Metadata] Job ${jobId} exhausted all retries, moving to failed`
      );
    }
  });

  worker.on('error', (error) => {
    console.error('[MangaUpdates Metadata] Worker error:', error);
  });

  worker.on('ready', () => {
    console.log('[MangaUpdates Metadata] Worker ready and listening for jobs');
  });

  console.log(`[MangaUpdates Metadata] Worker started on queue: ${QUEUE_NAME}`);
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string): Promise<void> {
  console.log(`[MangaUpdates Metadata] Received ${signal}, shutting down...`);

  if (worker) {
    await worker.close();
  }

  await prisma.$disconnect();
  console.log('[MangaUpdates Metadata] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================================================
// Main
// ============================================================================

startWorker().catch((error) => {
  console.error('[MangaUpdates Metadata] Fatal error:', error);
  process.exit(1);
});
