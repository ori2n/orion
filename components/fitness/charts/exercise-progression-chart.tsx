'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useMemo } from 'react';
import { fmtKg, fmtLongDate } from '@/lib/fitness/format';

/**
 * Exercise progression chart — best set per workout. Split into its own
 * module so `recharts` loads lazily, not with the page's first JS.
 */
export interface ProgressionPoint {
  dateLabel: string;
  heaviest: number | null;
  est1rm: number | null;
}

/**
 * Dynamic Y-axis domain.
 *
 * The recharts default starts the axis at 0, which squashes real
 * progress: a 93→106 kg climb over three months fills only ~12% of
 * the plot and reads as flat. This computes the domain from the data
 * actually on screen:
 *
 *   - Range comes from both plotted series (est 1RM + heaviest) so
 *     neither line can fall outside the view.
 *   - Padding is 15% of the range (capped at 20% of the max value)
 *     above AND below, so the line never touches the edges.
 *   - Flat data (min === max) gets a ±5% band around the value so a
 *     single-weight plateau renders as an honest flat line, not a
 *     broken/zero-height axis.
 *   - Tiny ranges (near-duplicate values) are widened to at least 5%
 *     of the max so jitter doesn't get exaggerated into drama.
 *   - Falls back to `[0, 'auto']` when no numeric data exists.
 */
export function computeYAxisDomain(
  series: ProgressionPoint[],
): [number | 'auto', number | 'auto'] {
  const values = series
    .flatMap((p) => [p.heaviest, p.est1rm])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return [0, 'auto'];

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const maxAbs = Math.max(Math.abs(rawMin), Math.abs(rawMax));

  let min = rawMin;
  let max = rawMax;
  if (rawMin === rawMax) {
    // All identical values — a flat ±5% window keeps the line visible
    // and honest without inventing variation.
    const pad = Math.abs(rawMax) * 0.05 || 1;
    min = rawMin - pad;
    max = rawMax + pad;
  } else {
    const span = rawMax - rawMin;
    // Widen micro-ranges (< 5% of max) so two near-equal points don't
    // get stretched into a look-like-a-collapse cliff.
    const minSpan = maxAbs * 0.05;
    const padded = span < minSpan ? minSpan : span;
    const mid = (rawMin + rawMax) / 2;
    const pad = Math.min(padded * 0.15, maxAbs * 0.2);
    min = Math.min(rawMin, mid - padded / 2) - pad;
    max = Math.max(rawMax, mid + padded / 2) + pad;
  }
  return [min, max];
}

export default function ExerciseProgressionChart({
  series,
}: {
  series: ProgressionPoint[];
}) {
  const tickFmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
    });
  const domain = useMemo(() => computeYAxisDomain(series), [series]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={series}
        margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
        <XAxis
          dataKey="dateLabel"
          tickFormatter={tickFmt}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          minTickGap={20}
        />
        <YAxis
          domain={domain}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(l) => fmtLongDate(l as string)}
          formatter={(v, n) => [
            fmtKg(typeof v === 'number' ? v : Number(v), true),
            n === 'heaviest' ? 'PR (kg)' : 'Est 1RM (kg)',
          ]}
        />
        <Line
          dataKey="est1rm"
          stroke="#f43f5e"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="heaviest"
          stroke="#e4e4e7"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  color: '#e4e4e7',
  fontSize: 11,
};
