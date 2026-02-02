-- Migration: Add stats_last_fetched_at field to series table
-- Purpose: Track when MangaDex statistics (follows, rating) were last fetched
-- 
-- NOTE: total_follows and average_rating columns already exist in the schema.
-- This migration only adds the timestamp tracking field if it doesn't exist.

-- Add stats_last_fetched_at column to track when stats were last synced from MangaDex
ALTER TABLE series 
ADD COLUMN IF NOT EXISTS stats_last_fetched_at TIMESTAMP WITH TIME ZONE NULL;

-- Add index to efficiently find series that need stats refresh
CREATE INDEX IF NOT EXISTS idx_series_stats_last_fetched 
ON series (stats_last_fetched_at NULLS FIRST);

COMMENT ON COLUMN series.stats_last_fetched_at IS 'Timestamp of last MangaDex statistics fetch (follows, rating)';
