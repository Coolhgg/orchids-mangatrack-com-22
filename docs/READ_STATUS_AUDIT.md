# Read Status Edge Case Audit

Multi-source chapter read status handling for manga tracking.

## Data Model Summary

```
LogicalChapter (1) <--> (N) ChapterSource
     |
     v
UserChapterReadV2 (unique per user+chapter)
     |
     +-- source_used_id (nullable, informational only)
```

**Key Constraint**: `@@unique([user_id, chapter_id])` on `UserChapterReadV2`
- Read status is **per chapter**, not per source
- Source is recorded for analytics only

---

## State Transition Table

| Current State | Action | Result State | Side Effects |
|--------------|--------|--------------|--------------|
| Unread | Click chapter row | Unread | Opens source URL in new tab |
| Unread | Click "Mark Read" | Read | Creates `UserChapterReadV2`, awards XP, updates streak |
| Read | Click chapter row | Read | Opens source URL in new tab (re-read) |
| Read | Click "Mark Read" | Read | No-op (button disabled) |
| Read | Click "Mark Unread" | Unread | Deletes `UserChapterReadV2`, reverts `last_read_chapter` |

---

## Scenario Analysis

### 1. Multiple Sources for Same Chapter

**Behavior**: All sources map to single `LogicalChapter`. Reading from ANY source marks the chapter read.

| Source | URL Opened | Read Status Updated |
|--------|-----------|---------------------|
| MangaDex | mangadex.org/chapter/... | LogicalChapter.id |
| MangaPark | mangapark.net/chapter/... | Same LogicalChapter.id |
| MangaSee | mangasee.cc/chapter/... | Same LogicalChapter.id |

**Invariant**: `UserChapterReadV2.chapter_id` references `LogicalChapter`, not `ChapterSource`.

### 2. Reading from Any Source Marks Chapter Read

**Current Implementation** (✅ Correct):
- `handleChapterClick()` - Opens URL only, does NOT mark read
- `handleMarkRead()` - Marks read only, does NOT open URL
- Actions are intentionally decoupled

**UI Behavior Rules**:
```
Action: Click chapter row
Result: Opens source (preferred or dialog if multiple)
Read status: UNCHANGED

Action: Click "Mark Read" button  
Result: Creates UserChapterReadV2 record
Read status: CHANGED to read
```

### 3. New Source Appears After Chapter is Read

| Timeline | Event | Read Status |
|----------|-------|-------------|
| T0 | Chapter 10 exists (MangaDex only) | Unread |
| T1 | User marks Chapter 10 read | Read |
| T2 | New source discovered (MangaPark) | Read (unchanged) |
| T3 | User clicks Chapter 10 → MangaPark | Read (opens new source) |

**Invariant**: New `ChapterSource` rows do NOT affect existing `UserChapterReadV2` records.

### 4. Re-reading Chapters

**Behavior**: Opening a read chapter does NOT create duplicate records.

```sql
-- Constraint prevents duplicates
@@unique([user_id, chapter_id])
```

**UI States**:
- Read chapter shows "READ" badge (disabled, no action)
- Clicking row still opens source (re-read allowed)
- No XP awarded for re-reads

### 5. Resetting Read Progress (Mark Unread)

**Current State**: NOT IMPLEMENTED in UI

**Required Implementation**:
```typescript
// Server action needed
async function markUnread(userId: string, chapterId: string) {
  // 1. Delete UserChapterReadV2 record
  // 2. Recalculate last_read_chapter (find max of remaining reads)
  // 3. DO NOT deduct XP (one-way reward)
}
```

**Edge Cases**:
| Scenario | last_read_chapter Before | Action | last_read_chapter After |
|----------|-------------------------|--------|------------------------|
| Unmark Ch 10 (latest) | 10 | Mark Ch 10 unread | 9 (or next highest) |
| Unmark Ch 5 (not latest) | 10 | Mark Ch 5 unread | 10 (unchanged) |
| Unmark all chapters | 10 | Mark all unread | 0 (or null) |

### 6. Timeline Order vs Chapter Number Order

**Problem**: `published_at` ≠ `chapter_number` order (delayed uploads, catch-ups)

| Chapter | published_at | chapter_number |
|---------|-------------|----------------|
| Ch 45 | 2024-01-15 | 45 |
| Ch 12.5 (extra) | 2024-01-16 | 12.5 |
| Ch 46 | 2024-01-17 | 46 |

**Sort Options**:
- `chapter_desc`: By chapter_number (reading order)
- `discovered_desc`: By first_seen_at (discovery order)

**Read Progress Calculation**:
- `last_read_chapter` stores MAX chapter_number read
- NOT based on timeline order
- User reading Ch 12.5 after Ch 45 does NOT reset progress

---

## UI Behavior Rules

### Button States

| State | Button Label | Enabled | Action |
|-------|-------------|---------|--------|
| Unread + not in library | "Mark Read" | No (toast error) | None |
| Unread + in library | "Mark Read" | Yes | updateProgress() |
| Read | "READ" | No | None |
| Loading | Spinner | No | None |

### Multi-Source Dialog

**Trigger Conditions**:
1. Chapter has >1 sources AND
2. No preferred source set OR preferred source unavailable

**Dialog Behavior**:
- Lists all available sources
- Clicking source opens URL (does NOT mark read)
- User must separately click "Mark Read"

### Accessibility Labels

```typescript
// Current implementation (enhanced-chapter-list.tsx)
// Row: "Chapter {n}" - could be improved
// Button: "MARK READ" / "READ"

// Recommended:
aria-label={`Read Chapter ${chapter.chapter_number}`}
aria-label={`Mark Chapter ${chapter.chapter_number} as read`}
aria-label={`Chapter ${chapter.chapter_number} is read`}
```

---

## Backend Invariants

### Database Constraints
```prisma
// UserChapterReadV2
@@unique([user_id, chapter_id])  // One read record per user per chapter

// LogicalChapter  
@@unique([series_id, chapter_number])  // One chapter per number per series
```

### Data Integrity Rules

1. **No orphan reads**: `UserChapterReadV2.chapter_id` must reference existing `LogicalChapter`
2. **No duplicate reads**: Unique constraint enforced at DB level
3. **Source deletion safe**: `source_used_id` has `onDelete: SetNull`
4. **Chapter deletion cascades**: Deleting `LogicalChapter` removes associated reads

### Progress Calculation

```sql
-- Current: Stored in LibraryEntry.last_read_chapter
-- Updated on: Each updateProgress() call
-- Value: MAX(chapter_number) of all marked-read chapters

-- Potential bug: Does not verify chapter actually exists
-- Should be: MAX(lc.chapter_number) FROM chapters lc 
--            JOIN user_chapter_reads_v2 ucr ON ucr.chapter_id = lc.id
--            WHERE ucr.user_id = ? AND lc.series_id = ?
```

---

## Known Failure Modes

### 1. Race Condition on Rapid Clicks
**Scenario**: User clicks "Mark Read" rapidly
**Current Safeguard**: Rate limit 60/min + button disabled during loading
**Residual Risk**: Low (unique constraint prevents duplicates)

### 2. Source URL Becomes Invalid
**Scenario**: Source URL 404s after being scraped
**Current Safeguard**: `is_available` flag on ChapterSource
**Gap**: No UI indication of dead links

### 3. Offline/Network Failure on Mark Read
**Scenario**: User clicks "Mark Read", network fails
**Current Safeguard**: Toast error shown
**Gap**: No retry mechanism, no optimistic UI rollback

### 4. XP Exploit via Unmark/Re-mark
**Scenario**: User marks read (+XP) → marks unread → marks read again (+XP?)
**Current Safeguard**: None (unmark not implemented)
**Required Safeguard**: DO NOT award XP on re-reads, track original read timestamp

### 5. Progress Desync Across Devices
**Scenario**: User marks read on device A, device B shows stale data
**Current Safeguard**: Server is source of truth
**Gap**: No real-time sync, requires page refresh

---

## Safeguards Checklist

| Risk | Safeguard | Status |
|------|-----------|--------|
| Duplicate reads | DB unique constraint | ✅ Implemented |
| Race conditions | Rate limiting + optimistic disable | ✅ Implemented |
| Orphan source refs | onDelete: SetNull | ✅ Implemented |
| XP farming | Re-read detection | ⚠️ Partial (no unmark) |
| Progress desync | N/A | ❌ No real-time sync |
| Dead source links | is_available flag | ⚠️ Flag exists, no UI |

---

## Recommendations

1. **Implement "Mark Unread"**: Add button + server action without XP deduction
2. **Add source health indicator**: Show warning icon for `is_available: false`
3. **Optimistic UI**: Update read status immediately, rollback on failure
4. **Real-time sync**: Consider Supabase Realtime for `user_chapter_reads_v2`
5. **Progress recalculation**: Add periodic job to verify `last_read_chapter` accuracy
