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
----   `completed` is reserved in the CHECK for future non-review flows and
--   is treated by the UI as equivalent to `ready_for_review`.
----   Realtime: the freebuff tables are added to the `supabase_realtime`
--   publication (section 6) so the page's `postgres_changes` subscriptions
--   fire. If you applied an earlier copy of this file before section 6
--   existed, run section 6 by itself (or re-run this whole file — it is
--   idempotent) to enable live terminal / status updates.
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

-- Output chunks are one of two kinds:
--   'output' — finalized scrollback lines (append-only activity log).
--   'screen' — the current live screen snapshot (the UI replaces the
--              previous snapshot instead of appending it).
-- Existing rows default to 'output' so old data stays readable.
ALTER TABLE freebuff_terminal_output
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'output';

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


-- ─── 5. freebuff_bridge_status ──────────────────────────────────
-- A single-row heartbeat written by the local Bridge. ORION reads it to
-- show whether a remote task can start right now. `available = false`
-- means another (manual) Freebuff session is running on the PC and the
-- Bridge will not start/kill anything until it is closed. Only the Bridge
-- (service-role key) may write this row; authenticated users may read it.
CREATE TABLE IF NOT EXISTS freebuff_bridge_status (
  id         TEXT PRIMARY KEY DEFAULT 'primary',
  available  BOOLEAN NOT NULL DEFAULT true,
  reason     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE freebuff_bridge_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read bridge status" ON freebuff_bridge_status;
CREATE POLICY "Authenticated users can read bridge status" ON freebuff_bridge_status
  FOR SELECT TO authenticated
  USING (true);


-- ─── 6. Realtime ─────────────────────────────────────────────────
-- The ORION page subscribes to `postgres_changes` on these tables for
-- live status / prompt / terminal updates. Supabase only publishes WAL
-- changes for tables that are members of the `supabase_realtime`
-- publication, and new tables are NOT added to it automatically. Each
-- ADD is guarded so this file stays idempotent (a bare ADD would error
-- with "relation is already member" on re-run).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'freebuff_tasks') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE freebuff_tasks;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'freebuff_prompts') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE freebuff_prompts;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'freebuff_terminal_output') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE freebuff_terminal_output;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'freebuff_commands') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE freebuff_commands;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                     AND tablename = 'freebuff_bridge_status') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE freebuff_bridge_status;
    END IF;
  END IF;
END $$;


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
--
--   -- Realtime publication membership (expect the 4 freebuff_* tables):
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
--   ORDER BY tablename;
--
--   -- RLS is enabled (expect `t` for all 4):
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname LIKE 'freebuff\_%' AND relkind = 'r'
--   ORDER BY relname;
