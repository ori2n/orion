'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import type { SleepLog } from '@/lib/health/storage';

// ─── Helpers ────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.round((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${h}h ${m}m`;
}

function fmtDurationShort(ms: number): string {
  const h = Math.floor(ms / (1000 * 60 * 60));
  const m = Math.round((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (h === 0) return `${m}m`;
  return `${h}h${m}m`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
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

const VIOLET_HUE = 260;

// ─── Sparkline ──────────────────────────────────────────────────────

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length === 0) return null;
  const w = data.length * 12;
  const h = 24;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${i * 12 + 6},${h - (v / max) * (h - 2) - 1}`).join(' ');

  return (
    <svg width={w} height={h} className={className}>
      <polyline
        points={pts}
        fill="none"
        stroke={`hsla(${VIOLET_HUE}, 70%, 65%, 0.6)`}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Bar Chart ──────────────────────────────────────────────────────

function SleepBarChart({
  bars,
  maxDuration,
}: {
  bars: { label: string; duration: number; quality: number; date: Date }[];
  maxDuration: number;
}) {
  if (bars.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center">
        <span className="text-[10px] tracking-widest text-zinc-600">NO SLEEP DATA</span>
      </div>
    );
  }

  const barW = Math.max(14, Math.min(28, 180 / bars.length));
  const gap = Math.max(4, Math.min(10, 140 / bars.length));
  const totalW = bars.length * (barW + gap) - gap;
  const h = 100;
  const targetMs = 8 * 60 * 60 * 1000; // 8h target line

  return (
    <div className="relative">
      {/* 8h target guideline */}
      <div
        className="absolute left-0 right-0 border-t border-dashed"
        style={{
          top: `${(1 - targetMs / maxDuration) * h}px`,
          borderColor: 'rgba(148, 163, 184, 0.08)',
        }}
      />

      <svg width={totalW} height={h + 20} className="overflow-visible">
        {bars.map((bar, i) => {
          const x = i * (barW + gap);
          const barH = Math.max(2, (bar.duration / maxDuration) * h);
          const y = h - barH;

          return (
            <g key={i}>
              {/* Glow bar behind */}
              <rect
                x={x}
                y={y - 2}
                width={barW}
                height={barH + 4}
                rx={2}
                fill={`hsla(${VIOLET_HUE}, 60%, 50%, 0.1)`}
                filter="url(#bar-glow-sleep)"
              />
              {/* Main bar */}
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={1.5}
                fill={`hsla(${VIOLET_HUE}, 70%, ${50 + bar.quality * 3}%, ${0.3 + bar.quality * 0.05})`}
                className="transition-all duration-500"
              />
              {/* Quality dot */}
              <circle
                cx={x + barW / 2}
                cy={y - 4}
                r={2}
                fill={`hsla(${VIOLET_HUE + bar.quality * 4}, 80%, 60%, 0.6)`}
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

// ─── Metric Card ────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent = VIOLET_HUE,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: number;
}) {
  return (
    <div
      className="relative flex-1 rounded-xl border px-3 py-2.5"
      style={{
        borderColor: `hsla(${accent}, 40%, 40%, 0.1)`,
        background: `hsla(${accent}, 30%, 10%, 0.3)`,
      }}
    >
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, hsla(${accent}, 60%, 50%, 0.2), transparent)`,
        }}
      />
      <p className="text-[7px] tracking-[0.2em] text-zinc-600">{label}</p>
      <p
        className="mt-0.5 font-semibold leading-none tracking-tight"
        style={{
          fontSize: '18px',
          color: `hsla(${accent}, 70%, 60%, 0.9)`,
          textShadow: `0 0 20px hsla(${accent}, 70%, 50%, 0.2)`,
        }}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[7px] tracking-wider text-zinc-600">{sub}</p>}
    </div>
  );
}

// ─── Quality Gauge ──────────────────────────────────────────────────

function QualityGauge({ quality }: { quality: number }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ - (quality / 10) * circ;

  return (
    <div className="relative flex items-center gap-3">
      <svg width={70} height={70} className="-rotate-90">
        <defs>
          <filter id="gauge-glow-sleep">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
        {/* Track */}
        <circle
          cx={35} cy={35} r={r}
          fill="none" stroke="rgba(148, 163, 184, 0.06)"
          strokeWidth={4}
        />
        {/* Glow blur */}
        <circle
          cx={35} cy={35} r={r}
          fill="none"
          stroke={`hsla(${VIOLET_HUE}, 70%, 50%, 0.25)`}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          filter="url(#gauge-glow-sleep)"
        />
        {/* Active arc */}
        <circle
          cx={35} cy={35} r={r}
          fill="none"
          stroke={`hsla(${VIOLET_HUE}, 70%, 60%, 0.7)`}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="flex flex-col">
        <span className="text-[7px] tracking-[0.2em] text-zinc-600">AVG QUALITY</span>
        <span
          className="text-lg font-semibold leading-none tracking-tight"
          style={{
            color: `hsla(${VIOLET_HUE}, 70%, 60%, 0.9)`,
            textShadow: `0 0 20px hsla(${VIOLET_HUE}, 70%, 50%, 0.2)`,
          }}
        >
          {quality.toFixed(1)}
          <span className="text-[10px] text-zinc-600">/10</span>
        </span>
      </div>
    </div>
  );
}

// ─── Consistency Bar ────────────────────────────────────────────────

function ConsistencyBar({ pct }: { pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[7px] tracking-[0.2em] text-zinc-600">SCHEDULE CONSISTENCY</span>
        <span
          className="text-[10px] font-semibold"
          style={{
            color: `hsla(${VIOLET_HUE}, 70%, 60%, 0.8)`,
          }}
        >
          {pct}%
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(148, 163, 184, 0.06)' }}>
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, hsla(${VIOLET_HUE}, 60%, 40%, 0.5), hsla(${VIOLET_HUE}, 70%, 55%, 0.7))`,
            boxShadow: `0 0 8px hsla(${VIOLET_HUE}, 70%, 50%, 0.2)`,
          }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function SleepAnalytics({
  logs,
  onOpenTracker,
}: {
  logs: SleepLog[];
  onOpenTracker?: () => void;
}) {
  const [activeView, setActiveView] = useState<'duration' | 'quality'>('duration');

  const stats = useMemo(() => {
    if (logs.length === 0) {
      return {
        avgDuration: 0,
        avgQuality: 0,
        consistency: 0,
        latestStart: '',
        latestEnd: '',
        bars: [] as { label: string; duration: number; quality: number; date: Date }[],
      };
    }

    const sorted = [...logs].sort(
      (a, b) => new Date(a.sleep_start).getTime() - new Date(b.sleep_start).getTime(),
    );

    const bars = sorted.map((log) => ({
      label: new Date(log.sleep_start).toLocaleDateString('en-US', { weekday: 'short' }),
      duration: new Date(log.sleep_end).getTime() - new Date(log.sleep_start).getTime(),
      quality: log.quality,
      date: new Date(log.sleep_start),
    }));

    const durations = bars.map((b) => b.duration);
    const qualities = bars.map((b) => b.quality);
    const avgDur = avg(durations);
    const avgQual = avg(qualities);
    const cons = Math.max(0, 100 - Math.round(stdDev(durations) / (1000 * 60 * 30)) * 10);

    const latest = logs.reduce((a, b) =>
      new Date(a.sleep_start).getTime() > new Date(b.sleep_start).getTime() ? a : b,
    );

    return {
      avgDuration: avgDur,
      avgQuality: avgQual,
      consistency: Math.min(100, cons),
      latestStart: latest.sleep_start,
      latestEnd: latest.sleep_end,
      bars,
    };
  }, [logs]);

  const maxDuration = useMemo(() => {
    if (stats.bars.length === 0) return 8 * 60 * 60 * 1000;
    return Math.max(...stats.bars.map((b) => b.duration), 6 * 60 * 60 * 1000);
  }, [stats.bars]);

  // ── Animated counter ──
  const [displayDur, setDisplayDur] = useState('0h 0m');
  const durRef = useRef(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const target = stats.avgDuration;
    if (target === 0) {
      setDisplayDur('--:--');
      return;
    }
    const step = target / 30;
    const start = durRef.current;
    let frame = 0;
    const animate = () => {
      frame++;
      const progress = Math.min(1, frame / 30);
      const eased = 1 - (1 - progress) ** 3; // ease-out cubic
      const current = start + (target - start) * eased;
      durRef.current = current;
      setDisplayDur(fmtDuration(Math.round(current)));
      if (progress < 1) animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [stats.avgDuration]);

  const hasData = logs.length > 0;

  return (
    <div className="select-none">
      {/* ── SVG Filters ── */}
      <svg className="absolute pointer-events-none" width={0} height={0}>
        <defs>
          <filter id="bar-glow-sleep">
            <feGaussianBlur stdDeviation="3" />
          </filter>
          <filter id="sleep-glow-text">
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
              background: `hsla(${VIOLET_HUE}, 50%, 30%, 0.15)`,
              boxShadow: `0 0 12px hsla(${VIOLET_HUE}, 60%, 40%, 0.1)`,
            }}
          >
            <span style={{ fontSize: '14px', filter: 'url(#sleep-glow-text)' }}>⟐</span>
          </div>
          <div>
            <p className="font-semibold tracking-[0.3em] text-[11px]"
              style={{ color: `hsla(${VIOLET_HUE}, 60%, 60%, 0.8)` }}>
              SYS.SLEEP
            </p>
            <p className="text-[7px] tracking-[0.2em] text-zinc-600">ANALYTICS MODULE</p>
          </div>
        </div>

        {/* View toggle */}
        <div className="flex gap-1 rounded-full p-0.5" style={{ background: 'rgba(148, 163, 184, 0.04)' }}>
          {(['duration', 'quality'] as const).map((view) => (
            <button
              key={view}
              onClick={() => setActiveView(view)}
              className="rounded-full px-2.5 py-1 text-[7px] tracking-[0.2em] transition-all duration-300"
              style={{
                color: activeView === view
                  ? `hsla(${VIOLET_HUE}, 60%, 60%, 0.9)`
                  : 'rgba(148, 163, 184, 0.3)',
                background: activeView === view
                  ? `hsla(${VIOLET_HUE}, 40%, 20%, 0.3)`
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
            style={{ border: '1px dashed hsla(260, 30%, 30%, 0.2)' }}
          >
            <span className="text-xl opacity-30">⟐</span>
          </div>
          <p className="text-[10px] tracking-[0.3em] text-zinc-600">NO SLEEP DATA</p>
          <p className="text-[8px] text-zinc-700">Begin logging to see analytics</p>
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-2 rounded-lg px-4 py-2 text-[9px] tracking-[0.2em] transition-all duration-300"
              style={{
                color: `hsla(${VIOLET_HUE}, 50%, 60%, 0.8)`,
                border: `1px solid hsla(${VIOLET_HUE}, 30%, 30%, 0.2)`,
                background: `hsla(${VIOLET_HUE}, 30%, 15%, 0.2)`,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = `hsla(${VIOLET_HUE}, 30%, 20%, 0.3)`}
              onMouseLeave={(e) => e.currentTarget.style.background = `hsla(${VIOLET_HUE}, 30%, 15%, 0.2)`}
            >
              INITIALIZE DATA LINK ⟶
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ── Hero duration display ── */}
          <div
            className="relative mb-4 overflow-hidden rounded-2xl border px-5 py-4"
            style={{
              borderColor: `hsla(${VIOLET_HUE}, 40%, 40%, 0.08)`,
              background: `linear-gradient(135deg, hsla(${VIOLET_HUE}, 30%, 8%, 0.6), hsla(${VIOLET_HUE + 40}, 20%, 5%, 0.3))`,
            }}
          >
            {/* Animated glow orbs */}
            <div
              className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-20"
              style={{
                background: `radial-gradient(circle, hsla(${VIOLET_HUE}, 70%, 50%, 0.3), transparent)`,
                animation: 'pulse-glow 4s ease-in-out infinite',
              }}
            />
            <div
              className="pointer-events-none absolute -bottom-4 -left-4 h-16 w-16 rounded-full opacity-10"
              style={{
                background: `radial-gradient(circle, hsla(${VIOLET_HUE + 40}, 60%, 50%, 0.2), transparent)`,
                animation: 'pulse-glow 5s ease-in-out 2s infinite',
              }}
            />

            <div className="relative flex items-end justify-between">
              <div>
                <p className="text-[7px] tracking-[0.2em] text-zinc-600">AVERAGE DURATION</p>
                <p
                  className="mt-1 text-3xl font-bold leading-none tracking-tight"
                  style={{
                    color: `hsla(${VIOLET_HUE}, 70%, 65%, 0.95)`,
                    textShadow: `0 0 30px hsla(${VIOLET_HUE}, 70%, 50%, 0.25), 0 0 60px hsla(${VIOLET_HUE}, 70%, 40%, 0.1)`,
                  }}
                >
                  {displayDur}
                </p>
                <Sparkline data={stats.bars.map((b) => b.duration)} className="mt-2" />
              </div>
              <QualityGauge quality={stats.avgQuality} />
            </div>

            {/* Neon underline */}
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-px"
              style={{
                background: `linear-gradient(90deg, transparent, hsla(${VIOLET_HUE}, 70%, 50%, 0.3), transparent)`,
              }}
            />
          </div>

          {/* ── Metric cards row ── */}
          <div className="mb-4 flex gap-2">
            <MetricCard
              label="AVG DURATION"
              value={fmtDurationShort(stats.avgDuration)}
              sub={stats.bars.length > 0 ? `${stats.bars.length} day${stats.bars.length > 1 ? 's' : ''}` : undefined}
            />
            <MetricCard
              label="AVG QUALITY"
              value={stats.avgQuality.toFixed(1)}
              sub={`/10 · ${stats.avgQuality >= 7 ? 'GOOD' : stats.avgQuality >= 5 ? 'FAIR' : 'LOW'}`}
              accent={VIOLET_HUE + 20}
            />
          </div>

          {/* ── Consistency ── */}
          <div className="mb-4">
            <ConsistencyBar pct={stats.consistency} />
          </div>

          {/* ── Bar chart ── */}
          <div className="mb-3">
            <p className="mb-2 text-[7px] tracking-[0.2em] text-zinc-600">
              {activeView === 'duration' ? '7-DAY DURATION OVERVIEW' : '7-DAY QUALITY OVERVIEW'}
            </p>
            <SleepBarChart bars={stats.bars} maxDuration={maxDuration} />
          </div>

          {/* ── Latest session ── */}
          {stats.latestStart && stats.latestEnd && (
            <>
              <div className="my-3 border-t" style={{ borderColor: 'rgba(148, 163, 184, 0.04)' }} />
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full"
                    style={{
                      background: `hsla(${VIOLET_HUE}, 70%, 60%, 0.6)`,
                      boxShadow: `0 0 4px hsla(${VIOLET_HUE}, 70%, 50%, 0.3)`,
                      animation: 'pulse-glow 2s ease-in-out infinite',
                    }}
                  />
                  <span className="text-[8px] tracking-wider text-zinc-600">LATEST SESSION</span>
                </div>
                <span className="text-[8px] font-mono text-zinc-500">
                  {fmtTime(stats.latestStart)} ⟶ {fmtTime(stats.latestEnd)}
                </span>
              </div>
            </>
          )}

          {/* ── Action button ── */}
          {onOpenTracker && (
            <button
              onClick={onOpenTracker}
              className="mt-3 w-full rounded-xl py-2.5 text-[9px] tracking-[0.25em] transition-all duration-300"
              style={{
                color: `hsla(${VIOLET_HUE}, 50%, 60%, 0.7)`,
                border: `1px solid hsla(${VIOLET_HUE}, 30%, 30%, 0.12)`,
                background: `hsla(${VIOLET_HUE}, 30%, 12%, 0.15)`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `hsla(${VIOLET_HUE}, 30%, 18%, 0.25)`;
                e.currentTarget.style.borderColor = `hsla(${VIOLET_HUE}, 40%, 40%, 0.2)`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `hsla(${VIOLET_HUE}, 30%, 12%, 0.15)`;
                e.currentTarget.style.borderColor = `hsla(${VIOLET_HUE}, 30%, 30%, 0.12)`;
              }}
            >
              ◇ LOG SLEEP DATA ⟶
            </button>
          )}
        </>
      )}
    </div>
  );
}
