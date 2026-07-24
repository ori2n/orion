-- ============================================================
--  lib/supabase-apply-missing.sql
--  Focused fix for what the audit found missing vs. lib/*.sql
--  Findings from tmp/supabase-audit-result.json:
--    3 missing tables:  training_logs, recovery_logs, calendar_events
--    5 missing columns: habits.duration_minutes, habits.priority,
--                       nutrition_logs.calories, nutrition_logs.protein_g,
--                       workout_sets.working_sets_count
--
--  This file is the *delta* only — everything in supabase-apply-all.sql
--  that's already present is omitted. Idempotent: every CREATE/ALTER
--  uses IF NOT EXISTS and every policy uses DROP IF EXISTS before CREATE.
--  Apply this ONCE in the Supabase SQL Editor.
-- ============================================================


-- ─── from supabase-orion-redesign-migration.sql ──────────────────────────

-- 1. training_logs
CREATE TABLE IF NOT EXISTS training_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() NOT NULL,
  workout_type TEXT NOT NULL,
  exercise TEXT NOT NULL,
  weight_lbs DECIMAL(6,1),
  reps INTEGER CHECK (reps IS NULL OR reps > 0),
  rpe INTEGER NOT NULL CHECK (rpe >= 1 AND rpe <= 10),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_training_logs_user         ON training_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_training_logs_created_at   ON training_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_training_logs_exercise     ON training_logs(exercise);
CREATE INDEX IF NOT EXISTS idx_training_logs_workout_type ON training_logs(workout_type);
ALTER TABLE training_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns training data" ON training_logs;
CREATE POLICY "User owns training data" ON training_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 2. recovery_logs
CREATE TABLE IF NOT EXISTS recovery_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() NOT NULL,
  energy_level   INTEGER NOT NULL CHECK (energy_level   >= 1 AND energy_level   <= 10),
  stress_level   INTEGER NOT NULL CHECK (stress_level   >= 1 AND stress_level   <= 10),
  soreness_level INTEGER NOT NULL CHECK (soreness_level >= 1 AND soreness_level <= 10),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_user       ON recovery_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_logs_created_at ON recovery_logs(created_at);
ALTER TABLE recovery_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns recovery data" ON recovery_logs;
CREATE POLICY "User owns recovery data" ON recovery_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3. nutrition_logs: add calories + protein_g (already CREATEd by health migration)
ALTER TABLE nutrition_logs
  ADD COLUMN IF NOT EXISTS calories  INTEGER     DEFAULT 0 CHECK (calories  >= 0),
  ADD COLUMN IF NOT EXISTS protein_g DECIMAL(6,1) DEFAULT 0 CHECK (protein_g >= 0);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_calories ON nutrition_logs(calories);


-- ─── from supabase-workout-summary-migration.sql ─────────────────────────

ALTER TABLE workout_sets
  ALTER COLUMN reps DROP NOT NULL;

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS working_sets_count INTEGER
  CHECK (working_sets_count IS NULL OR working_sets_count > 0);

CREATE INDEX IF NOT EXISTS idx_workout_sets_user_exercise_summary
  ON workout_sets(user_id, exercise_id, weight_kg DESC)
  WHERE working_sets_count IS NOT NULL;


-- ─── from supabase-time-management-migration.sql ────────────────────────

ALTER TABLE habits
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS priority SMALLINT
    DEFAULT 0
    CHECK (priority BETWEEN 0 AND 3);

COMMENT ON COLUMN habits.duration_minutes IS
  'Estimated minutes to complete the habit. Drives curfew fit analysis.';
COMMENT ON COLUMN habits.priority IS
  '0 = no priority, 1 = low, 2 = medium, 3 = high. Used for recommendation ordering.';


CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  notes TEXT,
  color TEXT,
  source TEXT DEFAULT 'manual',
  CONSTRAINT calendar_events_end_after_start CHECK (end_at > start_at),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_events_user_start_idx
  ON calendar_events (user_id, start_at);
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own calendar_events"   ON calendar_events;
CREATE POLICY "Users read their own calendar_events" ON calendar_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert their own calendar_events" ON calendar_events;
CREATE POLICY "Users insert their own calendar_events" ON calendar_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update their own calendar_events" ON calendar_events;
CREATE POLICY "Users update their own calendar_events" ON calendar_events
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete their own calendar_events" ON calendar_events;
CREATE POLICY "Users delete their own calendar_events" ON calendar_events
  FOR DELETE USING (auth.uid() = user_id);


-- ─── Tell PostgREST to reload its schema cache ───────────────────────────
NOTIFY pgrst, 'reload schema';


-- ─── Smoke test ──────────────────────────────────────────────────────────
-- Run AFTER this migration commits (paste as a separate New query):
--
--   SELECT 'training_logs' AS t, count(*) FROM training_logs
--   UNION ALL SELECT 'recovery_logs',  count(*) FROM recovery_logs
--   UNION ALL SELECT 'calendar_events', count(*) FROM calendar_events;
--   -- expect 3 rows of 0
--
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND ((table_name='habits'         AND column_name IN ('duration_minutes','priority'))
--        OR (table_name='nutrition_logs' AND column_name IN ('calories','protein_g'))
--        OR (table_name='workout_sets'   AND column_name =  'working_sets_count'))
--    ORDER BY table_name, column_name;
--   -- expect 5 rows
