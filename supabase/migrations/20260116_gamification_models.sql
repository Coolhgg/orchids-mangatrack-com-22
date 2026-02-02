-- Migration: Add Gamification Models (UserSeasonXP, ReadTelemetry)
-- Date: 2026-01-16
-- Description: Final gamification schema additions for XP tracking, seasons, and telemetry

-- ============================================================================
-- 1. Add last_xp_award_at to users table (if not exists)
-- ============================================================================
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'last_xp_award_at'
  ) THEN
    ALTER TABLE users ADD COLUMN last_xp_award_at TIMESTAMPTZ(6);
  END IF;
END $$;

-- ============================================================================
-- 2. Create UserSeasonXP table for historical per-season XP tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS user_season_xp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    xp INT NOT NULL DEFAULT 0,
    final_rank INT, -- Populated at season end
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    
    CONSTRAINT user_season_xp_unique UNIQUE (user_id, season_id)
);

-- Indexes for UserSeasonXP
CREATE INDEX IF NOT EXISTS idx_user_season_xp_season_xp 
    ON user_season_xp(season_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_user_season_xp_user_created 
    ON user_season_xp(user_id, created_at DESC);

-- ============================================================================
-- 3. Create ReadTelemetry table for anti-cheat detection
-- ============================================================================
CREATE TABLE IF NOT EXISTS read_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    series_id UUID NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    chapter_number INT NOT NULL,
    read_duration_s INT NOT NULL,
    page_count INT,
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    flag_reason VARCHAR(50),
    device_id VARCHAR(100),
    created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Indexes for ReadTelemetry
CREATE INDEX IF NOT EXISTS idx_read_telemetry_user_created 
    ON read_telemetry(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_read_telemetry_series_created 
    ON read_telemetry(series_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_read_telemetry_flagged_created 
    ON read_telemetry(flagged, created_at DESC);

-- ============================================================================
-- 4. Update trigger for user_season_xp updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_user_season_xp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_season_xp_updated_at_trigger ON user_season_xp;
CREATE TRIGGER user_season_xp_updated_at_trigger
    BEFORE UPDATE ON user_season_xp
    FOR EACH ROW
    EXECUTE FUNCTION update_user_season_xp_updated_at();

-- ============================================================================
-- 5. RLS Policies for new tables
-- ============================================================================

-- Enable RLS
ALTER TABLE user_season_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE read_telemetry ENABLE ROW LEVEL SECURITY;

-- UserSeasonXP: Users can read their own data, service role can do anything
DROP POLICY IF EXISTS "Users can view own season XP" ON user_season_xp;
CREATE POLICY "Users can view own season XP" ON user_season_xp
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to user_season_xp" ON user_season_xp;
CREATE POLICY "Service role full access to user_season_xp" ON user_season_xp
    FOR ALL USING (auth.role() = 'service_role');

-- ReadTelemetry: Only service role can access (privacy)
DROP POLICY IF EXISTS "Service role full access to read_telemetry" ON read_telemetry;
CREATE POLICY "Service role full access to read_telemetry" ON read_telemetry
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 6. Comments for documentation
-- ============================================================================
COMMENT ON TABLE user_season_xp IS 'Historical per-season XP tracking for leaderboard history';
COMMENT ON COLUMN user_season_xp.xp IS 'Total XP earned in this season';
COMMENT ON COLUMN user_season_xp.final_rank IS 'Final leaderboard rank at season end';

COMMENT ON TABLE read_telemetry IS 'Read telemetry for anti-cheat detection (detection only, never blocking)';
COMMENT ON COLUMN read_telemetry.read_duration_s IS 'Time spent reading in seconds';
COMMENT ON COLUMN read_telemetry.flagged IS 'True if read was suspiciously fast';
COMMENT ON COLUMN read_telemetry.flag_reason IS 'Reason for flagging: speed_read, bulk_speed_read';
