-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- Quick post-workout gym logging table.
-- One row = one exercise logged after a workout session.
-- Stores 2 working sets per exercise + optional warm-up.

CREATE TABLE IF NOT EXISTS workout_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() NOT NULL,
  workout_type TEXT NOT NULL CHECK (workout_type IN ('upper', 'lower', 'push', 'pull', 'legs', 'full')),
  exercise TEXT NOT NULL,
  set1_weight DECIMAL(8,2),
  set1_reps INTEGER CHECK (set1_reps IS NULL OR set1_reps > 0),
  set1_failure BOOLEAN DEFAULT true,
  set2_weight DECIMAL(8,2),
  set2_reps INTEGER CHECK (set2_reps IS NULL OR set2_reps > 0),
  set2_failure BOOLEAN DEFAULT true,
  warmup TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_workout_logs_user ON workout_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_logs_created_at ON workout_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_workout_logs_workout_type ON workout_logs(workout_type);

-- Enable Row Level Security
ALTER TABLE workout_logs ENABLE ROW LEVEL SECURITY;

-- Drop old policies if any
DROP POLICY IF EXISTS "User owns data" ON workout_logs;

-- User-scoped RLS policy
CREATE POLICY "User owns data" ON workout_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
