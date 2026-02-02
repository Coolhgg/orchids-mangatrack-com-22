import { prisma } from '../src/lib/prisma';
import { getMangaById } from '../src/lib/mangadex';
import { isValidCoverUrl } from '../src/lib/cover-resolver';

async function fixNullCovers() {
  console.log('Starting null cover fix migration...');

    const seriesWithNullCovers = await prisma.series.findMany({
      where: {
        OR: [
          { cover_url: null },
          { cover_url: '' },
        ],
      },
      include: {
        SeriesSource: {
          where: { source_name: 'mangadex' },
        },
      },
    });

    console.log(`Found ${seriesWithNullCovers.length} series with null covers`);

    let fixed = 0;
    let failed = 0;

    for (const series of seriesWithNullCovers) {
      const mangadexSource = series.SeriesSource[0];
    if (!mangadexSource) {
      console.log(`[SKIP] ${series.title} - No MangaDex source`);
      continue;
    }

    try {
      console.log(`[FETCH] ${series.title} (${mangadexSource.source_id})`);
      const manga = await getMangaById(mangadexSource.source_id);

      if (manga.cover_url && isValidCoverUrl(manga.cover_url)) {
        await prisma.$transaction([
          prisma.series.update({
            where: { id: series.id },
            data: { cover_url: manga.cover_url },
          }),
          prisma.seriesSource.update({
            where: {
              source_name_source_id: {
                source_name: 'mangadex',
                source_id: mangadexSource.source_id,
              },
            },
            data: {
              cover_url: manga.cover_url,
              cover_updated_at: new Date(),
            },
          }),
        ]);
        console.log(`[FIXED] ${series.title} -> ${manga.cover_url}`);
        fixed++;
      } else {
        console.log(`[NO_COVER] ${series.title} - MangaDex has no valid cover`);
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (error: any) {
      console.error(`[ERROR] ${series.title}: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nMigration complete: ${fixed} fixed, ${failed} failed`);
}

fixNullCovers()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
