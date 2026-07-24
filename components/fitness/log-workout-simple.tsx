'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { listExercises, findOrCreateExercise } from '@/lib/fitness/exercises';
import {
  insertStrengthLogs,
  listStrengthLogs,
  formatEntry,
  type StrengthLogEntry,
} from '@/lib/fitness/strength-logs';
import SearchableExercisePicker from './exercise-picker';
import type { Exercise } from '@/lib/fitness/types';

/**
 * WorkoutLogSimple — a dead-simple workout logger.
 *
 * Replaces the old WorkoutLog which had multi-step flows, workout names,
 * templates, PR cards, and the two-table workouts/workout_sets schema.
 *
 * New flow:
 *   1. Dashboard card shows a CTA ("Log Workout") or today's summary.
 *   2. Clicking opens a sheet where the user adds exercises one by one.
 *   3. For each exercise: pick from library (or create inline), enter
 *      best working weight + optional reps.
 *   4. One "Save" button writes all entries to `strength_logs`.
 *
 * That's it. No templates, no workout names, no set tracking.
 */
export default function WorkoutLogSimple({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [todayEntries, setTodayEntries] = useState<StrengthLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [flowOpen, setFlowOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [exs, logs] = await Promise.all([
      listExercises(userId),
      listStrengthLogs(userId),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    setExercises(exs);
    setTodayEntries(logs.filter((l) => l.performed_at === today));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  function openFlow() {
    setFlowOpen(true);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  const hasToday = todayEntries.length > 0;

  return (
    <section aria-label="Today's workout">
      {!hasToday ? (
        <EmptyTodayHero onLog={openFlow} />
      ) : (
        <LoggedTodayCard
          entries={todayEntries}
          exercises={exercises}
          onLogMore={openFlow}
        />
      )}

      {flowOpen && (
        <LogSheet
          userId={userId}
          exercises={exercises}
          todayEntries={todayEntries}
          onExercisesChange={setExercises}
          onClose={() => setFlowOpen(false)}
          onSaved={() => {
            setFlowOpen(false);
            onSaved();
          }}
        />
      )}
    </section>
  );
}

// ─── Today hero (empty state) ──────────────────────────────────────

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
        Log your best working sets in under a minute.
      </p>
      <div className="mt-5">
        <button
          onClick={onLog}
          className="group inline-flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm transition-all hover:bg-rose-500 hover:shadow-md active:scale-[0.98]"
        >
          <PlusIcon />
          Log Workout
        </button>
      </div>
    </div>
  );
}

// ─── Today card (when already logged) ──────────────────────────────

function LoggedTodayCard({
  entries,
  exercises,
  onLogMore,
}: {
  entries: StrengthLogEntry[];
  exercises: Exercise[];
  onLogMore: () => void;
}) {
  const bestLift = entries.length === 0
    ? null
    : Math.max(...entries.map((e) => Number(e.weight_kg)));

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
            {entries.length} exercise{entries.length === 1 ? '' : 's'}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-zinc-300">
            {bestLift !== null && (
              <span>
                Best lift{' '}
                <span className="font-mono">{bestLift}kg</span>
              </span>
            )}
          </div>

          {/* Today's entries list */}
          <ul className="mt-3 space-y-1">
            {entries.map((e) => {
              const ex = exercises.find((x) => x.id === e.exercise_id);
              return (
                <li key={e.id} className="text-sm text-zinc-300">
                  <span className="font-medium text-zinc-200">
                    {ex?.name ?? 'Unknown'}
                  </span>{' '}
                  <span className="font-mono text-zinc-400">
                    {formatEntry(e)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-emerald-800/30 pt-4">
        <button
          onClick={onLogMore}
          className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-800"
        >
          Log more
        </button>
      </div>
    </div>
  );
}

// ─── Log sheet (modal) ─────────────────────────────────────────────

interface ExerciseRow {
  exerciseId: string;
  weight: string;
  reps: string;
}

function LogSheet({
  userId,
  exercises,
  todayEntries,
  onExercisesChange,
  onClose,
  onSaved,
}: {
  userId: string;
  exercises: Exercise[];
  /** Already-logged entries for today — used to warn on duplicate adds. */
  todayEntries: StrengthLogEntry[];
  onExercisesChange: (next: Exercise[]) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<ExerciseRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Map exercise_id → existing today entry for quick lookup
  const todayMap = useMemo(
    () => new Map(todayEntries.map((e) => [e.exercise_id, e])),
    [todayEntries],
  );

  function addExercise(ex: Exercise) {
    // Don't add duplicates in the same session
    if (rows.some((r) => r.exerciseId === ex.id)) return;
    // If this exercise was already logged today, pre-fill with the
    // earlier entry's weight and reps so the user can adjust them.
    const existing = todayMap.get(ex.id);
    setRows((prev) => [
      ...prev,
      {
        exerciseId: ex.id,
        weight: existing ? String(existing.weight_kg) : '',
        reps: existing?.reps !== null && existing?.reps !== undefined
          ? String(existing.reps)
          : '',
      },
    ]);
  }

  function updateRow(idx: number, patch: Partial<ExerciseRow>) {
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  // Only rows with valid weight (>0) count as ready
  const filledRows = rows.filter((r) => {
    const w = parseFloat(r.weight);
    return Number.isFinite(w) && w > 0;
  });

  async function handleSave() {
    if (saving) return;
    setError(null);
    if (filledRows.length === 0) {
      setError('Add at least one exercise with a weight before saving.');
      return;
    }
    setSaving(true);
    const inputs = filledRows.map((r) => {
      const repsTrimmed = r.reps.trim();
      return {
        exercise_id: r.exerciseId,
        user_id: userId,
        weight_kg: parseFloat(r.weight),
        reps: repsTrimmed === '' ? null : parseInt(repsTrimmed, 10),
      };
    });
    const result = await insertStrengthLogs(inputs);
    setSaving(false);
    if (result.length === 0) {
      setError('Failed to save. Try again.');
      return;
    }
    onSaved();
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="dialog"
        aria-modal="true"
      >
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
        <div className="relative z-10 flex h-[90dvh] w-full max-w-xl flex-col rounded-t-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl sm:h-auto sm:max-h-[85vh] sm:rounded-2xl">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-800/60 px-5 py-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400/80">
                Log Workout
              </div>
              <h2 className="mt-0.5 text-base font-semibold text-zinc-100">
                Best working sets
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

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {rows.length === 0 ? (
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
                {rows.map((row, idx) => {
                  const ex = exercises.find((x) => x.id === row.exerciseId);
                  const weightNum = parseFloat(row.weight);
                  const ready =
                    Number.isFinite(weightNum) && weightNum > 0;
                  return (
                    <div
                      key={row.exerciseId}
                      className={`rounded-xl border bg-zinc-900/40 p-4 transition-colors ${
                        ready
                          ? 'border-emerald-700/40'
                          : 'border-zinc-800/70'
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-100">
                            {ex?.name ?? 'Unknown'}
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
                          onClick={() => removeRow(idx)}
                          className="text-[10px] font-medium text-zinc-600 transition-colors hover:text-red-400"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
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
                              updateRow(idx, { weight: e.target.value })
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
                              updateRow(idx, { reps: e.target.value })
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
            <div className="text-xs text-zinc-500">
              {filledRows.length}/{rows.length} exercises ready
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || filledRows.length === 0}
                className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <SearchableExercisePicker
          userId={userId}
          exercises={exercises}
          onExercisesChange={onExercisesChange}
          onSelect={(ex) => addExercise(ex)}
          onClose={() => setPickerOpen(false)}
          keepOpenOnSelect
        />
      )}
    </>
  );
}

// ─── Icons ──────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
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
