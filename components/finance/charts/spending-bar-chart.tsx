'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { fmtMonthShort } from '@/lib/finance/format';

interface SpendingBarChartProps {
  series: Array<{
    month: string;
    spending: number;
    income: number;
  }>;
}

/**
 * Stacked bar chart showing spending vs income over recent months.
 * Uses Recharts, loaded lazily by the parent.
 */
export default function SpendingBarChart({ series }: SpendingBarChartProps) {
  if (series.length === 0) return null;

  const data = series.map((s) => ({
    name: fmtMonthShort(s.month),
    Spending: Math.round(s.spending),
    Income: Math.round(s.income),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#71717a' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v: number) =>
            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
          }
        />
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
        <Legend
          wrapperStyle={{ fontSize: '10px', color: '#a1a1aa' }}
        />
        <Bar dataKey="Income" fill="#10b981" radius={[2, 2, 0, 0]} />
        <Bar dataKey="Spending" fill="#ef4444" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
