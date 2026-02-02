import { prisma } from '@/lib/prisma';

/**
 * Recommendations Materialization Job
 * Offline computation of personalized recommendations based on:
 * 1. User Genre Affinity (from library)
 * 2. Recent Series Activity (clicks/follows/chapters)
 * 3. Global Popularity (total follows)
 */
export async function runRecommendationsScheduler() {
  console.log('[Recommendations-Scheduler] Starting materialization job...');

  try {
    // BUG 112: Scalability - Process users in batches instead of one massive query
    // This prevents long-running transaction locks and memory issues as user base grows
    const BATCH_SIZE = 500;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const users = await prisma.user.findMany({
        where: { deleted_at: null },
        select: { id: true },
        take: BATCH_SIZE,
        skip: offset,
        orderBy: { id: 'asc' }
      });

      if (users.length === 0) {
        hasMore = false;
        break;
      }

      const userIds = users.map(u => u.id);
      
      console.log(`[Recommendations-Scheduler] Processing batch of ${userIds.length} users (offset: ${offset})...`);

      // We use a raw SQL query for performance and to handle the complex hybrid scoring logic
      // Now scoped to the current batch of user IDs
      await prisma.$executeRaw`
        INSERT INTO user_recommendations (user_id, series_id, score, reason)
        WITH UserGenreAffinity AS (
          -- Calculate what genres each user likes based on their library
          SELECT 
            le.user_id,
            unnest(s.genres) as genre,
            COUNT(*) as affinity_weight
          FROM library_entries le
          JOIN series s ON s.id = le.series_id
          WHERE le.deleted_at IS NULL
            AND le.user_id = ANY(${userIds}::uuid[])
          GROUP BY le.user_id, genre
        ),
        SeriesActivityScore AS (
          -- Calculate a freshness/activity score for each series from recent events
          SELECT 
            series_id,
            SUM(weight) as activity_weight
          FROM series_activity_events
          WHERE created_at >= now() - interval '14 days'
          GROUP BY series_id
        ),
        CandidateSeries AS (
          -- Calculate base popularity score for all potential series
          SELECT 
            s.id as series_id,
            s.genres,
            (COALESCE(sas.activity_weight, 0) * 0.7) + (COALESCE(s.total_follows, 0) * 0.3) as base_popularity_score
          FROM series s
          LEFT JOIN SeriesActivityScore sas ON sas.series_id = s.id
          WHERE s.deleted_at IS NULL
            AND s.catalog_tier IN ('A', 'B') -- Ensure high-quality recommendations
        ),
        ScoredCandidates AS (
          SELECT 
            u.id as user_id,
            cs.series_id,
            -- Final score: 60% genre affinity + 40% global popularity/activity
            (cs.base_popularity_score * 0.4) + (COALESCE(uga.affinity_weight, 0) * 0.6) as final_score,
            'Based on your interest in ' || COALESCE(uga.genre, 'popular series') as reason,
            ROW_NUMBER() OVER (PARTITION BY u.id, cs.series_id ORDER BY (COALESCE(uga.affinity_weight, 0)) DESC) as rank
          FROM users u
          LEFT JOIN UserGenreAffinity uga ON uga.user_id = u.id
          JOIN CandidateSeries cs ON (uga.genre IS NULL OR cs.genres @> ARRAY[uga.genre]::varchar[])
          -- Exclude series already in the user's library
          LEFT JOIN library_entries existing ON existing.user_id = u.id AND existing.series_id = cs.series_id
          WHERE existing.id IS NULL
            AND u.deleted_at IS NULL
            AND u.id = ANY(${userIds}::uuid[])
        )
        SELECT user_id, series_id, final_score, reason
        FROM ScoredCandidates
        WHERE rank = 1
        ON CONFLICT (user_id, series_id) 
        DO UPDATE SET 
          score = EXCLUDED.score,
          reason = EXCLUDED.reason,
          generated_at = now();
      `;

        offset += BATCH_SIZE;

        // Prune recommendations for this batch (keep top 50 per user)
        console.log(`[Recommendations-Scheduler] Pruning recommendations for ${userIds.length} users...`);
        await prisma.$executeRaw`
          DELETE FROM user_recommendations
          WHERE user_id = ANY(${userIds}::uuid[])
            AND (user_id, series_id) IN (
              SELECT user_id, series_id
              FROM (
                SELECT 
                  user_id, 
                  series_id,
                  ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC) as rank
                FROM user_recommendations
                WHERE user_id = ANY(${userIds}::uuid[])
              ) ranked
              WHERE rank > 50
            );
        `;
        
        // Safety break to prevent infinite loops in weird edge cases
      if (offset > 1000000) break; 
    }

    console.log('[Recommendations-Scheduler] Materialization job complete.');
  } catch (error) {
    console.error('[Recommendations-Scheduler] Job failed:', error);
  }
}
