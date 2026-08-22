/**
 * Transaction management for the ORION Finance module.
 *
 * Handles:
 * - Listing / creating / updating transactions
 * - CSV import with bank-agnostic column mapping
 * - Duplicate detection via description hashing
 * - Monthly spending summaries
 */
import { supabase } from '@/lib/supabase';
import type {
  Transaction,
  TransactionType,
  ParsedTransaction,
  CsvImportConfig,
  ImportBatch,
} from './types';
import { listCategories, autoCategorise, matchCategory, listCategoryRules } from './categories';
import { currentYearMonth, yearMonthAgo } from './format';

// ─── Description hashing ─────────────────────────────────────

/** Create a hash for duplicate detection from date + description + amount. */
function hashDescription(date: string, description: string, amount: number): string {
  const raw = `${date}|${description.trim().toLowerCase()}|${amount.toFixed(2)}`;
  // Simple DJB2 hash — fast, non-crypto, good enough for dedup
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

// ─── Fetch transactions ──────────────────────────────────────

/** List transactions for a given month (YYYY-MM). */
export async function listTransactionsMonth(
  month: string,
): Promise<Transaction[]> {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endMon = mon === 12 ? 1 : mon + 1;
  const endYear = mon === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMon).padStart(2, '0')}-01`;

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .gte('date', start)
    .lt('date', end)
    .order('date', { ascending: false });

  if (error) {
    console.error('Failed to list transactions:', error);
    return [];
  }
  return (data ?? []) as Transaction[];
}

/** List recent transactions (last N). */
export async function listRecentTransactions(limit = 20): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to list recent transactions:', error);
    return [];
  }
  return (data ?? []) as Transaction[];
}

// ─── Create transactions ─────────────────────────────────────

/** Add a single transaction. */
export async function addTransaction(
  accountId: string,
  type: TransactionType,
  amount: number,
  category: string,
  date: string,
  opts?: {
    description?: string;
    categoryId?: string;
    notes?: string;
  },
): Promise<Transaction | null> {
  const description = opts?.description ?? '';
  const descriptionHash = hashDescription(date, description, amount);

  // Check for duplicates
  const { data: existing } = await supabase
    .from('transactions')
    .select('id')
    .eq('description_hash', descriptionHash)
    .limit(1);

  if (existing && existing.length > 0) {
    console.warn('Duplicate transaction detected, skipping');
    return null;
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert({
      account_id: accountId,
      type,
      amount,
      category,
      category_id: opts?.categoryId ?? null,
      description,
      date,
      description_hash: descriptionHash,
      notes: opts?.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to add transaction:', error);
    return null;
  }
  return data as Transaction;
}

// ─── CSV Import ──────────────────────────────────────────────

/** Default CSV config for common UK bank formats. */
export const DEFAULT_CSV_CONFIG: CsvImportConfig = {
  delimiter: ',',
  hasHeader: true,
  dateFormat: 'DD/MM/YYYY',
  amountSign: 'signed',
  columns: {
    date: 'Date',
    description: 'Description',
    amount: 'Amount',
  },
};

/**
 * Parse a CSV string into raw rows using a config.
 */
export function parseCsv(
  csvText: string,
  config: CsvImportConfig = DEFAULT_CSV_CONFIG,
): Array<Record<string, string>> {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const rows: Array<Record<string, string>> = [];
  const startIndex = config.hasHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const values = splitCsvLine(lines[i], config.delimiter);
    if (config.hasHeader) {
      const headers = splitCsvLine(lines[0], config.delimiter);
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j].trim()] = (values[j] ?? '').trim();
      }
      rows.push(row);
    } else {
      const row: Record<string, string> = {};
      for (let j = 0; j < values.length; j++) {
        row[`col${j}`] = values[j].trim();
      }
      rows.push(row);
    }
  }
  return rows;
}

/** Split a CSV line respecting quoted fields. */
function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/** Parse a date string from various formats. */
function parseDate(dateStr: string, format: string): string {
  const clean = dateStr.trim().replace(/['"]/g, '');

  // Try DD/MM/YYYY or DD-MM-YYYY
  if (format === 'DD/MM/YYYY' || format === 'DD-MM-YYYY') {
    const parts = clean.split(/[\/\-]/);
    if (parts.length === 3) {
      const [d, m, y] = parts;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  // Try YYYY-MM-DD
  if (format === 'YYYY-MM-DD') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  }

  // Try DD Mon YYYY (e.g., "16 May 2025")
  const monMatch = clean.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (monMatch) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const [, d, mon, y] = monMatch;
    const m = months[mon.toLowerCase()];
    if (m) return `${y}-${m}-${d.padStart(2, '0')}`;
  }

  // Fallback: try Date constructor
  const d = new Date(clean);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }

  return clean; // Return as-is if unparseable
}

/** Parse amount string, handling currency symbols and negative values. */
function parseAmount(amountStr: string): number {
  const clean = amountStr
    .replace(/[£$€,]/g, '')
    .replace(/\s/g, '')
    .trim();
  const num = parseFloat(clean);
  return Number.isNaN(num) ? 0 : num;
}

/**
 * Parse CSV rows into ParsedTransaction objects.
 */
export async function parseTransactions(
  rows: Array<Record<string, string>>,
  config: CsvImportConfig = DEFAULT_CSV_CONFIG,
): Promise<ParsedTransaction[]> {
  const categories = await listCategories();
  const rules = await listCategoryRules();

  const nameToId = new Map<string, string>();
  for (const cat of categories) {
    nameToId.set(cat.name.toLowerCase(), cat.id);
  }

  return rows.map((row) => {
    const dateStr = row[config.columns.date] ?? '';
    const description = row[config.columns.description] ?? '';
    const rawAmount = parseAmount(row[config.columns.amount] ?? '0');
    const date = parseDate(dateStr, config.dateFormat);

    // Determine type based on amount sign
    let type: TransactionType;
    let amount: number;
    if (config.amountSign === 'signed') {
      if (rawAmount >= 0) {
        type = 'income';
        amount = rawAmount;
      } else {
        type = 'expense';
        amount = Math.abs(rawAmount);
      }
    } else {
      // positive_is_credit: positive = income, negative = expense
      if (rawAmount >= 0) {
        type = 'income';
        amount = rawAmount;
      } else {
        type = 'expense';
        amount = Math.abs(rawAmount);
      }
    }

    // Auto-categorise
    const categoryId = matchCategory(description, rules);
    let category = 'Other';
    if (categoryId) {
      const cat = categories.find((c) => c.id === categoryId);
      if (cat) category = cat.name;
    }

    const descriptionHash = hashDescription(date, description, amount);

    return {
      date,
      description,
      amount,
      type,
      category,
      categoryId,
      descriptionHash,
      raw: row,
    };
  });
}

// ─── Import batch ────────────────────────────────────────────

/**
 * Import parsed transactions into the database.
 * Returns stats about the import.
 */
export async function importTransactions(
  transactions: ParsedTransaction[],
  accountId: string,
  filename: string,
): Promise<ImportBatch | null> {
  // Get existing hashes to check duplicates
  const hashes = transactions.map((t) => t.descriptionHash);
  const { data: existing } = await supabase
    .from('transactions')
    .select('description_hash')
    .in('description_hash', hashes);

  const existingHashes = new Set(
    (existing ?? []).map((r: { description_hash: string }) => r.description_hash),
  );

  const unique = transactions.filter((t) => !existingHashes.has(t.descriptionHash));
  const skipped = transactions.length - unique.length;

  if (unique.length === 0) {
    // All duplicates — create a batch record but insert nothing
    const { data: batch } = await supabase
      .from('import_batches')
      .insert({
        filename,
        account_id: accountId,
        row_count: transactions.length,
        imported_count: 0,
        skipped_duplicates: skipped,
        column_mapping: null,
      })
      .select()
      .single();
    return batch as ImportBatch;
  }

  // Insert unique transactions
  const rows = unique.map((t) => ({
    account_id: accountId,
    type: t.type,
    amount: t.amount,
    category: t.category,
    category_id: t.categoryId,
    description: t.description,
    date: t.date,
    description_hash: t.descriptionHash,
  }));

  const { data: inserted, error } = await supabase
    .from('transactions')
    .insert(rows)
    .select();

  if (error) {
    console.error('Failed to import transactions:', error);
    return null;
  }

  // Create import batch record
  const { data: batch } = await supabase
    .from('import_batches')
    .insert({
      filename,
      account_id: accountId,
      row_count: transactions.length,
      imported_count: (inserted ?? []).length,
      skipped_duplicates: skipped,
    })
    .select()
    .single();

  return batch as ImportBatch;
}

// ─── Spending summaries ──────────────────────────────────────

/** Get total spending for a given month. */
export async function getMonthSpending(month: string): Promise<number> {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endMon = mon === 12 ? 1 : mon + 1;
  const endYear = mon === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMon).padStart(2, '0')}-01`;

  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('type', 'expense')
    .gte('date', start)
    .lt('date', end);

  if (error) return 0;
  return (data ?? []).reduce((sum: number, t: { amount: number }) => sum + (t.amount ?? 0), 0);
}

/** Get total income for a given month. */
export async function getMonthIncome(month: string): Promise<number> {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endMon = mon === 12 ? 1 : mon + 1;
  const endYear = mon === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMon).padStart(2, '0')}-01`;

  const { data, error } = await supabase
    .from('transactions')
    .select('amount')
    .eq('type', 'income')
    .gte('date', start)
    .lt('date', end);

  if (error) return 0;
  return (data ?? []).reduce((sum: number, t: { amount: number }) => sum + (t.amount ?? 0), 0);
}

/** Get spending breakdown by category for a given month. */
export async function getSpendingByCategory(
  month: string,
): Promise<Array<{ categoryId: string; categoryName: string; total: number; count: number }>> {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${String(mon).padStart(2, '0')}-01`;
  const endMon = mon === 12 ? 1 : mon + 1;
  const endYear = mon === 12 ? year + 1 : year;
  const end = `${endYear}-${String(endMon).padStart(2, '0')}-01`;

  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('category, category_id, amount')
    .eq('type', 'expense')
    .gte('date', start)
    .lt('date', end);

  if (error) return [];

  const byCategory = new Map<string, { name: string; total: number; count: number }>();
  for (const t of (transactions ?? []) as Array<{
    category: string;
    category_id: string | null;
    amount: number;
  }>) {
    const key = t.category_id ?? t.category;
    const existing = byCategory.get(key) ?? { name: t.category, total: 0, count: 0 };
    existing.total += t.amount ?? 0;
    existing.count += 1;
    byCategory.set(key, existing);
  }

  return [...byCategory.entries()]
    .map(([id, v]) => ({ categoryId: id, categoryName: v.name, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total);
}

/** Get the last N months of spending data. */
export async function getMonthlySpendingHistory(
  months = 6,
): Promise<Array<{ month: string; spending: number; income: number }>> {
  const result: Array<{ month: string; spending: number; income: number }> = [];

  for (let i = 0; i < months; i++) {
    const month = yearMonthAgo(i);
    const [spending, income] = await Promise.all([
      getMonthSpending(month),
      getMonthIncome(month),
    ]);
    result.push({ month, spending, income });
  }

  return result.reverse();
}

// ─── Transaction history ─────────────────────────────────────

/** List import batches for the current user. */
export async function listImportBatches(): Promise<ImportBatch[]> {
  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .order('imported_at', { ascending: false });

  if (error) return [];
  return (data ?? []) as ImportBatch[];
}

/** Delete a transaction by ID. */
export async function deleteTransaction(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Failed to delete transaction:', error);
    return false;
  }
  return true;
}

/** Update a transaction's category. */
export async function updateTransactionCategory(
  id: string,
  category: string,
  categoryId: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('transactions')
    .update({ category, category_id: categoryId })
    .eq('id', id);

  if (error) {
    console.error('Failed to update transaction category:', error);
    return false;
  }
  return true;
}
