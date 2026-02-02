/**
 * MangaDex Client Singleton Export - MangaTrack
 *
 * OPERATIONAL CONSTRAINTS:
 * - Respect robots.txt for every external host (mangadex.org, mangaupdates.com).
 * - Do not store or publicly serve copyrighted pages or images. For chapter images,
 *   store only `at-home` server URLs and serve them server-side only after checking
 *   licenses; do not mirror copyrighted content.
 * - Record `sourceAttribution` and `rawHtmlSnapshotPath` for any scraped or
 *   user-submitted link.
 * - Add UI label "Unverified source — user provided" for links from MangaUpdates
 *   or user paste, and require report/flag and trust scoring before automatic promotion.
 * - Add DMCA/terms/privacy pages before public link features are enabled in production.
 */

export {
  MangaDexClient,
  MangaDexError,
  MangaDexRateLimitError,
  MangaDexNetworkError,
  type MangaDexClientOptions,
  type MangaMetadata,
  type ChapterEntity,
  type MangaEntity,
  type CoverEntity,
  type CoverResult,
  type PaginatedResponse,
  type SingleResponse,
  type FetchLatestChaptersOptions,
  type LocalizedString,
  type Relationship,
} from './client';

export {
  MangaDexStatsClient,
  RateLimitError,
  StatsClientError,
  chunkArray,
  mangadexStatsClient,
  type MangaStats,
  type MangaDexStatsClientOptions,
} from './stats';

export {
  enrichSeriesWithStats,
  enrichSingleSeriesWithStats,
  isStatsEnrichmentEnabled,
  type StatsEnrichmentResult,
  type SeriesStatsInput,
} from './stats-enrichment';

import { MangaDexClient } from './client';

// TUNE: Swap base URL here for testing/staging environments
export const mangadexClient = new MangaDexClient({
  baseUrl: process.env.MANGADEX_API_BASE || 'https://api.mangadex.org',
});

/*
 * ============================================================================
 * USAGE EXAMPLES
 * ============================================================================
 *
 * // Fetch latest English chapters
 * const chapters = await mangadexClient.fetchLatestChapters({
 *   limit: 30,
 *   translatedLanguage: ['en'],
 *   includeManga: true,
 * });
 *
 * for (const chapter of chapters.data) {
 *   const mangaRel = chapter.relationships.find(r => r.type === 'manga');
 *   console.log({
 *     chapterId: chapter.id,
 *     mangaId: mangaRel?.id,
 *     chapter: chapter.attributes.chapter,
 *     title: chapter.attributes.title,
 *     publishAt: chapter.attributes.publishAt,
 *   });
 * }
 *
 * // Fetch manga metadata
 * const metadata = await mangadexClient.fetchMangaMetadata('a96676e5-8ae2-425e-b549-7f15dd34a6d8');
 * console.log(metadata.title, metadata.authors, metadata.coverUrl);
 *
 * // Fetch covers for multiple manga
 * const covers = await mangadexClient.fetchCovers(['uuid1', 'uuid2', 'uuid3']);
 * for (const cover of covers) {
 *   console.log(cover.mangaId, cover.url);
 * }
 *
 * ============================================================================
 */
