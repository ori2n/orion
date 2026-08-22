'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  fmtCurrency,
  fmtCurrencyWhole,
  fmtPercent,
  fmtMonth,
  fmtMonthShort,
  currentYearMonth,
  yearMonthAgo,
  calculateAge,
} from '@/lib/finance/format';
import {
  calculateNetWorth,
  buildProjectionScenarios,
  calculateMilestones,
  getNextMilestone,
  calculateMoneyFlow,
  getMilestoneLabel,
  MILESTONE_AMOUNTS,
} from '@/lib/finance/calculations';
import { getMonthSpending, getSpendingByCategory, getMonthlySpendingHistory } from '@/lib/finance/transactions';
import { listAccounts } from '@/lib/finance/accounts';
import { listRecurringTransactions } from '@/lib/finance/calculations';
import { generateInsights } from '@/lib/finance/insights';
import type {
  FinancialAccount,
  FinancialInsight,
  GoalProjection,
  Milestone,
  MoneyFlow,
  MonthlySpending,
} from '@/lib/finance/types';

// Lazy-load recharts (~300 KB)
const SpendingBarChart = dynamic(
  () => import('@/components/finance/charts/spending-bar-chart'),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const NetWorthMiniChart = dynamic(
  () => import('@/components/finance/charts/net-worth-mini-chart'),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
      Loading chart…
    </div>
  );
}

// ─── Dashboard Data ──────────────────────────────────────────

interface DashboardData {
  netWorth: { totalCash: number; totalInvestments: number; totalNetWorth: number };
  accounts: FinancialAccount[];
  projection: GoalProjection | null;
  milestones: Milestone[];
  moneyFlow: MoneyFlow;
  spendingComparison: { currentMonth: number; average: number; difference: number; percentDiff: number };
  monthlySpending: Array<{ month: string; spending: number; income: number }>;
  insights: FinancialInsight[];
  recurringTotal: number;
}

export default function FinanceOverview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const [
          netWorth,
          accounts,
          projection,
          milestones,
          moneyFlow,
          monthlySpending,
          insights,
        ] = await Promise.all([
          calculateNetWorth(),
          listAccounts(),
          buildProjectionScenarios().catch(() => null),
          calculateMilestones().catch(() => []),
          calculateMoneyFlow().catch(() => ({
            income: 0, spending: 0, saved: 0, invested: 0, month: currentYearMonth(),
          })),
          getMonthlySpendingHistory(6).catch(() => []),
          generateInsights().catch(() => []),
        ]);

        // Spending comparison
        const month = currentYearMonth();
        const prevMonth = yearMonthAgo(1);
        const [currentSpending, prevSpending, income] = await Promise.all([
          getMonthSpending(month),
          getMonthSpending(prevMonth),
          import('@/lib/finance/transactions').then((m) => m.getMonthIncome(month)),
        ]);
        const avg = monthlySpending.length > 0
          ? monthlySpending.slice(0, -1).reduce((s, m) => s + m.spending, 0) / Math.max(1, monthlySpending.length - 1)
          : currentSpending;

        // Recurring
        const recurring = await listRecurringTransactions().catch(() => []);

        if (cancelled) return;

        setData({
          netWorth,
          accounts,
          projection,
          milestones,
          moneyFlow,
          spendingComparison: {
            currentMonth: currentSpending,
            average: avg,
            difference: currentSpending - avg,
            percentDiff: avg > 0 ? (currentSpending - avg) / avg : 0,
          },
          monthlySpending,
          insights,
          recurringTotal: recurring.reduce((s, r) => {
            if (r.type !== 'expense') return s;
            const mult = r.frequency === 'weekly' ? 4.33
              : r.frequency === 'biweekly' ? 2.17
              : r.frequency === 'quarterly' ? 1/3
              : r.frequency === 'yearly' ? 1/12
              : 1;
            return s + r.amount * mult;
          }, 0),
        });
      } catch (e) {
        console.error('Failed to load dashboard:', e);
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
          <span className="text-xs text-zinc-500">Loading finance data…</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ─── 1. Hero strip ─────────────────────────────────── */}
      <HeroStrip data={data} />

      {/* ─── 2. Goal card ──────────────────────────────────── */}
      {data.projection && (
        <Section label="Financial independence" sublabel="Your path to £3m">
          <GoalCard projection={data.projection} />
        </Section>
      )}

      {/* ─── 3. Money flow ─────────────────────────────────── */}
      <Section label="Money flow" sublabel="Where your money went this month">
        <MoneyFlowPanel flow={data.moneyFlow} />
      </Section>

      {/* ─── 4. Spending ───────────────────────────────────── */}
      <Section label="Spending" sublabel="Recent months">
        <SpendingPanel
          comparison={data.spendingComparison}
          history={data.monthlySpending}
          recurringTotal={data.recurringTotal}
        />
      </Section>

      {/* ─── 5. Net worth + Investments side-by-side ───────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section label="Net worth" sublabel="Total assets">
          <NetWorthPanel data={data.netWorth} accounts={data.accounts} />
        </Section>
        <Section label="Accounts" sublabel="All financial accounts">
          <AccountsPanel accounts={data.accounts} />
        </Section>
      </div>

      {/* ─── 6. Milestones ─────────────────────────────────── */}
      <Section label="Milestones" sublabel="Portfolio milestones">
        <MilestonesPanel milestones={data.milestones} netWorth={data.netWorth.totalNetWorth} />
      </Section>

      {/* ─── 7. Insights ───────────────────────────────────── */}
      {data.insights.length > 0 && (
        <Section label="Insights" sublabel="Based on your data">
          <InsightsPanel insights={data.insights} />
        </Section>
      )}

      {/* ─── 8. Quick actions ──────────────────────────────── */}
      <Section label="Quick actions" sublabel="Manage your finances">
        <QuickActions />
      </Section>
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────

function HeroStrip({ data }: { data: DashboardData }) {
  return (
    <div className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/40 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Total net worth
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {fmtCurrency(data.netWorth.totalNetWorth)}
          </div>
          <div className="mt-1 flex gap-3 text-xs text-zinc-400">
            <span>
              Cash: <span className="font-mono text-zinc-200">{fmtCurrency(data.netWorth.totalCash)}</span>
            </span>
            <span>
              Investments: <span className="font-mono text-zinc-200">{fmtCurrency(data.netWorth.totalInvestments)}</span>
            </span>
          </div>
        </div>
        <div className="hidden grid-cols-2 gap-3 sm:grid">
          <HeroStat label="This month" value={fmtCurrency(data.moneyFlow.income)} sublabel="Income" />
          <HeroStat label="Saved" value={fmtCurrency(data.moneyFlow.saved)} sublabel="This month" />
          <HeroStat label="Spending" value={fmtCurrency(data.spendingComparison.currentMonth)} sublabel={data.spendingComparison.difference > 0 ? '↑ above avg' : '↓ below avg'} />
          <HeroStat label="Investing" value={fmtCurrency(data.moneyFlow.invested)} sublabel="This month" />
        </div>
      </div>
      {/* Mobile stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:hidden">
        <HeroStat label="Income" value={fmtCurrency(data.moneyFlow.income)} sublabel="This month" />
        <HeroStat label="Saved" value={fmtCurrency(data.moneyFlow.saved)} sublabel="This month" />
        <HeroStat label="Spending" value={fmtCurrency(data.spendingComparison.currentMonth)} sublabel={data.spendingComparison.difference > 0 ? '↑ above avg' : '↓ below avg'} />
        <HeroStat label="Investing" value={fmtCurrency(data.moneyFlow.invested)} sublabel="This month" />
      </div>
    </div>
  );
}

function HeroStat({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-4 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base text-zinc-100">{value}</div>
      {sublabel && <div className="text-[10px] text-zinc-500">{sublabel}</div>}
    </div>
  );
}

function GoalCard({ projection }: { projection: GoalProjection }) {
  const { goal, scenarios, currentAge, yearsRemaining, monthlyInvestment } = projection;
  const base = scenarios.find((s) => s.name === 'base');
  const progress = goal.target_amount > 0
    ? Math.min(1, (goal.current_amount ?? 0) / goal.target_amount)
    : 0;

  return (
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Left: goal info */}
        <div className="flex-1">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold text-zinc-100">£3m by 45</span>
            {base && (
              <span
                className={
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ' +
                  (base.isAhead
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : base.isOnTrack
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-red-500/15 text-red-300')
                }
              >
                {base.isAhead ? 'Ahead of target' : base.isOnTrack ? 'On track' : 'Behind target'}
              </span>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Current</div>
              <div className="font-mono text-zinc-100">{fmtCurrency(goal.current_amount)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Target</div>
              <div className="font-mono text-zinc-100">{fmtCurrency(goal.target_amount)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Monthly</div>
              <div className="font-mono text-zinc-100">{fmtCurrency(monthlyInvestment)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                {currentAge !== null ? `Age ${currentAge}` : 'Age'}
              </div>
              <div className="font-mono text-zinc-100">
                {yearsRemaining !== null ? `${yearsRemaining} yrs left` : '—'}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
              <span>Progress to goal</span>
              <span>{fmtPercent(progress)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
                style={{ width: `${Math.max(1, progress * 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right: scenario projections */}
        <div className="flex flex-col gap-2 sm:min-w-[200px]">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Projected at 45
          </div>
          {scenarios.map((s) => (
            <div key={s.name} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400">{s.label}</span>
              <span className="font-mono text-zinc-200">{fmtCurrency(s.projectedPortfolio)}</span>
            </div>
          ))}
          <div className="mt-1 border-t border-zinc-800/40 pt-2 text-[10px] text-zinc-600">
            Based on illustrative assumptions — not predictions.
          </div>
        </div>
      </div>
    </div>
  );
}

function MoneyFlowPanel({ flow }: { flow: MoneyFlow }) {
  const total = Math.max(flow.income, flow.spending + flow.saved + flow.invested, 1);
  const items = [
    { label: 'Income', value: flow.income, color: 'bg-emerald-500' },
    { label: 'Spending', value: flow.spending, color: 'bg-red-400' },
    { label: 'Saved', value: flow.saved, color: 'bg-cyan-500' },
    { label: 'Invested', value: flow.invested, color: 'bg-violet-500' },
  ];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">{fmtMonth(flow.month)}</span>
        <span>→</span>
        <span>Income {fmtCurrency(flow.income)}</span>
        <span>→</span>
        <span>Spent {fmtCurrency(flow.spending)}</span>
        <span>→</span>
        <span>Saved {fmtCurrency(flow.saved)}</span>
      </div>
      <div className="h-4 overflow-hidden rounded-full bg-zinc-800">
        <div className="flex h-full">
          {items.map((item) => (
            <div
              key={item.label}
              className={`${item.color} h-full transition-all duration-500`}
              style={{ width: `${(item.value / total) * 100}%` }}
              title={`${item.label}: ${fmtCurrency(item.value)}`}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <span className={`h-2 w-2 rounded-full ${item.color}`} />
            <span>{item.label}</span>
            <span className="font-mono text-zinc-200">{fmtCurrency(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpendingPanel({
  comparison,
  history,
  recurringTotal,
}: {
  comparison: DashboardData['spendingComparison'];
  history: DashboardData['monthlySpending'];
  recurringTotal: number;
}) {
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3 sm:grid-cols-4">
        <PillStat
          label="This month"
          value={fmtCurrency(comparison.currentMonth)}
        />
        <PillStat
          label="Recent avg"
          value={fmtCurrency(comparison.average)}
        />
        <PillStat
          label="Difference"
          value={fmtCurrency(comparison.difference, { showSign: true })}
          className={comparison.difference > 0 ? 'text-red-300' : 'text-emerald-300'}
        />
        <PillStat
          label="Recurring"
          value={fmtCurrency(recurringTotal)}
          className="hidden sm:block"
        />
      </div>

      {/* Chart */}
      {history.length > 0 && (
        <div className="h-44 sm:h-48">
          <SpendingBarChart
            series={history.map((h) => ({
              month: h.month,
              spending: h.spending,
              income: h.income,
            }))}
          />
        </div>
      )}

      <div className="mt-2 text-[11px] text-zinc-500">
        <Link href="/finance/spending" className="hover:text-zinc-200">
          Detailed spending analytics →
        </Link>
      </div>
    </div>
  );
}

function NetWorthPanel({
  data,
  accounts,
}: {
  data: DashboardData['netWorth'];
  accounts: FinancialAccount[];
}) {
  const savings = accounts.filter((a) => a.type === 'savings' || a.type === 'cash');
  const investments = accounts.filter((a) => a.type === 'investment' || a.type === 'isa');

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <PillStat label="Cash" value={fmtCurrency(data.totalCash)} />
        <PillStat label="Investments" value={fmtCurrency(data.totalInvestments)} />
      </div>

      {savings.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Savings accounts
          </div>
          <ul className="divide-y divide-zinc-800/40">
            {savings.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-xs">
                <span className="text-zinc-300">{a.name}</span>
                <span className="font-mono text-zinc-100">{fmtCurrency(a.balance)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {investments.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Investment accounts
          </div>
          <ul className="divide-y divide-zinc-800/40">
            {investments.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2 text-xs">
                <div>
                  <span className="text-zinc-300">{a.name}</span>
                  {a.is_jisa && (
                    <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                      JISA
                    </span>
                  )}
                </div>
                <span className="font-mono text-zinc-100">{fmtCurrency(a.balance)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {accounts.length === 0 && (
        <EmptyHint
          title="No accounts yet"
          body="Add your savings and investment accounts to see your net worth."
          ctaHref="/finance/manage"
          ctaLabel="Add account"
        />
      )}
    </div>
  );
}

function AccountsPanel({ accounts }: { accounts: FinancialAccount[] }) {
  if (accounts.length === 0) {
    return (
      <EmptyHint
        title="No accounts"
        body="Add financial accounts in Manage Data to track your finances."
        ctaHref="/finance/manage"
        ctaLabel="Add account"
      />
    );
  }

  return (
    <ul className="divide-y divide-zinc-800/40">
      {accounts.map((a) => (
        <li key={a.id} className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium text-zinc-100">{a.name}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="capitalize">{a.type}</span>
              {a.institution && <span>· {a.institution}</span>}
              {a.interest_rate !== null && (
                <span>· {fmtPercent(a.interest_rate / 100)} AER</span>
              )}
              {a.is_jisa && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                  JISA
                </span>
              )}
            </div>
          </div>
          <span className="font-mono text-sm text-zinc-100">{fmtCurrency(a.balance)}</span>
        </li>
      ))}
    </ul>
  );
}

function MilestonesPanel({
  milestones,
  netWorth,
}: {
  milestones: Milestone[];
  netWorth: number;
}) {
  const next = getNextMilestone(milestones);

  return (
    <div>
      {next && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Next milestone
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-200">{next.label}</span>
            <span className="text-xs text-zinc-500">
              {fmtCurrency(next.amount - netWorth)} to go
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500"
              style={{
                width: `${Math.min(100, (netWorth / next.amount) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {milestones.map((m) => (
          <div
            key={m.amount}
            className={
              'rounded-lg border px-3 py-2 text-xs ' +
              (m.reached
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-zinc-800/40 bg-zinc-950/30 text-zinc-500')
            }
          >
            <div className="font-medium">{m.label}</div>
            {m.reachedDate && (
              <div className="mt-0.5 text-[10px] text-zinc-500">
                {m.reachedDate}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightsPanel({ insights }: { insights: FinancialInsight[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-3"
        >
          <div className="flex items-start gap-2">
            <span className="text-lg">{insight.icon}</span>
            <div className="flex-1">
              <div className="text-xs font-medium text-zinc-200">{insight.title}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                {insight.body}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickActions() {
  const actions = [
    { href: '/finance/manage', label: 'Import CSV', icon: '📄', detail: 'Import bank transactions' },
    { href: '/finance/manage', label: 'Add transaction', icon: '➕', detail: 'Manual entry' },
    { href: '/finance/manage', label: 'Update balance', icon: '🏦', detail: 'Account balances' },
    { href: '/finance/manage', label: 'Manage categories', icon: '🏷️', detail: 'Spending categories' },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map((action) => (
        <Link
          key={action.label}
          href={action.href}
          className="group flex flex-col rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-3 py-3 transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
        >
          <span className="text-lg">{action.icon}</span>
          <div className="mt-1 text-sm font-medium text-zinc-100 group-hover:text-white">
            {action.label}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">{action.detail}</div>
        </Link>
      ))}
    </div>
  );
}

// ─── Shared small components ─────────────────────────────────

function Section({
  label,
  sublabel,
  children,
  className = '',
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        'mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5 ' +
        className
      }
    >
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            {label}
          </h2>
          {sublabel && (
            <p className="text-[11px] text-zinc-500">{sublabel}</p>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

function PillStat({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={
        'rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 ' +
        className
      }
    >
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

function EmptyHint({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-[11px] text-zinc-500">{body}</p>
      <Link
        href={ctaHref}
        className="mt-3 inline-block rounded-md bg-zinc-800/60 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700/60"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
