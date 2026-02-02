/**
 * MangaUpdates API V1 Client - MangaTrack
 *
 * Use official API V1 — do not scrape.
 * @see https://api.mangaupdates.com/v1
 *
 * This module exports a pre-configured singleton client for use throughout
 * the application. The client enforces rate limiting (1 req/sec by default)
 * and handles retries automatically.
 */

// Re-export client and types
export {
  MangaUpdatesClient,
  MangaUpdatesError,
  RateLimitError,
  NetworkError,
  NotFoundError,
  type MangaUpdatesClientOptions,
  type ReleaseEntry,
  type SeriesData,
  type SearchResult,
  type RateLimitStatus,
  type Genre,
  type Category,
  type Author,
  type Publisher,
  type RankInfo,
  type ReleaseGroup,
  type ImageInfo,
  type LastUpdatedInfo,
  type SeriesRecord,
  type RawSearchResultItem,
  type RawReleasesResponse,
  type RawSearchResponse,
  type RawReleaseRecord,
  type RawReleaseResultItem,
} from './client';

// Re-export cache utilities
export {
  mangaupdatesCache,
  seriesCacheKey,
  releasesCacheKey,
  searchCacheKey,
  CACHE_TTL,
  type CacheInterface,
} from './cache';

import { MangaUpdatesClient } from './client';

// ============================================================================
// Singleton Client Instance
// ============================================================================

/**
 * Pre-configured MangaUpdates client singleton.
 *
 * Configuration:
 * - Rate limit: 1 request/second (MangaUpdates strict limit)
 * - Timeout: 20 seconds
 * - Retries: 3 attempts with exponential backoff
 *
 * Override via environment variable:
 * - MANGAUPDATES_API_BASE: Custom base URL (for testing)
 * - MANGAUPDATES_API_TOKEN: Bearer token (if/when required)
 */
export const mangaupdatesClient = new MangaUpdatesClient({
  baseUrl: process.env.MANGAUPDATES_API_BASE || 'https://api.mangaupdates.com/v1',
  requestsPerSecond: 1,
  apiToken: process.env.MANGAUPDATES_API_TOKEN,
});

// ============================================================================
// Usage Examples
// ============================================================================

/*
 * EXAMPLE: Poll latest releases and queue metadata fetches
 * --------------------------------------------------------
 *
 * import { mangaupdatesClient, ReleaseEntry, SeriesData } from '@/lib/mangaupdates';
 *
 * async function syncLatestReleases() {
 *   // 1. Poll latest releases from the past 7 days
 *   const releases = await mangaupdatesClient.pollLatestReleases({
 *     days: 7,
 *     page: 1,
 *   });
 *
 *   console.log(`Found ${releases.length} releases`);
 *
 *   // 2. Extract unique series IDs from releases
 *   const seriesIds = [...new Set(
 *     releases.map(r => r.series.series_id)
 *   )];
 *
 *   // 3. Queue metadata fetches (executed sequentially at 1 req/sec)
 *   //    The p-queue handles rate limiting automatically
 *   const metadataPromises = seriesIds.map(id =>
 *     mangaupdatesClient.fetchSeriesMetadata(id)
 *       .catch(err => {
 *         console.error(`Failed to fetch series ${id}:`, err.message);
 *         return null;
 *       })
 *   );
 *
 *   // 4. Wait for all fetches to complete
 *   const metadata = await Promise.all(metadataPromises);
 *   const validMetadata = metadata.filter((m): m is SeriesData => m !== null);
 *
 *   console.log(`Fetched ${validMetadata.length} series metadata`);
 *
 *   // 5. Check queue status
 *   const status = mangaupdatesClient.getRateLimitStatus();
 *   console.log(`Queue: ${status.queueSize} pending, ${status.requestsPerSecond}/sec`);
 *
 *   return { releases, metadata: validMetadata };
 * }
 *
 *
 * EXAMPLE: Search for series
 * --------------------------
 *
 * async function searchManga(query: string) {
 *   const results = await mangaupdatesClient.searchSeries(query);
 *
 *   for (const series of results) {
 *     console.log(`${series.title} (ID: ${series.series_id})`);
 *     console.log(`  Rating: ${series.bayesian_rating}`);
 *     console.log(`  Genres: ${series.genres.map(g => g.genre).join(', ')}`);
 *   }
 *
 *   return results;
 * }
 *
 *
 * EXAMPLE: With BullMQ background job
 * -----------------------------------
 *
 * // In src/workers/processors/mangaupdates.processor.ts
 *
 * import { Job } from 'bullmq';
 * import { mangaupdatesClient, NotFoundError } from '@/lib/mangaupdates';
 * import { prisma } from '@/lib/prisma';
 *
 * export async function processMangaUpdatesSync(job: Job) {
 *   const { seriesId } = job.data;
 *
 *   try {
 *     const metadata = await mangaupdatesClient.fetchSeriesMetadata(seriesId);
 *
 *     // Cache in database with 24h TTL
 *     await prisma.seriesCache.upsert({
 *       where: { mangaupdatesId: seriesId },
 *       create: {
 *         mangaupdatesId: seriesId,
 *         title: metadata.title,
 *         data: metadata as any,
 *         cachedAt: new Date(),
 *       },
 *       update: {
 *         title: metadata.title,
 *         data: metadata as any,
 *         cachedAt: new Date(),
 *       },
 *     });
 *
 *     return { success: true, seriesId };
 *   } catch (error) {
 *     if (error instanceof NotFoundError) {
 *       console.warn(`Series ${seriesId} not found on MangaUpdates`);
 *       return { success: false, notFound: true };
 *     }
 *     throw error; // Let BullMQ retry
 *   }
 * }
 *
 *
 * CACHING STRATEGY
 * ----------------
 *
 * Recommended cache TTLs:
 * - Series metadata: 24 hours (86400 seconds)
 * - Latest releases: 15-30 minutes (900-1800 seconds)
 * - Search results: 1 hour (3600 seconds)
 *
 * Redis example:
 *   await redis.set(`mu:series:${id}`, JSON.stringify(data), 'EX', 86400);
 *
 * Prisma example:
 *   const cached = await prisma.cache.findFirst({
 *     where: {
 *       key: `mu:series:${id}`,
 *       expiresAt: { gt: new Date() }
 *     }
 *   });
 */
