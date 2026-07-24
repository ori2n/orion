'use client';

/**
 * CalendarPanel — full v2 calendar for /actions.
 *
 * Replaces the previous tiny `CalendarTodayPanel` placeholder with the
 * redesigned UI: Day/Week/Month views, click-and-drag to create, drag
 * existing events to move or resize, free-time visualisation, live
 * current-time indicator that auto-scrolls into view on Today, NL
 * quick-add, and a voice button (Web Speech API when available).
 *
 * Storage shape: a `CalendarEvent` row per occurrence; recurring events
 * are stored as ONE row with a JSON `recurrence` field — the actual
 * occurrence expansion (next N weeks) is a follow-up.
 *
 * Drop-in props match the v1 wiring: receives `events` from the parent
 * (ActionsPage owns the fetch via loadData) and calls `onMutate()` after
 * any successful write so the parent can refetch.
 */

import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  start_at: string; // ISO 8601
  end_at: string;   // ISO 8601
  color?: string | null;
  location?: string | null;
  notes?: string | null;
  source?: string | null;
  all_day?: boolean;
  recurrence?: string | null;
  created_at?: string;
  updated_at?: string;
}

type View = 'day' | 'week' | 'month';
type RecurrenceFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface CalendarPanelProps {
  /**
   * Optional. If omitted, CalendarPanel fetches its own events from
   * Supabase on mount and after each mutation.
   */
  events?: CalendarEvent[];
  /**
   * Optional refetch hook. If omitted, the panel's own internal fetch
   * runs after every successful write.
   */
  onMutate?: () => Promise<void> | void;
}

// ─── Constants ────────────────────────────────────────────────────────────

const PRESET_COLORS: ReadonlyArray<{ name: string | null; cls: string; label: string }> = [
  { name: null,             cls: 'bg-zinc-200 dark:bg-zinc-700', label: 'none' },
  { name: 'bg-rose-500',    cls: 'bg-rose-500',    label: 'rose' },
  { name: 'bg-amber-500',   cls: 'bg-amber-500',   label: 'amber' },
  { name: 'bg-emerald-500', cls: 'bg-emerald-500', label: 'emerald' },
  { name: 'bg-sky-500',     cls: 'bg-sky-500',     label: 'sky' },
  { name: 'bg-violet-500',  cls: 'bg-violet-500',  label: 'violet' },
];

const HOUR_FLOOR = 6;
const HOUR_CEIL = 23;
const PX_PER_HOUR = 60;
const PX_PER_MIN = PX_PER_HOUR / 60;
const TOTAL_HOURS = HOUR_CEIL - HOUR_FLOOR + 1; // 18
const TIMELINE_HEIGHT_PX = TOTAL_HOURS * PX_PER_HOUR;
const SNAP_MINUTES = 15;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Helpers ───────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  // ISO week: Monday is day 1
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function weekdayCode(d: Date): 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU' {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d.getDay()] as
    | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
}

function snapMinutes(min: number): number {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES;
}

function clampMinutes(min: number): number {
  return Math.max(0, Math.min((HOUR_CEIL - HOUR_FLOOR) * 60, min));
}

function minutesToHM(min: number): { h: number; m: number } {
  return { h: HOUR_FLOOR + Math.floor(min / 60), m: min % 60 };
}

function minutesFromFloor(date: Date): number {
  return (date.getHours() - HOUR_FLOOR) * 60 + date.getMinutes();
}

function fmtHM(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function fmtLongDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function fmtMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fmtWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  if (sameMonth) {
    return `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} – ${sunday.getDate()}, ${sunday.getFullYear()}`;
  }
  return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${sunday.getFullYear()}`;
}

function buildRecurrence(freq: RecurrenceFreq, anchor: Date): string | null {
  if (freq === 'NONE') return null;
  const rule: { freq: 'DAILY' | 'WEEKLY' | 'MONTHLY'; byweekday?: string[] } = { freq };
  if (freq === 'WEEKLY') rule.byweekday = [weekdayCode(anchor)];
  return JSON.stringify(rule);
}

function parseRecurrence(s: string | null | undefined): RecurrenceFreq {
  if (!s) return 'NONE';
  try {
    const obj = JSON.parse(s);
    if (obj?.freq === 'DAILY') return 'DAILY';
    if (obj?.freq === 'WEEKLY') return 'WEEKLY';
    if (obj?.freq === 'MONTHLY') return 'MONTHLY';
  } catch { /* ignore */ }
  return 'NONE';
}

function clampDateToTimeline(date: Date, minFloor: Date): Date {
  const x = new Date(date);
  if (x.getHours() < HOUR_FLOOR) {
    x.setHours(HOUR_FLOOR, 0, 0, 0);
  }
  return x;
}

// Lightweight NL parser: handles patterns like
//   "tomorrow at 6"   "tomorrow at 18:00"
//   "tuesday at 3"   "wed 9am"
//   "Today 14:00"
function nlParse(input: string, anchor: Date): { title: string; date: Date } | null {
  const text = input.trim();
  if (!text) return null;

  const DN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const lower = text.toLowerCase();

  // Match "<when> at <h>(:<m>)?(am|pm)?" or "<when> <h>am/pm"
  let whenOffsetDays = 0;
  let when = anchor;

  // Day-of-week
  for (let i = 0; i < DN.length; i++) {
    if (lower.startsWith(DN[i])) {
      const dow = (i + 6) % 7; // ISO
      const cur = (anchor.getDay() + 6) % 7;
      whenOffsetDays = (dow - cur + 7) % 7;
      when = new Date(anchor);
      when.setDate(when.getDate() + whenOffsetDays);
      break;
    }
  }

  let title = text;
  if (whenOffsetDays > 0) {
    title = text.replace(/^\w+\s*/i, '').trim();
  }

  if (lower.includes('tomorrow')) {
    when = new Date(anchor);
    when.setDate(when.getDate() + 1);
    title = text.replace(/\btomorrow\b/i, '').trim();
  } else if (lower.startsWith('today')) {
    when = new Date(anchor);
    title = text.replace(/^today\b/i, '').trim();
  } else if (lower.startsWith('next week')) {
    when = startOfWeek(anchor);
    when.setDate(when.getDate() + 7);
    title = text.replace(/^next week\b/i, '').trim();
  }

  // Time: "at 6", "at 18:30", "5pm", "10am"
  let hour = 9; let min = 0; let matchedTime = false;
  const atMatch = lower.match(/(?:^|\s)at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atMatch) {
    hour = parseInt(atMatch[1], 10);
    min = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
    const ampm = atMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    title = title.replace(new RegExp(`(?:^|\\s)at\\s+${atMatch[1]}(?::\\d{2})?\\s*(?:am|pm)?`, 'i'), '').trim();
    matchedTime = true;
  } else {
    const bareMatch = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
    if (bareMatch) {
      hour = parseInt(bareMatch[1], 10);
      min = bareMatch[2] ? parseInt(bareMatch[2], 10) : 0;
      const ampm = bareMatch[3];
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      title = title.replace(new RegExp(`\\b\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)\\b`, 'i'), '').trim();
      matchedTime = true;
    }
  }

  when.setHours(matchedTime ? hour : 9, matchedTime ? min : 0, 0, 0);

  // Strip leading connector after the "when" part
  title = title.replace(/^(at|on|for)\s+/i, '').trim();
  if (!title) title = 'New event';

  return { title, date: when };
}

// ─── Hooks ─────────────────────────────────────────────────────────────────

function useNow(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── Main component ───────────────────────────────────────────────────────

export default function CalendarPanel({ events: propEvents, onMutate: propOnMutate }: CalendarPanelProps = {}) {
  // Internal fallback: when the parent doesn't pass events/onMutate, we
  // manage them ourselves. This keeps the component drop-in for callers
  // who just want <CalendarPanel /> with no wiring.
  const [internalEvents, setInternalEvents] = useState<CalendarEvent[]>([]);
  const internalRefetch = useCallback(async () => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('user_id', uid)
      .order('start_at');
    if (!error && data) setInternalEvents(data as CalendarEvent[]);
  }, []);
  useEffect(() => {
    if (propEvents === undefined) {
      void internalRefetch();
    }
  }, [propEvents === undefined, internalRefetch]);

  const events = propEvents ?? internalEvents;
  const onMutate = propOnMutate ?? internalRefetch;
  const [view, setView] = useState<View>('day');
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState<null | {
    title: string;
    startISO: string;
    endISO: string;
    allDay: boolean;
    prefill: string;
  }>(null);
  const [nlDraft, setNlDraft] = useState('');
  const [nlError, setNlError] = useState<string | null>(null);

  const navigate = useCallback(
    (delta: number, unit: 'day' | 'week' | 'month') => {
      setAnchorDate((prev) => {
        const next = new Date(prev);
        if (unit === 'day') next.setDate(next.getDate() + delta);
        if (unit === 'week') next.setDate(next.getDate() + 7 * delta);
        if (unit === 'month') next.setMonth(next.getMonth() + delta);
        return startOfDay(next);
      });
    },
    [],
  );

  const goToday = useCallback(() => setAnchorDate(startOfDay(new Date())), []);

  // Day-view events: those that span anchorDate (event intersects the day)
  const dayEvents = useMemo(() => {
    return events.filter((e) => {
      const s = new Date(e.start_at);
      const en = new Date(e.end_at);
      // All-day multi-day: include if anchor day falls in [event start day, event end day]
      if (e.all_day) {
        const dayStart = startOfDay(anchorDate);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        return en >= dayStart && s <= dayEnd;
      }
      return sameDay(s, anchorDate) || (s < anchorDate && en > anchorDate);
    });
  }, [events, anchorDate]);

  const allDayEvents = useMemo(
    () => dayEvents.filter((e) => e.all_day).sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [dayEvents],
  );
  const timedEvents = useMemo(
    () => dayEvents.filter((e) => !e.all_day).sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [dayEvents],
  );

  const handleSaved = useCallback(async () => {
    await onMutate();
    setEditing(null);
    setCreating(null);
    setNlDraft('');
    setNlError(null);
  }, [onMutate]);

  const handleDelete = useCallback(async (id: string) => {
    const uid = await getCurrentUserId();
    if (!uid) return;
    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    if (error) {
      setNlError(`Failed to delete: ${error.message}`);
      return;
    }
    await onMutate();
    setEditing(null);
  }, [onMutate]);

  const handleNewEvent = useCallback(() => {
    const start = new Date(anchorDate);
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);
    setCreating({
      title: '',
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      allDay: false,
      prefill: '',
    });
  }, [anchorDate]);

  const handleNLSubmit = useCallback(() => {
    setNlError(null);
    const parsed = nlParse(nlDraft, anchorDate);
    if (!parsed) {
      setNlError('Try "Tennis Tuesday at 6" or "Lunch tomorrow at 12:30".');
      return;
    }
    const start = parsed.date;
    const end = new Date(start);
    end.setHours(start.getHours() + 1);
    setCreating({
      title: parsed.title,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      allDay: false,
      prefill: nlDraft,
    });
  }, [nlDraft, anchorDate]);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <CalendarHeader
        view={view}
        setView={setView}
        anchorDate={anchorDate}
        goToday={goToday}
        navigate={navigate}
        onAdd={handleNewEvent}
        nlDraft={nlDraft}
        setNlDraft={setNlDraft}
        onNLSubmit={handleNLSubmit}
        nlError={nlError}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        {view === 'day' && (
          <DayView
            anchorDate={anchorDate}
            allDayEvents={allDayEvents}
            timedEvents={timedEvents}
            onCreateRange={(startISO, endISO) =>
              setCreating({
                title: '',
                startISO,
                endISO,
                allDay: false,
                prefill: '',
              })
            }
            onUpdateEvent={async (id, iso) => {
              const uid = await getCurrentUserId();
              if (!uid) return;
              // iso is { start_at, end_at }
              await supabase.from('calendar_events').update(iso).eq('id', id);
              await onMutate();
            }}
            onClickEvent={(e) => setEditing(e)}
          />
        )}

        {view === 'week' && (
          <WeekView
            anchorDate={anchorDate}
            events={events}
            onClickEvent={(e) => setEditing(e)}
            onCreateQuick={(date) => {
              const start = new Date(date);
              start.setHours(9, 0, 0, 0);
              const end = new Date(start);
              end.setHours(10, 0, 0, 0);
              setCreating({
                title: '',
                startISO: start.toISOString(),
                endISO: end.toISOString(),
                allDay: false,
                prefill: '',
              });
            }}
          />
        )}

        {view === 'month' && (
          <MonthView
            anchorDate={anchorDate}
            events={events}
            onClickEvent={(e) => setEditing(e)}
            onCreateQuick={(date) => {
              const start = new Date(date);
              start.setHours(9, 0, 0, 0);
              const end = new Date(start);
              end.setHours(10, 0, 0, 0);
              setCreating({
                title: '',
                startISO: start.toISOString(),
                endISO: end.toISOString(),
                allDay: false,
                prefill: '',
              });
            }}
            onDayClick={(date) => {
              setAnchorDate(startOfDay(date));
              setView('day');
            }}
          />
        )}
      </div>

      {(creating || editing) && (
        <EventModal
          initial={creating ?? null}
          editing={editing}
          onClose={() => { setCreating(null); setEditing(null); setNlError(null); }}
          onSaved={handleSaved}
          onDelete={handleDelete}
          colors={PRESET_COLORS}
        />
      )}
    </div>
  );
}

// ─── Header ───────────────────────────────────────────────────────────────

function CalendarHeader({
  view, setView, anchorDate, goToday, navigate, onAdd,
  nlDraft, setNlDraft, onNLSubmit, nlError,
}: {
  view: View; setView: (v: View) => void;
  anchorDate: Date; goToday: () => void;
  navigate: (delta: number, unit: 'day' | 'week' | 'month') => void;
  onAdd: () => void;
  nlDraft: string; setNlDraft: (s: string) => void;
  onNLSubmit: () => void; nlError: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => navigate(-1, view === 'day' ? 'day' : view === 'week' ? 'week' : 'month')}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={goToday}
          className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => navigate(1, view === 'day' ? 'day' : view === 'week' ? 'week' : 'month')}
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      <h2 className="ml-1 text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {view === 'day'
          ? fmtLongDate(anchorDate)
          : view === 'week'
          ? fmtWeekRange(startOfWeek(anchorDate))
          : fmtMonthYear(anchorDate)}
      </h2>

      <div className="rounded-md bg-zinc-100 p-0.5 text-[11px] font-medium dark:bg-zinc-800">
        {(['day', 'week', 'month'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`rounded px-2 py-0.5 transition-colors duration-150 ${
              view === v
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200'
            }`}
          >
            {v === 'day' ? 'Day' : v === 'week' ? 'Week' : 'Month'}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <form
          onSubmit={(e) => { e.preventDefault(); onNLSubmit(); }}
          className="hidden items-center gap-1 lg:flex"
        >
          <div className="flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-800">
            <span aria-hidden className="text-[11px] text-zinc-400">✨</span>
            <input
              type="text"
              placeholder='Try "Tennis Tuesday at 6"'
              value={nlDraft}
              onChange={(e) => setNlDraft(e.target.value)}
              className="w-52 bg-transparent text-xs text-zinc-900 placeholder-zinc-400 outline-none dark:text-zinc-100"
            />
          </div>
        </form>

        <VoiceButton onTranscript={(t) => setNlDraft(t)} />

        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add
        </button>
      </div>

      {nlError && (
        <div className="basis-full text-[11px] text-amber-600 dark:text-amber-400">
          {nlError}
        </div>
      )}
    </div>
  );
}

// ─── Day view ──────────────────────────────────────────────────────────────

function DayView({
  anchorDate,
  allDayEvents,
  timedEvents,
  onCreateRange,
  onUpdateEvent,
  onClickEvent,
}: {
  anchorDate: Date;
  allDayEvents: CalendarEvent[];
  timedEvents: CalendarEvent[];
  onCreateRange: (startISO: string, endISO: string) => void;
  onUpdateEvent: (id: string, iso: { start_at: string; end_at: string }) => Promise<void>;
  onClickEvent: (e: CalendarEvent) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    type: 'create' | 'move' | 'resize' | null;
    originY: number;
    startMin: number;
    endMin: number;
    eventId?: string;
  }>({ type: null, originY: 0, startMin: 0, endMin: 0 });
  const [draftRange, setDraftRange] = useState<null | { top: number; height: number }>(null);
  const [dragPreview, setDragPreview] = useState<null | { id: string; top: number; height: number }>(null);

  const now = useNow();
  const isToday = sameDay(now, anchorDate);

  // Auto-scroll to roughly the current time on first mount (Today)
  useEffect(() => {
    if (!containerRef.current) return;
    if (!isToday) return;
    const min = minutesFromFloor(now);
    const target = Math.max(0, min * PX_PER_MIN - 120);
    containerRef.current.scrollTop = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pointerToMinutes(clientY: number): number {
    const rect = containerRef.current!.getBoundingClientRect();
    const y = clientY - rect.top + containerRef.current!.scrollTop;
    return clampMinutes(snapMinutes(y / PX_PER_MIN));
  }

  const onPointerDownGrid = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-event]') || target.closest('[data-handle]')) return;
      // Only react to primary button
      if (e.button !== 0) return;
      e.preventDefault();
      const min = pointerToMinutes(e.clientY);
      dragRef.current = {
        type: 'create',
        originY: e.clientY,
        startMin: min,
        endMin: min + 30,
      };
      setDraftRange({ top: min * PX_PER_MIN, height: 30 * PX_PER_MIN });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerDownEvent = useCallback(
    (e: React.PointerEvent, ev: CalendarEvent, mode: 'move' | 'resize') => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const min = pointerToMinutes(e.clientY);
      const startMin = minutesFromFloor(new Date(ev.start_at));
      const endMin = Math.max(startMin + 15, minutesFromFloor(new Date(ev.end_at)));
      dragRef.current = {
        type: mode,
        originY: e.clientY,
        startMin,
        endMin,
        eventId: ev.id,
      };
      setDragPreview({
        id: ev.id,
        top: startMin * PX_PER_MIN,
        height: (endMin - startMin) * PX_PER_MIN,
      });
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.type) return;
    const min = pointerToMinutes(e.clientY);
    if (d.type === 'create') {
      const start = Math.min(d.startMin, min);
      const end = Math.max(d.startMin, min);
      setDraftRange({ top: start * PX_PER_MIN, height: (end - start) * PX_PER_MIN });
    } else if (d.type === 'move' && d.eventId) {
      const deltaMin = min - d.startMin;
      const newStart = Math.max(0, d.startMin + deltaMin);
      const newEnd = Math.min((HOUR_CEIL - HOUR_FLOOR) * 60, d.endMin + deltaMin);
      const height = (d.endMin - d.startMin) * PX_PER_MIN;
      setDragPreview({ id: d.eventId, top: newStart * PX_PER_MIN, height });
    } else if (d.type === 'resize' && d.eventId) {
      const newEnd = Math.max(d.startMin + 15, min);
      const height = (newEnd - d.startMin) * PX_PER_MIN;
      setDragPreview({ id: d.eventId, top: d.startMin * PX_PER_MIN, height });
    }
  }, []);

  const onPointerUpGrid = useCallback(
    async (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d.type) return;
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);

      if (d.type === 'create') {
        const startMin = Math.min(d.startMin, d.endMin - d.startMin < 15 ? d.startMin + 30 : (dragRef.current as any).endMin || d.startMin + 30);
        // Recompute properly from draftRange height
        // The draftRange state already shows the truth; trust its values via DOM:
        const el = containerRef.current!.querySelector('[data-draft]') as HTMLElement | null;
        let startM = d.startMin;
        let endM = d.endMin;
        if (el) {
          const top = parseFloat(el.style.top);
          const height = parseFloat(el.style.height);
          startM = snapMinutes(top / PX_PER_MIN);
          endM = snapMinutes((top + height) / PX_PER_MIN);
          if (endM < startM + 15) endM = startM + 30;
        }
        const startHM = minutesToHM(Math.max(0, startM));
        const endHM = minutesToHM(clampMinutes(endM));
        const baseDay = startOfDay(anchorDate);
        const start = new Date(baseDay); start.setHours(startHM.h, startHM.m, 0, 0);
        const end = new Date(baseDay); end.setHours(endHM.h, endHM.m, 0, 0);
        dragRef.current = { type: null, originY: 0, startMin: 0, endMin: 0 };
        setDraftRange(null);
        onCreateRange(start.toISOString(), end.toISOString());
        return;
      }

      if ((d.type === 'move' || d.type === 'resize') && d.eventId) {
        const el = containerRef.current!.querySelector(
          `[data-event="${d.eventId}"]`,
        ) as HTMLElement | null;
        let startM = d.startMin;
        let endM = d.endMin;
        if (el) {
          const top = parseFloat(el.style.top);
          const height = parseFloat(el.style.height);
          startM = snapMinutes(top / PX_PER_MIN);
          endM = snapMinutes((top + height) / PX_PER_MIN);
        }
        if (endM < startM + 15) endM = startM + 30;
        const startHM = minutesToHM(Math.max(0, startM));
        const endHM = minutesToHM(clampMinutes(endM));
        const baseDay = startOfDay(anchorDate);
        const start = new Date(baseDay); start.setHours(startHM.h, startHM.m, 0, 0);
        const end = new Date(baseDay); end.setHours(endHM.h, endHM.m, 0, 0);
        dragRef.current = { type: null, originY: 0, startMin: 0, endMin: 0 };
        const eventId = d.eventId;
        const mode = d.type;
        setDragPreview(null);
        await onUpdateEvent(eventId, { start_at: start.toISOString(), end_at: end.toISOString() });
        return;
      }
      dragRef.current = { type: null, originY: 0, startMin: 0, endMin: 0 };
      setDraftRange(null);
      setDragPreview(null);
    },
    [anchorDate, onCreateRange, onUpdateEvent],
  );

  // Free-time chips: gaps ≥ 30 min between timed events today
  const freeChips = useMemo(() => {
    if (!isToday) return [];
    const nowMin = minutesFromFloor(now);
    const sorted = [...timedEvents]
      .map((e) => ({
        s: minutesFromFloor(new Date(e.start_at)),
        en: minutesFromFloor(new Date(e.end_at)),
      }))
      .sort((a, b) => a.s - b.s);
    const gaps: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const seg of sorted) {
      if (seg.s > cursor) gaps.push({ start: cursor, end: seg.s });
      cursor = Math.max(cursor, seg.en);
    }
    if (cursor < TOTAL_HOURS * 60) gaps.push({ start: cursor, end: TOTAL_HOURS * 60 });
    return gaps
      .filter((g) => g.end - g.start >= 60 && g.end > nowMin + 60) // future free time ≥ 1h
      .slice(0, 3); // top 3 — keeps the panel quiet
  }, [timedEvents, now, isToday]);

  const liveMin = minutesFromFloor(now);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* All-day strip */}
      <div className="flex items-start gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          All-day
        </span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {allDayEvents.length === 0 ? (
            <span className="text-[11px] italic text-zinc-400 dark:text-zinc-500">No all-day events</span>
          ) : (
            allDayEvents.map((e) => (
              <AllDayChip key={e.id} event={e} onClick={() => onClickEvent(e)} />
            ))
          )}
        </div>
      </div>

      {/* Timeline */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDownGrid}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUpGrid}
        onPointerCancel={onPointerUpGrid}
        className="relative flex-1 cursor-crosshair select-none overflow-y-auto"
        style={{ touchAction: 'none' }}
      >
        <div className="relative" style={{ height: TIMELINE_HEIGHT_PX, paddingRight: 8 }}>
          {/* Hour markers */}
          {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => HOUR_FLOOR + i).map((h, i) => (
            <div
              key={h}
              className="pointer-events-none absolute left-0 right-0 border-t border-zinc-100 dark:border-zinc-800"
              style={{ top: i * PX_PER_HOUR }}
            >
              <span className="-translate-y-1.5 inline-block pl-2 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
                {pad2(h)}:00
              </span>
            </div>
          ))}

          {/* Free time chips */}
          {freeChips.map((g, i) => (
            <div
              key={i}
              className="pointer-events-none absolute left-12 right-2 rounded-md border border-dashed border-emerald-200/70 bg-emerald-50/40 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-300"
              style={{ top: g.start * PX_PER_MIN, height: (g.end - g.start) * PX_PER_MIN }}
            >
              <span className="opacity-70">✨ Available · {Math.floor((g.end - g.start) / 60)}h {(g.end - g.start) % 60}m</span>
            </div>
          ))}

          {/* Events */}
          {timedEvents.map((e) => {
            const startMin = Math.max(0, minutesFromFloor(new Date(e.start_at)));
            const endMin = clampMinutes(minutesFromFloor(new Date(e.end_at)));
            const height = Math.max(20, (endMin - startMin) * PX_PER_MIN);
            const preview = dragPreview && dragPreview.id === e.id ? dragPreview : null;
            const top = preview ? preview.top : startMin * PX_PER_MIN;
            const finalHeight = preview ? preview.height : height;
            return (
              <DraggableEventBlock
                key={e.id}
                event={e}
                top={top}
                height={finalHeight}
                onClick={() => onClickEvent(e)}
                onPointerDown={(ev, mode) => onPointerDownEvent(ev, e, mode)}
              />
            );
          })}

          {/* Draft event preview while drag-creating */}
          {draftRange && (
            <div
              data-draft
              className="pointer-events-none absolute left-12 right-2 rounded-md border border-dashed border-rose-400 bg-rose-100/40 px-2 py-1 text-[11px] font-medium text-rose-700 dark:border-rose-500 dark:bg-rose-900/30 dark:text-rose-200"
              style={{ top: draftRange.top, height: draftRange.height }}
            >
              <span className="opacity-80">New commitment</span>
            </div>
          )}

          {/* Live current-time indicator */}
          {isToday && liveMin >= 0 && liveMin <= TOTAL_HOURS * 60 && (
            <div
              className="pointer-events-none absolute left-0 right-0 flex items-center gap-2"
              style={{ top: liveMin * PX_PER_MIN }}
            >
              <span className="h-2 w-2 rounded-full bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.18)]" />
              <span className="h-px flex-1 bg-gradient-to-r from-rose-500/80 via-rose-500/40 to-rose-500/0" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Draggable event block ─────────────────────────────────────────────────

function DraggableEventBlock({
  event, top, height, onClick, onPointerDown,
}: {
  event: CalendarEvent;
  top: number;
  height: number;
  onClick: () => void;
  onPointerDown: (e: React.PointerEvent, mode: 'move' | 'resize') => void;
}) {
  const colors = PRESET_COLORS.find((c) => c.name === event.color);
  const cls = colors?.cls ?? 'bg-zinc-400 dark:bg-zinc-600';
  const isDark = !event.color;
  return (
    <div
      data-event={event.id}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      className={`group absolute left-12 right-2 cursor-grab overflow-hidden rounded-md ${cls} px-2 py-1 text-[11px] font-medium shadow-sm transition-shadow hover:shadow ${
        isDark ? 'text-zinc-900 dark:text-zinc-50' : 'text-white'
      } ${height < 28 ? 'leading-tight' : ''}`}
      style={{ top, height }}
    >
      <div className="truncate leading-tight">{event.title}</div>
      {height >= 28 && (
        <div className="truncate text-[10px] opacity-85">
          {fmtHM(new Date(event.start_at))} – {fmtHM(new Date(event.end_at))}
        </div>
      )}
      {/* Resize handle — bottom 6px */}
      <div
        data-handle="resize"
        onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'resize'); }}
        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize bg-black/0 hover:bg-black/10"
        aria-label="Resize"
      />
    </div>
  );
}

// ─── All-day chip ──────────────────────────────────────────────────────────

function AllDayChip({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const colors = PRESET_COLORS.find((c) => c.name === event.color);
  const cls = colors?.cls ?? 'bg-zinc-300 dark:bg-zinc-700';
  const isDark = !event.color;
  const s = new Date(event.start_at);
  const en = new Date(event.end_at);
  const sameStartEndDay = sameDay(s, en);
  const label = sameStartEndDay
    ? s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${en.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md ${cls} px-2 py-1 text-[11px] font-medium shadow-sm transition-shadow hover:shadow ${
        isDark ? 'text-zinc-900 dark:text-zinc-50' : 'text-white'
      }`}
    >
      <span className="truncate">{event.title}</span>
      <span className="text-[10px] opacity-80">{label}</span>
    </button>
  );
}

// ─── Week view ─────────────────────────────────────────────────────────────

function WeekView({
  anchorDate, events, onClickEvent, onCreateQuick,
}: {
  anchorDate: Date;
  events: CalendarEvent[];
  onClickEvent: (e: CalendarEvent) => void;
  onCreateQuick: (date: Date) => void;
}) {
  const monday = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
  const now = useNow();
  const today = startOfDay(now);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div key={i} className="border-r border-zinc-200 px-2 py-3 text-center dark:border-zinc-800">
              <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {WEEKDAYS[i]}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${
                isToday ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-100'
              }`}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid flex-1 grid-cols-7 overflow-y-auto">
        {days.map((d, i) => {
          const dayStart = startOfDay(d);
          const dayEnd = new Date(dayStart);
          dayEnd.setHours(23, 59, 59, 999);
          const dayAllDay = events.filter((e) => e.all_day &&
            new Date(e.end_at) >= dayStart && new Date(e.start_at) <= dayEnd);
          const dayTimed = events.filter((e) => !e.all_day && sameDay(new Date(e.start_at), d));
          return (
            <div
              key={i}
              className="min-h-[420px] cursor-pointer border-r border-zinc-200 p-1.5 transition-colors hover:bg-zinc-50/50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"
              onClick={() => onCreateQuick(d)}
            >
              {dayAllDay.length > 0 && (
                <div className="mb-1.5 space-y-1">
                  {dayAllDay.slice(0, 2).map((e) => (
                    <WeekChip key={e.id} event={e} onClick={(ev) => { ev.stopPropagation(); onClickEvent(e); }} />
                  ))}
                  {dayAllDay.length > 2 && (
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); onClickEvent(dayAllDay[2]); }}
                      className="block w-full truncate text-left text-[10px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    >
                      +{dayAllDay.length - 2} more
                    </button>
                  )}
                </div>
              )}
              {dayTimed.slice(0, 4).map((e) => (
                <WeekChip key={e.id} event={e} onClick={(ev) => { ev.stopPropagation(); onClickEvent(e); }} />
              ))}
              {dayTimed.length > 4 && (
                <div className="mt-1 text-[10px] text-zinc-500">+{dayTimed.length - 4} more</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekChip({ event, onClick }: { event: CalendarEvent; onClick: (e: React.MouseEvent) => void }) {
  const colors = PRESET_COLORS.find((c) => c.name === event.color);
  const cls = colors?.cls ?? 'bg-zinc-300 dark:bg-zinc-700';
  const isDark = !event.color;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full truncate rounded ${cls} px-1.5 py-1 text-left text-[10px] font-medium ${
        isDark ? 'text-zinc-900 dark:text-zinc-50' : 'text-white'
      }`}
    >
      <span>{event.title}</span>
      {!event.all_day && (
        <span className="ml-1 opacity-80">{fmtHM(new Date(event.start_at))}</span>
      )}
    </button>
  );
}

// ─── Month view ────────────────────────────────────────────────────────────

function MonthView({
  anchorDate, events, onClickEvent, onCreateQuick, onDayClick,
}: {
  anchorDate: Date;
  events: CalendarEvent[];
  onClickEvent: (e: CalendarEvent) => void;
  onCreateQuick: (date: Date) => void;
  onDayClick: (date: Date) => void;
}) {
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = startOfWeek(new Date(monthEnd.getTime() + 86400000));
  // Build 6-week grid (42 cells) for stable layout
  const cells: Date[] = [];
  const cur = new Date(gridStart);
  while (cur < gridEnd) {
    cells.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  // Pad up to 42
  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    cells.push(next);
  }
  const now = useNow();
  const today = startOfDay(now);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-r border-zinc-200 px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {w}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 overflow-y-auto">
        {cells.map((d, i) => {
          const isCurrentMonth = d.getMonth() === anchorDate.getMonth();
          const dayStart = startOfDay(d);
          const dayEnd = new Date(dayStart);
          dayEnd.setHours(23, 59, 59, 999);
          const dayEvents = events.filter((e) =>
            new Date(e.end_at) >= dayStart && new Date(e.start_at) <= dayEnd,
          );
          const isToday = sameDay(d, today);
          return (
            <button
              type="button"
              key={i}
              onClick={() => onDayClick(d)}
              onDoubleClick={() => onCreateQuick(d)}
              className={`group relative flex min-h-[78px] flex-col items-start gap-1 border-r border-b border-zinc-200 p-1.5 text-left text-[10px] transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30 ${
                isCurrentMonth ? '' : 'opacity-40'
              }`}
            >
              <span className={`text-xs font-semibold tabular-nums ${
                isToday ? 'rounded-full bg-rose-500 px-1.5 py-0.5 text-white' : 'text-zinc-900 dark:text-zinc-100'
              }`}>
                {d.getDate()}
              </span>
              <div className="w-full space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => {
                  const colors = PRESET_COLORS.find((c) => c.name === e.color);
                  const cls = colors?.cls ?? 'bg-zinc-300 dark:bg-zinc-700';
                  const isDark = !e.color;
                  return (
                    <div
                      key={e.id}
                      role="button"
                      onClick={(ev) => { ev.stopPropagation(); onClickEvent(e); }}
                      className={`cursor-pointer truncate rounded ${cls} px-1 py-0.5 text-[10px] font-medium ${
                        isDark ? 'text-zinc-900 dark:text-zinc-50' : 'text-white'
                      }`}
                    >
                      {e.title}
                    </div>
                  );
                })}
                {dayEvents.length > 3 && (
                  <div className="text-[10px] text-zinc-500">+{dayEvents.length - 3}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Event modal ──────────────────────────────────────────────────────────

function EventModal({
  initial,
  editing,
  onClose,
  onSaved,
  onDelete,
  colors,
}: {
  initial: { title: string; startISO: string; endISO: string; allDay: boolean; prefill: string } | null;
  editing: CalendarEvent | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onDelete: (id: string) => Promise<void>;
  colors: ReadonlyArray<{ name: string | null; cls: string; label: string }>;
}) {
  const isEdit = !!editing;
  const [title, setTitle] = useState(editing?.title ?? initial?.title ?? '');
  const [color, setColor] = useState<string | null>(editing?.color ?? null);
  const [allDay, setAllDay] = useState<boolean>(editing?.all_day ?? initial?.allDay ?? false);
  const [recurrence, setRecurrence] = useState<RecurrenceFreq>(parseRecurrence(editing?.recurrence));
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [start, setStart] = useState<string>(() => {
    const d = new Date(editing?.start_at ?? initial?.startISO ?? new Date());
    return toLocalInput(d);
  });
  const [end, setEnd] = useState<string>(() => {
    const d = new Date(editing?.end_at ?? initial?.endISO ?? new Date());
    return toLocalInput(d);
  });
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useCallback(async () => {
    setErr(null);
    if (!title.trim()) {
      setErr('Title is required.');
      return;
    }
    const startD = new Date(start);
    const endD = new Date(end);
    if (Number.isNaN(startD.getTime()) || Number.isNaN(endD.getTime())) {
      setErr('Pick valid start and end times.');
      return;
    }

    let startISO = startD.toISOString();
    let endISO = endD.toISOString();
    if (allDay) {
      startD.setHours(0, 0, 0, 0);
      endD.setHours(23, 59, 59, 999);
      startISO = startD.toISOString();
      endISO = endD.toISOString();
    }
    if (new Date(endISO) <= new Date(startISO)) {
      setErr('End must be after start.');
      return;
    }

    setSubmitting(true);
    const uid = await getCurrentUserId();
    if (!uid) {
      setSubmitting(false);
      setErr('Not signed in.');
      return;
    }
    const payload = {
      user_id: uid,
      title: title.trim(),
      start_at: startISO,
      end_at: endISO,
      color,
      notes: notes.trim() || null,
      all_day: allDay,
      recurrence: buildRecurrence(recurrence, startD),
    };
    let error: { message: string; code?: string } | null = null;
    let data: CalendarEvent | null = null;
    if (isEdit && editing) {
      const res = await supabase.from('calendar_events').update(payload).eq('id', editing.id).select().single();
      error = res.error;
      data = res.data as CalendarEvent | null;
    } else {
      const res = await supabase.from('calendar_events').insert(payload).select().single();
      error = res.error;
      data = res.data as CalendarEvent | null;
    }
    setSubmitting(false);
    if (error) {
      const missing = error.code === 'PGRST205' || /schema cache|calendar_events/.test(error.message);
      setErr(missing
        ? 'Apply lib/supabase-apply-calendar-redesign.sql in the SQL Editor.'
        : `Save failed: ${error.message}`,
      );
      return;
    }
    await onSaved();
  }, [title, start, end, color, allDay, recurrence, notes, isEdit, editing, onSaved]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={() => !submitting && onClose()}
    >
      <fieldset
        disabled={submitting}
        className="w-full max-w-md space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 disabled:opacity-60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {isEdit ? 'Edit event' : 'New event'}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {isEdit ? 'Update the commitment.' : 'Block time on your calendar.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div>
          <label className="block">
            <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tennis, School, Doctor…"
              autoFocus
              className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/50">
          <input
            id="all-day-toggle"
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-rose-500 focus:ring-rose-400 dark:border-zinc-600"
          />
          <label htmlFor="all-day-toggle" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
            All-day event
          </label>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            (holidays, full-day events)
          </span>
        </div>

        <div className={`grid gap-3 ${allDay ? 'grid-cols-2' : 'grid-cols-2'}`}>
          <label className="block">
            <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Starts</span>
            <input
              type="date"
              value={start.slice(0, 10)}
              onChange={(e) => setStart(`${e.target.value}${start.slice(10)}`)}
              className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </label>
          <label className="block">
            <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Ends</span>
            <input
              type="date"
              value={end.slice(0, 10)}
              onChange={(e) => setEnd(`${e.target.value}${end.slice(10)}`)}
              className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </label>
        </div>

        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Time</span>
              <input
                type="time"
                value={start.slice(11, 16)}
                onChange={(e) => setStart(`${start.slice(0, 10)}T${e.target.value}:00`)}
                step={900}
                className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">End time</span>
              <input
                type="time"
                value={end.slice(11, 16)}
                onChange={(e) => setEnd(`${end.slice(0, 10)}T${e.target.value}:00`)}
                step={900}
                className="mt-0.5 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
              />
            </label>
          </div>
        )}

        <div>
          <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Repeats</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRecurrence(r)}
                aria-pressed={recurrence === r}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  recurrence === r
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                {r === 'NONE' ? 'Doesn’t repeat' : r === 'DAILY' ? 'Daily' : r === 'WEEKLY' ? 'Weekly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Color</span>
          <div className="mt-1 flex items-center gap-2">
            {colors.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => setColor(c.name)}
                aria-label={`Color ${c.label}`}
                aria-pressed={color === c.name}
                className={`h-5 w-5 rounded-full ${c.cls} transition-all ${
                  color === c.name
                    ? 'ring-2 ring-zinc-900 ring-offset-2 ring-offset-white dark:ring-zinc-100 dark:ring-offset-zinc-900'
                    : 'hover:scale-110'
                }`}
              />
            ))}
          </div>
        </div>

        <label className="block">
          <span className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Notes</span>
          <textarea
            value={notes ?? ''}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Optional"
            className="mt-0.5 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
          />
        </label>

        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {err}
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {isEdit ? (
            <button
              type="button"
              onClick={() => editing && onDelete(editing.id)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              Delete
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!title.trim()}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {submitting ? 'Saving…' : isEdit ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

// ─── Local-time helper for HTML5 datetime inputs ──────────────────────────

function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ─── Voice button (uses Web Speech API when available) ────────────────────

function VoiceButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  type SR = { new (): SpeechRecognitionLike; prototype: SpeechRecognitionLike };
  interface SpeechRecognitionLike extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start(): void;
    stop(): void;
  }
  const srRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { SpeechRecognition?: SR; webkitSpeechRecognition?: SR };
    const Cls = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    setSupported(Boolean(Cls));
  }, []);

  const toggle = useCallback(() => {
    if (!supported) {
      const fallback = prompt('Voice input not supported by this browser — type the event:');
      if (fallback) onTranscript(fallback);
      return;
    }
    if (listening) {
      srRef.current?.stop();
      setListening(false);
      return;
    }
    const w = window as unknown as { SpeechRecognition: SR; webkitSpeechRecognition: SR };
    const Cls = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const sr = new Cls();
    sr.lang = 'en-US';
    sr.continuous = false;
    sr.interimResults = false;
    sr.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript ?? '';
      if (text) onTranscript(text);
    };
    sr.onend = () => setListening(false);
    sr.onerror = () => setListening(false);
    srRef.current = sr;
    setListening(true);
    sr.start();
  }, [supported, listening, onTranscript]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      title={supported ? (listening ? 'Listening…' : 'Voice input') : 'Voice input unavailable — opens prompt fallback'}
      className={`rounded-md p-1.5 transition-colors ${
        listening
          ? 'bg-rose-500 text-white shadow-[0_0_0_4px_rgba(244,63,94,0.18)]'
          : 'border border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-700'
      }`}
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
      </svg>
    </button>
  );
}
