'use client';

import { useState } from 'react';
import type { Account, Transaction, AccountType, TransactionType } from '@/lib/finance/types';
import { ISA_CONTRIBUTION_LIMIT } from '@/lib/finance/types';
import {
  insertAccount,
  deleteAccount,
  insertTransaction,
  deleteTransaction,
  adjustAccountBalance,
} from '@/lib/finance/storage';

const INVESTING_TYPES: AccountType[] = ['investment', 'isa'];

function fmt(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function notifySaved() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finance-data-saved'));
  }
}

interface InvestingAccountsWidgetProps {
  accounts: Account[];
  transactions: Transaction[];
  onRefresh: () => void;
}

export default function InvestingAccountsWidget({ accounts, transactions, onRefresh }: InvestingAccountsWidgetProps) {
  const investingAccounts = accounts.filter((a) => a.type === 'investment' || a.type === 'isa');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New account form
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('investment');
  const [newBalance, setNewBalance] = useState('');
  const [newInterestRate, setNewInterestRate] = useState('');
  const [newIsJisa, setNewIsJisa] = useState(false);
  const [newBirthDate, setNewBirthDate] = useState('');
  const [newIsCumulative, setNewIsCumulative] = useState(true);
  const [newMaxAmount, setNewMaxAmount] = useState('');

  // Transaction form
  const [showTx, setShowTx] = useState(false);
  const [txType, setTxType] = useState<TransactionType>('income');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('');
  const [txDescription, setTxDescription] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txError, setTxError] = useState<string | null>(null);

  const selected = investingAccounts.find((a) => a.id === selectedId);
  const accountTxs = selectedId
    ? transactions.filter((t) => t.account_id === selectedId)
    : [];

  async function handleCreate() {
    if (!newName.trim()) return;
    setError(null);

    if (newType === 'isa' && investingAccounts.some((a) => a.type === 'isa')) {
      setError('Only one ISA account is allowed');
      return;
    }

    const balance = parseFloat(newBalance) || 0;
    const interestRate = newInterestRate.trim() ? parseFloat(newInterestRate) : null;

    if (newType === 'isa' && newIsJisa && !newBirthDate.trim()) {
      setError('Birth date required for JISA');
      return;
    }

    const maxAmount = newMaxAmount.trim() ? parseFloat(newMaxAmount) : null;

    const result = await insertAccount({
      name: newName.trim(),
      type: newType,
      balance,
      interest_rate: (interestRate != null && !isNaN(interestRate)) ? interestRate : null,
      is_jisa: newType === 'isa' ? newIsJisa : false,
      birth_date: newIsJisa ? newBirthDate.trim() || null : null,
      is_cumulative: newIsCumulative,
      max_interest_amount: (!newIsCumulative && maxAmount != null && !isNaN(maxAmount)) ? maxAmount : null,
    });
    if (result.error) { setError(result.error); return; }
    setShowNew(false);
    setNewName('');
    setNewType('investment');
    setNewBalance('');
    setNewInterestRate('');
    setNewIsJisa(false);
    setNewBirthDate('');
    setNewIsCumulative(true);
    setNewMaxAmount('');
    notifySaved();
    onRefresh();
  }

  async function handleDelete(id: string) {
    setError(null);
    const ok = await deleteAccount(id);
    if (!ok) { setError('Failed to delete'); return; }
    if (selectedId === id) setSelectedId(null);
    notifySaved();
    onRefresh();
  }

  async function handleAddTx() {
    if (!selectedId || !txAmount) return;
    setTxError(null);
    const amount = parseFloat(txAmount);
    if (isNaN(amount) || amount <= 0) { setTxError('Enter valid amount'); return; }

    if (selected?.is_jisa && txType === 'expense') {
      setTxError('Withdrawals not permitted from JISA');
      return;
    }

    const result = await insertTransaction({
      account_id: selectedId,
      type: txType,
      amount,
      category: txCategory.trim() || (txType === 'income' ? 'Income' : 'Expense'),
      description: txDescription.trim() || null,
      date: txDate,
    });
    if (result.error) { setError(result.error); return; }
    const delta = txType === 'income' ? amount : -amount;
    const adj = await adjustAccountBalance(selectedId, delta, txType);
    if (!adj.success) {
      if (result.data) await deleteTransaction(result.data.id);
      setTxError(adj.error ?? 'Transaction blocked');
      return;
    }
    setShowTx(false);
    setTxAmount('');
    setTxCategory('');
    setTxDescription('');
    notifySaved();
    onRefresh();
  }

  async function handleDeleteTx(tx: Transaction) {
    await deleteTransaction(tx.id);
    const delta = tx.type === 'income' ? -tx.amount : tx.amount;
    await adjustAccountBalance(tx.account_id, delta);
    notifySaved();
    onRefresh();
  }

  const totalInvesting = investingAccounts.reduce((s, a) => s + Number(a.balance), 0);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/40 backdrop-blur-xl">
      {/* Sheen */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500/[0.03] to-transparent" />

      {/* Header */}
      <div className="relative flex items-center justify-between px-3 pt-3 pb-2">
        <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-[10px] font-semibold tracking-[0.15em] text-transparent">
          INVESTING ACCOUNTS
        </span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-blue-400">{fmt(totalInvesting)}</span>
          <button onClick={() => setShowNew(!showNew)} className="text-[9px] text-cyan-400 hover:text-cyan-300">
            {showNew ? 'Cancel' : '+ Add'}
          </button>
        </div>
      </div>

      {error && (
        <div className="relative mx-3 mb-2 rounded border border-red-900/50 bg-red-950/30 px-2.5 py-1 text-[9px] text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* New account form */}
      {showNew && (
        <div className="relative space-y-2 px-3 pb-3">
          <div className="rounded-lg border border-zinc-700/30 bg-zinc-800/30 p-2.5 space-y-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Account name"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />
            <select value={newType} onChange={(e) => {
              setNewType(e.target.value as AccountType);
              if (e.target.value !== 'isa') { setNewIsJisa(false); setNewBirthDate(''); }
            }}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 capitalize focus:border-blue-700 focus:outline-none">
              {INVESTING_TYPES.map((t) => {
                const disabled = t === 'isa' && investingAccounts.some((a) => a.type === 'isa');
                return (
                  <option key={t} value={t} disabled={disabled} className="capitalize">
                    {t}{disabled ? ' (limit reached)' : ''}
                  </option>
                );
              })}
            </select>

            {newType === 'isa' && (
              <label className="flex items-center gap-2 rounded border border-zinc-700/30 bg-zinc-800/30 px-2 py-1">
                <input type="checkbox" checked={newIsJisa} onChange={(e) => {
                  setNewIsJisa(e.target.checked);
                  if (!e.target.checked) setNewBirthDate('');
                }} className="accent-cyan-500" />
                <span className="text-[9px] text-zinc-400">Junior ISA (max £9K/yr)</span>
              </label>
            )}

            {newType === 'isa' && newIsJisa && (
              <div className="rounded border border-zinc-700/30 bg-zinc-800/20 p-2">
                <label className="mb-1 block text-[8px] text-zinc-500">CHILD'S DATE OF BIRTH</label>
                <input type="date" value={newBirthDate} onChange={(e) => setNewBirthDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 focus:border-blue-700 focus:outline-none" />
              </div>
            )}

            <input type="number" step="0.01" placeholder="Starting balance (£)" value={newBalance}
              onChange={(e) => setNewBalance(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />

            {/* Cumulative toggle */}
            <label className="flex items-center gap-2 rounded border border-zinc-700/30 bg-zinc-800/30 px-2 py-1">
              <input type="checkbox" checked={newIsCumulative} onChange={(e) => {
                setNewIsCumulative(e.target.checked);
                if (e.target.checked) setNewMaxAmount('');
              }} className="accent-cyan-500" />
              <span className="text-[9px] text-zinc-400">Cumulative interest</span>
            </label>

            {!newIsCumulative && (
              <input type="number" step="0.01" min={0} placeholder="Max amount for interest" value={newMaxAmount}
                onChange={(e) => setNewMaxAmount(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />
            )}

            <input type="number" step="0.1" min={0} max={100} placeholder="Interest rate % (e.g. 7.0)" value={newInterestRate}
              onChange={(e) => setNewInterestRate(e.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />

            <button onClick={handleCreate} disabled={!newName.trim()}
              className="w-full rounded bg-blue-700 py-1 text-[10px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40">
              Create Account
            </button>
          </div>
        </div>
      )}

      {/* Account list */}
      <div className="relative space-y-1 px-3 pb-3">
        {investingAccounts.length === 0 ? (
          <p className="py-3 text-center text-[10px] text-zinc-600">No investing accounts yet</p>
        ) : (
          investingAccounts.map((acct) => (
            <div
              key={acct.id}
              onClick={() => setSelectedId(selectedId === acct.id ? null : acct.id)}
              className={`cursor-pointer rounded-lg border p-2.5 transition-all ${
                selectedId === acct.id
                  ? 'border-blue-700/50 bg-zinc-800/60'
                  : 'border-zinc-700/20 bg-zinc-900/20 hover:border-zinc-600/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-zinc-200">{acct.name}</span>
                  {acct.is_jisa && <span className="rounded bg-amber-950/50 px-1 py-0.5 text-[7px] font-bold text-amber-400">JISA</span>}
                  {acct.type === 'isa' && !acct.is_jisa && <span className="rounded bg-cyan-950/50 px-1 py-0.5 text-[7px] font-bold text-cyan-400">ISA</span>}
                </div>
                <span className="font-mono text-[11px] font-semibold text-blue-400">{fmt(Number(acct.balance))}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-[9px] capitalize text-zinc-500">
                  {acct.is_jisa ? 'Junior ISA' : acct.type}
                </span>
                {acct.interest_rate != null && (
                  <span className="text-[8px] font-mono text-zinc-600">{Number(acct.interest_rate).toFixed(1)}%</span>
                )}
                {!acct.is_cumulative && <span className="text-[7px] text-amber-500/60">capped</span>}
                <button onClick={(e) => { e.stopPropagation(); handleDelete(acct.id); }}
                  className="ml-auto text-[8px] text-zinc-700 hover:text-red-400">Delete</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Transaction panel */}
      {selected && (
        <div className="relative border-t border-zinc-800/30 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-semibold tracking-[0.15em] text-zinc-500">
              {selected.name.toUpperCase()} · TRANSACTIONS
            </span>
            <button onClick={() => setShowTx(!showTx)} className="text-[9px] text-cyan-400 hover:text-cyan-300">
              {showTx ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {showTx && (
            <div className="mb-2 space-y-2 rounded-lg border border-zinc-700/30 bg-zinc-800/30 p-2.5">
              {txError && (
                <div className="rounded border border-red-900/50 bg-red-950/30 px-2 py-1 text-[8px] text-red-400">
                  {txError}
                  <button onClick={() => setTxError(null)} className="ml-2 underline">Dismiss</button>
                </div>
              )}

              {/* ISA limit info */}
              {selected.type === 'isa' && (
                <div className="rounded border border-zinc-700/20 bg-zinc-800/20 px-2 py-1">
                  <p className="text-[8px] text-zinc-500">
                    {selected.is_jisa ? 'JISA limit: £9K/yr · No withdrawals' : 'ISA limit: £20K/yr'}
                  </p>
                </div>
              )}

              <div className="flex gap-1">
                {(['income', 'expense'] as TransactionType[]).map((t) => {
                  const disabled = selected.is_jisa && t === 'expense';
                  return (
                    <button key={t} onClick={() => !disabled && setTxType(t)} disabled={disabled}
                      title={disabled ? 'No withdrawals from JISA' : t}
                      className={`flex-1 rounded px-2 py-1 text-[9px] font-medium capitalize transition-colors ${
                        txType === t
                          ? t === 'income' ? 'bg-emerald-700/40 text-emerald-300' : 'bg-red-700/40 text-red-300'
                          : 'bg-zinc-800 text-zinc-500'
                      } ${disabled ? 'cursor-not-allowed opacity-30' : ''}`}>{t}</button>
                  );
                })}
              </div>

              <input type="number" step="0.01" placeholder="Amount (£)" value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />
              <input type="text" placeholder="Category" value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />
              <input type="text" placeholder="Description (optional)" value={txDescription}
                onChange={(e) => setTxDescription(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 placeholder-zinc-500 focus:border-blue-700 focus:outline-none" />
              <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-100 focus:border-blue-700 focus:outline-none" />
              <button onClick={handleAddTx} disabled={!txAmount || parseFloat(txAmount) <= 0}
                className="w-full rounded bg-blue-700 py-1 text-[10px] font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-40">
                Add Transaction
              </button>
            </div>
          )}

          <div className="max-h-[250px] space-y-0.5 overflow-y-auto">
            {accountTxs.length === 0 ? (
              <p className="py-2 text-center text-[9px] text-zinc-600">No transactions</p>
            ) : (
              accountTxs.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between rounded border border-zinc-800/30 px-2 py-1.5 transition-colors hover:border-zinc-700/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] capitalize text-zinc-500">{tx.type}</span>
                      <span className="text-[9px] text-zinc-300">{tx.category}</span>
                    </div>
                    {tx.description && <p className="truncate text-[8px] text-zinc-600">{tx.description}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] text-zinc-600">{tx.date}</span>
                    <span className={`font-mono text-[10px] font-medium ${tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.type === 'income' ? '+' : '-'}£{Number(tx.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </span>
                    <button onClick={() => handleDeleteTx(tx)} className="text-[8px] text-zinc-700 hover:text-red-400">✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
