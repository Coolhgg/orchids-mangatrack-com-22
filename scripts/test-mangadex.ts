import { scrapers } from "../src/lib/scrapers";

async function main() {
  const scraper = scrapers.mangadex;
  const MANGADEX_ID = "a1c7c817-4e59-43b7-9365-09675a149a6f";

  console.log("Fetching One Piece chapters from MangaDex...");
  const data = await scraper.scrapeSeries(MANGADEX_ID);

  console.log("Title:", data.title);
  console.log("Total chapters:", data.chapters.length);

  if (data.chapters.length > 0) {
    console.log(
      "First 5:",
      data.chapters
        .slice(0, 5)
        .map((c) => c.chapterNumber)
        .join(", ")
    );
    console.log(
      "Last 5:",
      data.chapters
        .slice(-5)
        .map((c) => c.chapterNumber)
        .join(", ")
    );
  }
}

main().catch(console.error);
