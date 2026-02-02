import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TEST_PREFIX = 'QA_DECAY_';

async function cleanup() {
  console.log('Cleaning up old test data...');
  const { data: testSeries } = await supabase
    .from('series')
    .select('id')
    .ilike('title', `${TEST_PREFIX}%`);

  if (testSeries && testSeries.length > 0) {
    const ids = testSeries.map(s => s.id);
    await supabase.from('series_activity_events').delete().in('series_id', ids);
    await supabase.from('library_entries').delete().in('series_id', ids);
    await supabase.from('chapters').delete().in('series_id', ids);
    await supabase.from('series').delete().in('id', ids);
  }
}

async function runQA() {
  try {
    await cleanup();

    console.log('Seeding test cases...');

    // 1. Inactive Legend: Massive follows (50k), but no activity in 30 days.
    const { data: legend } = await supabase.from('series').insert({
      title: `${TEST_PREFIX}Inactive Legend`,
      total_follows: 50000,
      catalog_tier: 'A',
      type: 'manga',
      status: 'ongoing'
    }).select().single();

    // 2. Old Giant: High follows (10k), activity 20 days ago.
    const { data: giant } = await supabase.from('series').insert({
      title: `${TEST_PREFIX}Old Giant`,
      total_follows: 10000,
      catalog_tier: 'A',
      type: 'manga',
      status: 'ongoing'
    }).select().single();

    // 3. New Rising Star: Low follows (100), recent chapter (2h ago).
    const { data: star } = await supabase.from('series').insert({
      title: `${TEST_PREFIX}New Rising Star`,
      total_follows: 100,
      catalog_tier: 'A',
      type: 'manga',
      status: 'ongoing'
    }).select().single();

    // 4. Sudden Spike: Medium follows (1k), sudden views (last hour).
    const { data: spike } = await supabase.from('series').insert({
      title: `${TEST_PREFIX}Sudden Spike`,
      total_follows: 1000,
      catalog_tier: 'A',
      type: 'manga',
      status: 'ongoing'
    }).select().single();

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);

    // Activity for Old Giant (20 days ago)
    await supabase.from('chapters').insert({
      series_id: giant!.id,
      chapter_number: '100',
      first_detected_at: twentyDaysAgo.toISOString()
    });
    await supabase.from('series_activity_events').insert({
      series_id: giant!.id,
      event_type: 'chapter_read',
      weight: 1,
      created_at: twentyDaysAgo.toISOString()
    });

    // Activity for New Rising Star (2 hours ago)
    await supabase.from('chapters').insert({
      series_id: star!.id,
      chapter_number: '1',
      first_detected_at: twoHoursAgo.toISOString()
    });
    // Add some library adds (1 hour ago)
    for (let i = 0; i < 5; i++) {
        await supabase.from('library_entries').insert({
            series_id: star!.id,
            added_at: oneHourAgo.toISOString(),
            status: 'reading'
        });
    }

    // Activity for Sudden Spike (views in last hour)
    for (let i = 0; i < 50; i++) {
      await supabase.from('series_activity_events').insert({
        series_id: spike!.id,
        event_type: 'chapter_read',
        weight: 1,
        created_at: new Date(now.getTime() - Math.random() * 3600000).toISOString()
      });
    }

    console.log('\n--- VERIFYING RANKINGS ---');

    const windows = [
      { name: 'Today', window: 'today' },
      { name: 'Week', window: 'week' },
      { name: 'Month', window: 'month' }
    ];

    for (const w of windows) {
      console.log(`\nWindow: ${w.name}`);
      const { data, error } = await supabase.rpc('get_discover_section', {
        p_section: 'trending',
        p_window_hours: w.window === 'today' ? 24 : (w.window === 'week' ? 168 : 720),
        p_half_life_hours: w.window === 'today' ? 12 : (w.window === 'week' ? 72 : 360)
      });

      if (error) {
        console.error(`Error fetching ${w.name}:`, error);
        continue;
      }

      const filtered = data.filter((s: any) => s.title.startsWith(TEST_PREFIX));
      
      if (filtered.length === 0) {
        console.log('  No test series found in results.');
        continue;
      }

      filtered.forEach((s: any, i: number) => {
        console.log(`  ${i + 1}. ${s.title.replace(TEST_PREFIX, '').padEnd(20)} | Score: ${s.score.toFixed(4)} | Follows: ${s.total_follows}`);
      });

      // Verification Logic
      if (w.name === 'Today') {
        const top1 = filtered[0].title;
        if (top1.includes('Rising Star') || top1.includes('Sudden Spike')) {
          console.log('  ✅ PASS: Recent activity outranks old popularity');
        } else {
          console.log('  ❌ FAIL: Recent activity did not outrank old popularity');
        }
        
        const legendInToday = filtered.find((s: any) => s.title.includes('Inactive Legend'));
        if (!legendInToday) {
            console.log('  ✅ PASS: Inactive legend excluded (0 score)');
        } else {
            console.log('  ❌ FAIL: Inactive legend included in results');
        }
      }

      if (w.name === 'Month') {
          const giantPos = filtered.findIndex((s: any) => s.title.includes('Old Giant'));
          const starPos = filtered.findIndex((s: any) => s.title.includes('Rising Star'));
          if (giantPos !== -1 && (giantPos < starPos || starPos === -1)) {
              console.log('  ℹ️ INFO: Old Giant moving up in Month window as expected');
          }
      }
    }

    await cleanup();
    console.log('\n--- QA COMPLETE ---');

  } catch (err) {
    console.error('QA Failed:', err);
  }
}

runQA();
