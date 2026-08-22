'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { fmtShortDate } from '@/lib/finance/format';

interface NetWorthMiniChartProps {
  series: Array<{
    date: string;
    netWorth: number;
    cash: number;
    investments: number;
  }>;
}

/**
 * Mini area chart showing net worth trend over time.
 * Uses Recharts, loaded lazily by the parent.
 */
export default function NetWorthMiniChart({ series }: NetWorthMiniChartProps) {
  if (series.length === 0) return null;

  const data = series.map((s) => ({
    name: fmtShortDate(s.date),
    'Net Worth': Math.round(s.netWorth),
    Cash: Math.round(s.cash),
    Investments: Math.round(s.investments),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>
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
            v >= 1000000
              ? `${(v / 1000000).toFixed(1)}m`
              : v >= 1000
              ? `${(v / 1000).toFixed(0)}k`
              : String(v)
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
        <Area
          type="monotone"
          dataKey="Net Worth"
          stroke="#10b981"
          fillOpacity={1}
          fill="url(#nwGrad)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
