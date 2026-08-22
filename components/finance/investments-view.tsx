'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fmtCurrency, fmtPercent, fmtDecimal, calculateAge } from '@/lib/finance/format';
import { listHoldings, calculatePortfolioSummary, type PortfolioSummary } from '@/lib/finance/investments';
import { buildProjectionScenarios, listNetWorthSnapshots } from '@/lib/finance/calculations';
import { listAccounts } from '@/lib/finance/accounts';
import type {
  InvestmentHolding,
  FinancialAccount,
  GoalProjection,
  NetWorthSnapshot,
} from '@/lib/finance/types';

const NetWorthMiniChart = dynamic(
  () => import('@/components/finance/charts/net-worth-mini-chart'),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

function ChartSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
      Loading chart…
    </div>
  );
}

interface InvestmentsData {
  holdings: InvestmentHolding[];
  accounts: FinancialAccount[];
  projection: GoalProjection | null;
  netWorthHistory: NetWorthSnapshot[];
  portfolioSummary: PortfolioSummary | null;
}

export default function InvestmentsView() {
  const [data, setData] = useState<InvestmentsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const [holdings, accounts, projection, netWorthHistory] = await Promise.all([
          listHoldings(),
          listAccounts(),
          buildProjectionScenarios().catch(() => null),
          listNetWorthSnapshots(365).catch(() => []),
        ]);

        // Calculate portfolio summary from VWRP holding
        const vwrp = holdings.find((h) => h.ticker === 'VWRP');
        let portfolioSummary: PortfolioSummary | null = null;
        if (vwrp) {
          const { data: snapshot } = await supabase
            .from('investment_snapshots')
            .select('*')
            .eq('holding_id', vwrp.id)
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .single();

          portfolioSummary = calculatePortfolioSummary(
            vwrp,
            snapshot as any ?? null,
          );
        }

        if (cancelled) return;

        setData({
          holdings,
          accounts,
          projection,
          netWorthHistory,
          portfolioSummary,
        });
      } catch (e) {
        console.error('Failed to load investments:', e);
      }

      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-1 items-center justify-center px-6 py-24">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-500" />
          <span className="text-xs text-zinc-500">Loading investments…</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* VWRP Portfolio Summary */}
      <Section label="VWRP Portfolio" sublabel="Your JISA investment">
        {data.portfolioSummary ? (
          <VwrpPanel summary={data.portfolioSummary} holding={data.holdings.find((h) => h.ticker === 'VWRP') ?? null} />
        ) : (
          <EmptyHint
            title="No investment data"
            body="Add your VWRP holding in Manage Data to track your portfolio."
            ctaHref="/finance/manage"
            ctaLabel="Add holding"
          />
        )}
      </Section>

      {/* All Holdings */}
      <Section label="Holdings" sublabel="All investment positions">
        {data.holdings.length > 0 ? (
          <HoldingsList holdings={data.holdings} />
        ) : (
          <div className="text-xs text-zinc-500">
            No holdings tracked. Add investments in Manage Data.
          </div>
        )}
      </Section>

      {/* Investment Accounts */}
      <Section label="Investment accounts" sublabel="JISA and other investment accounts">
        {data.accounts.filter((a) => a.type === 'investment' || a.type === 'isa').length > 0 ? (
          <ul className="divide-y divide-zinc-800/40">
            {data.accounts
              .filter((a) => a.type === 'investment' || a.type === 'isa')
              .map((a) => (
                <li key={a.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">{a.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span className="capitalize">{a.type}</span>
                      {a.is_jisa && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                          JISA
                        </span>
                      )}
                      {a.institution && <span>· {a.institution}</span>}
                    </div>
                  </div>
                  <span className="font-mono text-sm text-zinc-100">{fmtCurrency(a.balance)}</span>
                </li>
              ))}
          </ul>
        ) : (
          <div className="text-xs text-zinc-500">No investment accounts yet.</div>
        )}
      </Section>

      {/* Net Worth History Chart */}
      {data.netWorthHistory.length > 1 && (
        <Section label="Net worth history" sublabel="Total portfolio value over time">
          <div className="h-48 sm:h-56">
            <NetWorthMiniChart
              series={data.netWorthHistory.map((s) => ({
                date: s.snapshot_date,
                netWorth: s.net_worth,
                cash: s.total_cash,
                investments: s.total_investments,
              }))}
            />
          </div>
        </Section>
      )}

      {/* Projection Scenarios */}
      {data.projection && (
        <Section label="Projection scenarios" sublabel="Illustrative — not predictions">
          <ProjectionPanel projection={data.projection} />
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────

function VwrpPanel({
  summary,
  holding,
}: {
  summary: PortfolioSummary;
  holding: InvestmentHolding | null;
}) {
  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PillStat label="Current value" value={fmtCurrency(summary.currentValue)} />
        <PillStat label="Contributed" value={fmtCurrency(summary.contributed)} />
        <PillStat
          label="Growth"
          value={fmtCurrency(summary.growth, { showSign: true })}
          className={summary.growth >= 0 ? 'text-emerald-300' : 'text-red-300'}
        />
        <PillStat
          label="Return"
          value={fmtPercent(summary.growthPercent)}
          className={summary.growthPercent >= 0 ? 'text-emerald-300' : 'text-red-300'}
        />
      </div>

      <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-3">
        <div className="grid grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Units held</div>
            <div className="mt-0.5 font-mono text-zinc-100">{fmtDecimal(summary.units, 4)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Avg cost</div>
            <div className="mt-0.5 font-mono text-zinc-100">
              {summary.averageCost !== null ? fmtCurrency(summary.averageCost) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Latest price</div>
            <div className="mt-0.5 font-mono text-zinc-100">
              {summary.latestPrice !== null ? fmtCurrency(summary.latestPrice) : '—'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-zinc-500">
        {holding && (
          <span>
            100% Vanguard FTSE All-World UCITS ETF (Acc) · Ticker: {holding.ticker}
          </span>
        )}
      </div>
    </div>
  );
}

function HoldingsList({ holdings }: { holdings: InvestmentHolding[] }) {
  return (
    <ul className="divide-y divide-zinc-800/40">
      {holdings.map((h) => (
        <li key={h.id} className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium text-zinc-100">{h.name}</div>
            <div className="mt-0.5 text-[11px] text-zinc-500">
              {h.ticker} · {fmtDecimal(h.units, 4)} units
              {h.average_cost !== null && (
                <> · Avg cost {fmtCurrency(h.average_cost)}</>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-sm text-zinc-100">
              {fmtCurrency(h.units * (h.average_cost ?? 0))}
            </div>
            <div className="text-[10px] text-zinc-500">
              Contributed: {fmtCurrency(h.total_contributed)}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ProjectionPanel({ projection }: { projection: GoalProjection }) {
  const { goal, scenarios, currentAge, yearsRemaining, monthlyInvestment } = projection;

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Target</div>
          <div className="font-mono text-zinc-100">{fmtCurrency(goal.target_amount)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Current age</div>
          <div className="font-mono text-zinc-100">{currentAge ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Years remaining</div>
          <div className="font-mono text-zinc-100">{yearsRemaining ?? '—'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Monthly investment</div>
          <div className="font-mono text-zinc-100">{fmtCurrency(monthlyInvestment)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-800/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800/40 bg-zinc-950/40">
              <th className="px-3 py-2 text-left font-medium text-zinc-400">Scenario</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-400">Return</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-400">Projected</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-400">Required/mo</th>
              <th className="px-3 py-2 text-right font-medium text-zinc-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40">
            {scenarios.map((s) => (
              <tr key={s.name}>
                <td className="px-3 py-2.5 text-zinc-200">{s.label}</td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                  {fmtPercent(s.annualReturn)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-100">
                  {fmtCurrency(s.projectedPortfolio)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                  {fmtCurrency(s.requiredMonthly)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ' +
                      (s.isAhead
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : s.isOnTrack
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'bg-red-500/15 text-red-300')
                    }
                  >
                    {s.isAhead ? 'Ahead' : s.isOnTrack ? 'On track' : 'Behind'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-[10px] text-zinc-600">
        Projections are illustrative assumptions, not predictions. Actual returns will vary.
      </div>
    </div>
  );
}

// ─── Shared components ───────────────────────────────────────

function Section({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-900/30 p-4 sm:p-5">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">{label}</h2>
          {sublabel && <p className="text-[11px] text-zinc-500">{sublabel}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

function PillStat({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 ${className}`}>
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

function EmptyHint({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      <p className="mx-auto mt-1 max-w-md text-[11px] text-zinc-500">{body}</p>
      <a
        href={ctaHref}
        className="mt-3 inline-block rounded-md bg-zinc-800/60 px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700/60"
      >
        {ctaLabel}
      </a>
    </div>
  );
}
