'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import {
  createAccount,
  listAccounts,
  updateAccount,
  updateBalance,
  type listAccounts as listAccountsType,
} from '@/lib/finance/accounts';
import {
  addTransaction,
  parseCsv,
  parseTransactions,
  importTransactions,
  DEFAULT_CSV_CONFIG,
} from '@/lib/finance/transactions';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  createCategoryRule,
  listCategoryRules,
  deleteCategoryRule,
} from '@/lib/finance/categories';
import { listImportBatches } from '@/lib/finance/transactions';
import { upsertProjectionSettings } from '@/lib/finance/calculations';
import { upsertHolding } from '@/lib/finance/investments';
import { fmtCurrency, fmtRelativeDate, currentYearMonth } from '@/lib/finance/format';
import type {
  FinancialAccount,
  TransactionCategory,
  CategoryRule,
  ImportBatch,
  AccountType,
  MatchType,
} from '@/lib/finance/types';

type Tab = 'import' | 'transaction' | 'accounts' | 'categories' | 'settings';

export default function ManageDataView() {
  const [tab, setTab] = useState<Tab>('import');
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  const refresh = useCallback(async () => {
    const [accs, cats, rls, bts] = await Promise.all([
      listAccounts(),
      listCategories(),
      listCategoryRules(),
      listImportBatches(),
    ]);
    setAccounts(accs);
    setCategories(cats);
    setRules(rls);
    setBatches(bts);
  }, []);

  useEffect(() => {
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
          <span className="text-xs text-zinc-500">Loading…</span>
        </div>
      </div>
    );
  }

  const tabs: Array<{ key: Tab; label: string; icon: string }> = [
    { key: 'import', label: 'Import CSV', icon: '📄' },
    { key: 'transaction', label: 'Add Transaction', icon: '➕' },
    { key: 'accounts', label: 'Accounts', icon: '🏦' },
    { key: 'categories', label: 'Categories', icon: '🏷️' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              'shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors ' +
              (tab === t.key
                ? 'bg-zinc-800/70 text-zinc-100 ring-1 ring-zinc-700/60'
                : 'text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-200')
            }
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'import' && (
        <CsvImportPanel accounts={accounts} onImported={refresh} />
      )}
      {tab === 'transaction' && (
        <AddTransactionPanel accounts={accounts} categories={categories} onAdded={refresh} />
      )}
      {tab === 'accounts' && (
        <AccountsPanel accounts={accounts} onUpdated={refresh} />
      )}
      {tab === 'categories' && (
        <CategoriesPanel
          categories={categories}
          rules={rules}
          onUpdated={refresh}
        />
      )}
      {tab === 'settings' && (
        <SettingsPanel />
      )}

      {/* Import history */}
      {batches.length > 0 && (
        <section className="mt-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-zinc-100">
            Import history
          </h2>
          <ul className="divide-y divide-zinc-800/40">
            {batches.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2.5 text-xs">
                <div>
                  <span className="text-zinc-200">{b.filename}</span>
                  <span className="ml-2 text-zinc-500">
                    {b.imported_count} imported · {b.skipped_duplicates} duplicates
                  </span>
                </div>
                <span className="text-zinc-500">{fmtRelativeDate(b.imported_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ─── CSV Import Panel ────────────────────────────────────────

function CsvImportPanel({
  accounts,
  onImported,
}: {
  accounts: FinancialAccount[];
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = async () => {
    if (!file || !accountId) return;
    setImporting(true);
    setError('');
    setResult(null);

    try {
      const text = await file.text();
      const rows = parseCsv(text, DEFAULT_CSV_CONFIG);
      if (rows.length === 0) {
        setError('No transactions found in the file.');
        setImporting(false);
        return;
      }

      const parsed = await parseTransactions(rows, DEFAULT_CSV_CONFIG);
      const batch = await importTransactions(parsed, accountId, file.name);

      if (batch) {
        setResult({
          imported: batch.imported_count,
          skipped: batch.skipped_duplicates,
        });
        onImported();
      } else {
        setError('Import failed. Please check the file format.');
      }
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    setImporting(false);
  };

  return (
    <section className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight text-zinc-100">
        Import bank transactions
      </h2>
      <p className="mb-4 text-[11px] text-zinc-500">
        Upload a CSV file from your bank. Transactions are automatically categorised and duplicates are skipped.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Select account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">Choose account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            CSV file
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200 file:mr-3 file:rounded file:border-0 file:bg-zinc-700 file:px-3 file:py-1 file:text-xs file:text-zinc-200"
          />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Imported {result.imported} transactions.
          {result.skipped > 0 && ` Skipped ${result.skipped} duplicates.`}
        </div>
      )}

      <button
        onClick={handleImport}
        disabled={!file || !accountId || importing}
        className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {importing ? 'Importing…' : 'Import transactions'}
      </button>
    </section>
  );
}

// ─── Add Transaction Panel ───────────────────────────────────

function AddTransactionPanel({
  accounts,
  categories,
  onAdded,
}: {
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  onAdded: () => void;
}) {
  const [accountId, setAccountId] = useState('');
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(currentYearMonth() + '-' + new Date().getDate().toString().padStart(2, '0'));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleAdd = async () => {
    if (!accountId || !amount || !category) return;
    setSaving(true);
    setSaved(false);

    const tx = await addTransaction(
      accountId,
      type,
      parseFloat(amount),
      category,
      date,
      { description: description || undefined },
    );

    if (tx) {
      setSaved(true);
      setAmount('');
      setDescription('');
      onAdded();
      setTimeout(() => setSaved(false), 3000);
    }

    setSaving(false);
  };

  return (
    <section className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight text-zinc-100">
        Add transaction
      </h2>
      <p className="mb-4 text-[11px] text-zinc-500">
        Manually add a transaction that isn&apos;t available through bank import.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Account
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">Choose account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'income' | 'expense')}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Amount (£)
          </label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">Choose category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>
      </div>

      {saved && (
        <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Transaction added successfully.
        </div>
      )}

      <button
        onClick={handleAdd}
        disabled={!accountId || !amount || !category || saving}
        className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Adding…' : 'Add transaction'}
      </button>
    </section>
  );
}

// ─── Accounts Panel ──────────────────────────────────────────

function AccountsPanel({
  accounts,
  onUpdated,
}: {
  accounts: FinancialAccount[];
  onUpdated: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('savings');
  const [balance, setBalance] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [institution, setInstitution] = useState('');
  const [isJisa, setIsJisa] = useState(false);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName('');
    setType('savings');
    setBalance('');
    setInterestRate('');
    setInstitution('');
    setIsJisa(false);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);

    if (editingId) {
      await updateAccount(editingId, {
        name,
        type,
        balance: parseFloat(balance) || 0,
        interest_rate: interestRate ? parseFloat(interestRate) : null,
        institution: institution || null,
        is_jisa: isJisa,
      });
    } else {
      await createAccount(name, type, {
        balance: parseFloat(balance) || 0,
        interestRate: interestRate ? parseFloat(interestRate) : undefined,
        institution: institution || undefined,
        isJisa,
      });
    }

    resetForm();
    onUpdated();
    setSaving(false);
  };

  const startEdit = (account: FinancialAccount) => {
    setEditingId(account.id);
    setName(account.name);
    setType(account.type);
    setBalance(String(account.balance));
    setInterestRate(account.interest_rate !== null ? String(account.interest_rate) : '');
    setInstitution(account.institution ?? '');
    setIsJisa(account.is_jisa);
    setShowForm(true);
  };

  return (
    <section className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
          Financial accounts
        </h2>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
        >
          {showForm ? 'Cancel' : '+ Add account'}
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Account name"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              >
                <option value="savings">Savings</option>
                <option value="cash">Cash</option>
                <option value="investment">Investment</option>
                <option value="isa">ISA</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Balance (£)</label>
              <input
                type="number"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Interest rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={interestRate}
                onChange={(e) => setInterestRate(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Institution</label>
              <input
                type="text"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="e.g., HSBC, Vanguard"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isJisa"
                checked={isJisa}
                onChange={(e) => setIsJisa(e.target.checked)}
                className="rounded border-zinc-600"
              />
              <label htmlFor="isJisa" className="text-xs text-zinc-300">This is a JISA</label>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSave}
              disabled={!name || saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Update account' : 'Add account'}
            </button>
            <button
              onClick={resetForm}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <ul className="divide-y divide-zinc-800/40">
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-zinc-100">{a.name}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                <span className="capitalize">{a.type}</span>
                {a.institution && <span>· {a.institution}</span>}
                {a.interest_rate !== null && <span>· {a.interest_rate}% AER</span>}
                {a.is_jisa && (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">JISA</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-zinc-100">{fmtCurrency(a.balance)}</span>
              <button
                onClick={() => startEdit(a)}
                className="text-[10px] text-zinc-500 hover:text-zinc-200"
              >
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>

      {accounts.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center">
          <div className="text-sm font-medium text-zinc-200">No accounts yet</div>
          <p className="mt-1 text-[11px] text-zinc-500">
            Add your savings and investment accounts to start tracking.
          </p>
        </div>
      )}
    </section>
  );
}

// ─── Categories Panel ────────────────────────────────────────

function CategoriesPanel({
  categories,
  rules,
  onUpdated,
}: {
  categories: TransactionCategory[];
  rules: CategoryRule[];
  onUpdated: () => void;
}) {
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('');
  const [newRulePattern, setNewRulePattern] = useState('');
  const [newRuleCategory, setNewRuleCategory] = useState('');
  const [newRuleMatch, setNewRuleMatch] = useState<MatchType>('contains');

  const handleAddCategory = async () => {
    if (!newCatName) return;
    await createCategory(newCatName, newCatIcon || undefined);
    setNewCatName('');
    setNewCatIcon('');
    onUpdated();
  };

  const handleAddRule = async () => {
    if (!newRulePattern || !newRuleCategory) return;
    const cat = categories.find((c) => c.name === newRuleCategory);
    if (!cat) return;
    await createCategoryRule(cat.id, newRulePattern, newRuleMatch);
    setNewRulePattern('');
    onUpdated();
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await deleteCategory(id);
    onUpdated();
  };

  const handleDeleteRule = async (id: string) => {
    await deleteCategoryRule(id);
    onUpdated();
  };

  return (
    <div className="space-y-6">
      {/* Categories */}
      <section className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-zinc-100">
          Spending categories
        </h2>

        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder="Category name"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
          <input
            type="text"
            value={newCatIcon}
            onChange={(e) => setNewCatIcon(e.target.value)}
            placeholder="Icon"
            className="w-16 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
          <button
            onClick={handleAddCategory}
            disabled={!newCatName}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Add
          </button>
        </div>

        <ul className="divide-y divide-zinc-800/40">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2">
                <span>{c.icon}</span>
                <span className="text-sm text-zinc-200">{c.name}</span>
                {c.is_system && (
                  <span className="text-[9px] text-zinc-600">system</span>
                )}
              </div>
              {!c.is_system && (
                <button
                  onClick={() => handleDeleteCategory(c.id)}
                  className="text-[10px] text-zinc-500 hover:text-red-400"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Category rules */}
      <section className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold tracking-tight text-zinc-100">
          Auto-categorisation rules
        </h2>
        <p className="mb-3 text-[11px] text-zinc-500">
          Transactions matching these patterns are automatically categorised.
        </p>

        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={newRulePattern}
            onChange={(e) => setNewRulePattern(e.target.value)}
            placeholder="Description pattern (e.g., TESCO)"
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
          <select
            value={newRuleMatch}
            onChange={(e) => setNewRuleMatch(e.target.value as MatchType)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="contains">Contains</option>
            <option value="starts_with">Starts with</option>
            <option value="ends_with">Ends with</option>
            <option value="exact">Exact match</option>
          </select>
          <select
            value={newRuleCategory}
            onChange={(e) => setNewRuleCategory(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          >
            <option value="">Category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>{c.icon} {c.name}</option>
            ))}
          </select>
          <button
            onClick={handleAddRule}
            disabled={!newRulePattern || !newRuleCategory}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Add rule
          </button>
        </div>

        <ul className="divide-y divide-zinc-800/40">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-zinc-400">&quot;{r.pattern}&quot;</span>
                <span className="text-zinc-600">({r.match_type})</span>
                <span className="text-zinc-500">→</span>
                <span className="text-zinc-300">
                  {categories.find((c) => c.id === r.category_id)?.name ?? 'Unknown'}
                </span>
              </div>
              <button
                onClick={() => handleDeleteRule(r.id)}
                className="text-[10px] text-zinc-500 hover:text-red-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── Settings Panel ──────────────────────────────────────────

function SettingsPanel() {
  const [birthDate, setBirthDate] = useState('');
  const [monthlyInvestment, setMonthlyInvestment] = useState('');
  const [conservative, setConservative] = useState('5');
  const [base, setBase] = useState('7');
  const [optimistic, setOptimistic] = useState('10');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('projection_settings')
        .select('*')
        .single();
      if (data) {
        setBirthDate(data.birth_date ?? '');
        setMonthlyInvestment(String(data.current_monthly_investment ?? ''));
        setConservative(String((data.conservative_return ?? 0.05) * 100));
        setBase(String((data.base_return ?? 0.07) * 100));
        setOptimistic(String((data.optimistic_return ?? 0.10) * 100));
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await upsertProjectionSettings({
      birth_date: birthDate || null,
      current_monthly_investment: parseFloat(monthlyInvestment) || 0,
      conservative_return: parseFloat(conservative) / 100,
      base_return: parseFloat(base) / 100,
      optimistic_return: parseFloat(optimistic) / 100,
    });
    setSaved(true);
    setSaving(false);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <section className="rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight text-zinc-100">
        Projection settings
      </h2>
      <p className="mb-4 text-[11px] text-zinc-500">
        Configure your personal details and projection assumptions.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Date of birth
          </label>
          <input
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Monthly investment (£)
          </label>
          <input
            type="number"
            step="1"
            value={monthlyInvestment}
            onChange={(e) => setMonthlyInvestment(e.target.value)}
            placeholder="0"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Conservative return (% p.a.)
          </label>
          <input
            type="number"
            step="0.5"
            value={conservative}
            onChange={(e) => setConservative(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Base return (% p.a.)
          </label>
          <input
            type="number"
            step="0.5"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>

        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Optimistic return (% p.a.)
          </label>
          <input
            type="number"
            step="0.5"
            value={optimistic}
            onChange={(e) => setOptimistic(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-200"
          />
        </div>
      </div>

      {saved && (
        <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          Settings saved.
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      <div className="mt-3 text-[10px] text-zinc-600">
        Projections are illustrative assumptions, not predictions. Actual returns will vary and are not guaranteed.
      </div>
    </section>
  );
}
