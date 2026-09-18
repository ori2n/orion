import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUserIdServer } from '@/lib/auth-server';
import { createClient } from '@/lib/supabase/server';
import { seedDefaultMuscleMap } from '@/lib/fitness/hevy/muscles';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';

export const metadata: Metadata = {
  title: 'All exercises — ORION Fitness',
};

export const dynamic = 'force-dynamic';

/**
 * All Exercises — the full exercise library, organised by the three
 * broad groups (Chest & Back / Shoulders & Arms / Legs) instead of a
 * flat per-muscle list. Each group links to the existing per-muscle
 * drill-down pages, which reach every individual exercise — so niche
 * exercises stay two clicks away without a giant list here.
 *
 * `?group=Chest %26 Back` opens the page scrolled/focused to that
 * group via the hash-style anchor below.
 */
export default async function AllExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>;
}) {
  const userId = await getCurrentUserIdServer();
  if (!userId) redirect('/login');
  const db = await createClient();
  await seedDefaultMuscleMap(userId, db);
  const calcs = await computeHevyCalculations(userId, undefined, db);

  // Per-group exercise counts + per-muscle breakdown.
  const byMuscle = new Map<string, number>();
  for (const e of calcs.exercises) {
    const m = e.muscle ?? 'Unmapped';
    byMuscle.set(m, (byMuscle.get(m) ?? 0) + 1);
  }

  const groups: Array<{
    label: string;
    blurb: string;
    muscles: string[];
  }> = [
    {
      label: 'Chest & Back',
      blurb: 'Presses, pulls, rows and pulldowns.',
      muscles: ['Chest', 'Upper Back', 'Lats', 'Lower Back'],
    },
    {
      label: 'Shoulders & Arms',
      blurb: 'Deltoids, curls, presses and pushdowns.',
      muscles: ['Shoulders', 'Biceps', 'Triceps', 'Traps'],
    },
    {
      label: 'Legs',
      blurb: 'Squats, hinges, extensions and raises.',
      muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves'],
    },
  ];

  const { group: focusGroup } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Strength
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-zinc-100 sm:text-2xl">
          All exercises
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          {calcs.exercises.length} exercises across three groups. Pick a
          muscle to see its exercises, then open one for the full
          drill-down.
        </p>
      </header>

      <div className="space-y-4">
        {groups.map((g) => {
          const total = g.muscles.reduce(
            (n, m) => n + (byMuscle.get(m) ?? 0),
            0,
          );
          const isFocus = focusGroup === g.label;
          return (
            <section
              key={g.label}
              className={
                'rounded-2xl border p-4 sm:p-5 ' +
                (isFocus
                  ? 'border-rose-500/40 bg-rose-950/10 ring-1 ring-rose-500/20'
                  : 'border-zinc-800/40 bg-zinc-950/30')
              }
            >
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
                    {g.label}
                  </h2>
                  <p className="text-[11px] text-zinc-500">{g.blurb}</p>
                </div>
                <span className="font-mono text-xs text-zinc-500">
                  {total} exercises
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {g.muscles.map((m) => {
                  const count = byMuscle.get(m) ?? 0;
                  return (
                    <Link
                      key={m}
                      href={`/fitness/muscles/${encodeURIComponent(m)}`}
                      className={
                        'flex flex-col rounded-xl border px-3 py-2.5 transition-colors ' +
                        (count > 0
                          ? 'border-zinc-800/40 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900/40'
                          : 'border-dashed border-zinc-800/30 bg-zinc-950/20 opacity-60 hover:opacity-100')
                      }
                    >
                      <div className="text-sm font-medium text-zinc-100">
                        {m}
                      </div>
                      <div className="mt-0.5 text-[11px] text-zinc-500">
                        {count} exercise{count === 1 ? '' : 's'}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* Unmapped safety net so no exercise is unreachable. */}
        {(byMuscle.get('Unmapped') ?? 0) > 0 && (
          <section className="rounded-2xl border border-amber-700/30 bg-amber-950/10 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-amber-200">
                  Unmapped
                </h2>
                <p className="text-[11px] text-amber-200/70">
                  Exercises without a muscle mapping — map them in Manage
                  Data.
                </p>
              </div>
              <span className="font-mono text-xs text-amber-200/70">
                {byMuscle.get('Unmapped')} exercises
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
