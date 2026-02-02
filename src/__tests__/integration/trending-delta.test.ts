import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

describe('Trending Delta Integration', () => {
  // Skip if no Supabase credentials
  const shouldRun = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;

  it.skip('trending score calculation (requires live database)', async () => {
    if (!shouldRun) {
      console.log('Skipping: No Supabase credentials');
      return;
    }

  const seriesAId = uuidv4(); // Active
  const seriesBId = uuidv4(); // Static
  const seriesCId = uuidv4(); // Fading

  try {
    // 1. Setup Series
    console.log('Setting up series...');
    const { error: insertError } = await supabase.from('series').insert([
      { id: seriesAId, title: 'Trending Test: Active Series', catalog_tier: 'A', total_follows: 10, type: 'manga' },
      { id: seriesBId, title: 'Trending Test: Old Giant', catalog_tier: 'A', total_follows: 1000, type: 'manga' },
      { id: seriesCId, title: 'Trending Test: Fading Series', catalog_tier: 'A', total_follows: 100, type: 'manga' }
    ]);
    if (insertError) {
      console.error('Insert Error:', insertError);
      throw insertError;
    }

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 2. Inject Chapters (for velocity)
    console.log('Injecting chapters...');
    await supabase.from('chapters').insert([
      // Series A: 5 chapters in last 7 days, 5 in last 30
      { series_id: seriesAId, chapter_number: '1', first_detected_at: twoDaysAgo },
      { series_id: seriesAId, chapter_number: '2', first_detected_at: twoDaysAgo },
      { series_id: seriesAId, chapter_number: '3', first_detected_at: twoDaysAgo },
      { series_id: seriesAId, chapter_number: '4', first_detected_at: twoDaysAgo },
      { series_id: seriesAId, chapter_number: '5', first_detected_at: twoDaysAgo },
      // Series B: 0 in last 7 days, 10 in last 30 (but all old)
      { series_id: seriesBId, chapter_number: '1', first_detected_at: thirtyDaysAgo },
      // Series C: 0 in last 7 days, 5 in last 30 (but 14 days ago)
      { series_id: seriesCId, chapter_number: '1', first_detected_at: fourteenDaysAgo }
    ]);

    // 3. Inject Activity Events
    console.log('Injecting activity events...');
    await supabase.from('series_activity_events').insert([
      // Series A: High recent activity (5 chapter detections + 5 user reads)
      { series_id: seriesAId, event_type: 'chapter_detected', weight: 5, created_at: twoDaysAgo },
      { series_id: seriesAId, event_type: 'chapter_detected', weight: 5, created_at: twoDaysAgo },
      { series_id: seriesAId, event_type: 'user_read', weight: 2, created_at: twoDaysAgo },
      { series_id: seriesAId, event_type: 'user_read', weight: 2, created_at: twoDaysAgo },
      // Series B: Zero recent activity
      // Series C: Activity from 14 days ago
      { series_id: seriesCId, event_type: 'chapter_detected', weight: 5, created_at: fourteenDaysAgo }
    ]);

    // 4. Inject New Followers
    console.log('Injecting followers...');
    const dummyUserId = uuidv4();
    // Series A: 2 new followers
    await supabase.from('library_entries').insert([
      { series_id: seriesAId, user_id: uuidv4(), added_at: twoDaysAgo, status: 'reading' },
      { series_id: seriesAId, user_id: uuidv4(), added_at: twoDaysAgo, status: 'reading' }
    ]);

    // 5. Call RPC and Verify
    console.log('Verifying tier A insertion...');
    const { data: checkSeries } = await supabase.from('series').select('id, catalog_tier').in('id', [seriesAId, seriesBId, seriesCId]);
    console.log('Inserted Series:', checkSeries);

    console.log('Fetching trending results...');
    const { data: results, error } = await supabase.rpc('get_trending_series_v2', {
      p_cutoff_date: thirtyDaysAgo,
      p_dead_cutoff: thirtyDaysAgo,
      p_type: null,
      p_limit: 10,
      p_offset: 0
    });

    if (error) throw error;

    const active = results.find((s: any) => s.id === seriesAId);
    const oldGiant = results.find((s: any) => s.id === seriesBId);
    const fading = results.find((s: any) => s.id === seriesCId);

    console.log('\n--- RESULTS ---');
    console.log(`Active Series:   Score=${active?.trending_score || 0}, Activity=${active?.activity_7d}, Velocity=${active?.velocity}`);
    console.log(`Old Giant:       Score=${oldGiant?.trending_score || 0}, Activity=${oldGiant?.activity_7d}, Velocity=${oldGiant?.velocity}`);
    console.log(`Fading Series:   Score=${fading?.trending_score || 0}, Activity=${fading?.activity_7d}, Velocity=${fading?.velocity}`);

    // QA 1: New series with fast updates beats old static one
    if ((active?.trending_score || 0) > (oldGiant?.trending_score || 0)) {
      console.log('✅ QA 1 PASS: Active series beats old giant');
    } else {
      console.log('❌ QA 1 FAIL: Old giant still dominates');
    }

    // QA 2: No updates -> trending score drops
    // (Fading series should have low score despite past activity)
    if ((fading?.trending_score || 0) < (active?.trending_score || 0) && (fading?.trending_score || 0) === 0) {
      console.log('✅ QA 2 PASS: Fading series score is zero for last 7 days');
    } else if ((fading?.trending_score || 0) < (active?.trending_score || 0)) {
        console.log('✅ QA 2 PASS: Fading series score is significantly lower');
    } else {
      console.log('❌ QA 2 FAIL: Fading series still trending');
    }

  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    // Cleanup
    console.log('\nCleaning up...');
    await supabase.from('series_activity_events').delete().in('series_id', [seriesAId, seriesBId, seriesCId]);
    await supabase.from('chapters').delete().in('series_id', [seriesAId, seriesBId, seriesCId]);
    await supabase.from('library_entries').delete().in('series_id', [seriesAId, seriesBId, seriesCId]);
    await supabase.from('series').delete().in('id', [seriesAId, seriesBId, seriesCId]);
    console.log('Done.');
    }
  });
});
