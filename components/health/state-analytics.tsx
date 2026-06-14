'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import type { ManualInput } from '@/lib/health/storage';

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

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  const sq = arr.map((v) => (v - mean) ** 2);
  return Math.sqrt(sq.reduce((a, b) => a + b, 0) / (arr.length - 1));
}

const STATE_HUE = 240; // Indigo — distinct from sleep's violet (260)

/** Invert 1–10 scale: high input → good output */
function invert(v: number): number {
  return 11 - v;
}

function scoreLabel(val: number): string {
  if (val >= 9) return 'PEAK';
  if (val >= 7) return 'GOOD';
  if (val >= 5) return 'FAIR';
  if (val >= 3) return 'LOW';
  return 'DEPLETED';
}

function scoreColor(val: number, inverted = false): number {
  const v = inverted ? invert(val) : val;
  if (v >= 8) return 160; // green
  if (v >= 6) return 100; // amber
  if (v >= 4) return 45;  // orange
  return 0;                // red
}

// ─── Mini Gauge Ring ────────────────────────────────────────────────

function GaugeRing({
  value,
  label,
  max = 10,
  inverted = false,
  size = 52,
  strokeW = 3.5,
}: {
  value: number;
  label: string;
  max?: number;
  inverted?: boolean;
  size?: number;
  strokeW?: number;
}) {
  const r = (size - strokeW) / 2;
  const circ = 2 * Math.PI * r;
  const displayVal = inverted ? invert(value) : value;
  const pct = displayVal / max;
  const offset = circ - pct * circ;
  const hue = scoreColor(value, inverted);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgba(148, 163, 184, 0.06)"
          strokeWidth={strokeW}
        />
        {/* Glow */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={`hsla(${hue}, 70%, 50%, 0.2)`}
          strokeWidth={strokeW + 2}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          filter="url(#state-gauge-glow)"
        />
        {/* Arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none"
          stroke={`hsla(${hue}, 75%, 55%, 0.7)`}
          strokeWidth={strokeW}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="text-[9px] font-semibold" style={{
        color: `hsla(${hue}, 70%, 55%, 0.8)`,
        textShadow: `0 0 10px hsla(${hue}, 70%, 40%, 0.15)`,
      }}>
        {displayVal}
      </span>
      <span className="text-[6px] tracking-[0.2em] text-zinc-600">{label}</span>
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────

function Sparkline({
  data,
  hue,
  className,
}: {
  data: number[];
  hue: number;
  className?: string;
}) {
  if (data.length < 2) return null;
  const w = Math.max(40, data.length * 14);
  const h = 22;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${i * 14 + 7},${h - (v / max) * (h - 2) - 1}`).join(' ');

  return (
    <svg width={w} height={h} className={className}>
      <defs>
        <filter id={`spark-glow-${hue}`}>
          <feGaussianBlur stdDeviation="1" />
        </filter>
      </defs>
      {/* Glow line */}
      <polyline
        points={pts}
        fill="none"
        stroke={`hsla(${hue}, 70%, 50%, 0.2)`}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#spark-glow-${hue})`}
      />
      {/* Main line */}
      <polyline
        points={pts}
        fill="none"
        stroke={`hsla(${hue}, 70%, 55%, 0.6)`}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  hue = STATE_HUE,
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

// ─── Mood Tag ───────────────────────────────────────────────────────

function MoodTag({ mood, time }: { mood: string; time: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
      style={{
        borderColor: `hsla(${STATE_HUE}, 30%, 30%, 0.08)`,
        background: `hsla(${STATE_HUE}, 20%, 10%, 0.15)`,
      }}
    >
      <div
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: `hsla(${STATE_HUE}, 70%, 60%, 0.5)`,
          boxShadow: `0 0 4px hsla(${STATE_HUE}, 70%, 50%, 0.2)`,
        }}
      />
      <span className="flex-1 text-[9px] tracking-wide text-zinc-400">{mood}</span>
      <span className="text-[7px] font-mono text-zinc-600">{time}</span>
    </div>
  );
}

// ─── Composite Score Gauge ──────────────────────────────────────────

function CompositeScore({ wellbeing }: { wellbeing: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (wellbeing === 0) { setDisplay(0); return; }
    const start = ref.current;
    const step = (wellbeing - start) / 30;
    let frame = 0;
    const animate = () => {
      frame++;
      const progress = Math.min(1, frame / 30);
      const eased = 1 - (1 - progress) ** 3;
      const current = start + (wellbeing - start) * eased;
      ref.current = current;
      setDisplay(Math.round(current));
      if (progress < 1) animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [wellbeing]);

  const hue = wellbeing >= 7.5 ? 160 : wellbeing >= 5 ? 100 : wellbeing >= 3 ? 45 : 0;
  const label = scoreLabel(wellbeing);

  return (
    <div className="flex flex-col items-center">
      <p className="text-[7px] tracking-[0.2em] text-zinc-600">WELL-BEING INDEX</p>
      <p className="mt-1 text-2xl font-bold leading-none tracking-tight" style={{
        color: `hsla(${hue}, 75%, 55%, 0.9)`,
        textShadow: `0 0 20px hsla(${hue}, 70%, 40%, 0.2)`,
      }}>
        {display}
        <span className="text-sm text-zinc-600">/10</span>
      </p>
      <p className="mt-0.5 text-[8px] font-semibold tracking-[0.25em]" style={{
        color: `hsla(${hue}, 60%, 50%, 0.6)`,
      }}>
        {label}
      </p>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function StateAnalytics({
  logs,
  onOpenTracker,
}: {
  logs: ManualInput[];
  onOpenTracker?: () => void;
}) {
  const [activeView, setActiveView] = useState<'metrics' | 'moods'>('metrics');

  const stats = useMemo(() => {
    if (logs.length === 0) {
      return {
        avgEnergy: 0,
        avgStress: 0,
        avgSoreness: 0,
        wellbeing: 0,
        consistency: 0,
        latest: null as ManualInput | null,
        sorted: [] as ManualInput[],
        energyTrend: [] as number[],
        stressTrend: [] as number[],
        sorenessTrend: [] as number[],
      };
    }

    const sorted = [...logs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const energies = sorted.map((l) => l.energy_level);
    const stresses = sorted.map((l) => invert(l.stress_level));
    const sorenesses = sorted.map((l) => invert(l.soreness_level));

    const avgEnergy = avg(energies);
    const avgStress = avg(stresses);
    const avgSoreness = avg(sorenesses);

    // Well-being: average of inverted stress + inverted soreness + energy
    const wellbeingRaw = (avgEnergy + avgStress + avgSoreness) / 3;

    // Consistency (lower std dev = more consistent)
    const allInverted = sorted.map((l) => (l.energy_level + invert(l.stress_level) + invert(l.soreness_level)) / 3);
    const cons = Math.max(0, 100 - Math.round(stdDev(allInverted) * 15));

    return {
      avgEnergy: Math.round(avgEnergy * 10) / 10,
      avgStress: Math.round(avg(stresses) * 10) / 10,
      avgSoreness: Math.round(avg(sorenesses) * 10) / 10,
      wellbeing: Math.round(wellbeingRaw * 10) / 10,
      consistency: Math.min(100, cons),
      latest: sorted[sorted.length - 1] ?? null,
      sorted,
      energyTrend: energies,
      stressTrend: sorted.map((l) => l.stress_level),
      sorenessTrend: sorted.map((l) => l.soreness_level),
    };
  }, [logs]);

  const hasData = logs.length > 0;

  // ── Animated energy counter ──
  const [displayEnergy, setDisplayEnergy] = useState('--');
  const energyRef = useRef(0);
  const energyAnimRef = useRef<number>(0);

  useEffect(() => {
    const target = stats.latest?.energy_level ?? 0;
    if (target === 0) { setDisplayEnergy('--'); return; }
    const start = energyRef.current;
    let frame = 0;
    const animate = () => {
      frame++;
      const progress = Math.min(1, frame / 25);
      const eased = 1 - (1 - progress) ** 3;
      const current = start + (target - start) * eased;
      energyRef.current = current;
      setDisplayEnergy(Math.round(current).toString());
      if (progress < 1) energyAnimRef.current = requestAnimationFrame(animate);
    };
    energyAnimRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(energyAnimRef.current);
  }, [stats.latest?.energy_level]);

  const energyHue = stats.latest ? scoreColor(stats.latest.energy_level) : STATE_HUE;

  return (
    <div className="select-none">
      {/* ── SVG Filters ── */}
      <svg className="pointer-events-none absolute" width={0} height={0}>
        <defs>
          <filter id="state-gauge-glow">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <filter id="state-text-glow">
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
              background: `hsla(${STATE_HUE}, 50%, 30%, 0.15)`,
              boxShadow: `0 0 12px hsla(${STATE_HUE}, 60%, 40%, 0.1)`,
            }}
          >
            <span style={{ fontSize: '14px', filter: 'url(#state-text-glow)' }}>◈</span>
          </div>
          <div>
            <p className="font-semibold tracking-[0.3em] text-[11px]"
              style={{ color: `hsla(${STATE_HUE}, 60%, 60%, 0.8)` }}>
              SYS.STATE
            </p>
            <p className="text-[7px] tracking-[0.2em] text-zinc-600">ANALYTICS MODULE</p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 rounded-full p-0.5" style={{ background: 'rgba(148, 163, 184, 0.04)' }}>
          {(['metrics', 'moods'] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className="rounded-full px-2.5 py-1 text-[7px] tracking-[0.2em] transition-all duration-300 uppercase"
              style={{
                color: activeView === view
                  ? `hsla(${STATE_HUE}, 60%, 60%, 0.9)`
                  : 'rgba(148, 163, 184, 0.3)',
                background: activeView === view
                  ? `hsla(${STATE_HUE}, 40%, 20%, 0.3)`
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
            style={{ border: '1px dashed hsla(240, 30%, 30%, 0.2)' }}
          >
            <span className="text-xl opacity-30">◈</span>
          </div>
          <p className="text-[10px] tracking-[0.3em] text-zinc-600">NO STATE DATA</p>
          <p className="text-[8px] text-zinc-700">Begin logging to see analytics</p>
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-2 rounded-lg px-4 py-2 text-[9px] tracking-[0.2em] transition-all duration-300"
              style={{
                color: `hsla(${STATE_HUE}, 50%, 60%, 0.8)`,
                border: `1px solid hsla(${STATE_HUE}, 30%, 30%, 0.2)`,
                background: `hsla(${STATE_HUE}, 30%, 15%, 0.2)`,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = `hsla(${STATE_HUE}, 30%, 20%, 0.3)`}
              onMouseLeave={(e) => e.currentTarget.style.background = `hsla(${STATE_HUE}, 30%, 15%, 0.2)`}
            >
              INITIALIZE DATA LINK ⟶
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Hero section ── */}
          <div
            className="relative mb-4 overflow-hidden rounded-2xl border px-5 py-4"
            style={{
              borderColor: `hsla(${STATE_HUE}, 40%, 40%, 0.08)`,
              background: `linear-gradient(135deg, hsla(${STATE_HUE}, 30%, 8%, 0.6), hsla(${STATE_HUE + 40}, 20%, 5%, 0.3))`,
            }}
          >
            {/* Ambient glow orbs */}
            <div
              className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20"
              style={{
                background: `radial-gradient(circle, hsla(${STATE_HUE}, 70%, 50%, 0.3), transparent)`,
                animation: 'pulse-glow 4s ease-in-out infinite',
              }}
            />
            <div
              className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full opacity-10"
              style={{
                background: `radial-gradient(circle, hsla(${STATE_HUE + 40}, 60%, 50%, 0.2), transparent)`,
                animation: 'pulse-glow 5s ease-in-out 2s infinite',
              }}
            />

            {/* Energy hero + gauge rings */}
            <div className="relative flex items-end justify-between">
              <CompositeScore wellbeing={stats.wellbeing} />

              {/* Gauge row */}
              <div className="flex gap-4">
                <GaugeRing
                  value={stats.latest?.energy_level ?? 0}
                  label="ENERGY"
                  size={48}
                />
                <GaugeRing
                  value={stats.latest?.stress_level ?? 0}
                  label="STRESS"
                  inverted
                  size={48}
                />
                <GaugeRing
                  value={stats.latest?.soreness_level ?? 0}
                  label="SORENESS"
                  inverted
                  size={48}
                />
              </div>
            </div>

            {/* Neon underline */}
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
              style={{
                background: `linear-gradient(90deg, transparent, hsla(${STATE_HUE}, 70%, 50%, 0.3), transparent)`,
              }}
            />
          </div>

          {activeView === 'metrics' ? (
            <>
              {/* ── Metric cards row ── */}
              <div className="mb-4 flex gap-2">
                <MetricCard
                  label="AVG ENERGY"
                  value={stats.avgEnergy.toFixed(1)}
                  sub={`/10 · ${scoreLabel(stats.avgEnergy)}`}
                />
                <MetricCard
                  label="AVG STRESS"
                  value={(10 - (10 - stats.avgStress)).toFixed(1)}
                  sub={`inverted · ${scoreLabel(11 - stats.avgStress)}`}
                  hue={STATE_HUE + 20}
                />
                <MetricCard
                  label="AVG SORENESS"
                  value={(10 - (10 - stats.avgSoreness)).toFixed(1)}
                  sub={`inverted · ${scoreLabel(11 - stats.avgSoreness)}`}
                  hue={STATE_HUE - 10}
                />
              </div>

              {/* ── Consistency ── */}
              <div className="mb-4">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[7px] tracking-[0.2em] text-zinc-600">STATE CONSISTENCY</span>
                  <span className="text-[10px] font-semibold" style={{
                    color: `hsla(${STATE_HUE}, 70%, 60%, 0.8)`,
                  }}>
                    {stats.consistency}%
                  </span>
                </div>
                <div
                  className="relative h-1.5 overflow-hidden rounded-full"
                  style={{ background: 'rgba(148, 163, 184, 0.06)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${stats.consistency}%`,
                      background: `linear-gradient(90deg, hsla(${STATE_HUE}, 60%, 40%, 0.5), hsla(${STATE_HUE}, 70%, 55%, 0.7))`,
                      boxShadow: `0 0 8px hsla(${STATE_HUE}, 70%, 50%, 0.2)`,
                    }}
                  />
                </div>
              </div>

              {/* ── Trend sparklines ── */}
              {stats.sorted.length >= 2 && (
                <div className="mb-3 space-y-2">
                  <p className="text-[7px] tracking-[0.2em] text-zinc-600">TRENDS</p>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] tracking-wider text-zinc-600 w-12">ENERGY</span>
                      <Sparkline data={stats.energyTrend} hue={160} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] tracking-wider text-zinc-600 w-12">STRESS</span>
                      <Sparkline data={stats.stressTrend} hue={45} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[7px] tracking-wider text-zinc-600 w-12">SORE</span>
                      <Sparkline data={stats.sorenessTrend} hue={0} />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Latest details ── */}
              {stats.latest && (
                <>
                  <div className="my-3 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.04)' }} />
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full" style={{
                        background: `hsla(${energyHue}, 70%, 60%, 0.6)`,
                        boxShadow: `0 0 4px hsla(${energyHue}, 70%, 50%, 0.3)`,
                        animation: 'pulse-glow 2s ease-in-out infinite',
                      }} />
                      <span className="text-[8px] tracking-wider text-zinc-600">LATEST READING</span>
                    </div>
                    <span className="text-[8px] font-mono text-zinc-500">
                      {fmtDate(stats.latest.created_at)} · {fmtTime(stats.latest.created_at)}
                    </span>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              {/* ── Mood Timeline ── */}
              <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">MOOD LOG</p>
              {stats.sorted.filter((l) => l.mood?.trim()).length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <span className="text-[9px] tracking-wider text-zinc-600">NO MOODS LOGGED</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {[...stats.sorted].reverse().filter((l) => l.mood?.trim()).map((log, i) => (
                    <MoodTag
                      key={log.id || i}
                      mood={log.mood!}
                      time={`${fmtDate(log.created_at)} ${fmtTime(log.created_at)}`}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Action button ── */}
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-3 w-full rounded-xl py-2.5 text-[9px] tracking-[0.25em] transition-all duration-300"
              style={{
                color: `hsla(${STATE_HUE}, 50%, 60%, 0.7)`,
                border: `1px solid hsla(${STATE_HUE}, 30%, 30%, 0.12)`,
                background: `hsla(${STATE_HUE}, 30%, 12%, 0.15)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `hsla(${STATE_HUE}, 30%, 18%, 0.25)`;
                e.currentTarget.style.borderColor = `hsla(${STATE_HUE}, 40%, 40%, 0.2)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `hsla(${STATE_HUE}, 30%, 12%, 0.15)`;
                e.currentTarget.style.borderColor = `hsla(${STATE_HUE}, 30%, 30%, 0.12)`;
              }}
            >
              ◇ LOG STATE DATA ⟶
            </button>
          )}
        </>
      )}
    </div>
  );
}
