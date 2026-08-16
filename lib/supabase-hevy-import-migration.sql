-- =====================================================================
-- ORION: Hevy import foundation — Stage 1
-- =====================================================================
-- Apply this in your Supabase SQL Editor (Dashboard > SQL Editor).
--
-- Creates the clean, Hevy-native workout data model that replaces the
-- old manual `workouts` + `workout_sets` two-table logger. The old
-- tables are LEFT INTACT (see note at the bottom) — their data stays
-- available in case a future backfill needs it.
--
-- Data model:
--   hevy_imports            — one row per import (provenance + diagnostics)
--   hevy_workouts           — one row per Hevy workout session
--   hevy_workout_exercises  — one row per exercise block within a workout
--   hevy_workout_sets       — one row per individual set
--
-- Idempotency: a workout is identified by (user_id, source_start_time)
-- where source_start_time is the RAW "16 Aug 2026, 19:23" string from the
-- Hevy export. Re-importing the same history upserts instead of duplicating.
--
-- All tables follow the existing `user_id = auth.uid()` RLS pattern.
-- =====================================================================


-- ─── 1. Import provenance / diagnostics ────────────────────────────
CREATE TABLE IF NOT EXISTS hevy_imports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL DEFAULT auth.uid(),
  status            TEXT NOT NULL DEFAULT 'completed',  -- 'completed' | 'failed'
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  workouts_checked   INT NOT NULL DEFAULT 0,
  workouts_created   INT NOT NULL DEFAULT 0,
  workouts_updated   INT NOT NULL DEFAULT 0,
  workouts_unchanged INT NOT NULL DEFAULT 0,
  sets_processed    INT NOT NULL DEFAULT 0,
  date_min          DATE,
  date_max          DATE,
  warnings          JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_file_name     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hevy_imports_user
  ON hevy_imports(user_id, created_at DESC);

ALTER TABLE hevy_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns hevy imports" ON hevy_imports;
CREATE POLICY "User owns hevy imports" ON hevy_imports
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 2. Workouts (one Hevy training session) ───────────────────────
CREATE TABLE IF NOT EXISTS hevy_workouts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL DEFAULT auth.uid(),
  source_start_time TEXT NOT NULL,   -- raw "16 Aug 2026, 19:23" (idempotency key)
  title             TEXT,
  description       TEXT,
  start_time        TIMESTAMPTZ,     -- parsed from source_start_time
  end_time          TIMESTAMPTZ,     -- parsed from the export's end_time
  content_hash      TEXT NOT NULL,   -- fingerprint for change detection
  source_import_id  UUID REFERENCES hevy_imports(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One workout per (user, raw start time). Re-imports upsert here.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hevy_workouts_user_source
  ON hevy_workouts(user_id, source_start_time);

CREATE INDEX IF NOT EXISTS idx_hevy_workouts_user_start
  ON hevy_workouts(user_id, start_time DESC);

ALTER TABLE hevy_workouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns hevy workouts" ON hevy_workouts;
CREATE POLICY "User owns hevy workouts" ON hevy_workouts
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 3. Exercises within a workout ─────────────────────────────────
CREATE TABLE IF NOT EXISTS hevy_workout_exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  workout_id   UUID NOT NULL REFERENCES hevy_workouts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,       -- Hevy exercise title (denormalized on purpose)
  superset_id  INT,                 -- Hevy superset group (NULL = not supersetted)
  notes        TEXT,                -- Hevy exercise_notes
  order_index  INT NOT NULL DEFAULT 0,  -- position within the workout
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hevy_workout_exercises_workout
  ON hevy_workout_exercises(workout_id, order_index);

ALTER TABLE hevy_workout_exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns hevy workout exercises" ON hevy_workout_exercises;
CREATE POLICY "User owns hevy workout exercises" ON hevy_workout_exercises
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 4. Individual sets ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hevy_workout_sets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL DEFAULT auth.uid(),
  workout_exercise_id UUID NOT NULL REFERENCES hevy_workout_exercises(id) ON DELETE CASCADE,
  set_index          INT NOT NULL DEFAULT 0,
  set_type           TEXT,             -- 'normal' | 'warmup' | 'drop' | 'failure'
  weight_kg          NUMERIC(7, 2),    -- NULL for bodyweight / timed sets
  reps               INT,              -- NULL for timed / distance sets
  distance_km        NUMERIC(7, 2),    -- cardio
  duration_seconds   INT,              -- timed sets (plank, dead hang, cardio)
  rpe                NUMERIC(3, 1),    -- preserved if present
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hevy_workout_sets_exercise
  ON hevy_workout_sets(workout_exercise_id, set_index);

ALTER TABLE hevy_workout_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns hevy workout sets" ON hevy_workout_sets;
CREATE POLICY "User owns hevy workout sets" ON hevy_workout_sets
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =====================================================================
-- Force PostgREST to reload its schema cache so the new tables are
-- queryable from the browser without a manual dashboard reload.
-- =====================================================================
NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- In-script smoke test (renders immediately in the Results tab)
-- =====================================================================
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'hevy_imports',
    'hevy_workouts',
    'hevy_workout_exercises',
    'hevy_workout_sets'
  )
ORDER BY table_name;

-- You should see 4 rows. If any is missing, the migration was
-- interrupted — re-run it.


-- =====================================================================
-- NOTE: the old `workouts` + `workout_sets` tables are NOT dropped.
-- They are obsolete (replaced by `strength_logs` and now the Hevy
-- model) but their rows are kept in case a future backfill is needed.
-- =====================================================================
