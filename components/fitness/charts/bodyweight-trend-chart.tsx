'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid,
} from 'recharts';
import { fmtKg, fmtLongDate } from '@/lib/fitness/format';

/**
 * Bodyweight trend chart — shared by the dashboard and the Bodyweight
 * detail page. Split into its own module so `recharts` (≈300 KB) is
 * loaded lazily instead of blocking the page's first paint/hydration.
 */
export interface BodyweightTrendPoint {
  week: string;
  ma: number | null;
  raw: number | null;
}

export default function BodyweightTrendChart({
  series,
  targetKg = null,
  targetLabel = false,
}: {
  series: BodyweightTrendPoint[];
  targetKg?: number | null;
  targetLabel?: boolean;
}) {
  const tickFmt = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
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
          dataKey="week"
          tickFormatter={tickFmt}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          domain={['dataMin - 1', 'dataMax + 1']}
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
            n === 'ma' ? '12w avg' : 'Measurement',
          ]}
        />
        {targetKg !== null && targetKg !== undefined && (
          <ReferenceLine
            y={Number(targetKg)}
            stroke="#f43f5e"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={
              targetLabel
                ? {
                    value: 'target',
                    fill: '#f43f5e',
                    fontSize: 10,
                    position: 'insideBottomRight',
                  }
                : undefined
            }
          />
        )}
        <Line
          type="monotone"
          dataKey="raw"
          stroke="#52525b"
          strokeWidth={1}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="ma"
          stroke="#f43f5e"
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
