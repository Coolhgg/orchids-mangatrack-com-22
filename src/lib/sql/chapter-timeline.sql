-- Chapter Timeline Data Model (MangaTrack-style availability events)

-- 1. Table Schema (Final)

-- Logical containers for chapters
-- One entry per unique chapter number per series
CREATE TABLE IF NOT EXISTS chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    chapter_number DECIMAL(10, 2) NOT NULL,
    chapter_title VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Invariant: One logical entry per chapter number
    UNIQUE(series_id, chapter_number)
);

-- Separate availability events (sources)
-- Each upload from a different site is a new row
CREATE TABLE IF NOT EXISTS chapter_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    source_name VARCHAR(50) NOT NULL,
    source_url TEXT NOT NULL,
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Invariant: One source entry per chapter per site
    UNIQUE(chapter_id, source_name)
);

-- Read status (per logical chapter, independent of source)
CREATE TABLE IF NOT EXISTS user_chapter_reads_v2 (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter_id UUID NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Invariant: User reads a chapter once
    UNIQUE(user_id, chapter_id)
);

-- 2. Production SQL Queries

-- TIMELINE FEED
-- Ordered by discovery_time DESC (availability events)
-- Groups multiple sources under the same logical chapter
-- Includes read status for the current user
-- $1: user_id (UUID)
-- $2: limit (INT)
-- $3: offset (INT)
SELECT 
    c.id, 
    c.chapter_number, 
    c.chapter_title, 
    c.series_id,
    s.title as series_title, 
    s.cover_url,
    -- Aggregated sources ordered by discovery time
    jsonb_agg(
        jsonb_build_object(
            'id', cs.id,
            'source_name', cs.source_name,
            'source_url', cs.source_url,
            'discovered_at', cs.discovered_at
        ) ORDER BY cs.discovered_at ASC
    ) as sources,
    -- Discovery time of the LATEST source for this chapter
    MAX(cs.discovered_at) as latest_discovery,
    -- Read status
    EXISTS(
        SELECT 1 FROM user_chapter_reads_v2 ucr 
        WHERE ucr.chapter_id = c.id AND ucr.user_id = $1
    ) as is_read
FROM chapters c
JOIN series s ON c.series_id = s.id
JOIN chapter_sources cs ON c.id = cs.chapter_id
GROUP BY c.id, s.id
ORDER BY latest_discovery DESC
LIMIT $2 OFFSET $3;

-- CHAPTER DETAIL WITH SOURCES
-- $1: chapter_id (UUID)
SELECT 
    c.*,
    jsonb_agg(
        jsonb_build_object(
            'source_name', cs.source_name,
            'source_url', cs.source_url,
            'discovered_at', cs.discovered_at
        ) ORDER BY cs.discovered_at ASC
    ) as sources
FROM chapters c
LEFT JOIN chapter_sources cs ON c.id = cs.chapter_id
WHERE c.id = $1
GROUP BY c.id;

-- READ-STATE QUERY
-- $1: user_id (UUID)
-- $2: chapter_id (UUID)
SELECT 
    ucr.read_at,
    TRUE as is_read
FROM user_chapter_reads_v2 ucr
WHERE ucr.user_id = $1 AND ucr.chapter_id = $2;
