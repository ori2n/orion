-- ============================================================
-- FIX: Missing columns & RLS policies for Habits & Tags tables
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Diagnosis: The tables tags, habits, and habit_completions exist
-- but are MISSING the user_id column. This causes errors like:
--   "column habit_completions.user_id does not exist"
--
-- The original migration was partially applied (tables were created
-- with basic columns), but the ALTER TABLE statements and RLS policies
-- were never executed.
-- ============================================================

-- ============================================================
-- 1. Add missing user_id columns to existing tables
-- ============================================================
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

ALTER TABLE habits
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

ALTER TABLE habit_completions
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid();

-- Verify: run this to confirm columns were added
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'habit_completions'
--   ORDER BY ordinal_position;

-- ============================================================
-- 2. Create events table if it doesn't exist
-- ============================================================
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

-- ============================================================
-- 3. Add UNIQUE constraint to habit_completions if missing
-- ============================================================
-- Drop any existing constraint first, then re-add it safely
ALTER TABLE habit_completions DROP CONSTRAINT IF EXISTS habit_completions_habit_id_completed_date_key;

-- Drop any existing duplicate rows (keep the earliest)
DELETE FROM habit_completions a
  USING habit_completions b
  WHERE a.id < b.id
    AND a.habit_id = b.habit_id
    AND a.completed_date = b.completed_date;

-- Add the unique constraint
ALTER TABLE habit_completions
  ADD CONSTRAINT habit_completions_habit_id_completed_date_key
  UNIQUE (habit_id, completed_date);

-- ============================================================
-- 4. Fix RLS policies
-- ============================================================

-- Enable RLS on all tables (safe to re-run)
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies to start fresh
DROP POLICY IF EXISTS "Public access" ON tags;
DROP POLICY IF EXISTS "Public access" ON habits;
DROP POLICY IF EXISTS "Public access" ON habit_completions;
DROP POLICY IF EXISTS "Public access" ON events;
DROP POLICY IF EXISTS "User owns data" ON tags;
DROP POLICY IF EXISTS "User owns data" ON habits;
DROP POLICY IF EXISTS "User owns data" ON habit_completions;
DROP POLICY IF EXISTS "User owns data" ON events;

-- Create user-scoped RLS policies
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

-- ============================================================
-- 5. Seed default tags if tags table is empty
-- ============================================================
INSERT INTO tags (name, color)
SELECT name, color
FROM (VALUES
  ('Health', 'bg-emerald-100 text-emerald-700 border-emerald-200'),
  ('Mind', 'bg-sky-100 text-sky-700 border-sky-200'),
  ('Work', 'bg-violet-100 text-violet-700 border-violet-200'),
  ('Fitness', 'bg-cyan-100 text-cyan-700 border-cyan-200')
) AS seed(name, color)
WHERE NOT EXISTS (
  SELECT 1 FROM tags t WHERE t.name = seed.name
);

-- ============================================================
-- 6. Verify the fix
-- ============================================================
-- Run this in the SQL Editor after the script completes:
--
-- SELECT table_name, column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('tags', 'habits', 'habit_completions', 'events')
--   AND column_name = 'user_id'
-- ORDER BY table_name;
--
-- Expected: 4 rows (one per table), each showing user_id column exists.
