/**
 * Finance module types — mirrors the Supabase schema for accounts + transactions.
 */

/** Account types — ISA/JISA merged into single 'isa' with is_jisa flag */
export type AccountType = 'savings' | 'cash' | 'investment' | 'isa';

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  balance: number;
  interest_rate: number | null;
  /** If true, this is a Junior ISA (JISA) — auto-converts to regular ISA at 18 */
  is_jisa: boolean;
  /** Date of birth of the child (for JISA age calculation) */
  birth_date: string | null;
  /** Year-to-date contributions (resets each tax year) */
  contribution_ytd: number;
  /** The year (integer) that contribution_ytd applies to */
  contribution_year: number | null;
  /** If true, interest compounds on the full balance; if false, interest is capped at max_interest_amount */
  is_cumulative: boolean;
  /** When is_cumulative is false, interest is only applied to this amount (interest earned still credits the account) */
  max_interest_amount: number | null;
  created_at: string;
  updated_at: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  type: TransactionType;
  amount: number;
  category: string;
  description: string | null;
  date: string;
  transfer_to_account_id: string | null;
  created_at: string;
}

/** Insert payload for a new account (no id, no user_id, no timestamps). */
export interface AccountInsert {
  name: string;
  type: AccountType;
  balance?: number;
  interest_rate?: number | null;
  is_jisa?: boolean;
  birth_date?: string | null;
  is_cumulative?: boolean;
  max_interest_amount?: number | null;
}

/** Insert payload for a new transaction. */
export interface TransactionInsert {
  account_id: string;
  type: TransactionType;
  amount: number;
  category: string;
  description?: string | null;
  date?: string;
  transfer_to_account_id?: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────

/** Annual contribution limit for JISAs (£9,000) */
export const JISA_CONTRIBUTION_LIMIT = 9_000;
/** Annual contribution limit for regular ISAs (£20,000) */
export const ISA_CONTRIBUTION_LIMIT = 20_000;
