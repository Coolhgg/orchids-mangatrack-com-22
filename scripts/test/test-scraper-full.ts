import { MangaDexScraper } from '@/lib/scrapers/index';

async function testMangaDexScraper() {
  const scraper = new MangaDexScraper();
  
  console.log('=== Testing MangaDex Scraper ===\n');

  // Test 1: Direct UUID (One Piece)
  console.log('Test 1: Direct UUID (One Piece)');
  try {
    const result = await scraper.scrapeSeries('a1c7c817-4e59-43b7-9365-09675a149a6f');
    console.log(`  ✓ Title: ${result.title}`);
    console.log(`  ✓ Chapters fetched: ${result.chapters.length}`);
    if (result.chapters.length > 0) {
      console.log(`  ✓ First chapter: ${result.chapters[0].chapterNumber}`);
      console.log(`  ✓ Last chapter: ${result.chapters[result.chapters.length - 1].chapterNumber}`);
    }
  } catch (error) {
    console.error('  ✗ Failed:', error instanceof Error ? error.message : error);
  }

  // Test 2: Slug resolution (Solo Leveling)
  console.log('\nTest 2: Slug resolution (Solo Leveling)');
  try {
    const result = await scraper.scrapeSeries('solo-leveling');
    console.log(`  ✓ Title: ${result.title}`);
    console.log(`  ✓ Chapters fetched: ${result.chapters.length}`);
  } catch (error) {
    console.error('  ✗ Failed:', error instanceof Error ? error.message : error);
  }

  // Test 3: Another popular manga (Chainsaw Man)
  console.log('\nTest 3: Direct UUID (Chainsaw Man)');
  try {
    const result = await scraper.scrapeSeries('a77742b1-befd-49a4-bff5-1f8dc94091ec');
    console.log(`  ✓ Title: ${result.title}`);
    console.log(`  ✓ Chapters fetched: ${result.chapters.length}`);
  } catch (error) {
    console.error('  ✗ Failed:', error instanceof Error ? error.message : error);
  }

  console.log('\n=== Tests Complete ===');
}

testMangaDexScraper().catch(console.error);
