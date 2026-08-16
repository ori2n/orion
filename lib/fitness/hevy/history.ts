/**
 * Hevy import history + management + record verification.
 *
 * Stage 2 makes the importer verifiable and manageable:
 *   - list past imports (provenance + diagnostics)
 *   - delete a specific import (reverts only the data it owns)
 *   - browse stored workouts/sets to confirm the importer was faithful
 *
 * Deletion semantics: a workout's `source_import_id` points at the most
 * recent import that wrote it. Deleting import N therefore removes the
 * workouts whose CURRENT data came from import N. Workouts later touched
 * by a newer import survive. Children are removed explicitly (not relied
 * on via FK cascade) so counts are exact and RLS-safe.
 */
import { supabase } from '@/lib/supabase';
import type {
  HevyDeleteImportResult,
  HevyImportRecord,
  HevyWorkoutDetail,
} from './types';

// ─── Import history ────────────────────────────────────────────────

/** Raw row shape as stored in `hevy_imports`. */
interface HevyImportRow {
  id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  workouts_checked: number;
  workouts_created: number;
  workouts_updated: number;
  workouts_unchanged: number;
  sets_processed: number;
  date_min: string | null;
  date_max: string | null;
  warnings: string[] | null;
  raw_file_name: string | null;
}

function mapImportRow(row: HevyImportRow): HevyImportRecord {
  return {
    id: row.id,
    status: row.status === 'failed' ? 'failed' : 'completed',
    startedAt: row.started_at,
    completedAt: row.completed_at,
    workoutsChecked: row.workouts_checked ?? 0,
    workoutsCreated: row.workouts_created ?? 0,
    workoutsUpdated: row.workouts_updated ?? 0,
    workoutsUnchanged: row.workouts_unchanged ?? 0,
    setsProcessed: row.sets_processed ?? 0,
    dateMin: row.date_min,
    dateMax: row.date_max,
    warnings: row.warnings ?? [],
    rawFileName: row.raw_file_name,
  };
}

/** List past imports newest-first (limit 20 for safety). */
export async function listHevyImports(
  userId: string | null,
): Promise<HevyImportRecord[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('hevy_imports')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn('[hevy-history] list error:', error.message);
      return [];
    }
    return ((data ?? []) as HevyImportRow[]).map(mapImportRow);
  } catch (err) {
    console.warn('[hevy-history] list exception:', err);
    return [];
  }
}

// ─── Specific-import deletion ──────────────────────────────────────

/**
 * Delete one import and every workout whose current data came from it.
 * Removes children explicitly (sets → exercises → workouts) so the
 * reported counts are exact and we never rely on RLS-vs-cascade nuance.
 */
export async function deleteHevyImport(
  userId: string | null,
  importId: string,
): Promise<HevyDeleteImportResult> {
  if (!userId) {
    return { ok: false, deletedWorkouts: 0, deletedSets: 0, error: 'Not signed in.' };
  }
  try {
    // 1. Workouts owned by this import.
    const { data: workouts, error: wErr } = await supabase
      .from('hevy_workouts')
      .select('id')
      .eq('user_id', userId)
      .eq('source_import_id', importId);
    if (wErr) throw wErr;
    const workoutIds = ((workouts ?? []) as Array<{ id: string }>).map((w) => w.id);

    let deletedSets = 0;
    if (workoutIds.length > 0) {
      // 2. Exercises under those workouts.
      const { data: exercises, error: eErr } = await supabase
        .from('hevy_workout_exercises')
        .select('id')
        .eq('user_id', userId)
        .in('workout_id', workoutIds);
      if (eErr) throw eErr;
      const exerciseIds = ((exercises ?? []) as Array<{ id: string }>).map((e) => e.id);

      // 3. Count + delete sets.
      if (exerciseIds.length > 0) {
        const { count, error: cErr } = await supabase
          .from('hevy_workout_sets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('workout_exercise_id', exerciseIds);
        if (cErr) throw cErr;
        deletedSets = count ?? 0;

        const { error: sErr } = await supabase
          .from('hevy_workout_sets')
          .delete()
          .eq('user_id', userId)
          .in('workout_exercise_id', exerciseIds);
        if (sErr) throw sErr;
      }

      // 4. Delete exercises, then workouts.
      const { error: dErr } = await supabase
        .from('hevy_workout_exercises')
        .delete()
        .eq('user_id', userId)
        .in('workout_id', workoutIds);
      if (dErr) throw dErr;

      const { error: wDelErr } = await supabase
        .from('hevy_workouts')
        .delete()
        .eq('user_id', userId)
        .in('id', workoutIds);
      if (wDelErr) throw wDelErr;
    }

    // 5. Delete the import record itself.
    const { error: impErr } = await supabase
      .from('hevy_imports')
      .delete()
      .eq('user_id', userId)
      .eq('id', importId);
    if (impErr) throw impErr;

    return { ok: true, deletedWorkouts: workoutIds.length, deletedSets };
  } catch (err) {
    console.warn('[hevy-history] delete exception:', err);
    return {
      ok: false,
      deletedWorkouts: 0,
      deletedSets: 0,
      error: err instanceof Error ? err.message : 'Delete failed.',
    };
  }
}

// ─── Record verification ───────────────────────────────────────────

interface WorkoutSummaryRow {
  id: string;
  title: string | null;
  source_start_time: string;
  start_time: string | null;
}

/** List stored workouts newest-first — for the verification browser. */
export async function listHevyWorkouts(
  userId: string | null,
  limit = 50,
): Promise<WorkoutSummaryRow[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('hevy_workouts')
      .select('id, title, source_start_time, start_time')
      .eq('user_id', userId)
      .order('start_time', { ascending: false })
      .limit(limit);
    if (error) {
      console.warn('[hevy-history] listWorkouts error:', error.message);
      return [];
    }
    return (data as WorkoutSummaryRow[] | null) ?? [];
  } catch (err) {
    console.warn('[hevy-history] listWorkouts exception:', err);
    return [];
  }
}

/** Fetch one workout with its exercises and sets, for spot verification. */
export async function getHevyWorkoutDetail(
  userId: string | null,
  workoutId: string,
): Promise<HevyWorkoutDetail | null> {
  if (!userId) return null;
  try {
    const { data: workout, error: wErr } = await supabase
      .from('hevy_workouts')
      .select('id, title, source_start_time, start_time')
      .eq('user_id', userId)
      .eq('id', workoutId)
      .single();
    if (wErr || !workout) return null;

    const { data: exercises, error: eErr } = await supabase
      .from('hevy_workout_exercises')
      .select('id, name, order_index')
      .eq('user_id', userId)
      .eq('workout_id', workoutId)
      .order('order_index', { ascending: true });
    if (eErr) throw eErr;

    const exIds = ((exercises ?? []) as Array<{ id: string }>).map((e) => e.id);
    const setsByEx = new Map<string, HevyWorkoutDetail['exercises'][number]['sets']>();
    if (exIds.length > 0) {
      const { data: sets, error: sErr } = await supabase
        .from('hevy_workout_sets')
        .select('workout_exercise_id, set_index, weight_kg, reps, duration_seconds')
        .eq('user_id', userId)
        .in('workout_exercise_id', exIds)
        .order('set_index', { ascending: true });
      if (sErr) throw sErr;
      for (const s of (sets ?? []) as Array<{
        workout_exercise_id: string;
        set_index: number;
        weight_kg: number | null;
        reps: number | null;
        duration_seconds: number | null;
      }>) {
        const list = setsByEx.get(s.workout_exercise_id) ?? [];
        list.push({
          setIndex: s.set_index,
          weightKg: s.weight_kg,
          reps: s.reps,
          durationSeconds: s.duration_seconds,
        });
        setsByEx.set(s.workout_exercise_id, list);
      }
    }

    return {
      id: (workout as { id: string }).id,
      title: (workout as { title: string | null }).title,
      sourceStartTime: (workout as { source_start_time: string }).source_start_time,
      startTime: (workout as { start_time: string | null }).start_time,
      exercises: ((exercises ?? []) as Array<{
        id: string;
        name: string;
        order_index: number;
      }>).map((e) => ({
        name: e.name,
        orderIndex: e.order_index,
        sets: setsByEx.get(e.id) ?? [],
      })),
    };
  } catch (err) {
    console.warn('[hevy-history] workoutDetail exception:', err);
    return null;
  }
}
