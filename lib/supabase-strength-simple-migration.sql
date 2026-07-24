-- =====================================================================
-- ORION: Strength Logs — ultra-simple migration (replaces old workout system)
-- =====================================================================
-- Apply this in your Supabase SQL Editor (Dashboard > SQL Editor).
--
-- Design: one row per exercise per day. No workouts, no sets, no
-- templates, no volume calculations. Just the user's best working set
-- for each exercise they performed on a given date.
--
-- This replaces the old `workouts` + `workout_sets` two-table model
-- which had become unreliable. The old tables are NOT dropped — their
-- data stays intact in case you ever need to backfill from them later.
-- =====================================================================

CREATE TABLE IF NOT EXISTS strength_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  exercise_id  UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  performed_at DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg    NUMERIC(7, 2) NOT NULL CHECK (weight_kg > 0),
  reps         INTEGER CHECK (reps IS NULL OR reps > 0),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One best working set per exercise per day — enforced at the DB level.
-- The upsert path in strength-logs.ts uses this to safely overwrite
-- earlier entries when the user logs the same exercise again on the
-- same day (e.g. via "Log more"). Uses a DO block instead of
-- ADD CONSTRAINT IF NOT EXISTS for compatibility with older PG versions.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_strength_logs_user_exercise_date'
  ) THEN
    ALTER TABLE strength_logs
      ADD CONSTRAINT uq_strength_logs_user_exercise_date
      UNIQUE (user_id, exercise_id, performed_at);
  END IF;
END $$;

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_strength_logs_user_exercise
  ON strength_logs(user_id, exercise_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_strength_logs_user_date
  ON strength_logs(user_id, performed_at DESC);

-- RLS — one row per exercise entry, scoped to the owning user
ALTER TABLE strength_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns strength logs" ON strength_logs;
CREATE POLICY "User owns strength logs" ON strength_logs
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Force PostgREST to refresh its schema cache
NOTIFY pgrst, 'reload schema';

-- Smoke test — confirm the table landed
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'strength_logs'
ORDER BY ordinal_position;
