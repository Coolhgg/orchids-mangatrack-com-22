-- =====================================================
-- Migration: Add filter-related columns to series table
-- Adds: chapter_count, themes/tags, original_language, content_warnings
-- =====================================================

-- Add chapter_count column for filtering by chapter count
ALTER TABLE series ADD COLUMN IF NOT EXISTS chapter_count INTEGER DEFAULT 0;

-- Add themes/tags array column (separate from genres for better filtering)
ALTER TABLE series ADD COLUMN IF NOT EXISTS themes TEXT[] DEFAULT '{}';

-- Add content_warnings array column for mature content filtering
ALTER TABLE series ADD COLUMN IF NOT EXISTS content_warnings TEXT[] DEFAULT '{}';

-- Add original_language column for language filtering
ALTER TABLE series ADD COLUMN IF NOT EXISTS original_language VARCHAR(10) DEFAULT NULL;

-- Add translated_languages array for available translations
ALTER TABLE series ADD COLUMN IF NOT EXISTS translated_languages TEXT[] DEFAULT '{}';

-- Add release_year for release period filtering
ALTER TABLE series ADD COLUMN IF NOT EXISTS release_year INTEGER DEFAULT NULL;

-- Add first_chapter_date for precise release filtering
ALTER TABLE series ADD COLUMN IF NOT EXISTS first_chapter_date TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add last_chapter_date for "recently updated" filtering
ALTER TABLE series ADD COLUMN IF NOT EXISTS last_chapter_date TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- =====================================================
-- Create indexes for efficient filtering
-- =====================================================

-- Index for chapter count range queries
CREATE INDEX IF NOT EXISTS idx_series_chapter_count ON series(chapter_count);

-- Index for themes array queries (GIN index for array containment)
CREATE INDEX IF NOT EXISTS idx_series_themes ON series USING GIN(themes);

-- Index for content_warnings array queries
CREATE INDEX IF NOT EXISTS idx_series_content_warnings ON series USING GIN(content_warnings);

-- Index for original language
CREATE INDEX IF NOT EXISTS idx_series_original_language ON series(original_language);

-- Index for translated languages array
CREATE INDEX IF NOT EXISTS idx_series_translated_languages ON series USING GIN(translated_languages);

-- Index for release year
CREATE INDEX IF NOT EXISTS idx_series_release_year ON series(release_year);

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_series_first_chapter_date ON series(first_chapter_date);
CREATE INDEX IF NOT EXISTS idx_series_last_chapter_date ON series(last_chapter_date);

-- Composite index for common filter combinations
CREATE INDEX IF NOT EXISTS idx_series_type_status ON series(type, status);
CREATE INDEX IF NOT EXISTS idx_series_content_rating_type ON series(content_rating, type);

-- =====================================================
-- Function to update chapter_count from chapters table
-- =====================================================

CREATE OR REPLACE FUNCTION update_series_chapter_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    UPDATE series 
    SET chapter_count = (
      SELECT COUNT(*) FROM chapters WHERE series_id = NEW.series_id
    ),
    last_chapter_date = (
      SELECT MAX(published_at) FROM chapters WHERE series_id = NEW.series_id
    )
    WHERE id = NEW.series_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE series 
    SET chapter_count = (
      SELECT COUNT(*) FROM chapters WHERE series_id = OLD.series_id
    ),
    last_chapter_date = (
      SELECT MAX(published_at) FROM chapters WHERE series_id = OLD.series_id
    )
    WHERE id = OLD.series_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update chapter counts
DROP TRIGGER IF EXISTS trigger_update_chapter_count ON chapters;
CREATE TRIGGER trigger_update_chapter_count
  AFTER INSERT OR UPDATE OR DELETE ON chapters
  FOR EACH ROW EXECUTE FUNCTION update_series_chapter_count();

-- =====================================================
-- Backfill existing data
-- =====================================================

-- Backfill chapter_count for existing series
UPDATE series s
SET chapter_count = (
  SELECT COUNT(*) FROM chapters c WHERE c.series_id = s.id
)
WHERE chapter_count = 0 OR chapter_count IS NULL;

-- Backfill last_chapter_date for existing series
UPDATE series s
SET last_chapter_date = (
  SELECT MAX(published_at) FROM chapters c WHERE c.series_id = s.id
)
WHERE last_chapter_date IS NULL;

-- Backfill first_chapter_date for existing series
UPDATE series s
SET first_chapter_date = (
  SELECT MIN(published_at) FROM chapters c WHERE c.series_id = s.id
)
WHERE first_chapter_date IS NULL;

-- =====================================================
-- Extended search function for advanced filtering
-- =====================================================

CREATE OR REPLACE FUNCTION search_series_advanced(
  search_query TEXT DEFAULT NULL,
  filter_types TEXT[] DEFAULT NULL,
  filter_genres TEXT[] DEFAULT NULL,
  filter_themes TEXT[] DEFAULT NULL,
  filter_status TEXT DEFAULT NULL,
  filter_content_rating TEXT DEFAULT NULL,
  filter_original_language TEXT DEFAULT NULL,
  filter_min_chapters INTEGER DEFAULT NULL,
  filter_max_chapters INTEGER DEFAULT NULL,
  exclude_content_warnings TEXT[] DEFAULT NULL,
  include_content_warnings TEXT[] DEFAULT NULL,
  filter_release_from TIMESTAMP DEFAULT NULL,
  filter_release_to TIMESTAMP DEFAULT NULL,
  sort_by TEXT DEFAULT 'updated_at',
  sort_ascending BOOLEAN DEFAULT FALSE,
  result_limit INTEGER DEFAULT 20,
  result_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  alternative_titles TEXT[],
  description TEXT,
  cover_url TEXT,
  type TEXT,
  status TEXT,
  genres TEXT[],
  themes TEXT[],
  content_rating TEXT,
  content_warnings TEXT[],
  original_language VARCHAR(10),
  translated_languages TEXT[],
  chapter_count INTEGER,
  total_follows INTEGER,
  total_views INTEGER,
  average_rating DECIMAL,
  updated_at TIMESTAMP WITH TIME ZONE,
  first_chapter_date TIMESTAMP WITH TIME ZONE,
  last_chapter_date TIMESTAMP WITH TIME ZONE,
  relevance_score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.title,
    s.alternative_titles,
    s.description,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.themes,
    s.content_rating,
    s.content_warnings,
    s.original_language,
    s.translated_languages,
    s.chapter_count,
    s.total_follows,
    s.total_views,
    s.average_rating,
    s.updated_at,
    s.first_chapter_date,
    s.last_chapter_date,
    CASE 
      WHEN search_query IS NOT NULL AND search_query != '' THEN
        ts_rank(
          to_tsvector('english', COALESCE(s.title, '') || ' ' || COALESCE(s.description, '')),
          plainto_tsquery('english', search_query)
        )
      ELSE 1.0
    END::REAL AS relevance_score
  FROM series s
  WHERE
    -- Text search
    (search_query IS NULL OR search_query = '' OR 
      s.title ILIKE '%' || search_query || '%' OR
      s.description ILIKE '%' || search_query || '%' OR
      EXISTS (SELECT 1 FROM unnest(s.alternative_titles) alt WHERE alt ILIKE '%' || search_query || '%')
    )
    -- Type filter (multi-select)
    AND (filter_types IS NULL OR array_length(filter_types, 1) IS NULL OR s.type = ANY(filter_types))
    -- Genre filter (multi-select, AND logic)
    AND (filter_genres IS NULL OR array_length(filter_genres, 1) IS NULL OR s.genres @> filter_genres)
    -- Theme filter (multi-select, AND logic)
    AND (filter_themes IS NULL OR array_length(filter_themes, 1) IS NULL OR s.themes @> filter_themes)
    -- Status filter
    AND (filter_status IS NULL OR filter_status = 'all' OR s.status = filter_status)
    -- Content rating filter
    AND (filter_content_rating IS NULL OR filter_content_rating = 'all' OR s.content_rating = filter_content_rating)
    -- Original language filter
    AND (filter_original_language IS NULL OR filter_original_language = 'all' OR s.original_language = filter_original_language)
    -- Chapter count range
    AND (filter_min_chapters IS NULL OR s.chapter_count >= filter_min_chapters)
    AND (filter_max_chapters IS NULL OR s.chapter_count <= filter_max_chapters)
    -- Exclude content warnings
    AND (exclude_content_warnings IS NULL OR array_length(exclude_content_warnings, 1) IS NULL OR NOT s.content_warnings && exclude_content_warnings)
    -- Include content warnings (must have all specified)
    AND (include_content_warnings IS NULL OR array_length(include_content_warnings, 1) IS NULL OR s.content_warnings @> include_content_warnings)
    -- Release date range
    AND (filter_release_from IS NULL OR s.first_chapter_date >= filter_release_from)
    AND (filter_release_to IS NULL OR s.first_chapter_date <= filter_release_to)
  ORDER BY
    CASE WHEN sort_by = 'relevance' AND NOT sort_ascending THEN relevance_score END DESC NULLS LAST,
    CASE WHEN sort_by = 'relevance' AND sort_ascending THEN relevance_score END ASC NULLS LAST,
    CASE WHEN sort_by = 'updated_at' AND NOT sort_ascending THEN s.updated_at END DESC NULLS LAST,
    CASE WHEN sort_by = 'updated_at' AND sort_ascending THEN s.updated_at END ASC NULLS LAST,
    CASE WHEN sort_by = 'total_follows' AND NOT sort_ascending THEN s.total_follows END DESC NULLS LAST,
    CASE WHEN sort_by = 'total_follows' AND sort_ascending THEN s.total_follows END ASC NULLS LAST,
    CASE WHEN sort_by = 'average_rating' AND NOT sort_ascending THEN s.average_rating END DESC NULLS LAST,
    CASE WHEN sort_by = 'average_rating' AND sort_ascending THEN s.average_rating END ASC NULLS LAST,
    CASE WHEN sort_by = 'chapter_count' AND NOT sort_ascending THEN s.chapter_count END DESC NULLS LAST,
    CASE WHEN sort_by = 'chapter_count' AND sort_ascending THEN s.chapter_count END ASC NULLS LAST,
    CASE WHEN sort_by = 'title' AND sort_ascending THEN s.title END ASC NULLS LAST,
    CASE WHEN sort_by = 'title' AND NOT sort_ascending THEN s.title END DESC NULLS LAST,
    s.updated_at DESC NULLS LAST
  LIMIT result_limit
  OFFSET result_offset;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION search_series_advanced TO anon, authenticated, service_role;
