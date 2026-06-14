-- ================================================================
-- ORION Health Redesign Migration — Speed & Insight
-- ================================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Changes:
-- 1. NEW: training_logs — simplified workout logging (type, exercise, weight, reps, RPE)
-- 2. ALTER: nutrition_logs — add calories, protein_g columns
-- 3. NEW: recovery_logs — replaces manual_inputs for quick recovery logging
-- 4. DROP: focus_level from manual_inputs (simplify)
--
-- All new tables include user_id for RLS scoping.
-- ================================================================

-- ================================================================
-- 1. training_logs — simplified one-row-per-exercise workouts
-- ================================================================
CREATE TABLE IF NOT EXISTS training_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() NOT NULL,
  workout_type TEXT NOT NULL,          -- free text: 'Upper', 'Push', 'Run', etc.
  exercise TEXT NOT NULL,              -- primary exercise name
  weight_lbs DECIMAL(6,1),            -- best working set weight in lbs (nullable for bodyweight)
  reps INTEGER CHECK (reps IS NULL OR reps > 0),  -- best working set reps
  rpe INTEGER NOT NULL CHECK (rpe >= 1 AND rpe <= 10),  -- perceived effort 1-10
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_training_logs_user ON training_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_training_logs_created_at ON training_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_training_logs_exercise ON training_logs(exercise);
CREATE INDEX IF NOT EXISTS idx_training_logs_workout_type ON training_logs(workout_type);

ALTER TABLE training_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns training data" ON training_logs;
CREATE POLICY "User owns training data" ON training_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ================================================================
-- 2. nutrition_logs — add new columns for simplified tracking
-- ================================================================
ALTER TABLE nutrition_logs
  ADD COLUMN IF NOT EXISTS calories INTEGER DEFAULT 0 CHECK (calories >= 0),
  ADD COLUMN IF NOT EXISTS protein_g DECIMAL(6,1) DEFAULT 0 CHECK (protein_g >= 0);

-- The old columns (water_ml, caffeine_mg, caffeine_time, creatine_taken)
-- are kept for backward compatibility with existing data but will no
-- longer be used by the new quick-log flows.

CREATE INDEX IF NOT EXISTS idx_nutrition_logs_calories ON nutrition_logs(calories);

-- ================================================================
-- 3. recovery_logs — energy, stress, soreness quick-log
-- ================================================================
CREATE TABLE IF NOT EXISTS recovery_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() NOT NULL,
  energy_level INTEGER NOT NULL CHECK (energy_level >= 1 AND energy_level <= 10),
  stress_level INTEGER NOT NULL CHECK (stress_level >= 1 AND stress_level <= 10),
  soreness_level INTEGER NOT NULL CHECK (soreness_level >= 1 AND soreness_level <= 10),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recovery_logs_user ON recovery_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_created_at ON recovery_logs(created_at);

ALTER TABLE recovery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns recovery data" ON recovery_logs;
CREATE POLICY "User owns recovery data" ON recovery_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ================================================================
-- 4. Simplify manual_inputs — drop focus_level (optional)
-- ================================================================
-- The manual_inputs table is kept (with existing data) but the
-- focus_level column is removed since it's not used in the new
-- recovery flow. If you want to keep historical focus_level data,
-- COMMENT OUT this ALTER statement.
--
-- ALTER TABLE manual_inputs DROP COLUMN IF EXISTS focus_level;

-- ================================================================
-- 5. Update nutrition_logs RLS (already exists from previous migration)
-- ================================================================
-- nutrition_logs RLS is already enabled from the previous health migration.
-- No changes needed unless you see errors about missing policies.

-- ================================================================
-- Verification Queries (run after migration in SQL Editor)
-- ================================================================
--
-- Check tables exist:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--     AND table_name IN ('training_logs', 'recovery_logs')
--   ORDER BY table_name;
--
-- Check nutrition_logs columns:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'nutrition_logs'
--   ORDER BY ordinal_position;
