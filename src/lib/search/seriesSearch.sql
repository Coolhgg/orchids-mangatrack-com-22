-- Series Search Query with Ranking
-- =============================================================================
-- Requirements:
-- - PostgreSQL extensions: pg_trgm, unaccent
-- - Enable with: CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;
--
-- Parameters:
--   $1 = searchQuery (text) - user search string
--   $2 = limit (integer) - max results to return  
--   $3 = offset (integer) - pagination offset
--   $4 = safeBrowsingMode (text) - 'sfw', 'questionable', or 'nsfw'
--
-- CONTENT POLICY: 'pornographic' content is BLOCKED platform-wide.
-- All safe browsing modes filter it out:
-- - sfw: safe, suggestive only
-- - questionable: safe, suggestive, questionable (legacy mode)
-- - nsfw: safe, suggestive, erotica (NOT pornographic - blocked platform-wide)
-- - NULL content_rating: always included (legacy data support)
--
-- Ranking Logic (descending priority):
--   1. exact_match_boost - exact title match (case-insensitive)
--   2. total_follows - popularity score
--   3. similarity_score - pg_trgm fuzzy match score
--   4. created_at - recency tiebreaker
--
-- Deduplication:
--   Uses ROW_NUMBER() partitioned by COALESCE(canonical_series_id, mangadex_id, id)
--   to dedupe canonical series (same manga from different sources), keeping the most
--   popular variant per canonical ID.
-- =============================================================================

WITH normalized_query AS (
  SELECT lower(unaccent($1::text)) AS q
),

search_matches AS (
  SELECT 
    s.id,
    s.title,
    s.alternative_titles,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.content_rating,
    s.total_follows,
    s.average_rating,
    s.mangadex_id,
    s.canonical_series_id,
    s.created_at,
    s.description,
    nq.q AS normalized_query,
    -- Exact match boost: title or search_index exactly matches query
    CASE 
      WHEN lower(unaccent(s.title)) = nq.q THEN 1
      WHEN lower(unaccent(COALESCE(s.search_index, ''))) = nq.q THEN 1
      ELSE 0 
    END AS exact_match_boost,
    -- Similarity score using pg_trgm
    GREATEST(
      similarity(lower(unaccent(s.title)), nq.q),
      similarity(lower(unaccent(COALESCE(s.search_index, ''))), nq.q)
    ) AS similarity_score
  FROM series s
  CROSS JOIN normalized_query nq
  WHERE 
    s.deleted_at IS NULL
    -- Trigram similarity filter (% operator uses GIN index if available)
    AND (
      lower(unaccent(s.title)) % nq.q
      OR lower(unaccent(COALESCE(s.search_index, ''))) % nq.q
      OR lower(unaccent(s.title)) ILIKE '%' || nq.q || '%'
    )
    -- Safe browsing filter - ALWAYS excludes pornographic (platform-wide block)
    AND (
      ($4::text = 'sfw' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive'))) OR
      ($4::text = 'questionable' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive', 'questionable'))) OR
      ($4::text = 'nsfw' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive', 'erotica')))
    )
),

deduplicated AS (
  SELECT 
    sm.*,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(sm.canonical_series_id::text, sm.mangadex_id, sm.id::text) 
      ORDER BY 
        sm.total_follows DESC NULLS LAST,
        sm.similarity_score DESC,
        sm.created_at DESC
    ) AS rn
  FROM search_matches sm
)

SELECT 
  d.id,
  d.title,
  COALESCE(d.canonical_series_id::text, d.mangadex_id) AS canonical_series_id,
  d.total_follows,
  d.average_rating,
  d.cover_url,
  d.type,
  d.status,
  d.genres,
  d.content_rating,
  d.description,
  d.alternative_titles,
  -- Composite best_match_score for API response
  (d.exact_match_boost * 1000 + COALESCE(d.total_follows, 0) * 0.001 + d.similarity_score * 100)::numeric AS best_match_score
FROM deduplicated d
WHERE d.rn = 1
ORDER BY 
  d.exact_match_boost DESC,
  d.total_follows DESC NULLS LAST,
  d.similarity_score DESC,
  d.created_at DESC
LIMIT $2::integer
OFFSET $3::integer;
