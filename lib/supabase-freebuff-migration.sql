-- =====================================================================
-- ORION: Freebuff Remote Controller — schema
-- =====================================================================
-- Apply this ONCE in the Supabase SQL Editor (Dashboard > SQL Editor).
-- Idempotent: every CREATE TABLE uses IF NOT EXISTS and every policy is
-- preceded by DROP POLICY IF EXISTS so the file is safe to re-run.
--
-- Architecture notes (read before changing):
--
--   • The BROWSER (ORION page) talks to these tables with the ANON key
--     + RLS (`auth.uid() = user_id`). It can only ever touch its own
--     rows. The service-role key is NEVER shipped to the browser.
--
--   • The local Windows Bridge connects OUTBOUND to Supabase with the
--     SERVICE-ROLE key (stored in its own local `.env`, not in this
--     repo's client bundle). Service-role bypasses RLS, so the Bridge
--     reads/writes the rows the browser created by matching user_id.
--
--   • freebuff_commands is the control channel. The browser inserts a
--     pending command (stop / approve / discard); the Bridge polls for
--     pending commands, executes the specific workflow, and marks the
--     command done. A phone request can therefore ONLY trigger these
--     three fixed actions — never an arbitrary PowerShell/git command.
--
-- Task status lifecycle (the only transitions the Bridge + page may
-- write; `idle` is a system state represented by "no live task", not a
-- stored row value):
--
--   queued → starting → running → ready_for_review → (approved | discarded)
--                          ├── stopped   (stop command)
--                          └── failed    (process crashed / non-zero exit)
--
-- `completed` is reserved in the CHECK for future non-review flows and
-- is treated by the UI as equivalent to `ready_for_review`.
-- =====================================================================


-- ─── 1. freebuff_tasks ────────────────────────────────────────────
-- One row per coding task. `branch_name`, `git_commit`, `files_changed`,
-- `session_id` are written by the Bridge as it progresses.
CREATE TABLE IF NOT EXISTS freebuff_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN (
                  'idle', 'queued', 'starting', 'running',
                  'ready_for_review', 'completed', 'failed', 'stopped',
                  'approved', 'discarded'
                )),
  initial_prompt TEXT NOT NULL,
  branch_name   TEXT,
  preview_url   TEXT,
  session_id    UUID,
  git_commit    TEXT,
  files_changed JSONB,          -- text[] of paths, written at completion
  error         TEXT,           -- failure reason / stderr tail
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  stopped_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS freebuff_tasks_user_created_idx
  ON freebuff_tasks (user_id, created_at DESC);

-- The Bridge uses this to find the single live task (queued/running).
CREATE INDEX IF NOT EXISTS freebuff_tasks_user_status_idx
  ON freebuff_tasks (user_id, status);

ALTER TABLE freebuff_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns freebuff tasks" ON freebuff_tasks;
CREATE POLICY "User owns freebuff tasks" ON freebuff_tasks
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 2. freebuff_prompts ──────────────────────────────────────────
-- The initial prompt plus every follow-up, in chronological order.
-- Follow-ups are inserted as `status = 'queued'`; the Bridge marks them
-- `sent` when delivered to the live session and `completed` when done.
CREATE TABLE IF NOT EXISTS freebuff_prompts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES freebuff_tasks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt       TEXT NOT NULL,
  prompt_type  TEXT NOT NULL DEFAULT 'follow_up'
               CHECK (prompt_type IN ('initial', 'follow_up')),
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'sent', 'completed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at      TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS freebuff_prompts_task_created_idx
  ON freebuff_prompts (task_id, created_at ASC);

CREATE INDEX IF NOT EXISTS freebuff_prompts_task_status_idx
  ON freebuff_prompts (task_id, status);

ALTER TABLE freebuff_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns freebuff prompts" ON freebuff_prompts;
CREATE POLICY "User owns freebuff prompts" ON freebuff_prompts
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 3. freebuff_terminal_output ──────────────────────────────────
-- Terminal output stored as CHUNKS (one row per burst), never as one
-- giant rewritten field. The Bridge flushes throttled chunks and prunes
-- old chunks beyond a retention window so a very long session can't make
-- the page unusable. The page subscribes via Realtime and auto-scrolls.
CREATE TABLE IF NOT EXISTS freebuff_terminal_output (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES freebuff_tasks(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  output     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS freebuff_terminal_output_task_created_idx
  ON freebuff_terminal_output (task_id, created_at ASC);

ALTER TABLE freebuff_terminal_output ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns freebuff terminal output" ON freebuff_terminal_output;
CREATE POLICY "User owns freebuff terminal output" ON freebuff_terminal_output
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── 4. freebuff_commands ─────────────────────────────────────────
-- Fixed control channel (stop / approve / discard). The browser inserts
-- a `pending` row; the Bridge claims it, runs the exact workflow, then
-- marks it `done` (or `failed` with an error payload). This is the ONLY
-- surface a remote client can use to make the PC do anything.
CREATE TABLE IF NOT EXISTS freebuff_commands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES freebuff_tasks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  command      TEXT NOT NULL
               CHECK (command IN ('stop', 'approve', 'discard')),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'acknowledged', 'done', 'failed')),
  payload      JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS freebuff_commands_task_status_idx
  ON freebuff_commands (task_id, status);

-- Bridge polls for any pending command across the user's own rows.
CREATE INDEX IF NOT EXISTS freebuff_commands_status_created_idx
  ON freebuff_commands (status, created_at ASC);

ALTER TABLE freebuff_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns freebuff commands" ON freebuff_commands;
CREATE POLICY "User owns freebuff commands" ON freebuff_commands
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ─── Tell PostgREST to reload its schema cache ────────────────────
NOTIFY pgrst, 'reload schema';

-- ─── Smoke test ───────────────────────────────────────────────────
-- Run AFTER this migration commits (paste as a separate New query):
--
--   SELECT 'freebuff_tasks'          AS t, count(*) FROM freebuff_tasks
--   UNION ALL SELECT 'freebuff_prompts',        count(*) FROM freebuff_prompts
--   UNION ALL SELECT 'freebuff_terminal_output',count(*) FROM freebuff_terminal_output
--   UNION ALL SELECT 'freebuff_commands',       count(*) FROM freebuff_commands;
--   -- expect 4 rows of 0
