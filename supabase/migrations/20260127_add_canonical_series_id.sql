-- Migration: Add canonical_series_id for series deduplication in search
-- Purpose: Enable search deduplication by linking variant series to canonical series
-- 
-- The canonical_series_id allows grouping:
--   - Fan translations with official releases
--   - Different scan groups for same series
--   - Spin-offs/variants to main series
--
-- Search ranking uses: COALESCE(canonical_series_id, mangadex_id, id)
-- to deduplicate results and show only the most popular variant.

-- Add canonical_series_id column (self-referential FK to series)
ALTER TABLE series 
ADD COLUMN IF NOT EXISTS canonical_series_id UUID NULL;

-- Add foreign key constraint (self-referential)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'series_canonical_series_id_fkey' 
    AND table_name = 'series'
  ) THEN
    ALTER TABLE series 
    ADD CONSTRAINT series_canonical_series_id_fkey 
    FOREIGN KEY (canonical_series_id) 
    REFERENCES series(id) 
    ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for efficient lookup of variants by canonical series
CREATE INDEX IF NOT EXISTS idx_series_canonical_series_id 
ON series (canonical_series_id) 
WHERE canonical_series_id IS NOT NULL;

-- Add trigram indexes for improved search performance (if pg_trgm is enabled)
DO $$
BEGIN
  -- Check if pg_trgm extension exists
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    -- Create GIN index on title for trigram search
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'idx_series_title_trgm'
    ) THEN
      CREATE INDEX idx_series_title_trgm ON series USING GIN (lower(title) gin_trgm_ops);
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN series.canonical_series_id IS 'Links variant series (fan-translations, spin-offs) to canonical series for search deduplication';
