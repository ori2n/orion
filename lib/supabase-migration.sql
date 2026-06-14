-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)

-- 1. Tags table
CREATE TABLE IF NOT EXISTS tags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  user_id UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Seed some default tags
INSERT INTO tags (name, color) VALUES
  ('Health', 'bg-emerald-100 text-emerald-700 border-emerald-200'),
  ('Mind', 'bg-sky-100 text-sky-700 border-sky-200'),
  ('Work', 'bg-violet-100 text-violet-700 border-violet-200'),
  ('Fitness', 'bg-cyan-100 text-cyan-700 border-cyan-200');

-- 2. Add columns to existing habits table
ALTER TABLE habits ADD COLUMN IF NOT EXISTS custom_frequency TEXT DEFAULT '';
ALTER TABLE habits ADD COLUMN IF NOT EXISTS tag_id UUID REFERENCES tags(id);
ALTER TABLE habits ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

-- Drop the old simple columns since we're replacing them
ALTER TABLE habits DROP COLUMN IF EXISTS completed;
ALTER TABLE habits DROP COLUMN IF EXISTS tag;

-- Make frequency non-nullable with default
ALTER TABLE habits ALTER COLUMN frequency SET DEFAULT 'daily';
UPDATE habits SET frequency = 'daily' WHERE frequency IS NULL;
ALTER TABLE habits ALTER COLUMN frequency SET NOT NULL;

-- 3. Habit completions table (date-based tracking)
CREATE TABLE IF NOT EXISTS habit_completions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  habit_id UUID REFERENCES habits(id) ON DELETE CASCADE NOT NULL,
  completed_date DATE NOT NULL,
  user_id UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(habit_id, completed_date)
);

-- 4. Enable Row Level Security (optional, open access for now)
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;

-- 5. Events table (extensible audit log for AI agent & analytics)
CREATE TABLE IF NOT EXISTS events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_user_id ON events(user_id);

-- 6. Enable RLS on events
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Drop old public-access policies before creating user-scoped ones
DROP POLICY IF EXISTS "Public access" ON tags;
DROP POLICY IF EXISTS "Public access" ON habits;
DROP POLICY IF EXISTS "Public access" ON habit_completions;
DROP POLICY IF EXISTS "Public access" ON events;

-- User-scoped RLS policies (rows must belong to the authenticated user)
-- Tags allow NULL user_id (seeded/default tags visible to everyone).
CREATE POLICY "User owns data" ON tags
  FOR ALL USING (auth.uid() = user_id OR user_id IS NULL)
  WITH CHECK (auth.uid() = user_id);

-- Habits, completions, and events are strictly scoped to the owning user.
CREATE POLICY "User owns data" ON habits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON habit_completions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
