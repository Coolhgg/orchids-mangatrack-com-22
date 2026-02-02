# Database Debugging Guide - PostgreSQL/Supabase

**Project:** MangaTrackManga Tracker  
**Database:** PostgreSQL 15 (Supabase)  
**ORM:** Prisma  
**Last Updated:** January 17, 2026

---

## Table of Contents

1. [Environment & Prerequisites](#1-environment--prerequisites)
2. [Table Existence Check](#2-table-existence-check)
3. [SQL Queries for Features](#3-sql-queries-for-features)
4. [Migration Guidance](#4-migration-guidance)
5. [Common Issues & Diagnostics](#5-common-issues--diagnostics)
6. [Minimal Runnable Examples](#6-minimal-runnable-examples)

---

## 1. Environment & Prerequisites

### Database Configuration

| Property | Value |
|----------|-------|
| **Database Type** | PostgreSQL 15 |
| **Provider** | Supabase (hosted) |
| **Region** | us-east-2 |
| **Pooler** | PgBouncer (port 6543) |
| **Direct** | Port 5432 |
| **ORM** | Prisma 5.x |
| **Migration Tool** | Prisma Migrate + Supabase SQL Editor |

### Connection Strings

```bash
# Pooled connection (for application - via PgBouncer)
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-1-us-east-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10"

# Direct connection (for migrations - bypasses pooler)
DIRECT_URL="postgresql://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:5432/postgres"
```

### Verify Environment Variables

```bash
# Check required env vars are set
echo "DATABASE_URL: ${DATABASE_URL:+SET}"
echo "DIRECT_URL: ${DIRECT_URL:+SET}"
echo "NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL:+SET}"
echo "NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY:+SET}"
echo "SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:+SET}"
```

### Test Database Connectivity

```bash
# Test via Prisma
npx prisma db pull --print

# Test direct connection
npx prisma migrate status

# Test via psql (if installed)
psql "$DIRECT_URL" -c "SELECT version();"
```

---

## 2. Table Existence Check

### Quick Check - List All Tables

```sql
-- List all tables in public schema
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- With row counts (slower but more informative)
SELECT 
    schemaname,
    relname AS table_name,
    n_live_tup AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;
```

### Required Tables Checklist

Run this query to verify all required tables exist:

```sql
-- Comprehensive table existence check
WITH required_tables AS (
    SELECT unnest(ARRAY[
        'users',
        'series',
        'series_sources',
        'chapters',
        'chapter_sources',
        'legacy_chapters',
        'library_entries',
        'user_chapter_reads',
        'user_chapter_reads_v2',
        'notifications',
        'notifications_queue',
        'notification_digest_buffer',
        'achievements',
        'user_achievements',
        'seasonal_user_achievements',
        'follows',
        'activities',
        'import_jobs',
        'import_items',
        'feed_entries',
        'series_stats',
        'series_creators',
        'series_relations',
        'creators',
        'worker_failures',
        'audit_logs',
        'login_attempts',
        'user_source_priorities',
        'user_series_source_preferences',
        'query_stats',
        'series_activity_events',
        'seed_lists',
        'seed_list_entries',
        'chapter_availability',
        'user_recommendations',
        'user_signals',
        'user_affinities',
        'seasons',
        'user_season_xp',
        'trust_violations',
        'read_telemetry',
        'xp_transactions'
    ]) AS table_name
)
SELECT 
    r.table_name,
    CASE WHEN t.tablename IS NOT NULL THEN '✓ EXISTS' ELSE '✗ MISSING' END AS status
FROM required_tables r
LEFT JOIN pg_tables t ON t.tablename = r.table_name AND t.schemaname = 'public'
ORDER BY 
    CASE WHEN t.tablename IS NULL THEN 0 ELSE 1 END,
    r.table_name;
```

### Check Views

```sql
-- List all views
SELECT viewname 
FROM pg_views 
WHERE schemaname = 'public';
```

### Check Indexes

```sql
-- List all indexes with their tables
SELECT 
    tablename,
    indexname,
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

### Check Enums

```sql
-- List all custom enum types
SELECT 
    t.typname AS enum_name,
    e.enumlabel AS enum_value
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
ORDER BY t.typname, e.enumsortorder;
```

---

## 3. SQL Queries for Features

### 3.1 User CRUD Operations

#### Create User (via trigger on auth.users)

```sql
-- Users are created automatically via trigger when signing up
-- Manual insert (for testing/seeding):
INSERT INTO users (
    id, email, username, created_at, updated_at
) VALUES (
    gen_random_uuid(),  -- or $1 for parameterized
    $1,                 -- email
    $2,                 -- username
    NOW(),
    NOW()
)
RETURNING *;
```

#### Read User

```sql
-- Get user by ID
SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL;

-- Get user by username
SELECT * FROM users WHERE username = $1 AND deleted_at IS NULL;

-- Get user with stats
SELECT 
    u.*,
    (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS follower_count,
    (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) AS following_count,
    (SELECT COUNT(*) FROM library_entries WHERE user_id = u.id AND deleted_at IS NULL) AS library_count
FROM users u
WHERE u.id = $1 AND u.deleted_at IS NULL;
```

#### Update User

```sql
-- Update profile
UPDATE users SET
    username = COALESCE($2, username),
    bio = COALESCE($3, bio),
    avatar_url = COALESCE($4, avatar_url),
    safe_browsing_mode = COALESCE($5, safe_browsing_mode),
    notification_settings = COALESCE($6, notification_settings),
    privacy_settings = COALESCE($7, privacy_settings),
    updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;
```

#### Delete User (Soft Delete)

```sql
-- Soft delete
UPDATE users SET deleted_at = NOW(), updated_at = NOW()
WHERE id = $1
RETURNING id;

-- Hard delete (cascade)
DELETE FROM users WHERE id = $1;
```

### 3.2 Library Entry CRUD

#### Create Library Entry

```sql
INSERT INTO library_entries (
    user_id,
    series_id,
    source_url,
    source_name,
    imported_title,
    status,
    last_read_chapter,
    notify_new_chapters,
    added_at,
    updated_at
) VALUES (
    $1,  -- user_id
    $2,  -- series_id (nullable)
    $3,  -- source_url
    $4,  -- source_name
    $5,  -- imported_title
    $6,  -- status (default: 'reading')
    $7,  -- last_read_chapter
    $8,  -- notify_new_chapters (default: true)
    NOW(),
    NOW()
)
ON CONFLICT (user_id, source_url) DO UPDATE SET
    series_id = COALESCE(EXCLUDED.series_id, library_entries.series_id),
    status = EXCLUDED.status,
    last_read_chapter = EXCLUDED.last_read_chapter,
    updated_at = NOW()
RETURNING *;
```

#### Read Library Entries

```sql
-- Get user's library with unread counts
SELECT 
    le.*,
    s.title,
    s.cover_url,
    s.status AS series_status,
    (SELECT MAX(c.chapter_number::numeric) 
     FROM chapters c 
     WHERE c.series_id = s.id AND c.deleted_at IS NULL) AS latest_chapter,
    (SELECT COUNT(*) 
     FROM chapters c 
     WHERE c.series_id = s.id 
       AND c.deleted_at IS NULL
       AND NOT EXISTS (
           SELECT 1 FROM user_chapter_reads_v2 ucr 
           WHERE ucr.chapter_id = c.id AND ucr.user_id = le.user_id
       )
    ) AS unread_count
FROM library_entries le
LEFT JOIN series s ON le.series_id = s.id
WHERE le.user_id = $1 
  AND le.deleted_at IS NULL
  AND ($2::varchar IS NULL OR le.status = $2)
ORDER BY le.last_read_at DESC NULLS LAST;
```

#### Update Library Entry

```sql
UPDATE library_entries SET
    status = COALESCE($2, status),
    last_read_chapter = COALESCE($3, last_read_chapter),
    last_read_at = COALESCE($4, last_read_at),
    user_rating = COALESCE($5, user_rating),
    notify_new_chapters = COALESCE($6, notify_new_chapters),
    preferred_source = COALESCE($7, preferred_source),
    updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;
```

#### Delete Library Entry

```sql
-- Soft delete
UPDATE library_entries SET deleted_at = NOW(), updated_at = NOW()
WHERE id = $1 AND user_id = $2
RETURNING id;
```

### 3.3 Series Filtering & Search

#### Basic Search

```sql
SELECT id, title, cover_url, type, status, genres, total_follows
FROM series
WHERE (title ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%')
  AND deleted_at IS NULL
ORDER BY total_follows DESC
LIMIT $2;
```

#### Advanced Filtering

```sql
SELECT s.*
FROM series s
WHERE s.deleted_at IS NULL
  -- Text search
  AND ($1::text IS NULL OR s.title ILIKE '%' || $1 || '%')
  -- Type filter (manga, manhwa, etc.)
  AND ($2::varchar[] IS NULL OR s.type = ANY($2))
  -- Genre filter (must have ALL genres)
  AND ($3::varchar[] IS NULL OR s.genres @> $3)
  -- Status filter
  AND ($4::varchar[] IS NULL OR s.status = ANY($4))
  -- Content rating (safe browsing)
  AND ($5::varchar IS NULL OR s.content_rating = $5 OR s.content_rating IS NULL)
  -- Minimum chapters
  AND ($6::int IS NULL OR COALESCE(s.chapter_count, 0) >= $6)
ORDER BY s.total_follows DESC
LIMIT $7 OFFSET $8;
```

### 3.4 Tagging System (Genres/Themes)

#### Get Series by Tag

```sql
-- Series with specific genre
SELECT * FROM series 
WHERE 'Action' = ANY(genres) AND deleted_at IS NULL;

-- Series with ALL specified genres
SELECT * FROM series 
WHERE genres @> ARRAY['Action', 'Fantasy']::varchar[] AND deleted_at IS NULL;

-- Series with ANY of specified genres
SELECT * FROM series 
WHERE genres && ARRAY['Action', 'Fantasy']::varchar[] AND deleted_at IS NULL;
```

#### Get Popular Tags

```sql
-- Most common genres
SELECT 
    unnest(genres) AS genre,
    COUNT(*) AS series_count
FROM series
WHERE deleted_at IS NULL
GROUP BY genre
ORDER BY series_count DESC
LIMIT 20;
```

### 3.5 Multi-User Access Control (RLS)

#### Check Current User Role

```sql
SELECT 
    current_user,
    current_role,
    auth.uid() AS auth_user_id,
    auth.role() AS auth_role,
    auth.jwt()->>'role' AS jwt_role;
```

#### Test RLS Policies

```sql
-- Test as authenticated user
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "user-uuid-here", "role": "authenticated"}';

SELECT * FROM library_entries WHERE user_id = 'user-uuid-here';

-- Reset
RESET ROLE;
```

---

## 4. Migration Guidance

### Migration Order

Migrations should be applied in this order:

1. **001_fix_permissions.sql** - Base schema permissions and RLS
2. **002_add_filter_columns.sql** - Additional filter columns
3. **003_cursor_pagination_indexes.sql** - Pagination indexes
4. **004_multi_source_chapter_schema.sql** - Chapter source support
5. **005_hidden_achievements.sql** - Hidden achievements
6. **20260116_anime_quarterly_seasons.sql** - Seasonal XP system
7. **20260116_gamification_models.sql** - Full gamification
8. **20260116_seasonal_achievements.sql** - Seasonal achievements

### Safe Migration Template

```sql
-- Migration: YYYYMMDD_description.sql
-- Up Migration

BEGIN;

-- Check if migration already applied
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE schemaname = 'public' AND tablename = 'your_table'
    ) THEN
        -- Create table
        CREATE TABLE your_table (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            -- columns...
            created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        RAISE NOTICE 'Created table: your_table';
    ELSE
        RAISE NOTICE 'Table your_table already exists, skipping';
    END IF;
END $$;

-- Add column if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'new_column'
    ) THEN
        ALTER TABLE users ADD COLUMN new_column VARCHAR(50);
        RAISE NOTICE 'Added column: new_column';
    END IF;
END $$;

-- Create index if not exists
CREATE INDEX IF NOT EXISTS idx_your_table_column ON your_table(column_name);

COMMIT;

-- Down Migration (rollback)
-- DROP TABLE IF EXISTS your_table;
-- ALTER TABLE users DROP COLUMN IF EXISTS new_column;
```

### Apply Migrations via Prisma

```bash
# Generate migration from schema changes
npx prisma migrate dev --name description

# Apply migrations to production
npx prisma migrate deploy

# Reset database (DANGER: destroys data)
npx prisma migrate reset

# Check migration status
npx prisma migrate status
```

### Apply Migrations via Supabase

```bash
# In Supabase Dashboard > SQL Editor
# Copy and paste migration SQL, then run

# Or via supabase CLI
supabase db push
```

---

## 5. Common Issues & Diagnostics

### 5.1 Connection Issues

#### Host Resolution Failed

```bash
# Error: ENOTFOUND db.xxx.supabase.co
# Solution: Check DNS resolution
nslookup db.nkrxhoamqsawixdwehaq.supabase.co

# Or use IP directly (not recommended for production)
```

#### Authentication Failed

```bash
# Error: password authentication failed
# Solutions:
# 1. Verify password in DATABASE_URL
# 2. Check if user exists
# 3. Reset database password in Supabase dashboard
```

#### SSL/TLS Issues

```sql
-- Force SSL in connection string
?sslmode=require

-- Or disable SSL for local testing only
?sslmode=disable
```

#### Connection Timeout

```bash
# Error: timeout expired
# Solutions:

# 1. Increase timeout in connection string
?connect_timeout=30

# 2. Check if IP is whitelisted (Supabase > Settings > Database)

# 3. Test connectivity
curl -I https://nkrxhoamqsawixdwehaq.supabase.co
```

#### Too Many Connections

```sql
-- Check current connections
SELECT 
    count(*) AS total,
    state,
    usename,
    application_name
FROM pg_stat_activity
GROUP BY state, usename, application_name
ORDER BY total DESC;

-- Kill idle connections
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'idle' 
  AND state_change < NOW() - INTERVAL '5 minutes';
```

### 5.2 SQL Problems

#### Missing Indexes (Slow Queries)

```sql
-- Find tables without indexes
SELECT 
    relname AS table_name,
    seq_scan,
    idx_scan,
    CASE WHEN seq_scan > 0 
        THEN round(100.0 * idx_scan / (seq_scan + idx_scan), 2)
        ELSE 100 
    END AS idx_scan_pct
FROM pg_stat_user_tables
WHERE seq_scan > 100 AND idx_scan = 0
ORDER BY seq_scan DESC;

-- Find slow queries
SELECT 
    query,
    calls,
    total_time / calls AS avg_time_ms,
    rows / calls AS avg_rows
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

#### Constraint Violations

```sql
-- Check foreign key constraints
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY';

-- Find orphaned records
SELECT le.id, le.series_id
FROM library_entries le
LEFT JOIN series s ON le.series_id = s.id
WHERE le.series_id IS NOT NULL AND s.id IS NULL;
```

#### Data Type Mismatch

```sql
-- Check column types
SELECT 
    column_name,
    data_type,
    character_maximum_length,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
```

#### Unique Constraint Errors

```sql
-- Find duplicate values
SELECT source_url, user_id, COUNT(*) 
FROM library_entries 
GROUP BY source_url, user_id 
HAVING COUNT(*) > 1;

-- Add unique constraint safely
ALTER TABLE your_table 
ADD CONSTRAINT unique_constraint_name UNIQUE (column1, column2);
```

### 5.3 Quick Verification Queries

```sql
-- Test basic connection
SELECT 1 AS connected;

-- Check database version
SELECT version();

-- Check current database
SELECT current_database();

-- Check current user permissions
SELECT has_table_privilege('users', 'SELECT');

-- Check table exists and is accessible
SELECT COUNT(*) FROM users LIMIT 1;

-- Check RLS is enabled
SELECT 
    tablename,
    rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

---

## 6. Minimal Runnable Examples

### Test Complete Flow

```sql
-- Run this in Supabase SQL Editor to test the full stack

-- 1. Create test user
INSERT INTO users (id, email, username)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'test@example.com',
    'testuser'
)
ON CONFLICT (id) DO NOTHING
RETURNING id, username;

-- 2. Create test series
INSERT INTO series (id, title, type, genres)
VALUES (
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    'Test Manga',
    'manga',
    ARRAY['Action', 'Fantasy']
)
ON CONFLICT (id) DO NOTHING
RETURNING id, title;

-- 3. Add to library
INSERT INTO library_entries (
    user_id,
    series_id,
    source_url,
    source_name,
    status
) VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    'https://mangadex.org/title/test',
    'mangadex',
    'reading'
)
ON CONFLICT (user_id, source_url) DO UPDATE SET status = 'reading'
RETURNING id, status;

-- 4. Verify
SELECT 
    u.username,
    s.title,
    le.status
FROM users u
JOIN library_entries le ON u.id = le.user_id
JOIN series s ON le.series_id = s.id
WHERE u.id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

-- 5. Cleanup (optional)
-- DELETE FROM library_entries WHERE user_id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
-- DELETE FROM series WHERE id = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
-- DELETE FROM users WHERE id = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
```

### Test XP System

```sql
-- Test XP award flow
DO $$
DECLARE
    test_user_id UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    current_xp INT;
    current_season VARCHAR(10);
BEGIN
    -- Get current season
    current_season := TO_CHAR(NOW(), 'YYYY') || '-Q' || CEIL(EXTRACT(MONTH FROM NOW()) / 3.0)::INT;
    
    -- Get user's current XP
    SELECT xp INTO current_xp FROM users WHERE id = test_user_id;
    RAISE NOTICE 'Before: XP = %', current_xp;
    
    -- Award XP with season handling
    UPDATE users SET
        xp = xp + 100,
        season_xp = CASE 
            WHEN current_season = current_season THEN season_xp + 100
            ELSE 100
        END,
        level = FLOOR(SQRT((xp + 100) / 100.0)) + 1,
        updated_at = NOW()
    WHERE id = test_user_id;
    
    -- Verify
    SELECT xp INTO current_xp FROM users WHERE id = test_user_id;
    RAISE NOTICE 'After: XP = %', current_xp;
END $$;
```

### Test Leaderboard Query

```sql
-- Seasonal leaderboard (current season)
WITH current_season AS (
    SELECT TO_CHAR(NOW(), 'YYYY') || '-Q' || CEIL(EXTRACT(MONTH FROM NOW()) / 3.0)::INT AS code
)
SELECT
    ROW_NUMBER() OVER (ORDER BY (u.season_xp * u.trust_score) DESC) AS rank,
    u.username,
    u.level,
    u.season_xp,
    u.current_season,
    FLOOR(u.season_xp * u.trust_score) AS effective_xp,
    u.trust_score
FROM users u, current_season cs
WHERE u.deleted_at IS NULL
  AND u.season_xp > 0
  AND (u.current_season = cs.code OR u.current_season IS NULL)
ORDER BY effective_xp DESC
LIMIT 10;
```

### Health Check Query

```sql
-- Comprehensive health check
SELECT 
    'Database' AS check_type,
    'Connection' AS check_name,
    CASE WHEN 1=1 THEN 'PASS' ELSE 'FAIL' END AS status
UNION ALL
SELECT 
    'Tables',
    'users',
    CASE WHEN (SELECT COUNT(*) FROM pg_tables WHERE tablename = 'users') > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 
    'Tables',
    'series',
    CASE WHEN (SELECT COUNT(*) FROM pg_tables WHERE tablename = 'series') > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 
    'Tables',
    'library_entries',
    CASE WHEN (SELECT COUNT(*) FROM pg_tables WHERE tablename = 'library_entries') > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 
    'Tables',
    'chapters',
    CASE WHEN (SELECT COUNT(*) FROM pg_tables WHERE tablename = 'chapters') > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 
    'Tables',
    'seasons',
    CASE WHEN (SELECT COUNT(*) FROM pg_tables WHERE tablename = 'seasons') > 0 THEN 'PASS' ELSE 'FAIL' END
UNION ALL
SELECT 
    'RLS',
    'users',
    CASE WHEN (SELECT rowsecurity FROM pg_tables WHERE tablename = 'users') THEN 'ENABLED' ELSE 'DISABLED' END
UNION ALL
SELECT 
    'Data',
    'users_count',
    (SELECT COUNT(*)::text FROM users WHERE deleted_at IS NULL)
UNION ALL
SELECT 
    'Data',
    'series_count',
    (SELECT COUNT(*)::text FROM series WHERE deleted_at IS NULL)
UNION ALL
SELECT 
    'Data',
    'library_entries_count',
    (SELECT COUNT(*)::text FROM library_entries WHERE deleted_at IS NULL);
```

---

## Quick Reference Commands

### Prisma CLI

```bash
# Generate client
npx prisma generate

# Push schema (no migration history)
npx prisma db push

# Pull schema from database
npx prisma db pull

# Create migration
npx prisma migrate dev --name description

# Deploy migrations
npx prisma migrate deploy

# Reset database
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio
```

### Supabase CLI

```bash
# Login
supabase login

# Link project
supabase link --project-ref nkrxhoamqsawixdwehaq

# Push migrations
supabase db push

# Pull schema
supabase db pull

# Run SQL
supabase db execute --sql "SELECT 1"
```

---

*Generated for MangaTrackManga Tracker - January 17, 2026*
