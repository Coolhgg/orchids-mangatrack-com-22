-- ============================================================
-- DISCOVER SECTIONS - MATERIALIZED VIEWS
-- Production SQL for MangaTrack Discover Feature
-- ============================================================
-- 
-- SECTIONS:
--   1. discover_trending         - Hot right now (7-day window)
--   2. discover_popular_30d      - Popular this month
--   3. discover_recently_active  - Recently updated series
--   4. discover_highest_rated    - Top rated (with confidence weighting)
--   5. discover_new_and_noteworthy - New releases gaining traction
--
-- REFRESH CADENCE:
--   - discover_trending:         Every 10 minutes
--   - discover_popular_30d:      Every 1 hour
--   - discover_recently_active:  Every 10 minutes
--   - discover_highest_rated:    Every 24 hours
--   - discover_new_and_noteworthy: Every 1 hour
--
-- SAFE FOR: 500k+ series
-- ============================================================


-- ============================================================
-- 1. TRENDING NOW (7-day window)
-- ============================================================
-- Score Formula:
--   (chapter_events_7d * 0.4) +
--   (new_library_adds_7d * 0.3) +
--   (views_7d * 0.2) +
--   (rating_normalized * 0.1)
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS discover_trending CASCADE;

CREATE MATERIALIZED VIEW discover_trending AS
WITH chapter_events_7d AS (
    SELECT 
        lc.series_id,
        COUNT(*) AS event_count
    FROM chapters lc
    WHERE lc.published_at >= NOW() - INTERVAL '7 days'
      AND lc.deleted_at IS NULL
    GROUP BY lc.series_id
),
library_adds_7d AS (
    SELECT 
        series_id,
        COUNT(*) AS add_count
    FROM library_entries
    WHERE added_at >= NOW() - INTERVAL '7 days'
      AND deleted_at IS NULL
    GROUP BY series_id
),
signals_7d AS (
    SELECT 
        series_id,
        COUNT(*) AS view_count
    FROM user_signals
    WHERE created_at >= NOW() - INTERVAL '7 days'
      AND signal_type IN ('manga_click', 'chapter_click')
      AND series_id IS NOT NULL
    GROUP BY series_id
)
SELECT
    s.id AS series_id,
    s.title,
    s.cover_url,
    s.content_rating,
    s.original_language,
    s.type,
    s.status,
    s.genres,
    s.average_rating,
    s.total_follows,
    COALESCE(ce.event_count, 0) AS chapter_events_7d,
    COALESCE(la.add_count, 0) AS library_adds_7d,
    COALESCE(sig.view_count, 0) AS views_7d,
    (
        (COALESCE(ce.event_count, 0) * 0.4) +
        (COALESCE(la.add_count, 0) * 0.3) +
        (COALESCE(sig.view_count, 0) * 0.2) +
        (COALESCE(s.average_rating, 0) / 10.0 * 0.1 * 100)
    ) AS score,
    RANK() OVER (ORDER BY (
        (COALESCE(ce.event_count, 0) * 0.4) +
        (COALESCE(la.add_count, 0) * 0.3) +
        (COALESCE(sig.view_count, 0) * 0.2) +
        (COALESCE(s.average_rating, 0) / 10.0 * 0.1 * 100)
    ) DESC) AS rank,
    NOW() AS last_computed_at
FROM series s
LEFT JOIN chapter_events_7d ce ON s.id = ce.series_id
LEFT JOIN library_adds_7d la ON s.id = la.series_id
LEFT JOIN signals_7d sig ON s.id = sig.series_id
WHERE s.deleted_at IS NULL
  AND s.metadata_status IN ('enriched', 'pending')
  AND (
      COALESCE(ce.event_count, 0) > 0 OR
      COALESCE(la.add_count, 0) > 0 OR
      COALESCE(sig.view_count, 0) > 0
  )
ORDER BY score DESC
LIMIT 500;

-- Indexes for discover_trending
CREATE UNIQUE INDEX idx_discover_trending_series_id ON discover_trending (series_id);
CREATE INDEX idx_discover_trending_rank ON discover_trending (rank);
CREATE INDEX idx_discover_trending_score ON discover_trending (score DESC);


-- ============================================================
-- 2. POPULAR (30-day window)
-- ============================================================
-- Score Formula:
--   (new_library_adds_30d * 0.5) +
--   (views_30d * 0.3) +
--   (chapter_events_30d * 0.2)
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS discover_popular_30d CASCADE;

CREATE MATERIALIZED VIEW discover_popular_30d AS
WITH library_adds_30d AS (
    SELECT 
        series_id,
        COUNT(*) AS add_count
    FROM library_entries
    WHERE added_at >= NOW() - INTERVAL '30 days'
      AND deleted_at IS NULL
    GROUP BY series_id
),
signals_30d AS (
    SELECT 
        series_id,
        COUNT(*) AS view_count
    FROM user_signals
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND signal_type IN ('manga_click', 'chapter_click')
      AND series_id IS NOT NULL
    GROUP BY series_id
),
chapter_events_30d AS (
    SELECT 
        lc.series_id,
        COUNT(*) AS event_count
    FROM chapters lc
    WHERE lc.published_at >= NOW() - INTERVAL '30 days'
      AND lc.deleted_at IS NULL
    GROUP BY lc.series_id
)
SELECT
    s.id AS series_id,
    s.title,
    s.cover_url,
    s.content_rating,
    s.original_language,
    s.type,
    s.status,
    s.genres,
    s.average_rating,
    s.total_follows,
    COALESCE(la.add_count, 0) AS library_adds_30d,
    COALESCE(sig.view_count, 0) AS views_30d,
    COALESCE(ce.event_count, 0) AS chapter_events_30d,
    (
        (COALESCE(la.add_count, 0) * 0.5) +
        (COALESCE(sig.view_count, 0) * 0.3) +
        (COALESCE(ce.event_count, 0) * 0.2)
    ) AS score,
    RANK() OVER (ORDER BY (
        (COALESCE(la.add_count, 0) * 0.5) +
        (COALESCE(sig.view_count, 0) * 0.3) +
        (COALESCE(ce.event_count, 0) * 0.2)
    ) DESC) AS rank,
    NOW() AS last_computed_at
FROM series s
LEFT JOIN library_adds_30d la ON s.id = la.series_id
LEFT JOIN signals_30d sig ON s.id = sig.series_id
LEFT JOIN chapter_events_30d ce ON s.id = ce.series_id
WHERE s.deleted_at IS NULL
  AND s.metadata_status IN ('enriched', 'pending')
  AND (
      COALESCE(la.add_count, 0) > 0 OR
      COALESCE(sig.view_count, 0) > 0 OR
      COALESCE(ce.event_count, 0) > 0
  )
ORDER BY score DESC
LIMIT 500;

-- Indexes for discover_popular_30d
CREATE UNIQUE INDEX idx_discover_popular_30d_series_id ON discover_popular_30d (series_id);
CREATE INDEX idx_discover_popular_30d_rank ON discover_popular_30d (rank);
CREATE INDEX idx_discover_popular_30d_score ON discover_popular_30d (score DESC);


-- ============================================================
-- 3. RECENTLY ACTIVE
-- ============================================================
-- Sorted by: last_chapter_at DESC (14-day window)
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS discover_recently_active CASCADE;

CREATE MATERIALIZED VIEW discover_recently_active AS
SELECT
    s.id AS series_id,
    s.title,
    s.cover_url,
    s.content_rating,
    s.original_language,
    s.type,
    s.status,
    s.genres,
    s.average_rating,
    s.total_follows,
    s.last_chapter_at,
    s.latest_chapter,
    RANK() OVER (ORDER BY s.last_chapter_at DESC NULLS LAST) AS rank,
    NOW() AS last_computed_at
FROM series s
WHERE s.deleted_at IS NULL
  AND s.metadata_status IN ('enriched', 'pending')
  AND s.last_chapter_at >= NOW() - INTERVAL '14 days'
  AND s.last_chapter_at IS NOT NULL
ORDER BY s.last_chapter_at DESC NULLS LAST
LIMIT 500;

-- Indexes for discover_recently_active
CREATE UNIQUE INDEX idx_discover_recently_active_series_id ON discover_recently_active (series_id);
CREATE INDEX idx_discover_recently_active_rank ON discover_recently_active (rank);
CREATE INDEX idx_discover_recently_active_last_chapter ON discover_recently_active (last_chapter_at DESC);


-- ============================================================
-- 4. HIGHEST RATED
-- ============================================================
-- Score Formula (Bayesian-weighted):
--   average_rating * (1 - exp(-0.1 * rating_count))
--
-- This prevents low-sample-size series from dominating.
-- A series needs ~23 ratings to reach 90% confidence.
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS discover_highest_rated CASCADE;

CREATE MATERIALIZED VIEW discover_highest_rated AS
SELECT
    s.id AS series_id,
    s.title,
    s.cover_url,
    s.content_rating,
    s.original_language,
    s.type,
    s.status,
    s.genres,
    s.average_rating,
    s.rating_count,
    s.total_follows,
    (
        COALESCE(s.average_rating, 0) * 
        (1 - EXP(-0.1 * COALESCE(s.rating_count, 0)))
    ) AS weighted_rating,
    RANK() OVER (ORDER BY (
        COALESCE(s.average_rating, 0) * 
        (1 - EXP(-0.1 * COALESCE(s.rating_count, 0)))
    ) DESC) AS rank,
    NOW() AS last_computed_at
FROM series s
WHERE s.deleted_at IS NULL
  AND s.metadata_status IN ('enriched', 'pending')
  AND s.average_rating IS NOT NULL
  AND s.average_rating >= 7.0
  AND COALESCE(s.rating_count, 0) >= 10
ORDER BY weighted_rating DESC
LIMIT 500;

-- Indexes for discover_highest_rated
CREATE UNIQUE INDEX idx_discover_highest_rated_series_id ON discover_highest_rated (series_id);
CREATE INDEX idx_discover_highest_rated_rank ON discover_highest_rated (rank);
CREATE INDEX idx_discover_highest_rated_weighted ON discover_highest_rated (weighted_rating DESC);


-- ============================================================
-- 5. NEW AND NOTEWORTHY
-- ============================================================
-- Criteria:
--   - Added to catalog in last 90 days, OR
--   - Released in current/previous year, OR
--   - First chapter in last 90 days
--
-- Score Formula:
--   (recent_library_adds * 0.4) +
--   (average_rating * 0.3) +
--   (total_follows * 0.001 * 0.3)
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS discover_new_and_noteworthy CASCADE;

CREATE MATERIALIZED VIEW discover_new_and_noteworthy AS
WITH recent_series AS (
    SELECT 
        s.id,
        s.title,
        s.cover_url,
        s.content_rating,
        s.original_language,
        s.type,
        s.status,
        s.genres,
        s.average_rating,
        s.total_follows,
        s.created_at,
        s.first_chapter_date,
        COALESCE(s.release_year, s.year) AS release_year
    FROM series s
    WHERE s.deleted_at IS NULL
      AND s.metadata_status IN ('enriched', 'pending')
      AND (
          s.created_at >= NOW() - INTERVAL '90 days'
          OR (COALESCE(s.release_year, s.year) >= EXTRACT(YEAR FROM NOW()) - 1)
          OR s.first_chapter_date >= NOW() - INTERVAL '90 days'
      )
),
library_engagement AS (
    SELECT 
        series_id,
        COUNT(*) AS add_count
    FROM library_entries
    WHERE added_at >= NOW() - INTERVAL '30 days'
      AND deleted_at IS NULL
    GROUP BY series_id
)
SELECT
    rs.id AS series_id,
    rs.title,
    rs.cover_url,
    rs.content_rating,
    rs.original_language,
    rs.type,
    rs.status,
    rs.genres,
    rs.average_rating,
    rs.total_follows,
    rs.release_year,
    rs.created_at,
    COALESCE(le.add_count, 0) AS recent_adds,
    (
        (COALESCE(le.add_count, 0) * 0.4) +
        (COALESCE(rs.average_rating, 0) * 0.3) +
        (COALESCE(rs.total_follows, 0) * 0.001 * 0.3)
    ) AS score,
    RANK() OVER (ORDER BY (
        (COALESCE(le.add_count, 0) * 0.4) +
        (COALESCE(rs.average_rating, 0) * 0.3) +
        (COALESCE(rs.total_follows, 0) * 0.001 * 0.3)
    ) DESC) AS rank,
    NOW() AS last_computed_at
FROM recent_series rs
LEFT JOIN library_engagement le ON rs.id = le.series_id
ORDER BY score DESC
LIMIT 500;

-- Indexes for discover_new_and_noteworthy
CREATE UNIQUE INDEX idx_discover_new_noteworthy_series_id ON discover_new_and_noteworthy (series_id);
CREATE INDEX idx_discover_new_noteworthy_rank ON discover_new_and_noteworthy (rank);
CREATE INDEX idx_discover_new_noteworthy_score ON discover_new_and_noteworthy (score DESC);


-- ============================================================
-- SUPPORTING INDEXES (on source tables for faster refresh)
-- ============================================================

-- Indexes for faster chapter event aggregation
CREATE INDEX IF NOT EXISTS idx_chapters_series_published 
ON chapters (series_id, published_at) 
WHERE deleted_at IS NULL;

-- Indexes for faster library aggregation
CREATE INDEX IF NOT EXISTS idx_library_entries_series_added 
ON library_entries (series_id, added_at) 
WHERE deleted_at IS NULL;

-- Indexes for faster signal aggregation
CREATE INDEX IF NOT EXISTS idx_user_signals_series_created 
ON user_signals (series_id, created_at) 
WHERE series_id IS NOT NULL;

-- Indexes for series filtering
CREATE INDEX IF NOT EXISTS idx_series_metadata_deleted 
ON series (metadata_status, deleted_at) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_series_last_chapter_at 
ON series (last_chapter_at DESC NULLS LAST) 
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_series_average_rating 
ON series (average_rating DESC NULLS LAST) 
WHERE deleted_at IS NULL AND average_rating IS NOT NULL;


-- ============================================================
-- REFRESH STRATEGY (to be called via pg_cron or external scheduler)
-- ============================================================

-- Concurrent refresh prevents table locking during refresh
-- Requires UNIQUE index on materialized view

-- REFRESH MATERIALIZED VIEW CONCURRENTLY discover_trending;      -- Every 10 min
-- REFRESH MATERIALIZED VIEW CONCURRENTLY discover_popular_30d;   -- Every 1 hour
-- REFRESH MATERIALIZED VIEW CONCURRENTLY discover_recently_active; -- Every 10 min
-- REFRESH MATERIALIZED VIEW CONCURRENTLY discover_highest_rated; -- Every 24 hours
-- REFRESH MATERIALIZED VIEW CONCURRENTLY discover_new_and_noteworthy; -- Every 1 hour


-- ============================================================
-- USAGE EXAMPLES
-- ============================================================

-- Get top 20 trending series:
-- SELECT * FROM discover_trending WHERE rank <= 20 ORDER BY rank;

-- Get popular series with genre filter:
-- SELECT * FROM discover_popular_30d WHERE 'Action' = ANY(genres) ORDER BY rank LIMIT 20;

-- Get recently active series:
-- SELECT * FROM discover_recently_active ORDER BY rank LIMIT 20;

-- Get highest rated series:
-- SELECT * FROM discover_highest_rated ORDER BY rank LIMIT 20;

-- Get new releases:
-- SELECT * FROM discover_new_and_noteworthy ORDER BY rank LIMIT 20;
