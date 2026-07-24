-- ============================================================
--  lib/supabase-apply-calendar-redesign.sql
--  Calendar redesign v2 — additive migration on top of
--  lib/supabase-apply-missing.sql. Adds two columns needed
--  by the new CalendarPanel component:
--
--    all_day     BOOLEAN — true for holidays and all-day events.
--                 When true, start_at/end_at lock to 00:00:00/
--                 23:59:59 of the same day for cross-view rendering.
--    recurrence  TEXT    — JSON-encoded RRULE-subset string,
--                 e.g. {"freq":"WEEKLY","byweekday":["MO","WE"]}.
--                 Expansion (showing N weeks of a recurring event)
--                 is a client-side follow-up; this migration only
--                 stores the rule.
--
--  Idempotent: ADD COLUMN IF NOT EXISTS, so re-runs are safe.
--  Apply via the Supabase SQL Editor after
--  lib/supabase-apply-missing.sql.
-- ============================================================

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS all_day    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurrence TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_events_all_day
  ON calendar_events(user_id, all_day)
  WHERE all_day = TRUE;

NOTIFY pgrst, 'reload schema';
