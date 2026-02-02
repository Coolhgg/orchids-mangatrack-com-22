import { MangaDexScraper } from '@/lib/scrapers/index';

async function testPagination() {
  const scraper = new MangaDexScraper();
  
  console.log('=== Testing MangaDex Pagination ===\n');

  // Test with Detective Conan (has many chapters)
  console.log('Test: Detective Conan (should have 1000+ chapters)');
  try {
    const result = await scraper.scrapeSeries('7f30dfc3-0b80-4dcc-a3b9-0cd746fac005');
    console.log(`  ✓ Title: ${result.title}`);
    console.log(`  ✓ Chapters fetched: ${result.chapters.length}`);
    if (result.chapters.length > 500) {
      console.log(`  ✓ PAGINATION WORKS! Fetched more than 500 chapters`);
    } else {
      console.log(`  ⚠ Pagination may not be working (only ${result.chapters.length} chapters)`);
    }
  } catch (error) {
    console.error('  ✗ Failed:', error instanceof Error ? error.message : error);
  }

  console.log('\n=== Test Complete ===');
}

testPagination().catch(console.error);
