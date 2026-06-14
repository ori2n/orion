'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAccounts, getAllTransactions, checkJisaConversion, convertJisaToIsa, getFutureTransactions } from '@/lib/finance/storage';
import { getUserAge } from '@/lib/health/user-profile';
import type { Account, Transaction } from '@/lib/finance/types';
import { computeProjection } from '@/lib/finance/projections';
import type { ProjectionInputs } from '@/lib/finance/projections';
import OverviewTab from './overview-tab';

export default function FinanceDashboard() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Projection inputs — age, target, net worth, accounts, future txns + salary allocations
  const [projectionInputs, setProjectionInputs] = useState<ProjectionInputs>({
    currentAge: 13,
    targetAge: 45,
    currentNetWorth: 0,
    accounts: [],
    futureTransactions: [],
    salaryAllocationsByAge: [],
    yearlyExpenses: 0,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [accts, txs, userAge, futureTxns] = await Promise.all([
      getAccounts(),
      getAllTransactions(12),
      getUserAge(),
      getFutureTransactions(),
    ]);

    // Check for JISA→ISA auto-conversion (age >= 18)
    const conversionPromises = accts.map(async (acct) => {
      const result = checkJisaConversion(acct);
      if (result.converted) {
        await convertJisaToIsa(acct.id);
        return { ...acct, is_jisa: false };
      }
      return acct;
    });
    const updatedAccounts = await Promise.all(conversionPromises);

    // Set age from user profile — overrides projection inputs
    if (userAge != null) {
      setProjectionInputs((prev) => ({ ...prev, currentAge: userAge }));
    }

    setAccounts(updatedAccounts);
    setTransactions(txs);

    // Populate future transactions from Supabase, mapping DB columns to projection types
    if (futureTxns.length > 0) {
      setProjectionInputs((prev) => ({
        ...prev,
        futureTransactions: futureTxns.map((ft) => ({
          id: ft.id,
          accountId: ft.account_id,
          age: ft.age,
          description: ft.description,
          amount: Number(ft.amount),
          toAccountId: ft.to_account_id ?? undefined,
          transferMode: ft.transfer_mode ?? undefined,
          transferValue: ft.transfer_value != null ? Number(ft.transfer_value) : undefined,
        })),
      }));
    }

    setLoading(false);
  }, [refreshKey]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh on data-saved events
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener('finance-data-saved', handler);
    return () => window.removeEventListener('finance-data-saved', handler);
  }, []);

  const netWorth = accounts.reduce((sum, a) => sum + Number(a.balance), 0);

  // Compute monthly cashflow from transactions
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthTxns = transactions.filter((t) => t.date.startsWith(thisMonth));
  const totalIncome = thisMonthTxns
    .filter((t) => t.type === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalSpending = thisMonthTxns
    .filter((t) => t.type === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0);
  const netCashflow = totalIncome - totalSpending;

  // Compute projection — uses per-account growth with cumulative/non-cumulative support
  const projection = computeProjection({
    ...projectionInputs,
    currentNetWorth: netWorth,
    accounts,
  });

  const onRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex h-full w-full flex-col">
      {/* Tab content — no more tab navigation, just the overview */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-5xl animate-in fade-in duration-300">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-500/30 border-t-cyan-400" />
            </div>
          ) : (
            <OverviewTab
              netWorth={netWorth}
              totalIncome={totalIncome}
              totalSpending={totalSpending}
              netCashflow={netCashflow}
              accounts={accounts}
              transactions={transactions}
              projection={projection}
              projectionInputs={projectionInputs}
              onInputsChange={setProjectionInputs}
              onRefresh={onRefresh}
            />
          )}
        </div>
      </div>
    </div>
  );
}
