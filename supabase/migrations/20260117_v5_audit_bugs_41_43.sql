-- =============================================================================
-- V5 AUDIT BUG FIXES - DATABASE MIGRATION (Bugs 41-43)
-- =============================================================================
-- 
-- Bug 41: No partial index for active library entries
-- Bug 42: JSON metadata fields lack CHECK constraints
-- Bug 43: No cascade rules on chapter deletion
--
-- Run with: psql $DATABASE_URL -f supabase/migrations/20260117_v5_audit_bugs_41_43.sql
-- =============================================================================

-- =============================================================================
-- BUG 41: Partial index for active library entries
-- Queries frequently filter deleted_at IS NULL without index support
-- =============================================================================

-- Index for active library entries (most common query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_active_idx
ON library_entries (user_id, status, last_read_at DESC)
WHERE deleted_at IS NULL;

-- Index for active entries by series
CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_active_series_idx
ON library_entries (series_id, user_id)
WHERE deleted_at IS NULL;

-- Index for active entries pending metadata
CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_active_pending_metadata_idx
ON library_entries (metadata_status, last_metadata_attempt_at)
WHERE deleted_at IS NULL AND metadata_status IN ('pending', 'unavailable', 'failed');

-- Index for active series
CREATE INDEX CONCURRENTLY IF NOT EXISTS series_active_idx
ON series (title)
WHERE deleted_at IS NULL;

-- Index for active chapters
CREATE INDEX CONCURRENTLY IF NOT EXISTS chapters_active_idx
ON chapters (series_id, chapter_number DESC)
WHERE deleted_at IS NULL;

-- =============================================================================
-- BUG 42: JSON metadata fields lack CHECK constraints
-- Invalid shapes can be persisted silently
-- =============================================================================

-- Ensure alternative_titles is always an array (or null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'series_alternative_titles_is_array_check'
  ) THEN
    ALTER TABLE series 
    ADD CONSTRAINT series_alternative_titles_is_array_check 
    CHECK (
      alternative_titles IS NULL OR 
      jsonb_typeof(alternative_titles::jsonb) = 'array'
    );
  END IF;
END $$;

-- Ensure external_links is an object (or null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'series_external_links_is_object_check'
  ) THEN
    ALTER TABLE series 
    ADD CONSTRAINT series_external_links_is_object_check 
    CHECK (
      external_links IS NULL OR 
      jsonb_typeof(external_links::jsonb) = 'object'
    );
  END IF;
END $$;

-- Ensure notification_settings is an object
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_notification_settings_is_object_check'
  ) THEN
    ALTER TABLE users 
    ADD CONSTRAINT users_notification_settings_is_object_check 
    CHECK (
      notification_settings IS NULL OR 
      jsonb_typeof(notification_settings::jsonb) = 'object'
    );
  END IF;
END $$;

-- Ensure privacy_settings is an object
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_privacy_settings_is_object_check'
  ) THEN
    ALTER TABLE users 
    ADD CONSTRAINT users_privacy_settings_is_object_check 
    CHECK (
      privacy_settings IS NULL OR 
      jsonb_typeof(privacy_settings::jsonb) = 'object'
    );
  END IF;
END $$;

-- Ensure feed_entries sources is always an array
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'feed_entries_sources_is_array_check'
  ) THEN
    ALTER TABLE feed_entries 
    ADD CONSTRAINT feed_entries_sources_is_array_check 
    CHECK (
      sources IS NULL OR 
      jsonb_typeof(sources::jsonb) = 'array'
    );
  END IF;
END $$;

-- =============================================================================
-- BUG 43: No cascade rules on chapter deletion
-- Deleting a source can orphan chapters
-- =============================================================================

-- Drop and recreate foreign key for chapter_sources -> chapters with CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chapter_sources_chapter_id_fkey'
  ) THEN
    ALTER TABLE chapter_sources DROP CONSTRAINT chapter_sources_chapter_id_fkey;
  END IF;
END $$;

ALTER TABLE chapter_sources
ADD CONSTRAINT chapter_sources_chapter_id_fkey
  FOREIGN KEY (chapter_id) 
  REFERENCES chapters(id) 
  ON DELETE CASCADE;

-- Drop and recreate foreign key for chapter_sources -> series_sources with CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chapter_sources_series_source_id_fkey'
  ) THEN
    ALTER TABLE chapter_sources DROP CONSTRAINT chapter_sources_series_source_id_fkey;
  END IF;
END $$;

ALTER TABLE chapter_sources
ADD CONSTRAINT chapter_sources_series_source_id_fkey
  FOREIGN KEY (series_source_id) 
  REFERENCES series_sources(id) 
  ON DELETE CASCADE;

-- Ensure legacy_chapters cascade properly
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'legacy_chapters_series_source_id_fkey'
  ) THEN
    ALTER TABLE legacy_chapters DROP CONSTRAINT legacy_chapters_series_source_id_fkey;
  END IF;
END $$;

ALTER TABLE legacy_chapters
ADD CONSTRAINT legacy_chapters_series_source_id_fkey
  FOREIGN KEY (series_source_id) 
  REFERENCES series_sources(id) 
  ON DELETE CASCADE;

-- User chapter reads should cascade when chapters are deleted
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_chapter_reads_v2_chapter_id_fkey'
  ) THEN
    ALTER TABLE user_chapter_reads_v2 DROP CONSTRAINT user_chapter_reads_v2_chapter_id_fkey;
  END IF;
END $$;

ALTER TABLE user_chapter_reads_v2
ADD CONSTRAINT user_chapter_reads_v2_chapter_id_fkey
  FOREIGN KEY (chapter_id) 
  REFERENCES chapters(id) 
  ON DELETE CASCADE;

-- =============================================================================
-- VERIFY CONSTRAINTS
-- =============================================================================

DO $$
DECLARE
  constraint_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO constraint_count
  FROM pg_constraint
  WHERE conname IN (
    'series_alternative_titles_is_array_check',
    'series_external_links_is_object_check',
    'users_notification_settings_is_object_check',
    'users_privacy_settings_is_object_check',
    'feed_entries_sources_is_array_check',
    'chapter_sources_chapter_id_fkey',
    'chapter_sources_series_source_id_fkey',
    'legacy_chapters_series_source_id_fkey',
    'user_chapter_reads_v2_chapter_id_fkey'
  );
  
  RAISE NOTICE 'V5 Audit Bug 41-43 Migration: % constraints created/updated', constraint_count;
END $$;

-- =============================================================================
-- INDEX VERIFICATION
-- =============================================================================

DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE indexname IN (
    'library_entries_active_idx',
    'library_entries_active_series_idx',
    'library_entries_active_pending_metadata_idx',
    'series_active_idx',
    'chapters_active_idx'
  );
  
  RAISE NOTICE 'V5 Audit Bug 41 Migration: % partial indexes created', index_count;
END $$;
