'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';
import { fmtLongDate } from '@/lib/fitness/format';

/**
 * Muscle weekly-frequency bar chart. Split into its own module so
 * `recharts` loads lazily instead of blocking the page's first paint.
 */
export interface FrequencyPoint {
  week: string;
  sessions: number;
}

export default function MuscleFrequencyChart({
  series,
  targetSessionsPerWeek,
}: {
  series: FrequencyPoint[];
  targetSessionsPerWeek: number;
}) {
  const tickFmt = (d: string) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short',
    });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={series}
        margin={{ top: 8, right: 6, left: 0, bottom: 0 }}
      >
        <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
        <XAxis
          dataKey="week"
          tickFormatter={tickFmt}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          minTickGap={20}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          width={28}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(l) => fmtLongDate(l as string)}
        />
        <ReferenceLine
          y={targetSessionsPerWeek}
          stroke="#f43f5e"
          strokeDasharray="4 4"
          strokeOpacity={0.6}
        />
        <Bar dataKey="sessions" isAnimationActive={false}>
          {series.map((p, idx) => {
            const ratio = p.sessions / Math.max(1, targetSessionsPerWeek);
            const color =
              ratio < 0.6
                ? '#f59e0b'
                : ratio > 1.2 && targetSessionsPerWeek > 0
                  ? '#38bdf8'
                  : '#34d399';
            return <Cell key={idx} fill={color} />;
          })}
        </Bar>
      </BarChart>
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
