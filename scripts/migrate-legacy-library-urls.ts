import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  console.log('Starting legacy library URL migration...');

  // 1. Fix entries that have a SeriesSource already linked to the series
  const fixableViaSource = await prisma.$queryRaw`
    UPDATE library_entries le
    SET source_url = ss.source_url,
        source_name = ss.source_name
    FROM series_sources ss
    WHERE le.series_id = ss.series_id
      AND le.source_url IS NULL
    RETURNING le.id;
  `;
  console.log(`Fixed ${Array.isArray(fixableViaSource) ? fixableViaSource.length : 0} entries via existing SeriesSource.`);

  // 2. Fix entries via MangaDex ID
  const fixableViaMangaDex = await prisma.$queryRaw`
    UPDATE library_entries le
    SET source_url = 'https://mangadex.org/title/' || s.mangadex_id,
        source_name = 'mangadex'
    FROM series s
    WHERE le.series_id = s.id
      AND le.source_url IS NULL
      AND s.mangadex_id IS NOT NULL
    RETURNING le.id;
  `;
  console.log(`Fixed ${Array.isArray(fixableViaMangaDex) ? fixableViaMangaDex.length : 0} entries via MangaDex ID.`);

  // 3. Create SeriesSource for entries that now have a URL but no source
  const entriesWithUrlNoSource = await prisma.$queryRaw`
    SELECT le.id, le.source_url, le.source_name, le.imported_title, le.series_id
    FROM library_entries le
    LEFT JOIN series_sources ss ON le.source_url = ss.source_url
    WHERE le.source_url IS NOT NULL AND ss.id IS NULL;
  `;

  if (Array.isArray(entriesWithUrlNoSource) && entriesWithUrlNoSource.length > 0) {
    console.log(`Creating ${entriesWithUrlNoSource.length} missing SeriesSource records...`);
    for (const entry of entriesWithUrlNoSource) {
      const sourceId = entry.source_url.split('/').pop() || entry.source_url;
      await prisma.seriesSource.upsert({
        where: {
          source_name_source_id: {
            source_name: entry.source_name,
            source_id: sourceId
          }
        },
        update: {
          series_id: entry.series_id
        },
        create: {
          source_name: entry.source_name,
          source_id: sourceId,
          source_url: entry.source_url,
          source_title: entry.imported_title,
          series_id: entry.series_id,
          sync_priority: 'HOT'
        }
      });
    }
  }

  // 4. Handle remaining Orphans (True UNRESOLVED)
  // These are the 252 entries. We mark them as FAILED so they show up in the UI as needing attention.
  const orphans = await prisma.$executeRaw`
    UPDATE library_entries
    SET metadata_status = 'FAILED',
        source_url = 'RECOVERY_PENDING'
    WHERE source_url IS NULL AND metadata_status = 'PENDING';
  `;
  console.log(`Marked ${orphans} unrecoverable orphans as FAILED.`);

  console.log('Migration complete.');
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
