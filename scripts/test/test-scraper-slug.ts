import { MangaDexScraper } from '@/lib/scrapers/index';

async function testSlugResolution() {
  const scraper = new MangaDexScraper();
  
  // Test a known slug
  const slug = 'local-a-story-of-a-cannon-fodder-who-is-forced-to-be-the-villain-of-every-world';
  console.log(`Testing resolution for slug: ${slug}`);
  
  try {
    const result = await scraper.scrapeSeries(slug);
    console.log('Success!', result.title);
    console.log('UUID resolved:', result.sourceId !== slug);
  } catch (error) {
    console.error('Resolution failed:', error);
  }

  // Test a raw slug (without local- prefix)
  const rawSlug = 'solo-leveling';
  console.log(`\nTesting resolution for raw slug: ${rawSlug}`);
  try {
    const result = await scraper.scrapeSeries(rawSlug);
    console.log('Success!', result.title);
  } catch (error) {
    console.error('Resolution failed:', error);
  }
}

testSlugResolution();
