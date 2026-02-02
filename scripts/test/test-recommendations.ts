import { getPersonalRecommendations } from '../../src/lib/recommendations';
import { supabaseAdmin } from '../../src/lib/supabase/admin';

interface Recommendation {
  id: string;
  title: string;
  genres: string[];
}

const TEST_USER_ID = '6a6d94df-7d54-484f-9003-8593bbb1b1d0'; // coretester
const ROMANCE_SERIES_ID = 'edd673ee-83db-4648-bf69-220075989ebf'; // kizoku no aoi seppun (Romance)

async function runTest() {
  console.log('--- Recommendation Engine QA Test ---');

  // 1. Setup: Add Romance series to library
  console.log('Setting up user library with Romance series...');
  await supabaseAdmin.from('library_entries').upsert({
    user_id: TEST_USER_ID,
    series_id: ROMANCE_SERIES_ID,
    source_url: 'https://mangadex.org/title/edd673ee-83db-4648-bf69-220075989ebf',
    source_name: 'mangadex',
    status: 'reading'
  });

  // 2. Test: Romance prioritization
  console.log('Testing Romance prioritization...');
  const recs: Recommendation[] = await getPersonalRecommendations(TEST_USER_ID);
  
  const romanceRecs = recs.filter((r: Recommendation) => r.genres.includes('Romance'));
  console.log(`Total recommendations: ${recs.length}`);
  console.log(`Romance recommendations: ${romanceRecs.length}`);

  if (romanceRecs.length > 0) {
    console.log('✅ QA Pass: Romance prioritized');
  } else {
    console.log('❌ QA Fail: Romance not prioritized');
  }

  // 3. Test: Exclusion of already read series
  console.log('Testing exclusion of already read series...');
  const topRec = recs[0];
  console.log(`Adding top recommendation "${topRec.title}" to library...`);
  
  await supabaseAdmin.from('library_entries').upsert({
    user_id: TEST_USER_ID,
    series_id: topRec.id,
    source_url: `https://test.com/${topRec.id}`,
    source_name: 'test',
    status: 'reading'
  });

  const recsAfter: Recommendation[] = await getPersonalRecommendations(TEST_USER_ID);
  const isExcluded = !recsAfter.some((r: Recommendation) => r.id === topRec.id);

  if (isExcluded) {
    console.log('✅ QA Pass: Already read series excluded');
  } else {
    console.log('❌ QA Fail: Already read series not excluded');
  }

  // 4. Test: Exclusion of COMPLETED series
  console.log('Testing exclusion of COMPLETED series...');
  const nextRec = recsAfter[0];
  await supabaseAdmin.from('library_entries').upsert({
    user_id: TEST_USER_ID,
    series_id: nextRec.id,
    source_url: `https://test.com/${nextRec.id}`,
    source_name: 'test',
    status: 'completed'
  });

  const recsAfterCompleted: Recommendation[] = await getPersonalRecommendations(TEST_USER_ID);
  const isCompletedExcluded = !recsAfterCompleted.some((r: Recommendation) => r.id === nextRec.id);

  if (isCompletedExcluded) {
    console.log('✅ QA Pass: COMPLETED series excluded');
  } else {
    console.log('❌ QA Fail: COMPLETED series not excluded');
  }

  // Cleanup
  console.log('Cleaning up test data...');
  await supabaseAdmin.from('library_entries').delete().eq('user_id', TEST_USER_ID);

  console.log('--- Test Complete ---');
}

runTest().catch(console.error);
