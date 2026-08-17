-- Time Management — Phase 1 schema foundation
--
-- Three SEPARATE systems on purpose:
--   1. habits + habit_completions — recurring behaviours with daily
--      completion + completion history.
--   2. tasks — one-off to-dos with priority/due-date/duration.
--   3. calendar_events — fixed scheduled blocks (school, tennis,
--      football, appointments, holidays). These are commits that
--      genuinely consume time on a clock; habits/tasks NEVER become
--      calendar events automatically. Explicit user action
--      ("Schedule this habit" / "Add to calendar" from a task) is the
--      only path that bridges systems, and it CREATES a real row in
--      this table — it does NOT mutate the source habit/task.
--
-- Architectural rule: each system has its own table, its own RLS, and
-- no FKs into the others. Removing calendar_events must not break
-- habits or tasks; deleting all calendar_events keeps habit/to-do data
-- untouched.
--
-- Two OPTIONAL, currently-unwired columns on `habits` (kept for
-- future use — do not delete without checking the data):
--   * duration_minutes — estimated minutes per habit. Optional; no
--     code reads it today.
--   * priority — 0-3 (0 = none, 1 = low, 2 = medium, 3 = high).
--     Optional; no code reads it today.

-- ─── habits: add duration + priority (optional, unused by code) ───────

ALTER TABLE habits
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS priority SMALLINT
    DEFAULT 0
    CHECK (priority BETWEEN 0 AND 3);

COMMENT ON COLUMN habits.duration_minutes IS
  'Optional estimated minutes per habit. Not currently consumed by any application code.';
COMMENT ON COLUMN habits.priority IS
  'Optional 0-3 priority bucket (0=none, 1=low, 2=medium, 3=high). Not currently consumed by any application code.';

-- ─── calendar_events: fixed scheduled blocks only ──────────────────

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
