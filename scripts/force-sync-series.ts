import { prisma } from "../src/lib/prisma";
import { scrapers } from "../src/lib/scrapers";
import { syncChapters } from "../src/lib/series-sync";
import { normalizeChapterNumberString } from "../src/lib/chapter-normalization";

const SERIES_ID = process.argv[2] || "3c88722c-e35e-4629-ab52-2dc08469ae2e";

async function main() {
  console.log("=== FORCE SYNC SERIES ===");
  console.log("Series ID:", SERIES_ID);

    const series = await prisma.series.findUnique({
      where: { id: SERIES_ID },
      include: {
        SeriesSource: {
          where: { source_status: { not: "broken" } },
          orderBy: { sync_priority: "asc" },
        },
      },
    });

    if (!series) {
      console.error("Series not found!");
      process.exit(1);
    }

    console.log("Title:", series.title);
    console.log("Sources:", series.SeriesSource.length);

    for (const source of series.SeriesSource) {
    const scraper = scrapers[source.source_name.toLowerCase()];
    if (!scraper) {
      console.log(`Skipping ${source.source_name} - no scraper`);
      continue;
    }

    try {
      console.log(`\n--- Scraping ${source.source_name} (${source.source_id}) ---`);

      const scrapedData = await scraper.scrapeSeries(source.source_id);

      console.log("Title from source:", scrapedData.title);
      console.log("Chapters scraped:", scrapedData.chapters.length);

      if (scrapedData.chapters.length === 0) {
        console.log("No chapters found");
        continue;
      }

      console.log("First chapter:", scrapedData.chapters[0]?.chapterNumber);
      console.log(
        "Last chapter:",
        scrapedData.chapters[scrapedData.chapters.length - 1]?.chapterNumber
      );

      console.log("\nSyncing chapters to database...");
      const synced = await syncChapters(
        SERIES_ID,
        source.source_id,
        source.source_name,
        scrapedData.chapters,
        { forceUpdate: true }
      );

      console.log("Chapters synced:", synced);

      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          source_chapter_count: scrapedData.chapters.length,
          last_success_at: new Date(),
          failure_count: 0,
          source_status: "active",
        },
      });

      console.log("Source updated successfully");
    } catch (error) {
      console.error(`Error with ${source.source_name}:`, error);

      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          failure_count: { increment: 1 },
          last_checked_at: new Date(),
        },
      });
    }
  }

  const totalChapters = await prisma.chapter.count({
    where: { series_id: SERIES_ID, deleted_at: null },
  });

  const maxChapter = await prisma.chapter.findFirst({
    where: { series_id: SERIES_ID, deleted_at: null },
    orderBy: { chapter_number: "desc" },
    select: { chapter_number: true },
  });

  await prisma.series.update({
    where: { id: SERIES_ID },
    data: {
      chapter_count: totalChapters,
      latest_chapter: maxChapter?.chapter_number,
      last_synced_at: new Date(),
    },
  });

  console.log("\n=== SYNC COMPLETE ===");
  console.log("Total chapters in DB:", totalChapters);
  console.log("Latest chapter:", maxChapter?.chapter_number);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
