/**
 * Shared TypeScript types for the ORION Finance module.
 *
 * Mirrors the Supabase schema in supabase-finance-v2-migration.sql.
 * All types use camelCase for consistency with the rest of the codebase.
 */

// ─── Accounts ────────────────────────────────────────────────

export type AccountType = 'savings' | 'cash' | 'investment' | 'isa';

export interface FinancialAccount {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  balance: number;
  interest_rate: number | null;
  is_jisa: boolean;
  birth_date: string | null;
  contribution_ytd: number;
  contribution_year: number | null;
  currency: string;
  institution: string | null;
  account_number_last4: string | null;
  notes: string | null;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ─── Transactions ────────────────────────────────────────────

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  type: TransactionType;
  amount: number;
  category: string;
  category_id: string | null;
  description: string | null;
  date: string;
  transfer_to_account_id: string | null;
  description_hash: string | null;
  import_batch_id: string | null;
  notes: string | null;
  is_recurring: boolean;
  recurring_id: string | null;
  created_at: string;
}

// ─── Categories ──────────────────────────────────────────────

export interface TransactionCategory {
  id: string;
  user_id: string;
  name: string;
  icon: string | null;
  color: string | null;
  is_system: boolean;
  sort_order: number;
  created_at: string;
}

// ─── Category Rules ──────────────────────────────────────────

export type MatchType = 'contains' | 'starts_with' | 'ends_with' | 'exact' | 'regex';

export interface CategoryRule {
  id: string;
  user_id: string;
  category_id: string;
  pattern: string;
  match_type: MatchType;
  priority: number;
  created_at: string;
}

// ─── Recurring Transactions ──────────────────────────────────

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface RecurringTransaction {
  id: string;
  user_id: string;
  description: string;
  amount: number;
  type: TransactionType;
  category_id: string | null;
  frequency: RecurrenceFrequency;
  account_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  occurrence_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Import Batches ──────────────────────────────────────────

export interface ImportBatch {
  id: string;
  user_id: string;
  filename: string;
  account_id: string | null;
  row_count: number;
  imported_count: number;
  skipped_duplicates: number;
  column_mapping: Record<string, string> | null;
  imported_at: string;
}

// ─── Investment Holdings ─────────────────────────────────────

export interface InvestmentHolding {
  id: string;
  user_id: string;
  account_id: string;
  ticker: string;
  name: string;
  units: number;
  average_cost: number | null;
  total_contributed: number;
  created_at: string;
  updated_at: string;
}

// ─── Investment Snapshots ────────────────────────────────────

export interface InvestmentSnapshot {
  id: string;
  user_id: string;
  account_id: string;
  holding_id: string | null;
  snapshot_date: string;
  units: number | null;
  price_per_unit: number | null;
  total_value: number;
  daily_change: number | null;
  created_at: string;
}

// ─── Net Worth Snapshots ─────────────────────────────────────

export interface NetWorthSnapshot {
  id: string;
  user_id: string;
  snapshot_date: string;
  total_cash: number;
  total_investments: number;
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  created_at: string;
}

// ─── Financial Goals ─────────────────────────────────────────

export type GoalType = 'portfolio' | 'savings' | 'investment' | 'net_worth' | 'custom';

export interface FinancialGoal {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  target_age: number | null;
  current_amount: number;
  goal_type: GoalType;
  is_primary: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Projection Settings ─────────────────────────────────────

export interface ProjectionSettings {
  id: string;
  user_id: string;
  birth_date: string | null;
  current_monthly_investment: number;
  conservative_return: number;
  base_return: number;
  optimistic_return: number;
  created_at: string;
  updated_at: string;
}

// ─── Computed / Derived Types ────────────────────────────────

export interface DashboardMetrics {
  totalNetWorth: number;
  totalCash: number;
  totalInvestments: number;
  spendingThisMonth: number;
  savingThisMonth: number;
  investingThisMonth: number;
  investmentPortfolioValue: number;
}

export interface SpendingByCategory {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  total: number;
  count: number;
  percentage: number;
}

export interface MonthlySpending {
  month: string; // YYYY-MM
  total: number;
  byCategory: SpendingByCategory[];
}

export interface ProjectionScenario {
  name: 'conservative' | 'base' | 'optimistic';
  label: string;
  annualReturn: number;
  projectedPortfolio: number;
  requiredMonthly: number;
  difference: number;
  isAhead: boolean;
  isOnTrack: boolean;
}

export interface GoalProjection {
  goal: FinancialGoal;
  scenarios: ProjectionScenario[];
  currentAge: number | null;
  yearsRemaining: number | null;
  monthlyInvestment: number;
}

export interface FinancialInsight {
  id: string;
  type: 'spending' | 'saving' | 'investing' | 'milestone' | 'trend' | 'suggestion';
  title: string;
  body: string;
  value: number | null;
  icon: string;
  priority: number;
}

export interface Milestone {
  amount: number;
  label: string;
  reached: boolean;
  reachedDate: string | null;
}

export interface MoneyFlow {
  income: number;
  spending: number;
  saved: number;
  invested: number;
  month: string;
}

// ─── CSV Import Types ────────────────────────────────────────

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  categoryId: string | null;
  descriptionHash: string;
  raw: Record<string, string>;
}

export interface CsvColumnMapping {
  date: string;
  description: string;
  amount: string;
  type?: string;
}

export interface CsvImportConfig {
  delimiter: string;
  hasHeader: boolean;
  dateFormat: string;
  amountSign: 'positive_is_credit' | 'signed';
  columns: CsvColumnMapping;
}
