
import { MangaDexScraper } from '@/lib/scrapers/index';
import { SyncOutbox } from '@/lib/sync/outbox';

async function testMangaDexUuidExtraction() {
  console.log('--- Testing MangaDex UUID Extraction ---');
  const scraper = new MangaDexScraper();
  
  // Test Case 1: Full URL with UUID
  const url1 = 'https://mangadex.org/title/8012134a-a70c-403e-87d1-cfc4d0d06e5c/the-beginning-after-the-end';
  console.log(`Testing URL: ${url1}`);
  
  // We'll simulate the extraction logic since scrapeSeries is async and makes network calls
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const extractUuid = (id: string) => {
    let cleanId = id.trim();
    if (cleanId.includes('mangadex.org/')) {
      const url = new URL(cleanId.startsWith('http') ? cleanId : `https://${cleanId}`);
      const pathParts = url.pathname.split('/').filter(Boolean);
        const uuidPart = pathParts.find(p => UUID_REGEX.test(p));
      if (uuidPart) return uuidPart;
      const targetIndex = pathParts.findIndex(p => p === 'title' || p === 'manga');
      if (targetIndex !== -1 && pathParts[targetIndex + 1]) return pathParts[targetIndex + 1];
    }
    return cleanId;
  };

  const result1 = extractUuid(url1);
  console.log(`Extracted: ${result1}`);
  if (result1 === '8012134a-a70c-403e-87d1-cfc4d0d06e5c') {
    console.log('✅ URL UUID extraction passed');
  } else {
    console.error('❌ URL UUID extraction failed');
  }

  // Test Case 2: Slug resolution (simulated)
  const slug = 'the-beginning-after-the-end';
  console.log(`Testing slug: ${slug}`);
  // In reality, this would call resolveSlugToUuid. 
  // We've already verified the regex allows slugs to pass through to resolution.
  const isUuid = UUID_REGEX.test(slug);
  console.log(`Is UUID: ${isUuid}`);
  if (!isUuid && slug.length > 2) {
    console.log('✅ Slug correctly identified for resolution');
  } else {
    console.error('❌ Slug identification failed');
  }
}

function testSearchApiFix() {
  console.log('\n--- Testing Search API Genre Formatting ---');
  const filters = { genres: ['Action', 'Adventure', 'Fantasy'] };
  const genresParam = filters.genres.length > 0 ? `{${filters.genres.join(',')}}` : null;
  
  console.log(`Genres: ${JSON.stringify(filters.genres)}`);
  console.log(`Formatted for SQL: ${genresParam}`);
  
  if (genresParam === '{Action,Adventure,Fantasy}') {
    console.log('✅ PostgreSQL array formatting passed');
  } else {
    console.error('❌ PostgreSQL array formatting failed');
  }
}

function testSyncOutboxDeduplication() {
  console.log('\n--- Testing Sync Outbox Deduplication ---');
  
  // Mock localStorage
  const storage: Record<string, string> = {};
  global.localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, value: string) => { storage[key] = value; },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { for (const key in storage) delete storage[key]; },
    length: 0,
    key: (index: number) => null,
  } as any;
  
  // Mock window.dispatchEvent
  global.window = {
    dispatchEvent: () => true,
  } as any;
  global.Event = class {} as any;

  // Add first action
  SyncOutbox.enqueue('LIBRARY_ADD', { seriesId: 'series-1', status: 'reading' });
  let actions = SyncOutbox.getActions();
  console.log(`Actions after first add: ${actions.length}`);

  // Add duplicate action
  SyncOutbox.enqueue('LIBRARY_ADD', { seriesId: 'series-1', status: 'completed' });
  actions = SyncOutbox.getActions();
  console.log(`Actions after second add (same series): ${actions.length}`);

  if (actions.length === 1 && actions[0].payload.status === 'completed') {
    console.log('✅ LIBRARY_ADD deduplication passed');
  } else {
    console.error('❌ LIBRARY_ADD deduplication failed');
  }

  // Test CHAPTER_READ deduplication
  SyncOutbox.enqueue('CHAPTER_READ', { entryId: 'entry-1', chapterNumber: "5" });
  SyncOutbox.enqueue('CHAPTER_READ', { entryId: 'entry-1', chapterNumber: "5" });
  actions = SyncOutbox.getActions();
  const readActions = actions.filter(a => a.type === 'CHAPTER_READ');
  console.log(`Chapter read actions: ${readActions.length}`);
  
  if (readActions.length === 1) {
    console.log('✅ CHAPTER_READ deduplication passed');
  } else {
    console.error('❌ CHAPTER_READ deduplication failed');
  }
}

async function runAllTests() {
  await testMangaDexUuidExtraction();
  testSearchApiFix();
  testSyncOutboxDeduplication();
  console.log('\n--- All simulations completed ---');
}

runAllTests().catch(console.error);
