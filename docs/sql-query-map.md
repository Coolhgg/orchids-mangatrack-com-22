# Production SQL Query Map

Comprehensive mapping of all SQL queries, filters, and data operations for the manga tracking platform.

---

## Table of Contents

1. [Core Data Models](#core-data-models)
2. [User & Authentication](#user--authentication)
3. [Library Management](#library-management)
4. [Feed & Updates](#feed--updates)
5. [Series Discovery & Search](#series-discovery--search)
6. [Chapter Tracking](#chapter-tracking)
7. [Social Features](#social-features)
8. [Gamification](#gamification)
9. [Analytics & Signals](#analytics--signals)
10. [Admin & Maintenance](#admin--maintenance)

---

## Core Data Models

### Entity Relationship Summary

```
User (1) ─── (N) LibraryEntry (N) ─── (1) Series
                    │
                    └── (N) UserChapterReadV2 (N) ─── (1) Chapter
                                                          │
                                                          └── (N) ChapterSource (N) ─── (1) SeriesSource
```

---

## User & Authentication

### 1. Get User by ID
**Purpose**: Retrieve user profile with all fields for authenticated sessions.

```sql
SELECT 
  id, email, username, avatar_url, bio,
  xp, level, streak_days, last_read_at,
  safe_browsing_mode, safe_browsing_indicator,
  notification_settings, privacy_settings,
  season_xp, current_season, trust_score,
  created_at, updated_at
FROM users
WHERE id = $1::uuid
  AND deleted_at IS NULL;
```

### 2. Check Username Availability
**Purpose**: Validate username uniqueness during registration/update.

```sql
SELECT EXISTS (
  SELECT 1 FROM users 
  WHERE LOWER(username) = LOWER($1::text)
    AND deleted_at IS NULL
) as exists;
```

### 3. Get User by Username (Public Profile)
**Purpose**: Fetch public profile data respecting privacy settings.

```sql
SELECT 
  u.id, u.username, u.avatar_url, u.bio,
  u.xp, u.level, u.streak_days,
  u.privacy_settings,
  (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as follower_count,
  (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
  (SELECT COUNT(*) FROM library_entries WHERE user_id = u.id AND deleted_at IS NULL) as library_count
FROM users u
WHERE u.username = $1::text
  AND u.deleted_at IS NULL;
```

### 4. Update User Profile
**Purpose**: Atomic profile update with validation.

```sql
UPDATE users
SET 
  username = COALESCE($2::text, username),
  avatar_url = COALESCE($3::text, avatar_url),
  bio = COALESCE($4::text, bio),
  safe_browsing_mode = COALESCE($5::text, safe_browsing_mode),
  notification_settings = COALESCE($6::jsonb, notification_settings),
  privacy_settings = COALESCE($7::jsonb, privacy_settings),
  updated_at = NOW()
WHERE id = $1::uuid
  AND deleted_at IS NULL
RETURNING *;
```

### 5. Login Attempt Rate Limiting
**Purpose**: Check and record login attempts for brute-force protection.

```sql
-- Check recent failures
SELECT COUNT(*) as attempt_count
FROM login_attempts
WHERE (email = $1::text OR ip_address = $2::text)
  AND success = false
  AND attempted_at > NOW() - INTERVAL '15 minutes';

-- Record attempt
INSERT INTO login_attempts (email, ip_address, success)
VALUES ($1::text, $2::text, $3::boolean);
```

---

## Library Management

### 6. Get User Library (Paginated with Filters)
**Purpose**: Main library view with filtering, sorting, and unread counts.

```sql
SELECT 
  le.id,
  le.series_id,
  le.source_url,
  le.source_name,
  le.status,
  le.last_read_chapter,
  le.last_read_at,
  le.user_rating,
  le.metadata_status,
  le.sync_status,
  le.added_at,
  s.title,
  s.cover_url,
  s.type,
  s.status as series_status,
  s.content_rating,
  s.latest_chapter,
  -- Unread count calculation
  (
    SELECT COUNT(*)
    FROM chapters c
    WHERE c.series_id = s.id
      AND c.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_chapter_reads_v2 ucr
        WHERE ucr.chapter_id = c.id AND ucr.user_id = le.user_id
      )
  ) as unread_count
FROM library_entries le
LEFT JOIN series s ON le.series_id = s.id AND s.deleted_at IS NULL
WHERE le.user_id = $1::uuid
  AND le.deleted_at IS NULL
  -- Status filter
  AND ($2::text IS NULL OR le.status = $2::text)
  -- Content rating filter (safe browsing)
  AND (
    $3::text = 'nsfw' OR
    s.content_rating IS NULL OR
    ($3::text = 'sfw' AND s.content_rating IN ('safe', 'suggestive')) OR
    ($3::text = 'questionable' AND s.content_rating IN ('safe', 'suggestive', 'questionable'))
  )
ORDER BY 
  CASE WHEN $4::text = 'title' THEN s.title END ASC,
  CASE WHEN $4::text = 'last_read' THEN le.last_read_at END DESC NULLS LAST,
  CASE WHEN $4::text = 'added' THEN le.added_at END DESC,
  CASE WHEN $4::text = 'unread' THEN 1 END DESC,
  le.added_at DESC
LIMIT $5::int OFFSET $6::int;
```

### 7. Add Series to Library
**Purpose**: Upsert library entry with source linking.

```sql
INSERT INTO library_entries (
  user_id, series_id, source_url, source_name, 
  imported_title, status, metadata_status
)
VALUES (
  $1::uuid, $2::uuid, $3::text, $4::text,
  $5::text, COALESCE($6::text, 'reading'), 
  CASE WHEN $2::uuid IS NOT NULL THEN 'enriched' ELSE 'pending' END
)
ON CONFLICT (user_id, source_url) 
DO UPDATE SET
  series_id = COALESCE(EXCLUDED.series_id, library_entries.series_id),
  status = COALESCE(EXCLUDED.status, library_entries.status),
  metadata_status = CASE 
    WHEN EXCLUDED.series_id IS NOT NULL THEN 'enriched'
    ELSE library_entries.metadata_status
  END,
  updated_at = NOW()
RETURNING *;
```

### 8. Update Library Entry Status
**Purpose**: Change reading status with validation.

```sql
UPDATE library_entries
SET 
  status = $3::text,
  updated_at = NOW()
WHERE id = $2::uuid
  AND user_id = $1::uuid
  AND deleted_at IS NULL
RETURNING *;
```

### 9. Remove from Library (Soft Delete)
**Purpose**: Soft delete library entry preserving history.

```sql
UPDATE library_entries
SET 
  deleted_at = NOW(),
  updated_at = NOW()
WHERE id = $2::uuid
  AND user_id = $1::uuid
  AND deleted_at IS NULL
RETURNING id;
```

### 10. Library Progress Dashboard
**Purpose**: Aggregate reading progress for active series.

```sql
SELECT 
  le.id, 
  s.id as series_id,
  s.title, 
  s.cover_url, 
  le.last_read_chapter,
  (
    SELECT MAX(c.chapter_number::numeric) 
    FROM chapters c 
    WHERE c.series_id = s.id AND c.deleted_at IS NULL
  ) AS latest_chapter,
  COUNT(c.id) FILTER (
    WHERE c.deleted_at IS NULL 
    AND NOT EXISTS (
      SELECT 1 FROM user_chapter_reads_v2 ucr 
      WHERE ucr.chapter_id = c.id AND ucr.user_id = le.user_id
    )
  ) AS unread_count
FROM library_entries le
JOIN series s ON le.series_id = s.id
LEFT JOIN chapters c ON c.series_id = s.id
WHERE le.user_id = $1::uuid 
  AND le.status = 'reading'
  AND le.deleted_at IS NULL
  AND s.deleted_at IS NULL
GROUP BY le.id, s.id;
```

---

## Feed & Updates

### 11. User Updates Feed (Ranked)
**Purpose**: Personalized chapter updates with tiered ranking.

```sql
SELECT 
  fe.id, 
  s.id as series_id,
  s.title, 
  s.cover_url,
  fe.chapter_number, 
  fe.first_discovered_at,
  fe.sources,
  -- Ranking signals
  (CASE WHEN EXISTS (
    SELECT 1 FROM user_chapter_reads_v2 ucr 
    WHERE ucr.chapter_id = fe.logical_chapter_id AND ucr.user_id = $1::uuid
  ) THEN 0 ELSE 1 END) as is_unread,
  (CASE le.status 
    WHEN 'reading' THEN 3 
    WHEN 'on_hold' THEN 2 
    WHEN 'planning' THEN 1 
    ELSE 0 
  END) as library_status_score,
  (CASE le.sync_priority 
    WHEN 'HIGH' THEN 2 
    WHEN 'WARM' THEN 1 
    ELSE 0 
  END) as sync_priority_score
FROM feed_entries fe
JOIN series s ON fe.series_id = s.id
JOIN library_entries le ON le.series_id = s.id AND le.user_id = $1::uuid
WHERE le.deleted_at IS NULL
  AND s.deleted_at IS NULL
  AND ($3::timestamptz IS NULL OR fe.first_discovered_at < $3::timestamptz)
ORDER BY 
  date_trunc('day', fe.first_discovered_at) DESC,
  is_unread DESC,
  library_status_score DESC,
  sync_priority_score DESC,
  fe.first_discovered_at DESC,
  fe.id ASC
LIMIT $2::int;
```

### 12. Activity Feed (Social)
**Purpose**: Combined activity from user and followed users.

```sql
SELECT 
  a.id, a.type, a.metadata, a.created_at,
  u.username, u.avatar_url,
  s.title as series_title,
  c.chapter_number
FROM activities a
JOIN users u ON a.user_id = u.id
LEFT JOIN series s ON a.series_id = s.id
LEFT JOIN chapters c ON a.logical_chapter_id = c.id
WHERE (
  a.user_id = $1::uuid 
  OR EXISTS (
    SELECT 1 FROM follows f 
    WHERE f.following_id = a.user_id AND f.follower_id = $1::uuid
  )
)
AND u.deleted_at IS NULL
AND (s.id IS NULL OR s.deleted_at IS NULL)
AND (c.id IS NULL OR c.deleted_at IS NULL)
ORDER BY a.created_at DESC
LIMIT $2::int;
```

### 13. Global Availability Feed
**Purpose**: Real-time chapter availability across all sources.

```sql
WITH ranked_sources AS (
  SELECT 
    cs.id,
    cs.chapter_id,
    cs.source_name,
    cs.source_chapter_url,
    cs.detected_at,
    c.chapter_number,
    c.chapter_title,
    s.id as series_id,
    s.title as series_title,
    s.cover_url,
    ROW_NUMBER() OVER (
      PARTITION BY cs.chapter_id 
      ORDER BY cs.detected_at ASC
    ) as source_rank
  FROM chapter_sources cs
  JOIN chapters c ON cs.chapter_id = c.id
  JOIN series s ON c.series_id = s.id
  WHERE cs.is_available = true
    AND c.deleted_at IS NULL
    AND s.deleted_at IS NULL
    AND cs.detected_at > NOW() - INTERVAL '7 days'
)
SELECT 
  chapter_id,
  series_id,
  series_title,
  cover_url,
  chapter_number,
  chapter_title,
  jsonb_agg(
    jsonb_build_object(
      'source_name', source_name,
      'source_url', source_chapter_url,
      'detected_at', detected_at
    ) ORDER BY detected_at ASC
  ) as sources,
  MIN(detected_at) as first_available_at
FROM ranked_sources
GROUP BY chapter_id, series_id, series_title, cover_url, chapter_number, chapter_title
ORDER BY first_available_at DESC
LIMIT $1::int;
```

### 14. Mark Feed as Seen
**Purpose**: Update user's feed last seen timestamp.

```sql
UPDATE users
SET feed_last_seen_at = NOW()
WHERE id = $1::uuid
  AND deleted_at IS NULL;
```

---

## Series Discovery & Search

### 15. Series Search (Full-text with Safe Browsing)
**Purpose**: Search series with content filtering and ranking.

```sql
SELECT 
  id, 
  title,
  alternative_titles,
  cover_url, 
  type, 
  status, 
  genres, 
  content_rating, 
  total_follows,
  ts_rank(
    to_tsvector('english', title || ' ' || COALESCE(alternative_titles::text, '')),
    plainto_tsquery('english', $1::text)
  ) as relevance
FROM series 
WHERE (
  title ILIKE '%' || $1::text || '%' 
  OR alternative_titles::text ILIKE '%' || $1::text || '%'
  OR to_tsvector('english', title) @@ plainto_tsquery('english', $1::text)
)
AND (
  ($2::text = 'sfw' AND (content_rating IS NULL OR content_rating IN ('safe', 'suggestive'))) OR
  ($2::text = 'questionable' AND (content_rating IS NULL OR content_rating IN ('safe', 'suggestive', 'questionable'))) OR
  ($2::text = 'nsfw')
)
AND deleted_at IS NULL
ORDER BY relevance DESC, total_follows DESC
LIMIT $3::int;
```

### 16. Series by Genre/Tag Filter
**Purpose**: Browse series by genre with pagination.

```sql
SELECT 
  id, title, cover_url, type, status, 
  genres, content_rating, total_follows
FROM series 
WHERE genres @> $1::varchar[]
  AND (
    ($2::text = 'sfw' AND (content_rating IS NULL OR content_rating IN ('safe', 'suggestive'))) OR
    ($2::text = 'questionable' AND (content_rating IS NULL OR content_rating IN ('safe', 'suggestive', 'questionable'))) OR
    ($2::text = 'nsfw')
  )
  AND deleted_at IS NULL
ORDER BY total_follows DESC
LIMIT $3::int OFFSET $4::int;
```

### 17. Trending Series
**Purpose**: Series with recent activity weighted by recency.

```sql
WITH recent_activity AS (
  SELECT 
    series_id,
    SUM(weight * POWER(0.95, EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400)) as trend_score
  FROM series_activity_events
  WHERE created_at > NOW() - INTERVAL '7 days'
  GROUP BY series_id
)
SELECT 
  s.id, s.title, s.cover_url, s.type, s.status,
  s.genres, s.content_rating, s.total_follows,
  COALESCE(ra.trend_score, 0) as trend_score
FROM series s
LEFT JOIN recent_activity ra ON s.id = ra.series_id
WHERE s.deleted_at IS NULL
  AND (
    ($1::text = 'sfw' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive'))) OR
    ($1::text = 'questionable' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive', 'questionable'))) OR
    ($1::text = 'nsfw')
  )
ORDER BY trend_score DESC, s.total_follows DESC
LIMIT $2::int;
```

### 18. Series Detail with Stats
**Purpose**: Full series information for detail page.

```sql
SELECT 
  s.*,
  ss.total_readers,
  ss.readers_reading,
  ss.readers_completed,
  ss.readers_planning,
  ss.readers_dropped,
  ss.readers_on_hold,
  ss.popularity_rank,
  ss.trending_rank,
  (
    SELECT COUNT(*) 
    FROM chapters c 
    WHERE c.series_id = s.id AND c.deleted_at IS NULL
  ) as chapter_count,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', src.id,
        'source_name', src.source_name,
        'source_url', src.source_url,
        'trust_score', src.trust_score
      )
    )
    FROM series_sources src
    WHERE src.series_id = s.id AND src.source_status = 'active'
  ) as sources
FROM series s
LEFT JOIN series_stats ss ON s.id = ss.series_id
WHERE s.id = $1::uuid
  AND s.deleted_at IS NULL;
```

### 19. Series Recommendations
**Purpose**: Personalized recommendations based on user affinity.

```sql
SELECT 
  ur.series_id,
  s.title,
  s.cover_url,
  s.type,
  s.genres,
  s.content_rating,
  ur.score,
  ur.reason
FROM user_recommendations ur
JOIN series s ON ur.series_id = s.id
WHERE ur.user_id = $1::uuid
  AND s.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM library_entries le
    WHERE le.user_id = $1::uuid 
      AND le.series_id = s.id 
      AND le.deleted_at IS NULL
  )
  AND (
    ($2::text = 'sfw' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive'))) OR
    ($2::text = 'questionable' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive', 'questionable'))) OR
    ($2::text = 'nsfw')
  )
ORDER BY ur.score DESC
LIMIT $3::int;
```

---

## Chapter Tracking

### 20. Get Series Chapters (Paginated)
**Purpose**: Chapter list for series detail page.

```sql
SELECT 
  c.id,
  c.chapter_number,
  c.chapter_title,
  c.volume_number,
  c.published_at,
  c.first_detected_at,
  EXISTS(
    SELECT 1 FROM user_chapter_reads_v2 ucr 
    WHERE ucr.chapter_id = c.id AND ucr.user_id = $1::uuid
  ) as is_read,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', cs.id,
        'source_name', cs.source_name,
        'source_url', cs.source_chapter_url,
        'is_available', cs.is_available
      ) ORDER BY cs.is_preferred DESC, cs.detected_at ASC
    )
    FROM chapter_sources cs
    WHERE cs.chapter_id = c.id AND cs.is_available = true
  ) as sources
FROM chapters c
WHERE c.series_id = $2::uuid
  AND c.deleted_at IS NULL
ORDER BY c.chapter_number::numeric DESC
LIMIT $3::int OFFSET $4::int;
```

### 21. Mark Chapter as Read
**Purpose**: Record chapter read with optional source tracking.

```sql
INSERT INTO user_chapter_reads_v2 (
  user_id, chapter_id, source_used_id, source_name, is_read
)
VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, true)
ON CONFLICT (user_id, chapter_id)
DO UPDATE SET
  source_used_id = COALESCE(EXCLUDED.source_used_id, user_chapter_reads_v2.source_used_id),
  source_name = COALESCE(EXCLUDED.source_name, user_chapter_reads_v2.source_name),
  is_read = true,
  read_at = NOW(),
  updated_at = NOW()
RETURNING *;
```

### 22. Mark Chapter as Unread
**Purpose**: Toggle read status off.

```sql
UPDATE user_chapter_reads_v2
SET 
  is_read = false,
  updated_at = NOW()
WHERE user_id = $1::uuid
  AND chapter_id = $2::uuid
RETURNING *;
```

### 23. Bulk Mark Chapters Read (Up to Chapter X)
**Purpose**: Mark all chapters up to a certain number as read.

```sql
INSERT INTO user_chapter_reads_v2 (user_id, chapter_id, is_read)
SELECT $1::uuid, c.id, true
FROM chapters c
WHERE c.series_id = $2::uuid
  AND c.chapter_number::numeric <= $3::numeric
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_chapter_reads_v2 ucr
    WHERE ucr.user_id = $1::uuid AND ucr.chapter_id = c.id
  )
ON CONFLICT (user_id, chapter_id)
DO UPDATE SET is_read = true, updated_at = NOW();
```

### 24. Get Read Progress for Series
**Purpose**: Calculate reading progress percentage.

```sql
SELECT 
  COUNT(*) FILTER (WHERE ucr.is_read = true) as chapters_read,
  COUNT(*) as total_chapters,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE ucr.is_read = true) / NULLIF(COUNT(*), 0),
    1
  ) as progress_percent,
  MAX(c.chapter_number::numeric) FILTER (WHERE ucr.is_read = true) as last_read_chapter
FROM chapters c
LEFT JOIN user_chapter_reads_v2 ucr ON c.id = ucr.chapter_id AND ucr.user_id = $1::uuid
WHERE c.series_id = $2::uuid
  AND c.deleted_at IS NULL;
```

---

## Social Features

### 25. Follow User
**Purpose**: Create follow relationship.

```sql
INSERT INTO follows (follower_id, following_id)
VALUES ($1::uuid, $2::uuid)
ON CONFLICT (follower_id, following_id) DO NOTHING
RETURNING *;
```

### 26. Unfollow User
**Purpose**: Remove follow relationship.

```sql
DELETE FROM follows
WHERE follower_id = $1::uuid
  AND following_id = $2::uuid
RETURNING id;
```

### 27. Get User Followers (Paginated)
**Purpose**: List users following a profile.

```sql
SELECT 
  u.id, u.username, u.avatar_url, u.bio,
  u.xp, u.level,
  EXISTS(
    SELECT 1 FROM follows f2 
    WHERE f2.follower_id = $1::uuid AND f2.following_id = u.id
  ) as is_following_back,
  f.created_at as followed_at
FROM follows f
JOIN users u ON f.follower_id = u.id
WHERE f.following_id = $2::uuid
  AND u.deleted_at IS NULL
ORDER BY f.created_at DESC
LIMIT $3::int OFFSET $4::int;
```

### 28. Get User Following (Paginated)
**Purpose**: List users that a profile follows.

```sql
SELECT 
  u.id, u.username, u.avatar_url, u.bio,
  u.xp, u.level,
  f.created_at as followed_at
FROM follows f
JOIN users u ON f.following_id = u.id
WHERE f.follower_id = $1::uuid
  AND u.deleted_at IS NULL
ORDER BY f.created_at DESC
LIMIT $2::int OFFSET $3::int;
```

### 29. Check Follow Status
**Purpose**: Determine if current user follows target.

```sql
SELECT EXISTS (
  SELECT 1 FROM follows 
  WHERE follower_id = $1::uuid AND following_id = $2::uuid
) as is_following;
```

---

## Gamification

### 30. Get User XP & Level
**Purpose**: Retrieve gamification stats.

```sql
SELECT 
  xp, level, streak_days, longest_streak,
  season_xp, current_season, trust_score,
  chapters_read, active_days
FROM users
WHERE id = $1::uuid
  AND deleted_at IS NULL;
```

### 31. Award XP
**Purpose**: Add XP with rate limiting check.

```sql
UPDATE users
SET 
  xp = xp + $2::int,
  season_xp = season_xp + $2::int,
  level = FLOOR(1 + SQRT(xp / 100)),
  last_xp_award_at = NOW(),
  updated_at = NOW()
WHERE id = $1::uuid
  AND deleted_at IS NULL
  AND (last_xp_award_at IS NULL OR last_xp_award_at < NOW() - INTERVAL '1 second')
RETURNING xp, level, season_xp;
```

### 32. Get Leaderboard (Global)
**Purpose**: Ranked users by XP with trust score weighting.

```sql
SELECT 
  id, username, avatar_url,
  xp, level, 
  ROUND(xp * trust_score) as effective_xp,
  ROW_NUMBER() OVER (ORDER BY xp * trust_score DESC) as rank
FROM users
WHERE deleted_at IS NULL
  AND (privacy_settings->>'activity_public')::boolean = true
ORDER BY effective_xp DESC
LIMIT $1::int OFFSET $2::int;
```

### 33. Get Seasonal Leaderboard
**Purpose**: Ranked users by seasonal XP.

```sql
SELECT 
  u.id, u.username, u.avatar_url,
  u.season_xp,
  ROUND(u.season_xp * u.trust_score) as effective_season_xp,
  ROW_NUMBER() OVER (ORDER BY u.season_xp * u.trust_score DESC) as rank
FROM users u
WHERE u.deleted_at IS NULL
  AND u.current_season = $1::text
  AND (u.privacy_settings->>'activity_public')::boolean = true
ORDER BY effective_season_xp DESC
LIMIT $2::int OFFSET $3::int;
```

### 34. Get User Achievements
**Purpose**: List unlocked achievements.

```sql
SELECT 
  a.id, a.code, a.name, a.description, a.icon_url,
  a.xp_reward, a.rarity, a.is_hidden,
  ua.unlocked_at
FROM user_achievements ua
JOIN achievements a ON ua.achievement_id = a.id
WHERE ua.user_id = $1::uuid
ORDER BY ua.unlocked_at DESC;
```

### 35. Unlock Achievement
**Purpose**: Award achievement if not already unlocked.

```sql
INSERT INTO user_achievements (user_id, achievement_id)
SELECT $1::uuid, $2::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM user_achievements
  WHERE user_id = $1::uuid AND achievement_id = $2::uuid
)
RETURNING *;
```

### 36. Update Reading Streak
**Purpose**: Maintain or reset daily streak.

```sql
UPDATE users
SET 
  streak_days = CASE
    WHEN last_read_at::date = CURRENT_DATE - INTERVAL '1 day' THEN streak_days + 1
    WHEN last_read_at::date = CURRENT_DATE THEN streak_days
    ELSE 1
  END,
  longest_streak = GREATEST(longest_streak, 
    CASE
      WHEN last_read_at::date = CURRENT_DATE - INTERVAL '1 day' THEN streak_days + 1
      WHEN last_read_at::date = CURRENT_DATE THEN streak_days
      ELSE 1
    END
  ),
  last_read_at = NOW(),
  updated_at = NOW()
WHERE id = $1::uuid
  AND deleted_at IS NULL
RETURNING streak_days, longest_streak;
```

---

## Analytics & Signals

### 37. Record User Signal
**Purpose**: Track user interaction for recommendations.

```sql
INSERT INTO user_signals (user_id, series_id, signal_type, weight, metadata)
VALUES ($1::uuid, $2::uuid, $3::text, $4::float, $5::jsonb);
```

### 38. Update User Affinity
**Purpose**: Adjust affinity scores based on signals.

```sql
INSERT INTO user_affinities (user_id, attribute_type, attribute_id, score)
VALUES ($1::uuid, $2::text, $3::text, $4::float)
ON CONFLICT (user_id, attribute_type, attribute_id)
DO UPDATE SET 
  score = user_affinities.score + EXCLUDED.score,
  last_updated_at = NOW();
```

### 39. Get User Affinity Profile
**Purpose**: Retrieve user's content preferences.

```sql
SELECT 
  attribute_type, attribute_id, score
FROM user_affinities
WHERE user_id = $1::uuid
ORDER BY score DESC
LIMIT 50;
```

### 40. Record Read Telemetry
**Purpose**: Anti-cheat tracking (detection only).

```sql
INSERT INTO read_telemetry (
  user_id, series_id, chapter_number, 
  read_duration_s, page_count, device_id,
  flagged, flag_reason
)
VALUES (
  $1::uuid, $2::uuid, $3::int,
  $4::int, $5::int, $6::text,
  $7::boolean, $8::text
);
```

---

## Admin & Maintenance

### 41. Get Import Job Summary
**Purpose**: Aggregate import statistics.

```sql
SELECT 
  status,
  reason_code,
  COUNT(*) as item_count
FROM import_items
WHERE job_id = $1::uuid
GROUP BY status, reason_code
ORDER BY status ASC;
```

### 42. Get Pending Metadata Enrichment
**Purpose**: Find library entries needing metadata resolution.

```sql
SELECT 
  le.id, le.source_url, le.source_name, le.imported_title,
  le.metadata_retry_count, le.last_metadata_attempt_at
FROM library_entries le
WHERE le.metadata_status = 'pending'
  AND le.deleted_at IS NULL
  AND (
    le.last_metadata_attempt_at IS NULL 
    OR le.last_metadata_attempt_at < NOW() - INTERVAL '1 hour'
  )
  AND le.metadata_retry_count < 5
ORDER BY le.last_metadata_attempt_at ASC NULLS FIRST
LIMIT $1::int;
```

### 43. Get Series with Stale Sync
**Purpose**: Find sources needing chapter sync.

```sql
SELECT 
  ss.id, ss.series_id, ss.source_name, ss.source_url,
  ss.sync_priority, ss.next_check_at, ss.failure_count
FROM series_sources ss
WHERE ss.source_status = 'active'
  AND (ss.next_check_at IS NULL OR ss.next_check_at < NOW())
  AND ss.failure_count < 10
ORDER BY 
  CASE ss.sync_priority 
    WHEN 'HIGH' THEN 1 
    WHEN 'WARM' THEN 2 
    ELSE 3 
  END,
  ss.next_check_at ASC NULLS FIRST
LIMIT $1::int;
```

### 44. Record Worker Failure
**Purpose**: DLQ entry for failed jobs.

```sql
INSERT INTO worker_failures (
  queue_name, job_id, payload, 
  error_message, stack_trace, attempts_made
)
VALUES ($1::text, $2::text, $3::jsonb, $4::text, $5::text, $6::int)
RETURNING id;
```

### 45. Get DLQ Items for Retry
**Purpose**: Retrieve unresolved failures for retry.

```sql
SELECT 
  id, queue_name, job_id, payload,
  error_message, attempts_made, created_at
FROM worker_failures
WHERE resolved_at IS NULL
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT $1::int;
```

---

## Index Recommendations

### Critical Performance Indexes

```sql
-- Feed query optimization (primary bottleneck)
CREATE INDEX CONCURRENTLY idx_feed_entries_series_discovered
ON feed_entries (series_id, first_discovered_at DESC);

CREATE INDEX CONCURRENTLY idx_feed_entries_logical_chapter
ON feed_entries (logical_chapter_id) WHERE logical_chapter_id IS NOT NULL;

-- Library join optimization
CREATE INDEX CONCURRENTLY idx_library_entries_user_series_status
ON library_entries (user_id, series_id, status) WHERE deleted_at IS NULL;

-- Read state lookups
CREATE INDEX CONCURRENTLY idx_user_chapter_reads_v2_user_chapter
ON user_chapter_reads_v2 (user_id, chapter_id);

-- Activity feed
CREATE INDEX CONCURRENTLY idx_activities_user_created
ON activities (user_id, created_at DESC);

-- Follow expansion
CREATE INDEX CONCURRENTLY idx_follows_follower_following
ON follows (follower_id, following_id);
```

---

## Query Parameterization Notes

| Parameter | Type | Description |
|-----------|------|-------------|
| `$1::uuid` | UUID | User ID (most common) |
| `$2::text` | Text | Search query, status filter |
| `$3::int` | Integer | Limit/pagination |
| `$4::int` | Integer | Offset |
| `$5::timestamptz` | Timestamp | Cursor for keyset pagination |
| `$N::jsonb` | JSONB | Metadata, settings objects |

All queries use parameterized values to prevent SQL injection.

---

## Soft Delete Convention

All queries respect the `deleted_at IS NULL` convention:

```sql
-- Always include in WHERE clauses:
WHERE table.deleted_at IS NULL

-- For JOINs with soft-deleted tables:
LEFT JOIN series s ON le.series_id = s.id AND s.deleted_at IS NULL
```

Tables with soft delete:
- `users`
- `series`
- `chapters`
- `library_entries`
