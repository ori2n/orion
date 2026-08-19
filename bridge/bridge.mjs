import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pty from 'node-pty';
import { assertConfig, config } from './lib/config.mjs';
import { getSupabase } from './lib/supabase.mjs';
import { decoderFromConfig } from './lib/terminal-decoder.mjs';
import { detectFreebuffInstances } from './lib/process-detection.mjs';
import {
  gitChangedFiles,
  gitCheckoutMain,
  gitCreateBranch,
  gitDeleteBranch,
  gitMergeToMain,
  gitPushBranch,
  gitPushMain,
  gitRevParseHead,
  gitStatusPorcelain,
} from './lib/git.mjs';

/**
 * ORION Freebuff Bridge.
 *
 * Runs locally on the Windows PC. Polls Supabase (outbound only, no open
 * port) for a queued task, drives the interactive `freebuff` TUI through
 * a real Windows PTY, streams terminal output back in chunks, and handles
 * the fixed stop / approve / discard command set.
 *
 * Security boundary: this process executes ONLY the Freebuff workflow
 * described here. A remote request can create a task, queue a prompt, or
 * send one of three fixed commands — it can never run an arbitrary shell
 * or git command.
 */

// ─── Logging ──────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`);
}

function banner() {
  console.log('Freebuff Bridge');
  console.log('Connected to ORION');
  console.log(`Working dir : ${config.workingDir}`);
  console.log(`Command     : ${config.freebuffCommand}`);
  console.log(`Main branch : ${config.mainBranch}`);
  console.log('Freebuff: Idle');
  console.log('Waiting for task...');
}

// ─── Supabase diagnostics ─────────────────────────────────────────
// These report the key's role + project ref (derived from the JWT, never
// the secret itself) and run a cheap connectivity check so a wrong key or
// wrong URL is obvious in the logs instead of a silent "Waiting…".

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function logSupabaseIdentity() {
  const payload = decodeJwtPayload(config.serviceRoleKey);
  const urlRef = (config.supabaseUrl.match(/https:\/\/([^.]+)\./) ?? [])[1] ?? 'unknown';

  if (!payload) {
    log('warn', 'Could not decode SUPABASE_SERVICE_ROLE_KEY (is it a full JWT?). Behaviour may be wrong.');
  } else {
    const role = payload.role ?? 'unknown';
    const ref = payload.ref ?? 'unknown';
    log('info', `Supabase key: role=${role} project_ref=${ref}`);
    if (role !== 'service_role') {
      log('warn', `SUPABASE_SERVICE_ROLE_KEY has role "${role}", not "service_role" — RLS will hide rows. Use Dashboard → Settings → API → service_role.`);
    }
    if (ref !== 'unknown' && urlRef !== 'unknown' && ref !== urlRef) {
      log('warn', `Key project_ref=${ref} does not match URL project_ref=${urlRef} — key and URL are for different projects.`);
    }
  }
  log('info', `Supabase URL: project_ref=${urlRef}`);
}

async function verifyConnection() {
  const sb = getSupabase();
  const { count, error } = await sb
    .from('freebuff_tasks')
    .select('id', { count: 'exact', head: true });
  if (error) {
    log('error', `Supabase connection FAILED: ${error.message} (code: ${error.code ?? 'n/a'})`);
    return;
  }
  log('info', `Supabase connection OK — freebuff_tasks total rows = ${count ?? 0}`);

  const { count: queuedCount, error: qErr } = await sb
    .from('freebuff_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued');
  if (qErr) {
    log('error', `queued-count check failed: ${qErr.message}`);
  } else {
    log('info', `Currently queued tasks = ${queuedCount ?? 0}`);
  }
}

// ─── Small helpers ────────────────────────────────────────────────

const execFileP = promisify(execFile);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// node-pty's proc.kill() only terminates the shell (powershell). The real
// `freebuff` runs as a CHILD of that shell, so on Windows we must kill the
// whole tree with taskkill /T /F, otherwise the orphan keeps running.
async function killProcessTree(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    try {
      await execFileP('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      return true;
    } catch (e) {
      log('warn', `taskkill failed: ${e?.stderr ?? e?.message ?? e}`);
      return false;
    }
  }
  try {
    process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {
      return false;
    }
  }
}

async function isProcessRunning(pid) {
  if (!pid) return false;
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileP('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { windowsHide: true });
      return (stdout ?? '').includes(String(pid));
    } catch {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function slug(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

// ─── Session state ────────────────────────────────────────────────

const state = {
  active: null,
  flushTimer: null,
};

// Poll telemetry — used only for diagnostics (never the secret key).
const pollStats = {
  lastQueued: -1,
  lastLogAt: 0,
};

function setStatusLine(label) {
  process.stdout.write(`\rFreebuff: ${label}                    \n`);
}

// ─── Terminal output streaming ────────────────────────────────────

function startFlushTimer() {
  stopFlushTimer();
  state.flushTimer = setInterval(() => {
    void flushOutput(false);
  }, config.terminalFlushMs);
}

function stopFlushTimer() {
  if (state.flushTimer) {
    clearInterval(state.flushTimer);
    state.flushTimer = null;
  }
}

async function flushOutput(final) {
  const a = state.active;
  if (!a || !a.decoder) return;

  // Ensure every write already fed to the decoder has been parsed before
  // the final snapshot, so the tail of the stream is not lost on exit.
  if (final) await a.decoder.ready();

  const { scrollback, live } = a.decoder.snapshot();
  const rows = [];

  // Finalized scrollback lines are appendable activity log.
  if (scrollback.length) {
    rows.push({
      task_id: a.taskId,
      user_id: a.userId,
      kind: 'output',
      output: scrollback.join('\n'),
    });
    // The optional done marker is matched against the decoded (clean)
    // text — not the raw ANSI stream — so it matches what is displayed.
    if (config.doneMarker && !a.doneMarked) {
      for (const line of scrollback) {
        if (config.doneMarker.test(line)) {
          a.doneMarked = true;
          log('info', 'Done marker matched — no further follow-ups will be auto-sent.');
          break;
        }
      }
    }
  }

  // The current visible screen is a live snapshot (the browser replaces the
  // previous one rather than appending it).
  if (live.length) {
    rows.push({
      task_id: a.taskId,
      user_id: a.userId,
      kind: 'screen',
      output: live.join('\n'),
    });
  }

  if (!rows.length) return;

  const sb = getSupabase();
  const { error } = await sb.from('freebuff_terminal_output').insert(rows);
  if (error) {
    log('error', `terminal output insert failed: ${error.message}`);
  } else if (!final) {
    await pruneOutput(a.taskId);
  }
}

async function pruneOutput(taskId) {
  const sb = getSupabase();
  const { count, error } = await sb
    .from('freebuff_terminal_output')
    .select('id', { count: 'exact', head: true })
    .eq('task_id', taskId);
  if (error || (count ?? 0) <= config.terminalMaxChunks) return;
  const excess = count - config.terminalMaxChunks;
  const { data } = await sb
    .from('freebuff_terminal_output')
    .select('id')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
    .limit(excess);
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length) {
    await sb.from('freebuff_terminal_output').delete().in('id', ids);
  }
}

// ─── Session lifecycle ────────────────────────────────────────────

function spawnSession(task) {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : process.env.SHELL || 'bash';
  const shellArgs = isWindows ? ['-NoLogo'] : [];

  const proc = pty.spawn(shell, shellArgs, {
    name: 'xterm-color',
    cols: config.terminalCols,
    rows: config.terminalRows,
    cwd: config.workingDir,
    env: process.env,
  });

  const a = state.active;
  if (a) a.pid = proc.pid;
  proc.onData((data) => {
    if (!a || a.proc !== proc) return;
    // Feed the raw bytes to the terminal decoder; it resolves ANSI/TUI
    // output into clean text that flushOutput() reads back.
    a.decoder.write(data);
    a.lastOutputAt = Date.now();
  });

  proc.onExit(({ exitCode }) => {
    void handleExit(exitCode);
  });

  // Drive the TUI: launch freebuff, wait for initialisation, press Enter
  // to start the default-model session, then send the initial prompt.
  void (async () => {
    await sleep(600);
    proc.write(`${config.freebuffCommand}\r`);
    await sleep(config.initWaitMs);
    proc.write('\r'); // Enter → start default-model session
    await sleep(config.promptSettleMs);
    proc.write(`${task.initial_prompt}\r`);
    const sb = getSupabase();
    await sb
      .from('freebuff_prompts')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('task_id', task.id)
      .eq('prompt_type', 'initial');
    log('info', 'Initial prompt sent.');
  })();

  return proc;
}

async function handleExit(exitCode) {
  const a = state.active;
  if (!a) return;
  a.exited = true;
  await flushOutput(true);

  const sb = getSupabase();
  const now = new Date().toISOString();
  const commitRes = await gitRevParseHead();
  const filesRes = await gitChangedFiles();
  const gitCommit = commitRes.ok ? commitRes.stdout : null;
  const filesChanged = filesRes.ok
    ? filesRes.stdout.split('\n').filter(Boolean)
    : null;

  let status;
  let error = null;
  if (a.stoppedByUser) {
    status = 'stopped';
  } else if (exitCode === 0) {
    status = 'ready_for_review';
  } else {
    status = 'failed';
    error = `Freebuff exited with code ${exitCode}.`;
  }

  const update = {
    status,
    completed_at: now,
    git_commit: gitCommit,
    files_changed: filesChanged,
  };
  if (status === 'stopped') update.stopped_at = now;
  if (error) update.error = error;

  const { error: updateError } = await sb
    .from('freebuff_tasks')
    .update(update)
    .eq('id', a.taskId);
  if (updateError) {
    log('error', `final status update failed: ${updateError.message}`);
  }

  log('info', `Task finished → ${status}${gitCommit ? ` (${gitCommit.slice(0, 8)})` : ''}`);
  cleanup();
}

function cleanup() {
  stopFlushTimer();
  const a = state.active;
  state.active = null;
  if (a?.decoder) {
    try {
      a.decoder.dispose();
    } catch {
      // ignore
    }
  }
  setStatusLine('Idle');
}

async function waitForExit(a, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (a.exited) return true;
    await sleep(250);
  }
  return a.exited;
}

// ─── Task start ───────────────────────────────────────────────────

async function maybeStartNextTask() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('freebuff_tasks')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) {
    log('error', `task query failed: ${error.message} (code: ${error.code ?? 'n/a'})`);
    return;
  }

  // Report the poll result on change, when something is found, or on a
  // 30s heartbeat so a silent "0 queued" is never mistaken for a dead loop.
  const queued = data?.length ?? 0;
  const nowMs = Date.now();
  if (queued !== pollStats.lastQueued || queued > 0 || nowMs - pollStats.lastLogAt >= 30000) {
    log('info', `task query executed → ${queued} queued task(s) found`);
    pollStats.lastQueued = queued;
    pollStats.lastLogAt = nowMs;
  }

  const task = data?.[0];
  if (!task) return;
  log('info', `Task detected: "${task.title}" (${task.id.slice(0, 8)})`);

  // ── Safety gate 1: never kill/replace an existing Freebuff session ──
  // A user may be running Freebuff manually in their own PowerShell. If
  // so, we must NOT start (or kill) anything — only report "busy".
  const existing = await detectFreebuffInstances();
  if (existing.length) {
    const names = existing.map((p) => `${p.name} (pid ${p.pid})`).join(', ');
    log('warn', `FREEBUFF BUSY — another Freebuff session is running (${names}); task ${task.id.slice(0, 8)} blocked.`);
    await publishAvailability(false, 'Another Freebuff session is already running on this PC. Finish or close it before starting a remote task.');
    await failTask(
      task.id,
      'Freebuff is already running on this PC (another session). Finish or close it before starting a remote task.',
    );
    return;
  }

  // ── Safety gate 2: protect uncommitted local work ──
  // The workflow checks out main and creates a branch; doing that over a
  // dirty tree could carry, merge, or push the user's own uncommitted
  // changes. Refuse instead — never touch local work implicitly.
  const status = await gitStatusPorcelain();
  if (!status.ok) {
    log('error', `git status failed: ${status.stderr}`);
    await failTask(task.id, `Could not check the working tree: ${status.stderr}`);
    return;
  }
  const dirtyPaths = parseDirtyPaths(status.stdout);
  const blocking = dirtyPaths.filter((p) => !config.ignoreDirtyPaths.includes(p));
  if (blocking.length) {
    const preview = blocking.slice(0, 5).join(', ') + (blocking.length > 5 ? '…' : '');
    log('warn', `Working tree has uncommitted changes (${preview}) — task blocked to protect local work.`);
    await failTask(
      task.id,
      `Local working tree has uncommitted changes (${preview}). Commit or stash them before starting a remote task.`,
    );
    return;
  }

  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const { error: claimError } = await sb
    .from('freebuff_tasks')
    .update({ status: 'starting', started_at: startedAt, session_id: sessionId })
    .eq('id', task.id);
  if (claimError) {
    log('error', `failed to claim task: ${claimError.message}`);
    return;
  }
  log('info', `Task claimed → status "starting" (session ${sessionId.slice(0, 8)})`);

  log('info', `Starting task "${task.title}" (${task.id.slice(0, 8)})`);

  // ── Git isolation: branch off main, never work on main ──────────
  const branchName = `freebuff/task-${slug(task.title)}-${task.id.slice(0, 8)}`;
  const co = await gitCheckoutMain();
  if (!co.ok) {
    log('error', `git checkout ${config.mainBranch} failed: ${co.stderr}`);
    await failTask(task.id, `Could not switch to ${config.mainBranch}: ${co.stderr}`);
    return;
  }
  const create = await gitCreateBranch(branchName);
  if (!create.ok) {
    log('error', `branch creation failed: ${create.stderr}`);
    await failTask(task.id, `Could not create branch: ${create.stderr}`);
    return;
  }
  log('info', `On branch ${branchName}`);

  await sb.from('freebuff_tasks').update({ branch_name: branchName }).eq('id', task.id);

  if (config.pushBranch) {
    const push = await gitPushBranch(branchName);
    if (!push.ok) {
      log('warn', `push branch failed (preview may not auto-deploy): ${push.stderr}`);
    } else {
      log('info', `Pushed ${branchName} to origin for Vercel preview.`);
    }
  }

  // Re-check the task is still claimable before spawning: a Stop command
  // may have arrived while git was running (the command loop is
  // independent), marking the task stopped in the meantime.
  const { data: freshRows } = await sb
    .from('freebuff_tasks')
    .select('status')
    .eq('id', task.id)
    .limit(1);
  if (freshRows?.[0]?.status !== 'starting') {
    log('warn', `Task ${task.id.slice(0, 8)} is now "${freshRows?.[0]?.status ?? 'unknown'}" — aborting launch.`);
    return;
  }

  state.active = {
    taskId: task.id,
    userId: task.user_id,
    sessionId,
    branchName,
    pid: null,
    decoder: decoderFromConfig(config),
    lastOutputAt: Date.now(),
    stoppedByUser: false,
    exited: false,
    doneMarked: false,
    proc: null,
  };

  state.active.proc = spawnSession(task);
  log('info', `Freebuff launch started (branch ${branchName})`);
  setStatusLine('Running');
  startFlushTimer();

  const { error: runningError } = await sb
    .from('freebuff_tasks')
    .update({ status: 'running' })
    .eq('id', task.id);
  if (runningError) {
    log('error', `failed to mark running: ${runningError.message}`);
  }
}

async function failTask(taskId, message) {
  const { error } = await getSupabase()
    .from('freebuff_tasks')
    .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) log('error', `failed to mark task failed: ${error.message}`);
}

// ─── Commands (stop / approve / discard) ─────────────────────────

const REVIEWABLE = new Set(['ready_for_review', 'completed', 'stopped', 'failed']);

async function processPendingCommands() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('freebuff_commands')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);
  if (error) {
    log('error', `command poll failed: ${error.message} (code: ${error.code ?? 'n/a'})`);
    return;
  }

  for (const cmd of data ?? []) {
    await sb.from('freebuff_commands').update({ status: 'acknowledged' }).eq('id', cmd.id);
    try {
      const { data: rows } = await sb
        .from('freebuff_tasks')
        .select('*')
        .eq('id', cmd.task_id)
        .limit(1);
      const task = rows?.[0];
      if (!task) throw new Error('Task not found.');

      if (cmd.command === 'stop') await handleStop(task);
      else if (cmd.command === 'approve') await handleApprove(task);
      else if (cmd.command === 'discard') await handleDiscard(task);

      await sb
        .from('freebuff_commands')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', cmd.id);
      log('info', `Command "${cmd.command}" completed for task ${task.id.slice(0, 8)}.`);
    } catch (e) {
      await sb
        .from('freebuff_commands')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          payload: { error: e?.message ?? String(e) },
        })
        .eq('id', cmd.id);
      log('error', `Command "${cmd.command}" failed: ${e?.message ?? e}`);
    }
  }
}

async function markTaskStopped(taskId) {
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from('freebuff_tasks')
    .update({ status: 'stopped', stopped_at: now, completed_at: now })
    .eq('id', taskId);
  if (error) {
    log('error', `failed to mark task stopped: ${error.message}`);
    return false;
  }
  return true;
}

async function handleStop(task) {
  log('info', `Stop command detected for task ${task.id.slice(0, 8)}`);

  const a = state.active;
  if (a && a.taskId === task.id && !a.exited) {
    log('info', `Stopping task ${task.id.slice(0, 8)}`);
    a.stoppedByUser = true;

    log('info', 'Sending Ctrl+C');
    try {
      a.proc.write('\x03');
    } catch (e) {
      log('warn', `Ctrl+C failed: ${e?.message ?? e}`);
    }

    log('info', 'Waiting for Freebuff to exit');
    let exited = await waitForExit(a, config.stopTimeoutMs);

    if (!exited && state.active === a && !a.exited) {
      log('warn', 'Force-killing Freebuff process tree');
      const killed = await killProcessTree(a.pid);
      if (killed) {
        log('info', 'Process terminated');
      } else {
        log('warn', 'taskkill failed — falling back to PTY kill');
        try {
          a.proc.kill();
        } catch {}
      }
      // Confirm the process is actually gone (Windows: check by PID).
      const stillRunning = a.pid ? await isProcessRunning(a.pid) : !a.exited;
      log(stillRunning ? 'warn' : 'info', stillRunning
        ? 'Process still reported running after kill attempt.'
        : 'Process confirmed gone');
      exited = await waitForExit(a, 2000);
    }

    if (exited) {
      log('info', 'Freebuff exited');
    } else if (state.active === a && !a.exited) {
      // onExit never fired — finalize manually so the task is never left
      // stuck in "running".
      log('warn', 'Freebuff still alive after force-kill — finalizing manually.');
      await handleExit(null);
      return;
    }

    // Make sure the row ends `stopped` even if the exit handler is still
    // reconciling in flight (idempotent).
    await markTaskStopped(task.id);
    log('info', 'Task marked stopped');
    return;
  }

  // No live session handle — the process is stale/orphaned (e.g. the
  // bridge was restarted mid-task). Reconcile the row so the UI clears and
  // a new task can start. Git branches and file changes are kept.
  log('warn', `No live session for task ${task.id.slice(0, 8)} — marking stopped (stale task).`);
  await markTaskStopped(task.id);
  log('info', 'Task marked stopped');
}

function assertReviewable(task) {
  if (!REVIEWABLE.has(task.status)) {
    throw new Error(`Task is "${task.status}" — not reviewable.`);
  }
  const a = state.active;
  if (a && a.taskId === task.id && !a.exited) {
    throw new Error('Freebuff is still running — stop the task first.');
  }
}

async function handleApprove(task) {
  assertReviewable(task);
  if (!task.branch_name) throw new Error('Task has no branch to merge.');

  const merge = await gitMergeToMain(task.branch_name);
  if (!merge.ok) throw new Error(`git merge failed: ${merge.stderr}`);
  log('info', `Merged ${task.branch_name} into ${config.mainBranch}.`);

  if (config.pushMainOnApprove) {
    const push = await gitPushMain();
    if (!push.ok) {
      log('warn', `push ${config.mainBranch} failed: ${push.stderr}`);
    } else {
      log('info', `Pushed ${config.mainBranch} — production deploys.`);
    }
  }

  await getSupabase()
    .from('freebuff_tasks')
    .update({ status: 'approved', completed_at: new Date().toISOString() })
    .eq('id', task.id);
}

async function handleDiscard(task) {
  assertReviewable(task);
  if (task.branch_name) {
    const del = await gitDeleteBranch(task.branch_name);
    if (!del.ok) {
      log('warn', `branch delete failed (kept): ${del.stderr}`);
    } else {
      log('info', `Deleted branch ${task.branch_name}.`);
    }
  }
  await getSupabase()
    .from('freebuff_tasks')
    .update({ status: 'discarded', completed_at: new Date().toISOString() })
    .eq('id', task.id);
}

// ─── Follow-up prompts ────────────────────────────────────────────

async function processFollowUps() {
  const a = state.active;
  if (!a || a.exited || a.doneMarked) return;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('freebuff_prompts')
    .select('*')
    .eq('task_id', a.taskId)
    .eq('status', 'queued')
    .eq('prompt_type', 'follow_up')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error || !data?.length) return;
  const prompt = data[0];

  // Only send once the session has been quiet (not mid-generation).
  if (Date.now() - a.lastOutputAt < config.followUpSettleMs) return;

  try {
    a.proc.write(`${prompt.prompt}\r`);
  } catch (e) {
    log('error', `follow-up write failed: ${e?.message ?? e}`);
    return;
  }
  await sb
    .from('freebuff_prompts')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', prompt.id);
  a.lastOutputAt = Date.now();
  log('info', `Sent follow-up: ${prompt.prompt.slice(0, 60)}`);
}

// ─── Availability + process detection helpers ─────────────────────

/** Parse `git status --porcelain` output into a list of changed paths. */
function parseDirtyPaths(porcelainOutput) {
  const paths = [];
  for (const raw of (porcelainOutput ?? '').split('\n')) {
    if (!raw) continue;
    let p = raw.slice(3).trim();
    // Porcelain C-quotes paths containing spaces/special characters.
    if (p.startsWith('"') && p.endsWith('"')) {
      p = p.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (p) paths.push(p);
  }
  return paths;
}

/** Write the bridge's availability to the single-row status table. */
async function publishAvailability(available, reason) {
  const sb = getSupabase();
  const { error } = await sb.from('freebuff_bridge_status').upsert(
    {
      id: 'primary',
      available,
      reason,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) log('warn', `availability publish failed: ${error.message}`);
}

/**
 * Whether a remote task may start right now. While this bridge owns a
 * running task it is considered available (ORION already renders that
 * task); only an idle bridge can be blocked by a manual Freebuff session.
 */
async function computeAvailability() {
  if (state.active) return { available: true, reason: null };
  try {
    const existing = await detectFreebuffInstances();
    if (existing.length) {
      return {
        available: false,
        reason:
          'Another Freebuff session is already running on this PC. Finish or close it before starting a remote task.',
      };
    }
  } catch {
    // Detection failure → fail open (treat as free).
  }
  return { available: true, reason: null };
}

/** Publish availability on a timer so ORION can show "unavailable". */
async function runAvailabilityLoop() {
  await publishAvailability(true, null);
  let lastKey = 'true|';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(config.availabilityIntervalMs);
    try {
      const avail = await computeAvailability();
      const key = `${avail.available}|${avail.reason ?? ''}`;
      if (key !== lastKey) {
        lastKey = key;
        await publishAvailability(avail.available, avail.reason);
        if (!avail.available) {
          log('warn', 'FREEBUFF BUSY — another Freebuff session is running; remote tasks are blocked until it is closed.');
        } else {
          log('info', 'Freebuff available.');
        }
      }
    } catch (e) {
      log('error', `availability check failed: ${e?.message ?? e}`);
    }
  }
}

// ─── Startup reconcile + main loop ────────────────────────────────

async function reconcileOnStartup() {
  // If this Bridge (re)starts while a task is marked starting/running, the
  // PTY session handle is gone and the local process may be orphaned.
  // Recover the row to `failed` so the UI un-sticks and a new task can
  // start. Git branches and file changes are left intact — nothing is
  // deleted. Queued tasks are left alone to be picked up.
  const { data, error } = await getSupabase()
    .from('freebuff_tasks')
    .update({
      status: 'failed',
      error: 'Bridge restarted; task interrupted.',
      completed_at: new Date().toISOString(),
    })
    .in('status', ['starting', 'running'])
    .select('id');
  if (error) {
    log('warn', `startup reconcile failed: ${error.message}`);
    return;
  }
  if (data?.length) {
    log('warn', `Reconciled ${data.length} stale task(s) (starting/running → failed); git branches kept.`);
  } else {
    log('info', 'No stale tasks to reconcile.');
  }
}

// Command channel runs on its OWN loop so a hung git/PTY step in the task
// loop can never block Stop / Approve / Discard.
async function runCommandLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processPendingCommands();
    } catch (e) {
      log('error', `command poll failed: ${e?.message ?? e}`);
    }
    await sleep(config.commandPollMs);
  }
}

// Task lifecycle loop: start the next queued task or drive follow-ups.
async function runTaskLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (state.active) {
        await processFollowUps();
      } else {
        await maybeStartNextTask();
      }
    } catch (e) {
      log('error', `tick failed: ${e?.message ?? e}`);
    }
    await sleep(config.pollIntervalMs);
  }
}

async function main() {
  try {
    assertConfig();
  } catch (e) {
    console.error(`Configuration error: ${e.message}`);
    process.exit(1);
  }

  banner();
  logSupabaseIdentity();
  await verifyConnection();
  await reconcileOnStartup();
  log('info', `Polling started — tasks every ${config.pollIntervalMs} ms, commands every ${config.commandPollMs} ms`);

  await Promise.all([runCommandLoop(), runTaskLoop(), runAvailabilityLoop()]);
}

process.on('SIGINT', () => {
  log('info', 'Bridge shutting down. Any running Freebuff process may be left running.');
  process.exit(0);
});

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
