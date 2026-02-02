import { prisma } from "../src/lib/prisma";
import { normalizeChapterNumberString } from "../src/lib/chapter-normalization";

async function cleanupDuplicateChapters() {
  console.log("=== CLEANING UP DUPLICATE CHAPTERS ===\n");

  // Find all series with duplicate chapter numbers (after normalization)
  const duplicates = await prisma.$queryRaw<
    Array<{
      series_id: string;
      title: string;
      chapter_number: string;
      count: number;
      ids: string[];
    }>
  >`
    WITH normalized AS (
      SELECT 
        c.id,
        c.series_id,
        c.chapter_number,
        c.chapter_title,
        c.published_at,
        s.title as series_title,
        CASE 
          WHEN c.chapter_number ~ '^-?[0-9]+\\.?0*$' 
          THEN REGEXP_REPLACE(c.chapter_number, '\\.0+$', '')
          ELSE c.chapter_number
        END as normalized_number
      FROM logical_chapters c
      JOIN series s ON s.id = c.series_id
      WHERE c.deleted_at IS NULL
    )
    SELECT 
      series_id,
      series_title as title,
      normalized_number as chapter_number,
      COUNT(*)::int as count,
      array_agg(id) as ids
    FROM normalized
    GROUP BY series_id, series_title, normalized_number
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 500
  `;

  console.log(`Found ${duplicates.length} groups of duplicate chapters\n`);

  // PERFORMANCE OPTIMIZATION: Fetch all relevant chapters in one query
  const allIds = duplicates.flatMap(d => d.ids);
  const allChapters = await prisma.logicalChapter.findMany({
    where: { id: { in: allIds } },
    include: {
      ChapterSource: {
        include: { SeriesSource: { select: { source_name: true } } },
      },
      UserChapterReadV2: true,
    },
    orderBy: { published_at: "asc" },
  });

  const chaptersMap = new Map(allChapters.map(c => [c.id, c]));

  let totalMerged = 0;
  let totalDeleted = 0;

  for (const dup of duplicates) {
    console.log(
      `\n--- ${dup.title}: Chapter ${dup.chapter_number} (${dup.count} duplicates) ---`
    );

    // Get full chapter data from map
    const chapters = dup.ids.map(id => chaptersMap.get(id)).filter(Boolean) as typeof allChapters;
    
    if (chapters.length < 2) continue;

    // Choose primary chapter (keep the one with most sources, or earliest)
    const primary = chapters.reduce((best, curr) => {
      if (curr.ChapterSource.length > best.ChapterSource.length) return curr;
      if (curr.ChapterSource.length === best.ChapterSource.length) {
        if (curr.published_at && best.published_at) {
          return curr.published_at < best.published_at ? curr : best;
        }
      }
      return best;
    });

    const others = chapters.filter((c) => c.id !== primary.id);

    console.log(`  Keeping: ${primary.id} (${primary.ChapterSource.length} sources)`);
    console.log(`  Deleting: ${others.map((o) => o.id).join(", ")}`);

    // Normalize the primary chapter's number
    const normalizedNum = normalizeChapterNumberString(
      parseFloat(primary.chapter_number || "0")
    );

    // Update primary to normalized number if different
    if (primary.chapter_number !== normalizedNum) {
      try {
        await prisma.logicalChapter.update({
          where: { id: primary.id },
          data: { chapter_number: normalizedNum },
        });
        console.log(
          `  Normalized: ${primary.chapter_number} -> ${normalizedNum}`
        );
      } catch (e) {
        console.log(`  Warning: Could not normalize (conflict exists)`);
      }
    }

    // Merge sources from duplicates into primary
    for (const other of others) {
      // Transfer chapter sources
      for (const source of other.ChapterSource) {
        const exists = await prisma.chapterSource.findUnique({
          where: {
            series_source_id_chapter_id: {
              series_source_id: source.series_source_id,
              chapter_id: primary.id,
            },
          },
        });

        if (!exists) {
          await prisma.chapterSource.update({
            where: { id: source.id },
            data: { chapter_id: primary.id },
          });
          console.log(`  Transferred source from ${source.SeriesSource.source_name}`);
        }
      }

        // Transfer user reads (UserChapterReadV2 for logical chapters)
        for (const read of other.UserChapterReadV2) {
          const existingRead = await prisma.userChapterReadV2.findUnique({
            where: {
              user_id_chapter_id: {
                user_id: read.user_id,
                chapter_id: primary.id,
              },
            },
          });

          if (!existingRead) {
            await prisma.userChapterReadV2.update({
              where: { id: read.id },
              data: { chapter_id: primary.id },
            });
            console.log(`  Transferred user read`);
          }
        }

      // Soft delete the duplicate
      await prisma.logicalChapter.update({
        where: { id: other.id },
        data: { deleted_at: new Date() },
      });
      totalDeleted++;
    }

    totalMerged++;
  }

  console.log(`\n=== CLEANUP COMPLETE ===`);
  console.log(`Groups merged: ${totalMerged}`);
  console.log(`Chapters soft-deleted: ${totalDeleted}`);

  // Also normalize remaining chapters with .00 format
  console.log(`\n=== NORMALIZING REMAINING CHAPTER NUMBERS ===`);
  
  const chaptersToNormalize = await prisma.$queryRaw<Array<{ id: string; chapter_number: string }>>`
    SELECT id, chapter_number 
    FROM logical_chapters 
    WHERE deleted_at IS NULL 
    AND chapter_number ~ '^\d+\.0+$'
  `;
  
  console.log(`Found ${chaptersToNormalize.length} chapters with .00 format`);
  
  for (const ch of chaptersToNormalize) {
    const normalized = normalizeChapterNumberString(parseFloat(ch.chapter_number));
    if (normalized !== ch.chapter_number) {
      try {
        await prisma.logicalChapter.update({
          where: { id: ch.id },
          data: { chapter_number: normalized }
        });
      } catch (e) {
        // Conflict - another chapter with this number exists, soft delete this one
        await prisma.logicalChapter.update({
          where: { id: ch.id },
          data: { deleted_at: new Date() }
        });
        console.log(`  Soft-deleted conflicting chapter ${ch.id} (${ch.chapter_number})`);
      }
    }
  }
  
  console.log(`Done normalizing chapter numbers`);
}

cleanupDuplicateChapters()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
