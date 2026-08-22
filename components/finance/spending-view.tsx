'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getCurrentUserId } from '@/lib/auth';
import { fmtCurrency, fmtPercent, currentYearMonth, yearMonthAgo, fmtMonth } from '@/lib/finance/format';
import { getMonthSpending, getSpendingByCategory, getMonthlySpendingHistory } from '@/lib/finance/transactions';
import { listRecurringTransactions } from '@/lib/finance/calculations';
import { listCategories } from '@/lib/finance/categories';
import type { RecurringTransaction, TransactionCategory } from '@/lib/finance/types';

const SpendingBarChart = dynamic(
  () => import('@/components/finance/charts/spending-bar-chart'),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const CategoryPieChart = dynamic(
  () => import('@/components/finance/charts/category-pie-chart'),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
      Loading chart…
    </div>
  );
}

interface SpendingData {
  currentMonth: string;
  currentSpending: number;
  previousSpending: number;
  average: number;
  difference: number;
  byCategory: Array<{
    categoryId: string;
    categoryName: string;
    total: number;
    count: number;
    percentage: number;
  }>;
  history: Array<{ month: string; spending: number; income: number }>;
  recurring: RecurringTransaction[];
  categories: TransactionCategory[];
}

export default function SpendingView() {
  const [data, setData] = useState<SpendingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const month = selectedMonth;
        const prevMonth = yearMonthAgo(1);

        const [currentSpending, previousSpending, byCategory, history, recurring, categories] =
          await Promise.all([
            getMonthSpending(month),
            getMonthSpending(prevMonth),
            getSpendingByCategory(month),
            getMonthlySpendingHistory(12),
            listRecurringTransactions(),
            listCategories(),
          ]);

        // Calculate average from history
        const avg = history.length > 1
          ? history.slice(0, -1).reduce((s, h) => s + h.spending, 0) / (history.length - 1)
          : currentSpending;

        const total = byCategory.reduce((s, c) => s + c.total, 0);

        if (cancelled) return;

        setData({
          currentMonth: month,
          currentSpending,
          previousSpending,
          average: avg,
          difference: currentSpending - avg,
          byCategory: byCategory.map((c) => ({
            ...c,
            percentage: total > 0 ? c.total / total : 0,
          })),
          history,
          recurring: recurring.filter((r) => r.type === 'expense'),
          categories,
        });
      } catch (e) {
        console.error('Failed to load spending:', e);
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedMonth]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
          <span className="text-xs text-zinc-500">Loading spending data…</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Hero stats */}
      <div className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/40 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Spending this month
            </div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {fmtCurrency(data.currentSpending)}
            </div>
            <div className="mt-1 text-xs text-zinc-400">
              {data.difference > 0 ? (
                <span className="text-red-300">
                  {fmtCurrency(data.difference)} above recent average
                </span>
              ) : (
                <span className="text-emerald-300">
                  {fmtCurrency(Math.abs(data.difference))} below recent average
                </span>
              )}
            </div>
          </div>
          <div className="hidden sm:block">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Month
            </label>
            <select
              value={data.currentMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200"
            >
              {data.history.map((h) => (
                <option key={h.month} value={h.month}>
                  {fmtMonth(h.month)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <PillStat label="This month" value={fmtCurrency(data.currentSpending)} />
          <PillStat label="Previous month" value={fmtCurrency(data.previousSpending)} />
          <PillStat label="Recent average" value={fmtCurrency(data.average)} />
        </div>
      </div>

      {/* Monthly trend chart */}
      <Section label="Monthly trend" sublabel="Spending over the last 12 months">
        <div className="h-48 sm:h-56">
          <SpendingBarChart series={data.history} />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Category breakdown */}
        <Section label="By category" sublabel="Where your money went">
          {data.byCategory.length > 0 ? (
            <>
              <div className="mb-4 h-48">
                <CategoryPieChart
                  series={data.byCategory.map((c) => ({
                    name: c.categoryName,
                    value: Math.round(c.total),
                  }))}
                />
              </div>
              <ul className="divide-y divide-zinc-800/40">
                {data.byCategory.map((cat) => (
                  <li key={cat.categoryId} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-300">{cat.categoryName}</span>
                      <span className="text-[10px] text-zinc-600">{cat.count} txns</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-500">{fmtPercent(cat.percentage)}</span>
                      <span className="font-mono text-sm text-zinc-100">{fmtCurrency(cat.total)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center">
              <div className="text-sm font-medium text-zinc-200">No spending data</div>
              <p className="mt-1 text-[11px] text-zinc-500">
                Import bank transactions or add manual entries to see your spending breakdown.
              </p>
            </div>
          )}
        </Section>

        {/* Recurring spending */}
        <Section label="Recurring spending" sublabel="Regular monthly costs">
          {data.recurring.length > 0 ? (
            <>
              <div className="mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Total monthly recurring
                </div>
                <div className="font-mono text-lg text-zinc-100">
                  {fmtCurrency(
                    data.recurring.reduce((s, r) => {
                      const mult = r.frequency === 'weekly' ? 4.33
                        : r.frequency === 'biweekly' ? 2.17
                        : r.frequency === 'quarterly' ? 1/3
                        : r.frequency === 'yearly' ? 1/12
                        : 1;
                      return s + r.amount * mult;
                    }, 0),
                  )}
                </div>
              </div>
              <ul className="divide-y divide-zinc-800/40">
                {data.recurring.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <div className="text-sm text-zinc-200">{r.description}</div>
                      <div className="mt-0.5 text-[10px] capitalize text-zinc-500">
                        {r.frequency}
                      </div>
                    </div>
                    <span className="font-mono text-sm text-zinc-100">{fmtCurrency(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center">
              <div className="text-sm font-medium text-zinc-200">No recurring transactions</div>
              <p className="mt-1 text-[11px] text-zinc-500">
                Recurring transactions are detected automatically from your imported data.
              </p>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// ─── Shared components ───────────────────────────────────────

function Section({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{label}</h2>
          {sublabel && <p className="text-[11px] text-zinc-500">{sublabel}</p>}
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
    <div className={`rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 ${className}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}
