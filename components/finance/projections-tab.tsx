'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { ProjectionInputs, ProjectionResult, FutureTransaction, TransferMode, SalaryAllocationByAge } from '@/lib/finance/projections';
import { SALARY_BANDS } from '@/lib/finance/projections';
import type { Account } from '@/lib/finance/types';
import { calculateUKTakeHomePay } from '@/lib/finance/uk-tax';
import { ISA_CONTRIBUTION_LIMIT } from '@/lib/finance/types';
import { insertFutureTransaction, deleteFutureTransaction } from '@/lib/finance/storage';

function fmt(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `£${(n / 1_000).toFixed(0)}K`;
  return `£${n.toFixed(0)}`;
}

function fmtSigned(n: number): string {
  const formatted = fmt(Math.abs(n));
  return n >= 0 ? `+${formatted}` : `−${formatted}`;
}

interface ProjectionsTabProps {
  inputs: ProjectionInputs;
  onInputsChange: (inputs: ProjectionInputs) => void;
  projection: ProjectionResult;
  netWorth: number;
  accounts: Account[];
}

export default function ProjectionsTab({
  inputs,
  onInputsChange,
  projection,
  netWorth,
  accounts,
}: ProjectionsTabProps) {
  // ── State ────────────────────────────────────────────────────────
  const [selectedAge, setSelectedAge] = useState<number | null>(null);
  const [salaryExpanded, setSalaryExpanded] = useState(true);
  const [newTxAccountId, setNewTxAccountId] = useState<string>('');
  const [newTxDesc, setNewTxDesc] = useState<string>('');
  const [newTxAmount, setNewTxAmount] = useState<string>('');
  // Transfer-specific state
  const [newTxIsTransfer, setNewTxIsTransfer] = useState(false);
  const [newTxToAccountId, setNewTxToAccountId] = useState<string>('');
  const [newTxTransferMode, setNewTxTransferMode] = useState<TransferMode>('fixed');
  const [newTxTransferValue, setNewTxTransferValue] = useState<string>('');

  // Reset form state (except selectedAge) for a fresh entry
  const resetForm = useCallback(() => {
    setNewTxAccountId('');
    setNewTxDesc('');
    setNewTxAmount('');
    setNewTxIsTransfer(false);
    setNewTxToAccountId('');
    setNewTxTransferMode('fixed');
    setNewTxTransferValue('');
  }, []);

  // When user selects an age on the chart
  const handleAgeSelect = useCallback((age: number) => {
    setSelectedAge(age);
    resetForm();
  }, [resetForm]);

  // ── Computed values ──────────────────────────────────────────────
  const chartData = useMemo(() => {
    return projection.years.map((y) => ({
      age: y.age,
      nominal: y.netWorth,
      adjusted: y.netWorthAdjusted,
      safeWithdrawal: Math.round(y.netWorth * 0.03),
      safeWithdrawalAdj: Math.round(y.netWorthAdjusted * 0.03),
    }));
  }, [projection]);

  function update<K extends keyof ProjectionInputs>(key: K, value: ProjectionInputs[K]) {
    onInputsChange({ ...inputs, [key]: value });
  }

  const addFutureTransaction = useCallback(() => {
    if (!newTxAccountId || !newTxDesc.trim() || selectedAge == null) return;

    const ft: FutureTransaction = {
      id: crypto.randomUUID(),
      accountId: newTxAccountId,
      age: selectedAge,
      description: newTxDesc.trim(),
      amount: 0,
    };

    if (newTxIsTransfer) {
      if (!newTxToAccountId || !newTxTransferValue) return;
      const val = parseFloat(newTxTransferValue);
      if (isNaN(val) || val <= 0) return;
      ft.toAccountId = newTxToAccountId;
      ft.transferMode = newTxTransferMode;
      ft.transferValue = val;
    } else {
      const amount = parseFloat(newTxAmount);
      if (isNaN(amount) || amount === 0) return;
      ft.amount = amount;
    }

    onInputsChange({
      ...inputs,
      futureTransactions: [...inputs.futureTransactions, ft],
    });

    // Persist to Supabase (fire-and-forget — local state is already updated)
    insertFutureTransaction({
      account_id: ft.accountId,
      age: ft.age,
      description: ft.description,
      amount: ft.amount,
      to_account_id: ft.toAccountId ?? null,
      transfer_mode: ft.transferMode ?? null,
      transfer_value: ft.transferValue ?? null,
    });

    // Reset form fields (keep age selected for quick repeats)
    setNewTxDesc('');
    setNewTxAmount('');
    setNewTxAccountId('');
    setNewTxIsTransfer(false);
    setNewTxToAccountId('');
    setNewTxTransferMode('fixed');
    setNewTxTransferValue('');
  }, [selectedAge, newTxAccountId, newTxDesc, newTxAmount, newTxIsTransfer, newTxToAccountId, newTxTransferMode, newTxTransferValue, inputs, onInputsChange]);

  const removeFutureTransaction = useCallback((id: string) => {
    onInputsChange({
      ...inputs,
      futureTransactions: inputs.futureTransactions.filter((ft) => ft.id !== id),
    });
    // Persist deletion to Supabase (fire-and-forget)
    deleteFutureTransaction(id);
  }, [inputs, onInputsChange]);

  // Account lookup map
  const accountMap = useMemo(() => {
    const map = new Map<string, Account>();
    for (const a of accounts) map.set(a.id, a);
    return map;
  }, [accounts]);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* ═══════════════ Controls Panel ═══════════════ */}
      <div className="space-y-4">
        {/* ── Age (read-only, set in Health page) ── */}
        <div className="group relative overflow-hidden rounded-xl border border-cyan-500/10 bg-zinc-900/60 p-3 backdrop-blur-xl">
          {/* Sheen hover effect */}
          <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-transparent" />
          <div className="relative flex items-center justify-between">
            <span className="bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-[9px] font-semibold tracking-[0.2em] text-transparent">CURRENT AGE</span>
            <span className="font-mono text-lg font-bold tracking-tight text-cyan-300 drop-shadow-[0_0_8px_rgba(34,211,238,0.3)]">{inputs.currentAge}</span>
          </div>
        </div>

        {/* ── Potential Salary with after-tax projections (collapsible) ── */}
        <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/40 backdrop-blur-xl transition-all duration-300">
          <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
          <button
            onClick={() => setSalaryExpanded(!salaryExpanded)}
            className="relative flex w-full items-center justify-between px-3 pt-3 pb-2 transition-colors hover:bg-zinc-800/20"
          >
            <span className="bg-gradient-to-r from-cyan-300/80 to-zinc-300/80 bg-clip-text text-[9px] font-semibold tracking-[0.2em] text-transparent transition-all duration-300 group-hover:from-cyan-300 group-hover:to-white">
              POTENTIAL SALARY
            </span>
            <svg
              className={`h-3 w-3 text-zinc-600 transition-transform duration-300 ${salaryExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <div className={`transition-all duration-300 ease-in-out ${
            salaryExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
          } overflow-hidden`}>
            <div className="px-3 pb-3">
              {/* Table with after-tax breakdown */}
              <div className="overflow-x-auto">
                <table className="w-full text-[9px]">
                  <thead>
                    <tr className="text-zinc-600">
                      <th className="pb-1 text-left font-medium">Stage</th>
                      <th className="pb-1 text-right font-medium">Base</th>
                      <th className="pb-1 text-right font-medium">Bonus (50%)</th>
                      <th className="pb-1 text-right font-medium">Gross</th>
                      <th className="pb-1 text-right font-medium text-emerald-400/70">After Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SALARY_BANDS.map((band) => {
                      const isCurrent =
                        inputs.currentAge >= band.minAge && inputs.currentAge < band.maxAge;
                      const isPast = inputs.currentAge > band.maxAge;

                      // Base salary = lower value of the band
                      const base = band.baseMin;
                      // Bonus = fixed 50% of base
                      const bonus = Math.round(base * 0.5);
                      const gross = base + bonus;
                      const tax = calculateUKTakeHomePay(gross);

                      return (
                        <tr
                          key={band.label}
                          className={`border-t border-zinc-800/50 transition-colors duration-200 ${
                            isCurrent
                              ? 'bg-cyan-950/20 text-cyan-200'
                              : isPast
                                ? 'text-zinc-600'
                                : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/20'
                          }`}
                        >
                          <td className="py-1 pr-2">
                            <div className="font-medium">
                              {band.label}
                              {isCurrent && (
                                <span className="ml-1 text-[7px] text-cyan-400">◄</span>
                              )}
                            </div>
                            <div className="text-[8px] text-zinc-600">age {band.minAge}–{band.maxAge}</div>
                          </td>
                          <td className="py-1 text-right font-mono text-zinc-400">
                            {fmt(base)}
                          </td>
                          <td className="py-1 text-right font-mono text-zinc-500">
                            {fmt(bonus)}
                          </td>
                          <td className="py-1 text-right font-mono text-zinc-300">
                            {fmt(gross)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            <span className={isCurrent ? 'text-emerald-400' : 'text-emerald-400/60'}>
                              {fmt(tax.netAnnual)}
                            </span>
                            <span className="ml-0.5 text-[7px] text-zinc-600">
                              ({tax.netMonthly > 1000
                                ? `£${(tax.netMonthly / 1000).toFixed(1)}K/mo`
                                : `£${Math.round(tax.netMonthly)}/mo`})
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Effective tax rate footnote */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-zinc-600">
                <span>Income tax + NI (employee) at each career stage.</span>
                <span>
                  Effective rate:{' '}
                  {(() => {
                    const lo = calculateUKTakeHomePay(SALARY_BANDS[0].baseMin + Math.round(SALARY_BANDS[0].baseMin * 0.5));
                    const hi = calculateUKTakeHomePay(SALARY_BANDS[3].baseMin + Math.round(SALARY_BANDS[3].baseMin * 0.5));
                    return `${lo.effectiveRate.toFixed(1)}% – ${hi.effectiveRate.toFixed(1)}%`;
                  })()}
                </span>
              </div>
              <p className="mt-1 text-[7px] leading-relaxed text-zinc-700">
                Base = lower band figure. Bonus = 50% of base (fixed). Calculated using UK 2024/25 income tax &amp; NI rules.
                Personal allowance taper applied above £100K. Post-tax salary is allocated to accounts per settings below.
              </p>
            </div>
          </div>
        </div>

        {/* ── Salary Allocation (per-age, shown when age selected on chart) ── */}
        {selectedAge != null ? (
          <SalaryAllocationSection
            age={selectedAge}
            inputs={inputs}
            update={update}
          />
        ) : (
          <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/40 p-3 backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] to-transparent" />
            <p className="relative mb-2 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-[9px] font-semibold tracking-[0.2em] text-transparent">
              SALARY ALLOCATION
            </p>
            <p className="relative text-[8px] leading-relaxed text-zinc-600">
              Click an age on the chart to customise how post-tax salary is split between ISA, Savings, and General Investments.
            </p>
          </div>
        )}

        {/* ── Yearly Expenses ── */}
        <div className="group relative overflow-hidden rounded-xl border border-rose-500/10 bg-zinc-900/40 p-3 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-rose-500/5 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-rose-500/[0.04] to-transparent" />
          <div className="relative flex items-center justify-between mb-2">
            <span className="bg-gradient-to-r from-rose-400 to-rose-300 bg-clip-text text-[9px] font-semibold tracking-[0.2em] text-transparent">
              YEARLY EXPENSES
            </span>
            <span className="font-mono text-[11px] text-rose-400/70">
              −{fmt(inputs.yearlyExpenses)}/yr
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={200_000}
            step={1000}
            value={inputs.yearlyExpenses}
            onChange={(e) => update('yearlyExpenses', Number(e.target.value))}
            className="relative w-full accent-rose-500"
          />
          <div className="relative mt-1 flex justify-between text-[8px] text-zinc-600">
            <span>£0</span>
            <span>£200K</span>
          </div>
          <p className="relative mt-1 text-[7px] leading-relaxed text-zinc-700">
            Annual living expenses deducted from your portfolio each year. This models your cost of living in retirement.
          </p>
        </div>

        {/* ── Summary stats ── */}
        <div className="group relative overflow-hidden rounded-xl border border-emerald-500/10 bg-zinc-900/40 p-3 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-emerald-500/5 to-transparent" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.04] to-transparent" />
          <p className="relative mb-2 bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-[9px] font-semibold tracking-[0.2em] text-transparent">OUTCOME</p>
          <div className="relative space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">Starting NW</span>
              <span className="font-mono text-zinc-300">{fmt(netWorth)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Projected at 45</span>
              <span className={`font-mono ${projection.targetMet ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]' : 'text-amber-400'}`}>
                {fmt(projection.finalNominal)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Inflation-adj.</span>
              <span className="font-mono text-zinc-300">{fmt(projection.finalAdjusted)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Target met?</span>
              <span className={projection.targetMet ? 'font-mono text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]' : 'font-mono text-red-400'}>
                {projection.targetMet ? 'YES ✓' : 'NO'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════ Chart Panel ═══════════════ */}
      <div className="group relative overflow-hidden rounded-xl border border-cyan-500/15 bg-zinc-900/70 p-5 backdrop-blur-xl">
        {/* Scan-line overlay */}
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.015) 2px, rgba(34,211,238,0.015) 4px)' }} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/[0.04] via-transparent to-emerald-500/[0.02]" />
        {/* Hover border glow */}
        <div className="pointer-events-none absolute -inset-px rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-700 bg-gradient-to-r from-cyan-500/15 via-transparent to-emerald-500/15" style={{ mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)', maskComposite: 'exclude' }} />
        <div className="relative mb-4 flex items-center justify-between">
          <span className="bg-gradient-to-r from-cyan-300 to-emerald-300 bg-clip-text text-[10px] font-semibold tracking-[0.15em] text-transparent">
            PORTFOLIO VALUE
          </span>
          <span className="text-[10px] text-zinc-600">Age {inputs.currentAge} → 45</span>
        </div>

        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">              <LineChart
                data={chartData}
                onClick={(state: any) => {
                  if (state?.activeLabel != null) {
                    handleAgeSelect(state.activeLabel as number);
                  }
                }}
                margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
              >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="age"
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: '#71717a', fontSize: 10 }}
              />
              <YAxis
                tickFormatter={(v: number) => fmtShort(v)}
                tick={{ fill: '#71717a', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(24,24,27,0.95)',
                  border: '1px solid rgba(113,113,122,0.3)',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={(value, name) => {
                  const v = typeof value === 'number' ? value : 0;
                  return [fmt(v), name];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }}
              />
              <Line
                type="monotone"
                dataKey="nominal"
                name="Portfolio Value"
                stroke="#22d3ee"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#22d3ee' }}
              />
              <Line
                type="monotone"
                dataKey="adjusted"
                name="Inflation-Adjusted"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4, fill: '#f59e0b' }}
              />
              <Line
                type="monotone"
                dataKey="safeWithdrawal"
                name="Safe Withdrawal (3%)"
                stroke="#a78bfa"
                strokeWidth={1.5}
                strokeDasharray="3 3"
                dot={false}
                activeDot={{ r: 3, fill: '#a78bfa' }}
              />
              <Line
                type="monotone"
                dataKey="safeWithdrawalAdj"
                name="SW Infl-Adjusted"
                stroke="#a78bfa"
                strokeWidth={1.5}
                strokeDasharray="1 4"
                dot={false}
                opacity={0.6}
                activeDot={{ r: 3, fill: '#a78bfa' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Corner brackets */}
        <div className="pointer-events-none absolute left-3 top-3 h-4 w-4 border-l border-t border-cyan-500/20" />
        <div className="pointer-events-none absolute right-3 top-3 h-4 w-4 border-r border-t border-cyan-500/20" />
        <div className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 border-b border-l border-cyan-500/20" />
        <div className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 border-b border-r border-cyan-500/20" />

        {/* Milestone markers */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="text-[9px] tracking-wider text-zinc-600">MILESTONES:</span>
          {projection.milestones.map((m) => (
            <span
              key={m.amount}
              className={`rounded-full px-2 py-0.5 text-[9px] font-mono transition-all duration-300 ${
                m.age
                  ? 'bg-amber-950/30 text-amber-400/70 hover:bg-amber-950/50 hover:text-amber-300 hover:shadow-[0_0_8px_rgba(251,191,36,0.15)]'
                  : 'bg-zinc-800/50 text-zinc-600'
              }`}
            >
              {fmtShort(m.amount)}{m.age ? ` @${m.age}` : ' ✕'}
            </span>
          ))}
        </div>

        {/* ── Future Transaction Form (shown when age is selected on chart) ── */}
        {selectedAge != null && (
          <div className="mt-6 rounded-lg border border-zinc-700/30 bg-zinc-800/20 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-[0.15em] text-zinc-500">
                EVENT AT AGE {selectedAge}
              </span>
              <button
                onClick={() => { setSelectedAge(null); resetForm(); }}
                className="text-[10px] text-zinc-600 hover:text-zinc-400 underline underline-offset-2"
              >
                Close
              </button>
            </div>

            {/* Existing events at this age */}
            {(() => {
              const ageEvents = inputs.futureTransactions.filter(
                (ft) => ft.age === selectedAge,
              );
              if (ageEvents.length === 0) return null;
              return (
                <div className="mb-3 space-y-1">
                  <p className="text-[9px] text-zinc-600 mb-1">Scheduled events at this age:</p>
                  {ageEvents.map((ft) => {
                    const srcAcct = accountMap.get(ft.accountId);
                    const dstAcct = ft.toAccountId ? accountMap.get(ft.toAccountId) : null;
                    return (
                      <div
                        key={ft.id}
                        className="group flex items-center justify-between rounded bg-zinc-800/40 px-2 py-1.5 text-[10px]"
                      >
                        <div className="min-w-0 flex-1">
                          {ft.toAccountId && ft.transferMode ? (
                            <>
                              <span className="text-amber-300">{ft.description}</span>
                              <span className="mx-1 text-zinc-600">·</span>
                              <span className="text-zinc-500">
                                {srcAcct?.name ?? '?'} → {dstAcct?.name ?? '?'}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="text-zinc-300">{ft.description}</span>
                              <span className="mx-1 text-zinc-600">·</span>
                              <span className="text-zinc-500">{srcAcct?.name ?? 'Unknown'}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {ft.toAccountId && ft.transferMode ? (
                            <span className="font-mono text-amber-400">
                              {ft.transferMode === 'fixed' && `£${ft.transferValue?.toLocaleString('en-GB')}`}
                              {ft.transferMode === 'percent' && `${ft.transferValue}%`}
                              {ft.transferMode === 'above_threshold' && `>£${ft.transferValue?.toLocaleString('en-GB')}`}
                            </span>
                          ) : (
                            <span className={`font-mono ${ft.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {fmtSigned(ft.amount)}
                            </span>
                          )}
                          <button
                            onClick={() => removeFutureTransaction(ft.id)}
                            className="text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* ── Add form ── */}
            <div className="space-y-2">
              {/* Toggle: Income/Expense vs Transfer */}
              <div className="flex gap-1 rounded border border-zinc-700/30 p-0.5">
                <button
                  type="button"
                  onClick={() => { setNewTxIsTransfer(false); setNewTxToAccountId(''); setNewTxTransferValue(''); }}
                  className={`flex-1 rounded px-2 py-1 text-[9px] font-medium transition-colors ${
                    !newTxIsTransfer
                      ? 'bg-cyan-800/40 text-cyan-300'
                      : 'text-zinc-500 hover:text-zinc-400'
                  }`}
                >
                  Income/Expense
                </button>
                <button
                  type="button"
                  onClick={() => { setNewTxIsTransfer(true); setNewTxAmount(''); }}
                  className={`flex-1 rounded px-2 py-1 text-[9px] font-medium transition-colors ${
                    newTxIsTransfer
                      ? 'bg-amber-800/40 text-amber-300'
                      : 'text-zinc-500 hover:text-zinc-400'
                  }`}
                >
                  Transfer
                </button>
              </div>

              {/* Account */}
              <div>
                <label className="mb-0.5 block text-[9px] text-zinc-600">
                  {newTxIsTransfer ? 'Source Account' : 'Account'}
                </label>
                <select
                  value={newTxAccountId}
                  onChange={(e) => setNewTxAccountId(e.target.value)}
                  className="w-full rounded border border-zinc-700/40 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 outline-none focus:border-cyan-600"
                >
                  <option value="">Select…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="mb-0.5 block text-[9px] text-zinc-600">Description</label>
                <input
                  value={newTxDesc}
                  onChange={(e) => setNewTxDesc(e.target.value)}
                  placeholder={newTxIsTransfer ? "e.g. Sweep to savings" : "e.g. Bonus, car purchase"}
                  className="w-full rounded border border-zinc-700/40 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-cyan-600"
                />
              </div>

              {newTxIsTransfer ? (
                /* ══ Transfer form ══ */
                <>
                  {/* Destination account */}
                  <div>
                    <label className="mb-0.5 block text-[9px] text-zinc-600">Destination Account</label>
                    <select
                      value={newTxToAccountId}
                      onChange={(e) => setNewTxToAccountId(e.target.value)}
                      className="w-full rounded border border-zinc-700/40 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 outline-none focus:border-amber-600"
                    >
                      <option value="">Select…</option>
                      {accounts
                        .filter((a) => a.id !== newTxAccountId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  {/* Transfer mode selector */}
                  <div className="grid grid-cols-3 gap-1">
                    {(['fixed', 'percent', 'above_threshold'] as TransferMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setNewTxTransferMode(mode)}
                        className={`rounded px-1.5 py-1 text-[8px] font-medium transition-colors ${
                          newTxTransferMode === mode
                            ? 'bg-amber-800/40 text-amber-300'
                            : 'bg-zinc-800 text-zinc-500 hover:text-zinc-400'
                        }`}
                      >
                        {mode === 'fixed' && 'Fixed £'}
                        {mode === 'percent' && '% of acct'}
                        {mode === 'above_threshold' && 'Above £'}
                      </button>
                    ))}
                  </div>

                  {/* Transfer value */}
                  <div>
                    <label className="mb-0.5 block text-[9px] text-zinc-600">
                      {newTxTransferMode === 'fixed' && 'Amount to transfer (£)'}
                      {newTxTransferMode === 'percent' && 'Percentage of source balance'}
                      {newTxTransferMode === 'above_threshold' && 'Keep this amount, transfer the rest'}
                    </label>
                    <div className="relative">
                      {newTxTransferMode !== 'percent' && (
                        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">£</span>
                      )}
                      <input
                        type="number"
                        step={newTxTransferMode === 'percent' ? '1' : '0.01'}
                        min={0}
                        max={newTxTransferMode === 'percent' ? 100 : undefined}
                        value={newTxTransferValue}
                        onChange={(e) => setNewTxTransferValue(e.target.value)}
                        placeholder={newTxTransferMode === 'percent' ? 'e.g. 50' : '0.00'}
                        className={`w-full rounded border border-zinc-700/40 bg-zinc-900 py-1 text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-amber-600 ${
                          newTxTransferMode !== 'percent' ? 'pl-5 pr-2' : 'px-2'
                        }`}
                      />
                      {newTxTransferMode === 'percent' && (
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">%</span>
                      )}
                    </div>
                    {newTxTransferMode === 'above_threshold' && (
                      <p className="mt-0.5 text-[8px] text-zinc-600">
                        Transfers everything above this amount from the source account
                      </p>
                    )}
                  </div>
                </>
              ) : (
                /* ══ Income/Expense form ══ */
                <div>
                  <label className="mb-0.5 block text-[9px] text-zinc-600">Amount</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">£</span>
                    <input
                      type="number"
                      step="0.01"
                      value={newTxAmount}
                      onChange={(e) => setNewTxAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded border border-zinc-700/40 bg-zinc-900 pl-5 pr-2 py-1 text-[10px] text-zinc-300 outline-none placeholder:text-zinc-700 focus:border-cyan-600"
                    />
                  </div>
                  <p className="mt-0.5 text-[8px] text-zinc-600">Positive = income, negative = expense</p>
                </div>
              )}

              <button
                onClick={addFutureTransaction}
                disabled={
                  !newTxAccountId || !newTxDesc.trim() ||
                  (newTxIsTransfer
                    ? (!newTxToAccountId || !newTxTransferValue)
                    : (!newTxAmount))
                }
                className={`w-full rounded py-1.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                  newTxIsTransfer
                    ? 'bg-amber-700/40 text-amber-300 hover:bg-amber-700/60'
                    : 'bg-cyan-700/40 text-cyan-300 hover:bg-cyan-700/60'
                }`}
              >
                + Add {newTxIsTransfer ? 'Transfer' : 'Transaction'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ Per-age Salary Allocation Panel (virtual ISA Savings + General Investments) ════════

function SalaryAllocationSection({
  age,
  inputs,
  update,
}: {
  age: number;
  inputs: ProjectionInputs;
  update: <K extends keyof ProjectionInputs>(key: K, value: ProjectionInputs[K]) => void;
}) {
  // Get the current allocation entry for this age (if any)
  const ageEntry = inputs.salaryAllocationsByAge.find((e) => e.age === age);
  const salaryOverride = ageEntry?.salaryOverride;

  const isaPct = ageEntry?.isaPct ?? 33;
  const savingsPct = ageEntry?.savingsPct ?? 33;
  const generalPct = ageEntry?.generalInvestmentsPct ?? 34;

  // Calculated salary from career band
  const salaryBand = SALARY_BANDS.find((b) => age >= b.minAge && age < b.maxAge);
  const bandGross = salaryBand
    ? salaryBand.baseMin + Math.round(salaryBand.baseMin * 0.5)
    : 0;

  // Use salary override if set, otherwise use band calculation
  const effectiveGross = salaryOverride ?? bandGross;
  const taxBreakdown = effectiveGross > 0 ? calculateUKTakeHomePay(effectiveGross) : null;
  const postTaxAnnual = taxBreakdown?.netAnnual ?? 0;

  // ── Helpers ──

  function saveAllocation(isa: number, savings: number, general: number) {
    const existing = inputs.salaryAllocationsByAge.filter((e) => e.age !== age);
    const entry: SalaryAllocationByAge = { age, isaPct: isa, savingsPct: savings, generalInvestmentsPct: general };
    if (salaryOverride != null) entry.salaryOverride = salaryOverride;
    update('salaryAllocationsByAge', [...existing, entry]);
  }

  function setSalaryOverride(gross: number | null) {
    const existing = inputs.salaryAllocationsByAge.filter((e) => e.age !== age);
    const entry: SalaryAllocationByAge = { age, isaPct, savingsPct, generalInvestmentsPct: generalPct };
    if (gross != null) entry.salaryOverride = gross;
    update('salaryAllocationsByAge', [...existing, entry]);
  }

  const totalPct = isaPct + savingsPct + generalPct;
  const isBalanced = Math.abs(totalPct - 100) < 0.5;

  // ISA cap
  const maxIsaPct = postTaxAnnual > 0
    ? Math.min(100, Math.round((ISA_CONTRIBUTION_LIMIT / postTaxAnnual) * 100))
    : 100;
  const clampedIsaPct = Math.min(isaPct, maxIsaPct);
  const isaAmount = Math.round(postTaxAnnual * (clampedIsaPct / 100));
  const savingsAmount = Math.round(postTaxAnnual * (savingsPct / 100));
  const generalAmount = Math.round(postTaxAnnual * (generalPct / 100));

  // ── Render ──

  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-700/20 bg-zinc-900/40 p-3 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] to-transparent" />
      <p className="relative mb-2 bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-[10px] font-semibold tracking-[0.15em] text-transparent">
        SALARY ALLOCATION <span className="text-cyan-400">@AGE {age}</span>
      </p>

      {/* Salary input / display */}
      <div className="mb-3 rounded border border-zinc-700/30 bg-zinc-900/40 p-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-600">Gross Salary/yr</span>
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600">£</span>
            <input
              type="number"
              step="1000"
              value={effectiveGross}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val) && val >= 0) setSalaryOverride(val);
              }}
              className="w-full rounded border border-zinc-700/40 bg-zinc-900 py-1 pl-5 pr-2 text-[11px] font-mono text-cyan-300 outline-none focus:border-cyan-600"
            />
          </div>
          {salaryBand && salaryOverride == null && (
            <span className="shrink-0 text-[8px] text-zinc-700">
              {salaryBand.label}
            </span>
          )}
          {salaryOverride != null && (
            <button
              onClick={() => setSalaryOverride(null)}
              className="shrink-0 text-[8px] text-zinc-600 underline underline-offset-2 hover:text-zinc-400"
            >
              Reset to band
            </button>
          )}
        </div>

        {taxBreakdown && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px]">
            <span className="text-zinc-600">
              Tax:{' '}
              <span className="text-red-400/70">{fmt(taxBreakdown.incomeTax)}</span>
            </span>
            <span className="text-zinc-600">
              NI:{' '}
              <span className="text-red-400/70">{fmt(taxBreakdown.nationalInsurance)}</span>
            </span>
            <span className="text-zinc-600">
              Net:{' '}
              <span className="text-emerald-400">{fmt(taxBreakdown.netAnnual)}/yr</span>
            </span>
            <span className="text-zinc-600">
              <span className="text-emerald-400/70">{fmt(taxBreakdown.netMonthly)}/mo</span>
            </span>
            <span className="text-zinc-700">
              Effective: {taxBreakdown.effectiveRate.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* ── ISA slider ── */}
      <div className="mb-2 rounded border border-zinc-700/20 bg-blue-950/10 p-2">
        <div className="flex items-center gap-2">
          <span className="w-24 text-[10px] font-medium text-blue-400">
            ISA
            <span className="ml-1 text-[7px] text-blue-700">4%</span>
          </span>
          <div className="flex-1">
            <input
              type="range"
              min={0}
              max={maxIsaPct}
              step={1}
              value={clampedIsaPct}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                const newIsa = Math.min(raw, maxIsaPct);
                const remaining = 100 - newIsa;
                const newSavings = Math.round(remaining / 2);
                const newGeneral = remaining - newSavings;
                saveAllocation(newIsa, newSavings, newGeneral);
              }}
              className="w-full accent-blue-500"
            />
          </div>
          <span className="w-8 text-right font-mono text-[10px] text-blue-400">
            {clampedIsaPct}%
          </span>
          {isaAmount > 0 && (
            <span className="w-16 text-right font-mono text-[8px] text-blue-300/50">
              {fmtShort(isaAmount)}
            </span>
          )}
          <span className="w-12 text-right text-[7px] text-zinc-700">
            max £20K
          </span>
        </div>
      </div>

      {/* ── Savings slider ── */}
      <div className="mb-2 rounded border border-zinc-700/20 bg-teal-950/10 p-2">
        <div className="flex items-center gap-2">
          <span className="w-24 text-[10px] font-medium text-teal-400">
            Savings
            <span className="ml-1 text-[7px] text-teal-700">4.5%</span>
          </span>
          <div className="flex-1">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={savingsPct}
              onChange={(e) => {
                const newSavings = parseFloat(e.target.value);
                const remaining = 100 - newSavings;
                const newIsa = Math.min(Math.round(remaining / 2), maxIsaPct);
                const newGeneral = remaining - newIsa;
                saveAllocation(newIsa, newSavings, newGeneral);
              }}
              className="w-full accent-teal-500"
            />
          </div>
          <span className="w-8 text-right font-mono text-[10px] text-teal-400">
            {savingsPct}%
          </span>
          {savingsAmount > 0 && (
            <span className="w-16 text-right font-mono text-[8px] text-teal-300/50">
              {fmtShort(savingsAmount)}
            </span>
          )}
        </div>
      </div>

      {/* ── General Investments slider ── */}
      <div className="mb-2 rounded border border-zinc-700/20 bg-emerald-950/10 p-2">
        <div className="flex items-center gap-2">
          <span className="w-24 text-[10px] font-medium text-emerald-400">
            Investments
            <span className="ml-1 text-[7px] text-emerald-700">7%</span>
          </span>
          <div className="flex-1">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={generalPct}
              onChange={(e) => {
                const newGeneral = parseFloat(e.target.value);
                const remaining = 100 - newGeneral;
                const newIsa = Math.min(Math.round(remaining / 2), maxIsaPct);
                const newSavings = remaining - newIsa;
                saveAllocation(newIsa, newSavings, newGeneral);
              }}
              className="w-full accent-emerald-500"
            />
          </div>
          <span className="w-8 text-right font-mono text-[10px] text-emerald-400">
            {generalPct}%
          </span>
          {generalAmount > 0 && (
            <span className="w-16 text-right font-mono text-[8px] text-emerald-300/50">
              {fmtShort(generalAmount)}
            </span>
          )}
        </div>
      </div>

      <div className={`text-[9px] ${isBalanced ? 'text-emerald-500/70' : 'text-red-400'}`}>
        Total: {Math.round(totalPct)}%
        {isBalanced ? ' ✓' : ' — must sum to 100%'}
      </div>
      {ageEntry == null && (
        <p className="mt-1 text-[8px] text-zinc-600">
          No custom allocation set for age {age} — defaults to 33/33/34 split.
        </p>
      )}
    </div>
  );
}
