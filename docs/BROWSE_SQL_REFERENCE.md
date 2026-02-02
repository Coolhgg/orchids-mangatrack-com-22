# Browse API SQL Reference (v1.0)

**Status:** LOCKED  
**Last Updated:** 2025-01-27  
**Contract Version:** 1.0.0

This document defines the SQL fragments and query patterns for the Browse API. All backend implementations must adhere to these specifications.

---

## 1. Base Query

```sql
SELECT
  s.id,
  s.title,
  s.alternative_titles,
  s.description,
  s.cover_url,
  s.type,
  s.status,
  s.genres,
  s.tags,
  s.content_rating,
  s.total_follows,
  s.total_views,
  s.average_rating,
  s.created_at,
  s.updated_at
FROM series s
WHERE 1=1
  -- filter clauses appended here
ORDER BY {sort_column} {direction} {nulls_clause}, s.id {direction}
LIMIT {limit + 1}
```

---

## 2. Filter SQL Fragments

### 2.1 Type Filter

```sql
-- Parameter: types varchar[]
-- Example: ['manga', 'manhwa']
s.type = ANY($1::varchar[])
```

### 2.2 Genres Filter (AND logic)

```sql
-- Parameter: genres varchar[]
-- Example: ['Action', 'Adventure']
-- Returns series containing ALL specified genres
s.genres @> $1::varchar[]
```

### 2.3 Themes Filter (AND logic)

```sql
-- Parameter: themes varchar[]
-- Example: ['Isekai', 'Reincarnation']
-- Returns series containing ALL specified themes in tags
s.tags @> $1::varchar[]
```

### 2.4 Include Content Warnings (AND logic)

```sql
-- Parameter: include_warnings varchar[]
-- Example: ['Gore', 'Violence']
-- Returns series containing ALL specified warnings in tags
s.tags @> $1::varchar[]
```

### 2.5 Exclude Content Warnings

```sql
-- Parameter: exclude_warnings varchar[]
-- Example: ['Gore', 'Sexual Violence']
-- Returns series NOT containing ANY specified warnings
NOT (s.tags && $1::varchar[])
```

### 2.6 Status Filter

```sql
-- Parameter: status_values varchar[]
-- Normalized values via STATUS_MAP:
--   releasing -> ['ongoing', 'releasing']
--   finished -> ['completed', 'finished']
--   ongoing -> ['ongoing', 'releasing']
--   completed -> ['completed', 'finished']
--   hiatus -> ['hiatus', 'on hiatus']
--   cancelled -> ['cancelled', 'discontinued']
s.status = ANY($1::varchar[])
```

### 2.7 Content Rating Filter

```sql
-- Parameter: content_rating varchar
-- Valid: 'safe', 'suggestive', 'erotica', 'pornographic'
s.content_rating = $1
```

### 2.8 Source Filter (Single Source)

```sql
-- Parameter: source_name varchar
-- Example: 'mangadex'
-- Requires JOIN modification
FROM series s
INNER JOIN series_sources ss ON ss.series_id = s.id
WHERE ss.source_name = $1
```

### 2.9 Source Filter (Multiple Sources)

```sql
-- No parameter required
-- Returns series available on 2+ sources
EXISTS (
  SELECT 1 FROM series_sources ss
  WHERE ss.series_id = s.id
  GROUP BY ss.series_id
  HAVING COUNT(DISTINCT ss.source_name) >= 2
)
```

---

## 3. Search SQL Fragment

```sql
-- Parameter: search_pattern varchar (e.g., '%naruto%')
-- Searches title, description, and alternative_titles
-- Implemented via RPC function for alternative_titles support

-- Primary search (via RPC):
SELECT id FROM search_series_by_query(search_pattern := $1)

-- Fallback search (direct query):
s.title ILIKE $1 OR s.description ILIKE $1

-- Full search including alternative_titles (RPC implementation):
s.title ILIKE $1
OR s.description ILIKE $1
OR EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(s.alternative_titles) AS alt
  WHERE alt ILIKE $1
)
```

**Pattern Escaping:**
```sql
-- Escape special ILIKE characters: %, _, \
-- Applied before wrapping with %...%
pattern = '%' || escape_ilike_pattern(query) || '%'
```

---

## 4. Sort Logic

### 4.1 Sort Configurations

| Sort Key | Column | Direction | NULLS | ID Direction |
|----------|--------|-----------|-------|--------------|
| `newest` | `created_at` | DESC | - | DESC |
| `oldest` | `created_at` | ASC | - | ASC |
| `updated` | `updated_at` | DESC | - | DESC |
| `popularity` / `popular` / `follows` | `total_follows` | DESC | - | DESC |
| `popularity_asc` | `total_follows` | ASC | - | ASC |
| `score` / `rating` | `average_rating` | DESC | NULLS LAST | DESC |
| `score_asc` | `average_rating` | ASC | NULLS FIRST | ASC |
| `views` | `total_views` | DESC | - | DESC |

### 4.2 Search-Aware Default Sort

```sql
-- When search query present (q.length >= 2): default to 'popularity'
-- When no search query: default to 'newest'
default_sort = has_search_query ? 'popularity' : 'newest'
```

### 4.3 Order By Clause

```sql
-- Standard sort (no NULLs handling)
ORDER BY s.{sort_column} {direction}, s.id {id_direction}

-- Sort with NULLS handling (average_rating)
ORDER BY s.average_rating DESC NULLS LAST, s.id DESC
ORDER BY s.average_rating ASC NULLS FIRST, s.id ASC
```

---

## 5. Cursor Pagination SQL

### 5.1 Cursor Schema

```json
{
  "s": "created_at",   // Sort column
  "d": "desc",         // Direction: "asc" | "desc"
  "v": "2025-01-15T...", // Sort column value (can be null)
  "i": "uuid-here"     // Tiebreaker ID
}
```

### 5.2 Cursor Condition (DESC, non-NULL value)

```sql
-- Get rows AFTER cursor position (smaller values in DESC order)
(
  s.{sort_column} < $1
  OR (s.{sort_column} = $1 AND s.id < $2)
  OR s.{sort_column} IS NULL
)
-- Parameters: [$cursor_value, $cursor_id]
```

### 5.3 Cursor Condition (ASC, non-NULL value)

```sql
-- Get rows AFTER cursor position (larger values in ASC order)
(
  s.{sort_column} > $1
  OR (s.{sort_column} = $1 AND s.id > $2)
)
-- Parameters: [$cursor_value, $cursor_id]
```

### 5.4 Cursor Condition (DESC, NULL value)

```sql
-- Cursor is at NULL section (end of results for DESC NULLS LAST)
(
  s.{sort_column} IS NOT NULL
  OR (s.{sort_column} IS NULL AND s.id < $1)
)
-- Parameters: [$cursor_id]
```

### 5.5 Cursor Condition (ASC, NULL value)

```sql
-- Cursor is at NULL section (start of results for ASC NULLS FIRST)
(
  s.{sort_column} IS NOT NULL
  OR (s.{sort_column} IS NULL AND s.id > $1)
)
-- Parameters: [$cursor_id]
```

### 5.6 Cursor Encoding

```javascript
// Encode: JSON -> base64url
cursor = base64url(JSON.stringify({ s, d, v, i }))

// Decode: base64url -> JSON (with validation)
data = JSON.parse(base64url_decode(cursor))
// Validate: s is known column, d is 'asc'|'desc', i is valid UUID
```

---

## 6. Example Full Queries

### Example 1: Default Browse (Newest, No Filters)

```sql
SELECT
  s.id, s.title, s.alternative_titles, s.description, s.cover_url,
  s.type, s.status, s.genres, s.tags, s.content_rating,
  s.total_follows, s.total_views, s.average_rating,
  s.created_at, s.updated_at
FROM series s
ORDER BY s.created_at DESC, s.id DESC
LIMIT 25
```

### Example 2: Manga + Action Genre + Safe Rating + Popularity Sort

```sql
SELECT
  s.id, s.title, s.alternative_titles, s.description, s.cover_url,
  s.type, s.status, s.genres, s.tags, s.content_rating,
  s.total_follows, s.total_views, s.average_rating,
  s.created_at, s.updated_at
FROM series s
WHERE s.type = ANY(ARRAY['manga']::varchar[])
  AND s.genres @> ARRAY['Action']::varchar[]
  AND s.content_rating = 'safe'
ORDER BY s.total_follows DESC, s.id DESC
LIMIT 25
```

### Example 3: Search Query with Cursor Pagination

```sql
-- Step 1: Get matching IDs from search
SELECT id FROM search_series_by_query(search_pattern := '%one piece%')
-- Returns: ['id1', 'id2', 'id3', ...]

-- Step 2: Query with ID filter and cursor
SELECT
  s.id, s.title, s.alternative_titles, s.description, s.cover_url,
  s.type, s.status, s.genres, s.tags, s.content_rating,
  s.total_follows, s.total_views, s.average_rating,
  s.created_at, s.updated_at
FROM series s
WHERE s.id = ANY(ARRAY['id1', 'id2', 'id3']::uuid[])
  AND (
    s.total_follows < 50000
    OR (s.total_follows = 50000 AND s.id < 'cursor-id-here')
    OR s.total_follows IS NULL
  )
ORDER BY s.total_follows DESC, s.id DESC
LIMIT 25
```

### Example 4: MangaDex Source + Ongoing Status + Exclude Gore

```sql
SELECT
  s.id, s.title, s.alternative_titles, s.description, s.cover_url,
  s.type, s.status, s.genres, s.tags, s.content_rating,
  s.total_follows, s.total_views, s.average_rating,
  s.created_at, s.updated_at
FROM series s
INNER JOIN series_sources ss ON ss.series_id = s.id
WHERE ss.source_name = 'mangadex'
  AND s.status = ANY(ARRAY['ongoing', 'releasing']::varchar[])
  AND NOT (s.tags && ARRAY['Gore']::varchar[])
ORDER BY s.created_at DESC, s.id DESC
LIMIT 25
```

### Example 5: Multiple Sources + Romance + Completed + Score Sort with Cursor

```sql
SELECT
  s.id, s.title, s.alternative_titles, s.description, s.cover_url,
  s.type, s.status, s.genres, s.tags, s.content_rating,
  s.total_follows, s.total_views, s.average_rating,
  s.created_at, s.updated_at
FROM series s
WHERE EXISTS (
    SELECT 1 FROM series_sources ss
    WHERE ss.series_id = s.id
    GROUP BY ss.series_id
    HAVING COUNT(DISTINCT ss.source_name) >= 2
  )
  AND s.genres @> ARRAY['Romance']::varchar[]
  AND s.status = ANY(ARRAY['completed', 'finished']::varchar[])
  AND (
    s.average_rating < 8.5
    OR (s.average_rating = 8.5 AND s.id < 'cursor-id-here')
    OR s.average_rating IS NULL
  )
ORDER BY s.average_rating DESC NULLS LAST, s.id DESC
LIMIT 25
```

---

## 7. Index Requirements

The following indexes are required for optimal query performance:

| Index Name | Columns | Purpose |
|------------|---------|---------|
| `idx_series_created_at` | `(created_at DESC)` | Newest/oldest sort |
| `idx_series_total_follows` | `(total_follows DESC)` | Popularity sort |
| `idx_series_average_rating` | `(average_rating DESC)` | Score sort |
| `idx_series_total_views` | `(total_views DESC)` | Views sort |
| `idx_series_title` | `(title)` | Alpha sort |
| `idx_series_type` | `(type)` | Type filter |
| `idx_series_status` | `(status)` | Status filter |
| `idx_series_content_rating` | `(content_rating)` | Content rating filter |
| `idx_series_genres_gin` | `GIN(genres)` | Genres filter |
| `idx_series_tags_gin` | `GIN(tags)` | Themes/warnings filter |

---

## 8. Query Parameter Mapping

| API Parameter | SQL Column/Operation | Valid Values |
|---------------|---------------------|--------------|
| `q` | Search pattern | String (min 2 chars) |
| `type` | `s.type = ANY(...)` | manga, manhwa, manhua, webtoon, comic, novel, light_novel |
| `genres` | `s.genres @> ...` | Title-cased genre names |
| `themes` | `s.tags @> ...` | Title-cased theme names |
| `includeWarnings` | `s.tags @> ...` | Title-cased warning names |
| `excludeWarnings` | `NOT (s.tags && ...)` | Title-cased warning names |
| `status` | `s.status = ANY(...)` | releasing, finished, ongoing, completed, hiatus, cancelled |
| `rating` | `s.content_rating = ...` | safe, suggestive, erotica, pornographic |
| `source` | JOIN condition | mangadex, mangapark, mangasee, comick, multiple |
| `sort` | ORDER BY clause | newest, oldest, score, popularity, alpha, views, updated |
| `limit` | LIMIT clause | 1-100 (default: 24) |
| `cursor` | WHERE clause | base64url encoded cursor |

---

## 8.1 Deferred Filters (UI State Only)

The following filters are returned in the `filters_applied` response object for **UI state persistence only**. They are **NOT applied to the SQL query** due to Supabase URL length limitations.

| Field | Type | Purpose | SQL Applied |
|-------|------|---------|-------------|
| `period` | `string \| null` | Time period filter (e.g., "week", "month") | NO |
| `dateFrom` | `string \| null` | Custom date range start | NO |
| `dateTo` | `string \| null` | Custom date range end | NO |
| `chapters` | `string \| null` | Chapter count filter | NO |

**Important:**
- These fields are accepted by the API but have no effect on query results
- They are returned in the response to allow frontend state reconstruction
- Future implementation may enable these filters when technical constraints are resolved

---

## 9. Response Format

```json
{
  "status": "complete",
  "results": [...],
  "total": 1234,
  "has_more": true,
  "next_cursor": "eyJzIjoiY3JlYXRlZF9hdCIsImQiOiJkZXNjIiwidiI6IjIwMjUtMDEtMTVUMTI6MDA6MDBaIiwiaSI6InV1aWQtaGVyZSJ9",
  "filters_applied": {
    "types": ["manga"],
    "genres": ["Action"],
    "themes": [],
    "includeWarnings": [],
    "excludeWarnings": [],
    "status": "ongoing",
    "rating": "safe",
    "source": null,
    "period": null,
    "dateFrom": null,
    "dateTo": null,
    "chapters": null,
    "sort": "popularity"
  }
}
```

> **Note:** Fields `period`, `dateFrom`, `dateTo`, and `chapters` are returned for UI state persistence only. See Section 8.1.

---

**END OF DOCUMENT**
