-- Migration: Seed Seasonal Achievements
-- Date: 2026-01-16
-- Description: Adds seasonal achievement definitions for the quarterly achievement system

-- ============================================================================
-- 1. Ensure current season exists in seasons table
-- ============================================================================
INSERT INTO seasons (id, code, name, starts_at, ends_at, is_active, created_at)
SELECT 
    gen_random_uuid(),
    '2026-Q1',
    'Winter 2026',
    '2026-01-01 00:00:00+00'::timestamptz,
    '2026-03-31 23:59:59.999+00'::timestamptz,
    true,
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM seasons WHERE code = '2026-Q1'
);

-- Deactivate other seasons if we just created the current one
UPDATE seasons SET is_active = false 
WHERE code != '2026-Q1' AND is_active = true;

-- ============================================================================
-- 2. Seed Seasonal Achievements
-- ============================================================================

-- Reading milestones
INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_reader_50',
    'Seasonal Reader',
    'Read 50 chapters this season',
    100,
    'common',
    '{"type": "seasonal_chapter_count", "threshold": 50}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_reader_100',
    'Seasonal Bookworm',
    'Read 100 chapters this season',
    200,
    'uncommon',
    '{"type": "seasonal_chapter_count", "threshold": 100}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_reader_250',
    'Seasonal Devourer',
    'Read 250 chapters this season',
    400,
    'rare',
    '{"type": "seasonal_chapter_count", "threshold": 250}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_reader_500',
    'Seasonal Legend',
    'Read 500 chapters this season',
    750,
    'epic',
    '{"type": "seasonal_chapter_count", "threshold": 500}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

-- Streak achievements
INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_streak_7',
    'Week Warrior',
    'Maintain a 7-day reading streak this season',
    150,
    'uncommon',
    '{"type": "seasonal_streak_max", "threshold": 7}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_streak_14',
    'Fortnight Fighter',
    'Maintain a 14-day reading streak this season',
    300,
    'rare',
    '{"type": "seasonal_streak_max", "threshold": 14}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_streak_30',
    'Monthly Master',
    'Maintain a 30-day reading streak this season',
    500,
    'epic',
    '{"type": "seasonal_streak_max", "threshold": 30}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

-- Completion achievements
INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_completionist_3',
    'Season Closer',
    'Complete 3 series this season',
    200,
    'uncommon',
    '{"type": "seasonal_completed_count", "threshold": 3}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_completionist_5',
    'Season Finisher',
    'Complete 5 series this season',
    400,
    'rare',
    '{"type": "seasonal_completed_count", "threshold": 5}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

-- Explorer achievements
INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_explorer_10',
    'Season Explorer',
    'Add 10 new series to your library this season',
    150,
    'uncommon',
    '{"type": "seasonal_library_count", "threshold": 10}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

-- Percentile achievements (end-of-season)
INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_top_10',
    'Top 10% Reader',
    'Finish the season in the top 10% of readers',
    300,
    'rare',
    '{"type": "seasonal_xp_percentile", "threshold": 10}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_top_5',
    'Top 5% Reader',
    'Finish the season in the top 5% of readers',
    500,
    'epic',
    '{"type": "seasonal_xp_percentile", "threshold": 5}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

INSERT INTO achievements (id, code, name, description, xp_reward, rarity, criteria, is_seasonal, created_at)
VALUES 
(
    gen_random_uuid(),
    'seasonal_top_1',
    'Seasonal Champion',
    'Finish the season in the top 1% of readers',
    1000,
    'legendary',
    '{"type": "seasonal_xp_percentile", "threshold": 1}'::jsonb,
    true,
    NOW()
)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    xp_reward = EXCLUDED.xp_reward,
    rarity = EXCLUDED.rarity,
    criteria = EXCLUDED.criteria,
    is_seasonal = EXCLUDED.is_seasonal;

-- ============================================================================
-- 3. Add comments for documentation
-- ============================================================================
COMMENT ON TABLE achievements IS 'Achievement definitions. is_seasonal=true achievements reset each quarter and can be re-earned.';
COMMENT ON TABLE seasonal_user_achievements IS 'Per-season achievement unlocks. Users can earn the same seasonal achievement once per season.';
