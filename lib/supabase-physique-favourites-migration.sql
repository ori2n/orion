-- =====================================================================
-- ORION: Physique Favourites Migration (additive)
-- =====================================================================
-- Apply AFTER supabase-fitness-migration.sql.
-- Adds the star/favourite primitives needed by the new Physique Timeline
-- + Gallery split. Pure additive — won't break any existing rows.
--
--   • is_favourited      — star toggle, drives what shows in Timeline
--   • featured_at        — wall-clock moment of last star (for ordering)
--   • pose_type CHECK    — relaxed to allow custom pose strings
-- =====================================================================

-- ─── 1. Favourited columns ──────────────────────────────────────
ALTER TABLE physique_photos
  ADD COLUMN IF NOT EXISTS is_favourited BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE physique_photos
  ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_physique_photos_starred
  ON physique_photos(user_id, is_favourited, taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_physique_photos_user_taken
  ON physique_photos(user_id, taken_at DESC);


-- ─── 2. Relax pose_type CHECK ───────────────────────────────────
-- The old constraint hard-coded ('front','back','side','other'). New
-- upload flow lets users type custom pose labels ('relaxed','flexed',
-- 'competition', etc.). We replace the CHECK with a permissive one
-- (TEXT NULL is fine), and keep the RLS policy intact.
ALTER TABLE physique_photos
  DROP CONSTRAINT IF EXISTS physique_photos_pose_type_check;

ALTER TABLE physique_photos
  ADD CONSTRAINT physique_photos_pose_type_check
    CHECK (pose_type IS NULL OR length(pose_type) <= 32);


-- ─── 3. RLS — already user-scoped, no change ────────────────────
-- Re-stating for documentation; the existing policy from
-- supabase-fitness-migration.sql already covers these columns.


-- ─── 4. Optional: backfill magnet ───────────────────────────────
-- If you previously starred photos in some other tool, populate
-- `featured_at = created_at` so the dashboard hero picks up straight
-- away. Safe to re-run.
UPDATE physique_photos
   SET featured_at = created_at
 WHERE is_favourited = TRUE
   AND featured_at IS NULL;
