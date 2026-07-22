-- Time Management — Phase 1 schema foundation
--
-- Additions:
--   1. habits.duration_minutes — optional estimated duration per habit.
--      The "smart habits" logic (curfew-based AVAILABLE/LOCKED states
--      and live recommendations) reads this column to decide whether a
--      habit fits in the remaining free time before curfew.
--   2. habits.priority — optional integer 0-3 (0 = no priority, 1 = low,
--      2 = medium, 3 = high). Drives ordering in the recommendations
--      banner; higher priority = appears earlier.
--
-- New table:
--   3. calendar_events — fixed commitments ONLY (school, tennis,
--      football, appointments, holidays, manually created events).
--      Habits are intentionally NOT stored here — they remain
--      checkbox-based daily priorities; the calendar is reserved for
--      blocks that genuinely consume time.

-- ─── habits: add duration + priority ───────────────────────────────

ALTER TABLE habits
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS priority SMALLINT
    DEFAULT 0
    CHECK (priority BETWEEN 0 AND 3);

COMMENT ON COLUMN habits.duration_minutes IS
  'Estimated minutes to complete the habit. Drives curfew fit analysis.';
COMMENT ON COLUMN habits.priority IS
  '0 = no priority, 1 = low, 2 = medium, 3 = high. Used for recommendation ordering.';

-- ─── calendar_events: fixed commitments only ────────────────────────

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  -- Optional visual + placement metadata
  location TEXT,
  notes TEXT,
  color TEXT,                -- e.g. 'bg-rose-500' or null for default
  -- Used to distinguish fixed manual blocks from auto-imported ones
  -- (Google Calendar, ICS, etc.) — Phase 4.
  source TEXT DEFAULT 'manual',
  CONSTRAINT calendar_events_end_after_start CHECK (end_at > start_at),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_events_user_start_idx
  ON calendar_events (user_id, start_at);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own calendar_events" ON calendar_events;
CREATE POLICY "Users read their own calendar_events" ON calendar_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert their own calendar_events" ON calendar_events;
CREATE POLICY "Users insert their own calendar_events" ON calendar_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update their own calendar_events" ON calendar_events;
CREATE POLICY "Users update their own calendar_events" ON calendar_events
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete their own calendar_events" ON calendar_events;
CREATE POLICY "Users delete their own calendar_events" ON calendar_events
  FOR DELETE USING (auth.uid() = user_id);
