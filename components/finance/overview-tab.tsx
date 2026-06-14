'use client';

import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import type { Account, Transaction } from '@/lib/finance/types';
import type { ProjectionInputs, ProjectionResult } from '@/lib/finance/projections';
import SavingsAccountsWidget from './savings-accounts-widget';
import InvestingAccountsWidget from './investing-accounts-widget';
import PortfolioValueWidget from './portfolio-value-widget';

function fmt(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `£${(n / 1_000).toFixed(1)}K`;
  return `£${n.toFixed(0)}`;
}

interface OverviewTabProps {
  netWorth: number;
  totalIncome: number;
  totalSpending: number;
  netCashflow: number;
  accounts: Account[];
  transactions: Transaction[];
  projection: ProjectionResult;
  projectionInputs: ProjectionInputs;
  onInputsChange: (inputs: ProjectionInputs) => void;
  onRefresh: () => void;
}

export default function OverviewTab({
  netWorth,
  totalIncome,
  totalSpending,
  netCashflow,
  accounts,
  transactions,
  projection,
  projectionInputs,
  onInputsChange,
  onRefresh,
}: OverviewTabProps) {
  const progressPct = Math.min((netWorth / 5_000_000) * 100, 100);

  // Group accounts by type
  const byType: Record<string, Account[]> = {};
  for (const acct of accounts) {
    if (!byType[acct.type]) byType[acct.type] = [];
    byType[acct.type].push(acct);
  }

  // Calculate projected annual interest from accounts
  const projectedMonthlyInterest = useMemo(() => {
    let total = 0;
    for (const a of accounts) {
      if (a.interest_rate != null && Number(a.balance) > 0) {
        const rate = Number(a.interest_rate) / 100;
        const balance = Number(a.balance);
        if (a.is_cumulative) {
          total += balance * rate;
        } else {
          const capped = a.max_interest_amount != null ? Math.min(balance, a.max_interest_amount) : balance;
          total += capped * rate;
        }
      }
    }
    return total / 12;
  }, [accounts]);

  // Key growth points (milestones) for dashed lines on the goal bar
  const GROWTH_POINTS = [100_000, 250_000, 500_000, 1_000_000, 5_000_000];

  return (
    <div className="space-y-5">
      {/* ═══════════════ Goal Bar with Projected Trajectory ═══════════════ */}
      <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/50 p-4 backdrop-blur-xl">
        <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/[0.03] to-transparent" />

        <div className="relative flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-[9px] font-semibold tracking-[0.2em] text-emerald-400/80">FINANCIAL TARGET</span>
            <span className="font-mono text-lg font-bold text-amber-400/90">£5M</span>
            <span className="text-xs text-zinc-500">by age {projectionInputs.targetAge}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[9px] text-zinc-600">NET WORTH</span>
            <span className={`font-mono text-base font-bold ${netWorth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {fmt(netWorth)}
            </span>
          </div>
        </div>

        {/* Goal progress bar with dashed growth point markers */}
        <div className="relative mb-1">
          {/* Progress track */}
          <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-500"
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
          {/* Dashed growth point markers — separate container, no overflow clip */}
          <div className="relative" style={{ height: '28px' }}>
            {GROWTH_POINTS.map((point) => {
              const pct = Math.min((point / 5_000_000) * 100, 100);
              const isPast = netWorth >= point;
              const milestone = projection.milestones.find((m) => m.amount === point);
              return (
                <div
                  key={point}
                  className="absolute flex flex-col items-center"
                  style={{ left: `${pct}%`, transform: 'translateX(-50%)', top: '0' }}
                >
                  {/* Dashed line */}
                  <div
                    className={`h-3 w-px border-r border-dashed ${
                      isPast ? 'border-emerald-500/60' : 'border-zinc-600/40'
                    }`}
                  />
                  {/* Label */}
                  <span className={`whitespace-nowrap font-mono text-[7px] leading-tight ${
                    isPast ? 'text-emerald-500/70' : 'text-zinc-600'
                  }`}>
                    {fmtShort(point)}
                  </span>
                  {milestone?.age != null && (
                    <span className={`whitespace-nowrap font-mono text-[6px] leading-tight ${
                      isPast ? 'text-emerald-500/40' : 'text-zinc-700'
                    }`}>
                      @{milestone.age}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p className="relative text-right text-[9px] text-zinc-600">
          {progressPct.toFixed(2)}% of target
        </p>

        {/* Projected trajectory — integrated into the header */}
        <div className="relative mt-3 grid grid-cols-3 gap-4 rounded-lg border border-zinc-800/30 bg-zinc-900/40 p-3">
          <div>
            <p className="text-[9px] text-zinc-500">Projected at {projectionInputs.targetAge} (nominal)</p>
            <p className={`mt-0.5 font-mono text-sm font-bold ${projection.targetMet ? 'text-emerald-400' : 'text-amber-400'}`}>
              {fmt(projection.finalNominal)}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-zinc-500">Inflation-adjusted</p>
            <p className={`mt-0.5 font-mono text-sm font-bold ${projection.finalAdjusted >= 5_000_000 ? 'text-emerald-400' : 'text-amber-400'}`}>
              {fmt(projection.finalAdjusted)}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-zinc-500">Status</p>
            <p className={`mt-0.5 font-mono text-sm font-bold ${projection.targetMet ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]' : 'text-amber-400'}`}>
              {projection.targetMet ? 'ON TRACK ✓' : 'ADJUST ASSUMPTIONS'}
            </p>
          </div>
        </div>
      </div>

      {/* ═══════════════ Row 1: Net Worth + This Month (Circular Chart) ═══════════════ */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* ── Net Worth Card ── */}
        <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/50 p-4 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.03] to-transparent" />
          <div className="relative mb-3 flex items-center justify-between">
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-[10px] font-semibold tracking-[0.15em] text-transparent">NET WORTH</span>
            <span className="text-[9px] text-zinc-600">All accounts</span>
          </div>
          <p className={`relative font-mono text-2xl font-bold ${netWorth >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(netWorth)}
          </p>
          <div className="relative mt-3 space-y-1.5">
            {Object.entries(byType).map(([type, accts]) => {
              const typeTotal = accts.reduce((s, a) => s + Number(a.balance), 0);
              return (
                <div key={type} className="flex items-center justify-between text-[10px] text-zinc-400">
                  <span className="capitalize">{type}</span>
                  <span className="font-mono">{fmt(typeTotal)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── This Month — Circular Chart ── */}
        <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/50 p-4 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-500/[0.03] to-transparent" />
          <div className="relative mb-3">
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-[10px] font-semibold tracking-[0.15em] text-transparent">
              THIS MONTH · {new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase()}
            </span>
          </div>

          <div className="relative flex items-center gap-6">
            {/* Donut chart */}
            <div className="relative h-[120px] w-[120px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Income', value: Math.max(totalIncome, 0.01) },
                      { name: 'Spending', value: Math.max(totalSpending, 0.01) },
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={55}
                    startAngle={90}
                    endAngle={-270}
                    dataKey="value"
                  >
                    <Cell fill="#34d399" />
                    <Cell fill="#f87171" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* Net amount — centered inside the donut */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <p className={`font-mono text-sm font-bold ${netCashflow >= 0 ? 'text-emerald-400 drop-shadow-[0_0_4px_rgba(52,211,153,0.4)]' : 'text-red-400 drop-shadow-[0_0_4px_rgba(248,113,113,0.4)]'}`}>
                    {netCashflow >= 0 ? '+' : ''}{fmtShort(netCashflow)}
                  </p>
                  <p className="text-[8px] font-semibold tracking-[0.1em] text-zinc-500">NET</p>
                </div>
              </div>
            </div>

            {/* Legend + interest earned */}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-[10px] text-zinc-400">Income</span>
                <span className="ml-auto font-mono text-[10px] text-emerald-400">{fmt(totalIncome)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-[10px] text-zinc-400">Spending</span>
                <span className="ml-auto font-mono text-[10px] text-red-400">{fmt(totalSpending)}</span>
              </div>
              <div className="mt-2 border-t border-zinc-800/40 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-500">Interest Earned (est/mo)</span>
                  <span className="font-mono text-[10px] text-cyan-400">{fmt(Math.round(projectedMonthlyInterest))}</span>
                </div>
                <p className="mt-0.5 text-[7px] text-zinc-700">Projected from account rates</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════ Row 2: Savings + Investing Accounts Widgets ═══════════════ */}
      <div className="grid gap-5 md:grid-cols-2">
        <SavingsAccountsWidget accounts={accounts} transactions={transactions} onRefresh={onRefresh} />
        <InvestingAccountsWidget accounts={accounts} transactions={transactions} onRefresh={onRefresh} />
      </div>

      {/* ═══════════════ Portfolio Value Widget ═══════════════ */}
      <PortfolioValueWidget
        inputs={projectionInputs}
        onInputsChange={onInputsChange}
        projection={projection}
        netWorth={netWorth}
      />
    </div>
  );
}
