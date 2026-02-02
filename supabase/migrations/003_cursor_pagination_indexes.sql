-- Cursor-based Pagination Composite Indexes
-- These indexes optimize cursor pagination queries that use (sort_column, id) ordering

-- Index for newest/oldest (created_at, id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_created_at_id 
ON series (created_at DESC, id DESC);

-- Index for updated sort (updated_at, id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_updated_at_id 
ON series (updated_at DESC, id DESC);

-- Index for popularity sort (total_follows, id)
-- Already have idx on total_follows DESC, but need composite for cursor
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_total_follows_id 
ON series (total_follows DESC, id DESC);

-- Index for views sort (total_views, id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_total_views_id 
ON series (total_views DESC, id DESC);

-- Index for rating/score sort (average_rating, id) with NULLS LAST
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_average_rating_id 
ON series (average_rating DESC NULLS LAST, id DESC);

-- Index for chapter count sort (chapter_count, id) with NULLS LAST
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_chapter_count_id 
ON series (chapter_count DESC NULLS LAST, id DESC);

-- Index for alphabetical sort (title, id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_title_id 
ON series (title ASC, id ASC);

-- Partial index for common filter + sort combo: manga type sorted by popularity
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_manga_popularity 
ON series (total_follows DESC, id DESC) 
WHERE type = 'manga';

-- Partial index for common filter: ongoing/releasing status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_series_ongoing_created 
ON series (created_at DESC, id DESC) 
WHERE status IN ('ongoing', 'releasing');

-- Comment for documentation
COMMENT ON INDEX idx_series_created_at_id IS 'Composite index for cursor pagination with newest/oldest sort';
COMMENT ON INDEX idx_series_total_follows_id IS 'Composite index for cursor pagination with popularity sort';
COMMENT ON INDEX idx_series_average_rating_id IS 'Composite index for cursor pagination with score/rating sort';
COMMENT ON INDEX idx_series_chapter_count_id IS 'Composite index for cursor pagination with chapter count sort';
COMMENT ON INDEX idx_series_title_id IS 'Composite index for cursor pagination with alphabetical sort';
