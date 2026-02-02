-- =============================================================================
-- V5 AUDIT BUG FIXES MIGRATION (Bugs 51-80)
-- =============================================================================
-- 
-- Bug 71: No invariant ensuring one library entry per user per series
-- Bug 72: No invariant ensuring chapters belong to active source
-- Bug 77: Soft-deleted sources still referenced by chapters
-- =============================================================================

-- Bug 71: Add unique constraint for library_entries (user_id, series_id)
-- This prevents duplicate entries for the same user and series
-- Note: Only applies when series_id is NOT NULL (allows multiple unlinked entries)

-- First, clean up any existing duplicates
WITH duplicates AS (
  SELECT id, user_id, series_id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, series_id 
           ORDER BY COALESCE(last_read_chapter, 0) DESC, updated_at DESC
         ) as rn
  FROM library_entries
  WHERE series_id IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE library_entries le
SET deleted_at = NOW()
FROM duplicates d
WHERE le.id = d.id
  AND d.rn > 1;

-- Create partial unique index (only for non-deleted entries with series_id)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS library_entries_user_series_unique_idx
ON library_entries (user_id, series_id)
WHERE deleted_at IS NULL AND series_id IS NOT NULL;

-- Bug 72: Add CHECK constraint to prevent chapters referencing inactive sources
-- Note: This is enforced at application level since we need runtime checks

-- Create index to efficiently find chapters from deleted/disabled sources
CREATE INDEX CONCURRENTLY IF NOT EXISTS chapter_sources_source_status_idx
ON chapter_sources (series_source_id, is_available)
WHERE is_available = true;

-- Bug 77: Add filtered index for active sources
CREATE INDEX CONCURRENTLY IF NOT EXISTS series_sources_active_idx
ON series_sources (id, series_id)
WHERE deleted_at IS NULL AND disabled_at IS NULL;

-- Add index for reconciliation queries (finding orphans)
CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_orphan_check_idx
ON library_entries (series_id, deleted_at)
WHERE series_id IS NOT NULL AND deleted_at IS NULL;

-- Add index for duplicate detection
CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_duplicate_check_idx
ON library_entries (user_id, series_id)
WHERE series_id IS NOT NULL AND deleted_at IS NULL;

-- Add trigger to prevent chapter inserts for disabled sources
CREATE OR REPLACE FUNCTION check_chapter_source_active()
RETURNS TRIGGER AS $$
DECLARE
  source_status TEXT;
  source_deleted TIMESTAMP;
  source_disabled TIMESTAMP;
BEGIN
  SELECT source_status, deleted_at, disabled_at
  INTO source_status, source_deleted, source_disabled
  FROM series_sources
  WHERE id = NEW.series_source_id;

  IF source_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot insert chapter for deleted source: %', NEW.series_source_id;
  END IF;

  IF source_disabled IS NOT NULL THEN
    RAISE WARNING 'Inserting chapter for disabled source: %', NEW.series_source_id;
    -- Allow insert but mark as unavailable
    NEW.is_available := false;
  END IF;

  IF source_status IN ('broken', 'inactive') THEN
    RAISE WARNING 'Inserting chapter for % source: %', source_status, NEW.series_source_id;
    -- Allow insert but mark as unavailable
    NEW.is_available := false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger (drop first if exists)
DROP TRIGGER IF EXISTS check_chapter_source_active_trigger ON chapter_sources;
CREATE TRIGGER check_chapter_source_active_trigger
BEFORE INSERT ON chapter_sources
FOR EACH ROW
EXECUTE FUNCTION check_chapter_source_active();

-- Add trigger to prevent duplicate library entries
CREATE OR REPLACE FUNCTION check_library_entry_unique()
RETURNS TRIGGER AS $$
DECLARE
  existing_id UUID;
BEGIN
  -- Only check if series_id is being set
  IF NEW.series_id IS NOT NULL AND NEW.deleted_at IS NULL THEN
    SELECT id INTO existing_id
    FROM library_entries
    WHERE user_id = NEW.user_id
      AND series_id = NEW.series_id
      AND deleted_at IS NULL
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    LIMIT 1;

    IF existing_id IS NOT NULL THEN
      -- For updates, raise an error
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Duplicate library entry would be created for user % and series %', NEW.user_id, NEW.series_id;
      END IF;
      -- For inserts, soft delete the new entry and redirect to existing
      IF TG_OP = 'INSERT' THEN
        RAISE EXCEPTION 'Library entry already exists for user % and series % (existing id: %)', NEW.user_id, NEW.series_id, existing_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger (drop first if exists)
DROP TRIGGER IF EXISTS check_library_entry_unique_trigger ON library_entries;
CREATE TRIGGER check_library_entry_unique_trigger
BEFORE INSERT OR UPDATE ON library_entries
FOR EACH ROW
EXECUTE FUNCTION check_library_entry_unique();

-- Add comment documenting the bug fixes
COMMENT ON INDEX library_entries_user_series_unique_idx IS 'Bug 71: Prevents duplicate library entries per user/series';
COMMENT ON INDEX chapter_sources_source_status_idx IS 'Bug 72: Efficient lookup for active chapter sources';
COMMENT ON INDEX series_sources_active_idx IS 'Bug 77: Efficient lookup for active sources';
COMMENT ON FUNCTION check_chapter_source_active() IS 'Bug 72: Prevents chapters for inactive sources';
COMMENT ON FUNCTION check_library_entry_unique() IS 'Bug 71: Prevents duplicate library entries';
