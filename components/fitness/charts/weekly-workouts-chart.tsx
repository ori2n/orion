'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

/**
 * WeeklyWorkoutsChart — compact bar chart of workouts completed per
 * week, shown beside the body-weight graph on the Overview. Data comes
 * from the existing `hevy_workouts` rows (no new data); the parent
 * buckets them by ISO week and passes the last N weeks.
 *
 * Bars are integer-valued, so the Y axis hides fractional ticks and
 * the tooltip reports whole numbers only.
 */

export interface WeeklyWorkoutPoint {
  /** YYYY-MM-DD of the week's Monday. */
  week: string;
  workouts: number;
}

export default function WeeklyWorkoutsChart({
  series,
}: {
  series: WeeklyWorkoutPoint[];
}) {
  const tickFmt = (d: string) =>
    new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="week"
          tickFormatter={tickFmt}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          minTickGap={16}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          width={24}
        />
        <Tooltip
          cursor={{ fill: 'rgba(244,63,94,0.06)' }}
          contentStyle={tooltipStyle}
          labelFormatter={(l) => `Week of ${fmtWeekLabel(l as string)}`}
          formatter={(v) => [
            `${Number(v)} workout${Number(v) === 1 ? '' : 's'}`,
            null,
          ]}
        />
        <Bar
          dataKey="workouts"
          fill="#f43f5e"
          radius={[3, 3, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function fmtWeekLabel(week: string): string {
  const d = new Date(week + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return week;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const tooltipStyle: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  color: '#e4e4e7',
  fontSize: 11,
};
