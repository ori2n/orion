'use client';

import { useEffect, useState } from 'react';
import { computeHevyCalculations, type HevyCalculations } from '@/lib/fitness/hevy/calculations';
import {
  listExerciseMeta,
  MUSCLES,
  seedDefaultMuscleMap,
  setExerciseMuscle,
  setManual1rm,
  type HevyExerciseMeta,
  type Muscle,
} from '@/lib/fitness/hevy/muscles';

/**
 * HevyExerciseMeta — Stage 4 verification/management UI.
 *
 * Seeds a sensible exercise → muscle map, lets the user override it,
 * accepts manual 1RM entries, and shows the deterministic metrics the
 * engine derives. This is a working surface, not the final dashboard.
 */
export default function HevyExerciseMeta({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [meta, setMeta] = useState<HevyExerciseMeta[]>([]);
  const [calcs, setCalcs] = useState<HevyCalculations | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const seeded = await seedDefaultMuscleMap(userId);
      const [m, c] = await Promise.all([listExerciseMeta(userId), computeHevyCalculations(userId)]);
      if (cancelled) return;
      setMeta(m);
      setCalcs(c);
      if (seeded > 0) setNote(`Seeded ${seeded} exercise→muscle mappings.`);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const metaByName = new Map(meta.map((m) => [m.exerciseName, m]));

  async function changeMuscle(name: string, muscle: Muscle | null) {
    await setExerciseMuscle(userId, name, muscle);
    setMeta(await listExerciseMeta(userId));
    setCalcs(await computeHevyCalculations(userId));
  }

  async function changeManual1rm(name: string, kg: number | null) {
    await setManual1rm(userId, name, kg);
    setMeta(await listExerciseMeta(userId));
    setCalcs(await computeHevyCalculations(userId));
  }

  return (
    <section aria-label="Hevy calculations" className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
        Exercise Mapping &amp; Metrics
      </div>
      <h3 className="mt-1 text-base font-semibold text-zinc-100">
        Muscles &amp; 1RM (Stage 4 engine)
      </h3>
      {note && <p className="mt-2 text-xs text-emerald-300/80">{note}</p>}

      {loading ? (
        <div className="mt-4 flex items-center gap-3 text-xs text-zinc-400">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          Loading…
        </div>
      ) : (
        <>
          {calcs && <Summary calcs={calcs} />}

          <div className="mt-5 border-t border-zinc-800/60 pt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Exercise mapping &amp; manual 1RM
            </div>
            <div className="max-h-96 divide-y divide-zinc-800/60 overflow-y-auto pr-1">
              {(calcs?.exercises ?? []).map((ex) => {
                const m = metaByName.get(ex.name);
                return (
                  <div key={ex.name} className="flex flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs text-zinc-200">{ex.name}</div>
                      <div className="text-[10px] text-zinc-500">
                        heaviest {ex.heaviestWeightKg ?? '—'} kg · est. 1RM{' '}
                        {ex.estimated1rmKg ?? '—'} kg
                      </div>
                    </div>
                    <select
                      value={m?.muscle ?? ''}
                      onChange={(e) =>
                        changeMuscle(
                          ex.name,
                          (e.target.value || null) as Muscle | null,
                        )
                      }
                      className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-200"
                    >
                      <option value="">Unmapped</option>
                      {MUSCLES.map((mm) => (
                        <option key={mm} value={mm}>
                          {mm}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      Manual 1RM
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.5"
                        min="0"
                        defaultValue={m?.manual1rmKg ?? ''}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          changeManual1rm(ex.name, v === '' ? null : Number(v));
                        }}
                        className="w-20 rounded-lg border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 text-xs text-zinc-200"
                      />
                      kg
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Summary({ calcs }: { calcs: HevyCalculations }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total volume" value={`${calcs.totalVolumeKg.toLocaleString()} kg`} />
        <Stat label="Total sets" value={calcs.totalSets.toLocaleString()} />
        <Stat label="Exercises" value={String(calcs.exercises.length)} />
        <Stat
          label="Unmapped"
          value={
            calcs.unmappedExercises.length > 0
              ? String(calcs.unmappedExercises.length)
              : '0'
          }
          warn={calcs.unmappedExercises.length > 0}
        />
      </div>

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
          Sets per muscle per week (target ~2×/week)
        </div>
        <div className="divide-y divide-zinc-800/60">
          {calcs.muscles.map((m) => (
            <div key={m.muscle} className="flex items-center justify-between gap-3 py-2">
              <div className="text-xs text-zinc-200">{m.muscle}</div>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-zinc-500">
                  {m.avgSetsPerWeek ?? '—'} sets/wk
                </span>
                <span className="text-zinc-500">
                  {m.sessionsPerWeek ?? '—'}×/wk
                </span>
                <span className="text-zinc-500">
                  4w {m.last4WeekSetsAvg ?? '—'} · 8w {m.last8WeekSetsAvg ?? '—'}
                </span>
                <span
                  className={
                    m.onTarget === null
                      ? 'text-zinc-600'
                      : m.onTarget
                        ? 'text-emerald-300'
                        : 'text-amber-300'
                  }
                >
                  {m.onTarget === null ? '—' : m.onTarget ? 'on target' : 'below'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div
        className={`mt-0.5 font-mono text-sm ${warn ? 'text-amber-300' : 'text-zinc-100'}`}
      >
        {value}
      </div>
    </div>
  );
}
