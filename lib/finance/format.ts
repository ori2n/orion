/**
 * Shared formatters for the ORION Finance module.
 *
 * Pure functions — no React imports, safe for chart components,
 * list components, and drill-down pages.
 */

// ─── Currency ────────────────────────────────────────────────

/** Format a number as GBP currency: "£1,234.56" */
export function fmtCurrency(
  amount: number | null | undefined,
  opts?: { showSign?: boolean; compact?: boolean },
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';

  const sign = opts?.showSign && amount > 0 ? '+' : '';

  if (opts?.compact && Math.abs(amount) >= 1_000_000) {
    const m = amount / 1_000_000;
    return `${sign}£${m.toFixed(m >= 10 ? 0 : 1)}m`;
  }
  if (opts?.compact && Math.abs(amount) >= 1_000) {
    const k = amount / 1_000;
    return `${sign}£${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }

  const formatted = Math.abs(amount).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}£${amount < 0 ? '-' : ''}${formatted}`;
}

/** Format a number as GBP without pence: "£1,234" */
export function fmtCurrencyWhole(
  amount: number | null | undefined,
): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return `£${Math.round(Math.abs(amount)).toLocaleString('en-GB')}${amount < 0 ? ' (negative)' : ''}`;
}

// ─── Percentages ─────────────────────────────────────────────

/** Format a decimal as percentage: 0.07 → "7.0%" */
export function fmtPercent(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Format a raw percentage number: 7 → "7.0%" */
export function fmtPercentRaw(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

// ─── Dates ───────────────────────────────────────────────────

/** Format ISO date as "16 May 2025" */
export function fmtLongDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Format ISO date as "16 May" (no year) */
export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Format ISO date as "May 2025" */
export function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** "Today" / "Yesterday" / relative in days, then falls back to date */
export function fmtRelativeDate(
  iso: string | null | undefined,
  asOf = new Date(),
): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.floor((asOf.getTime() - d.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  if (days >= 7 && days < 30) {
    const w = Math.floor(days / 7);
    return w === 1 ? '1 week ago' : `${w} weeks ago`;
  }
  return fmtShortDate(iso);
}

/** Format a YYYY-MM string as "May 2025" */
export function fmtMonth(ym: string): string {
  const [year, month] = ym.split('-');
  if (!year || !month) return ym;
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

/** Format a YYYY-MM string as short "May" */
export function fmtMonthShort(ym: string): string {
  const [year, month] = ym.split('-');
  if (!year || !month) return ym;
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString('en-GB', { month: 'short' });
}

// ─── Months ──────────────────────────────────────────────────

/** Get YYYY-MM for a Date */
export function toYearMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Get current YYYY-MM */
export function currentYearMonth(): string {
  return toYearMonth(new Date());
}

/** Get YYYY-MM for N months ago */
export function yearMonthAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toYearMonth(d);
}

// ─── Numbers ─────────────────────────────────────────────────

/** Format a number with thousands separators */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('en-GB');
}

/** Format a decimal with fixed precision */
export function fmtDecimal(
  n: number | null | undefined,
  decimals = 1,
): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toFixed(decimals);
}

// ─── Age ─────────────────────────────────────────────────────

/** Calculate age from birth date */
export function calculateAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}
