# MangaTrack Chapter Tracking & Update Logic Contract

## 1. DATA MODEL (LOCKED)
Logical entities and their relationships.

### LogicalChapter
A logical chapter container independent of source or time.
- `id`: Primary Key (UUID)
- `series_id`: Foreign Key to Series
- `chapter_number`: Numeric (Decimal for 105.5) - Canonical identifier
- `volume_number`: Integer (Nullable)
- `title`: String (Nullable)
- `last_discovered_at`: Timestamp (For sorting logical chapters by latest update)
- `uniqueness`: Unique constraint on `(series_id, chapter_number)`

### ChapterSource
An availability event linking a logical chapter to a specific source.
- `id`: Primary Key (UUID)
- `logical_chapter_id`: Foreign Key to LogicalChapter
- `source_id`: String (e.g., 'mangadex', 'mangapark')
- `source_chapter_id`: String (Identifier on the source site)
- `url`: String (Direct link to read)
- `discovered_at`: Timestamp (Discovery time)
- `uniqueness`: Unique constraint on `(logical_chapter_id, source_id)`

## 2. EVENT MODEL
- **First appearance**: Create `LogicalChapter` and append first `ChapterSource`.
- **Subsequent appearance**: Append new `ChapterSource` to existing `LogicalChapter`.
- **Simultaneous release**: Multiple `ChapterSource` entries created for one `LogicalChapter`.
- **Missing/Non-standard numbering**: Normalized to `chapter_number` decimal format.

**Invariants**:
- `ChapterSource` is never replaced, only appended.
- `discovered_at` order is strictly preserved.

## 3. TIMELINE ORDERING RULE (CRITICAL)
- **Latest Updates** feed MUST be ordered by `ChapterSource.discovered_at DESC`.
- This ensures the feed reflects when the system found the chapter, not its arbitrary number or metadata date.

## 4. GROUPING RULE
- All `ChapterSource` entries with the same `logical_chapter_id` are grouped under one UI entry.
- The UI shows "Available on: Source A, Source B".

## 5. READ STATE LOGIC
- Read status is stored in `UserChapterReadV2` linked to `logical_chapter_id`.
- Marking one source as read marks the entire logical chapter as read.
- Source choice is a user preference, not a separate tracking state.

## 6. QUERY CONTRACTS (SQL-LEVEL)

### Latest Updates Feed
```sql
SELECT lc.*, cs.* 
FROM chapter_sources cs
JOIN chapters lc ON cs.logical_chapter_id = lc.id
ORDER BY cs.discovered_at DESC
LIMIT 50;
```

### Chapter List for Series
```sql
SELECT lc.*, array_agg(cs.source_id) as sources
FROM chapters lc
LEFT JOIN chapter_sources cs ON lc.id = cs.logical_chapter_id
WHERE lc.series_id = :series_id
GROUP BY lc.id
ORDER BY lc.chapter_number DESC;
```

## 7. EDGE CASE RULES
- **Different Titles**: `LogicalChapter.title` uses the first discovered title or most common.
- **Decimal Chapters**: Standardized to floating point (1105.5).
- **Missing Chapters**: Gaps in `chapter_number` are allowed.
- **Slow Sources**: Append as they are discovered, appearing at the top of the feed if they are "new" to our system.

## 8. ONE-LINE SUMMARY
“Chapters are logical entities, and source uploads are availability events ordered by discovery time.”
