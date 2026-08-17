/**
 * Shared types, constants, and helpers for the Freebuff Remote
 * Controller. Imported by the ORION page and its components.
 *
 * The actual process control (PTY, git, status transitions) lives in
 * the local Windows Bridge (`bridge/`), which talks to Supabase with
 * the service-role key. This file only describes the data shape the
 * browser sees through RLS.
 */

// ─── Task statuses ────────────────────────────────────────────────

export const FREEBUFF_TASK_STATUSES = [
  'idle',
  'queued',
  'starting',
  'running',
  'ready_for_review',
  'completed',
  'failed',
  'stopped',
  'approved',
  'discarded',
] as const;

export type FreebuffTaskStatus = (typeof FREEBUFF_TASK_STATUSES)[number];

/**
 * Statuses that mean "there is currently a live task" — i.e. the system
 * is NOT idle and a new task cannot start. `ready_for_review` counts as
 * live because the user must approve/discard before the next task.
 */
export const LIVE_TASK_STATUSES: ReadonlySet<FreebuffTaskStatus> = new Set([
  'queued',
  'starting',
  'running',
  'ready_for_review',
]);

/** Terminal statuses — no further action possible. */
export const TERMINAL_TASK_STATUSES: ReadonlySet<FreebuffTaskStatus> = new Set([
  'approved',
  'discarded',
]);

export interface FreebuffTask {
  id: string;
  user_id: string;
  title: string;
  status: FreebuffTaskStatus;
  initial_prompt: string;
  branch_name: string | null;
  preview_url: string | null;
  session_id: string | null;
  git_commit: string | null;
  files_changed: string[] | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  stopped_at: string | null;
}

export type PromptType = 'initial' | 'follow_up';
export type PromptStatus = 'queued' | 'sent' | 'completed' | 'failed';

export interface FreebuffPrompt {
  id: string;
  task_id: string;
  user_id: string;
  prompt: string;
  prompt_type: PromptType;
  status: PromptStatus;
  created_at: string;
  sent_at: string | null;
  completed_at: string | null;
}

export interface FreebuffTerminalChunk {
  id: string;
  task_id: string;
  user_id: string;
  output: string;
  created_at: string;
}

export type FreebuffCommandName = 'stop' | 'approve' | 'discard';

// ─── Status presentation metadata ─────────────────────────────────

interface StatusMeta {
  label: string;
  /** Tailwind text + subtle background chip classes. */
  dot: string;
}

export const TASK_STATUS_META: Record<FreebuffTaskStatus, StatusMeta> = {
  idle:            { label: 'Idle',             dot: 'bg-zinc-400' },
  queued:          { label: 'Queued',           dot: 'bg-amber-400' },
  starting:        { label: 'Starting',         dot: 'bg-sky-400' },
  running:         { label: 'Running',          dot: 'bg-emerald-400' },
  ready_for_review:{ label: 'Ready for review', dot: 'bg-violet-400' },
  completed:       { label: 'Completed',        dot: 'bg-emerald-500' },
  failed:          { label: 'Failed',           dot: 'bg-red-500' },
  stopped:         { label: 'Stopped',          dot: 'bg-orange-400' },
  approved:        { label: 'Approved',         dot: 'bg-green-500' },
  discarded:       { label: 'Discarded',        dot: 'bg-zinc-500' },
};

export function taskStatusLabel(status: FreebuffTaskStatus): string {
  return TASK_STATUS_META[status]?.label ?? status;
}

// ─── Time helpers ─────────────────────────────────────────────────

/**
 * Elapsed wall-clock duration for the Current Task panel.
 * Uses `started_at` when present, else `created_at`. Returns null when
 * there is no start reference yet.
 */
export function taskElapsedSeconds(task: FreebuffTask, nowMs: number): number | null {
  const startRaw = task.started_at ?? task.created_at;
  if (!startRaw) return null;
  const startMs = Date.parse(startRaw);
  if (Number.isNaN(startMs)) return null;
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

export function formatElapsed(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
