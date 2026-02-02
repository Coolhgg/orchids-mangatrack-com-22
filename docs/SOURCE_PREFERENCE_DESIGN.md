# User Preference System: Default Reading Source

## Preference Data Model

The system uses a hierarchical preference model stored in the PostgreSQL database via Prisma.

### 1. Global User Preference
- **Storage**: `User.default_source` (String, @db.VarChar(50))
- **Scope**: Applied to all series in the user's library unless overridden.
- **Value**: The `source_name` (e.g., "MangaDex", "MangaPark").

### 2. Per-Series Override
- **Storage**: `LibraryEntry.preferred_source` (String, @db.VarChar(50))
- **Scope**: Applied only to the specific series.
- **Value**: The `source_name`.

---

## Source Selection Logic

When a user clicks on a chapter, the system selects the source based on the following priority list:

1.  **Direct Match (Per-Series)**: If `LibraryEntry.preferred_source` matches one of the chapter's available `source_name` entries.
2.  **Global Match**: If `User.default_source` matches one of the chapter's available `source_name` entries.
3.  **Trust-Based Match**: Select the source with the highest `trust_score` (defined in `SeriesSource`).
4.  **Recency Fallback**: Select the source with the most recent `published_at` timestamp.
5.  **Manual Selection**: If multiple sources exist and no preference matches, or if the preferred source is unavailable, show the **Source Selection Dialog**.

---

## UI Behavior & Copy

### Settings Page (Global)
- **Title**: Default Reading Source
- **Description**: "Choose your preferred source for reading chapters when multiple are available. You can override this for individual series in your library."
- **Empty State**: "Ask every time (Show dialog)"

### Series Page (Override)
- **Action**: "Set as Preferred Source" (Button/Toggle in the source expansion list)
- **Indicator**: A star or checkmark next to the preferred source in the list.

### Source Selection Dialog
- **Header**: "Select Source - Chapter [Number]"
- **Alert (if fallback occurs)**: "Your preferred source ([Name]) is not available for this chapter. Please select an alternative."

---

## Fallback Behavior Rules

1.  **Availability Enforcement**: Only sources with `is_available: true` are considered for selection.
2.  **Silent Fallback**: If a preference exists but the source is missing the specific chapter, the system silently proceeds to **Trust-Based Match** unless configured otherwise.
3.  **Sticky Overrides**: When a user manually selects a source from the dialog, the system should offer to "Always use this source for this series."
4.  **No Hard Dependency**: The system must never block reading if the preferred source is down; it must always fall back to the next best available source.
