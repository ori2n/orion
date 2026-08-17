# Freebuff Bridge

Local Windows bridge that connects ORION/Supabase to the `freebuff` CLI
installed on this PC. It lets you start, watch, prompt, and stop a Freebuff
coding task from your phone — without exposing PowerShell or Freebuff to the
public internet.

## How it works

- The bridge polls Supabase **outbound** (no open port, no router changes).
- When a task is `queued`, it checks out `main`, creates a dedicated
  `freebuff/task-<slug>-<id8>` branch, and launches `freebuff` inside a real
  Windows PTY (`node-pty`) so it can drive the same interactive TUI you use
  manually.
- It streams terminal output back to Supabase in throttled chunks, forwards
  queued follow-up prompts into the same session, and handles the fixed
  `stop` / `approve` / `discard` commands.

## Security

- The bridge uses the **Supabase service-role key**, which stays **only on
  this PC** (it is never shipped to the ORION browser bundle).
- A remote request can only create a task, queue a prompt, or send one of
  three fixed commands. It can never run an arbitrary PowerShell or git
  command — every git action is a hard-coded `execFile` call with no shell.

## Requirements

- Windows 10/11
- Node.js 18+ (Node 20+ recommended)
- Git on PATH
- The `freebuff` command on PATH (or set `FREEBUFF_COMMAND` to its full path)

> **Note on `node-pty`:** it ships a native addon and must be rebuilt for
> your Node version. If `npm install` fails or the bridge crashes with an
> `NODE_MODULE_VERSION` error, run:
>
> ```powershell
> npm install
> npm rebuild node-pty
> ```

## Setup

1. Copy the env template and fill it in:

   ```powershell
   cd bridge
   copy .env.example .env
   notepad .env
   ```

2. `SUPABASE_URL` — same project URL ORION uses.

3. `SUPABASE_SERVICE_ROLE_KEY` — from the Supabase Dashboard
   **Settings → API → service_role**. Never commit this key or put it in the
   ORION client code.

4. Verify `WORKING_DIR` points at the repo root (defaults to
   `C:\Users\edoar\second-brain`) and `FREEBUFF_COMMAND` is correct.

5. Apply the database migration **once** before first run:
   `lib/supabase-freebuff-migration.sql` (Supabase Dashboard → SQL Editor →
   New query → paste → Run). It is idempotent, so re-running is safe.

## Run

```powershell
cd bridge
npm install
npm start
```

You should see:

```text
Freebuff Bridge
Connected to ORION
Freebuff: Idle
Waiting for task...
```

Leave this window running. Then create a task from the ORION `/freebuff`
page on your phone.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `SUPABASE_URL` | *(required)* | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | *(required)* | Service-role key (local only) |
| `WORKING_DIR` | `C:\Users\edoar\second-brain` | Repo directory `freebuff` runs in |
| `FREEBUFF_COMMAND` | `freebuff` | Command used to launch Freebuff |
| `MAIN_BRANCH` | `main` | Branch tasks branch off / merge into |
| `POLL_INTERVAL_MS` | `2000` | Supabase poll cadence |
| `INIT_WAIT_MS` | `4000` | Wait after launching `freebuff` before pressing Enter |
| `PROMPT_SETTLE_MS` | `3000` | Wait after Enter before sending the initial prompt |
| `FOLLOWUP_SETTLE_MS` | `2500` | Quiet period required before a follow-up is sent |
| `STOP_TIMEOUT_MS` | `10000` | Grace period after Ctrl+C before force-kill |
| `TERMINAL_FLUSH_MS` | `600` | Max flush interval for terminal output |
| `TERMINAL_MAX_CHUNKS` | `2000` | Chunks retained per task (older pruned) |
| `PUSH_BRANCH` | `true` | Push task branch so Vercel builds a preview |
| `PUSH_MAIN_ON_APPROVE` | `true` | Push `main` after Approve (production deploy) |
| `DONE_MARKER` | *(empty)* | Optional regex that marks a task review-ready mid-session |

## Stop / Approve / Discard

- **Stop** sends `Ctrl+C`; if the process is still alive after
  `STOP_TIMEOUT_MS` it is force-killed. The branch and changes are kept.
- **Approve** merges the task branch into `main` (`--no-ff`) and pushes
  (which triggers the Vercel production deploy).
- **Discard** deletes the task branch. `main` is never touched.

## Notes

- If ORION (the web page) closes, Freebuff keeps running on the PC — the
  bridge owns the process, not the browser.
- If the bridge restarts while a task is `starting`/`running`, that task is
  marked `failed` on startup (the PTY handle is gone); queued tasks are
  picked up normally.
- Preview URLs: the bridge does not call Vercel's API. Pushing the branch
  (default) lets Vercel's Git integration build the preview automatically.
