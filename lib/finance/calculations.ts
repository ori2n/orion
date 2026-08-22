/**
 * Financial calculations for the ORION Finance module.
 *
 * Handles:
 * - Net worth computation and snapshots
 * - Spending analytics (monthly, by category, comparisons)
 * - £3m age-45 projection engine with multiple scenarios
 * - Money flow calculations
 * - Milestone tracking
 */
import { supabase } from '@/lib/supabase';
import type {
  NetWorthSnapshot,
  FinancialGoal,
  ProjectionSettings,
  ProjectionScenario,
  GoalProjection,
  DashboardMetrics,
  SpendingByCategory,
  MonthlySpending,
  MoneyFlow,
  Milestone,
  RecurringTransaction,
} from './types';
import { calculateAge, currentYearMonth, yearMonthAgo } from './format';
import { listAccounts, getSavingsAccounts, getInvestmentAccounts } from './accounts';
import { getMonthSpending, getMonthIncome, getSpendingByCategory } from './transactions';

// ─── Net Worth ───────────────────────────────────────────────

/** Calculate current net worth from all accounts. */
export async function calculateNetWorth(): Promise<{
  totalCash: number;
  totalInvestments: number;
  totalNetWorth: number;
}> {
  const accounts = await listAccounts();
  let totalCash = 0;
  let totalInvestments = 0;

  for (const account of accounts) {
    if (account.type === 'savings' || account.type === 'cash') {
      totalCash += account.balance ?? 0;
    } else if (account.type === 'investment' || account.type === 'isa') {
      totalInvestments += account.balance ?? 0;
    }
  }

  return {
    totalCash,
    totalInvestments,
    totalNetWorth: totalCash + totalInvestments,
  };
}

/** Save a net worth snapshot for today. */
export async function saveNetWorthSnapshot(): Promise<NetWorthSnapshot | null> {
  const { totalCash, totalInvestments, totalNetWorth } = await calculateNetWorth();
  const today = new Date().toISOString().slice(0, 10);

  // Upsert: one snapshot per user per date
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .upsert(
      {
        snapshot_date: today,
        total_cash: totalCash,
        total_investments: totalInvestments,
        total_assets: totalNetWorth,
        total_liabilities: 0,
        net_worth: totalNetWorth,
      },
      { onConflict: 'user_id,snapshot_date' },
    )
    .select()
    .single();

  if (error) {
    console.error('Failed to save net worth snapshot:', error);
    return null;
  }
  return data as NetWorthSnapshot;
}

/** List net worth snapshots, most recent first. */
export async function listNetWorthSnapshots(
  limit = 365,
): Promise<NetWorthSnapshot[]> {
  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to list net worth snapshots:', error);
    return [];
  }
  return (data ?? []) as NetWorthSnapshot[];
}

// ─── Dashboard Metrics ───────────────────────────────────────

/** Build all dashboard metrics in parallel. */
export async function buildDashboardMetrics(): Promise<DashboardMetrics> {
  const month = currentYearMonth();
  const prevMonth = yearMonthAgo(1);

  const [netWorth, spending, prevSpending, income, categories] = await Promise.all([
    calculateNetWorth(),
    getMonthSpending(month),
    getMonthSpending(prevMonth),
    getMonthIncome(month),
    getSpendingByCategory(month),
  ]);

  // Investing this month = income - spending (rough estimate)
  const investing = Math.max(0, income - spending);

  return {
    totalNetWorth: netWorth.totalNetWorth,
    totalCash: netWorth.totalCash,
    totalInvestments: netWorth.totalInvestments,
    spendingThisMonth: spending,
    savingThisMonth: Math.max(0, income - spending),
    investingThisMonth: investing,
    investmentPortfolioValue: netWorth.totalInvestments,
  };
}

// ─── Spending Analytics ──────────────────────────────────────

/** Build monthly spending data with category breakdowns. */
export async function buildMonthlySpending(
  months = 6,
): Promise<MonthlySpending[]> {
  const result: MonthlySpending[] = [];

  for (let i = 0; i < months; i++) {
    const month = yearMonthAgo(i);
    const [spending, byCategory] = await Promise.all([
      getMonthSpending(month),
      getSpendingByCategory(month),
    ]);

    const total = byCategory.reduce((s, c) => s + c.total, 0);

    result.push({
      month,
      total,
      byCategory: byCategory.map((c) => ({
        categoryId: c.categoryId,
        categoryName: c.categoryName,
        categoryIcon: null,
        categoryColor: null,
        total: c.total,
        count: c.count,
        percentage: total > 0 ? c.total / total : 0,
      })),
    });
  }

  return result.reverse(); // oldest first
}

/** Compare current month spending to recent average. */
export async function compareSpendingToAverage(): Promise<{
  currentMonth: number;
  average: number;
  difference: number;
  percentDiff: number;
}> {
  const months = 6;
  const spending: number[] = [];

  for (let i = 0; i < months; i++) {
    const m = yearMonthAgo(i);
    const s = await getMonthSpending(m);
    spending.push(s);
  }

  const current = spending[spending.length - 1] ?? 0;
  const historical = spending.slice(0, -1);
  const avg = historical.length > 0
    ? historical.reduce((a, b) => a + b, 0) / historical.length
    : current;

  return {
    currentMonth: current,
    average: avg,
    difference: current - avg,
    percentDiff: avg > 0 ? (current - avg) / avg : 0,
  };
}

// ─── Projection Engine ───────────────────────────────────────

/**
 * Calculate compound interest for a monthly investment over a number of years.
 */
function futureValue(
  monthlyInvestment: number,
  annualReturn: number,
  years: number,
): number {
  const monthlyRate = annualReturn / 12;
  const months = years * 12;

  if (monthlyRate === 0) {
    return monthlyInvestment * months;
  }

  // Future value of an annuity (monthly contributions)
  return monthlyInvestment * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

/**
 * Calculate required monthly investment to reach a target.
 */
function requiredMonthly(
  targetAmount: number,
  currentPortfolio: number,
  annualReturn: number,
  years: number,
): number {
  const monthlyRate = annualReturn / 12;
  const months = years * 12;

  // Future value of current portfolio
  const currentFv = currentPortfolio * Math.pow(1 + monthlyRate, months);
  const remaining = targetAmount - currentFv;

  if (remaining <= 0) return 0; // Already on track

  if (monthlyRate === 0) {
    return remaining / months;
  }

  // Required monthly payment for remaining amount
  return remaining / ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

/** Build projection scenarios for a goal. */
export async function buildProjectionScenarios(): Promise<GoalProjection | null> {
  // Fetch settings and primary goal
  const [settingsResult, goalResult] = await Promise.all([
    supabase.from('projection_settings').select('*').single(),
    supabase.from('financial_goals').select('*').eq('is_primary', true).single(),
  ]);

  const settings = settingsResult.data as ProjectionSettings | null;
  const goal = goalResult.data as FinancialGoal | null;

  if (!goal) return null;

  const currentAge = settings?.birth_date ? calculateAge(settings.birth_date) : null;
  const targetAge = goal.target_age ?? 45;
  const yearsRemaining = currentAge !== null ? Math.max(0, targetAge - currentAge) : null;
  const currentPortfolio = goal.current_amount ?? 0;
  const monthlyInvestment = settings?.current_monthly_investment ?? 0;

  const scenarios: ProjectionScenario[] = [
    {
      name: 'conservative',
      label: 'Conservative',
      annualReturn: settings?.conservative_return ?? 0.05,
      projectedPortfolio: 0,
      requiredMonthly: 0,
      difference: 0,
      isAhead: false,
      isOnTrack: false,
    },
    {
      name: 'base',
      label: 'Base case',
      annualReturn: settings?.base_return ?? 0.07,
      projectedPortfolio: 0,
      requiredMonthly: 0,
      difference: 0,
      isAhead: false,
      isOnTrack: false,
    },
    {
      name: 'optimistic',
      label: 'Optimistic',
      annualReturn: settings?.optimistic_return ?? 0.10,
      projectedPortfolio: 0,
      requiredMonthly: 0,
      difference: 0,
      isAhead: false,
      isOnTrack: false,
    },
  ];

  for (const scenario of scenarios) {
    if (yearsRemaining !== null && yearsRemaining > 0) {
      const fv = futureValue(monthlyInvestment, scenario.annualReturn, yearsRemaining);
      scenario.projectedPortfolio = currentPortfolio + fv;
      scenario.requiredMonthly = requiredMonthly(
        goal.target_amount,
        currentPortfolio,
        scenario.annualReturn,
        yearsRemaining,
      );
    } else {
      scenario.projectedPortfolio = currentPortfolio;
      scenario.requiredMonthly = monthlyInvestment;
    }

    scenario.difference = goal.target_amount - scenario.projectedPortfolio;
    scenario.isAhead = scenario.projectedPortfolio >= goal.target_amount;
    scenario.isOnTrack =
      !scenario.isAhead &&
      scenario.projectedPortfolio >= goal.target_amount * 0.9;
  }

  return {
    goal,
    scenarios,
    currentAge,
    yearsRemaining,
    monthlyInvestment,
  };
}

// ─── Financial Goals ─────────────────────────────────────────

/** List all financial goals. */
export async function listGoals(): Promise<FinancialGoal[]> {
  const { data, error } = await supabase
    .from('financial_goals')
    .select('*')
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to list goals:', error);
    return [];
  }
  return (data ?? []) as FinancialGoal[];
}

/** Get the primary financial goal. */
export async function getPrimaryGoal(): Promise<FinancialGoal | null> {
  const { data, error } = await supabase
    .from('financial_goals')
    .select('*')
    .eq('is_primary', true)
    .single();

  if (error) return null;
  return data as FinancialGoal;
}

/** Create or update projection settings. */
export async function upsertProjectionSettings(
  updates: Partial<Omit<ProjectionSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>,
): Promise<boolean> {
  const { error } = await supabase
    .from('projection_settings')
    .upsert(updates, { onConflict: 'user_id' });

  if (error) {
    console.error('Failed to upsert projection settings:', error);
    return false;
  }
  return true;
}

// ─── Money Flow ──────────────────────────────────────────────

/** Calculate monthly money flow: income → spending → saving → investing. */
export async function calculateMoneyFlow(
  month?: string,
): Promise<MoneyFlow> {
  const m = month ?? currentYearMonth();
  const [income, spending] = await Promise.all([
    getMonthIncome(m),
    getMonthSpending(m),
  ]);

  const saved = Math.max(0, income - spending);
  // Investing = saved (all savings go to investments in this model)
  const invested = saved;

  return {
    income,
    spending,
    saved,
    invested,
    month: m,
  };
}

// ─── Milestones ──────────────────────────────────────────────

/** Predefined financial milestones. */
export const MILESTONE_AMOUNTS = [
  5_000,
  10_000,
  25_000,
  50_000,
  100_000,
  250_000,
  500_000,
  1_000_000,
  2_000_000,
  3_000_000,
] as const;

export function getMilestoneLabel(amount: number): string {
  if (amount >= 1_000_000) {
    const m = amount / 1_000_000;
    return `£${m}m`;
  }
  if (amount >= 1_000) {
    const k = amount / 1_000;
    return `£${k}k`;
  }
  return `£${amount}`;
}

/** Calculate milestone progress based on net worth snapshots. */
export async function calculateMilestones(): Promise<Milestone[]> {
  const snapshots = await listNetWorthSnapshots(365);

  if (snapshots.length === 0) {
    return MILESTONE_AMOUNTS.map((amount) => ({
      amount,
      label: getMilestoneLabel(amount),
      reached: false,
      reachedDate: null,
    }));
  }

  // Current net worth from latest snapshot
  const latestNetWorth = snapshots[0]?.net_worth ?? 0;

  // Find when each milestone was first reached
  const sorted = [...snapshots].sort(
    (a, b) => a.snapshot_date.localeCompare(b.snapshot_date),
  );

  return MILESTONE_AMOUNTS.map((amount) => {
    const reached = latestNetWorth >= amount;
    const reachedSnapshot = sorted.find((s) => s.net_worth >= amount);
    return {
      amount,
      label: getMilestoneLabel(amount),
      reached,
      reachedDate: reachedSnapshot?.snapshot_date ?? null,
    };
  });
}

/** Find the next milestone not yet reached. */
export function getNextMilestone(milestones: Milestone[]): Milestone | null {
  return milestones.find((m) => !m.reached) ?? null;
}

// ─── Recurring Transactions ──────────────────────────────────

/** List active recurring transactions. */
export async function listRecurringTransactions(): Promise<RecurringTransaction[]> {
  const { data, error } = await supabase
    .from('recurring_transactions')
    .select('*')
    .eq('is_active', true)
    .order('amount', { ascending: false });

  if (error) {
    console.error('Failed to list recurring transactions:', error);
    return [];
  }
  return (data ?? []) as RecurringTransaction[];
}

/** Calculate total monthly recurring spending. */
export async function getMonthlyRecurringTotal(): Promise<number> {
  const recurring = await listRecurringTransactions();
  let total = 0;

  for (const r of recurring) {
    if (r.type !== 'expense') continue;

    switch (r.frequency) {
      case 'weekly':
        total += r.amount * 4.33;
        break;
      case 'biweekly':
        total += r.amount * 2.17;
        break;
      case 'monthly':
        total += r.amount;
        break;
      case 'quarterly':
        total += r.amount / 3;
        break;
      case 'yearly':
        total += r.amount / 12;
        break;
    }
  }

  return total;
}
