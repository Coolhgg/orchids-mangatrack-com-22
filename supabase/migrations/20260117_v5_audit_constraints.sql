-- Migration: v5 Audit Bug Fixes 18-20
-- Adds database-level constraints for data integrity

-- ============================================================================
-- v5 Audit Bug 18: Compound uniqueness for chapter identity
-- ============================================================================
-- NOTE: The ChapterSource model already has @@unique([series_source_id, chapter_id])
-- However, we also need uniqueness on (series_source_id, source_chapter_id) for 
-- sources that reuse chapter IDs on reuploads

-- Add compound unique constraint if source_chapter_id is present
-- This prevents duplicate chapters from the same source when they reuse IDs
CREATE UNIQUE INDEX IF NOT EXISTS chapter_sources_compound_identity_idx 
ON chapter_sources(series_source_id, source_chapter_id) 
WHERE source_chapter_id IS NOT NULL;

-- Add index for efficient lookups
CREATE INDEX IF NOT EXISTS chapter_sources_source_chapter_id_idx 
ON chapter_sources(source_chapter_id) 
WHERE source_chapter_id IS NOT NULL;

-- ============================================================================
-- v5 Audit Bug 19: Enforce one primary source per series
-- ============================================================================
-- Partial unique index: Only one row per series_id can have is_primary_cover = true
-- This is more efficient than a check constraint

CREATE UNIQUE INDEX IF NOT EXISTS series_sources_one_primary_per_series_idx
ON series_sources(series_id)
WHERE is_primary_cover = true AND series_id IS NOT NULL;

-- Create function to validate primary source uniqueness
CREATE OR REPLACE FUNCTION enforce_single_primary_source()
RETURNS TRIGGER AS $$
BEGIN
  -- When setting a source as primary, unset all others for the same series
  IF NEW.is_primary_cover = true AND NEW.series_id IS NOT NULL THEN
    UPDATE series_sources 
    SET is_primary_cover = false 
    WHERE series_id = NEW.series_id 
      AND id != NEW.id 
      AND is_primary_cover = true;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS enforce_single_primary_source_trigger ON series_sources;
CREATE TRIGGER enforce_single_primary_source_trigger
  BEFORE INSERT OR UPDATE OF is_primary_cover ON series_sources
  FOR EACH ROW
  WHEN (NEW.is_primary_cover = true)
  EXECUTE FUNCTION enforce_single_primary_source();

-- ============================================================================
-- v5 Audit Bug 20: DB-level invariants for relationships
-- ============================================================================

-- 1. Check constraint: library_entries must have valid source_url
ALTER TABLE library_entries 
DROP CONSTRAINT IF EXISTS library_entries_source_url_check;

ALTER TABLE library_entries 
ADD CONSTRAINT library_entries_source_url_check 
CHECK (source_url IS NOT NULL AND source_url <> '');

-- 2. Check constraint: library_entries source_name must be set
ALTER TABLE library_entries 
DROP CONSTRAINT IF EXISTS library_entries_source_name_check;

ALTER TABLE library_entries 
ADD CONSTRAINT library_entries_source_name_check 
CHECK (source_name IS NOT NULL AND source_name <> '');

-- 3. Create function to validate series_source belongs to same series (if applicable)
-- This prevents orphaned states where source is unlinked from series
CREATE OR REPLACE FUNCTION validate_chapter_source_series_consistency()
RETURNS TRIGGER AS $$
DECLARE
  chapter_series_id UUID;
  source_series_id UUID;
BEGIN
  -- Get the series_id from the chapter
  SELECT series_id INTO chapter_series_id 
  FROM chapters 
  WHERE id = NEW.chapter_id;
  
  -- Get the series_id from the source
  SELECT series_id INTO source_series_id 
  FROM series_sources 
  WHERE id = NEW.series_source_id;
  
  -- If both are set, they should match (or allow if either is NULL for flexibility)
  IF chapter_series_id IS NOT NULL 
     AND source_series_id IS NOT NULL 
     AND chapter_series_id != source_series_id THEN
    RAISE EXCEPTION 'Chapter series_id (%) does not match source series_id (%)', 
      chapter_series_id, source_series_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for chapter_sources consistency
DROP TRIGGER IF EXISTS validate_chapter_source_consistency_trigger ON chapter_sources;
CREATE TRIGGER validate_chapter_source_consistency_trigger
  BEFORE INSERT OR UPDATE OF chapter_id, series_source_id ON chapter_sources
  FOR EACH ROW
  EXECUTE FUNCTION validate_chapter_source_series_consistency();

-- 4. Index for faster lookups on soft-deleted entries
CREATE INDEX IF NOT EXISTS library_entries_deleted_at_idx 
ON library_entries(deleted_at) 
WHERE deleted_at IS NOT NULL;

-- 5. Ensure metadata_status only contains valid values
ALTER TABLE library_entries 
DROP CONSTRAINT IF EXISTS library_entries_metadata_status_check;

ALTER TABLE library_entries 
ADD CONSTRAINT library_entries_metadata_status_check 
CHECK (metadata_status IN ('pending', 'enriched', 'unavailable', 'failed'));

-- 6. Ensure sync_status only contains valid values
ALTER TABLE library_entries 
DROP CONSTRAINT IF EXISTS library_entries_sync_status_check;

ALTER TABLE library_entries 
ADD CONSTRAINT library_entries_sync_status_check 
CHECK (sync_status IN ('healthy', 'degraded', 'failed'));

-- ============================================================================
-- Additional Indexes for Performance
-- ============================================================================

-- Index for scheduler row locking (Bug 11)
CREATE INDEX IF NOT EXISTS series_sources_scheduler_idx 
ON series_sources(source_status, next_check_at) 
WHERE source_status != 'broken';

-- Index for metadata healing scheduler
CREATE INDEX IF NOT EXISTS library_entries_metadata_healing_idx 
ON library_entries(metadata_status, metadata_retry_count, last_metadata_attempt_at) 
WHERE metadata_status IN ('pending', 'unavailable', 'failed') AND deleted_at IS NULL;

-- ============================================================================
-- Documentation comment for future reference
-- ============================================================================
COMMENT ON INDEX series_sources_one_primary_per_series_idx IS 
  'v5 Audit Bug 19: Ensures only one primary source per series. Multiple sources can exist but only one can be primary.';

COMMENT ON INDEX chapter_sources_compound_identity_idx IS 
  'v5 Audit Bug 18: Prevents duplicate chapters when sources reuse chapter IDs on reuploads.';

COMMENT ON CONSTRAINT library_entries_metadata_status_check ON library_entries IS 
  'v5 Audit Bug 20: Ensures metadata_status is always a valid enum value.';
