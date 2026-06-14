'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getLatestSleepLog, insertSleepLog, getSleepLogs, updateSleepLog } from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { SleepLog } from '@/lib/health/storage';

// ─── Timeline constants ─────────────────────────────────────────────

/** The timeline runs from 22:00 (10pm) to 11:00 next day (11am). */
const TIMELINE_START_HOUR = 22;
const TIMELINE_END_HOUR = 11;
const TIMELINE_SPAN_HOURS = 24 - TIMELINE_START_HOUR + TIMELINE_END_HOUR; // 13
const TOTAL_MINUTES = TIMELINE_SPAN_HOURS * 60; // 780

/** Hour labels shown below the track. */
const HOUR_LABELS = Array.from({ length: TIMELINE_SPAN_HOURS + 1 }, (_, i) =>
  (TIMELINE_START_HOUR + i) % 24,
);

// ─── Date/time helpers ──────────────────────────────────────────────

/** The "evening date" is the calendar day when the sleep session began.
 *
 * Cutoff is 4pm (16:00):
 * - Before 4pm → logging last night's sleep → evening date = yesterday
 * - After 4pm  → pre-logging tonight's sleep → evening date = today
 *
 * This avoids mis-assigning sleep to "tonight" when logging
 * mid-afternoon for the previous night. */
function getEveningDate(): Date {
  const now = new Date();
  return now.getHours() < 16
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Convert a timeline position (0–1) into a full Date.
 * Positions map linearly across the 13-hour window starting at
 * TIMELINE_START_HOUR on the evening date.
 */
function positionToDate(eveningDate: Date, pos: number): Date {
  const d = new Date(eveningDate);
  d.setHours(TIMELINE_START_HOUR, 0, 0, 0);
  d.setMinutes(d.getMinutes() + Math.round(pos * TOTAL_MINUTES));
  return d;
}

/**
 * Convert a Date back to a timeline position (0–1) relative to the
 * evening date.  Used to pre-fill from existing data.
 */
function dateToPosition(date: Date, eveningDate: Date): number {
  const ref = new Date(eveningDate);
  ref.setHours(TIMELINE_START_HOUR, 0, 0, 0);
  const diffMs = date.getTime() - ref.getTime();
  const diffMin = diffMs / (1000 * 60);
  return Math.max(0, Math.min(1, diffMin / TOTAL_MINUTES));
}

function fmtTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.round((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${h}h ${m}m`;
}

function nightOfLabel(date: Date): string {
  // `date` is the evening the sleep started (e.g. May 29 for "night of May 29")
  return `Night of ${date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`;
}

/** Default bedtime (23:00) and wake-up (07:00) as 0‑1 positions. */
function defaultStartPos(ev: Date): number {
  return dateToPosition(new Date(ev.getFullYear(), ev.getMonth(), ev.getDate(), 23, 0), ev);
}
function defaultEndPos(ev: Date): number {
  return dateToPosition(new Date(ev.getFullYear(), ev.getMonth(), ev.getDate() + 1, 7, 0), ev);
}

// ─── Component ──────────────────────────────────────────────────────

export default function SleepTracker() {
  const [latest, setLatest] = useState<SleepLog | null>(null);
  const [recentLogs, setRecentLogs] = useState<SleepLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Evening date context (recalculated on mount)
  const [eveningDate] = useState(getEveningDate);

  // Timeline positions (0–1)
  const [startPos, setStartPos] = useState(() => defaultStartPos(eveningDate));
  const [endPos, setEndPos] = useState(() => defaultEndPos(eveningDate));

  // Quality & notes
  const [quality, setQuality] = useState(7);
  const [notes, setNotes] = useState('');

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);

  // Drag state
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);
  const didDragRef = useRef(false);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Derived dates
  const sleepStartDate = useMemo(() => positionToDate(eveningDate, startPos), [eveningDate, startPos]);
  const sleepEndDate = useMemo(() => positionToDate(eveningDate, endPos), [eveningDate, endPos]);

  // ── Load ────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [latestData, logs] = await Promise.all([
        getLatestSleepLog(),
        getSleepLogs(7),
      ]);
      setLatest(latestData);
      setRecentLogs(logs.slice(0, 5));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sleep data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Submit ───────────────────────────────────────────────────────

  function populateForm(log: SleepLog) {
    const startDate = new Date(log.sleep_start);
    const ev = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    setStartPos(dateToPosition(startDate, ev));
    setEndPos(dateToPosition(new Date(log.sleep_end), ev));
    setQuality(log.quality);
    setNotes(log.notes);
    setEditingId(log.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setQuality(7);
    setNotes('');
    setStartPos(defaultStartPos(eveningDate));
    setEndPos(defaultEndPos(eveningDate));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        sleep_start: sleepStartDate.toISOString(),
        sleep_end: sleepEndDate.toISOString(),
        quality,
        notes,
      };

      if (editingId) {
        const ok = await updateSleepLog(editingId, payload);
        if (!ok) {
          setError('Failed to update sleep log');
          return;
        }
        setSuccess('Sleep updated ✓');
        cancelEdit();
      } else {
        const result = await insertSleepLog(payload);
        if (!result.data) {
          if (result.error) {
            setError(result.error);
          } else {
            setError('Not signed in — data cannot be saved. Authentication is required to write to Supabase.');
          }
          return;
        }
        setSuccess('Sleep logged ✓');
        setNotes('');
        setQuality(7);
      }
      setTimeout(() => setSuccess(null), 2500);
      notifyHealthDataSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sleep log');
    } finally {
      setSaving(false);
    }
  }

  // ── Drag / pointer handlers ─────────────────────────────────────

  const snapPosition = useCallback((raw: number, node: 'start' | 'end'): number => {
    // Round to nearest 5 minutes for a cleaner UX
    const minutes = raw * TOTAL_MINUTES;
    const snapped = Math.round(minutes / 5) * 5;
    let clamped = snapped / TOTAL_MINUTES;
    clamped = Math.max(0, Math.min(1, clamped));

    if (node === 'start') return Math.min(clamped, endPos - 1 / TOTAL_MINUTES);
    return Math.max(clamped, startPos + 1 / TOTAL_MINUTES);
  }, [startPos, endPos]);

  const handlePointerDown = (node: 'start' | 'end') => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(node);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !timelineRef.current) return;
    didDragRef.current = true;
    const rect = timelineRef.current.getBoundingClientRect();
    const raw = (e.clientX - rect.left) / rect.width;
    const pos = snapPosition(raw, dragging);
    if (dragging === 'start') setStartPos(pos);
    else setEndPos(pos);
  };

  const handlePointerUp = () => {
    setDragging(null);
    // Reset didDrag after a tick so the click handler can read it
    setTimeout(() => { didDragRef.current = false; }, 0);
  };

  // ── Timeline click (jump node) ──────────────────────────────────

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragging || didDragRef.current) return;
    const rect = timelineRef.current!.getBoundingClientRect();
    const raw = (e.clientX - rect.left) / rect.width;

    // Move whichever node is closer to the click point
    const distToStart = Math.abs(raw - startPos);
    const distToEnd = Math.abs(raw - endPos);
    const node = distToStart <= distToEnd ? 'start' : 'end';
    const pos = snapPosition(raw, node);
    if (node === 'start') setStartPos(pos);
    else setEndPos(pos);
  };

  // ── Render helpers ──────────────────────────────────────────────

  // Left/right percentages for the filled bar
  const barLeft = `${Math.min(startPos, endPos) * 100}%`;
  const barWidth = `${Math.abs(endPos - startPos) * 100}%`;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 select-none">
      {/* Header */}
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-sm dark:bg-indigo-900/40">
          🌙
        </span>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sleep</h3>
      </div>

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p className="mb-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
          {success}
        </p>
      )}

      {/* Latest sleep summary (reference only) */}
      {latest && !loading && (
        <div className="mb-4 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Last sleep</span>
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {fmtTime(new Date(latest.sleep_start))} – {fmtTime(new Date(latest.sleep_end))}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between">
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {fmtDuration(new Date(latest.sleep_start), new Date(latest.sleep_end))}
            </span>
            <span className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              Quality: {latest.quality}/10
            </span>
          </div>
        </div>
      )}

      {/* ─── Timeline ──────────────────────────────────────────── */}
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {nightOfLabel(eveningDate)}
          </p>

          {/* Timeline track */}
          <div
            ref={timelineRef}
            className="relative h-12 w-full cursor-pointer touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onClick={handleTimelineClick}
          >
            {/* Track background */}
            <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-zinc-100 dark:bg-zinc-800" />

            {/* Filled sleep bar */}
            <div
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-indigo-300 dark:bg-indigo-600/60"
              style={{ left: barLeft, width: barWidth }}
            />

            {/* Hour tick marks */}
            {HOUR_LABELS.map((h, i) => {
              const pct = (i / (HOUR_LABELS.length - 1)) * 100;
              const isMidnight = h === 0 || h === 24;
              const label = h === 0 ? '0' : h === 24 ? '0' : String(h);
              return (
                <div
                  key={`tick-${i}`}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pct}%` }}
                >
                  <div className={`mx-auto h-1.5 w-px ${isMidnight ? 'bg-zinc-300 dark:bg-zinc-600' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
                </div>
              );
            })}

            {/* Start node */}
            <div
              className={`absolute top-1/2 z-10 -translate-y-1/2 -translate-x-1/2 transition-[left] ${
                dragging === 'start' ? 'duration-0' : 'duration-150'
              }`}
              style={{ left: `${startPos * 100}%` }}
            >
              <div
                className={`flex h-5 w-5 cursor-grab items-center justify-center rounded-full border-2 bg-white shadow-md transition-shadow active:cursor-grabbing ${
                  dragging === 'start'
                    ? 'border-indigo-500 shadow-lg ring-2 ring-indigo-200 dark:ring-indigo-800'
                    : 'border-indigo-400 hover:shadow-lg'
                } dark:bg-zinc-900`}
                onPointerDown={handlePointerDown('start')}
              >
                <div className="h-2 w-2 rounded-full bg-indigo-500" />
              </div>
            </div>

            {/* End node */}
            <div
              className={`absolute top-1/2 z-10 -translate-y-1/2 -translate-x-1/2 transition-[left] ${
                dragging === 'end' ? 'duration-0' : 'duration-150'
              }`}
              style={{ left: `${endPos * 100}%` }}
            >
              <div
                className={`flex h-5 w-5 cursor-grab items-center justify-center rounded-full border-2 bg-white shadow-md transition-shadow active:cursor-grabbing ${
                  dragging === 'end'
                    ? 'border-indigo-500 shadow-lg ring-2 ring-indigo-200 dark:ring-indigo-800'
                    : 'border-indigo-400 hover:shadow-lg'
                } dark:bg-zinc-900`}
                onPointerDown={handlePointerDown('end')}
              >
                <div className="h-2 w-2 rounded-full bg-indigo-500" />
              </div>
            </div>
          </div>

          {/* Hour labels */}
          <div className="relative mt-1 h-4">
            {HOUR_LABELS.map((h, i) => {
              const pct = (i / (HOUR_LABELS.length - 1)) * 100;
              const label = h === 0 ? '00' : h === 24 ? '00' : String(h).padStart(2, '0');
              const isMidnight = h === 0 || h === 24;
              return (
                <span
                  key={`label-${i}`}
                  className={`absolute -translate-x-1/2 text-[10px] ${
                    isMidnight
                      ? 'font-medium text-zinc-400 dark:text-zinc-500'
                      : 'text-zinc-300 dark:text-zinc-600'
                  }`}
                  style={{ left: `${pct}%` }}
                >
                  {label}
                </span>
              );
            })}
          </div>
        </div>

        {/* Time & duration display */}
        <div className="mb-4 flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
          <div className="text-center">
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">Start</p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {fmtTime(sleepStartDate)}
            </p>
          </div>
          <div className="flex flex-col items-center">
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">Duration</p>
            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {fmtDuration(sleepStartDate, sleepEndDate)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500">End</p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {fmtTime(sleepEndDate)}
            </p>
          </div>
        </div>

        {/* Quality slider */}
        <div className="mb-3">
          <label className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span>Quality</span>
            <span className="text-indigo-600 dark:text-indigo-400">{quality}/10</span>
          </label>
          <input
            type="range"
            min={1}
            max={10}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-indigo-500 dark:bg-zinc-700"
          />
        </div>

        {/* Notes */}
        <div className="mb-3">
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-2">
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className={`flex-1 rounded-lg py-2 text-xs font-medium text-white transition-colors disabled:opacity-50 ${
              editingId
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {saving ? 'Saving...' : editingId ? 'Update Sleep' : 'Log Sleep'}
          </button>
        </div>
      </form>

      {/* Recent logs — 'Night of {date-1}' format */}
      {recentLogs.length > 0 && (
        <div className="mt-4 space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Recent
          </p>
          {recentLogs.map((log) => {
            const startDate = new Date(log.sleep_start);
            const endDate = new Date(log.sleep_end);
            // The "evening date" is the day the sleep started
            const evDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            return (
              <div
                key={log.id}
                onClick={() => populateForm(log)}
                className={`flex cursor-pointer items-center justify-between rounded-md px-2 py-1 text-xs transition-colors ${
                  editingId === log.id
                    ? 'bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-950/20 dark:ring-amber-700'
                    : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50'
                }`}
              >
                <span>{nightOfLabel(evDate)}</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {fmtTime(startDate)} – {fmtTime(endDate)} · Q{log.quality}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-500" />
        </div>
      )}
    </div>
  );
}
