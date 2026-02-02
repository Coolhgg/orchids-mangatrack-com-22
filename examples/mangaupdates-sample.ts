#!/usr/bin/env bun
/**
 * MangaUpdates API Sample Script - MangaTrack
 *
 * # run: bun run examples/mangaupdates-sample.ts
 *
 * Use official API V1 — do not scrape.
 */

import { MangaUpdatesClient } from '../src/lib/mangaupdates/client';

async function main() {
  const client = new MangaUpdatesClient({
    baseUrl: 'https://api.mangaupdates.com/v1',
    requestsPerSecond: 1,
  });

  console.log('='.repeat(60));
  console.log('MangaUpdates API V1 Sample');
  console.log('='.repeat(60));

  // 1. Search for a series
  console.log('\n[1] Searching for "One Piece"...');
  const searchResults = await client.searchSeries('One Piece', 1);

  console.log(`Found ${searchResults.length} results:`);
  for (const result of searchResults.slice(0, 5)) {
    console.log(`  - ${result.title} (ID: ${result.series_id}, Rating: ${result.bayesian_rating})`);
  }

  // 2. Fetch series metadata
  if (searchResults.length > 0) {
    const firstResult = searchResults[0];
    console.log(`\n[2] Fetching metadata for: ${firstResult.title} (ID: ${firstResult.series_id})...`);

    const metadata = await client.fetchSeriesMetadata(firstResult.series_id);

    console.log(`Title: ${metadata.title}`);
    console.log(`Rating: ${metadata.bayesian_rating}`);
    console.log(`Status: ${metadata.status}`);
    console.log(`Year: ${metadata.year}`);
    console.log(`Genres: ${metadata.genres.map((g) => g.genre).join(', ')}`);
    console.log(`Authors: ${metadata.authors.map((a) => a.name).join(', ')}`);
    console.log(`Description: ${metadata.description.slice(0, 200)}...`);
  }

  // 3. Poll latest releases
  console.log('\n[3] Polling latest releases (past 7 days, page 1)...');
  const releases = await client.pollLatestReleases({ days: 7, page: 1 });

  console.log(`Found ${releases.length} releases:`);
  for (const release of releases.slice(0, 10)) {
    console.log(`  - ${release.title} Ch.${release.chapter ?? 'N/A'} (${release.release_date}) [Series: ${release.series.title}]`);
  }

  // 4. Check rate limit status
  console.log('\n[4] Rate limit status:');
  const status = client.getRateLimitStatus();
  console.log(`  Requests/sec: ${status.requestsPerSecond}`);
  console.log(`  Queue size: ${status.queueSize}`);
  console.log(`  Is paused: ${status.isPaused}`);

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
