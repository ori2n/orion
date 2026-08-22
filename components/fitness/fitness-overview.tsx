'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import type {
  HevyCalculations,
  ExerciseSummary,
  MuscleSummary,
} from '@/lib/fitness/hevy/calc';
import { listWeightEntries, getWeightTarget } from '@/lib/fitness/weight';
import {
  listPhysiquePhotos,
  pickFeaturedPhoto,
  pickLatestPinnedCover,
  type HydratedPhoto,
} from '@/lib/fitness/physique';
import { listHevyWorkouts } from '@/lib/fitness/hevy/history';
import type { WeightEntry, WeightTarget } from '@/lib/fitness/types';

// `recharts` is ~300 KB — load it lazily so the dashboard shell and
// stats paint before the chart downloads.
const BodyweightTrendChart = dynamic(
  () => import('@/components/fitness/charts/bodyweight-trend-chart'),
  {
    ssr: false,
    loading: () => <ChartLoading />,
  },
);

function ChartLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
      Loading chart…
    </div>
  );
}
import {
  fmtKg,
  fmtLongDate,
  fmtRelativeDate,
  twelveWeekMovingAverage,
} from '@/lib/fitness/format';

/**
 * FitnessOverview — the polished Stage 5 dashboard.
 *
 * Information hierarchy (from Stage 5 §24):
 *   1. Overall current state  — Hero strip (most prominent numbers).
 *   2. Bodyweight + 12w MA chart + latest measurement.
 *   3. Key strength summary  — Bench / Squat / Shoulder Press cards
 *      (PLUS the configured "pinned" exercises — UI lives on Strength
 *      page; here we surface the top 4 lifts by heaviest weight).
 *   4. Muscle frequency grid — statuses ("On target" / "Below target").
 *   5. Latest physique photo  — starred / cover image.
 *   6. Three latest workouts  — name + relative date + set count.
 *   7. Deeper navigation      — links into the full pages.
 *
 * Desktop target: a 2-column dashboard that uses the screen width.
 * Mobile: stacking of sections in the priority order above; touch
 * targets sized for thumbs; charts remain readable.
 *
 * Performance:
 *   - All data fetched in parallel on mount; the heavyweight
 *     `computeHevyCalculations` runs once.
 *   - The 3 most-recent workouts are fetched via `listHevyWorkouts(3)`
 *     so we never pull the full history.
 *   - No recalculation on re-renders (everything memoised).
 */

interface DashboardData {
  calcs: HevyCalculations;
  photos: HydratedPhoto[];
  latestPhoto: HydratedPhoto | null;
  weights: WeightEntry[];
  weightTarget: WeightTarget | null;
  recentWorkouts: Array<{
    id: string;
    title: string | null;
    startISO: string;
    exerciseCount: number;
    setCount: number;
  }>;
}

export default function FitnessOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }
      // The dashboard only renders the newest cover photo — fetch the
      // newest 24 rows so we never sign URLs for (or download) the whole
      // library. `hasAny` stays correct as long as at least one exists.
      const [calcs, weights, weightTarget, photos, recent] = await Promise.all([
        computeHevyCalculations(userId),
        listWeightEntries(userId),
        getWeightTarget(userId),
        listPhysiquePhotos(userId, { limit: 24 }),
        listHevyWorkouts(userId, 3),
      ]);
      if (cancelled) return;

      // Best-cover selection: pinned cover of latest session, falling
      // back to starred/featured photo, falling back to first row.
      const latest =
        pickLatestPinnedCover(photos) ?? pickFeaturedPhoto(photos) ?? null;

      // Recent workouts: 1 query for the exercise ids of the 3 most-
      // recent workouts, 1 query for the matching sets, then bucket
      // the counts in memory. Bound the dashboard load to TWO small
      // reads regardless of how many workouts exist.
      const recentIds = recent.map((w) => w.id);
      const exerciseCountByWorkout = new Map<string, number>();
      const exIdToWorkout = new Map<string, string>();
      const setCountByWorkout = new Map<string, number>();
      if (recentIds.length > 0) {
        const { data: exRows } = await supabase
          .from('hevy_workout_exercises')
          .select('id, workout_id')
          .eq('user_id', userId)
          .in('workout_id', recentIds);
        const exIds: string[] = [];
        for (const row of ((exRows ?? []) as Array<{
          id: string;
          workout_id: string;
        }>)) {
          exIds.push(row.id);
          exIdToWorkout.set(row.id, row.workout_id);
          exerciseCountByWorkout.set(
            row.workout_id,
            (exerciseCountByWorkout.get(row.workout_id) ?? 0) + 1,
          );
        }
        if (exIds.length > 0) {
          const { data: setRows } = await supabase
            .from('hevy_workout_sets')
            .select('workout_exercise_id')
            .eq('user_id', userId)
            .in('workout_exercise_id', exIds);
          for (const s of ((setRows ?? []) as Array<{
            workout_exercise_id: string;
          }>)) {
            const wid = exIdToWorkout.get(s.workout_exercise_id);
            if (!wid) continue;
            setCountByWorkout.set(wid, (setCountByWorkout.get(wid) ?? 0) + 1);
          }
        }
      }
      const summaries = recent.map((w) => ({
        id: w.id,
        title: w.title,
        startISO: w.start_time ?? w.source_start_time,
        exerciseCount: exerciseCountByWorkout.get(w.id) ?? 0,
        setCount: setCountByWorkout.get(w.id) ?? 0,
      }));
      if (cancelled) return;

      setData({
        calcs,
        photos,
        latestPhoto: latest,
        weights,
        weightTarget,
        recentWorkouts: summaries,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          <span className="text-xs text-zinc-500">Loading fitness data…</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hero = buildHeroStats(data);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ─── 1. Hero strip — overall current state ────────────── */}
      <HeroStrip stats={hero} />

      {/* ─── 2. Bodyweight + 12-week MA ─────────────────────── */}
      <Section label="Bodyweight" sublabel="Current + 12-week moving average">
        <BodyweightPanel
          weights={data.weights}
          target={data.weightTarget}
        />
      </Section>

      {/* ─── 3. Strength overview ───────────────────────────── */}
      <Section label="Strength" sublabel="Heavy weights + estimated 1RM">
        <StrengthPanel calcs={data.calcs} />
      </Section>

      {/* ─── 4. Muscle frequency grid ───────────────────────── */}
      <Section
        label="Training frequency"
        sublabel="Last 4 weeks vs your target"
      >
        <MuscleGrid muscles={data.calcs.muscles} />
      </Section>

      {/* ─── 5. + 6. Side-by-side (desktop); stack on mobile ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Section
          label="Latest physique"
          sublabel="Pinned cover photo"
          className="lg:col-span-2"
        >
          <PhysiquePanel photo={data.latestPhoto} hasAny={data.photos.length > 0} />
        </Section>
        <Section
          label="Recent workouts"
          sublabel="Last 3 imported sessions"
          className="lg:col-span-3"
        >
          <RecentWorkoutsList workouts={data.recentWorkouts} />
        </Section>
      </div>

      {/* ─── 7. Deeper navigation ──────────────────────────── */}
      <Section label="Deeper analytics" sublabel="Browse the full dataset">
        <DeepAnalyticsGrid calcs={data.calcs} />
      </Section>
    </div>
  );
}

// ─── 1. Hero strip ────────────────────────────────────────────────

interface HeroStats {
  currentWeight: number | null;
  bodyweightDelta4w: number | null;
  totalSessions: number;
  totalExercises: number;
  heavierThan4wAgo: number | null;
}

function buildHeroStats(d: DashboardData): HeroStats {
  const sortedWeights = [...d.weights].sort((a, b) =>
    a.recorded_at.localeCompare(b.recorded_at),
  );
  const current = sortedWeights.length > 0
    ? sortedWeights[sortedWeights.length - 1].weight_kg
    : null;
  // Pick the entry from 4±1 weeks ago for the comparison.
  let delta: number | null = null;
  if (current !== null && sortedWeights.length >= 2) {
    const now = new Date(sortedWeights[sortedWeights.length - 1].recorded_at);
    const pastIdx = findClosestIndex(
      sortedWeights,
      new Date(now.getTime() - 28 * 86_400_000),
    );
    if (pastIdx >= 0 && pastIdx < sortedWeights.length - 1) {
      delta = Math.round((current - sortedWeights[pastIdx].weight_kg) * 10) / 10;
    }
  }
  return {
    currentWeight: current,
    bodyweightDelta4w: delta,
    totalSessions: d.calcs.weekly.reduce((n, w) => n + w.sessions, 0),
    totalExercises: d.calcs.exercises.length,
    heavierThan4wAgo: null, // placeholder; reserved for future hero
  };
}

function HeroStrip({ stats }: { stats: HeroStats }) {
  return (
    <div className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/40 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Current state
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {stats.currentWeight !== null
              ? <>You&apos;re at <span className="text-rose-300">{fmtKg(stats.currentWeight, true)}</span></>
              : <>Bodyweight not logged yet</>}
          </div>
          {stats.bodyweightDelta4w !== null && (
            <div className="mt-1 text-xs text-zinc-400">
              {stats.bodyweightDelta4w > 0 ? '+' : ''}
              {fmtKg(stats.bodyweightDelta4w)} vs 4 weeks ago
            </div>
          )}
        </div>
        <div className="hidden grid-cols-2 gap-3 sm:grid">
          <HeroStat
            label="Workouts"
            value={stats.totalSessions.toLocaleString()}
          />
          <HeroStat
            label="Exercises"
            value={stats.totalExercises.toLocaleString()}
          />
        </div>
      </div>
      {/* mobile quick stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:hidden">
        <HeroStat label="Workouts" value={stats.totalSessions.toLocaleString()} />
        <HeroStat label="Exercises" value={stats.totalExercises.toLocaleString()} />
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-4 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base text-zinc-100">{value}</div>
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────────────

function Section({
  label,
  sublabel,
  children,
  className = '',
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        'mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5 ' +
        className
      }
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            {label}
          </h2>
          {sublabel && (
            <p className="text-[11px] text-zinc-500">{sublabel}</p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

// ─── 2. Bodyweight panel ───────────────────────────────────────────

function BodyweightPanel({
  weights,
  target,
}: {
  weights: WeightEntry[];
  target: WeightTarget | null;
}) {
  const sortedAsc = useMemo(
    () => [...weights].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
    [weights],
  );
  const maSeries = useMemo(
    () =>
      twelveWeekMovingAverage(
        sortedAsc.map((w) => ({
          date: w.recorded_at.slice(0, 10),
          value: w.weight_kg,
        })),
      ),
    [sortedAsc],
  );

  if (sortedAsc.length === 0) {
    return (
      <EmptyHint
        title="No bodyweight entries"
        body="Log your current weight on the Bodyweight page to see the trend."
        ctaHref="/fitness/bodyweight"
        ctaLabel="Log weight"
      />
    );
  }

  // Trim to last ~26 weeks for the chart (still readable on mobile).
  const chartSeries = maSeries.slice(-26).map((p) => ({
    week: p.weekEndIso,
    ma: p.ma,
    raw: p.raw,
  }));
  const current = sortedAsc[sortedAsc.length - 1];
  const currentMa = maSeries[maSeries.length - 1]?.ma ?? null;

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <PillStat
          label="Current"
          value={fmtKg(current.weight_kg, true)}
        />
        <PillStat
          label="12w avg"
          value={currentMa !== null ? fmtKg(currentMa, true) : '—'}
        />
        <PillStat
          label={target ? 'Target' : 'No target'}
          value={target ? fmtKg(target.target_kg, true) : '—'}
        />
        <PillStat
          label="Entries"
          value={String(sortedAsc.length)}
          className="hidden sm:block"
        />
      </div>
      <div className="h-44 sm:h-48">
        <BodyweightTrendChart
          series={chartSeries}
          targetKg={target?.target_kg ?? null}
          targetLabel={!!target}
        />
      </div>
      <div className="mt-2 text-[11px] text-zinc-500">
        <Link href="/fitness/bodyweight" className="hover:text-zinc-200">
          Full history → Bodyweight
        </Link>
      </div>
    </div>
  );
}

// ─── 3. Strength panel ─────────────────────────────────────────────

const PINNED_EXERCISE_KEYS = [
  'Bench Press (Barbell)',
  'Squat (Barbell)',
  'Overhead Press (Barbell)',
];

function StrengthPanel({ calcs }: { calcs: HevyCalculations }) {
  if (calcs.exercises.length === 0) {
    return (
      <EmptyHint
        title="No Hevy workout data"
        body="Import your Hevy export in Manage Data to populate strength metrics."
        ctaHref="/fitness/manage"
        ctaLabel="Open Manage Data"
      />
    );
  }

  // Pinned exercises first (Bench / Squat / OHP), then top-by-heaviest
  // up to a total of 4 cards.
  const seen = new Set<string>();
  const pinned: ExerciseSummary[] = [];
  for (const key of PINNED_EXERCISE_KEYS) {
    const ex = calcs.exercises.find((e) => e.name === key);
    if (ex && !seen.has(ex.name)) {
      pinned.push(ex);
      seen.add(ex.name);
    }
  }
  const topByHeaviest = [...calcs.exercises]
    .filter((e) => e.heaviestWeightKg !== null)
    .sort(
      (a, b) =>
        (b.heaviestWeightKg ?? 0) - (a.heaviestWeightKg ?? 0),
    )
    .filter((e) => !seen.has(e.name))
    .slice(0, Math.max(0, 4 - pinned.length));
  const cards = [...pinned, ...topByHeaviest];

  if (cards.length === 0) {
    return (
      <EmptyHint
        title="No weight data yet"
        body="No exercises have a recorded heaviest weight yet — re-import your Hevy export."
        ctaHref="/fitness/manage"
        ctaLabel="Open Manage Data"
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((ex) => (
        <Link
          key={ex.name}
          href={`/fitness/strength/${encodeURIComponent(ex.name)}`}
          className="group flex flex-col rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
        >
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {ex.muscle ?? 'Unmapped'}
          </div>
          <div className="mt-0.5 line-clamp-2 text-sm font-medium text-zinc-100">
            {ex.name}
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <div className="font-mono text-xl text-zinc-50">
              {fmtKg(ex.heaviestWeightKg, false)}
            </div>
            <div className="text-[10px] text-zinc-500">kg PR</div>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
            <div>
              <span className="font-mono text-zinc-300">
                {fmtKg(ex.estimated1rmKg)}
              </span>{' '}
              kg est
            </div>
            <div>
              {ex.manual1rmKg !== null ? (
                <>
                  <span className="font-mono text-zinc-300">
                    {fmtKg(ex.manual1rmKg)}
                  </span>{' '}
                  kg man
                </>
              ) : (
                <span className="text-zinc-600">no manual 1RM</span>
              )}
            </div>
          </div>
        </Link>
      ))}
      <Link
        href="/fitness/strength"
        className="flex items-center justify-center rounded-xl border border-dashed border-zinc-800/60 px-3 py-3 text-xs text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
      >
        All exercises →
      </Link>
    </div>
  );
}

// ─── 4. Muscle grid ────────────────────────────────────────────────

function MuscleGrid({ muscles }: { muscles: MuscleSummary[] }) {
  if (muscles.length === 0) {
    return (
      <EmptyHint
        title="No muscle data"
        body="Muscle-frequency badges appear once your Hevy import lands with mapped exercises."
        ctaHref="/fitness/manage"
        ctaLabel="Open Manage Data"
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {muscles.map((m) => (
        <Link
          key={m.muscle}
          href={`/fitness/muscles/${encodeURIComponent(m.muscle)}`}
          className="group flex items-center justify-between rounded-xl border border-zinc-800/40 bg-zinc-950/30 px-3 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
        >
          <div>
            <div className="text-sm font-medium text-zinc-100">{m.muscle}</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">
              {fmtKg(m.actualSessionsPerWeekLast4 ?? 0)}×/wk · target{' '}
              {fmtKg(m.targetSessionsPerWeek)}×
            </div>
          </div>
          <StatusBadge status={m.onTarget} />
        </Link>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: MuscleSummary['onTarget'] }) {
  if (status === 'on') {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
        On target
      </span>
    );
  }
  if (status === 'below') {
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        Below
      </span>
    );
  }
  if (status === 'above') {
    return (
      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
        Above
      </span>
    );
  }
  return (
    <span className="rounded-full bg-zinc-800/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      —
    </span>
  );
}

// ─── 5. Physique panel ─────────────────────────────────────────────

function PhysiquePanel({
  photo,
  hasAny,
}: {
  photo: HydratedPhoto | null;
  hasAny: boolean;
}) {
  if (!photo) {
    return (
      <EmptyHint
        title={hasAny ? 'No pinned cover yet' : 'No progress photos'}
        body={
          hasAny
            ? 'Open the Physique gallery to star a photo as the album cover.'
            : 'Upload a progress session and star one photo as the cover.'
        }
        ctaHref="/fitness/bodyweight"
        ctaLabel="Open Bodyweight"
      />
    );
  }
  return (
    <Link
      href="/fitness/bodyweight"
      className="group block overflow-hidden rounded-xl border border-zinc-800/40 bg-zinc-950/40 transition-colors hover:border-zinc-700"
    >
      <div className="relative aspect-[4/5] w-full bg-zinc-900 sm:aspect-[3/4]">
        {photo.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={`Latest progress — ${photo.taken_at}`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
            loading…
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <div className="text-[10px] uppercase tracking-wider text-zinc-300">
            {photo.pose_type ?? 'Photo'}
          </div>
          <div className="text-sm font-semibold text-white">
            {photo.session_title ?? 'Untitled session'}
          </div>
          <div className="font-mono text-[11px] text-zinc-300">
            {photo.taken_at}
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── 6. Recent workouts ────────────────────────────────────────────

function RecentWorkoutsList({
  workouts,
}: {
  workouts: DashboardData['recentWorkouts'];
}) {
  if (workouts.length === 0) {
    return (
      <EmptyHint
        title="No workouts imported"
        body="Strictly deterministic — workouts appear once Hevy data lands."
        ctaHref="/fitness/manage"
        ctaLabel="Import Hevy"
      />
    );
  }
  return (
    <ul className="divide-y divide-zinc-800/40">
      {workouts.map((w) => (
        <li key={w.id}>
          <Link
            href={`/fitness/workouts/${w.id}`}
            className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-zinc-900/40"
          >
            <div>
              <div className="text-sm font-medium text-zinc-100">
                {w.title ?? 'Workout'}
              </div>
              <div className="mt-0.5 flex gap-2 text-[11px] text-zinc-500">
                <span>{fmtRelativeDate(w.startISO)}</span>
                <span>·</span>
                <span>{w.exerciseCount} ex</span>
                <span>·</span>
                <span>{w.setCount} sets</span>
              </div>
            </div>
            <span className="text-zinc-500 transition-colors hover:text-zinc-200">
              →
            </span>
          </Link>
        </li>
      ))}
      <li className="pt-3">
        <Link
          href="/fitness/workouts"
          className="text-xs text-zinc-400 transition-colors hover:text-zinc-200"
        >
          View all workouts →
        </Link>
      </li>
    </ul>
  );
}

// ─── 7. Deeper analytics grid ──────────────────────────────────────

function DeepAnalyticsGrid({ calcs }: { calcs: HevyCalculations }) {
  const total = calcs.totalVolumeKg;
  const sessions = calcs.weekly.reduce((n, w) => n + w.sessions, 0);
  const recentSessionIdx = calcs.weekly.length - 1;
  const recentWeekly = recentSessionIdx >= 0 ? calcs.weekly[recentSessionIdx] : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <DeepLink
        href="/fitness/strength"
        label="Strength"
        detail={`${calcs.exercises.length} exercises`}
      />
      <DeepLink
        href="/fitness/workouts"
        label="Workouts"
        detail={`${sessions} sessions`}
      />
      <DeepLink
        href={`/fitness/strength/${encodeURIComponent(calcs.exercises[0]?.name ?? '')}`}
        label="Drill into exercise"
        detail={calcs.exercises[0]?.name ?? '—'}
        disabled={!calcs.exercises[0]?.name}
      />
      <DeepLink
        href="/fitness/manage"
        label="Manage Data"
        detail="Hevy import + targets"
      />
      {/* Snapshot stat strip */}
      <div className="col-span-2 mt-1 rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 sm:col-span-4">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-zinc-400">
          <span>
            Total volume:{' '}
            <span className="font-mono text-zinc-200">
              {fmtKg(total, true)}
            </span>
          </span>
          <span>
            Total sets:{' '}
            <span className="font-mono text-zinc-200">
              {calcs.totalSets.toLocaleString()}
            </span>
          </span>
          {recentWeekly && (
            <span>
              Latest week:{' '}
              <span className="font-mono text-zinc-200">
                {recentWeekly.sessions} sessions · {recentWeekly.sets} sets
              </span>
            </span>
          )}
          {calcs.unmappedExercises.length > 0 && (
            <span className="text-amber-300">
              {calcs.unmappedExercises.length} unmapped exercise name(s)
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DeepLink({
  href,
  label,
  detail,
  disabled,
}: {
  href: string;
  label: string;
  detail: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="flex flex-col rounded-xl border border-zinc-800/40 bg-zinc-950/30 px-3 py-2.5 opacity-50">
        <div className="text-sm font-medium text-zinc-100">{label}</div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-500">{detail}</div>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-3 py-2.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
    >
      <div className="text-sm font-medium text-zinc-100 group-hover:text-white">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-zinc-500">{detail}</div>
    </Link>
  );
}

// ─── Misc helpers ──────────────────────────────────────────────────

function PillStat({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={
        'rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 ' +
        className
      }
    >
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

function EmptyHint({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-[11px] text-zinc-500">{body}</p>
      <Link
        href={ctaHref}
        className="mt-3 inline-block rounded-md bg-zinc-800/60 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700/60"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

/** Index of the entry whose `recorded_at` is closest to `target`. */
function findClosestIndex(
  sorted: WeightEntry[],
  target: Date,
): number {
  let bestIdx = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const t = new Date(sorted[i].recorded_at).getTime();
    const diff = Math.abs(t - target.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }
  return bestIdx;
}
