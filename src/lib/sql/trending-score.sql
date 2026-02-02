-- Velocity-Based Trending Score Query
-- Measures rate-of-change in engagement, NOT absolute popularity
-- 
-- KEY DIFFERENCE FROM POPULARITY:
-- - Popularity = total follows, all-time views (favors established giants)
-- - Velocity = Δ follows, Δ chapters in 24-72h (favors current momentum)
--
-- VELOCITY FORMULA:
-- V_chapters = (chapters_24h * 2.0) + (chapters_72h * 0.5)
-- V_follows  = (follows_24h * 1.5) + (follows_72h * 0.3)
-- V_activity = (reads_24h * 1.0)
--
-- FINAL_SCORE = (V_chapters * 0.50 + V_follows * 0.35 + V_activity * 0.15) * RECENCY_FACTOR
--
-- RECENCY_FACTOR = 1 / (1 + days_since_last_chapter_event)
--
-- RULES:
-- - Tier A only (actively maintained catalog)
-- - Dead manga excluded (no chapters in 90+ days)
-- - Must have activity in 72h window to appear

-- Velocity-based trending (default)
WITH chapter_velocity AS (
  SELECT 
    lc.series_id,
    COUNT(*) FILTER (WHERE lc.first_seen_at >= NOW() - INTERVAL '24 hours') AS chapters_24h,
    COUNT(*) FILTER (WHERE lc.first_seen_at >= NOW() - INTERVAL '72 hours') AS chapters_72h,
    MAX(lc.first_seen_at) AS last_chapter_event
  FROM chapters lc
  WHERE lc.deleted_at IS NULL
    AND lc.first_seen_at >= NOW() - INTERVAL '72 hours'
  GROUP BY lc.series_id
),
follow_velocity AS (
  SELECT 
    le.series_id,
    COUNT(*) FILTER (WHERE le.added_at >= NOW() - INTERVAL '24 hours') AS follows_24h,
    COUNT(*) FILTER (WHERE le.added_at >= NOW() - INTERVAL '72 hours') AS follows_72h
  FROM library_entries le
  WHERE le.deleted_at IS NULL
    AND le.added_at >= NOW() - INTERVAL '72 hours'
  GROUP BY le.series_id
),
activity_velocity AS (
  SELECT 
    sae.series_id,
    COUNT(*) AS activity_24h
  FROM series_activity_events sae
  WHERE sae.created_at >= NOW() - INTERVAL '24 hours'
    AND sae.event_type IN ('user_read', 'update_click', 'chapter_read')
  GROUP BY sae.series_id
),
velocity_scores AS (
  SELECT 
    s.id AS series_id,
    COALESCE(cv.chapters_24h, 0) AS chapters_24h,
    COALESCE(cv.chapters_72h, 0) AS chapters_72h,
    COALESCE(fv.follows_24h, 0) AS follows_24h,
    COALESCE(fv.follows_72h, 0) AS follows_72h,
    COALESCE(av.activity_24h, 0) AS activity_24h,
    cv.last_chapter_event,
    -- Velocity components
    (COALESCE(cv.chapters_24h, 0) * 2.0 + COALESCE(cv.chapters_72h, 0) * 0.5) AS v_chapters,
    (COALESCE(fv.follows_24h, 0) * 1.5 + COALESCE(fv.follows_72h, 0) * 0.3) AS v_follows,
    (COALESCE(av.activity_24h, 0) * 1.0) AS v_activity
  FROM series s
  LEFT JOIN chapter_velocity cv ON cv.series_id = s.id
  LEFT JOIN follow_velocity fv ON fv.series_id = s.id
  LEFT JOIN activity_velocity av ON av.series_id = s.id
  WHERE s.deleted_at IS NULL
    AND s.catalog_tier = 'A'
    AND s.last_chapter_at >= NOW() - INTERVAL '90 days'
    -- Must have recent activity to appear
    AND (cv.chapters_24h > 0 OR cv.chapters_72h > 0 OR fv.follows_24h > 0 OR fv.follows_72h > 0)
)
SELECT 
  s.id,
  s.title,
  s.cover_url,
  s.type,
  s.status,
  s.total_follows,
  s.last_chapter_at,
  -- Velocity breakdown
  vs.v_chapters,
  vs.v_follows,
  vs.v_activity,
  vs.chapters_24h,
  vs.chapters_72h,
  vs.follows_24h,
  vs.follows_72h,
  -- Raw velocity score
  (vs.v_chapters * 0.50) + (vs.v_follows * 0.35) + (vs.v_activity * 0.15) AS raw_velocity,
  -- Recency-adjusted score
  (
    (vs.v_chapters * 0.50) + (vs.v_follows * 0.35) + (vs.v_activity * 0.15)
  ) * (
    1.0 / (1.0 + COALESCE(EXTRACT(EPOCH FROM (NOW() - vs.last_chapter_event)) / 86400.0, 1))
  ) AS trending_score
FROM series s
JOIN velocity_scores vs ON vs.series_id = s.id
ORDER BY trending_score DESC, vs.v_chapters DESC, s.total_follows DESC
LIMIT 50;
