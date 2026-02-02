# SQL Query Reference - Production Database Queries

**Project:** Manga/Anime Tracking Application  
**Database:** PostgreSQL (Supabase)  
**ORM:** Prisma  
**Last Updated:** January 17, 2026

---

## Table of Contents

1. [Schema Overview](#schema-overview)
2. [User & Authentication Queries](#user--authentication-queries)
3. [Library Management Queries](#library-management-queries)
4. [Series & Chapter Queries](#series--chapter-queries)
5. [Feed & Updates Queries](#feed--updates-queries)
6. [Leaderboard & XP Queries](#leaderboard--xp-queries)
7. [Social Features Queries](#social-features-queries)
8. [Discovery & Search Queries](#discovery--search-queries)
9. [Analytics & Reporting Queries](#analytics--reporting-queries)
10. [Admin & Maintenance Queries](#admin--maintenance-queries)

---

## Schema Overview

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | User accounts | `id`, `username`, `xp`, `level`, `season_xp`, `trust_score` |
| `series` | Manga/manhwa catalog | `id`, `title`, `genres[]`, `status`, `content_rating` |
| `chapters` | Logical chapters | `id`, `series_id`, `chapter_number`, `published_at` |
| `library_entries` | User library | `user_id`, `series_id`, `status`, `last_read_chapter` |
| `user_chapter_reads_v2` | Read history | `user_id`, `chapter_id`, `read_at` |
| `follows` | Social graph | `follower_id`, `following_id` |
| `seasons` | Anime-style seasons | `id`, `code` (YYYY-Q[1-4]), `is_active` |

---

## User & Authentication Queries

### 1. Get User Profile

**Purpose:** Retrieve complete user profile with computed fields.

```sql
SELECT 
    u.id,
    u.username,
    u.email,
    u.avatar_url,
    u.bio,
    u.xp,
    u.level,
    u.streak_days,
    u.longest_streak,
    u.chapters_read,
    u.season_xp,
    u.current_season,
    u.trust_score,
    u.subscription_tier,
    u.safe_browsing_mode,
    u.privacy_settings,
    u.created_at,
    -- Computed: follower count
    (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
    -- Computed: following count
    (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
    -- Computed: library count
    (SELECT COUNT(*) FROM library_entries le WHERE le.user_id = u.id AND le.deleted_at IS NULL) AS library_count
FROM users u
WHERE u.id = $1::uuid
  AND u.deleted_at IS NULL;
```

**Parameters:** `$1` = user UUID

---

### 2. Check Username Availability

**Purpose:** Verify username is available during registration.

```sql
SELECT EXISTS(
    SELECT 1 FROM users 
    WHERE LOWER(username) = LOWER($1)
      AND deleted_at IS NULL
) AS taken;
```

**Parameters:** `$1` = username to check

---

### 3. Login Attempt Rate Limiting

**Purpose:** Check if user/IP has exceeded login attempts.

```sql
SELECT COUNT(*) AS attempt_count
FROM login_attempts
WHERE (email = $1 OR ip_address = $2)
  AND attempted_at > NOW() - INTERVAL '15 minutes'
  AND success = false;
```

**Parameters:** `$1` = email, `$2` = IP address  
**Business Rule:** Block if `attempt_count >= 5`

---

### 4. Account Lockout Check

**Purpose:** Determine if account should be locked due to suspicious activity.

```sql
SELECT 
    COUNT(*) AS failed_count,
    MAX(attempted_at) AS last_attempt
FROM login_attempts
WHERE email = $1
  AND success = false
  AND attempted_at > NOW() - INTERVAL '1 hour';
```

**Parameters:** `$1` = email  
**Business Rule:** Lock if `failed_count >= 10`

---

## Library Management Queries

### 5. Get User Library with Unread Counts

**Purpose:** Display user's library with accurate unread chapter counts.

```sql
SELECT 
    le.id, 
    s.id AS series_id,
    s.title, 
    s.cover_url,
    s.status AS series_status,
    le.status,
    le.last_read_chapter,
    le.last_read_at,
    le.user_rating,
    le.notify_new_chapters,
    -- Latest available chapter
    (SELECT MAX(c.chapter_number::numeric) 
     FROM chapters c 
     WHERE c.series_id = s.id 
       AND c.deleted_at IS NULL) AS latest_chapter,
    -- Unread count (chapters not in user_chapter_reads_v2)
    COUNT(c.id) FILTER (
        WHERE c.deleted_at IS NULL 
        AND NOT EXISTS (
            SELECT 1 FROM user_chapter_reads_v2 ucr 
            WHERE ucr.chapter_id = c.id 
              AND ucr.user_id = le.user_id
        )
    ) AS unread_count
FROM library_entries le
JOIN series s ON le.series_id = s.id
LEFT JOIN chapters c ON c.series_id = s.id
WHERE le.user_id = $1::uuid 
  AND le.deleted_at IS NULL
  AND s.deleted_at IS NULL
  AND ($2::varchar IS NULL OR le.status = $2)
GROUP BY le.id, s.id
ORDER BY 
    CASE WHEN le.status = 'reading' THEN 0
         WHEN le.status = 'on_hold' THEN 1
         WHEN le.status = 'planning' THEN 2
         WHEN le.status = 'completed' THEN 3
         ELSE 4 END,
    le.last_read_at DESC NULLS LAST;
```

**Parameters:** `$1` = user UUID, `$2` = status filter (nullable)

---

### 6. Update Library Entry Status

**Purpose:** Change reading status with timestamp tracking.

```sql
UPDATE library_entries
SET 
    status = $2,
    updated_at = NOW(),
    last_read_at = CASE 
        WHEN $2 = 'reading' THEN COALESCE(last_read_at, NOW())
        ELSE last_read_at
    END
WHERE id = $1::uuid
  AND deleted_at IS NULL
RETURNING *;
```

**Parameters:** `$1` = entry UUID, `$2` = new status

---

### 7. Mark Chapters as Read (Bulk)

**Purpose:** Mark multiple chapters as read efficiently.

```sql
INSERT INTO user_chapter_reads_v2 (user_id, chapter_id, read_at, source_name)
SELECT 
    $1::uuid,
    unnest($2::uuid[]),
    NOW(),
    $3
ON CONFLICT (user_id, chapter_id) 
DO UPDATE SET 
    read_at = NOW(),
    updated_at = NOW(),
    source_name = EXCLUDED.source_name;
```

**Parameters:** `$1` = user UUID, `$2` = chapter UUID array, `$3` = source name

---

### 8. Get Reading Progress for Series

**Purpose:** Show which chapters user has read for a specific series.

```sql
SELECT 
    c.id,
    c.chapter_number,
    c.chapter_title,
    c.published_at,
    ucr.read_at,
    ucr.source_name AS read_on_source,
    (ucr.id IS NOT NULL) AS is_read
FROM chapters c
LEFT JOIN user_chapter_reads_v2 ucr 
    ON c.id = ucr.chapter_id 
    AND ucr.user_id = $1::uuid
WHERE c.series_id = $2::uuid
  AND c.deleted_at IS NULL
ORDER BY c.chapter_number::numeric DESC;
```

**Parameters:** `$1` = user UUID, `$2` = series UUID

---

## Series & Chapter Queries

### 9. Get Series with All Sources

**Purpose:** Display series details with all available reading sources.

```sql
SELECT 
    s.*,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'id', ss.id,
                'source_name', ss.source_name,
                'source_url', ss.source_url,
                'chapter_count', ss.source_chapter_count,
                'is_primary_cover', ss.is_primary_cover,
                'status', ss.source_status
            ) ORDER BY ss.trust_score DESC
        ) FILTER (WHERE ss.id IS NOT NULL),
        '[]'::jsonb
    ) AS sources,
    -- Stats
    st.total_readers,
    st.readers_reading,
    st.readers_completed,
    st.popularity_rank,
    st.trending_rank
FROM series s
LEFT JOIN series_sources ss ON ss.series_id = s.id AND ss.source_status = 'active'
LEFT JOIN series_stats st ON st.series_id = s.id
WHERE s.id = $1::uuid
  AND s.deleted_at IS NULL
GROUP BY s.id, st.id;
```

**Parameters:** `$1` = series UUID

---

### 10. Get Chapters with Multi-Source Support

**Purpose:** List chapters with all source availability.

```sql
SELECT 
    c.id,
    c.chapter_number,
    c.chapter_title,
    c.volume_number,
    c.page_count,
    c.published_at,
    c.first_detected_at,
    jsonb_agg(
        jsonb_build_object(
            'source_name', cs.source_name,
            'source_url', cs.source_chapter_url,
            'is_available', cs.is_available,
            'is_preferred', cs.is_preferred,
            'scanlation_group', cs.scanlation_group,
            'language', cs.language,
            'detected_at', cs.detected_at
        ) ORDER BY cs.is_preferred DESC, cs.detected_at ASC
    ) AS sources,
    EXISTS(
        SELECT 1 FROM user_chapter_reads_v2 ucr 
        WHERE ucr.chapter_id = c.id AND ucr.user_id = $2::uuid
    ) AS is_read
FROM chapters c
LEFT JOIN chapter_sources cs ON c.id = cs.chapter_id AND cs.is_available = true
WHERE c.series_id = $1::uuid
  AND c.deleted_at IS NULL
GROUP BY c.id
ORDER BY c.chapter_number::numeric DESC
LIMIT $3 OFFSET $4;
```

**Parameters:** `$1` = series UUID, `$2` = user UUID (nullable), `$3` = limit, `$4` = offset

---

### 11. Search Series (Safe Browsing Aware)

**Purpose:** Search catalog with content rating filters.

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
    average_rating
FROM series 
WHERE (
    title ILIKE '%' || $1 || '%' 
    OR alternative_titles::text ILIKE '%' || $1 || '%'
)
AND (
    -- Safe Browsing Filter
    ($2 = 'sfw' AND content_rating IN ('safe', 'suggestive') OR content_rating IS NULL) OR
    ($2 = 'questionable' AND content_rating IN ('safe', 'suggestive', 'questionable') OR content_rating IS NULL) OR
    ($2 = 'nsfw')
)
AND deleted_at IS NULL
ORDER BY 
    CASE WHEN title ILIKE $1 || '%' THEN 0 ELSE 1 END,  -- Exact prefix match first
    total_follows DESC
LIMIT $3;
```

**Parameters:** `$1` = search query, `$2` = safe_browsing_mode, `$3` = limit

---

## Feed & Updates Queries

### 12. User Updates Feed (Ranked)

**Purpose:** Show new chapters for user's library with intelligent ranking.

```sql
SELECT 
    fe.id, 
    s.id AS series_id,
    s.title, 
    s.cover_url,
    fe.chapter_number, 
    fe.first_discovered_at,
    fe.sources,
    -- Ranking signals
    (CASE WHEN EXISTS (
        SELECT 1 FROM user_chapter_reads_v2 ucr 
        WHERE ucr.chapter_id = fe.logical_chapter_id 
          AND ucr.user_id = $1::uuid
    ) THEN 0 ELSE 1 END) AS is_unread,
    (CASE le.status 
        WHEN 'reading' THEN 3 
        WHEN 'on_hold' THEN 2 
        WHEN 'planning' THEN 1 
        ELSE 0 
    END) AS library_status_score,
    le.sync_priority
FROM feed_entries fe
JOIN series s ON fe.series_id = s.id
JOIN library_entries le ON le.series_id = s.id AND le.user_id = $1::uuid
WHERE le.deleted_at IS NULL
  AND s.deleted_at IS NULL
  AND fe.first_discovered_at > $2::timestamptz
ORDER BY 
    DATE_TRUNC('day', fe.first_discovered_at) DESC,
    is_unread DESC,
    library_status_score DESC,
    fe.first_discovered_at DESC
LIMIT $3;
```

**Parameters:** `$1` = user UUID, `$2` = since timestamp, `$3` = limit

---

### 13. Global Chapter Availability Feed

**Purpose:** Show latest chapters discovered across all sources.

```sql
WITH latest_sources AS (
    SELECT 
        cs.chapter_id,
        cs.source_name,
        cs.source_chapter_url,
        cs.detected_at,
        ROW_NUMBER() OVER (
            PARTITION BY cs.chapter_id 
            ORDER BY cs.detected_at DESC
        ) AS rn
    FROM chapter_sources cs
    WHERE cs.is_available = true
)
SELECT 
    c.id AS chapter_id,
    c.chapter_number,
    c.chapter_title,
    s.id AS series_id,
    s.title AS series_title,
    s.cover_url,
    ls.source_name,
    ls.source_chapter_url,
    ls.detected_at,
    (SELECT COUNT(*) FROM chapter_sources WHERE chapter_id = c.id AND is_available = true) AS source_count
FROM latest_sources ls
JOIN chapters c ON ls.chapter_id = c.id
JOIN series s ON c.series_id = s.id
WHERE ls.rn = 1
  AND c.deleted_at IS NULL
  AND s.deleted_at IS NULL
ORDER BY ls.detected_at DESC
LIMIT $1;
```

**Parameters:** `$1` = limit

---

### 14. Unread Notifications Count

**Purpose:** Show badge count for unread notifications.

```sql
SELECT COUNT(*) AS unread_count
FROM notifications
WHERE user_id = $1::uuid
  AND read_at IS NULL
  AND created_at > NOW() - INTERVAL '30 days';
```

**Parameters:** `$1` = user UUID

---

## Leaderboard & XP Queries

### 15. Seasonal Leaderboard (Current Season)

**Purpose:** Rank users by seasonal XP with trust score weighting.

```sql
SELECT
    ROW_NUMBER() OVER (ORDER BY (us.xp * u.trust_score) DESC) AS rank,
    u.id,
    u.username,
    u.avatar_url,
    u.level,
    us.xp AS season_xp,
    FLOOR(us.xp * u.trust_score) AS effective_xp,
    s.code AS season_code,
    s.name AS season_name
FROM user_season_xp us
JOIN users u ON u.id = us.user_id
JOIN seasons s ON s.id = us.season_id
WHERE s.is_active = true
  AND u.deleted_at IS NULL
ORDER BY effective_xp DESC
LIMIT $1;
```

**Parameters:** `$1` = limit  
**Key:** Uses `season_xp` only, not lifetime `xp`

---

### 16. All-Time Leaderboard (Lifetime XP)

**Purpose:** Rank users by total lifetime XP.

```sql
SELECT
    ROW_NUMBER() OVER (ORDER BY (u.xp * u.trust_score) DESC) AS rank,
    u.id,
    u.username,
    u.avatar_url,
    u.xp,
    u.level,
    u.streak_days,
    u.chapters_read,
    FLOOR(u.xp * u.trust_score) AS effective_xp
FROM users u
WHERE u.deleted_at IS NULL
  AND u.xp > 0
ORDER BY effective_xp DESC
LIMIT $1;
```

**Parameters:** `$1` = limit

---

### 17. Get User's Rank (Both Leaderboards)

**Purpose:** Get current user's position in leaderboards.

```sql
-- All-time rank
SELECT rank FROM (
    SELECT
        u.id,
        ROW_NUMBER() OVER (ORDER BY (u.xp * u.trust_score) DESC) AS rank
    FROM users u
    WHERE u.deleted_at IS NULL AND u.xp > 0
) ranked
WHERE id = $1::uuid;

-- Seasonal rank
SELECT rank FROM (
    SELECT
        us.user_id AS id,
        ROW_NUMBER() OVER (ORDER BY (us.xp * u.trust_score) DESC) AS rank
    FROM user_season_xp us
    JOIN users u ON u.id = us.user_id
    JOIN seasons s ON s.id = us.season_id
    WHERE s.is_active = true AND u.deleted_at IS NULL
) ranked
WHERE id = $1::uuid;
```

**Parameters:** `$1` = user UUID

---

### 18. XP Progress Details

**Purpose:** Get comprehensive XP progress for dashboard.

```sql
SELECT 
    u.xp,
    u.level,
    u.season_xp,
    u.current_season,
    u.streak_days,
    u.longest_streak,
    u.chapters_read,
    u.trust_score,
    u.last_read_at,
    u.active_days,
    -- Calculate progress to next level
    -- Level formula: floor(sqrt(xp/100)) + 1
    -- XP for level N: (N-1)^2 * 100
    ((u.level) * (u.level) * 100) AS xp_for_next_level,
    ((u.level - 1) * (u.level - 1) * 100) AS xp_for_current_level,
    -- Season info
    s.name AS season_name,
    s.ends_at AS season_ends_at
FROM users u
LEFT JOIN seasons s ON s.code = u.current_season
WHERE u.id = $1::uuid
  AND u.deleted_at IS NULL;
```

**Parameters:** `$1` = user UUID

---

### 19. Award XP with Season Rollover

**Purpose:** Atomically award XP handling season boundaries.

```sql
-- This should be a transaction in application code
UPDATE users
SET 
    xp = xp + $2,
    season_xp = CASE 
        WHEN current_season = $3 THEN season_xp + $2
        ELSE $2  -- New season, reset
    END,
    current_season = $3,
    level = FLOOR(SQRT((xp + $2) / 100.0)) + 1,
    chapters_read = chapters_read + $4,
    last_read_at = NOW(),
    last_xp_award_at = NOW(),
    -- Update streak
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
    updated_at = NOW()
WHERE id = $1::uuid
RETURNING *;
```

**Parameters:** `$1` = user UUID, `$2` = XP amount, `$3` = current season code, `$4` = chapters read increment

---

## Social Features Queries

### 20. Get User's Following List

**Purpose:** List users that current user follows.

```sql
SELECT 
    u.id,
    u.username,
    u.avatar_url,
    u.bio,
    u.level,
    u.xp,
    f.created_at AS followed_at,
    -- Check if they follow back
    EXISTS(
        SELECT 1 FROM follows f2 
        WHERE f2.follower_id = u.id AND f2.following_id = $1::uuid
    ) AS follows_back
FROM follows f
JOIN users u ON f.following_id = u.id
WHERE f.follower_id = $1::uuid
  AND u.deleted_at IS NULL
ORDER BY f.created_at DESC
LIMIT $2 OFFSET $3;
```

**Parameters:** `$1` = user UUID, `$2` = limit, `$3` = offset

---

### 21. Get User's Followers List

**Purpose:** List users who follow current user.

```sql
SELECT 
    u.id,
    u.username,
    u.avatar_url,
    u.bio,
    u.level,
    u.xp,
    f.created_at AS followed_at,
    -- Check if current user follows them back
    EXISTS(
        SELECT 1 FROM follows f2 
        WHERE f2.follower_id = $1::uuid AND f2.following_id = u.id
    ) AS following_back
FROM follows f
JOIN users u ON f.follower_id = u.id
WHERE f.following_id = $1::uuid
  AND u.deleted_at IS NULL
ORDER BY f.created_at DESC
LIMIT $2 OFFSET $3;
```

**Parameters:** `$1` = user UUID, `$2` = limit, `$3` = offset

---

### 22. Follow/Unfollow User

**Purpose:** Toggle follow relationship.

```sql
-- Follow
INSERT INTO follows (follower_id, following_id)
VALUES ($1::uuid, $2::uuid)
ON CONFLICT (follower_id, following_id) DO NOTHING
RETURNING id;

-- Unfollow
DELETE FROM follows
WHERE follower_id = $1::uuid AND following_id = $2::uuid
RETURNING id;
```

**Parameters:** `$1` = follower (current user) UUID, `$2` = following UUID

---

### 23. Activity Feed (Following)

**Purpose:** Show activity from users you follow.

```sql
SELECT 
    a.id,
    a.type,
    a.metadata,
    a.created_at,
    u.id AS user_id,
    u.username,
    u.avatar_url,
    s.id AS series_id,
    s.title AS series_title,
    s.cover_url,
    c.chapter_number
FROM activities a
JOIN users u ON a.user_id = u.id
LEFT JOIN series s ON a.series_id = s.id
LEFT JOIN chapters c ON a.logical_chapter_id = c.id
WHERE (
    a.user_id = $1::uuid 
    OR a.user_id IN (
        SELECT following_id FROM follows WHERE follower_id = $1::uuid
    )
)
AND u.deleted_at IS NULL
AND (s.id IS NULL OR s.deleted_at IS NULL)
ORDER BY a.created_at DESC
LIMIT $2;
```

**Parameters:** `$1` = user UUID, `$2` = limit

---

## Discovery & Search Queries

### 24. Browse Series with Filters

**Purpose:** Advanced series discovery with multiple filter options.

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
    s.themes,
    s.content_rating,
    s.total_follows,
    s.average_rating,
    s.chapter_count,
    s.created_at
FROM series s
WHERE s.deleted_at IS NULL
  -- Search filter
  AND ($1::text IS NULL OR s.title ILIKE '%' || $1 || '%' OR s.description ILIKE '%' || $1 || '%')
  -- Type filter (manga, manhwa, manhua, etc.)
  AND ($2::varchar[] IS NULL OR s.type = ANY($2))
  -- Genre filter (must have ALL specified genres)
  AND ($3::varchar[] IS NULL OR s.genres @> $3)
  -- Theme filter
  AND ($4::varchar[] IS NULL OR s.themes @> $4 OR s.tags @> $4)
  -- Status filter
  AND ($5::varchar[] IS NULL OR s.status = ANY($5))
  -- Content rating filter
  AND ($6::text IS NULL OR s.content_rating = $6)
  -- Minimum chapters
  AND ($7::int IS NULL OR COALESCE(s.chapter_count, 0) >= $7)
ORDER BY s.total_follows DESC
LIMIT $8 OFFSET $9;
```

**Parameters:** `$1` = search, `$2` = types[], `$3` = genres[], `$4` = themes[], `$5` = statuses[], `$6` = content_rating, `$7` = min_chapters, `$8` = limit, `$9` = offset

---

### 25. Trending Series (Recent Activity)

**Purpose:** Show series with high recent activity.

```sql
WITH recent_activity AS (
    SELECT 
        series_id,
        SUM(weight) AS activity_score
    FROM series_activity_events
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY series_id
)
SELECT 
    s.id,
    s.title,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.total_follows,
    ra.activity_score,
    st.trending_rank
FROM series s
JOIN recent_activity ra ON s.id = ra.series_id
LEFT JOIN series_stats st ON s.id = st.series_id
WHERE s.deleted_at IS NULL
ORDER BY ra.activity_score DESC
LIMIT $1;
```

**Parameters:** `$1` = limit

---

### 26. Series with Multiple Sources

**Purpose:** Find series available on 2+ reading sources.

```sql
SELECT 
    s.id,
    s.title,
    s.cover_url,
    s.type,
    s.total_follows,
    COUNT(DISTINCT ss.source_name) AS source_count,
    ARRAY_AGG(DISTINCT ss.source_name) AS sources
FROM series s
JOIN series_sources ss ON ss.series_id = s.id AND ss.source_status = 'active'
WHERE s.deleted_at IS NULL
GROUP BY s.id
HAVING COUNT(DISTINCT ss.source_name) >= 2
ORDER BY source_count DESC, s.total_follows DESC
LIMIT $1;
```

**Parameters:** `$1` = limit

---

### 27. Personalized Recommendations

**Purpose:** Get AI-generated recommendations for user.

```sql
SELECT 
    ur.score,
    ur.reason,
    ur.generated_at,
    s.id,
    s.title,
    s.cover_url,
    s.type,
    s.genres,
    s.average_rating,
    s.total_follows
FROM user_recommendations ur
JOIN series s ON ur.series_id = s.id
WHERE ur.user_id = $1::uuid
  AND s.deleted_at IS NULL
  -- Exclude series already in library
  AND NOT EXISTS (
      SELECT 1 FROM library_entries le 
      WHERE le.user_id = $1::uuid 
        AND le.series_id = s.id
        AND le.deleted_at IS NULL
  )
ORDER BY ur.score DESC
LIMIT $2;
```

**Parameters:** `$1` = user UUID, `$2` = limit

---

## Analytics & Reporting Queries

### 28. User Reading Statistics

**Purpose:** Generate reading stats for profile/dashboard.

```sql
SELECT 
    -- Total stats
    COUNT(DISTINCT ucr.chapter_id) AS total_chapters_read,
    COUNT(DISTINCT c.series_id) AS unique_series_read,
    -- Time-based stats
    COUNT(DISTINCT ucr.chapter_id) FILTER (
        WHERE ucr.read_at > NOW() - INTERVAL '7 days'
    ) AS chapters_this_week,
    COUNT(DISTINCT ucr.chapter_id) FILTER (
        WHERE ucr.read_at > NOW() - INTERVAL '30 days'
    ) AS chapters_this_month,
    -- Genre breakdown
    (
        SELECT jsonb_object_agg(genre, cnt)
        FROM (
            SELECT unnest(s2.genres) AS genre, COUNT(*) AS cnt
            FROM user_chapter_reads_v2 ucr2
            JOIN chapters c2 ON ucr2.chapter_id = c2.id
            JOIN series s2 ON c2.series_id = s2.id
            WHERE ucr2.user_id = $1::uuid
            GROUP BY genre
            ORDER BY cnt DESC
            LIMIT 5
        ) top_genres
    ) AS top_genres,
    -- Average chapters per day (last 30 days)
    ROUND(
        COUNT(DISTINCT ucr.chapter_id) FILTER (
            WHERE ucr.read_at > NOW() - INTERVAL '30 days'
        )::numeric / 30, 
        2
    ) AS avg_chapters_per_day
FROM user_chapter_reads_v2 ucr
JOIN chapters c ON ucr.chapter_id = c.id
WHERE ucr.user_id = $1::uuid;
```

**Parameters:** `$1` = user UUID

---

### 29. Import Job Summary

**Purpose:** Aggregate import job results.

```sql
SELECT 
    status,
    reason_code,
    COUNT(*) AS item_count,
    ARRAY_AGG(title ORDER BY title) FILTER (WHERE status = 'FAILED') AS failed_titles
FROM import_items
WHERE job_id = $1::uuid
GROUP BY status, reason_code
ORDER BY status ASC;
```

**Parameters:** `$1` = job UUID

---

### 30. Series Statistics Aggregation

**Purpose:** Update series_stats table with latest reader counts.

```sql
INSERT INTO series_stats (series_id, total_readers, readers_reading, readers_completed, readers_planning, readers_dropped, readers_on_hold, updated_at)
SELECT 
    s.id,
    COUNT(DISTINCT le.user_id) AS total_readers,
    COUNT(DISTINCT le.user_id) FILTER (WHERE le.status = 'reading') AS readers_reading,
    COUNT(DISTINCT le.user_id) FILTER (WHERE le.status = 'completed') AS readers_completed,
    COUNT(DISTINCT le.user_id) FILTER (WHERE le.status = 'planning') AS readers_planning,
    COUNT(DISTINCT le.user_id) FILTER (WHERE le.status = 'dropped') AS readers_dropped,
    COUNT(DISTINCT le.user_id) FILTER (WHERE le.status = 'on_hold') AS readers_on_hold,
    NOW()
FROM series s
LEFT JOIN library_entries le ON le.series_id = s.id AND le.deleted_at IS NULL
WHERE s.id = $1::uuid
GROUP BY s.id
ON CONFLICT (series_id) DO UPDATE SET
    total_readers = EXCLUDED.total_readers,
    readers_reading = EXCLUDED.readers_reading,
    readers_completed = EXCLUDED.readers_completed,
    readers_planning = EXCLUDED.readers_planning,
    readers_dropped = EXCLUDED.readers_dropped,
    readers_on_hold = EXCLUDED.readers_on_hold,
    updated_at = NOW();
```

**Parameters:** `$1` = series UUID

---

## Admin & Maintenance Queries

### 31. Trust Score Violation Audit

**Purpose:** Review users with trust score penalties.

```sql
SELECT 
    u.id,
    u.username,
    u.trust_score,
    u.xp,
    COUNT(tv.id) AS violation_count,
    SUM(tv.severity) AS total_severity,
    MAX(tv.created_at) AS last_violation,
    jsonb_agg(
        jsonb_build_object(
            'type', tv.violation_type,
            'severity', tv.severity,
            'created_at', tv.created_at
        ) ORDER BY tv.created_at DESC
    ) AS violations
FROM users u
JOIN trust_violations tv ON tv.user_id = u.id
WHERE u.trust_score < 1.0
GROUP BY u.id
ORDER BY u.trust_score ASC
LIMIT $1;
```

**Parameters:** `$1` = limit

---

### 32. Season Rollover Check

**Purpose:** Find users needing season XP reset.

```sql
SELECT 
    id,
    username,
    season_xp,
    current_season,
    xp AS lifetime_xp
FROM users
WHERE (
    current_season IS NULL 
    OR current_season != $1
)
AND season_xp > 0
AND deleted_at IS NULL;
```

**Parameters:** `$1` = current season code (e.g., '2026-Q1')

---

### 33. Dead Letter Queue (Failed Jobs)

**Purpose:** Review and retry failed background jobs.

```sql
SELECT 
    wf.id,
    wf.queue_name,
    wf.job_id,
    wf.payload,
    wf.error_message,
    wf.attempts_made,
    wf.created_at,
    wf.resolved_at
FROM worker_failures wf
WHERE wf.resolved_at IS NULL
ORDER BY wf.created_at DESC
LIMIT $1;
```

**Parameters:** `$1` = limit

---

### 34. Soft Delete Cleanup

**Purpose:** Permanently delete soft-deleted records older than 30 days.

```sql
-- Users (cascades to related data)
DELETE FROM users 
WHERE deleted_at IS NOT NULL 
  AND deleted_at < NOW() - INTERVAL '30 days';

-- Series
DELETE FROM series 
WHERE deleted_at IS NOT NULL 
  AND deleted_at < NOW() - INTERVAL '30 days';

-- Library entries
DELETE FROM library_entries 
WHERE deleted_at IS NOT NULL 
  AND deleted_at < NOW() - INTERVAL '30 days';

-- Chapters
DELETE FROM chapters 
WHERE deleted_at IS NOT NULL 
  AND deleted_at < NOW() - INTERVAL '30 days';
```

**Parameters:** None (scheduled job)

---

### 35. Read Telemetry Cleanup (90-day retention)

**Purpose:** Remove old telemetry data for privacy.

```sql
DELETE FROM read_telemetry
WHERE created_at < NOW() - INTERVAL '90 days';
```

**Parameters:** None (scheduled job)

---

## Index Recommendations

### Existing Critical Indexes

```sql
-- User lookups
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_xp_desc ON users(xp DESC);
CREATE INDEX idx_users_season_xp_desc ON users(season_xp DESC);

-- Library queries
CREATE INDEX idx_library_entries_user_status_lastread 
    ON library_entries(user_id, status, last_read_at DESC);

-- Feed queries
CREATE INDEX idx_feed_entries_discovered_desc 
    ON feed_entries(first_discovered_at DESC);
CREATE INDEX idx_feed_entries_lastupdated_series 
    ON feed_entries(last_updated_at DESC, series_id);

-- Chapter lookups
CREATE INDEX idx_chapters_series_number_desc 
    ON chapters(series_id, chapter_number DESC);
CREATE INDEX idx_chapters_published_desc 
    ON chapters(published_at DESC, id DESC);

-- Read tracking
CREATE INDEX idx_user_chapter_reads_v2_user_updated 
    ON user_chapter_reads_v2(user_id, updated_at DESC);

-- Activity feed
CREATE INDEX idx_activities_user_created 
    ON activities(user_id, created_at DESC);
```

---

## Performance Notes

1. **Cursor Pagination:** Use `(sort_column, id)` composite cursors for stable pagination
2. **Array Operators:** Use `@>` (contains) and `&&` (overlaps) for genre/tag filters
3. **Partial Indexes:** Consider `WHERE deleted_at IS NULL` partial indexes for active records
4. **JSONB:** Use `jsonb_agg` for multi-source chapter data to reduce round trips
5. **Window Functions:** Use `ROW_NUMBER()` for leaderboards instead of subqueries
6. **Trust Score:** Always multiply XP by `trust_score` for leaderboard calculations

---

*Generated for MangaTrackManga Tracker - January 17, 2026*
