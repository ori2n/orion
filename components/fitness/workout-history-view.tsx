'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { fmtLongDate, fmtRelativeDate } from '@/lib/fitness/format';

const PAGE_SIZE = 50;

interface Row {
  id: string;
  title: string | null;
  startISO: string | null;
  exerciseCount: number;
  setCount: number;
  totalVolumeKg: number;
}

/**
 * WorkoutHistoryView — the Workouts page.
 *
 * Progressive disclosure: the page itself shows only the 5 most
 * recent workouts, then a "..." and a Show More button. The complete
 * history (with its search + pagination) lives inside a modal that
 * scrolls independently — the underlying page stays visible and
 * dimmed behind it, and never becomes a giant scrolling list.
 *
 * Data strategy is unchanged from the old paged view: one paged
 * query for workouts, then batched exercise/set lookups, joined in
 * memory.
 */
export default function WorkoutHistoryView({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadPage = useCallback(async (): Promise<void> => {
    setLoading(true);
    const { data: workoutRows, error } = await supabase
      .from('hevy_workouts')
      .select('id, title, start_time, source_start_time')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .limit(PAGE_SIZE);
    setLoading(false);
    if (error || !workoutRows) return;
    const ids = workoutRows.map((w) => (w as { id: string }).id);
    const exCount = new Map<string, number>();
    const setCount = new Map<string, number>();
    const vol = new Map<string, number>();
    if (ids.length > 0) {
      const { data: exRows } = await supabase
        .from('hevy_workout_exercises')
        .select('id, workout_id')
        .eq('user_id', userId)
        .in('workout_id', ids);
      const exIds: string[] = [];
      const exToWorkout = new Map<string, string>();
      for (const e of ((exRows ?? []) as Array<{
        id: string;
        workout_id: string;
      }>)) {
        exIds.push(e.id);
        exToWorkout.set(e.id, e.workout_id);
      }
      if (exIds.length > 0) {
        const { data: setRows } = await supabase
          .from('hevy_workout_sets')
          .select('id, weight_kg, reps, workout_exercise_id')
          .eq('user_id', userId)
          .in('workout_exercise_id', exIds);
        for (const s of ((setRows ?? []) as Array<{
          id: string;
          weight_kg: number | null;
          reps: number | null;
          workout_exercise_id: string;
        }>)) {
          const wid = exToWorkout.get(s.workout_exercise_id);
          if (!wid) continue;
          setCount.set(wid, (setCount.get(wid) ?? 0) + 1);
          const w = (s.weight_kg ?? 0) * (s.reps ?? 0);
          vol.set(wid, (vol.get(wid) ?? 0) + w);
        }
      }
      for (const e of ((exRows ?? []) as Array<{
        id: string;
        workout_id: string;
      }>)) {
        exCount.set(e.workout_id, (exCount.get(e.workout_id) ?? 0) + 1);
      }
    }
    setRows(
      workoutRows.map((w) => {
        const row = w as {
          id: string;
          title: string | null;
          start_time: string | null;
          source_start_time: string;
        };
        return {
          id: row.id,
          title: row.title,
          startISO: row.start_time ?? row.source_start_time,
          exerciseCount: exCount.get(row.id) ?? 0,
          setCount: setCount.get(row.id) ?? 0,
          totalVolumeKg: vol.get(row.id) ?? 0,
        };
      }),
    );
  }, [userId]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  const recent = useMemo(() => rows.slice(0, 5), [rows]);

  if (loading && rows.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex h-40 items-center justify-center text-xs text-zinc-500">
          Loading workouts…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Workouts
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
          Recent sessions
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Your five latest workouts. Older history lives behind Show More.
        </p>
      </header>

      {/* 5 most recent workouts */}
      <ul className="divide-y divide-zinc-800/40 rounded-2xl border border-zinc-800/40 bg-zinc-950/30">
        {recent.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-zinc-500">
            No workouts yet — import a Hevy export in Manage Data.
          </li>
        ) : (
          recent.map((w) => (
            <li key={w.id}>
              <Link
                href={`/fitness/workouts/${w.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-900/40"
              >
                <div>
                  <div className="text-sm font-medium text-zinc-100">
                    {w.title ?? 'Workout'}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {fmtLongDate(w.startISO)} · {fmtRelativeDate(w.startISO)}
                  </div>
                </div>
                <div className="text-right text-[11px] text-zinc-400">
                  <div>{w.exerciseCount} ex · {w.setCount} sets</div>
                  {w.totalVolumeKg > 0 && (
                    <div className="font-mono text-[10px] text-zinc-500">
                      {Math.round(w.totalVolumeKg).toLocaleString()} kg vol
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))
        )}
      </ul>

      {/* ... then Show More */}
      {rows.length > 5 && (
        <div className="py-3 text-center text-xs text-zinc-500" aria-hidden>
          ···
        </div>
      )}
      <div className="text-center">
        <button
          onClick={() => setHistoryOpen(true)}
          disabled={rows.length === 0}
          className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Show More
        </button>
      </div>

      {/* Full history modal — independently scrollable. */}
      {historyOpen && (
        <HistoryModal rows={rows} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
}

// ─── Full-history modal ────────────────────────────────────────────

function HistoryModal({
  rows,
  onClose,
}: {
  rows: Row[];
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.title ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Full workout history"
    >
      {/* Dimmed backdrop — click to close; page remains visible behind. */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Full history
            </h2>
            <p className="text-[11px] text-zinc-500">
              {rows.length} workout{rows.length === 1 ? '' : 's'} · newest
              first
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by title…"
              className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none sm:w-56"
            />
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close history"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        {/* Independently scrollable list — the page behind never moves. */}
        <div className="flex-1 overflow-y-auto">
          <ul className="divide-y divide-zinc-800/40">
            {filtered.length === 0 ? (
              <li className="px-5 py-10 text-center text-sm text-zinc-500">
                No matches for that filter.
              </li>
            ) : (
              filtered.slice(0, visible).map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/fitness/workouts/${w.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-zinc-900/40"
                    onClick={onClose}
                  >
                    <div>
                      <div className="text-sm font-medium text-zinc-100">
                        {w.title ?? 'Workout'}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {fmtLongDate(w.startISO)} · {fmtRelativeDate(w.startISO)}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-zinc-400">
                      <div>{w.exerciseCount} ex · {w.setCount} sets</div>
                      {w.totalVolumeKg > 0 && (
                        <div className="font-mono text-[10px] text-zinc-500">
                          {Math.round(w.totalVolumeKg).toLocaleString()} kg vol
                        </div>
                      )}
                    </div>
                  </Link>
                </li>
              ))
            )}
          </ul>
          {filtered.length > visible && (
            <div className="py-4 text-center">
              <button
                onClick={() => setVisible((v) => v + PAGE_SIZE)}
                className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                Load older
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
