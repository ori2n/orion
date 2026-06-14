'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { ProjectionInputs, ProjectionResult, SalaryAllocationByAge } from '@/lib/finance/projections';
import { SALARY_BANDS } from '@/lib/finance/projections';
import { calculateUKTakeHomePay } from '@/lib/finance/uk-tax';
import { ISA_CONTRIBUTION_LIMIT } from '@/lib/finance/types';

function fmt(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function fmtShort(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `£${(n / 1_000).toFixed(0)}K`;
  return `£${n.toFixed(0)}`;
}

interface PortfolioValueWidgetProps {
  inputs: ProjectionInputs;
  onInputsChange: (inputs: ProjectionInputs) => void;
  projection: ProjectionResult;
  netWorth: number;
}

export default function PortfolioValueWidget({ inputs, onInputsChange, projection, netWorth }: PortfolioValueWidgetProps) {
  const [salaryExpanded, setSalaryExpanded] = useState(true);
  const [allocationExpanded, setAllocationExpanded] = useState(false);
  const [expensesExpanded, setExpensesExpanded] = useState(true);
  const [selectedAge, setSelectedAge] = useState<number | null>(null);

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

  return (
    <div className="group relative overflow-hidden rounded-xl border border-cyan-500/15 bg-zinc-900/70 backdrop-blur-xl">
      {/* Scan-line overlay */}
      <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.015) 2px, rgba(34,211,238,0.015) 4px)' }} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-500/[0.04] via-transparent to-emerald-500/[0.02]" />
      {/* Sheen */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full skew-x-12 opacity-0 transition-all duration-700 group-hover:translate-x-0 group-hover:opacity-100 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent" />

      <div className="relative px-4 pt-4 pb-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="bg-gradient-to-r from-cyan-300 to-emerald-300 bg-clip-text text-[10px] font-semibold tracking-[0.15em] text-transparent">
            PORTFOLIO VALUE
          </span>
          <span className="text-[10px] text-zinc-600">Age {inputs.currentAge} → {inputs.targetAge}</span>
        </div>

        {/* Chart */}
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              onClick={(state: any) => {
                if (state?.activeLabel != null) setSelectedAge(state.activeLabel as number);
              }}
              margin={{ top: 10, right: 20, left: 10, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="age" tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: '#71717a', fontSize: 10 }} />
              <YAxis tickFormatter={(v: number) => fmtShort(v)} tick={{ fill: '#71717a', fontSize: 11 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.08)' }} />
              <Tooltip contentStyle={{ background: 'rgba(24,24,27,0.95)', border: '1px solid rgba(113,113,122,0.3)', borderRadius: '8px', fontSize: '12px' }} labelStyle={{ color: '#a1a1aa' }} formatter={(value, name) => { const v = typeof value === 'number' ? value : 0; return [fmt(v), name]; }} />
              <Legend wrapperStyle={{ fontSize: '11px', color: '#a1a1aa' }} />
              <Line type="monotone" dataKey="nominal" name="Portfolio Value" stroke="#22d3ee" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#22d3ee' }} />
              <Line type="monotone" dataKey="adjusted" name="Inflation-Adjusted" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} activeDot={{ r: 4, fill: '#f59e0b' }} />
              <Line type="monotone" dataKey="safeWithdrawal" name="Safe Withdrawal (3%)" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="3 3" dot={false} activeDot={{ r: 3, fill: '#a78bfa' }} />
              <Line type="monotone" dataKey="safeWithdrawalAdj" name="SW Infl-Adjusted" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="1 4" dot={false} opacity={0.6} activeDot={{ r: 3, fill: '#a78bfa' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Corner brackets */}
        <div className="pointer-events-none absolute left-3 top-3 h-4 w-4 border-l border-t border-cyan-500/20" />
        <div className="pointer-events-none absolute right-3 top-3 h-4 w-4 border-r border-t border-cyan-500/20" />
        <div className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 border-b border-l border-cyan-500/20" />
        <div className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 border-b border-r border-cyan-500/20" />

        {/* Milestones */}
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[9px] tracking-wider text-zinc-600">MILESTONES:</span>
          {projection.milestones.map((m) => (
            <span key={m.amount}
              className={`rounded-full px-2 py-0.5 text-[9px] font-mono transition-all duration-300 ${
                m.age
                  ? 'bg-amber-950/30 text-amber-400/70 hover:bg-amber-950/50 hover:text-amber-300 hover:shadow-[0_0_8px_rgba(251,191,36,0.15)]'
                  : 'bg-zinc-800/50 text-zinc-600'
              }`}>
              {fmtShort(m.amount)}{m.age ? ` @${m.age}` : ' ✕'}
            </span>
          ))}
        </div>
      </div>

      {/* ── Collapsible: Potential Salary ── */}
      <div className="relative border-t border-zinc-800/30">
        <button onClick={() => setSalaryExpanded(!salaryExpanded)}
          className="flex w-full items-center justify-between px-4 py-2.5 transition-colors hover:bg-zinc-800/20">
          <span className="text-[9px] font-semibold tracking-[0.15em] text-zinc-500">POTENTIAL SALARY</span>
          <svg className={`h-3 w-3 text-zinc-600 transition-transform duration-300 ${salaryExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div className={`transition-all duration-300 ease-in-out ${salaryExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
          <div className="px-4 pb-3">
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
                  const isCurrent = inputs.currentAge >= band.minAge && inputs.currentAge < band.maxAge;
                  const isPast = inputs.currentAge > band.maxAge;
                  const base = band.baseMin;
                  const bonus = Math.round(base * 0.5);
                  const gross = base + bonus;
                  const tax = calculateUKTakeHomePay(gross);
                  return (
                    <tr key={band.label}
                      className={`border-t border-zinc-800/50 transition-colors duration-200 ${
                        isCurrent ? 'bg-cyan-950/20 text-cyan-200' : isPast ? 'text-zinc-600' : 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/20'
                      }`}>
                      <td className="py-1 pr-2">
                        <div className="font-medium">{band.label}{isCurrent && <span className="ml-1 text-[7px] text-cyan-400">◄</span>}</div>
                        <div className="text-[8px] text-zinc-600">age {band.minAge}–{band.maxAge}</div>
                      </td>
                      <td className="py-1 text-right font-mono text-zinc-400">{fmt(base)}</td>
                      <td className="py-1 text-right font-mono text-zinc-500">{fmt(bonus)}</td>
                      <td className="py-1 text-right font-mono text-zinc-300">{fmt(gross)}</td>
                      <td className="py-1 text-right font-mono">
                        <span className={isCurrent ? 'text-emerald-400' : 'text-emerald-400/60'}>{fmt(tax.netAnnual)}</span>
                        <span className="ml-0.5 text-[7px] text-zinc-600">
                          ({tax.netMonthly > 1000 ? `£${(tax.netMonthly / 1000).toFixed(1)}K/mo` : `£${Math.round(tax.netMonthly)}/mo`})
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[8px] text-zinc-600">
              <span>Income tax + NI (employee) at each career stage.</span>
              <span>Effective rate: {(() => {
                const lo = calculateUKTakeHomePay(SALARY_BANDS[0].baseMin + Math.round(SALARY_BANDS[0].baseMin * 0.5));
                const hi = calculateUKTakeHomePay(SALARY_BANDS[3].baseMin + Math.round(SALARY_BANDS[3].baseMin * 0.5));
                return `${lo.effectiveRate.toFixed(1)}% – ${hi.effectiveRate.toFixed(1)}%`;
              })()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Collapsible: Salary Allocation ── */}
      <div className="relative border-t border-zinc-800/30">
        <button onClick={() => setAllocationExpanded(!allocationExpanded)}
          className="flex w-full items-center justify-between px-4 py-2.5 transition-colors hover:bg-zinc-800/20">
          <span className="text-[9px] font-semibold tracking-[0.15em] text-zinc-500">
            SALARY ALLOCATION {selectedAge != null && <span className="text-cyan-400">@AGE {selectedAge}</span>}
          </span>
          <svg className={`h-3 w-3 text-zinc-600 transition-transform duration-300 ${allocationExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <div className={`transition-all duration-300 ease-in-out ${allocationExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
          <div className="px-4 pb-3">
            {selectedAge != null ? (
              <SalaryAllocationInline age={selectedAge} inputs={inputs} update={update} />
            ) : (
              <p className="text-[8px] leading-relaxed text-zinc-600">
                Click an age on the chart above to customise how post-tax salary is split between ISA, Savings, and General Investments.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Collapsible: Yearly Expenses ── */}
      <div className="relative border-t border-zinc-800/30">
        <button onClick={() => setExpensesExpanded(!expensesExpanded)}
          className="flex w-full items-center justify-between px-4 py-2.5 transition-colors hover:bg-zinc-800/20">
          <span className="text-[9px] font-semibold tracking-[0.15em] text-zinc-500">YEARLY EXPENSES</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-rose-400/70">−{fmt(inputs.yearlyExpenses)}/yr</span>
            <svg className={`h-3 w-3 text-zinc-600 transition-transform duration-300 ${expensesExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </div>
        </button>
        <div className={`transition-all duration-300 ease-in-out ${expensesExpanded ? 'max-h-[200px] opacity-100' : 'max-h-0 opacity-0'} overflow-hidden`}>
          <div className="px-4 pb-3 space-y-2">
            <input type="range" min={0} max={200_000} step={1000} value={inputs.yearlyExpenses}
              onChange={(e) => update('yearlyExpenses', Number(e.target.value))}
              className="w-full accent-rose-500" />
            <div className="flex justify-between text-[8px] text-zinc-600">
              <span>£0</span>
              <span>£200K</span>
            </div>
            <p className="text-[7px] leading-relaxed text-zinc-700">
              Annual living expenses deducted from your portfolio each year. This models your cost of living in retirement.
            </p>
          </div>
        </div>
      </div>

      {/* ── Outcome summary ── */}
      <div className="relative border-t border-zinc-800/30 px-4 py-3">
        <div className="grid grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-[9px] text-zinc-500">Starting NW</p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-300">{fmt(netWorth)}</p>
          </div>
          <div>
            <p className="text-[9px] text-zinc-500">Projected at {inputs.targetAge}</p>
            <p className={`mt-0.5 font-mono text-[11px] ${projection.targetMet ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]' : 'text-amber-400'}`}>
              {fmt(projection.finalNominal)}
            </p>
          </div>
          <div>
            <p className="text-[9px] text-zinc-500">Inflation-adj.</p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-300">{fmt(projection.finalAdjusted)}</p>
          </div>
          <div>
            <p className="text-[9px] text-zinc-500">Target met?</p>
            <p className={`mt-0.5 font-mono text-[11px] ${projection.targetMet ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.3)]' : 'text-red-400'}`}>
              {projection.targetMet ? 'YES ✓' : 'NO'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══ Inline Salary Allocation (extracted from projections tab) ═══════

function SalaryAllocationInline({
  age, inputs, update,
}: {
  age: number;
  inputs: ProjectionInputs;
  update: <K extends keyof ProjectionInputs>(key: K, value: ProjectionInputs[K]) => void;
}) {
  const ageEntry = inputs.salaryAllocationsByAge.find((e) => e.age === age);
  const salaryOverride = ageEntry?.salaryOverride;

  const isaPct = ageEntry?.isaPct ?? 33;
  const savingsPct = ageEntry?.savingsPct ?? 33;
  const generalPct = ageEntry?.generalInvestmentsPct ?? 34;

  const salaryBand = SALARY_BANDS.find((b) => age >= b.minAge && age < b.maxAge);
  const bandGross = salaryBand ? salaryBand.baseMin + Math.round(salaryBand.baseMin * 0.5) : 0;
  const effectiveGross = salaryOverride ?? bandGross;
  const taxBreakdown = effectiveGross > 0 ? calculateUKTakeHomePay(effectiveGross) : null;
  const postTaxAnnual = taxBreakdown?.netAnnual ?? 0;

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

  const maxIsaPct = postTaxAnnual > 0
    ? Math.min(100, Math.round((ISA_CONTRIBUTION_LIMIT / postTaxAnnual) * 100))
    : 100;
  const clampedIsaPct = Math.min(isaPct, maxIsaPct);
  const isaAmount = Math.round(postTaxAnnual * (clampedIsaPct / 100));
  const savingsAmount = Math.round(postTaxAnnual * (savingsPct / 100));
  const generalAmount = Math.round(postTaxAnnual * (generalPct / 100));

  return (
    <div className="space-y-2">
      {/* Salary input */}
      <div className="flex items-center gap-2 rounded border border-zinc-700/30 bg-zinc-900/40 p-2">
        <span className="text-[9px] text-zinc-600">Gross/yr</span>
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 text-[9px] text-zinc-600">£</span>
          <input type="number" step="1000" value={effectiveGross}
            onChange={(e) => { const val = parseFloat(e.target.value); if (!isNaN(val) && val >= 0) setSalaryOverride(val); }}
            className="w-full rounded border border-zinc-700/40 bg-zinc-900 py-1 pl-4 pr-2 text-[10px] font-mono text-cyan-300 outline-none focus:border-cyan-600" />
        </div>
        {salaryOverride != null && (
          <button onClick={() => setSalaryOverride(null)} className="text-[8px] text-zinc-600 underline hover:text-zinc-400">Reset</button>
        )}
      </div>

      {taxBreakdown && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[8px]">
          <span className="text-zinc-600">Tax: <span className="text-red-400/70">{fmt(taxBreakdown.incomeTax)}</span></span>
          <span className="text-zinc-600">NI: <span className="text-red-400/70">{fmt(taxBreakdown.nationalInsurance)}</span></span>
          <span className="text-zinc-600">Net: <span className="text-emerald-400">{fmt(taxBreakdown.netAnnual)}/yr</span></span>
          <span className="text-zinc-600"><span className="text-emerald-400/70">{fmt(taxBreakdown.netMonthly)}/mo</span></span>
        </div>
      )}

      {/* ISA slider */}
      <div className="rounded border border-zinc-700/20 bg-blue-950/10 p-2">
        <div className="flex items-center gap-2">
          <span className="w-20 text-[9px] font-medium text-blue-400">ISA <span className="text-[6px] text-blue-700">4%</span></span>
          <div className="flex-1">
            <input type="range" min={0} max={maxIsaPct} step={1} value={clampedIsaPct}
              onChange={(e) => {
                const raw = parseFloat(e.target.value);
                const newIsa = Math.min(raw, maxIsaPct);
                const remaining = 100 - newIsa;
                saveAllocation(newIsa, Math.round(remaining / 2), remaining - Math.round(remaining / 2));
              }}
              className="w-full accent-blue-500" />
          </div>
          <span className="w-8 text-right font-mono text-[9px] text-blue-400">{clampedIsaPct}%</span>
          {isaAmount > 0 && <span className="w-14 text-right font-mono text-[8px] text-blue-300/50">{fmtShort(isaAmount)}</span>}
          <span className="text-[7px] text-zinc-700">max £20K</span>
        </div>
      </div>

      {/* Savings slider */}
      <div className="rounded border border-zinc-700/20 bg-teal-950/10 p-2">
        <div className="flex items-center gap-2">
          <span className="w-20 text-[9px] font-medium text-teal-400">Savings <span className="text-[6px] text-teal-700">4.5%</span></span>
          <div className="flex-1">
            <input type="range" min={0} max={100} step={1} value={savingsPct}
              onChange={(e) => {
                const newSavings = parseFloat(e.target.value);
                const remaining = 100 - newSavings;
                const newIsa = Math.min(Math.round(remaining / 2), maxIsaPct);
                saveAllocation(newIsa, newSavings, remaining - newIsa);
              }}
              className="w-full accent-teal-500" />
          </div>
          <span className="w-8 text-right font-mono text-[9px] text-teal-400">{savingsPct}%</span>
          {savingsAmount > 0 && <span className="w-14 text-right font-mono text-[8px] text-teal-300/50">{fmtShort(savingsAmount)}</span>}
        </div>
      </div>

      {/* General Investments slider */}
      <div className="rounded border border-zinc-700/20 bg-emerald-950/10 p-2">
        <div className="flex items-center gap-2">
          <span className="w-20 text-[9px] font-medium text-emerald-400">Investments <span className="text-[6px] text-emerald-700">7%</span></span>
          <div className="flex-1">
            <input type="range" min={0} max={100} step={1} value={generalPct}
              onChange={(e) => {
                const newGeneral = parseFloat(e.target.value);
                const remaining = 100 - newGeneral;
                const newIsa = Math.min(Math.round(remaining / 2), maxIsaPct);
                saveAllocation(newIsa, remaining - newIsa, newGeneral);
              }}
              className="w-full accent-emerald-500" />
          </div>
          <span className="w-8 text-right font-mono text-[9px] text-emerald-400">{generalPct}%</span>
          {generalAmount > 0 && <span className="w-14 text-right font-mono text-[8px] text-emerald-300/50">{fmtShort(generalAmount)}</span>}
        </div>
      </div>

      <div className={`text-[9px] ${isBalanced ? 'text-emerald-500/70' : 'text-red-400'}`}>
        Total: {Math.round(totalPct)}%{isBalanced ? ' ✓' : ' — must sum to 100%'}
      </div>
    </div>
  );
}
