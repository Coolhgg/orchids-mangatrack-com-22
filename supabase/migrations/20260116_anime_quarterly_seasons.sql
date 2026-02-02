-- Anime-Style Quarterly Seasons Migration
-- Changes season format from YYYY-MM to YYYY-Q[1-4]

-- 1. Increase column width to accommodate new format (YYYY-Q[1-4] = 8 chars max)
ALTER TABLE users ALTER COLUMN current_season TYPE VARCHAR(10);

-- 2. Convert existing monthly seasons to quarterly format
-- January-March -> Q1 (Winter)
-- April-June -> Q2 (Spring)
-- July-September -> Q3 (Summer)
-- October-December -> Q4 (Fall)
UPDATE users
SET current_season = 
  CASE 
    WHEN current_season ~ '^\d{4}-(01|02|03)$' THEN 
      SUBSTRING(current_season FROM 1 FOR 4) || '-Q1'
    WHEN current_season ~ '^\d{4}-(04|05|06)$' THEN 
      SUBSTRING(current_season FROM 1 FOR 4) || '-Q2'
    WHEN current_season ~ '^\d{4}-(07|08|09)$' THEN 
      SUBSTRING(current_season FROM 1 FOR 4) || '-Q3'
    WHEN current_season ~ '^\d{4}-(10|11|12)$' THEN 
      SUBSTRING(current_season FROM 1 FOR 4) || '-Q4'
    ELSE current_season
  END
WHERE current_season IS NOT NULL 
  AND current_season ~ '^\d{4}-\d{2}$';

-- 3. Convert existing season records in seasons table
UPDATE seasons
SET 
  code = CASE 
    WHEN code ~ '^\d{4}-(01|02|03)$' THEN SUBSTRING(code FROM 1 FOR 4) || '-Q1'
    WHEN code ~ '^\d{4}-(04|05|06)$' THEN SUBSTRING(code FROM 1 FOR 4) || '-Q2'
    WHEN code ~ '^\d{4}-(07|08|09)$' THEN SUBSTRING(code FROM 1 FOR 4) || '-Q3'
    WHEN code ~ '^\d{4}-(10|11|12)$' THEN SUBSTRING(code FROM 1 FOR 4) || '-Q4'
    ELSE code
  END,
  name = CASE 
    WHEN code ~ '^\d{4}-(01|02|03)$' THEN 'Winter ' || SUBSTRING(code FROM 1 FOR 4)
    WHEN code ~ '^\d{4}-(04|05|06)$' THEN 'Spring ' || SUBSTRING(code FROM 1 FOR 4)
    WHEN code ~ '^\d{4}-(07|08|09)$' THEN 'Summer ' || SUBSTRING(code FROM 1 FOR 4)
    WHEN code ~ '^\d{4}-(10|11|12)$' THEN 'Fall ' || SUBSTRING(code FROM 1 FOR 4)
    ELSE name
  END,
  -- Extend date range to cover full quarter
  starts_at = CASE 
    WHEN code ~ '^\d{4}-(01|02|03)$' THEN 
      DATE_TRUNC('year', starts_at)
    WHEN code ~ '^\d{4}-(04|05|06)$' THEN 
      DATE_TRUNC('year', starts_at) + INTERVAL '3 months'
    WHEN code ~ '^\d{4}-(07|08|09)$' THEN 
      DATE_TRUNC('year', starts_at) + INTERVAL '6 months'
    WHEN code ~ '^\d{4}-(10|11|12)$' THEN 
      DATE_TRUNC('year', starts_at) + INTERVAL '9 months'
    ELSE starts_at
  END,
  ends_at = CASE 
    WHEN code ~ '^\d{4}-(01|02|03)$' THEN 
      DATE_TRUNC('year', ends_at) + INTERVAL '3 months' - INTERVAL '1 second'
    WHEN code ~ '^\d{4}-(04|05|06)$' THEN 
      DATE_TRUNC('year', ends_at) + INTERVAL '6 months' - INTERVAL '1 second'
    WHEN code ~ '^\d{4}-(07|08|09)$' THEN 
      DATE_TRUNC('year', ends_at) + INTERVAL '9 months' - INTERVAL '1 second'
    WHEN code ~ '^\d{4}-(10|11|12)$' THEN 
      DATE_TRUNC('year', ends_at) + INTERVAL '12 months' - INTERVAL '1 second'
    ELSE ends_at
  END
WHERE code ~ '^\d{4}-\d{2}$';

-- 4. Remove duplicate seasons that might have been created (keep the one with most seasonal achievements)
-- This handles cases where multiple monthly seasons got converted to the same quarter
WITH ranked_seasons AS (
  SELECT 
    id,
    code,
    ROW_NUMBER() OVER (
      PARTITION BY code 
      ORDER BY 
        (SELECT COUNT(*) FROM seasonal_user_achievements WHERE season_id = seasons.id) DESC,
        created_at ASC
    ) as rn
  FROM seasons
  WHERE code ~ '^\d{4}-Q[1-4]$'
)
DELETE FROM seasons 
WHERE id IN (
  SELECT id FROM ranked_seasons WHERE rn > 1
);

-- 5. Add comment for documentation
COMMENT ON COLUMN users.current_season IS 'Anime-style quarterly season format: YYYY-Q[1-4] where Q1=Winter(Jan-Mar), Q2=Spring(Apr-Jun), Q3=Summer(Jul-Sep), Q4=Fall(Oct-Dec)';
