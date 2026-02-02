#!/usr/bin/env node
/**
 * MangaUpdates Release Poller - MangaTrack
 *
 * Use official API V1 — do not scrape.
 *
 * This script polls MangaUpdates for latest releases and enqueues metadata
 * fetch jobs for new series. Can run as a cron job or with --once flag.
 *
 * Usage:
 *   bun run src/workers/mangaupdatesPoller.ts           # Continuous polling
 *   bun run src/workers/mangaupdatesPoller.ts --once    # Single poll then exit
 *
 * Environment Variables:
 *   MANGAUPDATES_POLL_INTERVAL_MS - Polling interval (default: 900000 = 15 min)
 *   MANGAUPDATES_POLL_DAYS - Days to look back (default: 7)
 *   MANGAUPDATES_POLL_PAGES - Number of pages to poll (default: 3)
 */

import 'dotenv/config';
import { Queue } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { mangaupdatesClient, ReleaseEntry, RateLimitError } from '@/lib/mangaupdates';
import { mangaupdatesCache, releasesCacheKey, CACHE_TTL } from '@/lib/mangaupdates/cache';
import { redisWorker, REDIS_KEY_PREFIX, waitForRedis } from '@/lib/redis';

// ============================================================================
// Configuration
// ============================================================================

const POLL_INTERVAL_MS = parseInt(process.env.MANGAUPDATES_POLL_INTERVAL_MS || '900000', 10); // 15 minutes
const POLL_DAYS = parseInt(process.env.MANGAUPDATES_POLL_DAYS || '7', 10);
const POLL_PAGES = parseInt(process.env.MANGAUPDATES_POLL_PAGES || '3', 10);
const METADATA_QUEUE_NAME = 'mangaupdates-fetch-metadata';
const POLLER_LOCK_KEY = `${REDIS_KEY_PREFIX}mangaupdates:poller:lock`;
const POLLER_LOCK_TTL = 60; // 60 seconds

// ============================================================================
// Queue Setup
// ============================================================================

let metadataQueue: Queue | null = null;

function getMetadataQueue(): Queue {
  if (!metadataQueue) {
    metadataQueue = new Queue(METADATA_QUEUE_NAME, {
      connection: redisWorker as any,
      prefix: REDIS_KEY_PREFIX,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
  }
  return metadataQueue;
}

// ============================================================================
// Metrics
// ============================================================================

interface PollMetrics {
  startedAt: Date;
  completedAt?: Date;
  releasesPolled: number;
  releasesUpserted: number;
  metadataJobsEnqueued: number;
  seriesSkippedCached: number;
  errors: string[];
}

function createMetrics(): PollMetrics {
  return {
    startedAt: new Date(),
    releasesPolled: 0,
    releasesUpserted: 0,
    metadataJobsEnqueued: 0,
    seriesSkippedCached: 0,
    errors: [],
  };
}

function logMetrics(metrics: PollMetrics): void {
  const duration = metrics.completedAt
    ? metrics.completedAt.getTime() - metrics.startedAt.getTime()
    : 0;

  console.log('[MangaUpdates Poller] Poll completed:', {
    duration: `${duration}ms`,
    releasesPolled: metrics.releasesPolled,
    releasesUpserted: metrics.releasesUpserted,
    metadataJobsEnqueued: metrics.metadataJobsEnqueued,
    seriesSkippedCached: metrics.seriesSkippedCached,
    errors: metrics.errors.length,
  });

  if (metrics.errors.length > 0) {
    console.error('[MangaUpdates Poller] Errors:', metrics.errors);
  }
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Check if series metadata is cached (fetched within 24h).
 */
async function isSeriesCached(mangaupdatesSeriesId: number): Promise<boolean> {
  const cacheKey = `series:${mangaupdatesSeriesId}`;
  if (await mangaupdatesCache.has(cacheKey)) {
    return true;
  }

  try {
    const series = await prisma.series.findFirst({
      where: {
        mangaupdates_series_id: BigInt(mangaupdatesSeriesId),
      },
      select: {
        mu_last_fetched_at: true,
      },
    });

    if (series?.mu_last_fetched_at) {
      const hoursSinceFetch = (Date.now() - new Date(series.mu_last_fetched_at).getTime()) / (1000 * 60 * 60);
      return hoursSinceFetch < 24;
    }
  } catch (error) {
    console.warn('[MangaUpdates Poller] Cache check failed:', error instanceof Error ? error.message : 'Unknown');
  }

  return false;
}

/**
 * Upsert a release entry into the database.
 */
async function upsertRelease(release: ReleaseEntry): Promise<{ isNew: boolean }> {
  const releaseId = `mu-${release.id}`;

  try {
    const existing = await prisma.mangaUpdatesRelease.findUnique({
      where: { mangaupdates_release_id: releaseId },
    });

    await prisma.mangaUpdatesRelease.upsert({
      where: { mangaupdates_release_id: releaseId },
      create: {
        mangaupdates_release_id: releaseId,
        mangaupdates_series_id: BigInt(release.series.series_id),
        title: release.title,
        chapter: release.chapter,
        volume: release.volume,
        published_at: new Date(release.release_date),
        metadata: {
          groups: release.groups,
          seriesTitle: release.series.title,
          seriesUrl: release.series.url,
        },
      },
      update: {
        title: release.title,
        chapter: release.chapter,
        volume: release.volume,
        published_at: new Date(release.release_date),
        metadata: {
          groups: release.groups,
          seriesTitle: release.series.title,
          seriesUrl: release.series.url,
        },
      },
    });

    return { isNew: !existing };
  } catch (error) {
    console.warn('[MangaUpdates Poller] Release upsert failed:', error instanceof Error ? error.message : 'Unknown error');
    return { isNew: false };
  }
}

/**
 * Enqueue a metadata fetch job for a series.
 */
async function enqueueMetadataFetch(seriesId: number): Promise<void> {
  const queue = getMetadataQueue();
  const jobId = `mu-metadata-${seriesId}`;

  await queue.add(
    'fetch-metadata',
    {
      seriesId,
      enqueuedAt: Date.now(),
    },
    {
      jobId,
    }
  );
}

/**
 * Process a single release entry.
 */
async function processRelease(
  release: ReleaseEntry,
  metrics: PollMetrics
): Promise<void> {
  try {
    const { isNew } = await upsertRelease(release);
    if (isNew) {
      metrics.releasesUpserted++;
    }

    const seriesId = release.series.series_id;
    const isCached = await isSeriesCached(seriesId);

    if (isCached) {
      metrics.seriesSkippedCached++;
      return;
    }

    await enqueueMetadataFetch(seriesId);
    metrics.metadataJobsEnqueued++;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    metrics.errors.push(`Release ${release.id}: ${errorMsg}`);
  }
}

/**
 * Poll latest releases from MangaUpdates.
 */
async function pollReleases(metrics: PollMetrics): Promise<void> {
  console.log(`[MangaUpdates Poller] Polling releases (days: ${POLL_DAYS}, pages: ${POLL_PAGES})`);

  const processedSeriesIds = new Set<number>();

  for (let page = 1; page <= POLL_PAGES; page++) {
    try {
      const cacheKey = releasesCacheKey(POLL_DAYS, page);
      let releases = await mangaupdatesCache.get<ReleaseEntry[]>(cacheKey);

      if (!releases) {
        console.log(`[MangaUpdates Poller] Fetching page ${page}...`);
        releases = await mangaupdatesClient.pollLatestReleases({
          days: POLL_DAYS,
          page,
        });

        await mangaupdatesCache.set(cacheKey, releases, CACHE_TTL.RELEASES);
      } else {
        console.log(`[MangaUpdates Poller] Using cached releases for page ${page}`);
      }

      metrics.releasesPolled += releases.length;

      for (const release of releases) {
        if (processedSeriesIds.has(release.series.series_id)) {
          continue;
        }

        await processRelease(release, metrics);
        processedSeriesIds.add(release.series.series_id);
      }

      const status = mangaupdatesClient.getRateLimitStatus();
      if (status.queueSize > 10) {
        console.log(`[MangaUpdates Poller] High queue backpressure (${status.queueSize}), waiting...`);
        await mangaupdatesClient.waitForIdle();
      }
    } catch (error) {
      if (error instanceof RateLimitError) {
        console.warn(`[MangaUpdates Poller] Rate limited on page ${page}, waiting ${error.retryAfter}s`);
        await new Promise((resolve) => setTimeout(resolve, error.retryAfter * 1000));
        page--;
        continue;
      }

      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      metrics.errors.push(`Page ${page}: ${errorMsg}`);
      console.error(`[MangaUpdates Poller] Error polling page ${page}:`, error);
    }
  }
}

/**
 * Acquire a distributed lock to prevent concurrent polling.
 */
async function acquirePollerLock(): Promise<boolean> {
  try {
    const result = await redisWorker.set(
      POLLER_LOCK_KEY,
      process.pid.toString(),
      'EX',
      POLLER_LOCK_TTL,
      'NX'
    );
    return result === 'OK';
  } catch (error) {
    console.error('[MangaUpdates Poller] Failed to acquire lock:', error);
    return false;
  }
}

/**
 * Release the distributed lock.
 */
async function releasePollerLock(): Promise<void> {
  try {
    await redisWorker.del(POLLER_LOCK_KEY);
  } catch (error) {
    console.error('[MangaUpdates Poller] Failed to release lock:', error);
  }
}

/**
 * Extend the lock TTL while processing.
 */
async function extendPollerLock(): Promise<void> {
  try {
    await redisWorker.expire(POLLER_LOCK_KEY, POLLER_LOCK_TTL);
  } catch (error) {
    console.error('[MangaUpdates Poller] Failed to extend lock:', error);
  }
}

/**
 * Run a single poll cycle.
 */
async function runPollCycle(): Promise<void> {
  const hasLock = await acquirePollerLock();
  if (!hasLock) {
    console.log('[MangaUpdates Poller] Another instance is already polling, skipping');
    return;
  }

  const metrics = createMetrics();
  const lockHeartbeat = setInterval(() => extendPollerLock(), (POLLER_LOCK_TTL / 2) * 1000);

  try {
    await pollReleases(metrics);
  } finally {
    clearInterval(lockHeartbeat);
    await releasePollerLock();
    metrics.completedAt = new Date();
    logMetrics(metrics);
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  console.log('[MangaUpdates Poller] Starting...');
  console.log('[MangaUpdates Poller] Config:', {
    pollIntervalMs: POLL_INTERVAL_MS,
    pollDays: POLL_DAYS,
    pollPages: POLL_PAGES,
  });

  const redisReady = await waitForRedis(redisWorker, 10000);
  if (!redisReady) {
    console.error('[MangaUpdates Poller] Redis not available, exiting');
    process.exit(1);
  }

  const isOnce = process.argv.includes('--once');

  if (isOnce) {
    console.log('[MangaUpdates Poller] Running single poll cycle (--once mode)');
    await runPollCycle();
    console.log('[MangaUpdates Poller] Done');
    await prisma.$disconnect();
    process.exit(0);
  }

  console.log(`[MangaUpdates Poller] Starting continuous polling (interval: ${POLL_INTERVAL_MS}ms)`);

  await runPollCycle();

  const pollInterval = setInterval(async () => {
    try {
      await runPollCycle();
    } catch (error) {
      console.error('[MangaUpdates Poller] Unhandled error in poll cycle:', error);
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    console.log(`[MangaUpdates Poller] Received ${signal}, shutting down...`);
    clearInterval(pollInterval);
    await releasePollerLock();
    await prisma.$disconnect();
    if (metadataQueue) {
      await metadataQueue.close();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[MangaUpdates Poller] Fatal error:', error);
  process.exit(1);
});
