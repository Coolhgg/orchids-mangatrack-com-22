-- Migration: Metadata Improvements
-- Bug 5: Series-scoped metadata with SeriesSource-level metadata state
-- Bug 10: Metadata schema versioning for Series

-- =============================================================================
-- Bug 5: Add metadata state to SeriesSource (series-scoped metadata)
-- =============================================================================
-- This allows tracking metadata status per source, not just per library entry.
-- Benefits:
--   - Two users adding the same manga share metadata resolution
--   - Reduced duplicated enrichment work
--   - Consistent global metadata state

-- Add metadata fields to series_sources
ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_retry_count INT DEFAULT 0;
ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS last_metadata_error TEXT;
ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS last_metadata_attempt_at TIMESTAMPTZ;
ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_enriched_at TIMESTAMPTZ;

-- Create enum type for source metadata status (different from library entry status)
-- pending: Initial state, awaiting enrichment
-- enriched: Successfully resolved to canonical series
-- unavailable: No match found, but source is healthy (chapters sync fine)
-- failed: Permanent error during enrichment
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_metadata_status') THEN
    CREATE TYPE source_metadata_status AS ENUM ('pending', 'enriched', 'unavailable', 'failed');
  END IF;
END $$;

-- Add index for metadata healing queries on SeriesSource
CREATE INDEX IF NOT EXISTS idx_series_sources_metadata_status 
  ON series_sources(metadata_status, last_metadata_attempt_at);

CREATE INDEX IF NOT EXISTS idx_series_sources_metadata_healing 
  ON series_sources(metadata_status, metadata_retry_count, last_metadata_attempt_at)
  WHERE metadata_status IN ('pending', 'unavailable', 'failed');

-- =============================================================================
-- Bug 10: Metadata Schema Versioning
-- =============================================================================
-- Track schema version for metadata to enable re-validation on schema changes.
-- When metadata shape changes, older entries can be identified and re-enriched.

-- Add schema version to Series table (default 1 for new entries)
ALTER TABLE series ADD COLUMN IF NOT EXISTS metadata_schema_version INT DEFAULT 1;

-- Add index for finding outdated metadata by schema version
CREATE INDEX IF NOT EXISTS idx_series_schema_version 
  ON series(metadata_schema_version)
  WHERE metadata_schema_version < 1; -- Will be updated to current version

-- =============================================================================
-- Bug 9: Add sync_status to LibraryEntry (for UX clarity)
-- =============================================================================
-- Separate sync health from metadata status so UI can clearly distinguish:
--   - Chapters syncing fine (sync_status: healthy)
--   - Metadata unavailable (metadata_status: unavailable)

-- Add sync status field to library_entries
ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT 'healthy';
ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;

-- Create index for sync health monitoring
CREATE INDEX IF NOT EXISTS idx_library_entries_sync_status 
  ON library_entries(sync_status, last_sync_at);

-- =============================================================================
-- Data Migration: Populate sync_status based on existing data
-- =============================================================================
-- For existing entries, assume sync is healthy if they have series_id
UPDATE library_entries 
SET sync_status = 'healthy', last_sync_at = updated_at
WHERE sync_status IS NULL OR sync_status = '';

-- =============================================================================
-- Comments for documentation
-- =============================================================================
COMMENT ON COLUMN series_sources.metadata_status IS 'Source-level metadata resolution status: pending, enriched, unavailable, failed';
COMMENT ON COLUMN series_sources.metadata_retry_count IS 'Number of metadata enrichment attempts for this source';
COMMENT ON COLUMN series_sources.metadata_enriched_at IS 'Timestamp when metadata was successfully enriched';
COMMENT ON COLUMN series.metadata_schema_version IS 'Version of metadata schema used for this series. Increment when schema changes to trigger re-validation.';
COMMENT ON COLUMN library_entries.sync_status IS 'Chapter sync health status: healthy, degraded, failed. Independent from metadata_status.';
COMMENT ON COLUMN library_entries.last_sync_error IS 'Last error encountered during chapter sync (if any)';
