/**
 * Workouts + workout_sets CRUD.
 *
 * `workout_sets` is intentionally flat and strictly numeric (weight_kg,
 * reps, optional rpe). This makes it trivial for a future LLM/voice
 * pipeline to map natural language ("Bench was 70kg for 5, then 72.5kg
 * for 3…") onto rows. Original raw input is preserved on `workouts.ai_raw_text`.
 */
import { supabase } from '@/lib/supabase';
import type { Workout, WorkoutSet } from './types';

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[fitness] ${label} exception:`, err);
    return fallback;
  }
}

export interface CreateWorkoutInput {
  name?: string | null;
  performed_at?: string;        // ISO; defaults to now()
  notes?: string | null;
  ai_raw_text?: string | null;
  user_id: string;
}

export interface CreateWorkoutSetInput {
  workout_id: string;
  exercise_id: string;
  user_id: string;
  set_order: number;
  weight_kg: number;
  reps: number;
  rpe?: number | null;
  notes?: string | null;
}

export async function createWorkout(input: CreateWorkoutInput): Promise<Workout | null> {
  return safeRun('createWorkout', async () => {
    const { data, error } = await supabase
      .from('workouts')
      .insert({
        name: input.name ?? null,
        performed_at: input.performed_at ?? new Date().toISOString(),
        notes: input.notes ?? null,
        ai_raw_text: input.ai_raw_text ?? null,
        user_id: input.user_id,
      })
      .select()
      .single();
    if (error) {
      console.warn('[fitness] createWorkout error:', error.message);
      return null;
    }
    return data as Workout;
  }, null);
}

export async function addWorkoutSets(
  sets: CreateWorkoutSetInput[],
): Promise<WorkoutSet[]> {
  if (sets.length === 0) return [];
  return safeRun('addWorkoutSets', async () => {
    const rows = sets.map((s) => ({
      workout_id: s.workout_id,
      exercise_id: s.exercise_id,
      user_id: s.user_id,
      set_order: s.set_order,
      weight_kg: s.weight_kg,
      reps: s.reps,
      rpe: s.rpe ?? null,
      notes: s.notes ?? null,
    }));
    const { data, error } = await supabase.from('workout_sets').insert(rows).select('*');
    if (error) {
      console.warn('[fitness] addWorkoutSets error:', error.message);
      return [];
    }
    return (data ?? []) as WorkoutSet[];
  }, []);
}

export async function listRecentWorkouts(
  userId: string | null,
  limit = 20,
): Promise<Array<Workout & { sets: WorkoutSet[] }>> {
  if (!userId) return [];
  return safeRun('listRecentWorkouts', async () => {
    const { data, error } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', userId)
      .order('performed_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[fitness] listRecentWorkouts error:', error.message);
      return [];
    }
    const workouts = (data ?? []) as Workout[];
    if (workouts.length === 0) return [];
    const ids = workouts.map((w) => w.id);
    const { data: setsData, error: setsErr } = await supabase
      .from('workout_sets')
      .select('*')
      .in('workout_id', ids)
      .order('set_order', { ascending: true });
    if (setsErr) {
      console.warn('[fitness] listRecentWorkouts sets query error:', setsErr.message);
      return workouts.map((w) => ({ ...w, sets: [] }));
    }
    const sets = (setsData ?? []) as WorkoutSet[];
    const byWorkout = new Map<string, WorkoutSet[]>();
    for (const s of sets) {
      const arr = byWorkout.get(s.workout_id) ?? [];
      arr.push(s);
      byWorkout.set(s.workout_id, arr);
    }
    return workouts.map((w) => ({ ...w, sets: byWorkout.get(w.id) ?? [] }));
  }, []);
}

export async function listAllSetsForUser(
  userId: string | null,
  sinceISO?: string,
): Promise<WorkoutSet[]> {
  if (!userId) return [];
  return safeRun('listAllSetsForUser', async () => {
    let q = supabase
      .from('workout_sets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (sinceISO) q = q.gte('created_at', sinceISO);
    const { data, error } = await q;
    if (error) {
      console.warn('[fitness] listAllSetsForUser error:', error.message);
      return [];
    }
    return (data ?? []) as WorkoutSet[];
  }, []);
}

export async function deleteWorkout(workoutId: string): Promise<boolean> {
  return safeRun('deleteWorkout', async () => {
    const { error } = await supabase.from('workouts').delete().eq('id', workoutId);
    if (error) {
      console.warn('[fitness] deleteWorkout error:', error.message);
      return false;
    }
    return true;
  }, false);
}
