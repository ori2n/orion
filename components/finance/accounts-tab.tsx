'use client';

import { useState } from 'react';
import type { Account, Transaction, AccountType, TransactionType } from '@/lib/finance/types';
import { 
  JISA_CONTRIBUTION_LIMIT, 
  ISA_CONTRIBUTION_LIMIT,
} from '@/lib/finance/types';
import { 
  insertAccount, 
  deleteAccount, 
  insertTransaction, 
  deleteTransaction, 
  adjustAccountBalance, 
  checkJisaConversion, 
  getRemainingAllowance, 
  computeAge,
} from '@/lib/finance/storage';

const ACCOUNT_TYPES: AccountType[] = ['savings', 'cash', 'investment', 'isa'];

function fmt(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function notifySaved() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('finance-data-saved'));
  }
}

interface AccountsTabProps {
  accounts: Account[];
  transactions: Transaction[];
  onRefresh: () => void;
}

export default function AccountsTab({ accounts, transactions, onRefresh }: AccountsTabProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New account form
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('savings');
  const [newBalance, setNewBalance] = useState('');
  const [newInterestRate, setNewInterestRate] = useState('');
  const [newIsJisa, setNewIsJisa] = useState(false);
  const [newBirthDate, setNewBirthDate] = useState('');
  const [newIsCumulative, setNewIsCumulative] = useState(true);
  const [newMaxInterestAmount, setNewMaxInterestAmount] = useState('');

  // New transaction form
  const [showNewTx, setShowNewTx] = useState(false);
  const [txType, setTxType] = useState<TransactionType>('income');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('');
  const [txDescription, setTxDescription] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txError, setTxError] = useState<string | null>(null);
  // Transfer-specific state
  const [txTransferToId, setTxTransferToId] = useState<string>('');
  const [txTransferMode, setTxTransferMode] = useState<'fixed' | 'percent' | 'above_threshold'>('fixed');
  const [txTransferValue, setTxTransferValue] = useState<string>('');

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const accountTransactions = selectedAccountId
    ? transactions.filter((t) => t.account_id === selectedAccountId)
    : [];

  async function handleCreateAccount() {
    if (!newName.trim()) return;
    setError(null);

    // Enforce single ISA limit — only one ISA (regular or JISA) allowed per user
    if (newType === 'isa' && accounts.some((a) => a.type === 'isa')) {
      setError('Only one ISA account is allowed. You already have an ISA.');
      return;
    }

    const balance = parseFloat(newBalance) || 0;
    const interestRate = newInterestRate.trim() ? parseFloat(newInterestRate) : null;

    // If it's a JISA, require birth_date
    if (newType === 'isa' && newIsJisa && !newBirthDate.trim()) {
      setError('Birth date is required for a Junior ISA');
      return;
    }

    const maxAmount = newMaxInterestAmount.trim() ? parseFloat(newMaxInterestAmount) : null;

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
    if (result.error) {
      setError(`Failed to create account: ${result.error}`);
      return;
    }
    setShowNewAccount(false);
    setNewName('');
    setNewType('savings');
    setNewBalance('');
    setNewInterestRate('');
    setNewIsJisa(false);
    setNewBirthDate('');
    setNewIsCumulative(true);
    setNewMaxInterestAmount('');
    notifySaved();
    onRefresh();
  }

  async function handleDeleteAccount(id: string) {
    setError(null);
    const ok = await deleteAccount(id);
    if (!ok) {
      setError('Failed to delete account');
      return;
    }
    if (selectedAccountId === id) setSelectedAccountId(null);
    notifySaved();
    onRefresh();
  }

  async function handleAddTransaction() {
    if (!selectedAccountId) return;
    setError(null);
    setTxError(null);

    if (txType === 'transfer') {
      // ── Handle transfer ──
      if (!txTransferToId || !txTransferValue) {
        setTxError('Select destination account and enter a value');
        return;
      }
      const val = parseFloat(txTransferValue);
      if (isNaN(val) || val <= 0) {
        setTxError('Enter a valid positive value');
        return;
      }

      let transferAmount: number;
      if (txTransferMode === 'fixed') {
        transferAmount = val;
      } else if (txTransferMode === 'percent') {
        if (val > 100) { setTxError('Percentage cannot exceed 100%'); return; }
        transferAmount = (Number(selectedAccount?.balance ?? 0) * val) / 100;
      } else {
        // above_threshold: transfer everything above val
        const sourceBalance = Number(selectedAccount?.balance ?? 0);
        transferAmount = Math.max(0, sourceBalance - val);
      }

      if (transferAmount <= 0) {
        setTxError('Transfer amount is zero or negative — nothing to transfer');
        return;
      }

      // Create outgoing transaction
      const outResult = await insertTransaction({
        account_id: selectedAccountId,
        type: 'transfer',
        amount: transferAmount,
        category: 'Transfer',
        description: txDescription.trim() ? `Transfer to ${accounts.find(a => a.id === txTransferToId)?.name}: ${txDescription.trim()}` : `Transfer to ${accounts.find(a => a.id === txTransferToId)?.name}`,
        date: txDate,
        transfer_to_account_id: txTransferToId,
      });
      if (outResult.error) {
        setError(`Failed to create transfer: ${outResult.error}`);
        return;
      }

      // Create incoming transaction
      const inResult = await insertTransaction({
        account_id: txTransferToId,
        type: 'income',
        amount: transferAmount,
        category: 'Transfer',
        description: `Transfer from ${selectedAccount?.name}`,
        date: txDate,
      });
      if (inResult.error) {
        // Rollback outgoing
        if (outResult.data) await deleteTransaction(outResult.data.id);
        setError(`Failed to create receiving transaction: ${inResult.error}`);
        return;
      }

      // Adjust both balances
      const sourceAdj = await adjustAccountBalance(selectedAccountId, -transferAmount, 'transfer');
      if (!sourceAdj.success) {
        if (outResult.data) await deleteTransaction(outResult.data.id);
        if (inResult.data) await deleteTransaction(inResult.data.id);
        setTxError(sourceAdj.error ?? 'Transfer blocked by source account rules');
        return;
      }

      await adjustAccountBalance(txTransferToId, transferAmount);

      setShowNewTx(false);
      setTxType('income');
      setTxAmount('');
      setTxCategory('');
      setTxDescription('');
      setTxTransferToId('');
      setTxTransferValue('');
      setTxDate(new Date().toISOString().slice(0, 10));
      notifySaved();
      onRefresh();
      return;
    }

    // ── Regular income/expense ──
    if (!txAmount) return;
    const amount = parseFloat(txAmount);
    if (isNaN(amount) || amount <= 0) {
      setError('Enter a valid positive amount');
      return;
    }

    // Check JISA rules before attempting insert
    if (selectedAccount?.is_jisa && txType === 'expense') {
      setTxError('Withdrawals are not permitted from a Junior ISA (JISA)');
      return;
    }

    const result = await insertTransaction({
      account_id: selectedAccountId,
      type: txType,
      amount,
      category: txCategory.trim() || (txType === 'income' ? 'General Income' : 'General Expense'),
      description: txDescription.trim() || null,
      date: txDate,
    });
    if (result.error) {
      setError(`Failed to add transaction: ${result.error}`);
      return;
    }
    // Update account balance with constraint checks
    const delta = txType === 'income' ? amount : -amount;
    const adjResult = await adjustAccountBalance(selectedAccountId, delta, txType);
    if (!adjResult.success) {
      // Roll back the transaction
      if (result.data) {
        await deleteTransaction(result.data.id);
      }
      setTxError(adjResult.error ?? 'Transaction blocked by account rules');
      return;
    }

    setShowNewTx(false);
    setTxType('income');
    setTxAmount('');
    setTxCategory('');
    setTxDescription('');
    setTxTransferToId('');
    setTxTransferValue('');
    setTxDate(new Date().toISOString().slice(0, 10));
    notifySaved();
    onRefresh();
  }

  async function handleDeleteTransaction(tx: Transaction) {
    setError(null);
    const ok = await deleteTransaction(tx.id);
    if (!ok) {
      setError('Failed to delete transaction');
      return;
    }
    // Reverse the balance change — bypass JISA checks since we're undoing
    const delta = tx.type === 'income' ? -tx.amount : tx.amount;
    // For reverse operations, we skip the contribution limit check
    await adjustAccountBalance(tx.account_id, delta);

    notifySaved();
    onRefresh();
  }

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-2 text-xs text-red-400 backdrop-blur-sm">
          ⚠️ {error}
          <button onClick={() => setError(null)} className="ml-3 font-medium underline underline-offset-2">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        {/* ── Accounts List ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-[0.15em] text-zinc-500">ACCOUNTS</span>
            <button
              onClick={() => setShowNewAccount(!showNewAccount)}
              className="text-[10px] font-medium text-cyan-400 hover:text-cyan-300"
            >
              {showNewAccount ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {/* New account form */}
          {showNewAccount && (
            <div className="space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-3">
              <input
                type="text"
                placeholder="Account name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
              />
              <select
                value={newType}
                onChange={(e) => {
                  setNewType(e.target.value as AccountType);
                  if (e.target.value !== 'isa') {
                    setNewIsJisa(false);
                    setNewBirthDate('');
                  }
                }}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-cyan-700 focus:outline-none"
              >
                {ACCOUNT_TYPES.map((t) => {
                  const isIsaDisabled = t === 'isa' && accounts.some((a) => a.type === 'isa');
                  return (
                    <option key={t} value={t} disabled={isIsaDisabled} className="capitalize">
                      {t}{isIsaDisabled ? ' (limit reached)' : ''}
                    </option>
                  );
                })}
              </select>

              {/* JISA checkbox — only shown for ISA type */}
              {newType === 'isa' && (
                <label className="flex items-center gap-2 rounded border border-zinc-700/50 bg-zinc-800/50 px-2.5 py-1.5">
                  <input
                    type="checkbox"
                    checked={newIsJisa}
                    onChange={(e) => {
                      setNewIsJisa(e.target.checked);
                      if (!e.target.checked) setNewBirthDate('');
                    }}
                    className="accent-cyan-500"
                  />
                  <span className="text-[10px] text-zinc-400">Junior ISA (JISA)</span>
                  <span className="ml-auto text-[9px] text-zinc-600">Max £9K/yr · No withdrawals</span>
                </label>
              )}

              {/* Birth date — required for JISA */}
              {newType === 'isa' && newIsJisa && (
                <div className="rounded border border-zinc-700/30 bg-zinc-800/30 p-2">
                  <label className="mb-1 block text-[9px] text-zinc-500">CHILD&apos;S DATE OF BIRTH</label>
                  <input
                    type="date"
                    value={newBirthDate}
                    onChange={(e) => setNewBirthDate(e.target.value)}
                    max={new Date().toISOString().slice(0, 10)}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-cyan-700 focus:outline-none"
                  />
                  <p className="mt-1 text-[8px] text-zinc-600">JISA auto-converts to ISA at age 18</p>
                </div>
              )}

              <input
                type="number"
                step="0.01"
                placeholder="Starting balance (£)"
                value={newBalance}
                onChange={(e) => setNewBalance(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
              />
              {/* Cumulative interest toggle */}
              <label className="flex items-center gap-2 rounded border border-zinc-700/50 bg-zinc-800/50 px-2.5 py-1.5">
                <input
                  type="checkbox"
                  checked={newIsCumulative}
                  onChange={(e) => {
                    setNewIsCumulative(e.target.checked);
                    if (e.target.checked) setNewMaxInterestAmount('');
                  }}
                  className="accent-cyan-500"
                />
                <span className="text-[10px] text-zinc-400">Cumulative interest</span>
                <span className="ml-auto text-[9px] text-zinc-600">
                  {newIsCumulative ? 'Compounds on full balance' : 'Capped at max amount'}
                </span>
              </label>

              {/* Max interest amount — only when non-cumulative */}
              {!newIsCumulative && (
                <div className="rounded border border-amber-900/30 bg-amber-950/10 p-2">
                  <label className="mb-1 block text-[9px] text-zinc-500">MAX AMOUNT FOR INTEREST</label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    placeholder="Interest is calculated on this amount only"
                    value={newMaxInterestAmount}
                    onChange={(e) => setNewMaxInterestAmount(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
                  />
                  <p className="mt-1 text-[8px] text-zinc-600">
                    Interest earned still credits the account balance, but is calculated
                    against this fixed amount — not the growing balance.
                  </p>
                </div>
              )}

              <input
                type="number"
                step="0.1"
                min={0}
                max={100}
                placeholder="Interest rate % (annual, e.g. 4.5)"
                value={newInterestRate}
                onChange={(e) => setNewInterestRate(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
              />
              <button
                onClick={handleCreateAccount}
                disabled={!newName.trim()}
                className="w-full rounded bg-cyan-700 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-600 disabled:opacity-40"
              >
                Create Account
              </button>
            </div>
          )}

          {/* Account cards */}
          {accounts.length === 0 && !showNewAccount && (
            <p className="py-8 text-center text-xs text-zinc-500">No accounts yet</p>
          )}
          {accounts.map((acct) => {
            const isSelected = acct.id === selectedAccountId;
            const conversion = checkJisaConversion(acct);
            const allowance = getRemainingAllowance(acct);
            const jisaAge = acct.is_jisa ? computeAge(acct.birth_date) : null;
            return (
              <div
                key={acct.id}
                onClick={() => setSelectedAccountId(isSelected ? null : acct.id)}
                className={`cursor-pointer rounded-lg border p-3 transition-all duration-200 ${
                  isSelected
                    ? 'border-cyan-700/60 bg-zinc-800/80'
                    : 'border-zinc-700/30 bg-zinc-900/40 hover:border-zinc-600/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-200">{acct.name}</span>
                    {/* JISA badge */}
                    {acct.is_jisa && (
                      <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-amber-400">
                        JISA
                      </span>
                    )}
                    {acct.type === 'isa' && !acct.is_jisa && (
                      <span className="rounded bg-cyan-950/50 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-cyan-400">
                        ISA
                      </span>
                    )}
                    {/* Auto-conversion indicator */}
                    {conversion.converted && (
                      <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-emerald-400">
                        CONVERTED
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-sm font-semibold text-emerald-400">
                    {fmt(Number(acct.balance))}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] capitalize text-zinc-500">
                      {acct.is_jisa ? 'Junior ISA' : acct.type}
                    </span>
                    {acct.is_jisa && jisaAge != null && (
                      <span className="text-[9px] text-zinc-600">
                        Age {jisaAge}{jisaAge < 18 ? ` · Converts at 18` : ''}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {acct.interest_rate != null && (
                      <span className="text-[9px] font-mono text-zinc-600">
                        {Number(acct.interest_rate).toFixed(1)}% APR
                      </span>
                    )}
                    {!acct.is_cumulative && acct.max_interest_amount != null && (
                      <span className="text-[8px] text-amber-500/60" title="Non-cumulative — interest capped at max amount">
                        capped
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteAccount(acct.id); }}
                      className="text-[9px] text-zinc-600 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {/* Contribution allowance bar */}
                {allowance && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[8px] text-zinc-600">
                      <span>Annual allowance</span>
                      <span>£{allowance.used.toLocaleString('en-GB')} / £{allowance.limit.toLocaleString('en-GB')}</span>
                    </div>
                    <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          allowance.remaining < allowance.limit * 0.1
                            ? 'bg-red-500'
                            : 'bg-cyan-600'
                        }`}
                        style={{ width: `${(allowance.used / allowance.limit) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Transactions ── */}
        <div className="space-y-3">
          {selectedAccount ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-[0.15em] text-zinc-500">
                  {selectedAccount.name.toUpperCase()} · TRANSACTIONS
                </span>
                <button
                  onClick={() => setShowNewTx(!showNewTx)}
                  className="text-[10px] font-medium text-cyan-400 hover:text-cyan-300"
                >
                  {showNewTx ? 'Cancel' : '+ Add'}
                </button>
              </div>

              {/* New transaction form */}
              {showNewTx && (
                <div className="space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-3">
                  {txError && (
                    <div className="rounded border border-red-900/50 bg-red-950/30 px-2.5 py-1.5 text-[10px] text-red-400">
                      ⚠️ {txError}
                      <button onClick={() => setTxError(null)} className="ml-2 font-medium underline">Dismiss</button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {(['income', 'expense', 'transfer'] as TransactionType[]).map((t) => {
                      // Disable expense for JISAs
                      const isDisabled = selectedAccount?.is_jisa && t === 'expense';
                      return (
                        <button
                          key={t}
                          disabled={isDisabled}
                          onClick={() => {
                            setTxType(t);
                            if (t !== 'transfer') {
                              setTxTransferToId('');
                              setTxTransferValue('');
                            }
                          }}
                          title={isDisabled ? 'Withdrawals not allowed from JISA' : t}
                          className={`flex-1 rounded px-2 py-1 text-[10px] font-medium capitalize transition-colors ${
                            txType === t
                              ? t === 'income' ? 'bg-emerald-700/50 text-emerald-300'
                              : t === 'expense' ? 'bg-red-700/50 text-red-300'
                              : 'bg-amber-700/50 text-amber-300'
                              : 'bg-zinc-800 text-zinc-500'
                          } ${isDisabled ? 'cursor-not-allowed opacity-30' : ''}`}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>

                  {/* JISA withdrawal warning */}
                  {selectedAccount?.is_jisa && txType === 'expense' && (
                    <p className="text-[9px] text-red-400/80">Withdrawals are not permitted from a Junior ISA (JISA)</p>
                  )}

                  {/* Contribution limit info */}
                  {selectedAccount?.type === 'isa' && selectedAccount && txType !== 'transfer' && (
                    <div className="rounded border border-zinc-700/30 bg-zinc-800/30 px-2.5 py-1.5">
                      <p className="text-[9px] text-zinc-500">
                        {selectedAccount.is_jisa
                          ? `JISA limit: £${JISA_CONTRIBUTION_LIMIT.toLocaleString('en-GB')}/yr · No withdrawals`
                          : `ISA limit: £${ISA_CONTRIBUTION_LIMIT.toLocaleString('en-GB')}/yr · Withdrawals allowed`
                        }
                      </p>
                    </div>
                  )}

                  {txType === 'transfer' ? (
                    /* ══ Transfer form ══ */
                    <>
                      <div>
                        <label className="mb-1 block text-[9px] text-zinc-500">DESTINATION ACCOUNT</label>
                        <select
                          value={txTransferToId}
                          onChange={(e) => setTxTransferToId(e.target.value)}
                          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-700 focus:outline-none"
                        >
                          <option value="">Select destination…</option>
                          {accounts
                            .filter((a) => a.id !== selectedAccountId)
                            .map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                      </div>

                      {/* Transfer mode */}
                      <div className="flex gap-1 rounded border border-zinc-700/30 p-0.5">
                        {(['fixed', 'percent', 'above_threshold'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setTxTransferMode(mode)}
                            className={`flex-1 rounded px-2 py-1 text-[9px] font-medium transition-colors ${
                              txTransferMode === mode
                                ? 'bg-amber-800/40 text-amber-300'
                                : 'text-zinc-500 hover:text-zinc-400'
                            }`}
                          >
                            {mode === 'fixed' && 'Fixed £'}
                            {mode === 'percent' && '% of acct'}
                            {mode === 'above_threshold' && 'Above £'}
                          </button>
                        ))}
                      </div>

                      <div className="relative">
                        {txTransferMode !== 'percent' && (
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">£</span>
                        )}
                        <input
                          type="number"
                          step={txTransferMode === 'percent' ? '1' : '0.01'}
                          min={0}
                          max={txTransferMode === 'percent' ? 100 : undefined}
                          placeholder={
                            txTransferMode === 'fixed' ? 'Amount to transfer' :
                            txTransferMode === 'percent' ? 'e.g. 50' :
                            'Keep this amount, transfer the rest'
                          }
                          value={txTransferValue}
                          onChange={(e) => setTxTransferValue(e.target.value)}
                          className={`w-full rounded border border-zinc-700 bg-zinc-900 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-amber-700 focus:outline-none ${
                            txTransferMode !== 'percent' ? 'pl-7 pr-2.5' : 'px-2.5'
                          }`}
                        />
                        {txTransferMode === 'percent' && (
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">%</span>
                        )}
                      </div>

                      {txTransferMode === 'above_threshold' && (
                        <p className="text-[9px] text-zinc-500">
                          Transfers everything above this amount from{' '}
                          <span className="text-zinc-300">{selectedAccount?.name}</span>
                        </p>
                      )}

                      <div className="rounded border border-zinc-700/30 bg-zinc-800/30 p-2">
                        <p className="text-[9px] text-zinc-500">
                          Source balance: <span className="font-mono text-zinc-300">{fmt(Number(selectedAccount?.balance ?? 0))}</span>
                          {txTransferValue && (
                            <>
                              {' · '}To transfer:{' '}
                              <span className="font-mono text-amber-300">
                                {txTransferMode === 'fixed'
                                  ? fmt(parseFloat(txTransferValue) || 0)
                                  : txTransferMode === 'percent'
                                  ? fmt((Number(selectedAccount?.balance ?? 0) * (parseFloat(txTransferValue) || 0)) / 100)
                                  : fmt(Math.max(0, Number(selectedAccount?.balance ?? 0) - (parseFloat(txTransferValue) || 0)))
                                }
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </>
                  ) : (
                    /* ══ Income/Expense form ══ */
                    <>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Amount (£)"
                        value={txAmount}
                        onChange={(e) => setTxAmount(e.target.value)}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
                      />
                      <input
                        type="text"
                        placeholder="Category (e.g. Salary, Groceries)"
                        value={txCategory}
                        onChange={(e) => setTxCategory(e.target.value)}
                        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
                      />
                    </>
                  )}

                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={txDescription}
                    onChange={(e) => setTxDescription(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 focus:border-cyan-700 focus:outline-none"
                  />
                  <input
                    type="date"
                    value={txDate}
                    onChange={(e) => setTxDate(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-cyan-700 focus:outline-none"
                  />
                  <button
                    onClick={handleAddTransaction}
                    disabled={
                      txType === 'transfer'
                        ? (!txTransferToId || !txTransferValue)
                        : (!txAmount || parseFloat(txAmount) <= 0)
                    }
                    className={`w-full rounded py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-40 ${
                      txType === 'transfer'
                        ? 'bg-amber-700 hover:bg-amber-600'
                        : 'bg-cyan-700 hover:bg-cyan-600'
                    }`}
                  >
                    {txType === 'transfer' ? 'Execute Transfer' : 'Add Transaction'}
                  </button>
                </div>
              )}

              {/* Transaction list */}
              {accountTransactions.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-500">No transactions for this account</p>
              ) : (
                <div className="max-h-[50vh] space-y-1 overflow-y-auto">
                  {accountTransactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between rounded border border-zinc-800/50 px-3 py-2 transition-colors hover:border-zinc-700/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] capitalize text-zinc-500">{tx.type}</span>
                          <span className="text-xs text-zinc-300">{tx.category}</span>
                        </div>
                        {tx.description && (
                          <p className="truncate text-[10px] text-zinc-600">{tx.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-zinc-600">{tx.date}</span>
                        <span className={`font-mono text-xs font-medium ${
                          tx.type === 'income' ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {tx.type === 'income' ? '+' : '-'}£{Number(tx.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                        </span>                          <button
                            onClick={() => handleDeleteTransaction(tx)}
                            className="text-[9px] text-zinc-700 hover:text-red-400"
                          >
                            ✕
                          </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-20">
              <p className="text-xs text-zinc-500">Select an account to view transactions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
