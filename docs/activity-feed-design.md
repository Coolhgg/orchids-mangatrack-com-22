# Availability Feed Design

## Definition
The activity feed shows when chapters become readable on any source. Each source upload is treated as a separate availability event.

## Data Model (Review)
- `chapters`: Container for a specific chapter number in a series.
- `chapter_sources`: Individual availability events (e.g., Chapter 10 on MangaDex, Chapter 10 on Bato.to).

## SQL Strategy
The `AVAILABILITY_FEED` query fetches the latest N records from `chapter_sources` and joins minimal metadata from `chapters` and `series`.

- **Strict Ordering**: Ordered by `discovered_at DESC`.
- **Grouping Helper**: Uses a window function `COUNT(*) OVER (PARTITION BY lc.id)` to identify sources that belong to the same chapter within the current result batch.

## API Response Shape
The API returns a flat list of source events, which can be grouped in the UI.

```json
[
  {
    "source_id": "uuid",
    "source_name": "MangaDex",
    "source_url": "...",
    "discovered_at": "2023-10-01T12:00:00Z",
    "chapter_id": "uuid",
    "chapter_number": 10.0,
    "chapter_title": "The Beginning",
    "series_id": "uuid",
    "series_title": "Solo Leveling",
    "series_cover_url": "...",
    "chapter_source_count": 2
  }
]
```

## Event Grouping Logic (Frontend/API)
To group visually by chapter while maintaining strict event ordering:

1. Iterate through the events.
2. If multiple consecutive events share the same `chapter_id`, they can be rendered as a single block with multiple source icons/links.
3. If they are separated by an event from a different chapter, they should remain distinct to preserve chronological accuracy.

Alternatively, for a "Recent Updates" style view:
- Aggregate by `chapter_id` in the API, using `MAX(discovered_at)` as the primary sort key.
- Each item in the response becomes a chapter object with an array of `sources`.

### Recommended Grouped Response Shape:
```json
[
  {
    "chapter_id": "uuid",
    "latest_event_at": "2023-10-01T12:00:00Z",
    "series": { "id": "uuid", "title": "..." },
    "chapter": { "number": 10.0, "title": "..." },
    "sources": [
      { "name": "MangaDex", "url": "...", "at": "2023-10-01T12:00:00Z" },
      { "name": "Bato.to", "url": "...", "at": "2023-10-01T11:50:00Z" }
    ]
  }
]
```
