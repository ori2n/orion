'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import {
  LIVE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  TASK_STATUS_META,
  formatElapsed,
  taskElapsedSeconds,
  taskStatusLabel,
  type FreebuffCommandName,
  type FreebuffPrompt,
  type FreebuffTask,
} from '@/lib/freebuff';
import TerminalOutput from '@/components/freebuff/terminal-output';
import TaskHistory from '@/components/freebuff/task-history';

/**
 * Freebuff Remote Controller.
 *
 * Mobile-first single page: Current Task + controls first, then the
 * follow-up prompt, live terminal, and task history. The Bridge owns the
 * actual process; this page only writes tasks / prompts / commands to
 * Supabase and renders what comes back over Realtime.
 */

const VERCEL_DASHBOARD =
  process.env.NEXT_PUBLIC_VERCEL_PROJECT_URL ?? 'https://vercel.com/dashboard';

export default function FreebuffPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<FreebuffTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current task's prompts (initial + follow-ups in chronological order).
  const [prompts, setPrompts] = useState<FreebuffPrompt[]>([]);

  // New-task form.
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [creating, setCreating] = useState(false);

  // Follow-up form.
  const [followUp, setFollowUp] = useState('');
  const [queuing, setQueuing] = useState(false);

  // Command-in-flight indicator (stop / approve / discard).
  const [commandPending, setCommandPending] = useState<FreebuffCommandName | null>(null);

  const taskChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Wall clock for elapsed-time display (ticks once a second).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadTasks = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('freebuff_tasks')
      .select('*')
      .order('created_at', { ascending: false });
    if (loadError) {
      setError(`Failed to load tasks: ${loadError.message}`);
      return;
    }
    setTasks((data ?? []) as FreebuffTask[]);
  }, []);

  // ─── Initial auth + task load + tasks Realtime subscription ──────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = await getCurrentUserId();
      if (cancelled) return;
      setUserId(uid);
      if (!uid) {
        setLoading(false);
        return;
      }
      await loadTasks();
      if (cancelled) return;
      setLoading(false);

      const channel = supabase
        .channel('freebuff-tasks')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'freebuff_tasks',
            filter: `user_id=eq.${uid}`,
          },
          () => {
            void loadTasks();
          },
        )
        .subscribe();
      taskChannelRef.current = channel;
    })();
    return () => {
      cancelled = true;
      if (taskChannelRef.current) {
        void supabase.removeChannel(taskChannelRef.current);
        taskChannelRef.current = null;
      }
    };
  }, [loadTasks]);

  // ─── Derived task state ──────────────────────────────────────────
  const liveTask =
    tasks.find((t) => LIVE_TASK_STATUSES.has(t.status)) ?? null;

  const pendingDecisionTask =
    liveTask ??
    tasks.find(
      (t) =>
        !TERMINAL_TASK_STATUSES.has(t.status) &&
        (t.status === 'stopped' || t.status === 'failed' || t.status === 'completed'),
    ) ??
    null;

  const currentTask = liveTask ?? pendingDecisionTask;
  const isBusy = liveTask !== null;
  const isRunning = currentTask?.status === 'running';
  const isStarting = currentTask?.status === 'starting';

  // ─── Prompts for the current task ────────────────────────────────
  useEffect(() => {
    if (!currentTask || !userId) {
      setPrompts([]);
      return;
    }
    let cancelled = false;
    const taskId = currentTask.id;

    (async () => {
      const { data, error: promptError } = await supabase
        .from('freebuff_prompts')
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      if (promptError) {
        console.error('[freebuff] prompt load failed:', promptError.message);
        return;
      }
      setPrompts((data ?? []) as FreebuffPrompt[]);
    })();

    const channel = supabase
      .channel(`freebuff-prompts-${taskId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'freebuff_prompts',
          filter: `task_id=eq.${taskId}`,
        },
        () => {
          void (async () => {
            const { data } = await supabase
              .from('freebuff_prompts')
              .select('*')
              .eq('task_id', taskId)
              .order('created_at', { ascending: true });
            if (!cancelled) setPrompts((data ?? []) as FreebuffPrompt[]);
          })();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [currentTask?.id, userId]);

  const followUpCount = prompts.filter((p) => p.prompt_type === 'follow_up').length;

  // ─── Actions ─────────────────────────────────────────────────────
  async function createTask() {
    const title = newTitle.trim();
    const prompt = newPrompt.trim();
    if (!title || !prompt || !userId) return;

    // Enforce "one active task at a time" from the client side too
    // (the Bridge also refuses to start while it has a live session).
    if (isBusy) {
      setError('Freebuff is busy. Wait for the current task to finish (or stop it) before starting a new one.');
      return;
    }

    setCreating(true);
    setError(null);
    const { data, error: insertError } = await supabase
      .from('freebuff_tasks')
      .insert({ title, initial_prompt: prompt, status: 'queued', user_id: userId })
      .select()
      .single();

    if (insertError) {
      setError(`Failed to create task: ${insertError.message}`);
      setCreating(false);
      return;
    }

    const task = data as FreebuffTask;
    // Record the initial prompt in the prompts table so history has a
    // single unified prompt stream.
    const { error: promptError } = await supabase.from('freebuff_prompts').insert({
      task_id: task.id,
      user_id: userId,
      prompt,
      prompt_type: 'initial',
      status: 'queued',
    });
    if (promptError) {
      console.error('[freebuff] initial prompt insert failed:', promptError.message);
    }

    setNewTitle('');
    setNewPrompt('');
    setShowNewTask(false);
    setCreating(false);
    await loadTasks();
  }

  async function queueFollowUp() {
    const text = followUp.trim();
    if (!text || !currentTask || !userId) return;
    setQueuing(true);
    setError(null);
    const { error: insertError } = await supabase.from('freebuff_prompts').insert({
      task_id: currentTask.id,
      user_id: userId,
      prompt: text,
      prompt_type: 'follow_up',
      status: 'queued',
    });
    if (insertError) {
      setError(`Failed to queue prompt: ${insertError.message}`);
    } else {
      setFollowUp('');
    }
    setQueuing(false);
  }

  async function sendCommand(command: FreebuffCommandName) {
    if (!currentTask || !userId) return;
    setError(null);
    setCommandPending(command);
    const { error: insertError } = await supabase.from('freebuff_commands').insert({
      task_id: currentTask.id,
      user_id: userId,
      command,
      status: 'pending',
      payload: {},
    });
    if (insertError) {
      setError(`Failed to send "${command}": ${insertError.message}`);
      setCommandPending(null);
      return;
    }
    // The Bridge picks this up and flips the task status; Realtime
    // updates the UI. Clear the pending flag shortly after.
    window.setTimeout(() => setCommandPending((p) => (p === command ? null : p)), 1500);
  }

  function confirmCommand(command: FreebuffCommandName) {
    if (command === 'stop') {
      if (window.confirm('Stop this task? The Git branch and changes will be kept.')) {
        void sendCommand(command);
      }
      return;
    }
    if (command === 'approve') {
      if (
        window.confirm(
          'Approve and merge this task branch into main? This triggers the production deployment.',
        )
      ) {
        void sendCommand(command);
      }
      return;
    }
    if (window.confirm('Discard this task? The task branch will be deleted after confirmation.')) {
      void sendCommand(command);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
        {/* ── Header + New Task ─────────────────────────────────── */}
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Freebuff
            </div>
            <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Remote Controller
            </h1>
            <p className="mt-1 text-xs text-zinc-400">
              {isBusy
                ? 'One task is running on your PC.'
                : 'Freebuff is idle — ready for a new task.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (isBusy) {
                setError('Freebuff is busy. Finish or stop the current task first.');
                return;
              }
              setShowNewTask((v) => !v);
            }}
            disabled={isBusy}
            className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            + New Freebuff Task
          </button>
        </header>

        {/* ── Error banner ──────────────────────────────────────── */}
        {error && (
          <div className="mb-3 flex items-start justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="font-medium underline underline-offset-2 hover:no-underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* ── New task form ─────────────────────────────────────── */}
        {showNewTask && (
          <section className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Task title
              </span>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Fix fitness page routing"
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
            </label>
            <label className="mt-3 block">
              <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                Prompt
              </span>
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                rows={3}
                placeholder="What should Freebuff do?"
                className="mt-1 w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
            </label>
            <p className="mt-1 text-[10px] text-zinc-400">
              Uses the default model already configured in Freebuff — no model selector.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewTask(false)}
                className="rounded-lg px-3 py-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createTask()}
                disabled={creating || !newTitle.trim() || !newPrompt.trim()}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {creating ? 'Creating…' : 'Start Task'}
              </button>
            </div>
          </section>
        )}

        {/* ── Current task ──────────────────────────────────────── */}
        {currentTask ? (
          <CurrentTaskPanel
            task={currentTask}
            now={now}
            followUpCount={followUpCount}
            commandPending={commandPending}
            onStop={() => confirmCommand('stop')}
            onApprove={() => confirmCommand('approve')}
            onDiscard={() => confirmCommand('discard')}
          />
        ) : (
          <section className="mb-4 rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-4 py-8 text-center dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="text-3xl">💤</div>
            <h2 className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Idle
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              Create a task to wake Freebuff on your PC.
            </p>
          </section>
        )}

        {/* ── Follow-up prompt (while running) ──────────────────── */}
        {currentTask && (isRunning || isStarting) && (
          <section className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Follow-up prompt
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void queueFollowUp();
                }}
                placeholder="Enter additional instruction…"
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
              />
              <button
                type="button"
                onClick={() => void queueFollowUp()}
                disabled={queuing || !followUp.trim()}
                className="shrink-0 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                {queuing ? '…' : 'Queue Prompt'}
              </button>
            </div>
            <QueuedPrompts prompts={prompts} />
          </section>
        )}

        {/* ── Terminal output ───────────────────────────────────── */}
        {currentTask && (
          <section className="mb-4 flex h-72 flex-col">
            <TerminalOutput taskId={currentTask.id} userId={userId} />
          </section>
        )}

        {/* ── Task history ──────────────────────────────────────── */}
        <section>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Task history
          </div>
          <TaskHistory tasks={tasks} />
        </section>
      </div>
    </div>
  );
}

// ─── Current task panel ───────────────────────────────────────────

function CurrentTaskPanel({
  task,
  now,
  followUpCount,
  commandPending,
  onStop,
  onApprove,
  onDiscard,
}: {
  task: FreebuffTask;
  now: number;
  followUpCount: number;
  commandPending: FreebuffCommandName | null;
  onStop: () => void;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const meta = TASK_STATUS_META[task.status];
  const elapsed = taskElapsedSeconds(task, now);
  const running = task.status === 'running' || task.status === 'starting' || task.status === 'queued';
  const reviewable =
    task.status === 'ready_for_review' ||
    task.status === 'completed' ||
    task.status === 'stopped';

  return (
    <section className="mb-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {task.title}
        </h2>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          {taskStatusLabel(task.status)}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="text-zinc-400">Time elapsed</dt>
          <dd className="mt-0.5 font-medium tabular-nums text-zinc-700 dark:text-zinc-200" suppressHydrationWarning>
            {elapsed === null ? '—' : formatElapsed(elapsed)}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Session</dt>
          <dd className="mt-0.5 font-mono text-zinc-700 dark:text-zinc-200">
            {task.session_id ? task.session_id.slice(0, 8) : '—'}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-400">Follow-up prompts</dt>
          <dd className="mt-0.5 font-medium text-zinc-700 dark:text-zinc-200">{followUpCount}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Files changed</dt>
          <dd className="mt-0.5 font-medium text-zinc-700 dark:text-zinc-200">
            {task.files_changed ? task.files_changed.length : '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-3">
        <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
          Current prompt
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {task.initial_prompt}
        </p>
      </div>

      {task.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {task.error}
        </div>
      )}

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {running && (
          <button
            type="button"
            onClick={onStop}
            disabled={commandPending === 'stop'}
            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
          >
            {commandPending === 'stop' ? 'Stopping…' : 'Stop Task'}
          </button>
        )}

        {(reviewable || task.status === 'failed') && (
          <>
            <a
              href={task.preview_url ?? VERCEL_DASHBOARD}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Open Preview
            </a>
            {task.status !== 'failed' && (
              <button
                type="button"
                onClick={onApprove}
                disabled={commandPending === 'approve'}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
              >
                {commandPending === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            )}
            <button
              type="button"
              onClick={onDiscard}
              disabled={commandPending === 'discard'}
              className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30 disabled:opacity-50"
            >
              {commandPending === 'discard' ? 'Discarding…' : 'Discard'}
            </button>
          </>
        )}

        {task.branch_name && (
          <span className="text-[10px] text-zinc-400">
            <span className="font-semibold text-zinc-500">Branch </span>
            <span className="font-mono">{task.branch_name}</span>
          </span>
        )}
      </div>

      {reviewable && !task.preview_url && (
        <p className="mt-2 text-[10px] text-zinc-400">
          Preview auto-deploys via Vercel&apos;s Git integration — open the Vercel dashboard
          and find the <span className="font-mono">{task.branch_name ?? 'task'}</span> branch.
        </p>
      )}
    </section>
  );
}

// ─── Queued follow-up prompts ─────────────────────────────────────

function QueuedPrompts({ prompts }: { prompts: FreebuffPrompt[] }) {
  const followUps = prompts.filter((p) => p.prompt_type === 'follow_up');
  if (followUps.length === 0) return null;
  return (
    <ol className="mt-3 space-y-1">
      {followUps.map((p, i) => (
        <li
          key={p.id}
          className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300"
        >
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              p.status === 'queued' ? 'bg-amber-400' : 'bg-emerald-400'
            }`}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate">
            #{i + 1} {p.prompt}
          </span>
          <span className="shrink-0 text-[10px] text-zinc-400">
            {p.status === 'queued' ? 'queued' : p.status}
          </span>
        </li>
      ))}
    </ol>
  );
}
