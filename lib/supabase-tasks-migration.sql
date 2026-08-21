-- ============================================================
-- MIGRATION: Create tasks table for the To-Do list
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- after the habits fix migration has been applied.
-- ============================================================

-- ============================================================
-- 1. Create tasks table
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  scheduled_for DATE,
  duration_minutes INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- For databases created before the notes column was added.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT;

-- Make the task day/date optional (undated tasks → Upcoming).
ALTER TABLE tasks ALTER COLUMN scheduled_for DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_for ON tasks(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- ============================================================
-- 2. Enable RLS
-- ============================================================
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Drop stale policies (safe to re-run)
-- ============================================================
DROP POLICY IF EXISTS "Public access" ON tasks;
DROP POLICY IF EXISTS "User owns data" ON tasks;

-- ============================================================
-- 4. Create user-scoped RLS policies
-- ============================================================
CREATE POLICY "User owns data" ON tasks
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
