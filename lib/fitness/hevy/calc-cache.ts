/**
 * Tiny module-level cache for `computeHevyCalculations` results.
 *
 * The full engine is invoked from several components on the SAME page
 * (Manage Data runs it in two sections, the muscle drill-down in two
 * places, and mutations recompute it). Without a cache that's the full
 * dataset loaded + joined multiple times per page. Caching collapses
 * them to one.
 *
 * Semantics:
 *   - Keyed by user id only (the browser client is the sole cached
 *     caller; server-side calls pass their own `db` and bypass it).
 *   - Invalidated explicitly by every write path that changes the
 *     engine's inputs (import, delete, muscle map, 1RM, targets), so
 *     post-write recomputes are always fresh.
 *   - A short TTL is a safety net for cross-tab edits; worst case a
 *     stale value is served for < 60 s.
 */
import type { HevyCalculations } from './calc';

const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { at: number; value: HevyCalculations }>();

export function getCachedHevyCalculations(
  userId: string,
): HevyCalculations | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(userId);
    return null;
  }
  return hit.value;
}

export function setCachedHevyCalculations(
  userId: string,
  value: HevyCalculations,
): void {
  cache.set(userId, { at: Date.now(), value });
}

export function invalidateHevyCalculationsCache(userId: string | null): void {
  if (userId) cache.delete(userId);
}
