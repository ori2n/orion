'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import type { ExerciseSummary } from '@/lib/fitness/hevy/calculations';
import { fmtKg, fmtLongDate, fmtRelativeDate } from '@/lib/fitness/format';

/**
 * ExerciseDetailView — full drill-down for a single exercise.
 *
 * Shows:
 *   - PR (heaviest kg ever lifted)        — prominently.
 *   - Estimated 1RM                      — diagnostic Epley metric.
 *   - Manual 1RM                          — user-entered value (if any).
 *   - Progression: best-set-per-workout line chart.
 *   - Per-workout set list (chronological, preserved from Hevy).
 *
 * Stage 5 §9 — drill into the actual imported data; do not fabricate.
 */

interface BestSetWorkout {
  workoutId: string;
  workoutStart: string | null;
  workoutTitle: string | null;
  sets: Array<{
    weightKg: number | null;
    reps: number | null;
  }>;
}

export default function ExerciseDetailView({
  summary,
}: {
  summary: ExerciseSummary;
}) {
  const [bestSets, setBestSets] = useState<BestSetWorkout[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data: exRows } = await supabase
        .from('hevy_workout_exercises')
        .select('id, workout_id, name')
        .eq('user_id', userId);
      const matching = ((exRows ?? []) as Array<{
        id: string;
        workout_id: string;
        name: string;
      }>).filter((e) => e.name === summary.name);
      const ids = matching.map((e) => e.id);
      let sets: Array<{ weightKg: number | null; reps: number | null; workout_exercise_id: string }> = [];
      if (ids.length > 0) {
        const { data: setRows } = await supabase
          .from('hevy_workout_sets')
          .select('weight_kg, reps, workout_exercise_id')
          .eq('user_id', userId)
          .in('workout_exercise_id', ids)
          .order('set_index', { ascending: true });
        sets = ((setRows ?? []) as Array<{
          weight_kg: number | null;
          reps: number | null;
          workout_exercise_id: string;
        }>).map((r) => ({
          weightKg: r.weight_kg,
          reps: r.reps,
          workout_exercise_id: r.workout_exercise_id,
        }));
      }

      // Group by workout + collect each set under its workout.
      const byEx = new Map<string, Array<{ weightKg: number | null; reps: number | null }>>();
      for (const ex of matching) byEx.set(ex.id, []);
      for (const s of sets) {
        const arr = byEx.get(s.workout_exercise_id);
        if (arr) arr.push({ weightKg: s.weightKg, reps: s.reps });
      }
      const exToWorkout = new Map<string, string>();
      for (const m of matching) exToWorkout.set(m.id, m.workout_id);

      const workoutIds = [...new Set(matching.map((m) => m.workout_id))];
      const wMap = new Map<string, { startTime: string | null; title: string | null }>();
      if (workoutIds.length > 0) {
        const { data: workoutRows } = await supabase
          .from('hevy_workouts')
          .select('id, start_time, title')
          .eq('user_id', userId)
          .in('id', workoutIds);
        for (const w of ((workoutRows ?? []) as Array<{
          id: string;
          start_time: string | null;
          title: string | null;
        }>)) {
          wMap.set(w.id, { startTime: w.start_time, title: w.title });
        }
      }

      // Merge: one row per (workout_id, exercise component) so the user
      // sees each block separately (e.g. flat-bench + incline-bench).
      const grouped = new Map<string, BestSetWorkout>();
      for (const ex of matching) {
        const setsHere = byEx.get(ex.id) ?? [];
        const wid = ex.workout_id;
        const w = wMap.get(wid);
        const key = `${wid}-${ex.id}`;
        grouped.set(key, {
          workoutId: wid,
          workoutStart: w?.startTime ?? null,
          workoutTitle: w?.title ?? null,
          sets: setsHere,
        });
      }
      const list = [...grouped.values()].sort((a, b) => {
        const aDate = a.workoutStart ? new Date(a.workoutStart).getTime() : 0;
        const bDate = b.workoutStart ? new Date(b.workoutStart).getTime() : 0;
        return bDate - aDate;
      });
      if (cancelled) return;
      setBestSets(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [summary.name]);

  const series = useMemo(
    () =>
      bestSets
        .map((b) => {
          const heaviest = b.sets.reduce<number | null>(
            (best, s) =>
              s.weightKg !== null && (best === null || s.weightKg > best)
                ? s.weightKg
                : best,
            null,
          );
          const est = b.sets.reduce<number | null>((best, s) => {
            if (s.weightKg === null || s.reps === null) return best;
            const r = Math.min(s.reps, 10);
            const v = s.weightKg * (1 + r / 30);
            if (best === null || v > best) return Math.round(v * 10) / 10;
            return best;
          }, null);
          return {
            dateISO: b.workoutStart,
            dateLabel: b.workoutStart
              ? b.workoutStart.slice(0, 10)
              : 'unknown',
            heaviest,
            est1rm: est,
          };
        })
        .sort((a, b) => (a.dateISO ?? '').localeCompare(b.dateISO ?? '')),
    [bestSets],
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/fitness/strength"
        className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← All exercises
      </Link>
      <header className="mb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Exercise drill-down
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
          {summary.name}
        </h1>
        {summary.muscle && (
          <p className="mt-1 text-xs text-zinc-500">{summary.muscle}</p>
        )}
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="PR (heaviest)"
          value={fmtKg(summary.heaviestWeightKg, true)}
          tone="primary"
          hint="Highest actual weight ever lifted. This is the PR."
        />
        <Stat
          label="Estimated 1RM"
          value={fmtKg(summary.estimated1rmKg, true)}
          tone="secondary"
          hint="Calculated deterministically from set data. Display only."
        />
        <Stat
          label="Manual 1RM"
          value={
            summary.manual1rmKg !== null
              ? fmtKg(summary.manual1rmKg, true)
              : '—'
          }
          hint="User-entered value. Never overwritten by estimated 1RM."
        />
        <Stat
          label="Total sets"
          value={String(summary.totalSets)}
          hint={`First: ${fmtLongDate(summary.firstTrained)} · Last: ${fmtRelativeDate(summary.lastTrained)}`}
        />
      </div>

      <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-2 flex items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Progression</h2>
            <p className="text-[11px] text-zinc-500">
              Best set per workout (heaviest weight + estimated 1RM)
            </p>
          </div>
        </header>
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          </div>
        ) : series.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-zinc-500">
            No data points yet.
          </div>
        ) : (
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="dateLabel"
                  tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => fmtLongDate(l as string)}
                  formatter={(v, n) => [
                    fmtKg(typeof v === 'number' ? v : Number(v), true),
                    n === 'heaviest' ? 'PR (kg)' : 'Est 1RM (kg)',
                  ]}
                />
                <Line
                  dataKey="est1rm"
                  stroke="#f43f5e"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="heaviest"
                  stroke="#e4e4e7"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-2">
          <h2 className="text-sm font-semibold text-zinc-100">Workout history</h2>
          <p className="text-[11px] text-zinc-500">
            Every imported workout that contained this exercise — sets
            preserved exactly as captured from Hevy.
          </p>
        </header>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          </div>
        ) : bestSets.length === 0 ? (
          <div className="text-xs text-zinc-500">No recorded sets yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {bestSets.map((b, idx) => (
              <li key={`${b.workoutId}-${idx}`} className="py-3">
                <Link
                  href={`/fitness/workouts/${b.workoutId}`}
                  className="block transition-colors hover:bg-zinc-900/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-zinc-100">
                        {b.workoutTitle ?? 'Workout'}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {fmtLongDate(b.workoutStart)}
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-zinc-400">
                      {b.sets.length} sets
                    </div>
                  </div>
                </Link>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-300">
                  {b.sets.map((s, i) => (
                    <span key={i}>
                      {i + 1}:{' '}
                      {s.weightKg !== null
                        ? `${fmtKg(s.weightKg)} kg × ${s.reps ?? '?'}`
                        : `${s.reps ?? '?'} reps`}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'primary' | 'secondary';
}) {
  return (
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-4 py-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div
        className={
          'mt-0.5 font-mono text-base ' +
          (tone === 'primary'
            ? 'text-zinc-50'
            : tone === 'secondary'
              ? 'text-rose-300'
              : 'text-zinc-100')
        }
      >
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">{hint}</div>
      )}
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  color: '#e4e4e7',
  fontSize: 11,
};
