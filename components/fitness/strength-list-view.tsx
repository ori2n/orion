'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { HevyCalculations } from '@/lib/fitness/hevy/calculations';
import { fmtKg, fmtLongDate, fmtRelativeDate } from '@/lib/fitness/format';

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
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
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
      </header>

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
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-zinc-500">{label}</span>
      <span>{children}</span>
    </div>
  );
}
