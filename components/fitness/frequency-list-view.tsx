'use client';

import Link from 'next/link';
import type {
  HevyCalculations,
  MuscleSummary,
} from '@/lib/fitness/hevy/calc';
import { fmtKg } from '@/lib/fitness/format';

/**
 * FrequencyListView — Training Frequency analytics page.
 *
 * Hosts the muscle-frequency grid that used to sit on the Overview:
 * one card per muscle showing actual weekly sessions (last 4 weeks)
 * vs the user's configured target, with the same three-band status
 * badge ("On target" / "Below" / "Above") and the same per-muscle
 * drill-down links (`/fitness/muscles/[muscle]`). Data and behaviour
 * are unchanged — only the location moved.
 */
export default function FrequencyListView({ calcs }: { calcs: HevyCalculations }) {
  if (calcs.muscles.length === 0) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Link
          href="/fitness"
          className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
        >
          ← Overview
        </Link>
        <header className="mb-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Training frequency
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
            Muscles vs target
          </h1>
        </header>
        <EmptyHint
          title="No muscle data"
          body="Muscle-frequency badges appear once your Hevy import lands with mapped exercises."
          ctaHref="/fitness/manage"
          ctaLabel="Open Manage Data"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/fitness"
        className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← Overview
      </Link>
      <header className="mb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Training frequency
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
          Muscles vs target
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Last 4 weeks of training days per muscle vs your configured target.
          Tap a muscle for the full drill-down.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {calcs.muscles.map((m) => (
          <MuscleCard key={m.muscle} m={m} />
        ))}
      </div>
    </div>
  );
}

function MuscleCard({ m }: { m: MuscleSummary }) {
  return (
    <Link
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
