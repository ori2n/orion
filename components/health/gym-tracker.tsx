'use client';

import { useState, useEffect, useCallback } from 'react';
import { getWorkoutLogs, insertWorkoutLog } from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { LegacyWorkoutLog } from '@/lib/health/storage';

type WorkoutType = 'upper' | 'lower' | 'push' | 'pull' | 'legs' | 'full';

const WORKOUT_TYPES: { value: WorkoutType; label: string }[] = [
  { value: 'upper', label: 'Upper' },
  { value: 'lower', label: 'Lower' },
  { value: 'push', label: 'Push' },
  { value: 'pull', label: 'Pull' },
  { value: 'legs', label: 'Legs' },
  { value: 'full', label: 'Full Body' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function GymTracker() {
  const [logs, setLogs] = useState<LegacyWorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [workoutType, setWorkoutType] = useState<WorkoutType>('upper');
  const [exercise, setExercise] = useState('');
  const [s1w, setS1w] = useState('');
  const [s1r, setS1r] = useState('');
  const [s1f, setS1f] = useState(true);
  const [s2w, setS2w] = useState('');
  const [s2r, setS2r] = useState('');
  const [s2f, setS2f] = useState(true);
  const [warmup, setWarmup] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getWorkoutLogs(7);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setWorkoutType('upper');
    setExercise('');
    setS1w('');
    setS1r('');
    setS1f(true);
    setS2w('');
    setS2r('');
    setS2f(true);
    setWarmup('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!exercise.trim()) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await insertWorkoutLog({
        workout_type: workoutType,
        exercise: exercise.trim(),
        set1_weight: s1w ? Number(s1w) : null,
        set1_reps: s1r ? Number(s1r) : null,
        set1_failure: s1f,
        set2_weight: s2w ? Number(s2w) : null,
        set2_reps: s2r ? Number(s2r) : null,
        set2_failure: s2f,
        warmup: warmup.trim(),
      });

      if (!result.data) {
        setError(result.error || 'Not signed in — data cannot be saved.');
        return;
      }

      setSuccess('Logged ✓');
      setTimeout(() => setSuccess(null), 2500);
      resetForm();
      notifyHealthDataSaved();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // Group logs by date
  const grouped: Record<string, LegacyWorkoutLog[]> = {};
  for (const log of logs) {
    const key = new Date(log.created_at).toDateString();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(log);
  }

  return (
    <div className="space-y-4">
      {/* Status messages */}
      {error && (
        <p className="rounded-lg bg-red-950/40 px-3 py-2 text-xs text-red-400">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-lg bg-emerald-950/40 px-3 py-2 text-xs text-emerald-400">
          {success}
        </p>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit}>
        {/* Workout Type */}
        <div className="mb-4">
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Workout Type
          </label>
          <div className="flex flex-wrap gap-1.5">
            {WORKOUT_TYPES.map((wt) => (
              <button
                key={wt.value}
                type="button"
                onClick={() => setWorkoutType(wt.value)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                  workoutType === wt.value
                    ? 'border-rose-500/60 bg-rose-500/10 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.15)]'
                    : 'border-zinc-700/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {wt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Exercise */}
        <div className="mb-4">
          <label
            htmlFor="gym-exercise"
            className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500"
          >
            Exercise
          </label>
          <input
            id="gym-exercise"
            type="text"
            placeholder="e.g. Bench Press"
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
            autoFocus
            className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-0"
          />
        </div>

        {/* Warm-up */}
        <div className="mb-4">
          <label
            htmlFor="gym-warmup"
            className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500"
          >
            Warm-up <span className="font-normal lowercase text-zinc-600">(optional)</span>
          </label>
          <input
            id="gym-warmup"
            type="text"
            placeholder="e.g. 40x10"
            value={warmup}
            onChange={(e) => setWarmup(e.target.value)}
            className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-0"
          />
        </div>

        {/* 2 Working Sets */}
        <div className="mb-4 grid grid-cols-2 gap-3">
          {/* Set 1 */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-800/30 p-3">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Set 1
            </p>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Weight</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="kg"
                  value={s1w}
                  onChange={(e) => setS1w(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-0"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Reps</label>
                <input
                  type="number"
                  min={1}
                  placeholder="reps"
                  value={s1r}
                  onChange={(e) => setS1r(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-0"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={s1f}
                  onChange={(e) => setS1f(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-700 text-rose-500 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-[11px] text-zinc-400">Failure</span>
              </label>
            </div>
          </div>

          {/* Set 2 */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-800/30 p-3">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Set 2
            </p>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Weight</label>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  placeholder="kg"
                  value={s2w}
                  onChange={(e) => setS2w(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-0"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-400">Reps</label>
                <input
                  type="number"
                  min={1}
                  placeholder="reps"
                  value={s2r}
                  onChange={(e) => setS2r(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-rose-500/50 focus:outline-none focus:ring-0"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={s2f}
                  onChange={(e) => setS2f(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-700 text-rose-500 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-[11px] text-zinc-400">Failure</span>
              </label>
            </div>
          </div>
        </div>

        {/* Save */}
        <button
          type="submit"
          disabled={saving || !exercise.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-all hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Saving...
            </span>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Log Exercise
            </>
          )}
        </button>
      </form>

      {/* Recent logs */}
      {Object.keys(grouped).length > 0 && (
        <section>
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            This Week
          </h2>
          <div className="space-y-3">
            {Object.entries(grouped).slice(0, 3).map(([dateKey, dayLogs]) => (
              <div key={dateKey}>
                <p className="mb-1.5 text-xs font-medium text-zinc-400">
                  {formatDate(dayLogs[0].created_at)}
                </p>
                <div className="space-y-1">
                  {dayLogs.slice(0, 8).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-zinc-400">
                          {log.workout_type}
                        </span>
                        <span className="truncate text-sm font-medium text-zinc-200">
                          {log.exercise}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {log.warmup && <span className="mr-2 text-zinc-600">{log.warmup}</span>}
                        {log.set1_reps && log.set2_reps
                          ? `${log.set1_weight ?? 'BW'}×${log.set1_reps}, ${log.set2_weight ?? 'BW'}×${log.set2_reps}`
                          : log.set1_reps
                          ? `${log.set1_weight ?? 'BW'}×${log.set1_reps}`
                          : ''}
                        <span className="ml-2 text-zinc-600">{formatTime(log.created_at)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        </div>
      )}
    </div>
  );
}
