import { prisma, withRetry } from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";
import { ScrapedChapter } from "@/lib/scrapers";
import { updateSeriesBestCover } from "@/lib/cover-resolver";
import { normalizeChapter, normalizeChapterNumberString } from "./chapter-normalization";
import { recordActivityEvent, ActivityEventType } from "./catalog-tiers";

export type { ScrapedChapter };

export interface SyncOptions {
  forceUpdate?: boolean;
  skipLegacy?: boolean;
}

export async function syncChapters(
  seriesId: string,
  sourceId: string,
  sourceName: string,
  scrapedChapters: ScrapedChapter[],
  options: SyncOptions = {}
) {
  if (scrapedChapters.length === 0) return 0;

  console.log(`[Sync] Starting sync for ${seriesId} with ${scrapedChapters.length} chapters from ${sourceName}`);

  // 1. Get the source record
  const seriesSource = await prisma.seriesSource.findUnique({
    where: { source_name_source_id: { source_name: sourceName, source_id: sourceId } },
  });

  if (!seriesSource) {
    throw new Error(`Series source ${sourceName}:${sourceId} not found`);
  }

  console.log(`[Sync] Found seriesSource: ${seriesSource.id}`);

  // 2. Perform operations in batches with proper transactions
  let newChaptersCount = 0;
  let maxChapterNumber = new Prisma.Decimal(0);
  const BATCH_SIZE = 25;
  const NO_NUMBER_SENTINEL = new Prisma.Decimal(-1);

  for (let i = 0; i < scrapedChapters.length; i += BATCH_SIZE) {
    const batch = scrapedChapters.slice(i, i + BATCH_SIZE);
    const eventsToRecord: { type: ActivityEventType; source?: string }[] = [];
    
    console.log(`[Sync] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(scrapedChapters.length / BATCH_SIZE)} (${batch.length} chapters)`);
    
    // Process each chapter in a transaction to ensure FK integrity
for (const ch of batch) {
        try {
          const normalized = normalizeChapter(ch.chapterLabel || `Chapter ${ch.chapterNumber}`, ch.chapterTitle);
          const chNumDecimal = normalized.number !== null ? new Prisma.Decimal(normalized.number) : NO_NUMBER_SENTINEL;
          // Use the new normalizeChapterNumberString for consistent string formatting
          const chNum = normalizeChapterNumberString(normalized.number);
          const chSlug = normalized.slug;

        if (chNumDecimal.greaterThan(maxChapterNumber)) {
          maxChapterNumber = chNumDecimal;
        }

        // Use a transaction to ensure chapter + chapterSource are created atomically
        const result = await prisma.$transaction(async (tx) => {
          // Step 1: Create or find the logical chapter
          let chapter = await tx.logicalChapter.findUnique({
            where: {
              series_id_chapter_number: {
                series_id: seriesId,
                chapter_number: chNum,
              },
            },
          });

          const isNewChapter = !chapter;
          
          if (chapter) {
            // Update existing chapter
            chapter = await tx.logicalChapter.update({
              where: { id: chapter.id },
              data: {
                chapter_title: ch.chapterTitle || undefined,
                published_at: ch.publishedAt || undefined,
                chapter_slug: chSlug || undefined,
              },
            });
            console.log(`[Sync] Updated logical chapter ${chNum} with ID ${chapter.id}`);
          } else {
            // Create new logical chapter
            chapter = await tx.logicalChapter.create({
              data: {
                series_id: seriesId,
                chapter_number: chNum,
                chapter_slug: chSlug || "",
                chapter_title: ch.chapterTitle,
                published_at: ch.publishedAt || null,
              },
            });
            console.log(`[Sync] Created logical chapter ${chNum} with ID ${chapter.id}`);
          }

          // Step 2: Create or update ChapterSource - within same transaction
          console.log(`[Sync] Looking for ChapterSource with series_source_id=${seriesSource.id}, chapter_id=${chapter.id}`);
          
          const existingSource = await tx.chapterSource.findUnique({
            where: {
              series_source_id_chapter_id: {
                series_source_id: seriesSource.id,
                chapter_id: chapter.id,
              },
            },
          });

          if (existingSource) {
            console.log(`[Sync] Updating existing ChapterSource ${existingSource.id}`);
            await tx.chapterSource.update({
              where: { id: existingSource.id },
              data: {
                source_chapter_url: ch.chapterUrl,
                chapter_title: ch.chapterTitle,
                source_published_at: ch.publishedAt || undefined,
                is_available: true,
              },
            });
          } else {
            console.log(`[Sync] Creating new ChapterSource for chapter ${chapter.id}`);
            await tx.chapterSource.create({
              data: {
                chapter_id: chapter.id,
                series_source_id: seriesSource.id,
                source_name: sourceName,
                source_chapter_url: ch.chapterUrl,
                chapter_title: ch.chapterTitle,
                source_published_at: ch.publishedAt || null,
                detected_at: new Date(),
              },
            });
            console.log(`[Sync] Created ChapterSource for chapter ${chapter.id}`);
          }

          // Step 3: Keep legacy Chapter model in sync (within transaction)
          if (!options.skipLegacy) {
            const existingLegacy = await tx.legacyChapter.findUnique({
              where: {
                series_source_id_chapter_number: {
                  series_source_id: seriesSource.id,
                  chapter_number: chNumDecimal,
                },
              },
            });

            if (existingLegacy) {
              await tx.legacyChapter.update({
                where: { id: existingLegacy.id },
                data: {
                  chapter_title: ch.chapterTitle,
                  chapter_url: ch.chapterUrl,
                  published_at: ch.publishedAt || undefined,
                  is_available: true,
                },
              });
            } else {
              await tx.legacyChapter.create({
                data: {
                  series_id: seriesId,
                  series_source_id: seriesSource.id,
                  chapter_number: chNumDecimal,
                  chapter_title: ch.chapterTitle,
                  chapter_url: ch.chapterUrl,
                  published_at: ch.publishedAt || null,
                  discovered_at: new Date(),
                },
              });
            }
          }

          return { isNewChapter };
        }, {
          timeout: 30000, // 30 second timeout per chapter transaction
          isolationLevel: 'ReadCommitted'
        });

        // Track: First Appearance (outside transaction)
        if (result.isNewChapter) {
          eventsToRecord.push({ type: 'chapter_detected' });
        }

        newChaptersCount++;
      } catch (err) {
        const error = err as Error;
        console.error(`[Sync] Error syncing chapter ${ch.chapterNumber}:`, error.message);
        if ('code' in error) {
          console.error(`[Sync] Prisma error code:`, (error as any).code);
        }
        if ('meta' in error) {
          console.error(`[Sync] Prisma error meta:`, JSON.stringify((error as any).meta));
        }
        // Continue with next chapter instead of failing entire batch
      }
    }

    // Record events OUTSIDE transaction to avoid timeouts
    for (const event of eventsToRecord) {
      await recordActivityEvent(seriesId, event.type, event.source).catch(err => 
        console.error(`[Sync] Failed to record activity event ${event.type} for ${seriesId}:`, err)
      );
    }
  }

  // 3. Update source and series metadata (Final state)
  try {
    await prisma.seriesSource.update({
      where: { id: seriesSource.id },
      data: {
        last_success_at: new Date(),
        last_checked_at: new Date(),
        failure_count: 0,
      },
    });

    const series = await prisma.series.findUnique({ where: { id: seriesId } });
    if (series) {
      const currentMax = series.latest_chapter ? new Prisma.Decimal(series.latest_chapter) : new Prisma.Decimal(0);
      if (maxChapterNumber.greaterThan(currentMax)) {
        await prisma.series.update({
          where: { id: seriesId },
          data: {
            latest_chapter: maxChapterNumber,
            last_chapter_at: new Date(),
            updated_at: new Date(),
          },
        });
      }
    }
  } catch (err) {
    console.error(`[Sync] Failed to update metadata for ${seriesId}:`, err);
  }

  // 4. Post-sync optimizations (Outside transaction)
  try {
    await updateSeriesBestCover(seriesId);
  } catch (err) {
    console.error(`[Sync] Failed to update best cover for ${seriesId}:`, err);
  }

  console.log(`[Sync] Completed sync for ${seriesId}: ${newChaptersCount} chapters synced`);
  return newChaptersCount;
}
