-- =============================================================================
-- FEED INGEST SYSTEM - Chapter Availability Events
-- =============================================================================
-- Purpose: Track chapter releases from official sources (MangaDex, MangaPlus, etc.)
-- to power the series.last_chapter_released_at field for Kenmei-style release tracking.
--
-- Design:
-- 1. ChapterAvailabilityEvent stores each detected release from official feeds
-- 2. Idempotent: dedupe by (series_id, chapter_number, source_name, external_event_id)
-- 3. series.last_chapter_released_at = MAX(discovered_at) across all sources
-- 4. Atomic updates using GREATEST() to prevent race conditions
-- =============================================================================

-- 1. Add last_chapter_released_at to series table (if not exists)
ALTER TABLE series 
ADD COLUMN IF NOT EXISTS last_chapter_released_at TIMESTAMPTZ;

-- 2. Add index for efficient lookups on last_chapter_released_at
CREATE INDEX IF NOT EXISTS idx_series_last_chapter_released_at 
ON series (last_chapter_released_at DESC NULLS LAST)
WHERE deleted_at IS NULL;

-- 3. Create ChapterAvailabilityEvent table for feed ingestion
CREATE TABLE IF NOT EXISTS chapter_availability_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id         UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  chapter_number    VARCHAR(100) NOT NULL, -- Supports "10.5", "Special", etc.
  source_name       VARCHAR(50) NOT NULL,  -- 'mangadex', 'mangaplus', 'webtoons', etc.
  external_event_id VARCHAR(255),          -- External ID for deduplication (e.g., MangaDex chapter ID)
  
  -- Timestamps
  discovered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When WE detected the release
  published_at      TIMESTAMPTZ,                        -- When source says it was published
  
  -- Metadata
  chapter_title     VARCHAR(500),
  volume_number     INT,
  language          VARCHAR(10) DEFAULT 'en',
  external_url      TEXT,                   -- Link to official source (not pirated)
  
  -- Processing status
  processed_at      TIMESTAMPTZ,
  process_status    VARCHAR(20) DEFAULT 'pending', -- 'pending', 'processed', 'skipped', 'error'
  process_error     TEXT,
  
  -- Audit
  raw_payload       JSONB DEFAULT '{}'::jsonb, -- Original API response for debugging
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Unique constraint for idempotency
  CONSTRAINT chapter_availability_events_unique 
    UNIQUE NULLS NOT DISTINCT (series_id, chapter_number, source_name, external_event_id)
);

-- 4. Indexes for efficient queries
-- Index for finding unprocessed events
CREATE INDEX IF NOT EXISTS idx_cae_pending 
ON chapter_availability_events (discovered_at ASC)
WHERE process_status = 'pending';

-- Index for series lookups
CREATE INDEX IF NOT EXISTS idx_cae_series_discovered
ON chapter_availability_events (series_id, discovered_at DESC);

-- Index for source monitoring
CREATE INDEX IF NOT EXISTS idx_cae_source_discovered
ON chapter_availability_events (source_name, discovered_at DESC);

-- Index for external_event_id lookups (fast duplicate detection)
CREATE INDEX IF NOT EXISTS idx_cae_external_id
ON chapter_availability_events (source_name, external_event_id)
WHERE external_event_id IS NOT NULL;

-- 5. Feed ingest job tracking table (for monitoring)
CREATE TABLE IF NOT EXISTS feed_ingest_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name       VARCHAR(50) NOT NULL,
  tier              VARCHAR(1) NOT NULL DEFAULT 'A', -- A, B, C for sync frequency tiers
  
  -- Run metrics
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  status            VARCHAR(20) NOT NULL DEFAULT 'running', -- 'running', 'completed', 'failed'
  
  -- Results
  events_fetched    INT DEFAULT 0,
  events_created    INT DEFAULT 0,
  events_skipped    INT DEFAULT 0, -- Duplicates
  series_updated    INT DEFAULT 0,
  
  -- Errors
  error_message     TEXT,
  error_count       INT DEFAULT 0,
  
  -- Rate limiting info
  rate_limit_hits   INT DEFAULT 0,
  api_calls_made    INT DEFAULT 0,
  
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for monitoring recent runs
CREATE INDEX IF NOT EXISTS idx_fir_source_started
ON feed_ingest_runs (source_name, started_at DESC);

-- 6. Trigger function to auto-update series.last_chapter_released_at
-- Uses GREATEST() for atomic, race-condition-free updates
CREATE OR REPLACE FUNCTION update_series_last_chapter_released()
RETURNS TRIGGER
LANGUAGE plpgsql
AS '
BEGIN
  -- Only update if this is a new event (not an update to existing)
  -- and the event is actually processed
  IF TG_OP = ''INSERT'' OR (TG_OP = ''UPDATE'' AND NEW.process_status = ''processed'' AND OLD.process_status != ''processed'') THEN
    UPDATE series
    SET last_chapter_released_at = GREATEST(
      COALESCE(last_chapter_released_at, ''1970-01-01''::timestamptz),
      NEW.discovered_at
    )
    WHERE id = NEW.series_id
      AND deleted_at IS NULL;
  END IF;
  
  RETURN NEW;
END;
';

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_series_last_chapter ON chapter_availability_events;
CREATE TRIGGER trigger_update_series_last_chapter
AFTER INSERT OR UPDATE ON chapter_availability_events
FOR EACH ROW
EXECUTE FUNCTION update_series_last_chapter_released();

-- 7. Function to atomically update last_chapter_released_at (callable from app code)
-- This provides an alternative to the trigger for batch updates
CREATE OR REPLACE FUNCTION atomic_update_last_chapter_released(
  p_series_id UUID,
  p_discovered_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS '
DECLARE
  v_updated BOOLEAN := FALSE;
BEGIN
  UPDATE series
  SET last_chapter_released_at = GREATEST(
    COALESCE(last_chapter_released_at, ''1970-01-01''::timestamptz),
    p_discovered_at
  )
  WHERE id = p_series_id
    AND deleted_at IS NULL
    AND (last_chapter_released_at IS NULL OR last_chapter_released_at < p_discovered_at);
  
  GET DIAGNOSTICS v_updated = ROW_COUNT > 0;
  RETURN v_updated;
END;
';

-- 8. Enable RLS
ALTER TABLE chapter_availability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feed_ingest_runs ENABLE ROW LEVEL SECURITY;

-- RLS policies (service role only for these tables)
-- Events are public for reading (anyone can see when chapters were released)
CREATE POLICY cae_read ON chapter_availability_events
FOR SELECT USING (true);

-- Only service role can insert/update (via workers)
CREATE POLICY cae_service_write ON chapter_availability_events
FOR ALL USING (auth.role() = 'service_role');

-- Feed runs are service role only
CREATE POLICY fir_service_all ON feed_ingest_runs
FOR ALL USING (auth.role() = 'service_role');

-- 9. Comments for documentation
COMMENT ON TABLE chapter_availability_events IS 'Tracks chapter releases discovered from official API feeds (MangaDex, MangaPlus, etc.). Used to update series.last_chapter_released_at.';
COMMENT ON COLUMN chapter_availability_events.discovered_at IS 'Timestamp when our system detected this release (used for last_chapter_released_at)';
COMMENT ON COLUMN chapter_availability_events.published_at IS 'Timestamp when the source claims the chapter was published';
COMMENT ON COLUMN chapter_availability_events.external_event_id IS 'Source-specific ID for deduplication (e.g., MangaDex chapter UUID)';
COMMENT ON TABLE feed_ingest_runs IS 'Audit log of feed ingestion runs for monitoring and debugging';
COMMENT ON FUNCTION atomic_update_last_chapter_released IS 'Atomically updates series.last_chapter_released_at using GREATEST() to prevent race conditions';
