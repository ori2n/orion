'use client';

import Link from 'next/link';
import type { HevyWorkoutDetail } from '@/lib/fitness/hevy/types';
import { fmtKg, fmtLongDate, fmtRelativeDate } from '@/lib/fitness/format';

/**
 * WorkoutDetailView — exercise + sets exactly as captured from Hevy
 * (Stage 5 §15). Renders nothing interactive; this is a faithful
 * record view, not a re-aggregation.
 */
export default function WorkoutDetailView({
  detail,
}: {
  detail: HevyWorkoutDetail;
}) {
  const totalSets = detail.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/fitness/workouts"
        className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← All workouts
      </Link>
      <header className="mb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Workout
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
          {detail.title ?? 'Workout'}
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span>{fmtLongDate(detail.startTime ?? detail.sourceStartTime)}</span>
          <span>·</span>
          <span>{fmtRelativeDate(detail.startTime ?? detail.sourceStartTime)}</span>
          <span>·</span>
          <span>
            {detail.exercises.length} exercises · {totalSets} sets
          </span>
        </div>
      </header>

      <ul className="space-y-4">
        {detail.exercises.map((ex, idx) => (
          <li
            key={`${detail.id}-${idx}-${ex.name}`}
            className="rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4"
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <Link
                href={`/fitness/strength/${encodeURIComponent(ex.name)}`}
                className="line-clamp-2 text-base font-medium text-zinc-100 hover:text-white"
              >
                {ex.name}
              </Link>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
                {ex.sets.length} set{ex.sets.length === 1 ? '' : 's'}
              </span>
            </div>
            {ex.sets.length === 0 ? (
              <p className="text-xs text-zinc-500">No sets recorded.</p>
            ) : (
              <ol className="grid grid-cols-1 gap-y-1 sm:grid-cols-2">
                {ex.sets.map((s, i) => (
                  <li
                    key={`${idx}-${i}-${s.setIndex}`}
                    className="flex items-baseline justify-between gap-3 font-mono text-xs"
                  >
                    <span className="w-8 text-zinc-500">
                      {i + 1 < 10 ? `0${i + 1}` : i + 1}.
                    </span>
                    <span className="text-zinc-100">
                      {s.durationSeconds !== null
                        ? `${s.durationSeconds}s`
                        : `${fmtKg(s.weightKg)} kg × ${s.reps ?? '–'} reps`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
