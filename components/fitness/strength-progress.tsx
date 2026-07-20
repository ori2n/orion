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
} from 'recharts';
import { listExercises } from '@/lib/fitness/exercises';
import { listRecentWorkouts, listAllSetsForUser } from '@/lib/fitness/workouts';
import {
  buildExerciseStats,
  describeProgressDelta,
} from '@/lib/fitness/strength';
import { detectRecentPRs } from '@/lib/fitness/flashback';
import type { Exercise, ExerciseStats } from '@/lib/fitness/types';
import type { RecentPR } from '@/lib/fitness/flashback';

/**
 * StrengthProgress — Priority 1 in the user's brief.
 *
 * Three primary surfaces stacked vertically:
 *   1. Exercise picker — which movement to drill into. Default = first
 *      exercise with any logged sets, else first alphabetical.
 *   2. Estimated-1RM timeline chart — main visual proof of progression.
 *   3. PR Leaderboard (🥇🥈🥉) — the actual personal records.
 *
 * Side card shows "Bench increased by 17.5kg since October" style
 * comparisons for the active exercise using `describeProgressDelta`.
 */
export default function StrengthProgress({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [exerciseStatsList, setExerciseStatsList] = useState<ExerciseStats[]>([]);
  const [recentPRs, setRecentPRs] = useState<RecentPR[]>([]);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [exs, sets, workouts] = await Promise.all([
        listExercises(userId),
        listAllSetsForUser(userId),
        listRecentWorkouts(userId, 100),
      ]);
      if (cancelled) return;
      setExercises(exs);

      const wmap = new Map(workouts.map((w) => [w.id, w]));
      const statsList = exs
        .map((ex) => buildExerciseStats(ex, sets, wmap))
        .filter((s) => s.timeline.length > 0 || s.actual_1rm !== null || s.estimated_1rm !== null);
      setExerciseStatsList(statsList);
      setRecentPRs(detectRecentPRs(sets, exs));

      // Default selection: first exercise with data, else first alphabetically.
      if (!activeExerciseId || !exs.find((e) => e.id === activeExerciseId)) {
        const first = statsList[0]?.exercise.id ?? exs[0]?.id ?? null;
        setActiveExerciseId(first);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const activeStats = useMemo(
    () => exerciseStatsList.find((s) => s.exercise.id === activeExerciseId) ?? null,
    [exerciseStatsList, activeExerciseId]
  );

  if (loading) {
    return <SkeletonPanel label="Loading strength data" />;
  }

  // Empty state — encourage first workout.
  if (exerciseStatsList.length === 0) {
    return (
      <EmptyPanel
        title="No strength data yet"
        subtitle="Log a workout to start tracking your personal records and estimated 1RM over time."
        cta="Switch to the Log tab to add your first session."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Recent PRs banner — only renders when there's something to show */}
      {recentPRs.length > 0 && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
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
                    <span className="ml-2 text-[10px] text-rose-400">PR</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Exercise picker */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Exercise
            </div>
            <div className="mt-1 text-base font-medium text-zinc-100">
              {activeStats?.exercise.name ?? exercises[0]?.name}
            </div>
          </div>
          <select
            value={activeExerciseId ?? ''}
            onChange={(e) => setActiveExerciseId(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition-colors focus:border-zinc-500 focus:outline-none"
          >
            {exercises.map((ex) => {
              const hasData = exerciseStatsList.find((s) => s.exercise.id === ex.id);
              return (
                <option key={ex.id} value={ex.id}>
                  {ex.name}{hasData ? '' : ' (no data)'}
                </option>
              );
            })}
          </select>
        </div>
      </Card>

      {activeStats && (
        <>
          {/* Estimated 1RM Timeline + summary stats */}
          <Card title="Estimated 1RM over time" subtitle="Epley formula, capped at 10 reps">
            {activeStats.timeline.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatTile
                    label="Current 1RM"
                    value={
                      activeStats.actual_1rm !== null
                        ? `${activeStats.actual_1rm}kg`
                        : '—'
                    }
                    accent="rose"
                  />
                  <StatTile
                    label="Best est. 1RM"
                    value={
                      activeStats.estimated_1rm !== null
                        ? `${activeStats.estimated_1rm.toFixed(1)}kg`
                        : '—'
                    }
                    accent="indigo"
                  />
                  <StatTile label="Total volume" value={`${(activeStats.total_volume_kg / 1000).toFixed(1)}t`} />
                  <StatTile label="Workouts" value={String(activeStats.workouts_count)} />
                </div>

                <div className="mt-6 h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={activeStats.timeline}
                      margin={{ top: 5, right: 12, left: 0, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="at"
                        tickFormatter={(v) => formatChartDate(v)}
                        stroke="#52525b"
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis
                        stroke="#52525b"
                        tick={{ fontSize: 10 }}
                        domain={['auto', 'auto']}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#18181b',
                          border: '1px solid #27272a',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelFormatter={(v) => formatChartDate(String(v))}
                        formatter={(v) => [`${(v as number).toFixed(1)}kg`, 'Est. 1RM'] as [string, string]}
                      />
                      <Line
                        type="monotone"
                        dataKey="estimated_1rm"
                        stroke="#f43f5e"
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: '#f43f5e' }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <EmptyHint text="No sets logged for this exercise yet" />
            )}
          </Card>

          {/* PR Leaderboard */}
          <Card title="Personal Records" subtitle="🥇 Best weight lifted at each rep count (top 3)">
            {activeStats.pr_leaderboard.length === 0 ? (
              <EmptyHint text="No PRs yet — once you log a set, the heaviest weight at each rep count becomes your record." />
            ) : (
              <div className="space-y-2">
                {activeStats.pr_leaderboard.map((pr, idx) => {
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
                  return (
                    <div
                      key={`${pr.reps}-${pr.workout_id}`}
                      className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:bg-zinc-900/80"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg" aria-hidden>
                          {medal}
                        </span>
                        <div>
                          <div className="font-mono text-base font-semibold text-zinc-100">
                            {pr.weight_kg}kg × {pr.reps}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            Est. 1RM {pr.estimated_1rm.toFixed(1)}kg · {formatRelative(pr.achieved_at)}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-[10px] text-zinc-600">
                        Set {formatChartDate(pr.achieved_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          {/* Progress comparisons — "Bench increased by Xkg since October" */}
          <Card title="Progress comparison" subtitle="Estimated 1RM delta across milestones">
            <div className="space-y-2">
              {[
                { sinceISO: monthsAgoISO(6), label: '6 months ago' },
                { sinceISO: monthsAgoISO(3), label: '3 months ago' },
                { sinceISO: monthsAgoISO(12), label: '1 year ago' },
              ]
                .map(({ sinceISO, label }) =>
                  describeProgressDelta(activeStats, sinceISO)
                )
                .filter((s): s is string => Boolean(s))
                .map((line, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 text-sm text-zinc-200"
                  >
                    {line}
                  </div>
                ))}
              {activeStats.timeline.length < 2 && (
                <EmptyHint text="Need at least 2 sessions to compute a comparison." />
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Shared building blocks ─────────────────────────────────────

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
        <div className="mb-4">
          {title && (
            <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          )}
          {subtitle && (
            <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'rose' | 'indigo';
}) {
  const accentClass =
    accent === 'rose'
      ? 'text-rose-400'
      : accent === 'indigo'
        ? 'text-indigo-400'
        : 'text-zinc-100';
  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-xl font-semibold ${accentClass}`}>
        {value}
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
      {text}
    </p>
  );
}

function EmptyPanel({
  title,
  subtitle,
  cta,
}: {
  title: string;
  subtitle: string;
  cta: string;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-10 text-center">
      <h3 className="text-lg font-semibold text-zinc-200">{title}</h3>
      <p className="mt-2 max-w-md mx-auto text-sm text-zinc-500">{subtitle}</p>
      <p className="mt-3 text-xs font-medium text-rose-400/80">{cta}</p>
    </div>
  );
}

function SkeletonPanel({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
    </div>
  );
}

// ─── Tiny formatting helpers ──────────────────────────────────────

function formatChartDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

function monthsAgoISO(months: number): string {
  return new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString();
}
