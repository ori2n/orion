/**
 * Hevy exercise metadata — primary muscle group + manual 1RM.
 *
 * The Hevy export carries no muscle-group column, so exercises are mapped
 * to a primary muscle via a small per-user table (`hevy_exercise_meta`).
 * The taxonomy and default map live in `./muscle-data` (pure); this module
 * is the thin Supabase CRUD layer. Manual 1RM lives in the same row and is
 * kept strictly separate from the estimated 1RM.
 */
import { supabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_EXERCISE_MUSCLES,
  isMuscle,
  type Muscle,
} from './muscle-data';

export { DEFAULT_EXERCISE_MUSCLES, MUSCLES, isMuscle } from './muscle-data';
export type { Muscle } from './muscle-data';

// ─── Metadata row type ─────────────────────────────────────────────

export interface HevyExerciseMeta {
  id: string;
  exerciseName: string;
  muscle: Muscle | null;
  manual1rmKg: number | null;
}

interface MetaRow {
  id: string;
  exercise_name: string;
  muscle: string | null;
  manual_1rm_kg: number | null;
}

function mapMeta(row: MetaRow): HevyExerciseMeta {
  return {
    id: row.id,
    exerciseName: row.exercise_name,
    muscle: isMuscle(row.muscle) ? row.muscle : null,
    manual1rmKg: row.manual_1rm_kg,
  };
}

// ─── CRUD ──────────────────────────────────────────────────────────

/** List all exercise-meta rows for the user, alphabetical by name. */
export async function listExerciseMeta(
  userId: string | null,
  db: SupabaseClient = supabase,
): Promise<HevyExerciseMeta[]> {
  if (!userId) return [];
  try {
    const { data, error } = await db
      .from('hevy_exercise_meta')
      .select('*')
      .eq('user_id', userId)
      .order('exercise_name', { ascending: true });
    if (error) {
      console.warn('[hevy-muscles] list error:', error.message);
      return [];
    }
    return ((data ?? []) as MetaRow[]).map(mapMeta);
  } catch (err) {
    console.warn('[hevy-muscles] list exception:', err);
    return [];
  }
}

/**
 * Seed the default muscle map for every exercise name currently present
 * in the user's imported data. Never overwrites an existing row (user's
 * manual edits win). Returns how many rows were seeded.
 */
export async function seedDefaultMuscleMap(
  userId: string | null,
  db: SupabaseClient = supabase,
): Promise<number> {
  if (!userId) return 0;
  try {
    const { data: exs, error: eErr } = await db
      .from('hevy_workout_exercises')
      .select('name')
      .eq('user_id', userId);
    if (eErr) {
      console.warn('[hevy-muscles] seed fetch error:', eErr.message);
      return 0;
    }
    const names = [...new Set(((exs ?? []) as Array<{ name: string }>).map((e) => e.name))];
    const rows = names
      .filter((n) => DEFAULT_EXERCISE_MUSCLES[n] !== undefined)
      .map((n) => ({
        user_id: userId,
        exercise_name: n,
        muscle: DEFAULT_EXERCISE_MUSCLES[n],
      }));
    if (rows.length === 0) return 0;
    const { error } = await db
      .from('hevy_exercise_meta')
      .upsert(rows, { onConflict: 'user_id,exercise_name', ignoreDuplicates: true });
    if (error) {
      console.warn('[hevy-muscles] seed error:', error.message);
      return 0;
    }
    return rows.length;
  } catch (err) {
    console.warn('[hevy-muscles] seed exception:', err);
    return 0;
  }
}

/** Merge a partial patch into a meta row (read-then-upsert to avoid clobbering). */
async function upsertMeta(
  userId: string,
  exerciseName: string,
  patch: { muscle?: Muscle | null; manual1rmKg?: number | null },
): Promise<boolean> {
  try {
    const { data: existing } = await supabase
      .from('hevy_exercise_meta')
      .select('muscle, manual_1rm_kg')
      .eq('user_id', userId)
      .eq('exercise_name', exerciseName)
      .maybeSingle();
    const row = {
      user_id: userId,
      exercise_name: exerciseName,
      muscle:
        patch.muscle !== undefined
          ? patch.muscle
          : ((existing as { muscle: string | null } | null)?.muscle ?? null),
      manual_1rm_kg:
        patch.manual1rmKg !== undefined
          ? patch.manual1rmKg
          : ((existing as { manual_1rm_kg: number | null } | null)?.manual_1rm_kg ?? null),
    };
    const { error } = await supabase
      .from('hevy_exercise_meta')
      .upsert(row, { onConflict: 'user_id,exercise_name' });
    if (error) {
      console.warn('[hevy-muscles] upsert error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[hevy-muscles] upsert exception:', err);
    return false;
  }
}

/** Assign (or clear) the primary muscle for an exercise. */
export async function setExerciseMuscle(
  userId: string | null,
  exerciseName: string,
  muscle: Muscle | null,
): Promise<boolean> {
  if (!userId) return false;
  return upsertMeta(userId, exerciseName, { muscle });
}

/** Set (or clear) the manual 1RM for an exercise. */
export async function setManual1rm(
  userId: string | null,
  exerciseName: string,
  kg: number | null,
): Promise<boolean> {
  if (!userId) return false;
  return upsertMeta(userId, exerciseName, { manual1rmKg: kg });
}
