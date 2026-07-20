/**
 * Workouts + workout_sets CRUD.
 *
 * `workout_sets` is intentionally flat and numeric (weight_kg, reps,
 * working_sets_count). After the workout-summary migration, the table
 * holds **one row per (workout, exercise)** capturing the user's best
 * working set + the count that produced it — instead of one row per
 * set. This shape maps directly onto what a future LLM/voice pipeline
 * will emit and what a Hevy import will resolve to per (exercise,
 * session). The raw input string is preserved on `workouts.ai_raw_text`.
 */
import { supabase } from '@/lib/supabase';
import type { Workout, WorkoutSet } from './types';

/**
 * Capture-style wrapper around a Supabase call. Returns the raw
 * `{ data, error }` result (or the catch result on throw) so callers
 * can decide whether to continue, warn, or surface a UI error. NEVER
 * silently returns fallback — that pattern (formerly `safeRun`) hid
 * real RLS denials as 0-row success and was removed across fitness.
 *
 * Accepts `PromiseLike` (not just `Promise`) because Supabase returns
 * `PostgrestBuilder` / `PostgrestFilterBuilder` builders — both
 * implement `.then(...)` but are not `Promise` instances.
 */
async function captureDb<T>(
  label: string,
  promise: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<{ data: T | null; error: { message: string; code?: string } | null }> {
  try {
    return await promise;
  } catch (err) {
    const message = err instanceof Error ? err.message : `${label} threw`;
    console.warn(`[fitness] ${label} exception:`, message);
    return { data: null, error: { message } };
  }
}

export interface CreateWorkoutInput {
  name?: string | null;
  performed_at?: string;        // ISO; defaults to now()
  notes?: string | null;
  ai_raw_text?: string | null;
  user_id: string;
}

/**
 * Input shape for `addWorkoutSets` / `replaceWorkoutSets`. In the
 * post-migration summary model, every row carries the BEST working
 * set (weight_kg, optional reps) plus the count of working sets that
 * ended on that best.
 */
export interface CreateWorkoutSetInput {
  workout_id: string;
  exercise_id: string;
  user_id: string;
  set_order: number;
  weight_kg: number;
  /**
   * Best working set reps. `null` means the user logged weight only
   * — analytics treat this as 1 rep for PR/Epley purposes.
   */
  reps: number | null;
  /**
   * Count of working sets performed (`null` for unknown legacy rows).
   * The summary-flow UI writes 1+; legacy row migration backfills
   * historical counts.
   */
  working_sets_count?: number | null;
  rpe?: number | null;
  notes?: string | null;
}

export async function createWorkout(input: CreateWorkoutInput): Promise<Workout | null> {
  const { data, error } = await captureDb('createWorkout', supabase
    .from('workouts')
    .insert({
      name: input.name ?? null,
      performed_at: input.performed_at ?? new Date().toISOString(),
      notes: input.notes ?? null,
      ai_raw_text: input.ai_raw_text ?? null,
      user_id: input.user_id,
    })
    .select()
    .single());
  if (error) {
    console.warn('[fitness] createWorkout error:', error.message);
    return null;
  }
  return (data as Workout | null) ?? null;
}

/**
 * Replace the rows for a given workout in two steps (delete + insert).
 * Existing rows are removed and the new ones inserted in the same
 * call. Safe to call with empty `sets` — the workout ends up with no
 * summary rows and the parent row stays intact.
 *
 * Returns the new full set list on success, `null` on failure.
 */
export async function replaceWorkoutSets(
  workoutId: string,
  sets: Array<Omit<CreateWorkoutSetInput, 'workout_id'>>,
): Promise<WorkoutSet[] | null> {
  const delRes = await captureDb('replaceWorkoutSets delete', supabase
    .from('workout_sets')
    .delete()
    .eq('workout_id', workoutId));
  if (delRes.error) {
    console.warn('[fitness] replaceWorkoutSets delete error:', delRes.error.message);
    return null;
  }
  if (sets.length === 0) return [];
  const rows = sets.map((s) => ({
    workout_id: workoutId,
    exercise_id: s.exercise_id,
    user_id: s.user_id,
    set_order: s.set_order,
    weight_kg: s.weight_kg,
    reps: s.reps,
    working_sets_count: s.working_sets_count ?? null,
    rpe: s.rpe ?? null,
    notes: s.notes ?? null,
  }));
  const insRes = await captureDb('replaceWorkoutSets insert', supabase
    .from('workout_sets')
    .insert(rows)
    .select('*'));
  if (insRes.error) {
    console.warn('[fitness] replaceWorkoutSets insert error:', insRes.error.message);
    return null;
  }
  return (insRes.data as WorkoutSet[] | null) ?? [];
}

/** Update the parent workout (name / performed_at / notes). */
export async function updateWorkout(
  id: string,
  patch: Partial<Pick<Workout, 'name' | 'performed_at' | 'notes'>>,
): Promise<Workout | null> {
  const { data, error } = await captureDb('updateWorkout', supabase
    .from('workouts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single());
  if (error) {
    console.warn('[fitness] updateWorkout error:', error.message);
    return null;
  }
  return (data as Workout | null) ?? null;
}

export async function addWorkoutSets(
  sets: CreateWorkoutSetInput[],
): Promise<WorkoutSet[]> {
  if (sets.length === 0) return [];
  const rows = sets.map((s) => ({
    workout_id: s.workout_id,
    exercise_id: s.exercise_id,
    user_id: s.user_id,
    set_order: s.set_order,
    weight_kg: s.weight_kg,
    reps: s.reps,
    working_sets_count: s.working_sets_count ?? null,
    rpe: s.rpe ?? null,
    notes: s.notes ?? null,
  }));
  const { data, error } = await captureDb('addWorkoutSets', supabase
    .from('workout_sets')
    .insert(rows)
    .select('*'));
  if (error) {
    console.warn('[fitness] addWorkoutSets error:', error.message);
    return [];
  }
  return (data as WorkoutSet[] | null) ?? [];
}

/**
 * Hydrated recent-workouts query: returns the recent sessions with
 * their sets fully joined in one call. Used by Today + Recent panels.
 */
export async function listRecentWorkouts(
  userId: string | null,
  limit = 20,
): Promise<Array<Workout & { sets: WorkoutSet[] }>> {
  if (!userId) return [];
  const wRes = await captureDb('listRecentWorkouts', supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .order('performed_at', { ascending: false })
    .limit(limit));
  if (wRes.error) {
    console.warn('[fitness] listRecentWorkouts error:', wRes.error.message);
    return [];
  }
  const workouts = (wRes.data as Workout[] | null) ?? [];
  if (workouts.length === 0) return [];
  const ids = workouts.map((w) => w.id);
  const sRes = await captureDb('listRecentWorkouts sets', supabase
    .from('workout_sets')
    .select('*')
    .in('workout_id', ids)
    .order('set_order', { ascending: true }));
  if (sRes.error) {
    console.warn('[fitness] listRecentWorkouts sets query error:', sRes.error.message);
    return workouts.map((w) => ({ ...w, sets: [] }));
  }
  const sets = (sRes.data as WorkoutSet[] | null) ?? [];
  const byWorkout = new Map<string, WorkoutSet[]>();
  for (const s of sets) {
    const arr = byWorkout.get(s.workout_id) ?? [];
    arr.push(s);
    byWorkout.set(s.workout_id, arr);
  }
  return workouts.map((w) => ({ ...w, sets: byWorkout.get(w.id) ?? [] }));
}

/**
 * Build a [startISO, endISO] window query for workouts — used to
 * detect whether the user has already logged today. Faster than
 * listing all recent workouts when we only need a yes/no answer.
 */
export async function listWorkoutsInWindow(
  userId: string | null,
  startISO: string,
  endISO: string,
): Promise<Workout[]> {
  if (!userId) return [];
  const { data, error } = await captureDb('listWorkoutsInWindow', supabase
    .from('workouts')
    .select('*')
    .eq('user_id', userId)
    .gte('performed_at', startISO)
    .lte('performed_at', endISO)
    .order('performed_at', { ascending: false }));
  if (error) {
    console.warn('[fitness] listWorkoutsInWindow error:', error.message);
    return [];
  }
  return (data as Workout[] | null) ?? [];
}

export async function listAllSetsForUser(
  userId: string | null,
  sinceISO?: string,
): Promise<WorkoutSet[]> {
  if (!userId) return [];
  let q = supabase
    .from('workout_sets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (sinceISO) q = q.gte('created_at', sinceISO);
  const { data, error } = await captureDb('listAllSetsForUser', q);
  if (error) {
    console.warn('[fitness] listAllSetsForUser error:', error.message);
    return [];
  }
  return (data as WorkoutSet[] | null) ?? [];
}

export async function deleteWorkout(workoutId: string): Promise<boolean> {
  const { error } = await captureDb('deleteWorkout', supabase
    .from('workouts')
    .delete()
    .eq('id', workoutId));
  if (error) {
    console.warn('[fitness] deleteWorkout error:', error.message);
    return false;
  }
  return true;
}
