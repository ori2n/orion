/**
 * Exercises CRUD — wraps Supabase queries with the same safe-query
 * pattern used by lib/analytics.ts and lib/tasks.ts.
 *
 * Each function NEVER throws; on error returns [] / null / false so
 * the UI can render an empty-state or fallback message instead of
 * crashing the page.
 */
import { supabase } from '@/lib/supabase';
import type { Exercise, ExerciseCategory } from './types';

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[fitness] ${label} exception:`, err);
    return fallback;
  }
}

export async function listExercises(userId?: string | null): Promise<Exercise[]> {
  return safeRun('listExercises', async () => {
    let q = supabase
      .from('exercises')
      .select('*')
      .order('name', { ascending: true });
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) {
      console.warn('[fitness] listExercises query error:', error.message);
      return [];
    }
    return (data ?? []) as Exercise[];
  }, []);
}

export async function findOrCreateExercise(
  name: string,
  userId: string | null,
  category: ExerciseCategory | null = null,
): Promise<Exercise | null> {
  const trimmed = name.trim();
  if (!trimmed || !userId) return null;

  // Existing match (case-insensitive, same user).
  const existing = await safeRun('findOrCreateExercise find', async () => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', trimmed)
      .limit(1)
      .maybeSingle();
    return data as Exercise | null;
  }, null);

  if (existing) return existing;

  return safeRun('findOrCreateExercise insert', async () => {
    const { data, error } = await supabase
      .from('exercises')
      .insert({ name: trimmed, user_id: userId, category })
      .select('*')
      .single();
    if (error) {
      console.warn('[fitness] findOrCreateExercise insert error:', error.message);
      return null;
    }
    return data as Exercise;
  }, null);
}

export async function archiveExercise(id: string): Promise<boolean> {
  return safeRun('archiveExercise', async () => {
    const { error } = await supabase
      .from('exercises')
      .update({ is_archived: true })
      .eq('id', id);
    if (error) {
      console.warn('[fitness] archiveExercise error:', error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * A small catalogue of suggested exercise names so the UI can offer
 * one-tap entry for common lifts. Users can still type custom names;
 * this is purely a starter list.
 */
export const SUGGESTED_EXERCISES: Array<{ name: string; category: ExerciseCategory }> = [
  { name: 'Bench Press', category: 'push' },
  { name: 'Overhead Press', category: 'push' },
  { name: 'Incline Bench Press', category: 'push' },
  { name: 'Squat', category: 'legs' },
  { name: 'Front Squat', category: 'legs' },
  { name: 'Deadlift', category: 'pull' },
  { name: 'Romanian Deadlift', category: 'pull' },
  { name: 'Pull-up', category: 'pull' },
  { name: 'Chin-up', category: 'pull' },
  { name: 'Bent-Over Row', category: 'pull' },
  { name: 'Hip Thrust', category: 'legs' },
  { name: 'Lateral Raise', category: 'push' },
];
