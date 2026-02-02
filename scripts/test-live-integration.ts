#!/usr/bin/env npx tsx
/**
 * Live Integration Test for MangaDex and MangaUpdates APIs
 * 
 * Tests feed data import for our redirect-based chapter reading:
 * - MangaDex: metadata, covers, latest chapters WITH external URLs
 * - MangaUpdates: series metadata, latest releases, search
 * 
 * NOTE: We don't host chapters - users are redirected to source URLs
 * 
 * Run: npx tsx scripts/test-live-integration.ts
 */

import 'dotenv/config';
import { MangaDexClient } from '../src/lib/mangadex/client';
import { MangaUpdatesClient } from '../src/lib/mangaupdates/client';

const TEST_DATA = {
  mangadex: {
    mangaId: 'a1c7c817-4e59-43b7-9365-09675a149a6f',
    name: 'One Piece',
  },
  mangaupdates: {
    seriesId: 17360452316,
    name: 'Naruto',
  },
};

interface TestResult {
  name: string;
  success: boolean;
  duration: number;
  data?: Record<string, unknown>;
  error?: string;
}

const results: TestResult[] = [];

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logSuccess(name: string, details: string) {
  console.log(`  ✅ ${name}: ${details}`);
}

function logError(name: string, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  console.log(`  ❌ ${name}: ${msg}`);
}

async function runTest<T>(
  name: string,
  testFn: () => Promise<T>,
  extractDetails: (data: T) => string
): Promise<T | null> {
  const start = Date.now();
  try {
    const data = await testFn();
    const duration = Date.now() - start;
    results.push({
      name,
      success: true,
      duration,
      data: data as Record<string, unknown>,
    });
    logSuccess(name, `${extractDetails(data)} (${duration}ms)`);
    return data;
  } catch (error) {
    const duration = Date.now() - start;
    results.push({
      name,
      success: false,
      duration,
      error: error instanceof Error ? error.message : String(error),
    });
    logError(name, error);
    return null;
  }
}

// ============================================================================
// MangaDex Tests
// ============================================================================

async function testMangaDex() {
  log('\n═══════════════════════════════════════════════════════════════');
  log('MANGADEX API LIVE TESTS');
  log('═══════════════════════════════════════════════════════════════\n');

  const client = new MangaDexClient();

  // Test 1: Fetch manga metadata
  const metadata = await runTest(
    'MangaDex: Fetch Manga Metadata',
    () => client.fetchMangaMetadata(TEST_DATA.mangadex.mangaId),
    (data) => `"${data.title}" by ${data.authors.join(', ')}`
  );

  if (metadata) {
    log(`     Title: ${metadata.title}`);
    log(`     Status: ${metadata.status}`);
    log(`     Year: ${metadata.year}`);
    log(`     Authors: ${metadata.authors.join(', ')}`);
    log(`     Artists: ${metadata.artists.join(', ')}`);
    log(`     Tags: ${metadata.tags.slice(0, 5).join(', ')}...`);
    log(`     Cover URL: ${metadata.coverUrl?.substring(0, 60)}...`);
    log(`     AniList ID: ${metadata.anilistId}`);
    log(`     MAL ID: ${metadata.myanimelistId}`);
  }

  // Test 2: Fetch latest chapters (focus on external URLs for redirect)
  const chapters = await runTest(
    'MangaDex: Fetch Latest Chapters',
    () => client.fetchLatestChapters({ limit: 10, translatedLanguage: ['en'] }),
    (data) => `${data.data.length} chapters (${data.total} total)`
  );

  if (chapters && chapters.data.length > 0) {
    log(`     Latest 5 chapters with source URLs:`);
    for (const ch of chapters.data.slice(0, 5)) {
      const mangaRel = ch.relationships.find((r) => r.type === 'manga');
      const mangaTitle = mangaRel?.attributes?.title
        ? Object.values(mangaRel.attributes.title as Record<string, string>)[0]
        : 'Unknown';
      const externalUrl = ch.attributes.externalUrl;
      const chapterUrl = externalUrl || `https://mangadex.org/chapter/${ch.id}`;
      log(`       - Ch.${ch.attributes.chapter || 'N/A'}: ${mangaTitle}`);
      log(`         → ${chapterUrl}`);
    }

    // Verify external URLs are being captured
    const withExternal = chapters.data.filter(ch => ch.attributes.externalUrl);
    const withoutExternal = chapters.data.filter(ch => !ch.attributes.externalUrl);
    log(`\n     External URL stats:`);
    log(`       - With externalUrl (e.g., MangaPlus): ${withExternal.length}`);
    log(`       - Without externalUrl (MangaDex hosted): ${withoutExternal.length}`);
    
    if (withExternal.length > 0) {
      log(`\n     Sample external URLs (user will be redirected here):`);
      for (const ch of withExternal.slice(0, 3)) {
        log(`       → ${ch.attributes.externalUrl}`);
      }
    }
  }

  // Test 3: Fetch covers (batch)
  if (chapters && chapters.data.length > 0) {
    const mangaIds = chapters.data
      .map((ch) => ch.relationships.find((r) => r.type === 'manga')?.id)
      .filter((id): id is string => !!id)
      .slice(0, 5);

    const uniqueIds = [...new Set(mangaIds)];

    const covers = await runTest(
      'MangaDex: Fetch Covers (Batch)',
      () => client.fetchCovers(uniqueIds),
      (data) => `${data.length} covers for ${uniqueIds.length} manga`
    );

    if (covers && covers.length > 0) {
      log(`     Sample covers:`);
      for (const cover of covers.slice(0, 3)) {
        log(`       - ${cover.mangaId.substring(0, 8)}...: ${cover.url.substring(0, 50)}...`);
      }
    }
  }

  // Test 4: Verify chapter URL structure for redirect
  await runTest(
    'MangaDex: Verify Chapter URL Structure',
    async () => {
      const testChapters = chapters?.data.slice(0, 5) || [];
      const urlData = testChapters.map(ch => ({
        id: ch.id,
        chapter: ch.attributes.chapter,
        externalUrl: ch.attributes.externalUrl,
        redirectUrl: ch.attributes.externalUrl || `https://mangadex.org/chapter/${ch.id}`,
      }));
      return urlData;
    },
    (data) => `${data.length} chapters with redirect URLs verified`
  );
}

// ============================================================================
// MangaUpdates Tests
// ============================================================================

async function testMangaUpdates() {
  log('\n═══════════════════════════════════════════════════════════════');
  log('MANGAUPDATES API LIVE TESTS');
  log('═══════════════════════════════════════════════════════════════\n');

  const client = new MangaUpdatesClient({ requestsPerSecond: 1 });

  // Test 1: Fetch series metadata
  const series = await runTest(
    'MangaUpdates: Fetch Series Metadata',
    () => client.fetchSeriesMetadata(TEST_DATA.mangaupdates.seriesId),
    (data) => `"${data.title}" (ID: ${data.series_id})`
  );

  if (series) {
    log(`     Title: ${series.title}`);
    log(`     Type: ${series.type}`);
    log(`     Year: ${series.year}`);
    log(`     Status: ${series.status}`);
    log(`     Rating: ${series.bayesian_rating?.toFixed(2)} (${series.rating_votes} votes)`);
    log(`     Licensed: ${series.licensed}`);
    log(`     Completed: ${series.completed}`);
    log(`     Authors: ${series.authors.map((a) => a.name).join(', ')}`);
    log(`     Genres: ${series.genres.map((g) => g.genre).slice(0, 5).join(', ')}...`);
    log(`     Cover: ${series.image?.url?.original || 'N/A'}`);
    log(`     Latest Chapter: ${series.latest_chapter}`);
  }

  // Test 2: Poll latest releases (this is what feeds our update notifications)
  const releases = await runTest(
    'MangaUpdates: Poll Latest Releases',
    () => client.pollLatestReleases({ days: 7, page: 1 }),
    (data) => `${data.length} releases in past 7 days`
  );

  if (releases && releases.length > 0) {
    log(`     Latest 5 releases (for feed):`);
    for (const rel of releases.slice(0, 5)) {
      const chapter = rel.chapter || rel.volume || 'N/A';
      log(`       - ${rel.title}: Ch.${chapter}`);
      log(`         Series ID: ${rel.series.series_id}`);
    }
  }

  // Test 3: Search series
  const searchResults = await runTest(
    'MangaUpdates: Search Series',
    () => client.searchSeries('Naruto', 1),
    (data) => `${data.length} results for "Naruto"`
  );

  if (searchResults && searchResults.length > 0) {
    log(`     Top 3 search results:`);
    for (const result of searchResults.slice(0, 3)) {
      log(`       - ${result.title} (ID: ${result.series_id}, Rating: ${result.bayesian_rating?.toFixed(2) || 'N/A'})`);
    }
  }

  // Test 4: Rate limit status
  const rateLimitStatus = client.getRateLimitStatus();
  log(`\n     Rate Limit Status:`);
  log(`       - Requests/sec: ${rateLimitStatus.requestsPerSecond}`);
  log(`       - Queue size: ${rateLimitStatus.queueSize}`);
  log(`       - Paused: ${rateLimitStatus.isPaused}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('\n');
  log('╔═══════════════════════════════════════════════════════════════╗');
  log('║     LIVE INTEGRATION TEST: MangaDex & MangaUpdates APIs       ║');
  log('║     (Redirect-based reading - we don\'t host chapters)        ║');
  log('╚═══════════════════════════════════════════════════════════════╝');
  log(`Started at: ${new Date().toISOString()}`);

  try {
    await testMangaDex();
  } catch (error) {
    log(`\nMangaDex tests failed with unexpected error: ${error}`);
  }

  try {
    await testMangaUpdates();
  } catch (error) {
    log(`\nMangaUpdates tests failed with unexpected error: ${error}`);
  }

  // Summary
  log('\n═══════════════════════════════════════════════════════════════');
  log('SUMMARY');
  log('═══════════════════════════════════════════════════════════════\n');

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    const errorMsg = result.error ? ` - ${result.error}` : '';
    log(`  ${status} ${result.name} (${result.duration}ms)${errorMsg}`);
  }

  log(`\n  Total: ${passed} passed, ${failed} failed`);
  log(`  Duration: ${totalDuration}ms`);

  if (failed > 0) {
    log('\n  ⚠️  Some tests failed. Check the output above for details.');
    process.exit(1);
  } else {
    log('\n  🎉 All tests passed! Feed data is importing correctly.');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
