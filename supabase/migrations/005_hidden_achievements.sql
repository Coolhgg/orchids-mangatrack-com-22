-- Add is_hidden column to achievements table
-- Hidden achievements are not shown in the UI until unlocked
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- Create index for efficient querying of hidden achievements
CREATE INDEX IF NOT EXISTS achievements_is_hidden_idx ON achievements(is_hidden);
