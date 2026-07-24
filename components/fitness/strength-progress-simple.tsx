'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { listExercises } from '@/lib/fitness/exercises';
import {
  listStrengthLogs,
  groupByExercise,
  currentBest,
  previousBest,
  formatEntry,
  buildTimeline,
  deleteStrengthLog,
  type StrengthLogEntry,
} from '@/lib/fitness/strength-logs';
import type { Exercise } from '@/lib/fitness/types';

/**
 * StrengthProgressSimple — per-exercise progress with simple weight graphs.
 *
 * Replaces the old StrengthProgress which computed estimated 1RM, PR
 * leaderboards, volume, and flashback comparisons. The new version is
 * focused: pick an exercise → see current/previous best → see weight
 * progression over time → browse history.
 *
 * Each exercise card shows:
 *   - Current best working set
 *   - Previous best working set
 *   - Weight progression line graph
 *   - Workout history list
 */
export default function StrengthProgressSimple({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [allLogs, setAllLogs] = useState<StrengthLogEntry[]>([]);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [exs, logs] = await Promise.all([
        listExercises(userId),
        listStrengthLogs(userId),
      ]);
      if (cancelled) return;
      setExercises(exs);
      setAllLogs(logs);

      // Default to first exercise that has logs, else first exercise
      const grouped = groupByExercise(logs);
      const firstWithData = exs.find((e) => grouped.has(e.id));
      if (!activeExerciseId || !exs.find((e) => e.id === activeExerciseId)) {
        setActiveExerciseId(firstWithData?.id ?? exs[0]?.id ?? null);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  // Group logs by exercise
  const groupedLogs = useMemo(
    () => groupByExercise(allLogs),
    [allLogs],
  );

  // Exercise ID → name map
  const exerciseMap = useMemo(
    () => new Map(exercises.map((e) => [e.id, e.name])),
    [exercises],
  );

  // Exercises that have at least one log entry
  const exercisesWithData = useMemo(
    () => exercises.filter((e) => (groupedLogs.get(e.id)?.length ?? 0) > 0),
    [exercises, groupedLogs],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          <span className="text-xs text-zinc-500">Loading strength data</span>
        </div>
      </div>
    );
  }

  // Empty state
  if (exercisesWithData.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-10 text-center">
        <h3 className="text-lg font-semibold text-zinc-200">
          No strength data yet
        </h3>
        <p className="mt-2 mx-auto max-w-md text-sm text-zinc-500">
          Log a workout to start tracking your best working sets and
          weight progression over time.
        </p>
      </div>
    );
  }

  const activeLogs = activeExerciseId
    ? groupedLogs.get(activeExerciseId) ?? []
    : [];
  const current = currentBest(activeLogs);
  const previous = previousBest(activeLogs);
  const timeline = buildTimeline(activeLogs);

  return (
    <div className="space-y-6">
      {/* Exercise selector */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Exercise
            </div>
            <div className="mt-1 text-base font-medium text-zinc-100">
              {activeExerciseId
                ? exerciseMap.get(activeExerciseId) ?? 'Unknown'
                : 'Select an exercise'}
            </div>
          </div>
          <select
            value={activeExerciseId ?? ''}
            onChange={(e) => setActiveExerciseId(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-zinc-500 focus:outline-none"
          >
            {exercisesWithData.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {current && (
        <>
          {/* Current / Previous best card */}
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Best working set
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-zinc-500">Current</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-zinc-100">
                  {formatEntry(current)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">
                  {formatDate(current.performed_at)}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Previous</div>
                {previous ? (
                  <>
                    <div className="mt-1 font-mono text-2xl font-semibold text-zinc-400">
                      {formatEntry(previous)}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {formatDate(previous.performed_at)}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 font-mono text-2xl font-semibold text-zinc-600">
                    —
                  </div>
                )}
              </div>
            </div>

            {/* Delta indicator */}
            {previous && (
              <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                <span className="text-sm text-zinc-300">
                  {describeDelta(current, previous)}
                </span>
              </div>
            )}
          </div>

          {/* Weight progression graph */}
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
            <h3 className="mb-1 text-sm font-semibold text-zinc-100">
              Weight progression
            </h3>
            <p className="mb-4 text-xs text-zinc-500">
              Best working weight over time
            </p>
            {timeline.length >= 2 ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={timeline}
                    margin={{ top: 5, right: 12, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatChartDate}
                      stroke="#52525b"
                      tick={{ fontSize: 10 }}
                    />
                    <YAxis
                      stroke="#52525b"
                      tick={{ fontSize: 10 }}
                      domain={['dataMin - 5', 'dataMax + 5']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#18181b',
                        border: '1px solid #27272a',
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(label) =>
                        formatChartDate(String(label))
                      }
                      formatter={(value: unknown) => [
                        `${value}kg`,
                        'Weight',
                      ]}
                    />
                    <ReferenceLine
                      y={timeline[0]?.weight_kg}
                      stroke="#52525b"
                      strokeDasharray="4 4"
                      strokeOpacity={0.4}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight_kg"
                      stroke="#f43f5e"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: '#f43f5e' }}
                      activeDot={{ r: 5 }}
                      name="Weight"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
                Log at least two sessions to see a progression graph.
              </p>
            )}
          </div>

          {/* History */}
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
            <h3 className="mb-1 text-sm font-semibold text-zinc-100">
              Workout history
            </h3>
            <p className="mb-4 text-xs text-zinc-500">
              Every logged entry for this exercise
            </p>
            {activeLogs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
                No entries yet.
              </p>
            ) : (
              <ul className="divide-y divide-zinc-800/50">
                {[...activeLogs]
                  .sort(
                    (a, b) =>
                      new Date(b.performed_at).getTime() -
                      new Date(a.performed_at).getTime(),
                  )
                  .map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm font-semibold text-zinc-100">
                          {formatEntry(entry)}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {formatDate(entry.performed_at)}
                          {entry.notes && (
                            <span className="ml-2 text-zinc-600">
                              — {entry.notes}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          const ok = await deleteStrengthLog(entry.id);
                          if (ok) {
                            setAllLogs((prev) => {
                              const next = prev.filter((l) => l.id !== entry.id);
                              // If the deleted entry was the last one for the
                              // currently-selected exercise, reset selection
                              // to the first available exercise.
                              const stillHasData = next.some(
                                (l) => l.exercise_id === activeExerciseId,
                              );
                              if (!stillHasData) {
                                const nextGrouped = groupByExercise(next);
                                const first = exercises.find((e) =>
                                  nextGrouped.has(e.id),
                                );
                                setActiveExerciseId(first?.id ?? null);
                              }
                              return next;
                            });
                          }
                        }}
                        className="text-[10px] font-medium text-zinc-600 hover:text-red-400 transition-colors"
                        title="Delete this entry"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatChartDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function describeDelta(
  current: StrengthLogEntry,
  previous: StrengthLogEntry,
): string {
  const delta = Number(current.weight_kg) - Number(previous.weight_kg);
  if (delta === 0) return 'Same weight as last session.';
  const arrow = delta > 0 ? '↑' : '↓';
  const absStr = Math.abs(delta).toFixed(1);
  let msg = `${arrow} ${absStr}kg from previous (${formatEntry(previous)})`;

  // Reps comparison if both have reps
  if (current.reps !== null && previous.reps !== null) {
    if (current.weight_kg === previous.weight_kg) {
      const repDelta = current.reps - previous.reps;
      if (repDelta !== 0) {
        const rArrow = repDelta > 0 ? '↑' : '↓';
        msg = `Same weight, reps ${rArrow} ${Math.abs(repDelta)} (from ${previous.reps} → ${current.reps})`;
      }
    }
  }

  return msg;
}
