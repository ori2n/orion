'use client';

import { useMemo } from 'react';
import {
  computeEnergyScoreBreakdown,
  hasAnyData,
  type EnergyScoreInputs,
  type EnergyScoreBreakdown,
} from '@/lib/health/energy-score';

function scoreLabel(score: number): string {
  if (score >= 90) return 'PEAK';
  if (score >= 80) return 'HIGH';
  if (score >= 65) return 'GOOD';
  if (score >= 50) return 'FAIR';
  if (score >= 35) return 'LOW';
  return 'DEPLETED';
}

function scoreHue(score: number): number {
  if (score >= 80) return 160; // cyan/teal
  if (score >= 60) return 120; // green
  if (score >= 40) return 45;  // amber
  return 0;                     // red
}

const BREAKDOWN_MAX: Record<keyof EnergyScoreBreakdown, number> = {
  total: 100,
  sleep: 30,
  activity: 15,
  hydration: 15,
  caffeine: 10,
  nutrition: 10,
  manual: 20,
};

const BREAKDOWN_LABELS: Record<string, string> = {
  sleep: 'SLEEP',
  activity: 'ACTIVITY',
  hydration: 'HYDRATION',
  caffeine: 'CAFFEINE',
  nutrition: 'NUTRITION',
  manual: 'STATE',
};

const BREAKDOWN_ICONS: Record<string, string> = {
  sleep: '🌙',
  activity: '🏃',
  hydration: '💧',
  caffeine: '☕',
  nutrition: '🍽️',
  manual: '📊',
};

/** Glowing neon energy ring – the centerpiece of the Jarvis dashboard */
function EnergyRing({ score, size = 220 }: { score: number; size?: number }) {
  const hue = scoreHue(score);
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const glowColor = `hsl(${hue}, 80%, 55%)`;
  const dimColor = `hsla(${hue}, 60%, 25%, 0.3)`;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Outer glow ring */}
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <defs>
          <filter id="neon-glow">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="neon-glow-intense">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`ring-grad-${score}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={`hsl(${hue + 20}, 80%, 50%)`} />
            <stop offset="50%" stopColor={`hsl(${hue}, 85%, 55%)`} />
            <stop offset="100%" stopColor={`hsl(${hue - 20}, 75%, 45%)`} />
          </linearGradient>
        </defs>

        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsla(0, 0%, 20%, 0.4)"
          strokeWidth={strokeWidth}
        />

        {/* Filled arc – outer glow */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={dimColor}
          strokeWidth={strokeWidth + 8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
          filter="url(#neon-glow)"
        />

        {/* Filled arc – main */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#ring-grad-${score})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
          filter="url(#neon-glow-intense)"
        />

        {/* Filled arc – core bright line */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={glowColor}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className="text-[54px] font-bold leading-none tracking-tight"
          style={{ color: glowColor, textShadow: `0 0 30px ${glowColor}60, 0 0 60px ${glowColor}30` }}
        >
          {score}
        </span>
        <span className="mt-1 text-[10px] font-medium tracking-[0.2em] text-zinc-500">
          / 100
        </span>
      </div>
    </div>
  );
}

/** Mini breakdown bars for the center panel */
function BreakdownBars({ breakdown }: { breakdown: EnergyScoreBreakdown }) {
  return (
    <div className="space-y-2">
      {Object.entries(BREAKDOWN_MAX)
        .filter(([key]) => key !== 'total')
        .map(([key, max]) => {
          const value = breakdown[key as keyof EnergyScoreBreakdown] as number;
          const pct = Math.min((value / max) * 100, 100);
          const hue = scoreHue((value / max) * 100);
          return (
            <div key={key} className="group">
              <div className="mb-0.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="text-xs">{BREAKDOWN_ICONS[key]}</span>
                  <span className="tracking-wider">{BREAKDOWN_LABELS[key]}</span>
                </span>
                <span className="font-mono text-[11px] text-zinc-500">
                  {Math.round(value)}
                  <span className="text-zinc-600">/{max}</span>
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-zinc-800/60">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${pct}%`,
                    background: `linear-gradient(90deg, hsl(${hue}, 75%, 40%), hsl(${hue}, 80%, 55%))`,
                    boxShadow: `0 0 6px hsla(${hue}, 80%, 50%, 0.4)`,
                  }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}

export default function EnergyScoreDisplay({ inputs }: { inputs: EnergyScoreInputs }) {
  const breakdown = useMemo(() => computeEnergyScoreBreakdown(inputs), [inputs]);
  const empty = useMemo(() => !hasAnyData(inputs), [inputs]);
  const { total } = breakdown;

  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-8">
        <EnergyRing score={50} />
        <div className="text-center">
          <p className="text-sm font-semibold tracking-widest text-zinc-400">NEUTRAL</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            No data yet — log activities to calibrate
          </p>
        </div>
        <BreakdownBars breakdown={breakdown} />
      </div>
    );
  }

  const label = scoreLabel(total);
  const hue = scoreHue(total);

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8">
      <EnergyRing score={total} />

      {/* Status label */}
      <div className="text-center">
        <p
          className="text-sm font-bold tracking-[0.25em]"
          style={{
            color: `hsl(${hue}, 80%, 60%)`,
            textShadow: `0 0 20px hsla(${hue}, 80%, 50%, 0.4)`,
          }}
        >
          {label}
        </p>
        <p className="mt-1 text-[10px] tracking-wider text-zinc-600">
          REAL-TIME ENERGY LEVEL
        </p>
      </div>

      {/* Breakdown bars */}
      <div className="w-full max-w-xs">
        <BreakdownBars breakdown={breakdown} />
      </div>
    </div>
  );
}
