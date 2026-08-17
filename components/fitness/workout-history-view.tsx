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
 * WorkoutHistoryView — full chronological history with pagination.
 *
 * Stage 5 §16 — "remain fast even as the number of workouts
 * increases; do not load unnecessary amounts of data into the browser
 * at once."
 *
 * Strategy:
 *   - One paged query for workout ids + start_time + title.
 *   - One batched query for exercise ids under the page, then one for
 *     sets under those exercises, then join in memory.
 *   - User can search the loaded slice by title.
 */
export default function WorkoutHistoryView({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  const loadPage = useCallback(async (p: number): Promise<void> => {
    setLoading(true);
    const from = p * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: workoutRows, error } = await supabase
      .from('hevy_workouts')
      .select('id, title, start_time, source_start_time')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .range(from, to);
    if (error || !workoutRows) {
      setHasMore(false);
      setLoading(false);
      return;
    }
    const ids = workoutRows.map((w) => (w as { id: string }).id);
    let exCount = new Map<string, number>();
    let setCount = new Map<string, number>();
    let vol = new Map<string, number>();
    if (ids.length > 0) {
      const { data: exRows } = await supabase
        .from('hevy_workout_exercises')
        .select('id, workout_id')
        .eq('user_id', userId)
        .in('workout_id', ids);
      const exById = ((exRows ?? []) as Array<{
        id: string;
        workout_id: string;
      }>);
      exCount = new Map<string, number>();
      const exIds: string[] = [];
      for (const e of exById) {
        exIds.push(e.id);
        exCount.set(e.workout_id, (exCount.get(e.workout_id) ?? 0) + 1);
      }
      if (exIds.length > 0) {
        const { data: setRows, error: setErr } = await supabase
          .from('hevy_workout_sets')
          .select('workout_exercise_id, weight_kg, reps')
          .eq('user_id', userId)
          .in('workout_exercise_id', exIds);
        if (!setErr) {
          const exToWorkout = new Map(
            exById.map((e) => [e.id, e.workout_id]),
          );
          setCount = new Map<string, number>();
          vol = new Map<string, number>();
          for (const s of ((setRows ?? []) as Array<{
            workout_exercise_id: string;
            weight_kg: number | null;
            reps: number | null;
          }>)) {
            const wid = exToWorkout.get(s.workout_exercise_id);
            if (!wid) continue;
            setCount.set(wid, (setCount.get(wid) ?? 0) + 1);
            if (s.weight_kg !== null && s.reps !== null) {
              vol.set(wid, (vol.get(wid) ?? 0) + s.weight_kg * s.reps);
            }
          }
        }
      }
    }
    const list: Row[] = workoutRows.map((w) => {
      const x = w as {
        id: string;
        title: string | null;
        start_time: string | null;
        source_start_time: string;
      };
      return {
        id: x.id,
        title: x.title,
        startISO: x.start_time ?? x.source_start_time,
        exerciseCount: exCount.get(x.id) ?? 0,
        setCount: setCount.get(x.id) ?? 0,
        totalVolumeKg: vol.get(x.id) ?? 0,
      };
    });
    setRows((prev) => (p === 0 ? list : [...prev, ...list]));
    setHasMore(workoutRows.length === PAGE_SIZE);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void loadPage(0);
  }, [loadPage]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.title ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/fitness"
        className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← Overview
      </Link>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Workouts
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
            History
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            Newest first. Paginated at {PAGE_SIZE} workouts / page.
          </p>
        </div>
        <div className="w-full sm:w-72">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title…"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </div>
      </header>

      <ul className="divide-y divide-zinc-800/40 rounded-2xl border border-zinc-800/40 bg-zinc-950/30">
        {filtered.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-zinc-500">
            {rows.length === 0
              ? 'No workouts yet — import a Hevy export in Manage Data.'
              : 'No matches for that filter.'}
          </li>
        ) : (
          filtered.map((w) => (
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

      {hasMore && (
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              const next = page + 1;
              setPage(next);
              void loadPage(next);
            }}
            disabled={loading}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      <div className="mt-2 text-center text-[10px] text-zinc-600">
        Showing {rows.length} workout{rows.length === 1 ? '' : 's'}.
      </div>
    </div>
  );
}
