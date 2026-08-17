/**
 * Tiny shared formatters for the Fitness UI.
 *
 * Pure functions (no React imports) so they can be lifted into chart
 * components, list components, and the drill-down pages without
 * pulling in dependencies.
 */

/** "70.0" for non-integer weights, "70" for clean ones. */
export function fmtKg(kg: number | null | undefined, withUnit = false): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  const rounded = Math.round(kg * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return withUnit ? `${text} kg` : text;
}

/** Render a number with thousands separators, "—" for null / NaN. */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString();
}

/** Format a Date as "16 May" (no year). */
export function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // Accept both ISO timestamps and YYYY-MM-DD.
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a Date as "16 May 2025". */
export function fmtLongDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Today" / "Yesterday" / relative in days, then falls back to date. */
export function fmtRelativeDate(iso: string | null | undefined, asOf = new Date()): string {
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

/** Parse a Hevy source_start_time raw string ("16 Aug 2026, 19:23") to a Date or null. */
export function parseHevyStart(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.match(
    /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4}),\s+(\d{1,2}):(\d{2})$/,
  );
  if (!m) return null;
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  const [, dd, mon, yyyy, hh, mm] = m;
  const d = new Date(
    Number(yyyy),
    months[mon as keyof typeof months] ?? 0,
    Number(dd),
    Number(hh),
    Number(mm),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute a 12-week moving average over an array of {date, value}
 * samples (one entry per bodyweight measurement, sorted by date). Zero-
 * fills missing weeks so the line is contiguous from the earliest to
 * the latest entry.
 */
export interface TimePoint {
  date: string;          // YYYY-MM-DD
  value: number;
}
export interface MaPoint {
  /** YYYY-MM-DD of the last day of the averaging window. */
  weekEndIso: string;
  raw: number;           // raw value (only present for source weeks)
  ma: number;            // moving-average value
}

export function twelveWeekMovingAverage(points: TimePoint[]): MaPoint[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  // Bucket source values by ISO week (Monday).
  const weekly = new Map<string, number>();
  for (const p of sorted) {
    const wk = isoMonday(p.date);
    weekly.set(wk, p.value);
  }
  const keys = [...weekly.keys()].sort();
  const out: MaPoint[] = [];
  // Walk every week from earliest to latest so the chart line is continuous.
  let cursor = keys[0];
  const last = keys[keys.length - 1];
  while (cursor.localeCompare(last) <= 0) {
    // Take up to 12 trailing weeks ending at cursor.
    const window: number[] = [];
    for (let i = 11; i >= 0; i--) {
      const wk = addDays(cursor, -i * 7);
      const v = weekly.get(wk);
      if (v !== undefined) window.push(v);
    }
    if (window.length > 0) {
      const ma = window.reduce((n, v) => n + v, 0) / window.length;
      out.push({
        weekEndIso: cursor,
        raw: weekly.get(cursor) ?? ma,
        ma: Math.round(ma * 10) / 10,
      });
    }
    cursor = addDays(cursor, 7);
  }
  return out;
}

/** Add (or subtract) `n` days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the ISO week containing `iso`, returned as YYYY-MM-DD. */
function isoMonday(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const day = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}
