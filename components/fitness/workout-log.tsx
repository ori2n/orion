'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  listExercises,
} from '@/lib/fitness/exercises';
import {
  createWorkout,
  addWorkoutSets,
  listRecentWorkouts,
  listWorkoutsInWindow,
  listAllSetsForUser,
  replaceWorkoutSets,
  updateWorkout,
  deleteWorkout,
  type CreateWorkoutSetInput,
} from '@/lib/fitness/workouts';
import { detectRecentPRs } from '@/lib/fitness/flashback';
import { effectiveReps } from '@/lib/fitness/strength';
import { logEvent, EventTypes } from '@/lib/events';
import type {
  Exercise,
  Workout,
  WorkoutSet,
} from '@/lib/fitness/types';
import SearchableExercisePicker from './exercise-picker';

/**
 * WorkoutLog — Today's hero + multi-step log flow.
 *
 * Layout (top of fitness dashboard):
 *   - **Today's Workout** hero: shows either the big "+ Log Workout"
 *     CTA (no logged session today) or a confirmation card
 *     summarising today's session.
 *   - **Recent PRs** — lit when the most recent 48h contains a lift
 *     that beats every prior at the same rep count for that exercise.
 *     Today's own PRs are intentionally excluded from this card so
 *     they don't double-print with the "New PRs" block on the
 *     confirmation card.
 *   - **Recent Workouts**: thin list of the last few sessions.
 *
 * Modal flow (only when user opts in):
 *   1. Pick a workout name (Push / Pull / Legs / Upper / Lower /
 *      Custom) and continue.
 *   2. Add exercises + sets. Each exercise card has weight × reps rows
 *      and an inline "+ Add Set" / "+ Add Exercise" action. Saving
 *      writes the workout + sets in one shot.
 *
 * Future AI: the editor stays manual only. When voice / Hevy arrive, a
 * new entrypoint will call into the same `createWorkout` /
 * `addWorkoutSets` helpers — the `events` table is already capturing
 * `WORKOUT_LOG` payloads so the future memory engine has full replay.
 */
export default function WorkoutLog({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  // ── Exercise library (shared by hero stats + flow editor) ────────
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [allSets, setAllSets] = useState<WorkoutSet[]>([]);
  const [recent, setRecent] = useState<Array<Workout & { sets: WorkoutSet[] }>>([]);
  const [todayWorkout, setTodayWorkout] =
    useState<(Workout & { sets: WorkoutSet[] }) | null>(null);

  const [loading, setLoading] = useState(true);
  const [flowOpen, setFlowOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const todayStart = `${todayISO()}T00:00:00`;
    const todayEnd = `${todayISO()}T23:59:59`;
    const [exs, todays, recents, sets] = await Promise.all([
      listExercises(userId),
      listWorkoutsInWindow(userId, todayStart, todayEnd),
      listRecentWorkouts(userId, 7),
      // Pull all sets once so we can derive today's PRs + recent
      // session volumes without a join query per row.
      listAllSetsForUser(userId),
    ]);
    if (todays.length > 0) {
      const ids = todays.map((w) => w.id);
      const todaySets = sets.filter((s) => ids.includes(s.workout_id));
      const byId = new Map<string, WorkoutSet[]>();
      for (const s of todaySets) {
        const arr = byId.get(s.workout_id) ?? [];
        arr.push(s);
        byId.set(s.workout_id, arr);
      }
      const head = todays[0];
      setTodayWorkout({ ...head, sets: byId.get(head.id) ?? [] });
    } else {
      setTodayWorkout(null);
    }
    setExercises(exs);
    setAllSets(sets);
    setRecent(recents);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  // Today-name PRs — surfaced inside the confirmation card only.
  // `reps` stays nullable here (raw DB value) — UI falls back to `?? 1`
  // for weight-only logs.
  const todayPRs = useMemo<
    Array<{ exercise_name: string; weight_kg: number; reps: number | null }>
  >(() => {
    if (!todayWorkout) return [];
    const todayIds = new Set([todayWorkout.id]);
    return allSets
      .filter((s) => todayIds.has(s.workout_id))
      .map((s) => ({ set: s, ex: exercises.find((e) => e.id === s.exercise_id) }))
      .map(({ set, ex }) => ({
        exercise_name: ex?.name ?? 'Unknown',
        weight_kg: set.weight_kg,
        reps: set.reps,
      }));
  }, [todayWorkout, allSets, exercises]);

  // Stable Set of (exerciseId|effective-reps) keys for today's lifts —
  // drives the dedup of the standalone "🏆 Recent PRs" card below. We
  // use the EFFECTIVE rep count (NULL → 1) so the key matches what
  // `detectRecentPRs` / `PRReps` actually represents in the surfaced
  // list. (Otherwise a weight-only log today and an explicit 1-rep
  // log today would both key as "null" and "1" respectively and never
  // match each other.)
  const todayPRKeys = useMemo<Set<string>>(() => {
    if (!todayWorkout) return new Set();
    const todayIds = new Set([todayWorkout.id]);
    const out = new Set<string>();
    for (const s of allSets) {
      if (!todayIds.has(s.workout_id)) continue;
      out.add(`${s.exercise_id}|${effectiveReps(s.reps)}`);
    }
    return out;
  }, [todayWorkout, allSets]);

  // 48h PRs surfaced in the standalone card — exclude ones already
  // covered by today's hero so we don't double-print the same lift.
  const recentPRs = useMemo(() => {
    if (todayPRKeys.size === 0) {
      return detectRecentPRs(allSets, exercises, 48);
    }
    const nameToId = new Map(exercises.map((e) => [e.name, e.id]));
    return detectRecentPRs(allSets, exercises, 48).filter((p) => {
      const id = nameToId.get(p.exercise_name);
      if (!id) return true; // unknown exercise → don't hide
      return !todayPRKeys.has(`${id}|${p.reps}`);
    });
  }, [allSets, exercises, todayPRKeys]);

  function openLogFlow() {
    setEditingId(null);
    setFlowOpen(true);
  }
  function openEditFlow() {
    setEditingId(todayWorkout?.id ?? null);
    setFlowOpen(true);
  }
  function closeFlow() {
    setFlowOpen(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section aria-label="Today's workout">
        {!todayWorkout ? (
          <EmptyTodayHero onLog={openLogFlow} />
        ) : (
          <LoggedTodayCard
            workout={todayWorkout}
            exerciseCount={
              new Set(todayWorkout.sets.map((s) => s.exercise_id)).size
            }
            workingSetsTotal={todayWorkout.sets.reduce(
              (acc, s) => acc + (s.working_sets_count ?? 1),
              0,
            )}
            bestLiftKg={todayWorkout.sets.length === 0
              ? null
              : Math.max(...todayWorkout.sets.map((s) => s.weight_kg))}
            newPRs={todayPRs}
            onEdit={openEditFlow}
          />
        )}
      </section>

      {recentPRs.length > 0 && (
        <section aria-label="Recent PRs">
          <Card>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400/80">
              🏆 Recent PRs
            </div>
            <div className="mt-2 space-y-1.5">
              {recentPRs.map((p, i) => (
                <div key={i} className="text-sm text-zinc-200">
                  <span className="font-semibold">{p.exercise_name}</span>{' '}
                  <span className="text-zinc-400">
                    {p.weight_kg}kg × {p.reps}
                  </span>
                  <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-rose-400">
                    PR
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      <section aria-label="Recent workouts">
        <Card title="Recent workouts" subtitle="Last 7 sessions">
          {recent.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
              No workouts yet. Save your first session above.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800/50">
              {recent.map((w) => {
                // Volume call uses `effectiveReps` so weight-only
                // logs (NULL reps) contribute as 1 rep — consistent
                // with the rest of the analytics layer.
                const volume = w.sets.reduce(
                  (acc, s) => acc + s.weight_kg * effectiveReps(s.reps),
                  0,
                );
                return (
                  <li
                    key={w.id}
                    className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-zinc-200">
                        {w.name ?? 'Workout'}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {formatRel(w.performed_at)} · {w.sets.length} set
                        {w.sets.length === 1 ? '' : 's'} ·{' '}
                        {volume > 0 ? `${(volume / 1000).toFixed(2)}t` : ''}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const ok = await deleteWorkout(w.id);
                        if (ok) onSaved();
                      }}
                      className="text-[10px] font-medium text-zinc-600 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>

      {flowOpen && (
        <LogWorkoutFlow
          userId={userId}
          exercises={exercises}
          onExercisesChange={setExercises}
          initialWorkout={editingId ? todayWorkout : null}
          onClose={closeFlow}
          onSaved={() => {
            setFlowOpen(false);
            onSaved();
          }}
        />
      )}
    </div>
  );
}

// ─── Today's hero ────────────────────────────────────────────────

function EmptyTodayHero({ onLog }: { onLog: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-900/45 p-6 shadow-sm backdrop-blur-sm">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
        Today's Workout
      </div>
      <h3 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
        Nothing logged yet
      </h3>
      <p className="mt-1 text-sm text-zinc-400">
        Capture a session in under two minutes — name it, add your lifts, save.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={onLog}
          className="group inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm transition-all hover:bg-rose-500 hover:shadow-md active:scale-[0.98]"
        >
          <PlusIcon />
          Log Workout
        </button>
        <span className="inline-flex items-center text-xs text-zinc-600">
          Avg users finish in ~90 seconds.
        </span>
      </div>
    </div>
  );
}

function LoggedTodayCard({
  workout,
  exerciseCount,
  workingSetsTotal,
  bestLiftKg,
  newPRs,
  onEdit,
}: {
  workout: Workout;
  exerciseCount: number;
  /**
   * Total working sets for this session — sum of `working_sets_count`
   * (legacy rows = 1 each). The hypertrophy signal the user cares
   * about, replaces the old per-set volume math.
   */
  workingSetsTotal: number;
  /** Max weight lifted today, or null if no sets. */
  bestLiftKg: number | null;
  newPRs: Array<{ exercise_name: string; weight_kg: number; reps: number | null }>;
  onEdit: () => void;
}) {
  return (
    <div
      className="rounded-2xl border border-emerald-700/30 bg-emerald-950/10 p-6 shadow-sm backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
          <TickIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-emerald-400/80">
            Workout logged
          </div>
          <h3 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
            {workout.name ?? 'Workout'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-zinc-300">
            <span>
              {exerciseCount} exercise{exerciseCount === 1 ? '' : 's'}
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              {workingSetsTotal} working set{workingSetsTotal === 1 ? '' : 's'}
            </span>
            {bestLiftKg !== null && (
              <>
                <span className="text-zinc-700">·</span>
                <span>
                  Best lift{' '}
                  <span className="font-mono">{bestLiftKg}kg</span>
                </span>
              </>
            )}
          </div>

          {newPRs.length > 0 && (
            <div className="mt-4 rounded-lg border border-rose-700/30 bg-rose-950/20 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-300">
                New PRs
              </div>
              <ul className="mt-1.5 space-y-0.5">
                {newPRs.map((p, i) => (
                  <li
                    key={i}
                    className="text-sm text-zinc-200"
                  >
                    <span className="font-medium">{p.exercise_name}</span>{' '}
                    <span className="font-mono text-zinc-300">
                      {p.weight_kg}kg × {p.reps ?? 1}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-emerald-800/30 pt-4">
        <button
          onClick={onEdit}
          className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
        >
          Edit
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg border border-transparent bg-transparent px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800/50 hover:text-zinc-200"
        >
          View workout
        </button>
      </div>
    </div>
  );
}

// ─── Multi-step log flow ────────────────────────────────────────

const WORKOUT_PRESETS: Array<{ key: string; label: string }> = [
  { key: 'Push', label: 'Push' },
  { key: 'Pull', label: 'Pull' },
  { key: 'Legs', label: 'Legs' },
  { key: 'Upper', label: 'Upper' },
  { key: 'Lower', label: 'Lower' },
];

function LogWorkoutFlow({
  userId,
  exercises,
  onExercisesChange,
  initialWorkout,
  onClose,
  onSaved,
}: {
  userId: string;
  exercises: Exercise[];
  onExercisesChange: (next: Exercise[]) => void;
  initialWorkout:
    | (Workout & { sets: WorkoutSet[] })
    | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  type Step = 'name' | 'editor';
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState<string>(
    initialWorkout?.name ?? '',
  );
  const [performedAt] = useState<string>(
    initialWorkout?.performed_at ?? new Date().toISOString(),
  );

  // ── Compact summary-row state ──────────────────────────────────
  // ONE row per (exercise) holding the user's BEST working set:
  //   - sets   : count of working sets performed
  //   - weight : heaviest acceptable weight
  //   - reps   : best working reps (empty = weight-only, treated as 1
  //              for PR / Epley by analytics)
  // No more per-set table UI — logging is now <60 s end-to-end.
  const [openExercises, setOpenExercises] = useState<
    Record<string, SummaryRow>
  >(() => {
    if (!initialWorkout) return {};
    const map: Record<string, SummaryRow> = {};
    for (const s of initialWorkout.sets) {
      map[s.exercise_id] = {
        sets: String(s.working_sets_count ?? 1),
        weight: String(s.weight_kg),
        reps: s.reps !== null ? String(s.reps) : '',
      };
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Pre-fill from last workout (create path only) ──────────────
  // Hits the <60 s logging target: opening Step 2 with no exercises
  // auto-seeds the cards from the most recent prior session so the
  // user just confirms the values. Edit path uses initial state.
  const openExercisesKeys = Object.keys(openExercises).length;
  useEffect(() => {
    if (step !== 'editor') return;
    if (initialWorkout) return;
    if (openExercisesKeys > 0) return;
    let cancelled = false;
    (async () => {
      const recent = await listRecentWorkouts(userId, 1);
      if (cancelled || recent.length === 0) return;
      const last = recent[0];
      if (last.sets.length === 0) return;
      const seed: Record<string, SummaryRow> = {};
      for (const s of last.sets) {
        seed[s.exercise_id] = {
          sets: String(s.working_sets_count ?? 1),
          weight: String(s.weight_kg),
          reps: s.reps !== null ? String(s.reps) : '',
        };
      }
      setOpenExercises(seed);
    })();
    return () => {
      cancelled = true;
    };
    // openExercisesKeys is intentionally in deps so a manual clear
    // resets the pre-fill signal (rare edge case — user empties the
    // editor and wants to re-seed from last workout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, userId, initialWorkout, openExercisesKeys]);

  function addExercise(ex: Exercise) {
    setOpenExercises((prev) => ({
      ...prev,
      [ex.id]: prev[ex.id] ?? { sets: '', weight: '', reps: '' },
    }));
  }

  function updateSummary(exId: string, patch: Partial<SummaryRow>) {
    setOpenExercises((prev) => ({
      ...prev,
      [exId]: {
        ...(prev[exId] ?? { sets: '', weight: '', reps: '' }),
        ...patch,
      },
    }));
  }

  function removeExercise(exId: string) {
    setOpenExercises((prev) => {
      const { [exId]: _drop, ...rest } = prev;
      return rest;
    });
  }

  // A summary row counts as "filled" if BOTH sets (>0) and weight (>0)
  // are valid. Reps is intentionally optional — weight-only logs are
  // first-class (analytics treat NULL reps as 1).
  const filledSummaries = useMemo<
    Array<{ exId: string; row: SummaryRow }>
  >(() => {
    const out: Array<{ exId: string; row: SummaryRow }> = [];
    for (const [exId, row] of Object.entries(openExercises)) {
      const sets = parseInt(row.sets, 10);
      const weight = parseFloat(row.weight);
      if (
        Number.isInteger(sets) &&
        sets > 0 &&
        Number.isFinite(weight) &&
        weight > 0
      ) {
        out.push({ exId, row });
      }
    }
    return out;
  }, [openExercises]);

  const totalFilled = filledSummaries.length;
  const totalCards = Object.keys(openExercises).length;
  const totalWorkingSetsCount = filledSummaries.reduce(
    (acc, fs) => acc + (parseInt(fs.row.sets, 10) || 0),
    0,
  );

  /**
   * Translate one user's "filled summary" into a workout_set row
   * MINUS `workout_id` (the caller stamps it). Repetitions are NULL
   * when the user left the reps field blank — analytics handle that
   * gracefully (treated as 1 rep via `effectiveReps`).
   *
   * Returns the `Omit<CreateWorkoutSetInput, 'workout_id'>` shape so
   * `replaceWorkoutSets(workoutId, rows)` accepts it directly and
   * `addWorkoutSets(...)` just spreads in `workout_id` at the callsite.
   */
  function toSummaryRow(
    fs: { exId: string; row: SummaryRow },
    idx: number,
  ): Omit<CreateWorkoutSetInput, 'workout_id'> {
    const repsRaw = fs.row.reps.trim();
    return {
      exercise_id: fs.exId,
      user_id: userId,
      set_order: idx + 1,
      weight_kg: parseFloat(fs.row.weight),
      reps: repsRaw === '' ? null : parseInt(repsRaw, 10),
      working_sets_count: parseInt(fs.row.sets, 10),
    };
  }

  async function handleSave() {
    if (saving) return;
    setError(null);
    if (totalFilled === 0) {
      setError('Add at least one exercise before saving.');
      return;
    }
    setSaving(true);

    if (initialWorkout) {
      // Edit path: replace the existing workout's set rows + update
      // the parent workout name/timestamp. `replaceWorkoutSets` takes
      // the row set without workout_id and reattaches it.
      await updateWorkout(initialWorkout.id, {
        name: name.trim() || null,
        performed_at: performedAt,
      });
      const result = await replaceWorkoutSets(
        initialWorkout.id,
        filledSummaries.map((fs, idx) => toSummaryRow(fs, idx)),
      );
      setSaving(false);
      if (result === null) {
        setError('Failed to update exercises.');
        return;
      }
      void logEvent(EventTypes.WORKOUT_EDITED, {
        workout_id: initialWorkout.id,
        exercise_count: result.length,
      });
      onSaved();
      return;
    }

    // Create path: insert the parent workout, then N summary rows
    // (one per exercise, NOT per set). `addWorkoutSets` needs the
    // full `CreateWorkoutSetInput` shape, so we spread in workout_id.
    const workout = await createWorkout({
      name: name.trim() || null,
      performed_at: performedAt,
      user_id: userId,
    });
    if (!workout) {
      setSaving(false);
      setError('Failed to create workout.');
      return;
    }
    const inserted = await addWorkoutSets(
      filledSummaries.map((fs, idx) => ({
        ...toSummaryRow(fs, idx),
        workout_id: workout.id,
      })),
    );
    setSaving(false);
    if (inserted.length === 0) {
      setError('Workout saved, but exercises failed to insert.');
      return;
    }
    void logEvent(EventTypes.WORKOUT_LOG, {
      workout_id: workout.id,
      exercise_count: Object.keys(openExercises).length,
      summary_count: inserted.length,
    });
    onSaved();
  }

  // ── Step 1: name ────────────────────────────────────────────
  if (step === 'name') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
        <div className="relative z-10 w-full max-w-md rounded-t-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400/80">
                Step 1 of 2
              </div>
              <h2 className="mt-0.5 text-base font-semibold text-zinc-100">
                Select workout name
              </h2>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WORKOUT_PRESETS.map((preset) => {
                const active = name === preset.label;
                return (
                  <button
                    key={preset.key}
                    onClick={() => setName(preset.label)}
                    className={`rounded-lg border px-4 py-3 text-sm font-medium transition-all ${
                      active
                        ? 'border-rose-600 bg-rose-600/15 text-zinc-100 shadow-inner'
                        : 'border-zinc-700/60 bg-zinc-900/50 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/60'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <CustomNameTile
                value={name}
                onChange={(v) => setName(v)}
                active={!WORKOUT_PRESETS.some((p) => p.label === name)}
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={() => setStep('editor')}
                disabled={!name.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: compact summary editor ─────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
      <div className="relative z-10 flex h-[100dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl sm:h-auto sm:max-h-[85vh] sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-5 py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400/80">
              Step 2 of 2
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-zinc-100">
              {name || 'Workout'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5">
          {Object.keys(openExercises).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700/70 bg-zinc-900/30 px-6 py-10 text-center">
              <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
                <DumbbellIcon />
              </div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Add your first exercise
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Bench, squat, row — pick from your library or create one inline.
              </p>
              <button
                onClick={() => setPickerOpen(true)}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
              >
                <PlusIcon /> Add Exercise
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(openExercises).map(([exId, row]) => {
                const ex = exercises.find((x) => x.id === exId);
                if (!ex) return null;
                const setsInt = parseInt(row.sets, 10);
                const weightNum = parseFloat(row.weight);
                const ready =
                  Number.isInteger(setsInt) &&
                  setsInt > 0 &&
                  Number.isFinite(weightNum) &&
                  weightNum > 0;
                return (
                  <div
                    key={exId}
                    className={`rounded-xl border bg-zinc-900/40 p-4 transition-colors ${
                      ready
                        ? 'border-emerald-700/40'
                        : 'border-zinc-800/70'
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-zinc-100">
                          {ex.name}
                        </span>
                        {ready && (
                          <span
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
                            title="Ready to save"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeExercise(exId)}
                        className="text-[10px] font-medium text-zinc-600 transition-colors hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                          Sets
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          placeholder="4"
                          value={row.sets}
                          onChange={(e) =>
                            updateSummary(exId, { sets: e.target.value })
                          }
                          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                          Best weight (kg)
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.5"
                          placeholder="75"
                          value={row.weight}
                          onChange={(e) =>
                            updateSummary(exId, { weight: e.target.value })
                          }
                          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">
                          Reps
                          <span className="rounded bg-zinc-800 px-1 py-px text-[8px] font-normal normal-case text-zinc-500">
                            opt
                          </span>
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="1"
                          step="1"
                          placeholder="5"
                          value={row.reps}
                          onChange={(e) =>
                            updateSummary(exId, { reps: e.target.value })
                          }
                          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={() => setPickerOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700/70 bg-zinc-900/30 py-3 text-sm font-medium text-zinc-400 transition-colors hover:border-rose-700/60 hover:bg-rose-950/15 hover:text-rose-300"
              >
                <PlusIcon /> Add Exercise
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800/60 px-5 py-4">
          <button
            onClick={() => setStep('name')}
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              {totalCards} exercise{totalCards === 1 ? '' : 's'} ·{' '}
              {totalWorkingSetsCount} working set
              {totalWorkingSetsCount === 1 ? '' : 's'}
            </span>
            <button
              onClick={handleSave}
              disabled={saving || totalFilled === 0}
              className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving
                ? 'Saving…'
                : initialWorkout
                  ? 'Update'
                  : 'Save Workout'}
            </button>
          </div>
        </div>

        {pickerOpen && (
          <SearchableExercisePicker
            userId={userId}
            exercises={exercises}
            onExercisesChange={onExercisesChange}
            onSelect={(ex) => {
              // keep modal open so the user can chain-add the next
              // exercise without re-opening — hits the <60 s target.
              addExercise(ex);
            }}
            onClose={() => setPickerOpen(false)}
            keepOpenOnSelect
          />
        )}
      </div>
    </div>
  );
}

// ─── Visible named tile for "Custom" name ──────────────────────

function CustomNameTile({
  value,
  onChange,
  active,
}: {
  value: string;
  onChange: (v: string) => void;
  active: boolean;
}) {
  return (
    <label
      className={`col-span-2 cursor-text rounded-lg border px-3 py-2 text-sm transition-all sm:col-span-1 ${
        active
          ? 'border-rose-600/60 bg-rose-950/15 text-zinc-100 shadow-inner'
          : 'border-zinc-700/60 bg-zinc-900/50 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/60'
      }`}
    >
      <span className="block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
        Custom
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="type a name"
        className="mt-0.5 w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
      />
    </label>
  );
}

// ─── Small building blocks ────────────────────────────────────

function Card({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
      {(title || subtitle) && (
        <div className="mb-3 flex items-center justify-between">
          <div>
            {title && (
              <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
            )}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * One form-row in the compact workout editor. All fields are raw
 * strings so the user can freely type partial values (e.g. "7" before
 * deciding to bump to "7.5"). Validation happens at save time.
 */
interface SummaryRow {
  /** Count of working sets performed. */
  sets: string;
  /** Heaviest acceptable working-set weight (kg). */
  weight: string;
  /** Best reps on that working set (empty = weight-only log). */
  reps: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatRel(iso: string): string {
  const days = Math.round(
    (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// ─── Icons ────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 5l7 7-7 7" />
    </svg>
  );
}
function TickIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
function DumbbellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 6v12M18 6v12M2 9v6M22 9v6M6 12h12" />
    </svg>
  );
}
