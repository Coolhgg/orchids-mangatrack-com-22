-- =====================================================
-- Migration: Multi-Source Chapter Schema
-- 
-- GOALS:
-- 1. Chapters are logical entities (chapter_number + series)
-- 2. Sources attach to chapters as availability events
-- 3. Multiple sources per chapter allowed
-- 4. Read status is per chapter, per user (NOT per source)
--
-- DEDUPLICATION:
-- - Same chapter + same series = same logical chapter
-- - Same chapter + same source = same availability event
-- - Different sources for same chapter = multiple chapter_sources rows
--
-- =====================================================

-- =====================================================
-- STEP 1: Create new normalized tables
-- =====================================================

-- New logical chapters table (one row per chapter per series)
CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    
    -- Core chapter identity
    chapter_number DECIMAL(10, 2) NOT NULL,
    volume_number INT,
    chapter_title VARCHAR(500),
    
    -- Metadata (aggregated from best source)
    page_count INT,
    published_at TIMESTAMPTZ,         -- Earliest known publish date across sources
    
    -- Timestamps
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- When we first discovered this chapter
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Deduplication: One chapter per series per chapter_number
    CONSTRAINT uq_chapters_series_number UNIQUE (series_id, chapter_number)
);

-- Chapter sources table (availability events)
CREATE TABLE IF NOT EXISTS chapter_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    series_source_id UUID NOT NULL REFERENCES series_sources(id) ON DELETE CASCADE,
    
    -- Source-specific data
    source_chapter_id VARCHAR(255),   -- ID in the source system
    chapter_url TEXT NOT NULL,
    chapter_title VARCHAR(500),       -- Title as reported by this source
    
    -- Availability
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    page_count INT,
    
    -- Translation info
    scanlation_group VARCHAR(255),
    language VARCHAR(10),
    
    -- Timestamps
    source_published_at TIMESTAMPTZ,  -- When source says it was published
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at TIMESTAMPTZ,
    
    -- Deduplication: One entry per source per chapter
    CONSTRAINT uq_chapter_sources_source_chapter UNIQUE (series_source_id, chapter_id)
);

-- User chapter reads (per logical chapter, NOT per source)
CREATE TABLE IF NOT EXISTS user_chapter_reads_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    
    -- Which source was used (informational, not structural)
    source_used_id UUID REFERENCES chapter_sources(id) ON DELETE SET NULL,
    source_name VARCHAR(50),          -- Denormalized for query convenience
    
    -- Reading metadata
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    pages_read INT,
    reading_time_seconds INT,
    
    -- Deduplication: User reads a chapter once (may re-read with different source)
    CONSTRAINT uq_user_chapter_reads_user_chapter UNIQUE (user_id, chapter_id)
);

-- =====================================================
-- STEP 2: Create indexes for timeline + cursor pagination
-- =====================================================

-- Logical chapters indexes
CREATE INDEX idx_chapters_series_number 
    ON chapters (series_id, chapter_number DESC);

CREATE INDEX idx_chapters_series_published 
    ON chapters (series_id, published_at DESC NULLS LAST);

CREATE INDEX idx_chapters_first_seen 
    ON chapters (first_seen_at DESC);

-- Composite index for cursor pagination: (published_at, id)
CREATE INDEX idx_chapters_published_cursor 
    ON chapters (published_at DESC NULLS LAST, id DESC);

-- Composite index for cursor pagination: (first_seen_at, id)
CREATE INDEX idx_chapters_discovered_cursor 
    ON chapters (first_seen_at DESC, id DESC);

-- Chapter sources indexes
CREATE INDEX idx_chapter_sources_chapter 
    ON chapter_sources (chapter_id);

CREATE INDEX idx_chapter_sources_series_source 
    ON chapter_sources (series_source_id);

CREATE INDEX idx_chapter_sources_discovered 
    ON chapter_sources (discovered_at DESC);

CREATE INDEX idx_chapter_sources_available 
    ON chapter_sources (chapter_id, is_available) 
    WHERE is_available = TRUE;

-- User chapter reads indexes (for timeline queries)
CREATE INDEX idx_user_reads_v2_user_read_at 
    ON user_chapter_reads_v2 (user_id, read_at DESC);

-- Composite index for cursor pagination on user reads
CREATE INDEX idx_user_reads_v2_cursor 
    ON user_chapter_reads_v2 (user_id, read_at DESC, id DESC);

-- Index for checking if user has read a chapter
CREATE INDEX idx_user_reads_v2_chapter 
    ON user_chapter_reads_v2 (chapter_id);

-- =====================================================
-- STEP 3: Create helper views
-- =====================================================

-- View: Chapters with all available sources
CREATE OR REPLACE VIEW v_chapters_with_sources AS
SELECT 
    lc.id AS chapter_id,
    lc.series_id,
    lc.chapter_number,
    lc.volume_number,
    lc.chapter_title,
    lc.page_count,
    lc.published_at,
    lc.first_seen_at,
    -- Aggregate sources as JSON array
    COALESCE(
        json_agg(
            json_build_object(
                'source_id', cs.id,
                'series_source_id', cs.series_source_id,
                'source_name', ss.source_name,
                'chapter_url', cs.chapter_url,
                'is_available', cs.is_available,
                'scanlation_group', cs.scanlation_group,
                'language', cs.language,
                'discovered_at', cs.discovered_at
            ) ORDER BY ss.trust_score DESC
        ) FILTER (WHERE cs.id IS NOT NULL),
        '[]'::json
    ) AS sources,
    COUNT(cs.id) FILTER (WHERE cs.is_available) AS available_source_count
FROM chapters lc
LEFT JOIN chapter_sources cs ON cs.chapter_id = lc.id
LEFT JOIN series_sources ss ON ss.id = cs.series_source_id
GROUP BY lc.id, lc.series_id, lc.chapter_number, lc.volume_number, 
         lc.chapter_title, lc.page_count, lc.published_at, lc.first_seen_at;

-- View: User reading history with chapter details
CREATE OR REPLACE VIEW v_user_reading_history AS
SELECT 
    ucr.id AS read_id,
    ucr.user_id,
    ucr.read_at,
    lc.id AS chapter_id,
    lc.series_id,
    lc.chapter_number,
    lc.chapter_title,
    s.title AS series_title,
    s.cover_url AS series_cover_url,
    ucr.source_name,
    ucr.pages_read,
    ucr.reading_time_seconds
FROM user_chapter_reads_v2 ucr
JOIN chapters lc ON lc.id = ucr.chapter_id
JOIN series s ON s.id = lc.series_id;

-- =====================================================
-- STEP 4: Create functions for idempotent operations
-- =====================================================

-- Function: Upsert logical chapter (idempotent)
CREATE OR REPLACE FUNCTION upsert_logical_chapter(
    p_series_id UUID,
    p_chapter_number DECIMAL,
    p_volume_number INT DEFAULT NULL,
    p_chapter_title VARCHAR DEFAULT NULL,
    p_page_count INT DEFAULT NULL,
    p_published_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_chapter_id UUID;
BEGIN
    INSERT INTO chapters (
        series_id, chapter_number, volume_number, chapter_title, 
        page_count, published_at
    )
    VALUES (
        p_series_id, p_chapter_number, p_volume_number, p_chapter_title,
        p_page_count, p_published_at
    )
    ON CONFLICT (series_id, chapter_number) DO UPDATE SET
        -- Update title if we got a better one (non-null replacing null)
        chapter_title = COALESCE(chapters.chapter_title, EXCLUDED.chapter_title),
        -- Update volume if we got one
        volume_number = COALESCE(EXCLUDED.volume_number, chapters.volume_number),
        -- Use earliest published_at
        published_at = LEAST(chapters.published_at, EXCLUDED.published_at),
        -- Take max page count (better data)
        page_count = GREATEST(chapters.page_count, EXCLUDED.page_count),
        updated_at = NOW()
    RETURNING id INTO v_chapter_id;
    
    RETURN v_chapter_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Upsert chapter source (idempotent availability event)
CREATE OR REPLACE FUNCTION upsert_chapter_source(
    p_chapter_id UUID,
    p_series_source_id UUID,
    p_chapter_url TEXT,
    p_source_chapter_id VARCHAR DEFAULT NULL,
    p_chapter_title VARCHAR DEFAULT NULL,
    p_page_count INT DEFAULT NULL,
    p_scanlation_group VARCHAR DEFAULT NULL,
    p_language VARCHAR DEFAULT NULL,
    p_source_published_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_source_id UUID;
BEGIN
    INSERT INTO chapter_sources (
        chapter_id, series_source_id, chapter_url, source_chapter_id,
        chapter_title, page_count, scanlation_group, language,
        source_published_at, is_available
    )
    VALUES (
        p_chapter_id, p_series_source_id, p_chapter_url, p_source_chapter_id,
        p_chapter_title, p_page_count, p_scanlation_group, p_language,
        p_source_published_at, TRUE
    )
    ON CONFLICT (series_source_id, chapter_id) DO UPDATE SET
        chapter_url = EXCLUDED.chapter_url,
        source_chapter_id = COALESCE(EXCLUDED.source_chapter_id, chapter_sources.source_chapter_id),
        chapter_title = COALESCE(EXCLUDED.chapter_title, chapter_sources.chapter_title),
        page_count = COALESCE(EXCLUDED.page_count, chapter_sources.page_count),
        scanlation_group = COALESCE(EXCLUDED.scanlation_group, chapter_sources.scanlation_group),
        language = COALESCE(EXCLUDED.language, chapter_sources.language),
        source_published_at = COALESCE(EXCLUDED.source_published_at, chapter_sources.source_published_at),
        is_available = TRUE,
        last_checked_at = NOW()
    RETURNING id INTO v_source_id;
    
    RETURN v_source_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Record chapter read (idempotent)
CREATE OR REPLACE FUNCTION record_chapter_read(
    p_user_id UUID,
    p_chapter_id UUID,
    p_source_used_id UUID DEFAULT NULL,
    p_source_name VARCHAR DEFAULT NULL,
    p_pages_read INT DEFAULT NULL,
    p_reading_time_seconds INT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_read_id UUID;
BEGIN
    INSERT INTO user_chapter_reads_v2 (
        user_id, chapter_id, source_used_id, source_name,
        pages_read, reading_time_seconds
    )
    VALUES (
        p_user_id, p_chapter_id, p_source_used_id, p_source_name,
        p_pages_read, p_reading_time_seconds
    )
    ON CONFLICT (user_id, chapter_id) DO UPDATE SET
        -- Update if user re-reads with different source
        source_used_id = COALESCE(EXCLUDED.source_used_id, user_chapter_reads_v2.source_used_id),
        source_name = COALESCE(EXCLUDED.source_name, user_chapter_reads_v2.source_name),
        -- Update reading metadata
        pages_read = COALESCE(EXCLUDED.pages_read, user_chapter_reads_v2.pages_read),
        reading_time_seconds = COALESCE(EXCLUDED.reading_time_seconds, user_chapter_reads_v2.reading_time_seconds),
        read_at = NOW()  -- Update timestamp on re-read
    RETURNING id INTO v_read_id;
    
    RETURN v_read_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 5: Create trigger to update series stats
-- =====================================================

CREATE OR REPLACE FUNCTION update_series_on_chapter_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- Update series chapter count and last chapter date
        UPDATE series SET
            chapter_count = (
                SELECT COUNT(DISTINCT chapter_number) 
                FROM chapters 
                WHERE series_id = NEW.series_id
            ),
            latest_chapter = (
                SELECT MAX(chapter_number) 
                FROM chapters 
                WHERE series_id = NEW.series_id
            ),
            last_chapter_at = (
                SELECT MAX(first_seen_at) 
                FROM chapters 
                WHERE series_id = NEW.series_id
            ),
            updated_at = NOW()
        WHERE id = NEW.series_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE series SET
            chapter_count = (
                SELECT COUNT(DISTINCT chapter_number) 
                FROM chapters 
                WHERE series_id = OLD.series_id
            ),
            latest_chapter = (
                SELECT MAX(chapter_number) 
                FROM chapters 
                WHERE series_id = OLD.series_id
            ),
            updated_at = NOW()
        WHERE id = OLD.series_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_series_chapter_update ON chapters;
CREATE TRIGGER trigger_series_chapter_update
    AFTER INSERT OR UPDATE OR DELETE ON chapters
    FOR EACH ROW EXECUTE FUNCTION update_series_on_chapter_change();

-- =====================================================
-- STEP 6: Timeline query function (cursor pagination)
-- =====================================================

-- Function: Get chapter timeline for a series with cursor pagination
CREATE OR REPLACE FUNCTION get_series_chapters_paginated(
    p_series_id UUID,
    p_cursor_published_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 20,
    p_sort_by VARCHAR DEFAULT 'chapter_number',  -- 'chapter_number' | 'published_at' | 'first_seen_at'
    p_sort_desc BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    chapter_id UUID,
    chapter_number DECIMAL,
    volume_number INT,
    chapter_title VARCHAR,
    page_count INT,
    published_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ,
    sources JSON,
    available_source_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.chapter_id,
        v.chapter_number,
        v.volume_number,
        v.chapter_title,
        v.page_count,
        v.published_at,
        v.first_seen_at,
        v.sources,
        v.available_source_count
    FROM v_chapters_with_sources v
    WHERE v.series_id = p_series_id
        -- Cursor condition (for keyset pagination)
        AND (
            p_cursor_id IS NULL 
            OR (
                CASE 
                    WHEN p_sort_by = 'chapter_number' AND p_sort_desc THEN
                        (v.chapter_number, v.chapter_id) < (
                            (SELECT lc.chapter_number FROM chapters lc WHERE lc.id = p_cursor_id),
                            p_cursor_id
                        )
                    WHEN p_sort_by = 'chapter_number' AND NOT p_sort_desc THEN
                        (v.chapter_number, v.chapter_id) > (
                            (SELECT lc.chapter_number FROM chapters lc WHERE lc.id = p_cursor_id),
                            p_cursor_id
                        )
                    WHEN p_sort_by = 'published_at' AND p_sort_desc THEN
                        (v.published_at, v.chapter_id) < (p_cursor_published_at, p_cursor_id)
                    WHEN p_sort_by = 'published_at' AND NOT p_sort_desc THEN
                        (v.published_at, v.chapter_id) > (p_cursor_published_at, p_cursor_id)
                    WHEN p_sort_by = 'first_seen_at' AND p_sort_desc THEN
                        (v.first_seen_at, v.chapter_id) < (p_cursor_published_at, p_cursor_id)
                    ELSE
                        (v.first_seen_at, v.chapter_id) > (p_cursor_published_at, p_cursor_id)
                END
            )
        )
    ORDER BY
        CASE WHEN p_sort_by = 'chapter_number' AND p_sort_desc THEN v.chapter_number END DESC,
        CASE WHEN p_sort_by = 'chapter_number' AND NOT p_sort_desc THEN v.chapter_number END ASC,
        CASE WHEN p_sort_by = 'published_at' AND p_sort_desc THEN v.published_at END DESC NULLS LAST,
        CASE WHEN p_sort_by = 'published_at' AND NOT p_sort_desc THEN v.published_at END ASC NULLS LAST,
        CASE WHEN p_sort_by = 'first_seen_at' AND p_sort_desc THEN v.first_seen_at END DESC,
        CASE WHEN p_sort_by = 'first_seen_at' AND NOT p_sort_desc THEN v.first_seen_at END ASC,
        v.chapter_id DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function: Get user reading history with cursor pagination
CREATE OR REPLACE FUNCTION get_user_reading_history_paginated(
    p_user_id UUID,
    p_cursor_read_at TIMESTAMPTZ DEFAULT NULL,
    p_cursor_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 20
)
RETURNS TABLE (
    read_id UUID,
    read_at TIMESTAMPTZ,
    chapter_id UUID,
    series_id UUID,
    chapter_number DECIMAL,
    chapter_title VARCHAR,
    series_title VARCHAR,
    series_cover_url TEXT,
    source_name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.read_id,
        v.read_at,
        v.chapter_id,
        v.series_id,
        v.chapter_number,
        v.chapter_title,
        v.series_title,
        v.series_cover_url,
        v.source_name
    FROM v_user_reading_history v
    WHERE v.user_id = p_user_id
        AND (
            p_cursor_id IS NULL 
            OR (v.read_at, v.read_id) < (p_cursor_read_at, p_cursor_id)
        )
    ORDER BY v.read_at DESC, v.read_id DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- STEP 7: Row Level Security
-- =====================================================

ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapter_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_chapter_reads_v2 ENABLE ROW LEVEL SECURITY;

-- Logical chapters: public read
CREATE POLICY "Logical chapters are publicly readable" ON chapters
    FOR SELECT USING (true);

CREATE POLICY "Service role full access to chapters" ON chapters
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Chapter sources: public read
CREATE POLICY "Chapter sources are publicly readable" ON chapter_sources
    FOR SELECT USING (true);

CREATE POLICY "Service role full access to chapter_sources" ON chapter_sources
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- User chapter reads: private to user
CREATE POLICY "Users can read own chapter reads" ON user_chapter_reads_v2
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chapter reads" ON user_chapter_reads_v2
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chapter reads" ON user_chapter_reads_v2
    FOR UPDATE USING (auth.uid() = user_id);

-- Public reading history for users with public activity
CREATE POLICY "Public reading history is viewable" ON user_chapter_reads_v2
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = user_chapter_reads_v2.user_id 
            AND (users.privacy_settings->>'activity_public' = 'true' OR users.privacy_settings IS NULL)
        )
    );

CREATE POLICY "Service role full access to user_chapter_reads_v2" ON user_chapter_reads_v2
    FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- STEP 8: Grant permissions
-- =====================================================

GRANT SELECT ON chapters TO anon, authenticated;
GRANT SELECT ON chapter_sources TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON user_chapter_reads_v2 TO authenticated;
GRANT ALL ON chapters TO service_role;
GRANT ALL ON chapter_sources TO service_role;
GRANT ALL ON user_chapter_reads_v2 TO service_role;

GRANT SELECT ON v_chapters_with_sources TO anon, authenticated;
GRANT SELECT ON v_user_reading_history TO authenticated;

GRANT EXECUTE ON FUNCTION upsert_logical_chapter TO service_role;
GRANT EXECUTE ON FUNCTION upsert_chapter_source TO service_role;
GRANT EXECUTE ON FUNCTION record_chapter_read TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_series_chapters_paginated TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_user_reading_history_paginated TO authenticated, service_role;

-- =====================================================
-- SUMMARY
-- =====================================================
-- 
-- TABLES CREATED:
-- 1. chapters - One row per chapter per series
--    PK: id (UUID)
--    UNIQUE: (series_id, chapter_number) - Deduplication key
--
-- 2. chapter_sources - Availability events (many per chapter)
--    PK: id (UUID)
--    FK: chapter_id -> chapters.id
--    FK: series_source_id -> series_sources.id
--    UNIQUE: (series_source_id, chapter_id) - Deduplication key
--
-- 3. user_chapter_reads_v2 - Read status per user per chapter
--    PK: id (UUID)
--    FK: user_id -> users.id
--    FK: chapter_id -> chapters.id
--    UNIQUE: (user_id, chapter_id) - One read per user per chapter
--
-- KEY DESIGN DECISIONS:
-- - Chapters are logical, sources are availability events
-- - Same chapter from different sources = multiple chapter_sources rows
-- - Read status is per chapter, not per source (source_used is informational)
-- - All operations are idempotent via UPSERT functions
-- - Optimized for timeline queries with cursor pagination indexes
--
-- =====================================================
