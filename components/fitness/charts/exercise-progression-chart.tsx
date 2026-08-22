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

export default function ExerciseProgressionChart({
  series,
}: {
  series: ProgressionPoint[];
}) {
  const tickFmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
    });

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
