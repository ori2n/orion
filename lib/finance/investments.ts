/**
 * Investment tracking for the ORION Finance module.
 *
 * Handles:
 * - Investment holdings management
 * - VWRP / JISA portfolio tracking
 * - Investment snapshots (historical values)
 * - Growth vs contributions calculation
 */
import { supabase } from '@/lib/supabase';
import type {
  InvestmentHolding,
  InvestmentSnapshot,
} from './types';

// ─── Holdings ────────────────────────────────────────────────

/** List all holdings for the current user. */
export async function listHoldings(): Promise<InvestmentHolding[]> {
  const { data, error } = await supabase
    .from('investment_holdings')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to list holdings:', error);
    return [];
  }
  return (data ?? []) as InvestmentHolding[];
}

/** Get holdings for a specific account. */
export async function getHoldingsForAccount(
  accountId: string,
): Promise<InvestmentHolding[]> {
  const { data, error } = await supabase
    .from('investment_holdings')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to list holdings for account:', error);
    return [];
  }
  return (data ?? []) as InvestmentHolding[];
}

/** Get the VWRP holding (primary JISA holding). */
export async function getVwrpHolding(): Promise<InvestmentHolding | null> {
  const { data, error } = await supabase
    .from('investment_holdings')
    .select('*')
    .eq('ticker', 'VWRP')
    .single();

  if (error) return null;
  return data as InvestmentHolding;
}

/** Create or update an investment holding. */
export async function upsertHolding(
  accountId: string,
  ticker: string,
  name: string,
  units: number,
  opts?: {
    averageCost?: number;
    totalContributed?: number;
  },
): Promise<InvestmentHolding | null> {
  // Check if holding already exists for this ticker + account
  const { data: existing } = await supabase
    .from('investment_holdings')
    .select('id')
    .eq('account_id', accountId)
    .eq('ticker', ticker)
    .single();

  if (existing) {
    const { data, error } = await supabase
      .from('investment_holdings')
      .update({
        units,
        average_cost: opts?.averageCost ?? null,
        total_contributed: opts?.totalContributed ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.error('Failed to update holding:', error);
      return null;
    }
    return data as InvestmentHolding;
  }

  const { data, error } = await supabase
    .from('investment_holdings')
    .insert({
      account_id: accountId,
      ticker,
      name,
      units,
      average_cost: opts?.averageCost ?? null,
      total_contributed: opts?.totalContributed ?? 0,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create holding:', error);
    return null;
  }
  return data as InvestmentHolding;
}

// ─── Snapshots ───────────────────────────────────────────────

/** List investment snapshots for a given account, ordered by date. */
export async function listSnapshots(
  accountId: string,
  limit = 365,
): Promise<InvestmentSnapshot[]> {
  const { data, error } = await supabase
    .from('investment_snapshots')
    .select('*')
    .eq('account_id', accountId)
    .order('snapshot_date', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Failed to list investment snapshots:', error);
    return [];
  }
  return (data ?? []) as InvestmentSnapshot[];
}

/** Get the latest snapshot for an account. */
export async function getLatestSnapshot(
  accountId: string,
): Promise<InvestmentSnapshot | null> {
  const { data, error } = await supabase
    .from('investment_snapshots')
    .select('*')
    .eq('account_id', accountId)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data as InvestmentSnapshot;
}

/** Add an investment snapshot (e.g., daily portfolio value). */
export async function addSnapshot(
  accountId: string,
  totalValue: number,
  opts?: {
    holdingId?: string;
    units?: number;
    pricePerUnit?: number;
    dailyChange?: number;
    snapshotDate?: string;
  },
): Promise<InvestmentSnapshot | null> {
  const { data, error } = await supabase
    .from('investment_snapshots')
    .insert({
      account_id: accountId,
      holding_id: opts?.holdingId ?? null,
      snapshot_date: opts?.snapshotDate ?? new Date().toISOString().slice(0, 10),
      units: opts?.units ?? null,
      price_per_unit: opts?.pricePerUnit ?? null,
      total_value: totalValue,
      daily_change: opts?.dailyChange ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to add investment snapshot:', error);
    return null;
  }
  return data as InvestmentSnapshot;
}

// ─── Portfolio calculations ──────────────────────────────────

export interface PortfolioSummary {
  /** Total contributed to the investment */
  contributed: number;
  /** Current portfolio value */
  currentValue: number;
  /** Investment growth (current - contributed) */
  growth: number;
  /** Growth as a percentage of contributions */
  growthPercent: number;
  /** Total units held */
  units: number;
  /** Average purchase price */
  averageCost: number | null;
  /** Latest price per unit */
  latestPrice: number | null;
}

/** Calculate portfolio summary from a holding and its latest snapshot. */
export function calculatePortfolioSummary(
  holding: InvestmentHolding,
  latestSnapshot: InvestmentSnapshot | null,
): PortfolioSummary {
  const contributed = holding.total_contributed ?? 0;
  const currentValue = latestSnapshot?.total_value ?? holding.units * (holding.average_cost ?? 0);
  const growth = currentValue - contributed;
  const growthPercent = contributed > 0 ? growth / contributed : 0;

  return {
    contributed,
    currentValue,
    growth,
    growthPercent,
    units: holding.units,
    averageCost: holding.average_cost,
    latestPrice: latestSnapshot?.price_per_unit ?? null,
  };
}

/** Get total investment value across all holdings. */
export async function getTotalInvestmentValue(): Promise<number> {
  const holdings = await listHoldings();
  let total = 0;
  for (const h of holdings) {
    const snapshot = await getLatestSnapshot(h.account_id);
    if (snapshot) {
      total += snapshot.total_value;
    } else {
      total += h.units * (h.average_cost ?? 0);
    }
  }
  return total;
}
