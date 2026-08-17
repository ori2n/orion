-- =====================================================================
-- ORION: Per-muscle training targets + user notes — Stage 5
-- =====================================================================
-- Apply this in your Supabase SQL Editor (Dashboard > SQL Editor).
--
-- One row per (user, muscle). Holds:
--   - target_sessions_per_week — the user's personalised target.
--     Default seeded later in the UI (no DB-side default; we don't want
--     to silently assume a "2" is right for every muscle).
--   - notes — free-form user context, e.g.
--       "Keep lower because of football, tennis and sprint training."
--
-- These rows inform the on-target status the dashboard derives from
-- imported Hevy workout data. They are USER-OWNED and never
-- auto-overwritten (Stage 5 explicitly forbids AI rewrite).
-- =====================================================================

CREATE TABLE IF NOT EXISTS hevy_muscle_targets (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL DEFAULT auth.uid(),
  muscle                      TEXT NOT NULL,                 -- matches lib/fitness/hevy/muscle-data.ts MUSCLES
  target_sessions_per_week    NUMERIC(4, 2) NOT NULL CHECK (target_sessions_per_week >= 0),
  notes                       TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One target row per (user, muscle).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hevy_muscle_targets_user_muscle
  ON hevy_muscle_targets(user_id, muscle);

ALTER TABLE hevy_muscle_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "User owns hevy muscle targets" ON hevy_muscle_targets;
CREATE POLICY "User owns hevy muscle targets" ON hevy_muscle_targets
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';

-- Smoke test — should return 1 row once created.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'hevy_muscle_targets';
