-- =====================================================================
-- ORION: Hevy calculation engine metadata — Stage 4
-- =====================================================================
-- Apply this in your Supabase SQL Editor (Dashboard > SQL Editor).
--
-- Adds `hevy_exercise_meta`: one row per (user, exercise name) holding
--   - `muscle`       — the primary muscle group (seeded by the app)
--   - `manual_1rm_kg` — the user's manually-entered 1RM (never overwritten
--                       by the estimated 1RM)
--
-- This supports Stage 4's deterministic metrics (sets per muscle/week,
-- manual 1RM) without touching the imported workout data.
-- =====================================================================

CREATE TABLE IF NOT EXISTS hevy_exercise_meta (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL DEFAULT auth.uid(),
  exercise_name  TEXT NOT NULL,          -- exact Hevy exercise title
  muscle         TEXT,                   -- primary muscle group (NULL = unmapped)
  manual_1rm_kg  NUMERIC(7, 2),          -- user's manual 1RM (NULL = not set)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One metadata row per (user, exercise name).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hevy_exercise_meta_user_name
  ON hevy_exercise_meta(user_id, exercise_name);

ALTER TABLE hevy_exercise_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns hevy exercise meta" ON hevy_exercise_meta;
CREATE POLICY "User owns hevy exercise meta" ON hevy_exercise_meta
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- Smoke test — should return 1 row once created.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'hevy_exercise_meta';
