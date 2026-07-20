'use client';

import { useState, useEffect } from 'react';
import { listExercises, findOrCreateExercise, SUGGESTED_EXERCISES } from '@/lib/fitness/exercises';
import {
  createWorkout,
  addWorkoutSets,
  listRecentWorkouts,
  deleteWorkout,
} from '@/lib/fitness/workouts';
import type { Exercise, Workout, WorkoutSet } from '@/lib/fitness/types';
import ExerciseManager from './exercise-manager';

/**
 * WorkoutLog — fast post-training workout entry.
 *
 * Design goals:
 *   - Log a workout in under 2 minutes
 *   - Exercise picker is always visible (no hidden toggles)
 *   - Sets are weight × reps only (RPE / notes removed for speed)
 *   - AI transcript field removed (will be added back when parser exists)
 *   - Exercise library accessible via "Manage Exercises" button
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
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [recentWorkouts, setRecentWorkouts] = useState<Array<Workout & { sets: WorkoutSet[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [performedAt, setPerformedAt] = useState(() => todayISO());
  const [workoutName, setWorkoutName] = useState('');
  // Map of exercise_id → rows for this session
  const [openExercises, setOpenExercises] = useState<Record<string, SetRow[]>>({});

  // Exercise manager modal
  const [showExManager, setShowExManager] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [exs, recent] = await Promise.all([
        listExercises(userId),
        listRecentWorkouts(userId, 20),
      ]);
      if (cancelled) return;
      setExercises(exs);
      setRecentWorkouts(recent);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  // ─── Exercise & set helpers ──────────────────────────────────────

  function addExercise(exId: string) {
    setOpenExercises((prev) => ({
      ...prev,
      [exId]: prev[exId] ?? [
        { id: cryptoId(), weight: '', reps: '' },
      ],
    }));
  }

  function updateSetRow(exId: string, rowId: string, patch: Partial<SetRow>) {
    setOpenExercises((prev) => ({
      ...prev,
      [exId]: (prev[exId] ?? []).map((r) =>
        r.id === rowId ? { ...r, ...patch } : r
      ),
    }));
  }

  function addSetRow(exId: string) {
    setOpenExercises((prev) => ({
      ...prev,
      [exId]: [
        ...(prev[exId] ?? []),
        { id: cryptoId(), weight: '', reps: '' },
      ],
    }));
  }

  function removeSetRow(exId: string, rowId: string) {
    setOpenExercises((prev) => {
      const next = (prev[exId] ?? []).filter((r) => r.id !== rowId);
      if (next.length === 0) {
        const { [exId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [exId]: next };
    });
  }

  // ─── Save ────────────────────────────────────────────────────────

  async function handleSave() {
    if (saving) return;
    setError(null);
    setSuccess(null);

    const filledSets: Array<{ exId: string; row: SetRow; order: number }> = [];
    Object.entries(openExercises).forEach(([exId, rows]) => {
      rows.forEach((row, order) => {
        const w = parseFloat(row.weight);
        const r = parseInt(row.reps, 10);
        if (Number.isFinite(w) && w > 0 && Number.isInteger(r) && r > 0) {
          filledSets.push({ exId, row, order });
        }
      });
    });

    if (filledSets.length === 0) {
      setError('Add at least one set with weight and reps before saving.');
      return;
    }

    setSaving(true);
    const workout = await createWorkout({
      name: workoutName.trim() || null,
      performed_at: new Date(performedAt).toISOString(),
      user_id: userId,
    });
    if (!workout) {
      setError('Failed to create workout. Check your connection and try again.');
      setSaving(false);
      return;
    }

    const inserted = await addWorkoutSets(
      filledSets.map((fs) => ({
        workout_id: workout.id,
        exercise_id: fs.exId,
        user_id: userId,
        set_order: fs.order + 1,
        weight_kg: parseFloat(fs.row.weight),
        reps: parseInt(fs.row.reps, 10),
      }))
    );
    setSaving(false);

    if (inserted.length === 0) {
      setError('Workout saved, but sets failed to insert.');
      return;
    }

    // Reset form
    setWorkoutName('');
    setOpenExercises({});
    setSuccess(
      `✓ Saved ${inserted.length} set${inserted.length === 1 ? '' : 's'} across ${Object.keys(openExercises).length} exercise${Object.keys(openExercises).length === 1 ? '' : 's'}.`
    );
    setTimeout(() => setSuccess(null), 4000);
    onSaved();
  }

  async function handleDeleteWorkout(id: string) {
    if (!confirm('Delete this workout? Sets will also be removed.')) return;
    const ok = await deleteWorkout(id);
    if (!ok) {
      setError('Failed to delete workout.');
      return;
    }
    onSaved();
  }

  // ─── Helpers for exercise picker ─────────────────────────────────

  // Find the selected exercise object (used for dropdown preview)
  const [selectedExId, setSelectedExId] = useState<string>('');

  function handleAddFromSelect(exId: string) {
    if (!exId) return;
    addExercise(exId);
    setSelectedExId('');
  }

  // ─── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  const exerciseCount = exercises.length;

  return (
    <div className="space-y-6">
      {/* Save error / success */}
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-300">
          {success}
        </div>
      )}

      {/* ── Log Workout form ── */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-100">Log Workout</h3>
          <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-500">
            {exerciseCount} exercise{exerciseCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Date + optional name */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Date
            </label>
            <input
              type="date"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              max={todayISO()}
              className="w-40 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <input
            type="text"
            placeholder="Workout name (optional)"
            value={workoutName}
            onChange={(e) => setWorkoutName(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none min-w-[160px]"
          />
        </div>

        {/* ── Add Exercise ── */}
        <div className="mt-5 border-t border-zinc-800/60 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Exercises & sets
            </span>
            <button
              onClick={() => setShowExManager(true)}
              className="text-xs font-medium text-rose-400 hover:text-rose-300 transition-colors"
            >
              Manage Exercises
            </button>
          </div>

          {/* Exercise selector — always visible */}
          <div className="flex gap-2">
            <select
              value={selectedExId}
              onChange={(e) => setSelectedExId(e.target.value)}
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            >
              <option value="">Select an exercise…</option>
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleAddFromSelect(selectedExId)}
              disabled={!selectedExId}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add
            </button>
          </div>

          {/* Quick-add suggested exercises that haven't been created yet */}
          {exercises.length === 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-zinc-500">
                No exercises yet. Pick from common starters:
              </p>
              <QuickAddSuggestions
                userId={userId}
                onExerciseCreated={(ex) => {
                  setExercises((prev) => [...prev, ex]);
                  addExercise(ex.id);
                }}
              />
            </div>
          )}

          {/* If exercise list is empty, show helpful message */}
          {exercises.length > 0 && (
            <p className="mt-2 text-[10px] text-zinc-600">
              Tip: Use the dropdown above to add exercises. Hit &quot;Manage Exercises&quot; to add custom ones.
            </p>
          )}
        </div>

        {/* ── Open exercise rows ── */}
        {Object.keys(openExercises).length > 0 && (
          <div className="mt-4 space-y-3">
            {Object.entries(openExercises).map(([exId, rows]) => {
              const ex = exercises.find((x) => x.id === exId);
              if (!ex) return null;
              return (
                <div
                  key={exId}
                  className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">
                        {ex.name}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {rows.length} set{rows.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const { [exId]: _, ...rest } = openExercises;
                        setOpenExercises(rest);
                      }}
                      className="text-[10px] font-medium text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Column headers */}
                  <div className="mb-1 grid grid-cols-[auto_1fr_1fr_auto] gap-2 px-1">
                    <span className="text-[9px] uppercase tracking-wider text-zinc-600">#</span>
                    <span className="text-[9px] uppercase tracking-wider text-zinc-600">Weight</span>
                    <span className="text-[9px] uppercase tracking-wider text-zinc-600">Reps</span>
                    <span />
                  </div>

                  <div className="space-y-1.5">
                    {rows.map((row) => (
                      <div
                        key={row.id}
                        className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2"
                      >
                        <span className="w-5 text-center text-[10px] font-mono text-zinc-600">
                          {rows.indexOf(row) + 1}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="kg"
                          value={row.weight}
                          onChange={(e) =>
                            updateSetRow(exId, row.id, { weight: e.target.value })
                          }
                          className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                        />
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder="reps"
                          value={row.reps}
                          onChange={(e) =>
                            updateSetRow(exId, row.id, { reps: e.target.value })
                          }
                          className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
                        />
                        <button
                          onClick={() => removeSetRow(exId, row.id)}
                          className="flex h-7 w-7 items-center justify-center rounded text-zinc-600 hover:bg-red-950/30 hover:text-red-400 transition-colors"
                          aria-label="Remove set"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => addSetRow(exId)}
                    className="mt-2 w-full rounded border border-dashed border-zinc-700 py-1.5 text-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
                  >
                    + Add set
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Save ── */}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-zinc-800/60 pt-4">
          {Object.keys(openExercises).length > 0 && (
            <span className="text-xs text-zinc-500">
              {countTotalSets(openExercises)} set{countTotalSets(openExercises) !== 1 ? 's' : ''} ready
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || Object.keys(openExercises).length === 0}
            className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save Workout'}
          </button>
        </div>
      </div>

      {/* ── Recent workouts ── */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <h3 className="mb-3 text-sm font-semibold text-zinc-100">Recent workouts</h3>
        {recentWorkouts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
            No workouts yet. Save your first session above.
          </p>
        ) : (
          <div className="space-y-2">
            {recentWorkouts.map((w) => {
              const volume = w.sets.reduce(
                (acc, s) => acc + s.weight_kg * s.reps,
                0
              );
              return (
                <div
                  key={w.id}
                  className="group flex items-start justify-between gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/30 px-4 py-3 transition-colors hover:bg-zinc-900/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-200">
                      {w.name ?? 'Workout'}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <span>{formatRel(w.performed_at)}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{w.sets.length} set{w.sets.length === 1 ? '' : 's'}</span>
                      <span className="text-zinc-700">·</span>
                      <span>{volume > 0 ? `${(volume / 1000).toFixed(2)}t volume` : ''}</span>
                    </div>
                    {/* Show exercises used in this workout */}
                    {w.sets.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Array.from(new Set(w.sets.map((s) => {
                          const ex = exercises.find(e => e.id === s.exercise_id);
                          return ex?.name ?? 'Unknown';
                        }))).slice(0, 5).map((name) => (
                          <span
                            key={name}
                            className="rounded-md bg-zinc-800/60 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                          >
                            {name}
                          </span>
                        ))}
                        {new Set(w.sets.map(s => s.exercise_id)).size > 5 && (
                          <span className="text-[10px] text-zinc-600">
                            +{new Set(w.sets.map(s => s.exercise_id)).size - 5} more
                          </span>
                        )}
                      </div>
                    )}
                    {w.notes && (
                      <div className="mt-1 text-xs text-zinc-500">{w.notes}</div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteWorkout(w.id)}
                    className="text-[10px] font-medium text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                    aria-label="Delete workout"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Exercise Manager modal ── */}
      {showExManager && (
        <ExerciseManager
          userId={userId}
          exercises={exercises}
          onExercisesChange={(updated) => setExercises(updated)}
          onClose={() => setShowExManager(false)}
        />
      )}
    </div>
  );
}

// ─── Quick-add suggestions (first-time user) ─────────────────────

function QuickAddSuggestions({
  userId,
  onExerciseCreated,
}: {
  userId: string;
  onExerciseCreated: (ex: Exercise) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);

  async function handleAdd(name: string, category: string) {
    setAdding(name);
    const ex = await findOrCreateExercise(name, userId, category as any);
    setAdding(null);
    if (ex) onExerciseCreated(ex);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {SUGGESTED_EXERCISES.slice(0, 8).map((s) => (
        <button
          key={s.name}
          onClick={() => handleAdd(s.name, s.category)}
          disabled={adding === s.name}
          className="rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
        >
          {adding === s.name ? '…' : `+ ${s.name}`}
        </button>
      ))}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────

interface SetRow {
  id: string;
  weight: string;
  reps: string;
}

function cryptoId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatRel(iso: string): string {
  const days = Math.round(
    (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000)
  );
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function countTotalSets(open: Record<string, SetRow[]>): number {
  return Object.values(open).reduce((sum, rows) => sum + rows.length, 0);
}
