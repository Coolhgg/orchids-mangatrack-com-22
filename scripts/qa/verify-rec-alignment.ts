
import * as dotenv from 'dotenv';
dotenv.config();
import { getHybridRecommendations } from '@/lib/recommendations';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function verify() {
  console.log('--- Verifying Recommendations ---');
  // Use a known user or a mock
  const { data: users } = await supabaseAdmin.from('users').select('id').limit(1);
  if (users && users.length > 0) {
    const userId = users[0].id;
    const recs = await getHybridRecommendations(userId, 100);
    console.log(`Found ${recs.length} recommendations for user ${userId}`);
    if (recs.length > 0) {
      console.log('Sample recommendation:', {
        title: recs[0].title,
        score: recs[0].recommendation_score,
        reasons: recs[0].match_reasons
      });
    }
  }

  console.log('\n--- Verifying Trending RPC ---');
  const { data: trending, error } = await supabaseAdmin.rpc('get_trending_series_v2', {
    p_cutoff_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    p_dead_cutoff: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    p_limit: 5
  });

  if (error) {
    console.error('Trending RPC Error:', error);
  } else {
    console.log(`Found ${trending?.length} trending series`);
    trending?.forEach((s: any) => {
      console.log(`- ${s.title}: Score ${s.trending_score.toFixed(4)}, Recent Chapters: ${s.recent_chapters_count}`);
    });
  }
}

verify().catch(console.error);
