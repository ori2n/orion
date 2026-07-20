'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  listSleepEntries,
  createSleepEntry,
  deleteSleepEntry,
  averageHours,
  computeHours,
} from '@/lib/fitness/sleep';
import { logEvent, EventTypes } from '@/lib/events';
import type { SleepEntry } from '@/lib/fitness/types';

/**
 * SleepTracking — actionable sleep logging.
 *
 * Two surfaces, sharing the same height budget:
 *
 *   - **Confirmation card**: rendered after a successful save. Shows
 *     today's logged hours, bedtime → wake, and two actions
 *     ([Edit] returns to the form, [View history] expands the recent
 *     list inline).
 *
 *   - **Entry form**: the actual inputs. Shown by default until the
 *     first save, and re-shown whenever the user clicks Edit.
 *
 * The "Recent entries" list sits beneath the form / confirmation and
 * is always available — the confirmation card's "View history" button
 * just scrolls to the list so power users can jump straight to it.
 */
export default function SleepTracking({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [entries, setEntries] = useState<SleepEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(() => todayISO());
  const [bedtime, setBedtime] = useState('23:00');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [quality, setQuality] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirmation state — non-null when today's date has been logged.
  // `mode` controls whether the form or the confirmation card shows.
  const [mode, setMode] = useState<'form' | 'confirmation'>('form');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await listSleepEntries(userId);
      if (cancelled) return;
      setEntries(data);
      setLoading(false);

      // Decide initial mode: if today's date already has an entry, jump
      // straight into the confirmation card; otherwise show the form.
      const todayMatch = data.find((e) => e.sleep_date === todayISO());
      if (todayMatch) {
        hydrateFromEntry(todayMatch);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshKey]);

  const avg = useMemo(() => averageHours(entries.slice(0, 7)), [entries]);

  const previewHours = useMemo(
    () => computeHours(toISO(date, bedtime), toISO(date, wakeTime)),
    [date, bedtime, wakeTime],
  );

  function hydrateFromEntry(entry: SleepEntry) {
    setMode('confirmation');
    setDate(entry.sleep_date);
    setBedtime(toHHMM(entry.bedtime));
    setWakeTime(toHHMM(entry.wake_time));
    setQuality(entry.quality);
    setNotes(entry.notes ?? '');
  }

  async function handleSave() {
    if (saving) return;
    setError(null);
    const bedtimeISO = toISO(date, bedtime);
    const wakeTimeISO = toISO(date, wakeTime);
    if (previewHours <= 0) {
      setError('Wake time must be after bedtime.');
      return;
    }
    setSaving(true);
    const created = await createSleepEntry({
      user_id: userId,
      sleep_date: date,
      bedtime: bedtimeISO,
      wake_time: applyWakeDate(wakeTimeISO, bedtimeISO),
      quality,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!created) {
      setError('Failed to save entry.');
      return;
    }
    // Background event for the future AI pipeline.
    void logEvent(EventTypes.SLEEP_LOG, {
      sleep_date: date,
      bedtime: bedtimeISO,
      wake_time: applyWakeDate(wakeTimeISO, bedtimeISO),
      hours: previewHours,
    });
    onSaved();
  }

  async function handleDelete(id: string) {
    const ok = await deleteSleepEntry(id);
    if (!ok) {
      setError('Failed to delete entry.');
      return;
    }
    onSaved();
  }

  function startEdit() {
    setMode('form');
    setError(null);
  }

  function viewHistory() {
    // Scroll the recent list into view — works even when collapsed
    // (the list itself never collapses, but anchoring the scroll
    // gives a satisfying tactile feedback).
    const list = document.getElementById('sleep-history-list');
    list?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Average tile (always visible — context for both modes) */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-indigo-400/70">
          7-day average
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight text-zinc-100">
            {avg !== null ? `${avg.toFixed(1)}h` : '—'}
          </span>
          <span className="text-xs text-zinc-500">
            {entries.length === 0 ? 'No entries yet' : `across last ${Math.min(entries.length, 7)}`}
          </span>
        </div>
      </div>

      {mode === 'form' ? (
        /* Form mode */
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">Log sleep</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={todayISO()}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                Bedtime
              </label>
              <input
                type="time"
                value={bedtime}
                onChange={(e) => setBedtime(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                Wake time
              </label>
              <input
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                Quality
              </label>
              <select
                value={quality ?? ''}
                onChange={(e) => setQuality(e.target.value ? Number(e.target.value) : null)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
              >
                <option value="">—</option>
                <option value="1">1 · terrible</option>
                <option value="2">2 · poor</option>
                <option value="3">3 · ok</option>
                <option value="4">4 · good</option>
                <option value="5">5 · great</option>
              </select>
            </div>
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Notes (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. woke up twice"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-zinc-800/60 pt-4">
            <span className="text-xs text-zinc-500">
              {previewHours > 0 ? `Computes to ${previewHours.toFixed(1)}h` : 'Invalid range'}
            </span>
            <button
              onClick={handleSave}
              disabled={saving || previewHours <= 0}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        /* Confirmation mode */
        <SleepConfirmationCard
          hours={previewHours}
          bedtimeLabel={formatTime(bedtime)}
          wakeLabel={formatTime(wakeTime)}
          date={date}
          quality={quality}
          onEdit={startEdit}
          onViewHistory={viewHistory}
        />
      )}

      {/* Recent list */}
      <div
        id="sleep-history-list"
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm"
      >
        <h3 className="mb-3 text-sm font-semibold text-zinc-100">Recent entries</h3>
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
            Log your first night above to start tracking.
          </p>
        ) : (
          <div className="space-y-2">
            {entries.slice(0, 14).map((e) => (
              <div
                key={e.id}
                className="group flex items-center justify-between rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-4 py-3 transition-colors hover:bg-zinc-900/60"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm text-zinc-200">
                    <span className="font-mono text-base font-semibold">
                      {e.hours.toFixed(1)}h
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(e.bedtime).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      →{' '}
                      {new Date(e.wake_time).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    {e.sleep_date}
                    {e.quality && ` · quality ${e.quality}/5`}
                    {e.notes && ` · ${e.notes}`}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(e.id)}
                  className="text-[10px] font-medium text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Confirmation surface ──────────────────────────────────────

function SleepConfirmationCard({
  hours,
  bedtimeLabel,
  wakeLabel,
  date,
  quality,
  onEdit,
  onViewHistory,
}: {
  hours: number;
  bedtimeLabel: string;
  wakeLabel: string;
  date: string;
  quality: number | null;
  onEdit: () => void;
  onViewHistory: () => void;
}) {
  const isShort = hours > 0 && hours < 6;
  return (
    <div
      className="rounded-2xl border border-emerald-700/30 bg-emerald-950/15 p-5 shadow-sm backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <TickIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400/80">
            Sleep logged
          </div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-zinc-100">
            {hours.toFixed(0)}h {Math.round((hours % 1) * 60)
              .toString()
              .padStart(2, '0')}
            m
          </div>
          <div className="mt-1 font-mono text-sm text-zinc-300">
            {bedtimeLabel} → {wakeLabel}
          </div>
          <div className="mt-3 text-sm text-zinc-400">
            {isShort
              ? 'Short night — log it and forget it.'
              : 'Well done.'}
            {quality && (
              <span className="ml-1 text-zinc-500">· quality {quality}/5</span>
            )}
            {!quality && (
              <span className="ml-1 text-zinc-600">· {date}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-emerald-800/30 pt-4">
        <button
          onClick={onEdit}
          className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
        >
          Edit
        </button>
        <button
          onClick={onViewHistory}
          className="rounded-lg border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200"
        >
          View history
        </button>
      </div>
    </div>
  );
}

function TickIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

// ─── Time helpers ──────────────────────────────────────────────

function toISO(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

function applyWakeDate(wakeISO: string, bedtimeISO: string): string {
  const wake = new Date(wakeISO);
  const bed = new Date(bedtimeISO);
  if (wake.getTime() <= bed.getTime()) {
    wake.setDate(wake.getDate() + 1);
  }
  return wake.toISOString();
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatTime(hhmm: string): string {
  // Display "23:18" as "23:18" — locale string adds a space we'd rather avoid.
  return hhmm;
}
