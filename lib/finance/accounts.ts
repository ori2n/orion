/**
 * Account management for the ORION Finance module.
 *
 * Handles:
 * - Listing / creating / updating financial accounts
 * - Balance history tracking
 * - JISA detection and special handling
 */
import { supabase } from '@/lib/supabase';
import type { FinancialAccount, AccountType } from './types';

// ─── Fetch accounts ──────────────────────────────────────────

/** List all non-archived accounts for the current user. */
export async function listAccounts(): Promise<FinancialAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to list accounts:', error);
    return [];
  }
  return (data ?? []) as FinancialAccount[];
}

/** Get a single account by ID. */
export async function getAccount(id: string): Promise<FinancialAccount | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Failed to get account:', error);
    return null;
  }
  return data as FinancialAccount;
}

/** Get the user's JISA account (if any). */
export async function getJisaAccount(): Promise<FinancialAccount | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('is_jisa', true)
    .eq('is_archived', false)
    .single();

  if (error) return null;
  return data as FinancialAccount;
}

/** Get all savings accounts (non-investment, non-archived). */
export async function getSavingsAccounts(): Promise<FinancialAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .in('type', ['savings', 'cash'])
    .eq('is_archived', false)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to list savings accounts:', error);
    return [];
  }
  return (data ?? []) as FinancialAccount[];
}

/** Get all investment accounts (including JISA). */
export async function getInvestmentAccounts(): Promise<FinancialAccount[]> {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .in('type', ['investment', 'isa'])
    .eq('is_archived', false)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to list investment accounts:', error);
    return [];
  }
  return (data ?? []) as FinancialAccount[];
}

// ─── Create / Update accounts ────────────────────────────────

/** Create a new financial account. */
export async function createAccount(
  name: string,
  type: AccountType,
  opts?: {
    balance?: number;
    interestRate?: number;
    isJisa?: boolean;
    institution?: string;
    notes?: string;
  },
): Promise<FinancialAccount | null> {
  const { data, error } = await supabase
    .from('accounts')
    .insert({
      name,
      type,
      balance: opts?.balance ?? 0,
      interest_rate: opts?.interestRate ?? null,
      is_jisa: opts?.isJisa ?? false,
      institution: opts?.institution ?? null,
      notes: opts?.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create account:', error);
    return null;
  }
  return data as FinancialAccount;
}

/** Update an account's details. */
export async function updateAccount(
  id: string,
  updates: Partial<Pick<
    FinancialAccount,
    | 'name'
    | 'type'
    | 'balance'
    | 'interest_rate'
    | 'institution'
    | 'notes'
    | 'is_archived'
    | 'sort_order'
    | 'birth_date'
    | 'is_jisa'
  >>,
): Promise<boolean> {
  const { error } = await supabase
    .from('accounts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    console.error('Failed to update account:', error);
    return false;
  }
  return true;
}

/** Update an account's balance. */
export async function updateBalance(
  id: string,
  newBalance: number,
): Promise<boolean> {
  return updateAccount(id, { balance: newBalance });
}

// ─── Aggregate helpers ───────────────────────────────────────

/** Get total cash across all savings/cash accounts. */
export async function getTotalCash(): Promise<number> {
  const accounts = await getSavingsAccounts();
  return accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
}

/** Get total investments across all investment/ISA accounts. */
export async function getTotalInvestments(): Promise<number> {
  const accounts = await getInvestmentAccounts();
  return accounts.reduce((sum, a) => sum + (a.balance ?? 0), 0);
}

/** Get total net worth (cash + investments). */
export async function getTotalNetWorth(): Promise<number> {
  const [cash, investments] = await Promise.all([
    getTotalCash(),
    getTotalInvestments(),
  ]);
  return cash + investments;
}
