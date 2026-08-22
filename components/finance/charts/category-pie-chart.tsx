'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface CategoryPieChartProps {
  series: Array<{
    name: string;
    value: number;
  }>;
}

const COLORS = [
  '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899',
  '#06b6d4', '#14b8a6', '#6366f1', '#ef4444', '#f472b6',
  '#6b7280',
];

/**
 * Donut chart showing spending by category.
 * Uses Recharts, loaded lazily by the parent.
 */
export default function CategoryPieChart({ series }: CategoryPieChartProps) {
  if (series.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={series}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={2}
          dataKey="value"
        >
          {series.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
              stroke="transparent"
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'rgb(24,24,27)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            fontSize: '11px',
          }}
          formatter={(value: any, name: any) => [
            `£${Number(value).toLocaleString('en-GB')}`,
            name,
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
