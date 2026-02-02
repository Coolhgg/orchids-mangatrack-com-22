-- Feed Query Performance Optimization
-- Adds composite indexes for the heavy feed-related queries in production-queries.ts

-- Index for USER_UPDATES_FEED query (most frequently used)
-- This query joins feed_entries with series and library_entries, ordering by first_discovered_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feed_entries_series_discovered
ON feed_entries (series_id, first_discovered_at DESC);

-- Index for feed_entries with logical_chapter_id for read-state joins
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feed_entries_logical_chapter
ON feed_entries (logical_chapter_id) WHERE logical_chapter_id IS NOT NULL;

-- Index for library_entries feed lookups (user + series + status)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_entries_user_series_status
ON library_entries (user_id, series_id, status) WHERE deleted_at IS NULL;

-- Index for chapter_sources availability feed
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chapter_sources_detected_available
ON chapter_sources (detected_at DESC, is_available) WHERE is_available = true;

-- Index for user_chapter_reads_v2 read-state checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_chapter_reads_v2_user_chapter
ON user_chapter_reads_v2 (user_id, chapter_id);

-- Index for activity feed query optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_user_created
ON activities (user_id, created_at DESC);

-- Index for follows feed expansion
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_follows_follower_following
ON follows (follower_id, following_id);

-- Partial index for active library entries by sync priority
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_library_entries_active_sync
ON library_entries (user_id, sync_priority, updated_at DESC)
WHERE deleted_at IS NULL AND status = 'reading';

-- Comments for documentation
COMMENT ON INDEX idx_feed_entries_series_discovered IS 'Optimizes USER_UPDATES_FEED query joins and ordering';
COMMENT ON INDEX idx_feed_entries_logical_chapter IS 'Optimizes read-state lookups in feed queries';
COMMENT ON INDEX idx_library_entries_user_series_status IS 'Optimizes library join in feed queries with soft-delete filter';
COMMENT ON INDEX idx_chapter_sources_detected_available IS 'Optimizes AVAILABILITY_FEED query for available chapters';
COMMENT ON INDEX idx_user_chapter_reads_v2_user_chapter IS 'Optimizes read-state EXISTS checks in feed queries';
COMMENT ON INDEX idx_activities_user_created IS 'Optimizes ACTIVITY_FEED query ordering';
COMMENT ON INDEX idx_follows_follower_following IS 'Optimizes follower expansion in activity feeds';
COMMENT ON INDEX idx_library_entries_active_sync IS 'Optimizes active reading list queries with sync priority';
