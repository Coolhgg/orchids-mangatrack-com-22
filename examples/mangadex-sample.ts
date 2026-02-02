#!/usr/bin/env ts-node
/**
 * MangaDex API Sample Script - MangaTrack
 *
 * # run: npx ts-node examples/mangadex-sample.ts
 * # or:  bun run examples/mangadex-sample.ts
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

import { MangaDexClient, MangaDexError } from '../src/lib/mangadex/client';

async function main() {
  const client = new MangaDexClient({
    baseUrl: 'https://api.mangadex.org',
  });

  console.log('='.repeat(60));
  console.log('Fetching 30 latest English chapters...');
  console.log('='.repeat(60));

  const chaptersResponse = await client.fetchLatestChapters({
    limit: 30,
    translatedLanguage: ['en'],
    includeManga: true,
  });

  console.log(`\nTotal chapters available: ${chaptersResponse.total}`);
  console.log(`Fetched: ${chaptersResponse.data.length}\n`);

  for (const chapter of chaptersResponse.data) {
    const mangaRel = chapter.relationships.find((r) => r.type === 'manga');

    console.log({
      chapterId: chapter.id,
      mangaId: mangaRel?.id ?? 'N/A',
      chapterNumber: chapter.attributes.chapter ?? 'N/A',
      title: chapter.attributes.title ?? '(Untitled)',
      uploadedAt: chapter.attributes.publishAt,
    });
  }

  const firstChapter = chaptersResponse.data[0];
  const mangaRel = firstChapter?.relationships.find((r) => r.type === 'manga');
  if (mangaRel) {
    console.log('='.repeat(60));
    console.log(`Fetching manga metadata for: ${mangaRel.id}`);
    console.log('='.repeat(60));

    const metadata = await client.fetchMangaMetadata(mangaRel.id);

    console.log(`\nTitle: ${metadata.title}`);
    console.log(`Status: ${metadata.status}`);
    console.log(`Authors: ${metadata.authors.join(', ') || 'N/A'}`);
    console.log(`Artists: ${metadata.artists.join(', ') || 'N/A'}`);
    console.log(`Tags: ${metadata.tags.slice(0, 5).join(', ')}...`);
    console.log(`Cover URL: ${metadata.coverUrl}`);
    console.log(`AniList ID: ${metadata.anilistId ?? 'N/A'}`);
    console.log(`MAL ID: ${metadata.myanimelistId ?? 'N/A'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
