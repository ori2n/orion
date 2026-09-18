import { supabase } from '@/lib/supabase';
import { isoWeekKey } from './calc';
import type { WeeklyWorkoutPoint } from '@/components/fitness/charts/weekly-workouts-chart';

/**
 * Weekly workout counts for the Overview's compact frequency chart.
 *
 * Reads only `hevy_workouts` (id + start_time) — one small bounded
 * query — and buckets each workout into its ISO week (UTC Monday),
 * matching the calculation engine's week-key convention so the chart
 * aligns with every other weekly view in the module.
 *
 * `weeks` (default 12) controls how many recent weeks are returned,
 * zero-filled so the chart shows quiet weeks as empty rather than
 * disappearing.
 */
export async function listWeeklyWorkoutCounts(
  userId: string | null,
  weeks = 12,
): Promise<WeeklyWorkoutPoint[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('hevy_workouts')
      .select('id, start_time')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .limit(200);
    if (error) {
      console.warn('[weekly-workouts] query error:', error.message);
      return [];
    }
    const rows = (data ?? []) as Array<{ id: string; start_time: string | null }>;

    // Bucket by ISO week (UTC Monday).
    const byWeek = new Map<string, number>();
    for (const w of rows) {
      if (!w.start_time) continue;
      const key = isoWeekKey(new Date(w.start_time));
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }

    // Walk the last `weeks` Mondays, zero-filling gaps, newest last
    // (chart-friendly order).
    const out: WeeklyWorkoutPoint[] = [];
    const now = new Date();
    const thisWeek = isoWeekKey(now);
    for (let i = weeks - 1; i >= 0; i--) {
      const d = new Date(thisWeek + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - i * 7);
      const key = d.toISOString().slice(0, 10);
      out.push({ week: key, workouts: byWeek.get(key) ?? 0 });
    }
    return out;
  } catch (err) {
    console.warn('[weekly-workouts] exception:', err);
    return [];
  }
}
