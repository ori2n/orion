-- =====================================================================
-- ORION: Workout summary model — additive migration
-- =====================================================================
-- Apply AFTER supabase-fitness-migration.sql.
--
-- Purpose: switch the logging UI from "one row per set" to "one row per
-- (workout, exercise)" where the row stores the BEST working set
-- (weight, optional reps) plus the count of working sets. Legacy rows
-- are preserved unchanged; new entries fill the new columns.
--
-- Why additive (not destructive):
--   1. Legacy rows in workout_sets have `reps` always set, so dropping
--      NOT NULL on `reps` is safe and non-destructive — existing data
--      is unaffected.
--   2. Adding working_sets_count as NULLABLE keeps legacy rows valid
--      (NULL = "we don't know, treat as 1 set for analytics").
--   3. Future Hevy / voice / AI parsers can drop into the same table
--      with full per-set detail OR with summary rows; both shapes
--      are now first-class.
--
-- Rollback:
--   ALTER TABLE workout_sets DROP COLUMN IF EXISTS working_sets_count;
--   ALTER TABLE workout_sets ALTER COLUMN reps SET NOT NULL;
-- (safe — losing the new column does not destroy data; only the summary
--  numbers are gone. The NOT NULL re-add will fail if any NULL reps
--  exist; delete or backfill those rows first.)
-- =====================================================================


-- ─── 1. Make `reps` optional (best working set reps can be skipped) ──
ALTER TABLE workout_sets
  ALTER COLUMN reps DROP NOT NULL;


-- ─── 2. Add the working-sets-count column (legacy rows stay NULL) ────
ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS working_sets_count INTEGER
  CHECK (working_sets_count IS NULL OR working_sets_count > 0);

-- No backfill: legacy multi-row workouts stay with working_sets_count
-- = NULL. `effectiveSetCount(NULL) = 1` (lib/fitness/strength.ts),
-- so the analytics volume formula `Σ(weight × reps × 1)` summed over
-- all legacy rows of a multi-set exercise yields the correct total
-- (each row = one set). The alternative — stamping every sibling row
-- with the group count and multiplying — would 3× the volume for any
-- user that pre-dated this migration.


-- ─── 3. Index to speed up "latest summary row per (user, exercise)" ───
CREATE INDEX IF NOT EXISTS idx_workout_sets_user_exercise_summary
  ON workout_sets(user_id, exercise_id, weight_kg DESC)
  WHERE working_sets_count IS NOT NULL;


-- ─── 4. RLS already covers this table from prior migration ───────────
-- The "User owns workout sets" policy from supabase-fitness-migration.sql
-- is FOR ALL (SELECT / INSERT / UPDATE / DELETE) — fully covers the
-- new column. Re-affirm instead of re-creating to avoid DeadlockRisk:
-- (we learned from the earlier incident that iterating pg_policies is
-- unsafe under multiple statements in one transaction).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workout_sets'
       AND policyname = 'User owns workout sets'
  ) THEN
    ALTER TABLE workout_sets ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "User owns workout sets" ON workout_sets
      FOR ALL TO authenticated
      USING      (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;


-- ─── 5. Force PostgREST to refresh its schema cache ──────────────────
-- After this migration, the new column is queryable in the browser
-- without manually re-deploying the PostgREST schema. Caveat: NOTIFY
-- only fires on COMMIT — if any statement above errors, the NOTIFY is
-- silently dropped. The smoke-test SELECT immediately below is the
-- durable "did the columns land?" answer regardless.
NOTIFY pgrst, 'reload schema';


-- ─── 6. In-script smoke test (renders immediately in Results tab) ────
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'workout_sets'
  AND column_name  IN ('working_sets_count', 'reps', 'weight_kg')
ORDER BY column_name;

-- ─── Verification (run as a separate query after the block above) ────
--
-- Confirm the new column + nullable reps:
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'workout_sets'
--      AND column_name IN ('reps', 'working_sets_count')
--    ORDER BY column_name;
--
-- Quick sanity: NULL reps (user logged weight only) + NON-NULL weight:
--   SELECT COUNT(*) AS weight_only_logs
--     FROM workout_sets
--    WHERE reps IS NULL AND weight_kg > 0;
--
-- Legacy row distribution (no NULL backfill on this run):
--   SELECT
--     COUNT(*) FILTER (WHERE working_sets_count IS NULL) AS legacy_null,
--     COUNT(*) FILTER (WHERE working_sets_count IS NOT NULL) AS explicit
--   FROM workout_sets;
