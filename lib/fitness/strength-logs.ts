/**
 * Strength Logs — simple CRUD for the new `strength_logs` table.
 *
 * One row per exercise per day. No workouts, no sets, no volume — just
 * the best working set for each exercise the user performed on a given
 * date. This replaces the old `workouts` + `workout_sets` two-table
 * model.
 */
import { supabase } from '@/lib/supabase';

// ─── Types ─────────────────────────────────────────────────────────

/** A single strength log entry (one exercise on one day). */
export interface StrengthLogEntry {
  id: string;
  user_id: string;
  exercise_id: string;
  performed_at: string; // YYYY-MM-DD
  weight_kg: number;
  reps: number | null;
  notes: string | null;
  created_at: string;
}

/** Input shape for creating a log entry. */
export interface CreateStrengthLogInput {
  exercise_id: string;
  user_id: string;
  performed_at?: string; // defaults to today if omitted
  weight_kg: number;
  reps?: number | null;
  notes?: string | null;
}

// ─── CRUD ──────────────────────────────────────────────────────────

/**
 * Insert or upsert one or more strength log entries.
 *
 * Uses ON CONFLICT on (user_id, exercise_id, performed_at) to safely
 * overwrite a previous entry for the same exercise on the same day.
 * This means "Log more" overwrites the earlier entry rather than
 * creating a duplicate — the user's latest input always wins.
 */
export async function insertStrengthLogs(
  inputs: CreateStrengthLogInput[],
): Promise<StrengthLogEntry[]> {
  if (inputs.length === 0) return [];
  const today = new Date().toISOString().slice(0, 10);
  const rows = inputs.map((i) => ({
    exercise_id: i.exercise_id,
    user_id: i.user_id,
    performed_at: i.performed_at ?? today,
    weight_kg: i.weight_kg,
    reps: i.reps ?? null,
    notes: i.notes ?? null,
  }));
  try {
    const { data, error } = await supabase
      .from('strength_logs')
      .upsert(rows, {
        onConflict: 'user_id,exercise_id,performed_at',
        ignoreDuplicates: false,
      })
      .select('*');
    if (error) {
      console.warn('[strength-logs] upsert error:', error.message);
      return [];
    }
    return (data as StrengthLogEntry[] | null) ?? [];
  } catch (err) {
    console.warn('[strength-logs] upsert exception:', err);
    return [];
  }
}

/** Update an existing log entry (weight, reps, or notes). */
export async function updateStrengthLog(
  id: string,
  patch: { weight_kg?: number; reps?: number | null; notes?: string | null },
): Promise<StrengthLogEntry | null> {
  try {
    const { data, error } = await supabase
      .from('strength_logs')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      console.warn('[strength-logs] update error:', error.message);
      return null;
    }
    return data as StrengthLogEntry | null;
  } catch (err) {
    console.warn('[strength-logs] update exception:', err);
    return null;
  }
}

/** Delete a log entry by id. */
export async function deleteStrengthLog(id: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('strength_logs')
      .delete()
      .eq('id', id);
    if (error) {
      console.warn('[strength-logs] delete error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[strength-logs] delete exception:', err);
    return false;
  }
}

/**
 * List all log entries for a user, optionally filtered by exercise.
 * Ordered newest-first.
 */
export async function listStrengthLogs(
  userId: string | null,
  exerciseId?: string,
  limit = 200,
): Promise<StrengthLogEntry[]> {
  if (!userId) return [];
  try {
    let q = supabase
      .from('strength_logs')
      .select('*')
      .eq('user_id', userId)
      .order('performed_at', { ascending: false })
      .limit(limit);
    if (exerciseId) q = q.eq('exercise_id', exerciseId);
    const { data, error } = await q;
    if (error) {
      console.warn('[strength-logs] list error:', error.message);
      return [];
    }
    return (data as StrengthLogEntry[] | null) ?? [];
  } catch (err) {
    console.warn('[strength-logs] list exception:', err);
    return [];
  }
}

/**
 * Get today's entries for a specific exercise (used to check if the
 * user already logged this exercise today).
 */
export async function getTodayEntries(
  userId: string | null,
  exerciseId: string,
): Promise<StrengthLogEntry[]> {
  if (!userId) return [];
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('strength_logs')
      .select('*')
      .eq('user_id', userId)
      .eq('exercise_id', exerciseId)
      .eq('performed_at', today);
    if (error) {
      console.warn('[strength-logs] getTodayEntries error:', error.message);
      return [];
    }
    return (data as StrengthLogEntry[] | null) ?? [];
  } catch (err) {
    console.warn('[strength-logs] getTodayEntries exception:', err);
    return [];
  }
}

// ─── Analytics helpers (pure functions — no DB I/O) ────────────────

/**
 * Group log entries by exercise_id → sorted chronological list.
 * Useful for building per-exercise progress views.
 */
export function groupByExercise(
  entries: StrengthLogEntry[],
): Map<string, StrengthLogEntry[]> {
  const map = new Map<string, StrengthLogEntry[]>();
  for (const e of entries) {
    const list = map.get(e.exercise_id) ?? [];
    list.push(e);
    map.set(e.exercise_id, list);
  }
  // Sort each group chronologically (oldest first)
  for (const [key, list] of map) {
    list.sort(
      (a, b) =>
        new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime(),
    );
  }
  return map;
}

/** The current best: most recent entry for an exercise. */
export function currentBest(
  entries: StrengthLogEntry[],
): StrengthLogEntry | null {
  if (entries.length === 0) return null;
  return entries.reduce((best, e) =>
    new Date(e.performed_at).getTime() > new Date(best.performed_at).getTime()
      ? e
      : best,
  );
}

/** The previous best: second-most-recent entry. */
export function previousBest(
  entries: StrengthLogEntry[],
): StrengthLogEntry | null {
  if (entries.length < 2) return null;
  const sorted = [...entries].sort(
    (a, b) =>
      new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime(),
  );
  return sorted[1] ?? null;
}

/**
 * Format a StrengthLogEntry as a human-readable string.
 * e.g. "80 kg × 6" or "80 kg" (when reps is null).
 */
export function formatEntry(entry: StrengthLogEntry): string {
  if (entry.reps !== null) return `${entry.weight_kg} kg × ${entry.reps}`;
  return `${entry.weight_kg} kg`;
}

/**
 * Build timeline points for a chart: weight_kg over time.
 * Returns sorted chronologically (oldest → newest).
 */
export function buildTimeline(
  entries: StrengthLogEntry[],
): Array<{ date: string; weight_kg: number; reps: number | null }> {
  return [...entries]
    .sort(
      (a, b) =>
        new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime(),
    )
    .map((e) => ({
      date: e.performed_at,
      weight_kg: Number(e.weight_kg),
      reps: e.reps,
    }));
}
