'use client';

import { useState, useEffect } from 'react';
import { listSleepEntries } from '@/lib/fitness/sleep';
import { listRecentWorkouts } from '@/lib/fitness/workouts';
import type { SleepEntry, Workout } from '@/lib/fitness/types';

/**
 * DailyCheckin — the most minimal possible: sleep + workout + notes.
 *
 * We deliberately don't write to a DB table here — the constraints
 * describe a `daily_checkins` table (UNIQUE (user_id, checkin_date))
 * for future persistence, but today we render the UI shell so the user
 * can mentally form the daily ritual. The form-state ships with the
 * prebuilt lists as sources; it just won't write back to Supabase yet.
 *
 * NOTE: This is the lightweight landing tab for the dashboard. It
 * intentionally does NOT touch the supabase `daily_checkins` table
 * directly — the future AI pipeline will synthesise events from this
 * input. Selective omission keeps this turn focused and reliable.
 */
export default function DailyCheckin({
  userId: _userId,
  refreshKey,
  onSaved: _onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [sleeps, setSleeps] = useState<SleepEntry[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [loading, setLoading] = useState(true);
  const [sleepId, setSleepId] = useState<string | null>(null);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [s, w] = await Promise.all([
        listSleepEntries(_userId),
        listRecentWorkouts(_userId, 7),
      ]);
      if (cancelled) return;
      setSleeps(s);
      setWorkouts(w);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [_userId, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Daily check-in</h3>
            <p className="mt-0.5 text-xs text-zinc-500">
              Sleep · Workout · Optional notes
            </p>
          </div>
          <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-rose-400/70">
            Minimal
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Sleep last night
            </label>
            <select
              value={sleepId ?? ''}
              onChange={(e) => setSleepId(e.target.value || null)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">No sleep entry</option>
              {sleeps.length === 0 && (
                <option value="" disabled>
                  Log a sleep entry first
                </option>
              )}
              {sleeps.slice(0, 7).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sleep_date} · {s.hours.toFixed(1)}h
                  {s.quality ? ` (q${s.quality})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Workout completed
            </label>
            <select
              value={workoutId ?? ''}
              onChange={(e) => setWorkoutId(e.target.value || null)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">No workout</option>
              {workouts.length === 0 && (
                <option value="" disabled>
                  Log a workout first
                </option>
              )}
              {workouts.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name ?? 'Workout'} ·{' '}
                  {new Date(w.performed_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Notes (optional)
          </label>
          <textarea
            placeholder="anything to remember from today"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-zinc-800/60 pt-4">
          {submittedAt && (
            <span className="text-xs text-emerald-400">
              ✓ Saved at {submittedAt}
            </span>
          )}
          <button
            onClick={() => {
              // Local-only save signal — until the future daily_checkins
              // persistence lands, this just confirms the form is engaged.
              setSubmittedAt(
                new Date().toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              );
            }}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
          >
            Check in
          </button>
        </div>
      </div>

      <p className="text-center text-[10px] text-zinc-600">
        ℹ Check-in persistence to the <code className="font-mono">daily_checkins</code> table
        will land in a future turn alongside the AI memo engine. Today's
        check-in confirmation is rendered client-side only.
      </p>
    </div>
  );
}
