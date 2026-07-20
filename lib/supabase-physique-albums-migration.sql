-- =====================================================================
-- ORION: Physique album metadata
-- =====================================================================
-- Adds `session_title` and `cover_photo_id` to `physique_photos`. Both
-- are DENORMALIZED across every photo of a session, matching the
-- existing pattern (notes, body_weight_kg, is_favourited). Reads stay
-- trivially indexed by user_id + taken_at; writes happen as one UPDATE
-- per session (`WHERE user_id = … AND taken_at = …`).
--
-- Required by the album-style gallery redesign:
--   - session_title is the user-given album name ("Summer Bulk", etc.)
--   - cover_photo_id lets the user pin a specific photo as the cover;
--     NULL means "use the first uploaded photo" (groupPhotosIntoSessions
--     fallback)
-- =====================================================================

ALTER TABLE physique_photos
  ADD COLUMN IF NOT EXISTS session_title TEXT,
  ADD COLUMN IF NOT EXISTS cover_photo_id UUID
    REFERENCES physique_photos(id)
    ON DELETE SET NULL;

-- ============================================================================
-- No additional RLS changes: existing policy covers all columns
-- (`USING (user_id = auth.uid())`). New columns inherit that.
-- ============================================================================
