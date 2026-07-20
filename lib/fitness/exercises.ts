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

/**
 * List the user's exercises. Archived rows are excluded by default —
 * the logging UI only needs active movements; the Settings page uses
 * `includeArchived: true` to surface retires.
 */
export async function listExercises(
  userId?: string | null,
  opts?: { includeArchived?: boolean },
): Promise<Exercise[]> {
  return safeRun('listExercises', async () => {
    let q = supabase.from('exercises').select('*').order('name', { ascending: true });
    if (userId) q = q.eq('user_id', userId);
    if (!opts?.includeArchived) q = q.eq('is_archived', false);
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

  // Existing match (case-insensitive, same user). Includes archived rows
  // so the picker can re-instate a retired movement by selecting it.
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

  if (existing) {
    // If archived, un-archive so the user can resume logging it.
    if (existing.is_archived) {
      return safeRun('findOrCreateExercise reactivate', async () => {
        const { data, error } = await supabase
          .from('exercises')
          .update({ is_archived: false })
          .eq('id', existing.id)
          .select('*')
          .single();
        if (error) return existing;
        return data as Exercise;
      }, existing);
    }
    return existing;
  }

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

/** Un-archive (restore) a previously-archived exercise. */
export async function unarchiveExercise(id: string): Promise<boolean> {
  return safeRun('unarchiveExercise', async () => {
    const { error } = await supabase
      .from('exercises')
      .update({ is_archived: false })
      .eq('id', id);
    if (error) {
      console.warn('[fitness] unarchiveExercise error:', error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * Rename + (optionally) re-categorize an exercise in-place. The
 * rename is case-insensitive deduplicated against the user's existing
 * library so we never accidentally create two rows with the same name.
 *
 * Returns `null` if the new name collides with another of the user's
 * already-existing rows — the UI surfaces this as a friendly error.
 */
export async function renameExercise(
  id: string,
  nextName: string,
  userId: string | null,
  category: ExerciseCategory | null = null,
): Promise<Exercise | null> {
  const trimmed = nextName.trim();
  if (!trimmed || !userId) return null;
  return safeRun('renameExercise', async () => {
    // Bump any existing row with the same name out of the way.
    const { data: dupes } = await supabase
      .from('exercises')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', trimmed)
      .neq('id', id)
      .limit(1);
    if (dupes && dupes.length > 0) {
      return null; // collision — caller surfaces "name already exists"
    }
    const { data, error } = await supabase
      .from('exercises')
      .update({ name: trimmed, category })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      // Supabase reports a unique-constraint violation as 23505. We map
      // that to the same "collision" signal so the UI handles both
      // pre-check and the (rarely-occuring) race identically.
      if (error.code === '23505') return null;
      console.warn('[fitness] renameExercise error:', error.message);
      return null;
    }
    return data as Exercise;
  }, null);
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
