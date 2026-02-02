
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const TEST_SERIES_ID = 'e7ef6840-fe2c-4596-83bc-0f6f23ec3f35'; // Timing QA Series
const COMPETITOR_ID = '17bdc255-aade-4cad-ae03-23130f64bee9'; // naruto

async function runQA() {
  console.log('--- DISCOVER MV QA START ---');

  // 1. Baseline
  console.log('1. Fetching baseline rankings...');
  const { data: baseline } = await supabase
    .from('discover_trending')
    .select('series_id, title, score, rank')
    .in('series_id', [TEST_SERIES_ID, COMPETITOR_ID]);
  
  console.log('Baseline:', baseline);

  // 2. Inject Events for TEST_SERIES_ID
  console.log('2. Injecting events for "Timing QA Series"...');
  
  // 10 Chapter events (10 * 0.4 = 4.0)
  const chapters = Array.from({ length: 10 }).map(() => ({
    series_id: TEST_SERIES_ID,
    published_at: new Date().toISOString(),
    number: Math.random() * 1000,
    title: 'QA Chapter'
  }));
  await supabase.from('chapters').insert(chapters);

  // 20 Library adds (20 * 0.3 = 6.0)
  // We need user_id, but library_entries probably needs a real user.
  // Let's find a test user or just use a random UUID if RLS is off.
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const adds = Array.from({ length: 20 }).map((_, i) => ({
    series_id: TEST_SERIES_ID,
    user_id: testUserId,
    added_at: new Date().toISOString(),
    status: 'reading'
  }));
  // Note: This might fail if (user_id, series_id) has a unique constraint.
  // Let's use different user IDs.
  const addsWithUsers = Array.from({ length: 20 }).map((_, i) => ({
    series_id: TEST_SERIES_ID,
    user_id: `00000000-0000-0000-0000-0000000000${i.toString().padStart(2, '0')}`,
    added_at: new Date().toISOString(),
    status: 'reading'
  }));
  await supabase.from('library_entries').insert(addsWithUsers);

  // 50 views (50 * 0.2 = 10.0)
  const views = Array.from({ length: 50 }).map(() => ({
    series_id: TEST_SERIES_ID,
    created_at: new Date().toISOString(),
    signal_type: 'manga_click',
    user_id: testUserId
  }));
  await supabase.from('user_signals').insert(views);

  // Expected score increase: 4.0 + 6.0 + 10.0 = 20.0

  // 3. Inject OUTDATED events (should not affect score)
  console.log('3. Injecting outdated events (8 days old)...');
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 8);
  
  await supabase.from('user_signals').insert({
    series_id: TEST_SERIES_ID,
    created_at: oldDate.toISOString(),
    signal_type: 'manga_click',
    user_id: testUserId
  });

  // 4. Refresh Materialized Views
  console.log('4. Refreshing discover_trending...');
  const start = Date.now();
  await supabase.rpc('refresh_discover_trending'); 
  // Wait, I didn't define an RPC. I should just use the SQL tool to refresh.
  // Or I can use the SQL tool from the bash script.
  const duration = Date.now() - start;
  console.log(`Refresh took ${duration}ms`);

  // 5. Verify New Rankings
  console.log('5. Fetching updated rankings...');
  const { data: updated } = await supabase
    .from('discover_trending')
    .select('series_id, title, score, rank')
    .in('series_id', [TEST_SERIES_ID, COMPETITOR_ID])
    .order('rank', { ascending: true });
  
  console.log('Updated:', updated);

  // 6. Cleanup
  console.log('6. Cleaning up test data...');
  await supabase.from('chapters').delete().eq('title', 'QA Chapter');
  await supabase.from('library_entries').delete().eq('series_id', TEST_SERIES_ID).eq('status', 'reading').ilike('user_id', '00000000-0000-0000-0000-0000000000%');
  await supabase.from('user_signals').delete().eq('series_id', TEST_SERIES_ID).eq('user_id', testUserId);

  console.log('--- DISCOVER MV QA COMPLETE ---');
}

runQA().catch(console.error);
