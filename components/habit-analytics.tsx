'use client';

import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import {
  getDailyCompletionCounts,
  getCompletionsPerHabit,
  getCompletionRate,
} from '@/lib/analytics';
import { useMemo } from 'react';

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

function subtractDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function HabitAnalytics({
  refreshKey,
  userId,
  windowDays = 30,
}: {
  refreshKey?: number;
  userId?: string | null;
  /**
   * Window size for all three analytics charts, in days. Defaults to
   * 30 days so the existing layout stays the same when no value is
   * passed. When the user picks 7d or 14d via the segmented control
   * in `ActionsPage`, the same `startDate = subtractDays(windowDays-1)`
   * is used to query `habit_completions` for daily counts, per-habit
   * breakdown, and completion rate.
   */
  windowDays?: 7 | 14 | 30;
}) {
  const [mounted, setMounted] = useState(false);
  const [dailyData, setDailyData] = useState<{ date: string; count: number }[]>([]);
  const [habitBreakdown, setHabitBreakdown] = useState<
    { habitName: string; completions: number }[]
  >([]);
  const [rateData, setRateData] = useState<
    { date: string; rate: number; completions: number }[]
  >([]);
  const [todayCount, setTodayCount] = useState(0);
  const [thisWeekRate, setThisWeekRate] = useState(0);
  const [loading, setLoading] = useState(true);
  // Sort mode for the "By Habit" breakdown chart. UI-driven; default
  // matches the previous hardcoded behavior (most completed first).
  const [habitSort, setHabitSort] = useState<'top' | 'bottom' | 'az'>('top');

  useEffect(() => {
    // Delay chart rendering until layout is settled
    const timer = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const todayStr = subtractDays(0);
      // Single startDate drives all three chart queries — when the user
      // switches the window, this reruns the same fetches for the new range.
      const startStr = subtractDays(windowDays - 1);

      const [daily, breakdown, rate] = await Promise.all([
        getDailyCompletionCounts(startStr, todayStr, userId),
        getCompletionsPerHabit(startStr, todayStr, userId),
        getCompletionRate(startStr, todayStr, userId),
      ]);

      if (cancelled) return;

      // Fill in missing days with 0
      const filledDaily: { date: string; count: number }[] = [];
      for (let i = 13; i >= 0; i--) {
        const date = subtractDays(i);
        const existing = daily.find((d) => d.date === date);
        filledDaily.push({ date, count: existing?.count ?? 0 });
      }

      setDailyData(filledDaily);
      // Store raw rows — `sortedHabitBreakdown` below applies the user's
      // chosen sort order on render.
      setHabitBreakdown(breakdown);
      setRateData(
        rate.map((r) => ({
          date: r.date,
          rate: Math.round(r.rate * 100),
          completions: r.completions,
        })),
      );

      // Today's completions
      setTodayCount(filledDaily[filledDaily.length - 1]?.count ?? 0);

      // This week's average completion rate
      if (rate.length > 0) {
        const avg = rate.reduce((sum, r) => sum + r.rate, 0) / rate.length;
        setThisWeekRate(Math.round(avg * 100));
      }

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // Rerun when the window changes, the parent forces a refresh, or the
    // signed-in user switches.
  }, [refreshKey, windowDays, userId]);

  // Apply the user's chosen sort. Recomputed only when `habitBreakdown`
  // or `habitSort` changes, so toggling sort never re-fetches data and
  // is essentially free.
  const sortedHabitBreakdown = useMemo(() => {
    if (!habitBreakdown || habitBreakdown.length === 0) return [];
    const arr = [...habitBreakdown];
    switch (habitSort) {
      case 'top':
        return arr.sort((a, b) => b.completions - a.completions);
      case 'bottom':
        return arr.sort((a, b) => a.completions - b.completions);
      case 'az':
        return arr.sort((a, b) => a.habitName.localeCompare(b.habitName));
      default:
        return arr;
    }
  }, [habitBreakdown, habitSort]);

  if (loading) {
    return (
      <section>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Analytics
      </h2>

      {/* Stats Cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Today
          </p>
          <p className="mt-1.5 text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {todayCount}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            habits completed
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            This Week
          </p>
          <p className="mt-1.5 text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {thisWeekRate}%
          </p>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            average completion rate
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Total Habits
          </p>
          <p className="mt-1.5 text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
            {habitBreakdown.length}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            active habits tracked
          </p>
        </div>
      </div>

      {/* Daily Completion Chart */}
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Daily Completions
        </h3>          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            Last {windowDays} days
          </p>
        <div className="mt-4 h-56 min-w-0">
          {mounted && (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} barCategoryGap="30%">
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="stroke-zinc-200 dark:stroke-zinc-700"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={dayLabel}
                  tick={{ fontSize: 11, fill: '#a1a1aa' }}
                  axisLine={{ stroke: '#e4e4e7' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  labelFormatter={(label) => formatDate(label)}
                  formatter={(value) => [value ?? 0, 'completions']}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid var(--border, #e4e4e7)',
                    fontSize: '13px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    background: 'var(--tooltip-bg, #fff)',
                    color: 'var(--tooltip-fg, #18181b)',
                  }}
                />
                <Bar
                  dataKey="count"
                  radius={[4, 4, 0, 0]}
                  className="fill-emerald-400 dark:fill-emerald-500"
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts row */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {/* Per-Habit Breakdown */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                By Habit
              </h3>
              <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
                Completions in the last {windowDays} days
              </p>
            </div>
            {/* Sort selector — same pill style as the window control above */}
            <div
              className="flex shrink-0 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800"
              role="group"
              aria-label="Sort habits"
            >
              {(
                [
                  { key: 'top', label: 'Top \u2193' },
                  { key: 'bottom', label: 'Bottom \u2191' },
                  { key: 'az', label: 'A\u2192Z' },
                ] as const
              ).map((opt) => {
                const active = habitSort === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setHabitSort(opt.key)}
                    aria-pressed={active}
                    className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ${
                      active
                        ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-4 h-64 min-w-0">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedHabitBreakdown}
                  layout="vertical"
                  barCategoryGap="25%"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="currentColor"
                    className="stroke-zinc-200 dark:stroke-zinc-700"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <YAxis
                    type="category"
                    dataKey="habitName"
                    tick={{ fontSize: 12, fill: '#71717a' }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip
                    formatter={(value) => [value ?? 0, 'completions']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--border, #e4e4e7)',
                      fontSize: '13px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      background: 'var(--tooltip-bg, #fff)',
                      color: 'var(--tooltip-fg, #18181b)',
                    }}
                  />
                  <Bar
                    dataKey="completions"
                    radius={[0, 4, 4, 0]}
                    className="fill-violet-400 dark:fill-violet-500"
                    maxBarSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Weekly Completion Rate */}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Completion Rate
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
            Percentage of habits completed each day (last {windowDays} days)
          </p>
          <div className="mt-4 h-64 min-w-0">
            {mounted && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rateData}>
                  <defs>
                    <linearGradient id="rateGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#818cf8" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="currentColor"
                    className="stroke-zinc-200 dark:stroke-zinc-700"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={dayLabel}
                    tick={{ fontSize: 11, fill: '#a1a1aa' }}
                    axisLine={{ stroke: '#e4e4e7' }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#a1a1aa' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    labelFormatter={(label) => formatDate(label)}
                    formatter={(value) => [`${value ?? 0}%`, 'rate']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid var(--border, #e4e4e7)',
                      fontSize: '13px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      background: 'var(--tooltip-bg, #fff)',
                      color: 'var(--tooltip-fg, #18181b)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="rate"
                    stroke="#818cf8"
                    strokeWidth={2}
                    fill="url(#rateGradient)"
                    dot={{ r: 3, fill: '#818cf8', stroke: '#fff', strokeWidth: 2 }}
                    activeDot={{ r: 5, fill: '#818cf8', stroke: '#fff', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
