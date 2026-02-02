import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifyTrending() {
  console.log('--- STARTING TRENDING & DISCOVER QA ---');

  const startTime = Date.now();
  const response = await fetch('http://localhost:3000/api/series/trending?period=week&limit=50');
  const endTime = Date.now();
  const duration = endTime - startTime;

  if (!response.ok) {
    console.error('API Error:', await response.text());
    return;
  }

  const data = await response.json();
  const results = data.results;

  console.log(`\n1. PERFORMANCE METRICS`);
  console.log(`- Response Time: ${duration}ms`);
  console.log(`- Status: ${duration < 300 ? 'PASS (<300ms)' : 'FAIL (>300ms)'}`);

  console.log(`\n2. TIER FILTER VERIFICATION`);
  const { data: allSeries } = await supabase.from('series').select('id, catalog_tier');
  const tierMap = new Map(allSeries?.map(s => [s.id, s.catalog_tier]));

  const invalidTiers = results.filter((s: any) => tierMap.get(s.id) !== 'A');
  console.log(`- Series in results: ${results.length}`);
  console.log(`- Non-Tier A series found: ${invalidTiers.length}`);
  if (invalidTiers.length > 0) {
    console.log(`  FAIL: Found series with tiers: ${[...new Set(invalidTiers.map((s: any) => tierMap.get(s.id)))]}`);
  } else {
    console.log(`  PASS: All results are Tier A`);
  }

  console.log(`\n3. DEAD MANGA EXCLUSION`);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  
  const deadMangaInResults = results.filter((s: any) => {
    if (!s.last_chapter_at) return true;
    return new Date(s.last_chapter_at) < ninetyDaysAgo;
  });

  console.log(`- Dead manga found in results: ${deadMangaInResults.length}`);
  if (deadMangaInResults.length > 0) {
    console.log(`  FAIL: Found ${deadMangaInResults.length} dead manga in trending`);
    deadMangaInResults.forEach((s: any) => console.log(`    - ${s.title} (Last Chapter: ${s.last_chapter_at})`));
  } else {
    console.log(`  PASS: No dead manga in trending`);
  }

  console.log(`\n4. RANKING SAMPLES (Top 5)`);
  results.slice(0, 5).forEach((s: any, i: number) => {
    console.log(`${i + 1}. ${s.title.padEnd(40)} | Score: ${s.trending_score} | Last Update: ${s.last_chapter_at?.split('T')[0] || 'N/A'}`);
  });

  console.log(`\n5. ENGAGEMENT VS RANKING`);
  // Verify that series with highest scores are indeed at the top
  const isSorted = results.every((val: any, i: number) => i === 0 || results[i-1].trending_score >= val.trending_score);
  console.log(`- Results correctly sorted by score: ${isSorted ? 'PASS' : 'FAIL'}`);

  console.log('\n--- QA COMPLETE ---');
}

verifyTrending().catch(console.error);
