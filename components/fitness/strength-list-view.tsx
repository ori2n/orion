'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import type { ExerciseSummary, HevyCalculations } from '@/lib/fitness/hevy/calculations';
import { fmtKg, fmtLongDate, fmtRelativeDate } from '@/lib/fitness/format';

// `recharts` is ~300 KB — load the featured progression charts lazily.
const ExerciseProgressionChart = dynamic(
  () => import('@/components/fitness/charts/exercise-progression-chart'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
        Loading chart…
      </div>
    ),
  },
);

/**
 * StrengthListView — full exercise list with metric chips.
 *
 * Stage 5 §6: the dashboard only shows the top-4 lifts; this page
 * shows everything. Cards can be filtered by muscle.
 *
 * Each card presents:
 *   - PR              (heaviest weight ever lifted — the only PR)
 *   - Estimated 1RM   (deterministic Epley, separate from PR)
 *   - Manual 1RM      (if the user entered one)
 *   - Last trained    (relative date)
 *   - Total sets      (career volume indicator)
 */

export default function StrengthListView({ calcs }: { calcs: HevyCalculations }) {
  const [view, setView] = useState<'featured' | 'all'>('featured');
  const [filter, setFilter] = useState<string>('All');

  const muscles = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const e of calcs.exercises) {
      if (e.muscle) set.add(e.muscle);
    }
    return [...set];
  }, [calcs]);

  const filtered = useMemo(() => {
    if (filter === 'All') return calcs.exercises;
    return calcs.exercises.filter((e) => e.muscle === filter);
  }, [calcs.exercises, filter]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Strength
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
            Exercises
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            PR is the heaviest weight ever lifted. Estimated 1RM is a
            display metric, never a PR.
          </p>
        </div>
        {/* Featured / All switch — the concise dashboard vs the full
            library. Default is the featured dashboard. */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <button
            onClick={() => setView('featured')}
            className={
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
              (view === 'featured'
                ? 'bg-zinc-800/70 text-zinc-100 ring-1 ring-zinc-700/60'
                : 'text-zinc-500 hover:text-zinc-200')
            }
          >
            Overview
          </button>
          <button
            onClick={() => setView('all')}
            className={
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
              (view === 'all'
                ? 'bg-zinc-800/70 text-zinc-100 ring-1 ring-zinc-700/60'
                : 'text-zinc-500 hover:text-zinc-200')
            }
          >
            All
          </button>
        </div>
      </header>

      {view === 'featured' ? (
        <FeaturedDashboard exercises={calcs.exercises} />
      ) : (
        <>
          {/* Muscle filter pills */}
          <div className="mb-5 flex gap-1.5 overflow-x-auto pb-1">
            {muscles.map((m) => {
              const active = filter === m;
              return (
                <button
                  key={m}
                  onClick={() => setFilter(m)}
                  className={
                    'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ' +
                    (active
                      ? 'bg-zinc-800/70 text-zinc-100 ring-1 ring-zinc-700/60'
                      : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200')
                  }
                >
                  {m}
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-10 text-center text-sm text-zinc-400">
              No exercises yet — import a Hevy export in Manage Data.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((ex) => (
                <li key={ex.name}>
                  <Link
                    href={`/fitness/strength/${encodeURIComponent(ex.name)}`}
                    className="group block rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          {ex.muscle ?? 'Unmapped'}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-sm font-medium text-zinc-100 group-hover:text-white">
                          {ex.name}
                        </div>
                      </div>
                      <span className="shrink-0 text-zinc-500 group-hover:text-zinc-200">
                        →
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      <Row label="PR (heaviest)">
                        <span className="font-mono text-zinc-100">
                          {fmtKg(ex.heaviestWeightKg, true)}
                        </span>
                      </Row>
                      <Row label="Estimated 1RM">
                        <span className="font-mono text-rose-300">
                          {fmtKg(ex.estimated1rmKg, true)}
                        </span>
                      </Row>
                      <Row label="Manual 1RM">
                        {ex.manual1rmKg !== null ? (
                          <span className="font-mono text-zinc-100">
                            {fmtKg(ex.manual1rmKg, true)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </Row>
                      <Row label="Sets">
                        <span className="font-mono text-zinc-200">
                          {ex.totalSets}
                        </span>
                      </Row>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
                      <span>Last: {fmtRelativeDate(ex.lastTrained)}</span>
                      {ex.firstTrained && (
                        <span className="hidden sm:inline">
                          Since {fmtLongDate(ex.firstTrained)}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ─── Featured dashboard (default view) ─────────────────────────────

/** The four featured exercises, in display order. */
const FEATURED_EXERCISES = [
  'Incline Chest Press',
  'Dumbbell Shoulder Press',
  'Lat Pulldown',
  'Isolateral Row',
] as const;

/**
 * Fuzzy matcher for the featured names: exact match, then normalized
 * containment, then word-based match (every word of the featured name
 * must appear in the exercise name, e.g. "Incline Dumbbell Bench" →
 * "Incline Bench Press (Dumbbell)"). Word matches prefer the shortest
 * name so "Lat Pulldown" picks the canonical entry, not a variant.
 */
function findFeatured(
  exercises: ExerciseSummary[],
  target: string,
): ExerciseSummary | null {
  const exact = exercises.find(
    (e) => e.name.toLowerCase() === target.toLowerCase(),
  );
  if (exact) return exact;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const t = norm(target);
  const contains = exercises.find((e) => {
    const n = norm(e.name);
    return n.includes(t) || t.includes(n);
  });
  if (contains) return contains;
  const words = target
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  const wordMatches = exercises.filter((e) => {
    const n = norm(e.name);
    return words.every((w) => n.includes(w));
  });
  if (wordMatches.length === 0) return null;
  return wordMatches.reduce((a, b) => (b.name.length < a.name.length ? b : a));
}

/**
 * Exercise categories on the Rank screen. Clicking one opens an
 * in-page modal listing every mapped exercise in the category — no
 * routing. (The per-muscle drill-down pages 404 for muscles with no
 * training data yet, so category browsing must not depend on them.)
 */
const EXERCISE_GROUPS: Array<{
  label: string;
  /** Canonical muscles included in the category. */
  muscles: string[];
  blurb: string;
}> = [
  {
    label: 'Chest',
    muscles: ['Chest'],
    blurb: 'Presses, flies and push-ups.',
  },
  {
    label: 'Back',
    muscles: ['Upper Back', 'Lats', 'Lower Back'],
    blurb: 'Rows, pulldowns and extensions.',
  },
  {
    label: 'Shoulders & Arms',
    muscles: ['Shoulders', 'Biceps', 'Triceps', 'Traps'],
    blurb: 'Deltoids, curls, presses and pushdowns.',
  },
  {
    label: 'Legs',
    muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
    blurb: 'Squats, hinges, extensions and raises.',
  },
];

function FeaturedDashboard({ exercises }: { exercises: ExerciseSummary[] }) {
  /** Open category modal (label), or null when the Rank screen is clean. */
  const [category, setCategory] = useState<string | null>(null);
  const featured = useMemo(
    () =>
      FEATURED_EXERCISES.map((name) => ({
        name,
        summary: findFeatured(exercises, name),
      })),
    [exercises],
  );
  const groups = useMemo(
    () =>
      EXERCISE_GROUPS.map((g) => ({
        ...g,
        count: exercises.filter(
          (e) => e.muscle !== null && g.muscles.includes(e.muscle),
        ).length,
      })),
    [exercises],
  );

  if (exercises.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-10 text-center text-sm text-zinc-400">
        No exercises yet — import a Hevy export in Manage Data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Featured four — compact cards with inline progression graph */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-zinc-100">
          Featured exercises
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {featured.map(({ name, summary }) => (
            <FeaturedExerciseCard
              key={name}
              name={name}
              summary={summary}
            />
          ))}
        </div>
      </section>

      {/* Exercise categories — clicking opens the in-page modal (no
          routing: the per-muscle pages 404 without training data). */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-zinc-100">
          Browse by category
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {groups.map((g) => (
            <button
              key={g.label}
              type="button"
              onClick={() => setCategory(g.label)}
              className="group rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-zinc-100 group-hover:text-white">
                  {g.label}
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {g.count}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">{g.blurb}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Category exercise list — modal over the Rank screen. */}
      {category && (
        <CategoryModal
          label={category}
          group={EXERCISE_GROUPS.find((g) => g.label === category)!}
          exercises={exercises}
          onClose={() => setCategory(null)}
        />
      )}
    </div>
  );
}

// ─── Category modal (in-page exercise browser) ───────────────────

/**
 * CategoryModal — lists every exercise in a category inside a modal
 * over the Rank screen. Rows deep-link to the existing per-exercise
 * drill-down pages, so each entry opens its real Rank data and
 * progression graph. Pure in-memory filtering of the summaries the
 * page already computed — no extra fetching, no duplicate data.
 */
function CategoryModal({
  label,
  group,
  exercises,
  onClose,
}: {
  label: string;
  group: (typeof EXERCISE_GROUPS)[number];
  exercises: ExerciseSummary[];
  onClose: () => void;
}) {
  const rows = useMemo(
    () =>
      exercises
        .filter((e) => e.muscle !== null && group.muscles.includes(e.muscle))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [exercises, group],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} exercises`}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 sm:rounded-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {label}
            </div>
            <h3 className="mt-0.5 text-base font-semibold tracking-tight text-zinc-100">
              Exercises
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {rows.length} exercise{rows.length === 1 ? '' : 's'} · tap one for its
              progression graph
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Back to Rank screen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">
              No exercises logged in {label} yet — import a Hevy export in
              Manage Data to populate this category.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-2">
              {rows.map((ex) => (
                <li key={ex.name}>
                  <Link
                    href={`/fitness/strength/${encodeURIComponent(ex.name)}`}
                    className="group flex items-center justify-between gap-2 rounded-lg border border-zinc-800/40 bg-zinc-900/40 px-3 py-2 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
                  >
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm font-medium text-zinc-100 group-hover:text-white">
                        {ex.name}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {ex.muscle} · Last: {fmtRelativeDate(ex.lastTrained)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm text-zinc-100">
                        {fmtKg(ex.heaviestWeightKg, true)}
                      </div>
                      <div className="text-[9px] text-zinc-500">PR</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact featured-exercise card: header stats + inline best-set
 * progression graph (same data the drill-down page plots, trimmed to
 * the last 12 workouts so the card stays short).
 */
function FeaturedExerciseCard({
  name,
  summary,
}: {
  name: string;
  summary: ExerciseSummary | null;
}) {
  const [series, setSeries] = useState<
    Array<{ dateLabel: string; heaviest: number | null; est1rm: number | null }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!summary) {
      setLoaded(true);
      return;
    }
    (async () => {
      const points = await fetchExerciseProgression(summary.name, 12);
      if (cancelled) return;
      setSeries(points);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [summary]);

  const href = summary
    ? `/fitness/strength/${encodeURIComponent(summary.name)}`
    : '/fitness/strength/all';

  return (
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {summary?.muscle ?? 'Not in data'}
          </div>
          <Link
            href={href}
            className="mt-0.5 line-clamp-1 text-sm font-medium text-zinc-100 hover:text-white"
          >
            {summary?.name ?? name}
          </Link>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-lg text-zinc-50">
            {summary ? fmtKg(summary.heaviestWeightKg, false) : '—'}
          </div>
          <div className="text-[10px] text-zinc-500">kg PR</div>
        </div>
      </div>
      <div className="mt-2 h-28">
        {loaded ? (
          series.length >= 2 ? (
            <ExerciseProgressionChart series={series} />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
              {summary ? 'Not enough sessions for a trend yet' : 'No data for this exercise yet'}
            </div>
          )
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-zinc-600">
            Loading…
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-500">
        <span>
          est 1RM{' '}
          <span className="font-mono text-zinc-300">
            {summary ? fmtKg(summary.estimated1rmKg) : '—'}
          </span>
        </span>
        <Link
          href={href}
          className="transition-colors hover:text-zinc-200"
        >
          Details →
        </Link>
      </div>
    </div>
  );
}

/**
 * Best-set-per-workout progression for one exercise — same query shape
 * as the drill-down page, trimmed to the most recent `limit` workouts.
 */
async function fetchExerciseProgression(
  exerciseName: string,
  limit: number,
): Promise<
  Array<{ dateLabel: string; heaviest: number | null; est1rm: number | null }>
> {
  const { getCurrentUserId } = await import('@/lib/auth');
  const { supabase } = await import('@/lib/supabase');
  const { estimate1RM } = await import('@/lib/fitness/hevy/calc');
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const { data: exRows } = await supabase
    .from('hevy_workout_exercises')
    .select('id, workout_id')
    .eq('user_id', userId)
    .eq('name', exerciseName);
  const matching = ((exRows ?? []) as Array<{
    id: string;
    workout_id: string;
  }>);
  const ids = matching.map((e) => e.id);
  if (ids.length === 0) return [];

  const [{ data: setRows }, { data: workoutRows }] = await Promise.all([
    supabase
      .from('hevy_workout_sets')
      .select('weight_kg, reps, workout_exercise_id')
      .eq('user_id', userId)
      .in('workout_exercise_id', ids),
    supabase
      .from('hevy_workouts')
      .select('id, start_time')
      .eq('user_id', userId)
      .in(
        'id',
        [...new Set(matching.map((m) => m.workout_id))],
      ),
  ]);

  const startTime = new Map<string, string | null>();
  for (const w of ((workoutRows ?? []) as Array<{
    id: string;
    start_time: string | null;
  }>)) {
    startTime.set(w.id, w.start_time);
  }

  // Best set (heaviest) per workout.
  const bestByWorkout = new Map<string, { kg: number | null; reps: number | null }>();
  for (const s of ((setRows ?? []) as Array<{
    weight_kg: number | null;
    reps: number | null;
    workout_exercise_id: string;
  }>)) {
    const wid = matching.find((m) => m.id === s.workout_exercise_id)?.workout_id;
    if (!wid) continue;
    const prev = bestByWorkout.get(wid);
    if (
      !prev ||
      ((s.weight_kg ?? 0) > (prev.kg ?? 0))
    ) {
      bestByWorkout.set(wid, { kg: s.weight_kg, reps: s.reps });
    }
  }

  return [...bestByWorkout.entries()]
    .map(([wid, best]) => {
      const start = startTime.get(wid) ?? null;
      const d = start ? new Date(start) : null;
      return {
        dateLabel: d ? d.toISOString().slice(0, 10) : wid.slice(0, 8),
        heaviest: best.kg,
        est1rm:
          best.kg !== null
            ? estimate1RM(best.kg, best.reps)
            : null,
      };
    })
    .sort((a, b) => a.dateLabel.localeCompare(b.dateLabel))
    .slice(-limit);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-zinc-500">{label}</span>
      <span>{children}</span>
    </div>
  );
}
