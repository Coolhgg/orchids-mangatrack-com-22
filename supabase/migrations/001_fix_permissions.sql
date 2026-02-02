-- Fix schema permissions for Supabase roles
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

-- Grant usage on public schema to all roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Grant all privileges on all tables to service_role (bypasses RLS)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant select/insert/update/delete on all tables to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Grant select on public tables to anon (for public data like series)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;

-- =====================================================
-- Enable Row Level Security on all tables
-- =====================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE series ENABLE ROW LEVEL SECURITY;
ALTER TABLE series_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS Policies for USERS table
-- =====================================================

-- Users can read their own profile
CREATE POLICY "Users can read own profile" ON users
  FOR SELECT USING (auth.uid() = id);

-- Public profiles are readable by everyone
CREATE POLICY "Public profiles are viewable" ON users
  FOR SELECT USING (
    privacy_settings->>'library_public' = 'true' OR 
    privacy_settings IS NULL
  );

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Service role can do everything (for server-side operations)
CREATE POLICY "Service role full access to users" ON users
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for SERIES table (public read)
-- =====================================================

CREATE POLICY "Series are publicly readable" ON series
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to series" ON series
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for SERIES_SOURCES table (public read)
-- =====================================================

CREATE POLICY "Series sources are publicly readable" ON series_sources
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to series_sources" ON series_sources
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for CHAPTERS table (public read)
-- =====================================================

CREATE POLICY "Chapters are publicly readable" ON chapters
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to chapters" ON chapters
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for LIBRARY_ENTRIES table
-- =====================================================

-- Users can read their own library entries
CREATE POLICY "Users can read own library" ON library_entries
  FOR SELECT USING (auth.uid() = user_id);

-- Users can read public libraries of others
CREATE POLICY "Public libraries are viewable" ON library_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = library_entries.user_id 
      AND (users.privacy_settings->>'library_public' = 'true' OR users.privacy_settings IS NULL)
    )
  );

-- Users can manage their own library
CREATE POLICY "Users can insert own library entries" ON library_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own library entries" ON library_entries
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own library entries" ON library_entries
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to library_entries" ON library_entries
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for NOTIFICATIONS table
-- =====================================================

CREATE POLICY "Users can read own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to notifications" ON notifications
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for ACHIEVEMENTS table (public read)
-- =====================================================

CREATE POLICY "Achievements are publicly readable" ON achievements
  FOR SELECT USING (true);

CREATE POLICY "Service role full access to achievements" ON achievements
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for USER_ACHIEVEMENTS table
-- =====================================================

CREATE POLICY "Users can read own achievements" ON user_achievements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Public achievements are viewable" ON user_achievements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = user_achievements.user_id 
      AND (users.privacy_settings->>'activity_public' = 'true' OR users.privacy_settings IS NULL)
    )
  );

CREATE POLICY "Service role full access to user_achievements" ON user_achievements
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for FOLLOWS table
-- =====================================================

CREATE POLICY "Anyone can read follows" ON follows
  FOR SELECT USING (true);

CREATE POLICY "Users can manage own follows" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can delete own follows" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

CREATE POLICY "Service role full access to follows" ON follows
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for ACTIVITIES table
-- =====================================================

CREATE POLICY "Users can read own activities" ON activities
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Public activities are viewable" ON activities
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = activities.user_id 
      AND (users.privacy_settings->>'activity_public' = 'true' OR users.privacy_settings IS NULL)
    )
  );

CREATE POLICY "Users can insert own activities" ON activities
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to activities" ON activities
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- RLS Policies for IMPORT_JOBS table
-- =====================================================

CREATE POLICY "Users can read own import jobs" ON import_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own import jobs" ON import_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to import_jobs" ON import_jobs
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- =====================================================
-- Helper Functions
-- =====================================================

-- Function to increment XP (used by gamification system)
CREATE OR REPLACE FUNCTION increment_xp(p_user_id UUID, p_amount INT)
RETURNS void AS $$
BEGIN
  UPDATE users 
  SET xp = xp + p_amount,
      level = GREATEST(1, FLOOR(SQRT(xp + p_amount) / 10) + 1)::INT,
      updated_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on function
GRANT EXECUTE ON FUNCTION increment_xp TO authenticated, service_role;

-- =====================================================
-- Trigger to create user profile on auth signup
-- =====================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, username, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on auth.users (only if not exists)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =====================================================
-- Seed Initial Data
-- =====================================================

-- Seed achievements if not exist
INSERT INTO achievements (code, name, description, xp_reward, rarity, criteria)
VALUES 
  ('first_chapter', 'First Steps', 'Read your first chapter', 50, 'common', '{"type": "chapter_count", "threshold": 1}'::jsonb),
  ('speed_reader', 'Speed Reader', 'Read 100 chapters', 200, 'rare', '{"type": "chapter_count", "threshold": 100}'::jsonb),
  ('completionist', 'Completionist', 'Complete your first series', 500, 'epic', '{"type": "completed_count", "threshold": 1}'::jsonb),
  ('bookworm', 'Bookworm', 'Add 10 series to your library', 100, 'common', '{"type": "library_count", "threshold": 10}'::jsonb),
  ('dedicated', 'Dedicated Reader', 'Maintain a 7-day reading streak', 150, 'rare', '{"type": "streak_days", "threshold": 7}'::jsonb),
  ('marathon', 'Marathon Reader', 'Read 50 chapters in one day', 300, 'epic', '{"type": "daily_chapters", "threshold": 50}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Seed sample series if table is empty
INSERT INTO series (title, description, type, status, cover_url, genres, total_follows, average_rating, tags)
SELECT * FROM (VALUES
  ('Solo Leveling', 'Ten years ago, after the Gate that connected the real world with the monster world opened, some of the ordinary, everyday people received the power to hunt monsters within the Gate. They are known as Hunters.', 'manhwa', 'completed', 'https://images.unsplash.com/photo-1618336753974-aae8e04506aa?q=80&w=400&auto=format&fit=crop', ARRAY['Action', 'Fantasy', 'Adventure'], 450000, 9.1::decimal, ARRAY['hunter', 'leveling', 'dungeons']),
  ('One Piece', 'Monkey D. Luffy refuses to let anyone or anything stand in the way of his quest to become the king of all pirates.', 'manga', 'ongoing', 'https://images.unsplash.com/photo-1580477667995-2b94f01c9516?q=80&w=400&auto=format&fit=crop', ARRAY['Action', 'Adventure', 'Comedy'], 850000, 9.5::decimal, ARRAY['pirates', 'adventure', 'shounen']),
  ('Tower of God', 'What do you desire? Fortune? Glory? Power? Revenge? Or something that surpasses all others? Whatever you desire, it is here.', 'webtoon', 'ongoing', 'https://images.unsplash.com/photo-1608889175123-8ee362201f81?q=80&w=400&auto=format&fit=crop', ARRAY['Fantasy', 'Action', 'Drama'], 320000, 8.8::decimal, ARRAY['tower', 'mystery', 'adventure']),
  ('Berserk', 'Guts, a former mercenary now known as the Black Swordsman, is out for revenge.', 'manga', 'ongoing', 'https://images.unsplash.com/photo-1516466723877-e4ec1d736c8a?q=80&w=400&auto=format&fit=crop', ARRAY['Action', 'Dark Fantasy', 'Horror'], 280000, 9.8::decimal, ARRAY['dark', 'revenge', 'medieval']),
  ('Omniscient Reader', 'This is a story that I know. At that moment, the world was destroyed, and a new universe unfolded.', 'manhwa', 'ongoing', 'https://images.unsplash.com/photo-1541963463532-d68292c34b19?q=80&w=400&auto=format&fit=crop', ARRAY['Action', 'Fantasy', 'Psychological'], 210000, 9.3::decimal, ARRAY['apocalypse', 'survival', 'game'])
) AS v(title, description, type, status, cover_url, genres, total_follows, average_rating, tags)
WHERE NOT EXISTS (SELECT 1 FROM series LIMIT 1);

-- Add sources for seeded series
INSERT INTO series_sources (series_id, source_name, source_id, source_url, trust_score)
SELECT s.id, 'mangadex', 'md-' || LEFT(s.id::text, 8), 'https://mangadex.org/title/' || s.id, 9.0
FROM series s
WHERE NOT EXISTS (
  SELECT 1 FROM series_sources ss WHERE ss.series_id = s.id
);

-- Sync existing auth users to users table
INSERT INTO users (id, email, username, created_at, updated_at)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'username', split_part(au.email, '@', 1)),
  COALESCE(au.created_at, NOW()),
  NOW()
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = au.id)
ON CONFLICT (id) DO NOTHING;
