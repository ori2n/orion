'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import type { NutritionLog } from '@/lib/health/storage';

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

const NUTRITION_HUE = 200; // Cyan/blue — matches nutrition node group

// ─── Hydration Gauge ────────────────────────────────────────────────

function HydrationGauge({ waterMl, created_at }: { waterMl: number; created_at: string }) {
  // Apply time-based decay (80mL/hr) for display
  const hoursSince = (Date.now() - new Date(created_at).getTime()) / (1000 * 60 * 60);
  const effectiveWater = Math.max(0, waterMl - Math.round(hoursSince * 80));
  const pct = Math.min(effectiveWater / 2000, 1);

  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ - pct * circ;
  const hue = pct >= 0.6 ? 160 : pct >= 0.3 ? 100 : 45;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={76} height={76} className="-rotate-90">
        <defs>
          <filter id="hydro-glow">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
        {/* Track */}
        <circle cx={38} cy={38} r={r}
          fill="none" stroke="rgba(148, 163, 184, 0.06)"
          strokeWidth={5}
        />
        {/* Glow */}
        <circle cx={38} cy={38} r={r}
          fill="none"
          stroke={`hsla(${hue}, 70%, 50%, 0.2)`}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          filter="url(#hydro-glow)"
        />
        {/* Arc */}
        <circle cx={38} cy={38} r={r}
          fill="none"
          stroke={`hsla(${hue}, 75%, 55%, 0.7)`}
          strokeWidth={4.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <span className="text-[10px] font-semibold" style={{
        color: `hsla(${hue}, 70%, 55%, 0.8)`,
        textShadow: `0 0 10px hsla(${hue}, 70%, 40%, 0.15)`,
      }}>
        {Math.round(pct * 100)}%
      </span>
      <span className="text-[6px] tracking-[0.2em] text-zinc-600">HYDRATION</span>
    </div>
  );
}

// ─── Water Bar Chart ────────────────────────────────────────────────

function WaterBarChart({
  bars,
  maxWater,
}: {
  bars: { label: string; water: number; date: Date }[];
  maxWater: number;
}) {
  if (bars.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center">
        <span className="text-[10px] tracking-widest text-zinc-600">NO NUTRITION DATA</span>
      </div>
    );
  }

  const barW = Math.max(14, Math.min(28, 180 / bars.length));
  const gap = Math.max(4, Math.min(10, 140 / bars.length));
  const totalW = bars.length * (barW + gap) - gap;
  const h = 100;
  const targetMl = 2000;

  return (
    <div className="relative">
      {/* 2000ml target guideline */}
      <div
        className="absolute left-0 right-0 border-t border-dashed"
        style={{
          top: `${(1 - targetMl / maxWater) * h}px`,
          borderColor: 'rgba(56, 189, 248, 0.12)',
        }}
      />

      <svg width={totalW} height={h + 20} className="overflow-visible">
        {bars.map((bar, i) => {
          const x = i * (barW + gap);
          const barH = Math.max(2, (bar.water / maxWater) * h);
          const y = h - barH;
          const hue = bar.water >= 2000 ? 160 : bar.water >= 1000 ? 200 : 210;

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
                filter="url(#water-bar-glow)"
              />
              {/* Main bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={1.5}
                fill={`hsla(${hue}, 70%, ${40 + (bar.water / 2000) * 20}%, ${0.3 + (bar.water / 2000) * 0.4})`}
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
                {bar.label[0]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Caffeine Arc ───────────────────────────────────────────────────

function CaffeineArc({ mg, time, hue = NUTRITION_HUE }: { mg: number; time: string | null; hue?: number }) {
  if (!time || mg === 0) return null;

  const d = new Date(time);
  const hour = d.getHours();
  const minute = d.getMinutes();
  // Convert to angle: 0h = -90deg (top), 24h = 270deg (full circle)
  const angleDeg = ((hour + minute / 60) / 24) * 360 - 90;
  const hoursAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60);
  const opacity = Math.max(0.15, 1 - hoursAgo / 10);

  return (
    <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{
      borderColor: `hsla(${hue}, 30%, 30%, 0.08)`,
      background: `hsla(${hue}, 20%, 10%, 0.15)`,
      opacity,
    }}>
      <svg width={20} height={20}>
        <circle cx={10} cy={10} r={8}
          fill="none" stroke="rgba(148, 163, 184, 0.1)"
          strokeWidth={2}
        />
        <line x1={10} y1={10} x2={10 + 7 * Math.cos((angleDeg * Math.PI) / 180)} y2={10 + 7 * Math.sin((angleDeg * Math.PI) / 180)}
          stroke={`hsla(${hue}, 70%, 55%, 0.6)`}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle cx={10} cy={10} r={2}
          fill={`hsla(${hue}, 70%, 60%, 0.8)`}
        />
      </svg>
      <span className="flex-1 text-[9px] tracking-wide text-zinc-400">
        {mg}mg caffeine
      </span>
      <span className="text-[7px] font-mono text-zinc-600">
        {hoursAgo < 1 ? `${Math.round(hoursAgo * 60)}m ago` : `${Math.round(hoursAgo)}h ago`}
      </span>
    </div>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  hue = NUTRITION_HUE,
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

// ─── Creatine Streak ────────────────────────────────────────────────

function CreatineBadge({ taken }: { taken: boolean }) {
  if (!taken) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={{
      borderColor: 'hsla(160, 40%, 40%, 0.12)',
      background: 'hsla(160, 30%, 12%, 0.15)',
    }}>
      <div className="flex items-center gap-1.5">
        <span className="text-[10px]">✦</span>
        <span className="text-[9px] tracking-wider text-emerald-400/80">CREATINE LOGGED TODAY</span>
      </div>
      <div className="ml-auto h-2 w-2 rounded-full" style={{
        background: 'rgba(52, 211, 153, 0.6)',
        boxShadow: '0 0 6px rgba(52, 211, 153, 0.3)',
        animation: 'pulse-glow 2s ease-in-out infinite',
      }} />
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────

function Sparkline({
  data,
  hue = NUTRITION_HUE,
  className,
}: {
  data: number[];
  hue?: number;
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
        <filter id={`n-spark-glow-${hue}`}>
          <feGaussianBlur stdDeviation="1" />
        </filter>
      </defs>
      <polyline
        points={pts}
        fill="none"
        stroke={`hsla(${hue}, 70%, 50%, 0.2)`}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#n-spark-glow-${hue})`}
      />
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

// ─── Main Component ─────────────────────────────────────────────────

export default function NutritionAnalytics({
  logs,
  onOpenTracker,
}: {
  logs: NutritionLog[];
  onOpenTracker?: () => void;
}) {
  const [activeView, setActiveView] = useState<'water' | 'caffeine'>('water');

  const stats = useMemo(() => {
    if (logs.length === 0) {
      return {
        avgWater: 0,
        avgCaffeine: 0,
        creatineToday: false,
        latest: null as NutritionLog | null,
        bars: [] as { label: string; water: number; date: Date }[],
        caffeineLogs: [] as NutritionLog[],
        waterTrend: [] as number[],
        totalLogs: 0,
      };
    }

    const sorted = [...logs].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const waterVals = sorted.map((l) => l.water_ml ?? 0);
    const caffeineVals = sorted.filter((l) => (l.caffeine_mg ?? 0) > 0);

    // Aggregate water by date
    const waterByDate = new Map<string, { water: number; date: Date }>();
    for (const log of sorted) {
      const dateStr = getDateStr(log.created_at);
      const existing = waterByDate.get(dateStr);
      if (existing) {
        existing.water += (log.water_ml ?? 0);
      } else {
        waterByDate.set(dateStr, { water: log.water_ml ?? 0, date: new Date(log.created_at) });
      }
    }

    const bars = Array.from(waterByDate.entries())
      .map(([label, val]) => ({ label, water: val.water, date: val.date }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const avgWater = avg(waterVals);
    const avgCaff = caffeineVals.length > 0
      ? avg(caffeineVals.map((l) => l.caffeine_mg ?? 0))
      : 0;

    // Check if creatine was logged today
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const creatineToday = sorted.some(
      (l) => l.creatine_taken && getDateStr(l.created_at) === todayStr,
    );

    const latest = sorted[sorted.length - 1] ?? null;

    return {
      avgWater: Math.round(avgWater),
      avgCaffeine: Math.round(avgCaff),
      creatineToday,
      latest,
      bars,
      caffeineLogs: caffeineVals,
      waterTrend: waterVals,
      totalLogs: sorted.length,
    };
  }, [logs]);

  const maxWater = useMemo(() => {
    if (stats.bars.length === 0) return 2500;
    return Math.max(...stats.bars.map((b) => b.water), 2000) * 1.15;
  }, [stats.bars]);

  const hasData = logs.length > 0;

  // ── Animated water counter ──
  const [displayWater, setDisplayWater] = useState('--');
  const waterRef = useRef(0);
  const waterAnimRef = useRef<number>(0);

  useEffect(() => {
    const target = stats.latest?.water_ml ?? 0;
    if (target === 0) { setDisplayWater('--'); return; }
    const start = waterRef.current;
    let frame = 0;
    const animate = () => {
      frame++;
      const progress = Math.min(1, frame / 30);
      const eased = 1 - (1 - progress) ** 3;
      const current = start + (target - start) * eased;
      waterRef.current = current;
      setDisplayWater(Math.round(current).toString());
      if (progress < 1) waterAnimRef.current = requestAnimationFrame(animate);
    };
    waterAnimRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(waterAnimRef.current);
  }, [stats.latest?.water_ml]);

  return (
    <div className="select-none">
      {/* ── SVG Filters ── */}
      <svg className="pointer-events-none absolute" width={0} height={0}>
        <defs>
          <filter id="water-bar-glow">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id="nutrition-text-glow">
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
              background: `hsla(${NUTRITION_HUE}, 50%, 30%, 0.15)`,
              boxShadow: `0 0 12px hsla(${NUTRITION_HUE}, 60%, 40%, 0.1)`,
            }}
          >
            <span style={{ fontSize: '14px', filter: 'url(#nutrition-text-glow)' }}>⟐</span>
          </div>
          <div>
            <p className="font-semibold tracking-[0.3em] text-[11px]"
              style={{ color: `hsla(${NUTRITION_HUE}, 60%, 60%, 0.8)` }}>
              SYS.NUTRITION
            </p>
            <p className="text-[7px] tracking-[0.2em] text-zinc-600">ANALYTICS MODULE</p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 rounded-full p-0.5" style={{ background: 'rgba(148, 163, 184, 0.04)' }}>
          {(['water', 'caffeine'] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className="rounded-full px-2.5 py-1 text-[7px] tracking-[0.2em] transition-all duration-300 uppercase"
              style={{
                color: activeView === view
                  ? `hsla(${NUTRITION_HUE}, 60%, 60%, 0.9)`
                  : 'rgba(148, 163, 184, 0.3)',
                background: activeView === view
                  ? `hsla(${NUTRITION_HUE}, 40%, 20%, 0.3)`
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
            style={{ border: '1px dashed hsla(200, 30%, 30%, 0.2)' }}
          >
            <span className="text-xl opacity-30">⟐</span>
          </div>
          <p className="text-[10px] tracking-[0.3em] text-zinc-600">NO NUTRITION DATA</p>
          <p className="text-[8px] text-zinc-700">Begin logging to see analytics</p>
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-2 rounded-lg px-4 py-2 text-[9px] tracking-[0.2em] transition-all duration-300"
              style={{
                color: `hsla(${NUTRITION_HUE}, 50%, 60%, 0.8)`,
                border: `1px solid hsla(${NUTRITION_HUE}, 30%, 30%, 0.2)`,
                background: `hsla(${NUTRITION_HUE}, 30%, 15%, 0.2)`,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = `hsla(${NUTRITION_HUE}, 30%, 20%, 0.3)`}
              onMouseLeave={(e) => e.currentTarget.style.background = `hsla(${NUTRITION_HUE}, 30%, 15%, 0.2)`}
            >
              INITIALIZE DATA LINK ⟶
            </button>
          )}
        </div>
      ) : (
        <>
          {activeView === 'water' ? (
            <>
              {/* ── Hero section — water ── */}
              <div
                className="relative mb-4 overflow-hidden rounded-2xl border px-5 py-4"
                style={{
                  borderColor: `hsla(${NUTRITION_HUE}, 40%, 40%, 0.08)`,
                  background: `linear-gradient(135deg, hsla(${NUTRITION_HUE}, 30%, 8%, 0.6), hsla(${NUTRITION_HUE + 40}, 20%, 5%, 0.3))`,
                }}
              >
                {/* Ambient glow orbs */}
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20"
                  style={{
                    background: `radial-gradient(circle, hsla(${NUTRITION_HUE}, 70%, 50%, 0.3), transparent)`,
                    animation: 'pulse-glow 4s ease-in-out infinite',
                  }}
                />
                <div
                  className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full opacity-10"
                  style={{
                    background: `radial-gradient(circle, hsla(${NUTRITION_HUE + 40}, 60%, 50%, 0.2), transparent)`,
                    animation: 'pulse-glow 5s ease-in-out 2s infinite',
                  }}
                />

                <div className="relative flex items-end justify-between">
                  <div>
                    <p className="text-[7px] tracking-[0.2em] text-zinc-600">LATEST WATER</p>
                    <p
                      className="mt-1 text-3xl font-bold leading-none tracking-tight"
                      style={{
                        color: `hsla(${NUTRITION_HUE}, 70%, 65%, 0.95)`,
                        textShadow: `0 0 30px hsla(${NUTRITION_HUE}, 70%, 50%, 0.25), 0 0 60px hsla(${NUTRITION_HUE}, 70%, 40%, 0.1)`,
                      }}
                    >
                      {displayWater}
                      <span className="text-sm text-zinc-500">ml</span>
                    </p>
                    <Sparkline data={stats.waterTrend} hue={NUTRITION_HUE} className="mt-2" />
                  </div>
                  {stats.latest && (
                    <HydrationGauge waterMl={stats.latest.water_ml ?? 0} created_at={stats.latest.created_at} />
                  )}
                </div>

                {/* Neon underline */}
                <div
                  className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, hsla(${NUTRITION_HUE}, 70%, 50%, 0.3), transparent)`,
                  }}
                />
              </div>

              {/* ── Metric cards ── */}
              <div className="mb-4 flex gap-2">
                <MetricCard
                  label="AVG WATER"
                  value={`${stats.avgWater}ml`}
                  sub={stats.bars.length > 0 ? `over ${stats.bars.length} day${stats.bars.length > 1 ? 's' : ''}` : undefined}
                />
                <MetricCard
                  label="TOTAL LOGS"
                  value={`${stats.totalLogs}`}
                  sub={`entries recorded`}
                  hue={NUTRITION_HUE + 30}
                />
              </div>

              {/* ── Water bar chart ── */}
              <div className="mb-3">
                <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">WATER INTAKE OVERVIEW</p>
                <WaterBarChart bars={stats.bars} maxWater={maxWater} />
              </div>

              {/* ── Creatine indicator ── */}
              {stats.creatineToday && (
                <div className="mb-3">
                  <CreatineBadge taken={stats.creatineToday} />
                </div>
              )}

              {/* ── Latest details ── */}
              {stats.latest && (
                <>
                  <div className="my-3 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.04)' }} />
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <div className="h-1 w-1 rounded-full" style={{
                        background: `hsla(${NUTRITION_HUE}, 70%, 60%, 0.6)`,
                        boxShadow: `0 0 4px hsla(${NUTRITION_HUE}, 70%, 50%, 0.3)`,
                        animation: 'pulse-glow 2s ease-in-out infinite',
                      }} />
                      <span className="text-[8px] tracking-wider text-zinc-600">LATEST LOG</span>
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
              {/* ── Caffeine View ── */}
              <div
                className="relative mb-4 overflow-hidden rounded-2xl border px-5 py-4"
                style={{
                  borderColor: `hsla(${NUTRITION_HUE + 30}, 40%, 40%, 0.08)`,
                  background: `linear-gradient(135deg, hsla(${NUTRITION_HUE + 30}, 30%, 8%, 0.6), hsla(${NUTRITION_HUE + 60}, 20%, 5%, 0.3))`,
                }}
              >
                <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-15"
                  style={{
                    background: `radial-gradient(circle, hsla(${NUTRITION_HUE + 30}, 70%, 50%, 0.2), transparent)`,
                    animation: 'pulse-glow 4s ease-in-out infinite',
                  }}
                />
                <div className="relative">
                  <p className="text-[7px] tracking-[0.2em] text-zinc-600">CAFFEINE INTAKE</p>
                  <p
                    className="mt-1 text-3xl font-bold leading-none tracking-tight"
                    style={{
                      color: `hsla(${NUTRITION_HUE + 30}, 70%, 65%, 0.95)`,
                      textShadow: `0 0 30px hsla(${NUTRITION_HUE + 30}, 70%, 50%, 0.25)`,
                    }}
                  >
                    {stats.latest?.caffeine_mg ?? 0}
                    <span className="text-sm text-zinc-500">mg</span>
                  </p>
                  {stats.latest?.caffeine_time && (stats.latest.caffeine_mg ?? 0) > 0 && (
                    <p className="mt-1 text-[8px] tracking-wider text-zinc-600">
                      logged at {fmtTime(stats.latest.caffeine_time)}
                    </p>
                  )}
                </div>

                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
                  style={{
                    background: `linear-gradient(90deg, transparent, hsla(${NUTRITION_HUE + 30}, 70%, 50%, 0.3), transparent)`,
                  }}
                />
              </div>

              {/* Caffeine history */}
              <div className="mb-3">
                <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">RECENT CAFFEINE LOGS</p>
                {stats.caffeineLogs.length === 0 ? (
                  <div className="flex items-center justify-center py-6">
                    <span className="text-[9px] tracking-wider text-zinc-600">NO CAFFEINE LOGGED</span>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {[...stats.caffeineLogs].reverse().map((log, i) => (
                      <CaffeineArc
                        key={log.id || i}
                        mg={log.caffeine_mg ?? 0}
                        time={log.caffeine_time ?? null}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Metric card */}
              <MetricCard
                label="AVG CAFFEINE"
                value={`${stats.avgCaffeine}mg`}
                sub={`per caffeinated log`}
                hue={NUTRITION_HUE + 30}
              />
            </>
          )}

          {/* ── Action button ── */}
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-3 w-full rounded-xl py-2.5 text-[9px] tracking-[0.25em] transition-all duration-300"
              style={{
                color: `hsla(${NUTRITION_HUE}, 50%, 60%, 0.7)`,
                border: `1px solid hsla(${NUTRITION_HUE}, 30%, 30%, 0.12)`,
                background: `hsla(${NUTRITION_HUE}, 30%, 12%, 0.15)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `hsla(${NUTRITION_HUE}, 30%, 18%, 0.25)`;
                e.currentTarget.style.borderColor = `hsla(${NUTRITION_HUE}, 40%, 40%, 0.2)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `hsla(${NUTRITION_HUE}, 30%, 12%, 0.15)`;
                e.currentTarget.style.borderColor = `hsla(${NUTRITION_HUE}, 30%, 30%, 0.12)`;
              }}
            >
              ◇ LOG NUTRITION DATA ⟶
            </button>
          )}
        </>
      )}
    </div>
  );
}
