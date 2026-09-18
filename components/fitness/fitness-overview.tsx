'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth';
import { listWeightEntries, getWeightTarget } from '@/lib/fitness/weight';
import {
  listPhysiquePhotos,
  groupPhotosIntoSessions,
  type HydratedPhoto,
} from '@/lib/fitness/physique';
import { listWeeklyWorkoutCounts } from '@/lib/fitness/hevy/weekly-workouts';
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
const WeeklyWorkoutsChart = dynamic(
  () => import('@/components/fitness/charts/weekly-workouts-chart'),
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
import { twelveWeekMovingAverage } from '@/lib/fitness/format';

/**
 * FitnessOverview — the cleaned-up dashboard.
 *
 * Information hierarchy:
 *   1. Analytics row — Bodyweight (left half) + weekly workout
 *      frequency bars (right half), stacked on mobile.
 *   2. Latest physique — newest session cover featured left, the
 *      covers of the six previous distinct sessions (a real timeline)
 *      as small square snapshots in a 2 × 3 grid on the right.
 *
 * Navigation lives in the shared Browse module owned by the fitness
 * layout; this page renders no navigation of its own.
 *
 * Performance:
 *   - Data fetched in parallel on mount.
 *   - The physique fetch is bounded to the newest 80 rows so we can
 *     resolve the latest sessions' covers without downloading the
 *     whole library.
 *   - The weekly-workout chart reads one bounded query.
 */

interface DashboardData {
  photos: HydratedPhoto[];
  latestSession: {
    cover: HydratedPhoto;
    photoCount: number;
    title: string | null;
  } | null;
  weights: WeightEntry[];
  weightTarget: WeightTarget | null;
  weeklyWorkouts: Awaited<ReturnType<typeof listWeeklyWorkoutCounts>>;
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
      const [weights, weightTarget, photos, weeklyWorkouts] = await Promise.all([
        listWeightEntries(userId),
        getWeightTarget(userId),
        listPhysiquePhotos(userId, { limit: 80 }),
        listWeeklyWorkoutCounts(userId, 12),
      ]);
      if (cancelled) return;

      // Session view: the newest session's cover is the featured image;
      // the snapshots are the covers of the six PREVIOUS distinct
      // sessions, so the strip is a genuine timeline across entries
      // (never six photos of the same day).
      const sessions = groupPhotosIntoSessions(photos);
      const latestSession = sessions[0]
        ? {
            cover: sessions[0].cover_photo as HydratedPhoto,
            photoCount: sessions[0].count,
            title: sessions[0].title,
          }
        : null;
      const previousCovers = sessions
        .slice(1, 7)
        .map((s) => s.cover_photo)
        .filter((p): p is HydratedPhoto => p !== null);

      if (cancelled) return;

      setData({
        photos: previousCovers,
        latestSession,
        weights,
        weightTarget,
        weeklyWorkouts,
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

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ─── 1. Analytics row: Bodyweight 50% + Workout frequency 50% ── */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section label="Body weight" sublabel="Current + 12-week moving average">
          <BodyweightPanel
            weights={data.weights}
            target={data.weightTarget}
          />
        </Section>
        <Section
          label="Workout frequency"
          sublabel="Sessions per week · last 12 weeks"
        >
          <WorkoutFrequencyPanel weekly={data.weeklyWorkouts} />
        </Section>
      </div>

      {/* ─── 2. Latest physique ──────────────────────────────── */}
      <Section
        label="Latest physique"
        sublabel={
          data.latestSession?.photoCount && data.latestSession.photoCount > 1
            ? 'Newest session + previous entries'
            : 'Newest session + previous entries'
        }
      >
        <PhysiquePanel
          photos={data.photos}
          latest={data.latestSession}
          hasAny={data.latestSession !== null || data.photos.length > 0}
        />
      </Section>
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
        'mb-0 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5 ' +
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

// ─── 1a. Bodyweight panel ──────────────────────────────────────────

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
        body="Log your current weight on the Body Weight page to see the trend."
        ctaHref="/fitness/bodyweight"
        ctaLabel="Log weight"
      />
    );
  }

  // Trim to last ~26 weeks for the chart (still readable at half width).
  const chartSeries = maSeries.slice(-26).map((p) => ({
    week: p.weekEndIso,
    ma: p.ma,
    raw: p.raw,
  }));

  return (
    <div>
      <div className="h-44 sm:h-48">
        <BodyweightTrendChart
          series={chartSeries}
          targetKg={target?.target_kg ?? null}
          targetLabel={!!target}
        />
      </div>
      <div className="mt-2 text-[11px] text-zinc-500">
        <Link href="/fitness/bodyweight" className="hover:text-zinc-200">
          Full history → Body Weight
        </Link>
      </div>
    </div>
  );
}

// ─── 1b. Workout frequency panel ───────────────────────────────────

function WorkoutFrequencyPanel({
  weekly,
}: {
  weekly: DashboardData['weeklyWorkouts'];
}) {
  const total = weekly.reduce((n, w) => n + w.workouts, 0);
  const nonEmpty = weekly.some((w) => w.workouts > 0);

  if (!nonEmpty) {
    return (
      <EmptyHint
        title="No workouts yet"
        body="Import your Hevy export in Manage Data to populate the weekly frequency."
        ctaHref="/fitness/manage"
        ctaLabel="Open Manage Data"
      />
    );
  }

  return (
    <div>
      <div className="h-44 sm:h-48">
        <WeeklyWorkoutsChart series={weekly} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
        <span>
          <span className="font-mono text-zinc-300">{total}</span> sessions in
          12 weeks
        </span>
        <Link href="/fitness/workouts" className="hover:text-zinc-200">
          History → Workouts
        </Link>
      </div>
    </div>
  );
}

// ─── 2. Physique panel ─────────────────────────────────────────────

/**
 * Featured newest session cover on the left; on the right a 2 × 3
 * grid of the covers of the six PREVIOUS distinct sessions (a real
 * timeline across entries). Falls back to a single-column layout when
 * no photos exist.
 */
function PhysiquePanel({
  photos,
  latest,
  hasAny,
}: {
  photos: HydratedPhoto[];
  latest: DashboardData['latestSession'];
  hasAny: boolean;
}) {
  if (!latest) {
    return (
      <EmptyHint
        title={hasAny ? 'No pinned cover yet' : 'No progress photos'}
        body={
          hasAny
            ? 'Open the Physique gallery to star a photo as the album cover.'
            : 'Upload a progress session and star one photo as the cover.'
        }
        ctaHref="/fitness/bodyweight"
        ctaLabel="Open Body Weight"
      />
    );
  }

  const { cover } = latest;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {/* Featured (left half on desktop) */}
      <Link
        href="/fitness/bodyweight"
        className="group block overflow-hidden rounded-xl border border-zinc-800/40 bg-zinc-950/40 transition-colors hover:border-zinc-700"
      >
        <div className="relative aspect-[4/5] w-full bg-zinc-900 sm:aspect-[3/4]">
          {cover.url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={cover.url}
              alt={`Latest progress — ${cover.taken_at}`}
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
              {cover.pose_type ?? 'Photo'}
            </div>
            <div className="text-sm font-semibold text-white">
              {latest.title ?? cover.session_title ?? 'Untitled session'}
            </div>
            <div className="font-mono text-[11px] text-zinc-300">
              {cover.taken_at}
              {latest.photoCount > 1 ? ` · ${latest.photoCount} photos` : ''}
            </div>
          </div>
        </div>
      </Link>

      {/* Snapshots (right half): 2-col × 3-row square grid, one per
          previous session */}
      {photos.length > 0 ? (
        <div className="grid grid-cols-2 grid-rows-3 gap-2.5 self-start">
          {photos.map((p) => (
            <Link
              key={p.id}
              href="/fitness/bodyweight"
              className="group block overflow-hidden rounded-xl border border-zinc-800/40 bg-zinc-950/40 transition-colors hover:border-zinc-700"
            >
              <div className="relative aspect-square w-full bg-zinc-900">
                {p.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.url}
                    alt={`Progress session — ${p.taken_at}`}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
                    loading…
                  </div>
                )}
              </div>
            </Link>
          ))}
          {photos.length < 6 &&
            Array.from({ length: 6 - photos.length }).map((_, i) => (
              <div
                key={`ph-${i}`}
                className="aspect-square w-full rounded-xl border border-dashed border-zinc-800/40 bg-zinc-950/20"
              />
            ))}
        </div>
      ) : (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-zinc-800/40 bg-zinc-950/20 px-4 py-8 text-[11px] text-zinc-500">
          Previous sessions will appear here.
        </div>
      )}
    </div>
  );
}

// ─── Misc helpers ──────────────────────────────────────────────────

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
