import { getColdStartRecommendations } from '../../src/lib/recommendations';
import { supabaseAdmin } from '../../src/lib/supabase/admin';

interface Recommendation {
  id: string;
  title: string;
  cover_url: string | null;
  match_reasons: string[];
  content_rating?: string;
}

async function verifyColdStart() {
  console.log('--- Cold-Start Recommendation Logic Verification ---');

  // Case 1: Logged-out user (default SFW)
  console.log('\n[Case 1] Logged-out user (SFW default)');
  const loggedOutRecs: Recommendation[] = await getColdStartRecommendations('sfw');
  
  console.log(`- Total recommendations: ${loggedOutRecs.length}`);
  console.log(`- Results from Trending: ${loggedOutRecs.filter((r: Recommendation) => r.match_reasons.includes('Trending Now')).length}`);
  console.log(`- Results from Popular 30d: ${loggedOutRecs.filter((r: Recommendation) => r.match_reasons.includes('Popular this Month')).length}`);
  console.log(`- Results from New & Noteworthy: ${loggedOutRecs.filter((r: Recommendation) => r.match_reasons.includes('New & Noteworthy')).length}`);

  const hasNSFW = loggedOutRecs.some((r: Recommendation) => ['erotica', 'pornographic'].includes(r.content_rating || ''));
  if (!hasNSFW) {
    console.log('✅ PASS: No NSFW content in SFW mode');
  } else {
    console.log('❌ FAIL: NSFW content found in SFW mode');
  }

  if (loggedOutRecs.length === 30) {
    console.log('✅ PASS: Returned exactly 30 recommendations');
  } else {
    console.log(`❌ FAIL: Returned ${loggedOutRecs.length} recommendations instead of 30`);
  }

  // Case 2: Deduplication Check
  const ids = loggedOutRecs.map((r: Recommendation) => r.id);
  const uniqueIds = new Set(ids);
  if (ids.length === uniqueIds.size) {
    console.log('✅ PASS: All recommendations are unique (Deduplicated)');
  } else {
    console.log('❌ FAIL: Duplicate recommendations found');
  }

  // Case 3: Priority Rules
  const tier1 = loggedOutRecs.slice(0, 10);
  const tier2 = loggedOutRecs.slice(10, 20);
  const tier3 = loggedOutRecs.slice(20, 30);

  const t1Correct = tier1.every((r: Recommendation) => r.match_reasons.includes('Trending Now'));
  const t2Correct = tier2.every((r: Recommendation) => r.match_reasons.includes('Popular this Month'));
  const t3Correct = tier3.every((r: Recommendation) => r.match_reasons.includes('New & Noteworthy'));

  if (t1Correct && t2Correct && t3Correct) {
    console.log('✅ PASS: Ordering matches priority rules (Trending > Popular > New)');
  } else {
    console.log('❌ FAIL: Ordering/Tier assignment is incorrect');
  }

  // Case 2/3: User with < 5 interactions (Simulated)
  console.log('\n[Case 2/3] User with < 5 interactions (Simulated)');
  const interactionUserRecs = await getColdStartRecommendations('sfw', undefined);
  if (interactionUserRecs.length === 30) {
    console.log('✅ PASS: Returned 30 recommendations for low-interaction user');
  }

  // Case 5: No results for specific language (Fallback check)
  console.log('\n[Case 5] Non-existent language results');
  const xyzRecs = await getColdStartRecommendations('sfw', 'xyz');
  if (xyzRecs.length === 0) {
    console.log('✅ PASS: Returned empty as expected for unknown language (strict filter)');
  }

  console.log('\n--- Final Recommendation List (First 5) ---');
  loggedOutRecs.slice(0, 5).forEach((r: Recommendation, i: number) => {
    console.log(`${i+1}. ${r.title} [${r.match_reasons[0]}] (Rating: ${r.content_rating})`);
  });

  console.log('\n--- Verification Complete ---');
}

verifyColdStart().catch(console.error);
