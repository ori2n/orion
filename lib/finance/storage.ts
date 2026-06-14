/**
 * Supabase CRUD helpers for accounts + transactions.
 *
 * Follows the same patterns as lib/health/storage.ts:
 * - Every function wrapped in try/catch → NEVER throws
 * - All queries include `.eq('user_id', userId)` for RLS
 * - Returns empty/fallback values on failure
 */
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import type { Account, AccountInsert, Transaction, TransactionInsert } from './types';
import { JISA_CONTRIBUTION_LIMIT, ISA_CONTRIBUTION_LIMIT } from './types';
import { computeAge } from '@/lib/age';

// ─── Safe helpers (same pattern as health/storage) ──────────────────

async function safeQuery<T>(
  fn: () => Promise<T>,
  label: string,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[finance/storage] ${label} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

function unwrapList<T>(result: { data: T[] | null; error: unknown }, label: string): T[] {
  if (result.error) {
    const err = result.error as { message?: string };
    console.warn(`[finance/storage] ${label} query error:`, err.message ?? 'Unknown');
    return [];
  }
  return result.data ?? [];
}

function unwrapSingle<T>(result: { data: T | null; error: unknown }, label: string): T | null {
  if (result.error) {
    const err = result.error as { message?: string };
    console.warn(`[finance/storage] ${label} query error:`, err.message ?? 'Unknown');
    return null;
  }
  return result.data;
}

export interface InsertResult<T> {
  data: T | null;
  error: string | null;
}

async function insertAndSelect<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: any,
  label: string,
): Promise<InsertResult<T>> {
  try {
    const { data, error } = await builder.select().single();
    if (error) {
      const err = error as { message?: string; code?: string };
      const msg = `${err.message ?? 'Unknown error'} (code: ${err.code ?? 'unknown'})`;
      console.warn(`[finance/storage] ${label} insert error:`, msg);
      return { data: null, error: msg };
    }
    return { data: data as T, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[finance/storage] ${label} insert exception:`, msg);
    return { data: null, error: msg };
  }
}

// ─── Age helper (re-exported from shared lib for convenience) ──────

export { computeAge } from '@/lib/age';
/** Get the current UK tax year (April 6 → April 5). Returns the start year. */
export function getTaxYear(): number {
  const now = new Date();
  return now.getMonth() < 3 || (now.getMonth() === 3 && now.getDate() < 6)
    ? now.getFullYear() - 1
    : now.getFullYear();
}

// ─── Accounts ───────────────────────────────────────────────────────

export async function getAccounts(): Promise<Account[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const result = await supabase
      .from('accounts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    return unwrapList(result, 'accounts.getList');
  }, 'accounts.getList', []);
}

export async function getAccount(id: string): Promise<Account | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const result = await supabase
      .from('accounts')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    return unwrapSingle(result, 'accounts.get');
  }, 'accounts.get', null);
}

export async function insertAccount(
  account: AccountInsert,
): Promise<InsertResult<Account>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<Account>(
    supabase.from('accounts').insert({
      ...account,
      user_id: userId,
      contribution_ytd: 0,
      contribution_year: getTaxYear(),
    }),
    'accounts.insert',
  );
}

export async function deleteAccount(id: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.warn('[finance/storage] accounts.delete error:', error.message);
    return false;
  }
  return true;
}

/**
 * Update specific fields on an account (e.g., converting JISA to ISA).
 */
export async function updateAccount(
  id: string,
  updates: Partial<Pick<Account, 'name' | 'interest_rate' | 'is_jisa' | 'balance' | 'contribution_ytd' | 'contribution_year' | 'is_cumulative' | 'max_interest_amount'>>,
): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('accounts')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.warn('[finance/storage] accounts.update error:', error.message);
    return false;
  }
  return true;
}

// ─── Contribution & JISA helpers ────────────────────────────────────

/**
 * Check how much contribution room an ISA/JISA has remaining this year.
 * Returns the remaining allowance, or null if not applicable.
 */
export function getRemainingAllowance(
  account: Account,
): { limit: number; used: number; remaining: number } | null {
  if (account.type !== 'isa') return null;

  const limit = account.is_jisa ? JISA_CONTRIBUTION_LIMIT : ISA_CONTRIBUTION_LIMIT;

  // Reset if we're in a new tax year
  const currentYear = getTaxYear();
  const used = account.contribution_year === currentYear
    ? Number(account.contribution_ytd)
    : 0;

  return { limit, used, remaining: Math.max(0, limit - used) };
}

/**
 * Check if a JISA has auto-converted to ISA (age >= 18).
 * Returns { converted: true, birthDate, age } if conversion should happen.
 */
export function checkJisaConversion(
  account: Account,
): { converted: boolean; age: number | null; birthDate: string | null } {
  if (!account.is_jisa) {
    return { converted: false, age: null, birthDate: null };
  }
  const age = computeAge(account.birth_date);
  if (age != null && age >= 18) {
    return { converted: true, age, birthDate: account.birth_date };
  }
  return { converted: false, age, birthDate: account.birth_date };
}

/**
 * Actually convert a JISA to a regular ISA in the database.
 * Call this after confirming age >= 18.
 */
export async function convertJisaToIsa(accountId: string): Promise<boolean> {
  return updateAccount(accountId, {
    is_jisa: false,
  });
}

// ─── Balance adjustment (with constraint checks) ────────────────────

export interface BalanceAdjustmentResult {
  success: boolean;
  error?: string;
}

/**
 * Adjust an account's balance by a delta (+/-), respecting JISA/ISA rules.
 *
 * - JISAs cannot have withdrawals (negative deltas that aren't transfers to other JISAs)
 * - ISAs/JISAs have annual contribution limits (positive deltas)
 * - Contribution YTD is tracked and reset per tax year
 */
export async function adjustAccountBalance(
  accountId: string,
  delta: number,
  transactionType?: 'income' | 'expense' | 'transfer',
): Promise<BalanceAdjustmentResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { success: false, error: 'Not authenticated' };

  // Fetch current account state
  const { data: account, error: fetchError } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle();

  if (fetchError || !account) {
    console.warn('[finance/storage] adjustAccountBalance fetch error:', fetchError?.message ?? 'No account found');
    return { success: false, error: 'Account not found' };
  }

  const currentBalance = Number(account.balance);
  const newBalance = currentBalance + delta;

  // ── JISA withdrawal check ──
  // JISAs cannot have withdrawals (negative delta from expenses or transfers out)
  if (account.is_jisa && delta < 0) {
    // Allow transfers between JISAs — check if target is also a JISA
    if (transactionType === 'transfer') {
      return { success: false, error: 'Withdrawals not allowed from a Junior ISA (JISA)' };
    }
    if (transactionType === 'expense') {
      return { success: false, error: 'Withdrawals not allowed from a Junior ISA (JISA)' };
    }
    return { success: false, error: 'No withdrawals allowed from a Junior ISA (JISA)' };
  }

  // ── Contribution limit check (only for ISAs/JISAs) ──
  // Skip for transfers between accounts (transfers don't use annual allowance)
  if (account.type === 'isa' && delta > 0 && transactionType !== 'transfer') {
    const currentYear = getTaxYear();
    let currentYtd = account.contribution_year === currentYear
      ? Number(account.contribution_ytd)
      : 0;

    const limit = account.is_jisa ? JISA_CONTRIBUTION_LIMIT : ISA_CONTRIBUTION_LIMIT;
    const newYtd = currentYtd + delta;

    if (newYtd > limit) {
      const remaining = Math.max(0, limit - currentYtd);
      return {
        success: false,
        error: `Contribution would exceed annual ${account.is_jisa ? 'JISA' : 'ISA'} limit of £${limit.toLocaleString('en-GB')}. Remaining allowance: £${remaining.toFixed(2)}`,
      };
    }

    // Update balance + contribution YTD atomically
    const { error: updateError } = await supabase
      .from('accounts')
      .update({
        balance: newBalance,
        contribution_ytd: newYtd,
        contribution_year: currentYear,
        updated_at: new Date().toISOString(),
      })
      .eq('id', accountId)
      .eq('user_id', userId);

    if (updateError) {
      console.warn('[finance/storage] adjustAccountBalance update error:', updateError.message);
      return { success: false, error: updateError.message };
    }
    return { success: true };
  }

  // ── Non-ISA or negative delta: just update balance ──
  const { error: updateError } = await supabase
    .from('accounts')
    .update({
      balance: newBalance,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .eq('user_id', userId);

  if (updateError) {
    console.warn('[finance/storage] adjustAccountBalance update error:', updateError.message);
    return { success: false, error: updateError.message };
  }
  return { success: true };
}

// ─── Transactions ───────────────────────────────────────────────────

export async function getTransactions(
  accountId?: string,
  months = 3,
): Promise<Transaction[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    let query = supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .gte('date', since.toISOString().slice(0, 10))
      .order('date', { ascending: false });
    if (accountId) {
      query = query.eq('account_id', accountId);
    }
    const result = await query;
    return unwrapList(result, 'transactions.getList');
  }, 'transactions.getList', []);
}

export async function getAllTransactions(months = 12): Promise<Transaction[]> {
  return getTransactions(undefined, months);
}

export async function insertTransaction(
  tx: TransactionInsert,
): Promise<InsertResult<Transaction>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<Transaction>(
    supabase.from('transactions').insert({ ...tx, user_id: userId }),
    'transactions.insert',
  );
}

export async function deleteTransaction(id: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.warn('[finance/storage] transactions.delete error:', error.message);
    return false;
  }
  return true;
}

// ─── Future Transactions ────────────────────────────────────────────

export interface FutureTransactionRow {
  id: string;
  user_id: string;
  account_id: string;
  age: number;
  description: string;
  amount: number;
  to_account_id: string | null;
  transfer_mode: 'fixed' | 'percent' | 'above_threshold' | null;
  transfer_value: number | null;
  created_at: string;
}

export async function getFutureTransactions(): Promise<FutureTransactionRow[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const result = await supabase
      .from('future_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('age', { ascending: true });
    return unwrapList(result, 'future_transactions.getList');
  }, 'future_transactions.getList', []);
}

export async function insertFutureTransaction(
  data: Omit<FutureTransactionRow, 'id' | 'user_id' | 'created_at'>,
): Promise<InsertResult<FutureTransactionRow>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: 'Not authenticated' };
  return insertAndSelect<FutureTransactionRow>(
    supabase.from('future_transactions').insert({ ...data, user_id: userId }),
    'future_transactions.insert',
  );
}

export async function deleteFutureTransaction(id: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('future_transactions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.warn('[finance/storage] future_transactions.delete error:', error.message);
    return false;
  }
  return true;
}
