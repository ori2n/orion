-- =====================================================================
-- ORION: Physique photos — schema fix & RLS upsert (deadlock-safe)
-- =====================================================================
-- Apply when:
--   • setSessionCover() (album cover) fails because `cover_photo_id`
--     or `session_title` columns are missing.
--   • UPDATE on physique_photos returns 0 rows (silent RLS denial).
--
-- ─── Why `cover_photo_id` lives on `physique_photos` (denormalized) ───
-- A separate `physique_sessions` table was considered and rejected:
--   • ORION already denormalizes `notes`, `body_weight_kg`,
--     `is_favourited`, `featured_at`, and `session_title` across
--     every photo of the same `taken_at` — sessions are derived from
--     the photo rows themselves, not stored separately.
--   • A dedicated sessions table would require a JOIN on every read
--     (gallery list, dashboard hero pick, compare-sessions, timeline)
--     AND a migration of every existing photo row to backfill a
--     session_id. That's a lot of chURn for ~100 sessions × <10 photos
--     per user (the typical scale).
--   • Cover change is one `UPDATE … WHERE user_id = ? AND taken_at = ?`
--     across the session's rows, all of which already have their
--     own `cover_photo_id`. Storing it as a self-FK inside the same
--     table keeps the session write atomic, observable, and trivially
--     indexed by (user_id, cover_photo_id).
--   • Self-reference (cover points at a member of the same table) is
--     intentional — see the “no self-cover CHECK” note in §3 below.
-- Conclusion: keep the current denormalized design.
--
-- ─── Design notes (this rewrite replaces an earlier version that
--     deadlocked with SQLSTATE 40P01):                         ───
--
--   • NO iteration over pg_policies. The earlier draft looped
--     EXECUTE 'DROP POLICY' over every policy on the table. Inside
--     Supabase's implicit transaction that sequence deadlocked with
--     concurrent lock holders (autovacuum or other clients). This
--     version touches a SINGLE well-known policy and leaves every
--     other policy you defined absolutely intact.
--
--   • NO DO blocks. All DDL is top-level ALTER/CREATE statements
--     with brief share-locks that don't escalate to AccessExclusive.
--
--   • The "User owns physique photos" policy is upserted — single
--     DROP IF EXISTS for the well-known name, followed by a single
--     CREATE with FOR ALL TO authenticated. This guarantees
--     SELECT/INSERT/UPDATE/DELETE all work for the signed-in user.
--
--   • The FK from cover_photo_id back to physique_photos(id) uses
--     ON DELETE SET NULL so deleting a pinned cover cleanly falls
--     back to "first uploaded photo" without leaving dangling refs.
--
--   • We deliberately do NOT add a `cover_photo_id <> id` CHECK.
--     ORION's denormalized session model writes
--       UPDATE physique_photos
--          SET cover_photo_id = :picked_id
--        WHERE user_id = :u AND taken_at = :d
--     across every photo of the session — including the picked
--     photo itself (so its own row reads `cover_photo_id = self.id`,
--     which groupPhotosIntoSessions treats as the "pinned" signal).
-- =====================================================================


-- ─── 1. Columns (idempotent; metadata-only when columns exist) ──
ALTER TABLE physique_photos
  ADD COLUMN IF NOT EXISTS session_title TEXT;

ALTER TABLE physique_photos
  ADD COLUMN IF NOT EXISTS cover_photo_id UUID
    REFERENCES physique_photos(id)
    ON DELETE SET NULL;


-- ─── 2. Cover-resolution lookup index ────────────────────────────
-- Concurrently built the first time; instant no-op on re-run.
CREATE INDEX IF NOT EXISTS idx_physique_photos_cover
  ON physique_photos(user_id, cover_photo_id)
  WHERE cover_photo_id IS NOT NULL;


-- ─── 3. Make sure RLS is on (no-op if already enabled) ──────────
ALTER TABLE physique_photos ENABLE ROW LEVEL SECURITY;


-- ─── 4. Upsert ONLY the canonical policy ─────────────────────────
-- Single DROP for the well-known name, then a single CREATE. Any
-- other policies you defined (e.g. custom team-sharing rules,
-- premium tier visibility) are NOT touched and remain fully armed.
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "User owns physique photos" ON physique_photos;

CREATE POLICY "User owns physique photos" ON physique_photos
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 5. Tell PostgREST to reload its schema cache ────────────────
-- The new column is normally visible in seconds, but a defensive
-- NOTIFY avoids the rare case where the next browser refresh still
-- surfaces a stale 42703. The `pgrst` channel is exposed by
-- Supabase automatically.
--
-- Caveat: NOTIFY only fires when the surrounding transaction
-- COMMITS. If a future regression ever causes this script to
-- rollback at any earlier step (deadlock, FK validation, etc.),
-- this message is silently dropped — the in-script SELECT below
-- is the durable "did the columns land?" answer regardless.
NOTIFY pgrst, 'reload schema';


-- ─── 6. In-script smoke test ─────────────────────────────────────
-- Renders directly in the SQL Editor's "Results" tab so the user
-- sees confirmation in the same page they just ran. Plain SELECT
-- only — no DO block, no DDL, no lock escalation.
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'physique_photos'
  AND column_name  IN ('session_title', 'cover_photo_id')
ORDER BY column_name;

-- You should see two rows: cover_photo_id (uuid, YES), session_title (text, YES).
-- If a row is missing, the migration was interrupted — re-run it.


-- =====================================================================
-- LATE-CHECK VERIFICATION (run as a SECOND separate New query after
-- this migration commits — also not part of the live script, to
-- keep the lock footprint minimal):
--
--   SELECT policyname, cmd
--     FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename  = 'physique_photos';
--   -- You should see "User owns physique photos" with cmd='ALL'
--   -- plus any custom policies you defined.
-- =====================================================================
