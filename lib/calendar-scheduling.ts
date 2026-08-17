/**
 * Explicit scheduling helpers — bridges the user-initiated "Schedule
 * this habit" and "Add to calendar [from this task]" actions.
 *
 * Rules:
 *   1. The source habit / task is NEVER mutated. We only READ its data.
 *   2. We always INSERT a real row into `calendar_events`. The new row
 *      owns its own id, dates, recurrence rule, etc.
 *   3. If `calendar_events` is empty / missing, we surface a clear
 *      message — never silently swallow.
 *
 * These functions are independent of the habits/todos CRUD layers.
 * Removing this file does not break habit or to-do behaviour; it only
 * removes the explicit cross-system shortcuts.
 */
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';

// ─── Types matching calendar_events schema ───────────────────────────

export interface NewCalendarEvent {
  title: string;
  /** ISO 8601 with timezone. */
  start_at: string;
  /** ISO 8601 with timezone. Must be > start_at. */
  end_at: string;
  location?: string | null;
  notes?: string | null;
  color?: string | null;
  all_day?: boolean;
  /** `'DAILY' | 'WEEKLY' | 'MONTHLY' | null` — encoded as JSON RRULE-subset. */
  recurrence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
}

export interface ScheduleResult {
  ok: boolean;
  error: string | null;
  eventId: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildRecurrenceJson(
  recurrence: NewCalendarEvent['recurrence'],
  anchor: Date,
): string | null {
  if (!recurrence) return null;
  const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][anchor.getDay()];
  const rule: { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; byweekday?: string[] } = {
    freq: recurrence,
  };
  if (recurrence === 'WEEKLY') rule.byweekday = [weekday];
  return JSON.stringify(rule);
}

/**
 * Insert a single calendar event. Returns the new row's id on success.
 * Auth is required; failure returns `{ ok: false, error }`.
 */
export async function createCalendarEvent(
  ev: NewCalendarEvent,
): Promise<ScheduleResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: 'Not signed in.', eventId: null };

  const anchor = new Date(ev.start_at);
  const payload = {
    user_id: userId,
    title: ev.title.trim(),
    start_at: ev.start_at,
    end_at: ev.end_at,
    location: ev.location ?? null,
    notes: ev.notes ?? null,
    color: ev.color ?? null,
    all_day: ev.all_day ?? false,
    recurrence:
      buildRecurrenceJson(ev.recurrence ?? null, anchor) ?? 'manual',
  };

  const { data, error } = await supabase
    .from('calendar_events')
    .insert(payload)
    .select('id')
    .single();
  if (error) {
    return { ok: false, error: error.message, eventId: null };
  }
  return { ok: true, error: null, eventId: data?.id ?? null };
}

// ─── Cross-system convenience builders ──────────────────────────────

/**
 * Format a calendar event from a habit, intended for the user's chosen
 * start day/time + duration. Pure transform — no DB writes.
 *
 * The recurrence defaults to `'WEEKLY'` so re-running it feels natural:
 * "I want to do this same habit every week at this time". The user can
 * override via the resulting modifiable row.
 */
export function buildEventFromHabit(opts: {
  habitName: string;
  habitDurationMinutes?: number | null;
  startISO: string;
  durationMinutes?: number | null;
  /** Default recurrence applied at insert time. */
  recurrence?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | null;
}): NewCalendarEvent {
  const start = new Date(opts.startISO);
  const duration = Math.max(
    15,
    opts.durationMinutes ?? opts.habitDurationMinutes ?? 30,
  );
  const end = new Date(start.getTime() + duration * 60_000);
  return {
    title: opts.habitName,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    recurrence: opts.recurrence ?? 'WEEKLY',
    all_day: false,
  };
}

/**
 * Format a calendar event from a task. Defaults the duration to the
 * task's `duration_minutes` (or 30min fallback), anchors to the task's
 * scheduled_for date in the morning by default.
 */
export function buildEventFromTask(opts: {
  taskTitle: string;
  taskDate: string; // YYYY-MM-DD
  taskDurationMinutes?: number | null;
  startTime?: string; // 'HH:MM' (24h) — defaults to 09:00
  durationMinutes?: number | null;
}): NewCalendarEvent {
  const start = new Date(opts.taskDate + 'T' + (opts.startTime ?? '09:00') + ':00');
  const duration = Math.max(15, opts.durationMinutes ?? opts.taskDurationMinutes ?? 30);
  const end = new Date(start.getTime() + duration * 60_000);
  return {
    title: opts.taskTitle,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    recurrence: null,
    all_day: false,
  };
}
