/**
 * Wealth projection engine — purely deterministic, no side effects.
 *
 * Projects account growth using per-account interest rates, per-age
 * salary allocations, and future scheduled events.
 *
 * All values in GBP.
 */

import type { Account } from './types';
import { ISA_CONTRIBUTION_LIMIT } from './types';
import { calculateUKTakeHomePay } from './uk-tax';

// ─── Types ──────────────────────────────────────────────────────────

export type TransferMode = 'fixed' | 'percent' | 'above_threshold';

export interface FutureTransaction {
  /** Unique identifier */
  id: string;
  /** The account this transaction/transfer applies to (source for transfers) */
  accountId: string;
  /** Age at which this occurs */
  age: number;
  /** Description / label */
  description: string;
  /** For income/expense: positive = income, negative = expense. Ignored for transfers. */
  amount: number;
  /** If set, this is a transfer from accountId → toAccountId */
  toAccountId?: string;
  /** Transfer calculation mode */
  transferMode?: TransferMode;
  /**
   * Transfer parameter:
   * - 'fixed': the exact amount to transfer
   * - 'percent': percentage of source balance to transfer (0-100)
   * - 'above_threshold': transfer everything above this amount
   */
  transferValue?: number;
}

export interface SalaryBand {
  label: string;
  minAge: number;
  maxAge: number;
  baseMin: number;
  baseMax: number;
}

/** Per-age salary allocation — splits post-tax salary between virtual ISA, Savings, and General Investments. */
export interface SalaryAllocationByAge {
  age: number;
  /** Percentage of post-tax salary to ISA (0–100, capped at £20K/yr) */
  isaPct: number;
  /** Percentage to Savings (0–100) */
  savingsPct: number;
  /** Percentage to General Investments (0–100) */
  generalInvestmentsPct: number;
  /** Optional manual gross salary override (before tax). If set, this gross is used instead of the career band calculation. */
  salaryOverride?: number;
}

export interface ProjectionInputs {
  /** Current age of the user */
  currentAge: number;
  /** Target age (default 45) */
  targetAge: number;
  /** Current total net worth */
  currentNetWorth: number;
  /** Individual accounts for per-account projection (respects is_cumulative & max_interest_amount) */
  accounts: Account[];
  /** Future scheduled transactions that only affect the projection (not current balance) */
  futureTransactions: FutureTransaction[];
  /** How post-tax salary is allocated across accounts each year (per-age overrides) */
  salaryAllocationsByAge: SalaryAllocationByAge[];
  /** Annual expenses deducted from portfolio each year (e.g. living costs in retirement) */
  yearlyExpenses: number;
}

export interface YearProjection {
  age: number;
  year: number;
  netWorth: number; // nominal
  netWorthAdjusted: number; // inflation-adjusted to today's money
}

export interface ProjectionResult {
  years: YearProjection[];
  finalNominal: number;
  finalAdjusted: number;
  targetMet: boolean;
  milestones: { amount: number; age: number | null }[];
}

// ─── Salary bands (reference only — not used in projection) ────────

export const SALARY_BANDS: SalaryBand[] = [
  { label: 'Analyst',      minAge: 22, maxAge: 25, baseMin: 60_000,  baseMax: 90_000 },
  { label: 'Associate',    minAge: 25, maxAge: 28, baseMin: 90_000,  baseMax: 140_000 },
  { label: 'VP',           minAge: 28, maxAge: 35, baseMin: 140_000, baseMax: 250_000 },
  { label: 'Director/MD',  minAge: 35, maxAge: 45, baseMin: 200_000, baseMax: 500_000 },
];

const MILESTONES = [100_000, 250_000, 500_000, 1_000_000, 5_000_000];

// ─── Blended return rate from actual accounts ─────────────────────

/**
 * Compute a weighted-average return rate from the user's accounts.
 * Each account's balance × its interest_rate, divided by total balance.
 * Falls back to 7% if no accounts have rates set.
 *
 * For non-cumulative accounts, the effective return is reduced because
 * interest is earned on a capped amount rather than the full balance.
 */
export function computeBlendedReturnRate(accounts: Account[]): number {
  const withRate = accounts.filter(
    (a) => a.interest_rate != null && Number(a.balance) > 0,
  );
  if (withRate.length === 0) return 7;

  let totalInterestYield = 0;
  let totalBalance = 0;

  for (const a of withRate) {
    const rate = Number(a.interest_rate!);
    const balance = Number(a.balance);
    // For non-cumulative accounts, the effective interest is rate * capped amount
    // For cumulative accounts, it's rate * full balance
    const effectiveYield = a.is_cumulative
      ? balance * rate
      : Math.min(balance, a.max_interest_amount ?? balance) * rate;
    totalInterestYield += effectiveYield;
    totalBalance += balance;
  }

  if (totalBalance <= 0) return 7;
  return Math.round((totalInterestYield / totalBalance) * 10) / 10;
}

// ─── Main projection (account growth + salary contributions) ──────

/**
 * Get the post-tax annual salary for a given age based on career stage.
 * Uses the lower band value as base salary + 50% bonus.
 */
function getPostTaxSalaryForAge(age: number): number {
  const band = SALARY_BANDS.find((b) => age >= b.minAge && age < b.maxAge);
  if (!band) return 0;
  const base = band.baseMin;
  const gross = base + Math.round(base * 0.5);
  return calculateUKTakeHomePay(gross).netAnnual;
}

/**
 * Project net worth growth using per-account projections with
 * salary contributions and interest.
 *
 * Each year:
 *   1. Interest is applied to all accounts
 *   2. Post-tax salary for the current career stage is distributed
 *      across accounts based on salaryAllocations
 *   3. Any future events (transactions/transfers) are applied
 */
/**
 * Compute the effective transfer amount given a mode and source balance.
 */
export function computeTransferAmount(
  sourceBalance: number,
  mode: TransferMode,
  value: number,
): number {
  switch (mode) {
    case 'fixed':
      return Math.min(Math.max(0, value), sourceBalance);
    case 'percent':
      return sourceBalance * Math.min(Math.max(0, value), 100) / 100;
    case 'above_threshold':
      return Math.max(0, sourceBalance - Math.max(0, value));
  }
}

export function computeProjection(inputs: ProjectionInputs): ProjectionResult {
  const {
    currentAge,
    targetAge,
    currentNetWorth,
    accounts,
    futureTransactions,
    salaryAllocationsByAge,
  } = inputs;

  const inf = 0.025; // hardcoded 2.5% inflation

  const years: YearProjection[] = [];

  // Build a map for quick index lookup by account id
  const accountIndexMap = new Map<string, number>();

  // Build caches for per-age salary allocation and salary override
  const isaPctCache = new Map<number, number>();
  const savingsPctCache = new Map<number, number>();
  const generalPctCache = new Map<number, number>();
  const salaryOverrideCache = new Map<number, number>();
  
  // Default: 33% ISA, 33% Savings, 34% General
  const defaultIsaPct = 33;
  const defaultSavingsPct = 33;
  const defaultGeneralPct = 34;
  
  for (const entry of salaryAllocationsByAge) {
    isaPctCache.set(entry.age, entry.isaPct);
    savingsPctCache.set(entry.age, entry.savingsPct);
    generalPctCache.set(entry.age, entry.generalInvestmentsPct);
    if (entry.salaryOverride != null) {
      salaryOverrideCache.set(entry.age, entry.salaryOverride);
    }
  }

  function getIsaPctForAge(age: number): number {
    return isaPctCache.get(age) ?? defaultIsaPct;
  }
  function getSavingsPctForAge(age: number): number {
    return savingsPctCache.get(age) ?? defaultSavingsPct;
  }
  function getGeneralPctForAge(age: number): number {
    return generalPctCache.get(age) ?? defaultGeneralPct;
  }

  // Initialise per-account balances
  const accountBalances = accounts.map((a, idx) => {
    accountIndexMap.set(a.id, idx);
    return {
      id: a.id,
      balance: Number(a.balance),
      rate: a.interest_rate != null ? Number(a.interest_rate) / 100 : 0.07,
      isCumulative: a.is_cumulative,
      maxAmount: a.max_interest_amount != null ? Number(a.max_interest_amount) : null,
      isISA: a.type === 'isa',
    };
  });

  // Virtual balances for ISA, Savings, and General Investments
  let virtualIsaBalance = 0;
  let virtualSavingsBalance = 0;
  let virtualGeneralBalance = 0;

  // Collect all future events (both income/expense and transfers) indexed by age
  const eventsByAge = new Map<number, FutureTransaction[]>();
  for (const ft of futureTransactions) {
    const list = eventsByAge.get(ft.age) ?? [];
    list.push(ft);
    eventsByAge.set(ft.age, list);
  }

  for (let age = currentAge; age < targetAge; age++) {
    const yearNum = age - currentAge + 1;

    // 1. Apply interest to all accounts (real + virtual)
    for (const acct of accountBalances) {
      let interest: number;

      if (acct.isCumulative) {
        interest = acct.balance * acct.rate;
      } else {
        const cappedAmount = acct.maxAmount != null
          ? Math.min(acct.balance, acct.maxAmount)
          : acct.balance;
        interest = cappedAmount * acct.rate;
      }

      acct.balance = acct.balance + interest;
    }

    // Apply interest to virtual accounts
    // ISA: 4%, Savings: 4.5%, General Investments: 7%
    virtualIsaBalance += virtualIsaBalance * 0.04;
    virtualSavingsBalance += virtualSavingsBalance * 0.045;
    virtualGeneralBalance += virtualGeneralBalance * 0.07;

    // 2. Apply salary contribution for this age (post-tax, split between virtual ISA, Savings, and General Investments)
    const salaryOverride = salaryOverrideCache.get(age);
    const postTaxSalary = salaryOverride != null
      ? calculateUKTakeHomePay(salaryOverride).netAnnual
      : getPostTaxSalaryForAge(age);
    if (postTaxSalary > 0) {
      const isaPct = getIsaPctForAge(age);
      const savingsPct = getSavingsPctForAge(age);
      const generalPct = getGeneralPctForAge(age);
      
      // ISA contribution, capped at £20K/yr
      const isaContribution = Math.min(postTaxSalary * (isaPct / 100), ISA_CONTRIBUTION_LIMIT);
      virtualIsaBalance += isaContribution;
      
      // Savings contribution
      const savingsContribution = postTaxSalary * (savingsPct / 100);
      virtualSavingsBalance += savingsContribution;
      
      // General Investments contribution
      const generalContribution = postTaxSalary * (generalPct / 100);
      virtualGeneralBalance += generalContribution;
    }

    // 3. Apply events (transactions + transfers) at this age
    const events = eventsByAge.get(age);
    if (events) {
      for (const ft of events) {
        if (ft.toAccountId && ft.transferMode != null && ft.transferValue != null) {
          // ── Transfer between accounts ──
          const sourceIdx = accountIndexMap.get(ft.accountId);
          const targetIdx = accountIndexMap.get(ft.toAccountId);
          if (
            sourceIdx == null || targetIdx == null ||
            sourceIdx === targetIdx
          ) continue;

          const sourceBalance = accountBalances[sourceIdx].balance;
          const transferAmount = computeTransferAmount(
            sourceBalance,
            ft.transferMode as TransferMode,
            ft.transferValue,
          );

          if (transferAmount > 0) {
            accountBalances[sourceIdx].balance -= transferAmount;
            accountBalances[targetIdx].balance += transferAmount;
          }
        } else {
          // ── Regular income/expense ──
          const targetIdx = accountIndexMap.get(ft.accountId);
          if (targetIdx != null) {
            accountBalances[targetIdx].balance += ft.amount;
          }
        }
      }
    }

    let totalNetWorth = 0;
    for (const acct of accountBalances) {
      totalNetWorth += acct.balance;
    }
    totalNetWorth += Math.round(virtualIsaBalance);
    totalNetWorth += Math.round(virtualSavingsBalance);
    totalNetWorth += Math.round(virtualGeneralBalance);

    // Deduct yearly expenses from total portfolio
    const yearlyExpenses = inputs.yearlyExpenses ?? 0;
    if (yearlyExpenses > 0) {
      totalNetWorth -= yearlyExpenses;
    }

    const netWorthAdjusted = totalNetWorth / Math.pow(1 + inf, yearNum);

    years.push({
      age,
      year: new Date().getFullYear() + yearNum - 1,
      netWorth: Math.round(totalNetWorth),
      netWorthAdjusted: Math.round(netWorthAdjusted),
    });
  }

  const last = years[years.length - 1];
  const fallback = currentNetWorth || currentTotalBalance(accounts);
  const finalNominal = last?.netWorth ?? years[0]?.netWorth ?? fallback;
  const finalAdjusted = last?.netWorthAdjusted ?? years[0]?.netWorthAdjusted ?? fallback;

  // Milestone tracking
  const milestones = MILESTONES.map((amount) => {
    const hit = years.find((y) => y.netWorth >= amount);
    return { amount, age: hit?.age ?? null };
  });

  return {
    years,
    finalNominal,
    finalAdjusted,
    targetMet: finalNominal >= 5_000_000,
    milestones,
  };
}

function currentTotalBalance(accounts: Account[]): number {
  return accounts.reduce((s, a) => s + Number(a.balance), 0);
}
