-- =====================================================================
-- ORION: Fitness migration — long-term progress tracking dashboard
-- =====================================================================
-- Apply AFTER supabase-fix-habits-migration.sql.
-- Tables follow the same `user_id = auth.uid()` RLS pattern as Habits.
-- All workout / photo / weight / sleep / checkin data is private to the
-- signed-in user. PRs are computed client-side in JS (no need for a
-- personal_records table — avoids drift between mutated history and
-- materialised PRs).
-- =====================================================================


-- ─── 1. Exercises (master list of movements) ──────────────────────
CREATE TABLE IF NOT EXISTS exercises (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  name         TEXT NOT NULL,
  category     TEXT,                       -- 'push' / 'pull' / 'legs' / 'core' / 'cardio'
  notes        TEXT,
  is_archived  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exercises_user_id          ON exercises(user_id);
CREATE INDEX IF NOT EXISTS idx_exercises_user_name_unique ON exercises(user_id, lower(name));

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns exercises" ON exercises;
CREATE POLICY "User owns exercises" ON exercises
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 2. Workouts (a single training session) ───────────────────────
CREATE TABLE IF NOT EXISTS workouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  name         TEXT,                       -- e.g. "Push Day", "Leg Day"
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes        TEXT,
  ai_raw_text  TEXT,                       -- original voice/text input for AI replay
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_performed
  ON workouts(user_id, performed_at DESC);

ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns workouts" ON workouts;
CREATE POLICY "User owns workouts" ON workouts
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 3. Workout Sets (each set within a workout) ───────────────────
-- AI-ready flat table — future LLM parsers can map natural language
-- ("Bench was 70kg for 5, then 72.5kg for 3") onto these exact columns.
CREATE TABLE IF NOT EXISTS workout_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_id  UUID NOT NULL REFERENCES workouts(id)  ON DELETE CASCADE,
  exercise_id UUID NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  user_id     UUID NOT NULL DEFAULT auth.uid(),
  set_order   INT NOT NULL DEFAULT 1,
  weight_kg   NUMERIC(7, 2) NOT NULL CHECK (weight_kg >= 0),
  reps        INT NOT NULL CHECK (reps > 0),
  rpe         NUMERIC(3, 1) CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_sets_workout  ON workout_sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise ON workout_sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_workout_sets_user_exercise_created
  ON workout_sets(user_id, exercise_id, created_at DESC);

ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns workout sets" ON workout_sets;
CREATE POLICY "User owns workout sets" ON workout_sets
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 4. Weight entries (body weight log) ──────────────────────────
CREATE TABLE IF NOT EXISTS weight_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL DEFAULT auth.uid(),
  weight_kg   NUMERIC(5, 2) NOT NULL CHECK (weight_kg > 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weight_entries_user_recorded
  ON weight_entries(user_id, recorded_at DESC);

ALTER TABLE weight_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns weight entries" ON weight_entries;
CREATE POLICY "User owns weight entries" ON weight_entries
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 5. Weight target (one row per user) ──────────────────────────
CREATE TABLE IF NOT EXISTS weight_target (
  user_id   UUID PRIMARY KEY DEFAULT auth.uid(),
  target_kg NUMERIC(5, 2) NOT NULL CHECK (target_kg > 0),
  set_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes     TEXT
);

ALTER TABLE weight_target ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns weight target" ON weight_target;
CREATE POLICY "User owns weight target" ON weight_target
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 6. Physique photos ───────────────────────────────────────────
-- Image bytes live in a private Supabase Storage bucket (`physique-photos`).
-- This table records ONE row per photo — keeps ordering, deletes, and
-- before/after queries simple.
CREATE TABLE IF NOT EXISTS physique_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL DEFAULT auth.uid(),
  taken_at      DATE NOT NULL,
  pose_type     TEXT CHECK (pose_type IN ('front','back','side','other')),
  photo_path    TEXT NOT NULL,             -- "{user_id}/{uuid}.jpg" inside the bucket
  body_weight_kg NUMERIC(5, 2),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_physique_photos_user_taken
  ON physique_photos(user_id, taken_at DESC);

ALTER TABLE physique_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns physique photos" ON physique_photos;
CREATE POLICY "User owns physique photos" ON physique_photos
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 7. Sleep entries ─────────────────────────────────────────────
-- `hours` is GENERATED from bedtime → wake_time so the UI never has to
-- compute it.
CREATE TABLE IF NOT EXISTS sleep_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL DEFAULT auth.uid(),
  sleep_date DATE NOT NULL,
  bedtime    TIMESTAMPTZ NOT NULL,
  wake_time  TIMESTAMPTZ NOT NULL,
  hours      NUMERIC(4, 2) GENERATED ALWAYS AS
              (EXTRACT(EPOCH FROM (wake_time - bedtime)) / 3600.0) STORED,
  quality    SMALLINT CHECK (quality IS NULL OR quality BETWEEN 1 AND 5),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sleep_entries_user_date
  ON sleep_entries(user_id, sleep_date DESC);

ALTER TABLE sleep_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns sleep entries" ON sleep_entries;
CREATE POLICY "User owns sleep entries" ON sleep_entries
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 8. Daily check-ins (minimal — sleep + workout + notes) ──────
CREATE TABLE IF NOT EXISTS daily_checkins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  checkin_date DATE NOT NULL,
  sleep_id     UUID REFERENCES sleep_entries(id) ON DELETE SET NULL,
  workout_id   UUID REFERENCES workouts(id)    ON DELETE SET NULL,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT  uq_daily_checkins_user_date UNIQUE (user_id, checkin_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_checkins_user_date
  ON daily_checkins(user_id, checkin_date DESC);

ALTER TABLE daily_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns daily checkins" ON daily_checkins;
CREATE POLICY "User owns daily checkins" ON daily_checkins
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 9. Milestones (manual + auto-generated flashbacks) ───────────
-- Manual milestones are user-created. Auto milestones will be written
-- by the future Flashback engine as significant deltas are detected.
CREATE TABLE IF NOT EXISTS milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  kind         TEXT NOT NULL CHECK (kind IN ('auto', 'manual')),
  title        TEXT NOT NULL,
  description  TEXT,
  achieved_at  TIMESTAMPTZ NOT NULL,
  related_data JSONB,                       -- e.g. { exercise: 'bench', lifts: [...] }
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_user_achieved
  ON milestones(user_id, achieved_at DESC);

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns milestones" ON milestones;
CREATE POLICY "User owns milestones" ON milestones
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- =====================================================================
-- Storage bucket for physique photos
-- =====================================================================
-- Create the private bucket (run ONCE in Supabase Dashboard → Storage,
-- or uncomment the SQL below in a fresh project). Path convention:
--   {user_id}/{photo_id}.{ext}
-- The RLS policy on storage.objects restricts access so users can only
-- read/write objects whose first path segment is their own auth.uid().
-- =====================================================================

-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('physique-photos', 'physique-photos', false)
-- ON CONFLICT (id) DO NOTHING;

-- DROP POLICY IF EXISTS "User owns photo objects read"   ON storage.objects;
-- DROP POLICY IF EXISTS "User owns photo objects insert"  ON storage.objects;
-- DROP POLICY IF EXISTS "User owns photo objects update"  ON storage.objects;
-- DROP POLICY IF EXISTS "User owns photo objects delete"  ON storage.objects;
--
-- CREATE POLICY "User owns photo objects read"   ON storage.objects
--   FOR SELECT TO authenticated
--   USING (bucket_id = 'physique-photos'
--          AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "User owns photo objects insert"  ON storage.objects
--   FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'physique-photos'
--               AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "User owns photo objects update"  ON storage.objects
--   FOR UPDATE TO authenticated
--   USING (bucket_id = 'physique-photos'
--          AND auth.uid()::text = (storage.foldername(name))[1]);
-- CREATE POLICY "User owns photo objects delete"  ON storage.objects
--   FOR DELETE TO authenticated
--   USING (bucket_id = 'physique-photos'
--          AND auth.uid()::text = (storage.foldername(name))[1]);
