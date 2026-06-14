'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import type { WorkoutLog, Activity } from '@/lib/health/storage';

// ─── Helpers ────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function getDateStr(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const FITNESS_HUE = 160; // Green/emerald — matches fitness/node group
const FITNESS_HUE2 = 340; // Rose accent for variety

/** Estimate volume for a single log (kg × reps) */
function logVolume(log: WorkoutLog): number {
  let vol = 0;
  if (log.set1_weight && log.set1_reps) vol += log.set1_weight * log.set1_reps;
  if (log.set2_weight && log.set2_reps) vol += log.set2_weight * log.set2_reps;
  return vol;
}

/** Max 1RM estimate using Epley formula: weight * (1 + reps/30) */
function estimate1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

// ─── Volume Bar Chart ───────────────────────────────────────────────

function VolumeBarChart({
  bars,
  maxVol,
}: {
  bars: { label: string; volume: number; date: Date }[];
  maxVol: number;
}) {
  if (bars.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center">
        <span className="text-[10px] tracking-widest text-zinc-600">NO WORKOUT DATA</span>
      </div>
    );
  }

  const barW = Math.max(14, Math.min(28, 180 / bars.length));
  const gap = Math.max(4, Math.min(10, 140 / bars.length));
  const totalW = bars.length * (barW + gap) - gap;
  const h = 100;

  return (
    <div className="relative">
      <svg width={totalW} height={h + 20} className="overflow-visible">
        {bars.map((bar, i) => {
          const x = i * (barW + gap);
          const barH = Math.max(2, (bar.volume / maxVol) * h);
          const y = h - barH;
          const hue = bar.volume >= maxVol * 0.7 ? FITNESS_HUE : FITNESS_HUE + 20;

          return (
            <g key={i}>
              {/* Glow bar behind */}
              <rect
                x={x}
                y={y - 2}
                width={barW}
                height={barH + 4}
                rx={2}
                fill={`hsla(${hue}, 60%, 50%, 0.1)`}
                filter="url(#vol-bar-glow)"
              />
              {/* Main bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={1.5}
                fill={`hsla(${hue}, 70%, ${40 + (bar.volume / maxVol) * 20}%, ${0.3 + (bar.volume / maxVol) * 0.4})`}
                className="transition-all duration-500"
              />
              {/* Top accent line */}
              <line
                x1={x} y1={y}
                x2={x + barW} y2={y}
                stroke={`hsla(${hue}, 80%, 60%, 0.6)`}
                strokeWidth={1}
                strokeLinecap="round"
              />
              {/* Day label */}
              <text
                x={x + barW / 2}
                y={h + 14}
                textAnchor="middle"
                fill="rgba(148, 163, 184, 0.35)"
                fontSize="7"
                fontFamily="monospace"
              >
                {bar.label.length > 3 ? bar.label.slice(0, 3) : bar.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Exercise Frequency Bar ────────────────────────────────────────

function ExerciseBreakdown({
  exercises,
}: {
  exercises: { name: string; count: number; maxWeight: number }[];
}) {
  if (exercises.length === 0) return null;
  const maxCount = Math.max(...exercises.map((e) => e.count));

  return (
    <div className="space-y-1.5">
      {exercises.slice(0, 6).map((ex, i) => (
        <div key={ex.name} className="flex items-center gap-2">
          <span className="w-16 truncate text-[8px] tracking-wider text-zinc-400">
            {ex.name}
          </span>
          <div className="relative flex-1 h-3 rounded-full" style={{
            background: 'rgba(148, 163, 184, 0.04)',
          }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(ex.count / maxCount) * 100}%`,
                background: `linear-gradient(90deg, hsla(${FITNESS_HUE}, 60%, 45%, 0.3), hsla(${FITNESS_HUE}, 70%, 50%, 0.5))`,
                boxShadow: `0 0 6px hsla(${FITNESS_HUE}, 60%, 45%, 0.15)`,
              }}
            />
          </div>
          <span className="w-6 text-right text-[7px] font-mono text-zinc-500">{ex.count}</span>
          {ex.maxWeight > 0 && (
            <span className="w-12 text-right text-[7px] font-mono text-zinc-600">{ex.maxWeight}kg</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Workout Type Distribution ─────────────────────────────────────

function TypeDistribution({
  types,
}: {
  types: { type: string; count: number; pct: number }[];
}) {
  if (types.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {types.map((t) => (
        <div
          key={t.type}
          className="flex items-center gap-1.5 rounded-full px-2 py-1"
          style={{
            background: `hsla(${FITNESS_HUE}, 40%, 20%, 0.15)`,
            border: `1px solid hsla(${FITNESS_HUE}, 40%, 35%, 0.1)`,
          }}
        >
          <span className="text-[8px] font-medium uppercase tracking-wider text-zinc-300">
            {t.type}
          </span>
          <span className="text-[7px] font-mono text-zinc-500">{t.count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  hue = FITNESS_HUE,
}: {
  label: string;
  value: string;
  sub?: string;
  hue?: number;
}) {
  return (
    <div
      className="relative flex-1 rounded-xl border px-3 py-2.5"
      style={{
        borderColor: `hsla(${hue}, 40%, 40%, 0.1)`,
        background: `hsla(${hue}, 30%, 10%, 0.3)`,
      }}
    >
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, hsla(${hue}, 60%, 50%, 0.2), transparent)`,
        }}
      />
      <p className="text-[7px] tracking-[0.2em] text-zinc-600">{label}</p>
      <p
        className="mt-0.5 font-semibold leading-none tracking-tight"
        style={{
          fontSize: '18px',
          color: `hsla(${hue}, 70%, 60%, 0.9)`,
          textShadow: `0 0 20px hsla(${hue}, 70%, 50%, 0.2)`,
        }}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[7px] tracking-wider text-zinc-600">{sub}</p>}
    </div>
  );
}

// ─── PR Badge ───────────────────────────────────────────────────────

function PRBadge({ exercise, weight, reps }: { exercise: string; weight: number; reps: number }) {
  const estimated1RM = estimate1RM(weight, reps);
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{
      borderColor: `hsla(${FITNESS_HUE2}, 40%, 40%, 0.12)`,
      background: `hsla(${FITNESS_HUE2}, 30%, 12%, 0.15)`,
    }}>
      <span className="text-[10px]">🏆</span>
      <div className="flex-1">
        <span className="text-[9px] font-medium tracking-wider text-zinc-300">{exercise}</span>
        <span className="ml-2 text-[8px] font-mono text-zinc-500">
          {weight}kg × {reps}
        </span>
      </div>
      <span className="text-[8px] font-mono" style={{
        color: `hsla(${FITNESS_HUE2}, 70%, 60%, 0.7)`,
      }}>
        ~{estimated1RM}kg 1RM
      </span>
      <div className="h-2 w-2 rounded-full" style={{
        background: `hsla(${FITNESS_HUE2}, 70%, 60%, 0.6)`,
        boxShadow: `0 0 6px hsla(${FITNESS_HUE2}, 70%, 50%, 0.3)`,
        animation: 'pulse-glow 2s ease-in-out infinite',
      }} />
    </div>
  );
}

// ─── Activity Mini ──────────────────────────────────────────────────

function ActivityMini({ logs }: { logs: Activity[] }) {
  if (logs.length === 0) return null;
  const totalMin = logs.reduce((s, l) => s + l.duration_minutes, 0);

  return (
    <div className="rounded-xl border px-3 py-2.5" style={{
      borderColor: `hsla(${FITNESS_HUE + 30}, 40%, 40%, 0.08)`,
      background: `hsla(${FITNESS_HUE + 30}, 20%, 10%, 0.15)`,
    }}>
      <div className="flex items-center justify-between">
        <span className="text-[7px] tracking-[0.2em] text-zinc-600">ACTIVITY</span>
        <span className="text-[9px] font-semibold font-mono" style={{
          color: `hsla(${FITNESS_HUE + 30}, 70%, 60%, 0.8)`,
        }}>
          {totalMin}m
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {logs.reverse().slice(0, 5).map((log, i) => (
          <span key={log.id || i} className="rounded-full px-2 py-0.5 text-[7px]" style={{
            background: 'rgba(148, 163, 184, 0.04)',
            color: 'rgba(148, 163, 184, 0.5)',
          }}>
            {log.activity_type} · {log.duration_minutes}m
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function FitnessAnalytics({
  workoutLogs,
  activityLogs,
  onOpenTracker,
}: {
  workoutLogs: WorkoutLog[];
  activityLogs: Activity[];
  onOpenTracker?: () => void;
}) {
  const [activeView, setActiveView] = useState<'volume' | 'exercises'>('volume');

  const stats = useMemo(() => {
    if (workoutLogs.length === 0) {
      return {
        totalWorkouts: 0,
        totalExercises: 0,
        totalVolume: 0,
        avgVolume: 0,
        volumeBars: [] as { label: string; volume: number; date: Date }[],
        exercises: [] as { name: string; count: number; maxWeight: number }[],
        typeDist: [] as { type: string; count: number; pct: number }[],
        prs: [] as { exercise: string; weight: number; reps: number; date: Date }[],
        latest: null as WorkoutLog | null,
      };
    }

    const sorted = [...workoutLogs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    // Aggregate volume by date
    const volByDate = new Map<string, { volume: number; date: Date }>();
    for (const log of sorted) {
      const dateStr = getDateStr(log.created_at);
      const vol = logVolume(log);
      const existing = volByDate.get(dateStr);
      if (existing) {
        existing.volume += vol;
      } else {
        volByDate.set(dateStr, { volume: vol, date: new Date(log.created_at) });
      }
    }

    const volumeBars = Array.from(volByDate.entries())
      .map(([label, val]) => ({ label, volume: val.volume, date: val.date }));

    // Exercise frequency + PR tracking
    const exerciseMap = new Map<string, { count: number; maxWeight: number }>();
    const prMap = new Map<string, { weight: number; reps: number; date: Date }>();
    for (const log of sorted) {
      const exName = log.exercise.toLowerCase();
      const existing = exerciseMap.get(exName) ?? { count: 0, maxWeight: 0 };
      existing.count++;
      if (log.set1_weight && existing.maxWeight < log.set1_weight) {
        existing.maxWeight = log.set1_weight;
      }
      if (log.set2_weight && existing.maxWeight < log.set2_weight) {
        existing.maxWeight = log.set2_weight;
      }
      exerciseMap.set(exName, existing);

      // PR: track highest weight per exercise
      const pr = prMap.get(exName);
      const bestWeight = Math.max(log.set1_weight ?? 0, log.set2_weight ?? 0);
      if (bestWeight > 0 && (!pr || bestWeight > pr.weight)) {
        prMap.set(exName, {
          weight: bestWeight,
          reps: log.set1_weight === bestWeight ? (log.set1_reps ?? 0) : (log.set2_reps ?? 0),
          date: new Date(log.created_at),
        });
      }
    }

    const exercises = Array.from(exerciseMap.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count);

    // Workout type distribution
    const typeMap = new Map<string, number>();
    for (const log of sorted) {
      typeMap.set(log.workout_type, (typeMap.get(log.workout_type) ?? 0) + 1);
    }
    const total = sorted.length;
    const typeDist = Array.from(typeMap.entries())
      .map(([type, count]) => ({ type, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);

    const prs = Array.from(prMap.entries())
      .map(([exercise, data]) => ({ exercise, ...data }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    const totalVolume = sorted.reduce((s, l) => s + logVolume(l), 0);
    const latest = sorted[sorted.length - 1] ?? null;

    return {
      totalWorkouts: sorted.length,
      totalExercises: exercises.length,
      totalVolume: Math.round(totalVolume),
      avgVolume: Math.round(avg(sorted.map((l) => logVolume(l)))),
      volumeBars,
      exercises,
      typeDist,
      prs,
      latest,
    };
  }, [workoutLogs]);

  const maxVol = useMemo(() => {
    if (stats.volumeBars.length === 0) return 1000;
    return Math.max(...stats.volumeBars.map((b) => b.volume), 100) * 1.15;
  }, [stats.volumeBars]);

  const hasData = workoutLogs.length > 0;

  // ── Animated workout counter ──
  const [displayCount, setDisplayCount] = useState('--');
  const countRef = useRef(0);
  const countAnimRef = useRef<number>(0);

  useEffect(() => {
    const target = stats.totalWorkouts;
    if (target === 0) { setDisplayCount('--'); return; }
    const start = countRef.current;
    let frame = 0;
    const animate = () => {
      frame++;
      const progress = Math.min(1, frame / 35);
      const eased = 1 - (1 - progress) ** 3;
      const current = Math.round(start + (target - start) * eased);
      countRef.current = current;
      setDisplayCount(current.toString());
      if (progress < 1) countAnimRef.current = requestAnimationFrame(animate);
    };
    countAnimRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(countAnimRef.current);
  }, [stats.totalWorkouts]);

  return (
    <div className="select-none">
      {/* ── SVG Filters ── */}
      <svg className="pointer-events-none absolute" width={0} height={0}>
        <defs>
          <filter id="vol-bar-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id="fitness-text-glow">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: `hsla(${FITNESS_HUE}, 50%, 30%, 0.15)`,
              boxShadow: `0 0 12px hsla(${FITNESS_HUE}, 60%, 40%, 0.1)`,
            }}
          >
            <span style={{ fontSize: '14px', filter: 'url(#fitness-text-glow)' }}>⚡</span>
          </div>
          <div>
            <p className="font-semibold tracking-[0.3em] text-[11px]"
              style={{ color: `hsla(${FITNESS_HUE}, 60%, 60%, 0.8)` }}>
              SYS.FITNESS
            </p>
            <p className="text-[7px] tracking-[0.2em] text-zinc-600">ANALYTICS MODULE</p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 rounded-full p-0.5" style={{ background: 'rgba(148, 163, 184, 0.04)' }}>
          {(['volume', 'exercises'] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className="rounded-full px-2.5 py-1 text-[7px] tracking-[0.2em] transition-all duration-300 uppercase"
              style={{
                color: activeView === view
                  ? `hsla(${FITNESS_HUE}, 60%, 60%, 0.9)`
                  : 'rgba(148, 163, 184, 0.3)',
                background: activeView === view
                  ? `hsla(${FITNESS_HUE}, 40%, 20%, 0.3)`
                  : 'transparent',
              }}
            >
              {view}
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full"
            style={{ border: '1px dashed hsla(160, 30%, 30%, 0.2)' }}
          >
            <span className="text-xl opacity-30">⚡</span>
          </div>
          <p className="text-[10px] tracking-[0.3em] text-zinc-600">NO WORKOUT DATA</p>
          <p className="text-[8px] text-zinc-700">Begin logging gym sessions to see analytics</p>
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-2 rounded-lg px-4 py-2 text-[9px] tracking-[0.2em] transition-all duration-300"
              style={{
                color: `hsla(${FITNESS_HUE}, 50%, 60%, 0.8)`,
                border: `1px solid hsla(${FITNESS_HUE}, 30%, 30%, 0.2)`,
                background: `hsla(${FITNESS_HUE}, 30%, 15%, 0.2)`,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = `hsla(${FITNESS_HUE}, 30%, 20%, 0.3)`}
              onMouseLeave={(e) => e.currentTarget.style.background = `hsla(${FITNESS_HUE}, 30%, 15%, 0.2)`}
            >
              INITIALIZE DATA LINK ⟶
            </button>
          )}
        </div>
      ) : (
        <>
          {activeView === 'volume' ? (
            <>
              {/* ── Hero section — volume ── */}
              <div
                className="relative mb-4 overflow-hidden rounded-2xl border px-5 py-4"
                style={{
                  borderColor: `hsla(${FITNESS_HUE}, 40%, 40%, 0.08)`,
                  background: `linear-gradient(135deg, hsla(${FITNESS_HUE}, 30%, 8%, 0.6), hsla(${FITNESS_HUE + 40}, 20%, 5%, 0.3))`,
                }}
              >
                {/* Ambient glow orbs */}
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20"
                  style={{
                    background: `radial-gradient(circle, hsla(${FITNESS_HUE}, 70%, 50%, 0.3), transparent)`,
                    animation: 'pulse-glow 4s ease-in-out infinite',
                  }}
                />
                <div
                  className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full opacity-10"
                  style={{
                    background: `radial-gradient(circle, hsla(${FITNESS_HUE2}, 60%, 50%, 0.2), transparent)`,
                    animation: 'pulse-glow 5s ease-in-out 2s infinite',
                  }}
                />

                <div className="relative">
                  <p className="text-[7px] tracking-[0.2em] text-zinc-600">TOTAL WORKOUTS</p>
                  <div className="mt-1 flex items-end gap-3">
                    <p
                      className="text-3xl font-bold leading-none tracking-tight"
                      style={{
                        color: `hsla(${FITNESS_HUE}, 70%, 65%, 0.95)`,
                        textShadow: `0 0 30px hsla(${FITNESS_HUE}, 70%, 50%, 0.25), 0 0 60px hsla(${FITNESS_HUE}, 70%, 40%, 0.1)`,
                      }}
                    >
                      {displayCount}
                      <span className="text-sm text-zinc-500"> sessions</span>
                    </p>
                  </div>
                  <p className="mt-1.5 text-[8px] tracking-wider text-zinc-600">
                    {stats.totalVolume.toLocaleString()}kg total volume
                  </p>
                </div>

                {/* Neon underline */}
                <div
                  className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, hsla(${FITNESS_HUE}, 70%, 50%, 0.3), transparent)`,
                  }}
                />
              </div>

              {/* ── Metric cards ── */}
              <div className="mb-4 flex gap-2">
                <MetricCard
                  label="AVG VOLUME"
                  value={`${stats.avgVolume}kg`}
                  sub="per session"
                />
                <MetricCard
                  label="EXERCISES"
                  value={`${stats.totalExercises}`}
                  sub="unique movements"
                  hue={FITNESS_HUE + 30}
                />
                <MetricCard
                  label="DAYS ACTIVE"
                  value={`${stats.volumeBars.length}`}
                  sub="with data"
                  hue={FITNESS_HUE2}
                />
              </div>

              {/* ── Volume bar chart ── */}
              <div className="mb-3">
                <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">VOLUME OVERVIEW</p>
                <VolumeBarChart bars={stats.volumeBars} maxVol={maxVol} />
              </div>

              {/* ── Workout type distribution ── */}
              {stats.typeDist.length > 0 && (
                <div className="mb-3">
                  <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">WORKOUT TYPES</p>
                  <TypeDistribution types={stats.typeDist} />
                </div>
              )}

              {/* ── Activity mini ── */}
              {activityLogs.length > 0 && (
                <div className="mb-3">
                  <ActivityMini logs={activityLogs} />
                </div>
              )}

              {/* ── Latest log ── */}
              {stats.latest && (
                <>
                  <div className="my-3 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.04)' }} />
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full" style={{
                        background: `hsla(${FITNESS_HUE}, 70%, 60%, 0.6)`,
                        boxShadow: `0 0 4px hsla(${FITNESS_HUE}, 70%, 50%, 0.3)`,
                        animation: 'pulse-glow 2s ease-in-out infinite',
                      }} />
                      <span className="text-[8px] tracking-wider text-zinc-600">LATEST SESSION</span>
                    </div>
                    <span className="text-[8px] font-mono text-zinc-500">
                      {stats.latest.exercise} · {fmtDate(stats.latest.created_at)}
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* ── Exercises View ── */}
              <div
                className="relative mb-4 overflow-hidden rounded-2xl border px-5 py-4"
                style={{
                  borderColor: `hsla(${FITNESS_HUE + 30}, 40%, 40%, 0.08)`,
                  background: `linear-gradient(135deg, hsla(${FITNESS_HUE + 30}, 30%, 8%, 0.6), hsla(${FITNESS_HUE2}, 20%, 5%, 0.3))`,
                }}
              >
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-15"
                  style={{
                    background: `radial-gradient(circle, hsla(${FITNESS_HUE + 30}, 70%, 50%, 0.2), transparent)`,
                    animation: 'pulse-glow 4s ease-in-out infinite',
                  }}
                />
                <div className="relative">
                  <p className="text-[7px] tracking-[0.2em] text-zinc-600">EXERCISE BREAKDOWN</p>
                  <p className="mt-1 text-2xl font-bold leading-none tracking-tight"
                    style={{
                      color: `hsla(${FITNESS_HUE + 30}, 70%, 65%, 0.95)`,
                      textShadow: `0 0 30px hsla(${FITNESS_HUE + 30}, 70%, 50%, 0.25)`,
                    }}>
                    {stats.totalExercises}
                    <span className="text-sm text-zinc-500"> exercises</span>
                  </p>
                  <p className="mt-1 text-[8px] tracking-wider text-zinc-600">
                    across {stats.totalWorkouts} sessions
                  </p>
                </div>
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, hsla(${FITNESS_HUE + 30}, 70%, 50%, 0.3), transparent)`,
                  }}
                />
              </div>

              {/* Exercise frequency bars */}
              <div className="mb-4">
                <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">FREQUENCY · MOST TO LEAST</p>
                <ExerciseBreakdown exercises={stats.exercises} />
              </div>

              {/* PRs */}
              {stats.prs.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">PERSONAL RECORDS</p>
                  <div className="space-y-1.5">
                    {stats.prs.slice(0, 4).map((pr, i) => (
                      <PRBadge
                        key={`${pr.exercise}-${i}`}
                        exercise={pr.exercise}
                        weight={pr.weight}
                        reps={pr.reps}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Latest PR detail */}
              {stats.prs.length > 0 && (
                <MetricCard
                  label="BEST LIFT"
                  value={`${stats.prs[0].weight}kg`}
                  sub={`${stats.prs[0].exercise} · ${stats.prs[0].reps} reps`}
                  hue={FITNESS_HUE2}
                />
              )}
            </>
          )}

          {/* ── Action button ── */}
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-3 w-full rounded-xl py-2.5 text-[9px] tracking-[0.25em] transition-all duration-300"
              style={{
                color: `hsla(${FITNESS_HUE}, 50%, 60%, 0.7)`,
                border: `1px solid hsla(${FITNESS_HUE}, 30%, 30%, 0.12)`,
                background: `hsla(${FITNESS_HUE}, 30%, 12%, 0.15)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `hsla(${FITNESS_HUE}, 30%, 18%, 0.25)`;
                e.currentTarget.style.borderColor = `hsla(${FITNESS_HUE}, 40%, 40%, 0.2)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `hsla(${FITNESS_HUE}, 30%, 12%, 0.15)`;
                e.currentTarget.style.borderColor = `hsla(${FITNESS_HUE}, 30%, 30%, 0.12)`;
              }}
            >
              ◆ LOG GYM DATA ⟶
            </button>
          )}
        </>
      )}
    </div>
  );
}
