import { supabase } from './supabase';

/**
 * Per-habit completion counts within a date range.
 * Returns rows like: [{ habitId, habitName, completions }]
 *
 * Returns an empty array on error or if there is no data — never throws.
 */
export async function getCompletionsPerHabit(
  startDate: string,
  endDate: string,
  userId?: string | null,
) {
  let query = supabase
    .from('habit_completions')
    .select(`
      habit_id,
      habits ( name ),
      completed_date
    `)
    .gte('completed_date', startDate)
    .lte('completed_date', endDate);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[analytics] getCompletionsPerHabit failed:', error.message);
    return [];
  }

  // Aggregate by habit_id in plain JS (avoids raw SQL on Supabase free tier)
  const counts: Record<string, { habitName: string; completions: number }> = {};
  for (const row of data ?? []) {
    const hId = row.habit_id;
    if (!counts[hId]) {
      const habitName =
        (row.habits as unknown as { name: string } | null)?.name ?? 'Unknown';
      counts[hId] = { habitName, completions: 0 };
    }
    counts[hId].completions++;
  }

  return Object.entries(counts).map(([habitId, info]) => ({
    habitId,
    habitName: info.habitName,
    completions: info.completions,
  }));
}

/**
 * Daily completion counts within a date range.
 * Returns rows like: [{ date, count }]
 *
 * Returns an empty array on error — never throws.
 */
export async function getDailyCompletionCounts(
  startDate: string,
  endDate: string,
  userId?: string | null,
) {
  let query = supabase
    .from('habit_completions')
    .select('completed_date')
    .gte('completed_date', startDate)
    .lte('completed_date', endDate);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[analytics] getDailyCompletionCounts failed:', error.message);
    return [];
  }

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const date = row.completed_date;
    counts[date] = (counts[date] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Weekly completion counts within a date range.
 * Weeks are ISO weeks (Monday start). Returns rows like: [{ week_start, count }]
 *
 * Returns an empty array on error — never throws.
 */
export async function getWeeklyCompletionCounts(
  startDate: string,
  endDate: string,
  userId?: string | null,
) {
  let query = supabase
    .from('habit_completions')
    .select('completed_date')
    .gte('completed_date', startDate)
    .lte('completed_date', endDate);

  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[analytics] getWeeklyCompletionCounts failed:', error.message);
    return [];
  }

  const weekCounts: Record<string, number> = {};
  for (const row of data ?? []) {
    const weekStart = getWeekStart(row.completed_date);
    weekCounts[weekStart] = (weekCounts[weekStart] ?? 0) + 1;
  }

  return Object.entries(weekCounts)
    .map(([weekStart, count]) => ({ weekStart, count }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/**
 * Completion rate over time (percentage of days with any completions
 * vs total days in the range).
 * Returns: [{ date, completions, totalHabits, rate }]
 *
 * Returns an empty array on error — never throws.
 */
export async function getCompletionRate(
  startDate: string,
  endDate: string,
  userId?: string | null,
) {
  let completionsQuery = supabase
    .from('habit_completions')
    .select('completed_date, habit_id')
    .gte('completed_date', startDate)
    .lte('completed_date', endDate);

  if (userId) {
    completionsQuery = completionsQuery.eq('user_id', userId);
  }

  let habitsQuery = supabase.from('habits').select('id', { count: 'exact', head: true });
  if (userId) {
    habitsQuery = habitsQuery.eq('user_id', userId);
  }

  const [completions, habitsResult] = await Promise.all([
    completionsQuery,
    habitsQuery,
  ]);

  if (completions.error) {
    console.error('[analytics] getCompletionRate completions query failed:', completions.error.message);
    return [];
  }
  if (habitsResult.error) {
    console.error('[analytics] getCompletionRate habits query failed:', habitsResult.error.message);
    return [];
  }

  const totalHabits = habitsResult.count ?? 0;
  if (totalHabits === 0) return [];

  const dailyData: Record<
    string,
    { completions: number; uniqueHabits: Set<string> }
  > = {};

  for (const row of completions.data ?? []) {
    const date = row.completed_date;
    if (!dailyData[date]) {
      dailyData[date] = { completions: 0, uniqueHabits: new Set() };
    }
    dailyData[date].completions++;
    dailyData[date].uniqueHabits.add(row.habit_id);
  }

  return Object.entries(dailyData)
    .map(([date, info]) => ({
      date,
      completions: info.completions,
      totalHabits,
      uniqueHabits: info.uniqueHabits.size,
      rate: totalHabits > 0 ? info.uniqueHabits.size / totalHabits : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Return the Monday (ISO week start) of the given date string. */
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}
