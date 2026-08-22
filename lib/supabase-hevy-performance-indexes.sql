-- ORION performance: missing user_id indexes on the Hevy child tables.
--
-- Every query against these tables filters by user_id — both the
-- application (`.eq('user_id', …)`) AND the RLS policy
-- (`user_id = auth.uid()`). The original migrations only indexed the
-- child tables by their FK parent id, so Postgres has been
-- seq-scanning them per request. With ~800 sets that is still
-- wasteful; as history grows it gets worse.
--
-- Paste this once in Supabase → SQL Editor → New query → Run.
-- Idempotent — safe to re-run.

CREATE INDEX IF NOT EXISTS idx_hevy_workout_exercises_user_workout
  ON hevy_workout_exercises(user_id, workout_id);

CREATE INDEX IF NOT EXISTS idx_hevy_workout_sets_user_exercise
  ON hevy_workout_sets(user_id, workout_exercise_id);
