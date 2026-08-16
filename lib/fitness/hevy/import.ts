/**
 * Hevy import pipeline — turns a parsed export into stored workout data.
 *
 * Idempotent by design: a workout is identified by (user_id,
 * source_start_time). Re-importing the same history results in 0 new
 * workouts. A workout whose content hash changed is updated in place
 * (its children are replaced) rather than duplicated.
 *
 * NOTE: this runs client-side (like the rest of the Fitness lib) and
 * uses several Supabase round-trips. True single-transaction atomicity
 * would require a database function (RPC) — a later-stage refinement.
 * Idempotency makes a failed import safe to simply re-run.
 */
import { supabase } from '@/lib/supabase';
import { computeWorkoutContentHash, parseHevyCsv } from './parser';
import type {
  HevyExercise,
  HevyImportDiagnostics,
  HevyWorkout,
} from './types';

const CHUNK_SIZE = 500;

/** Split an array into chunks of at most `size` elements. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function isoDate(d: Date | null): string | null {
  return d === null ? null : d.toISOString().slice(0, 10);
}

interface ExistingWorkout {
  id: string;
  source_start_time: string;
  content_hash: string | null;
}

interface PreparedWorkout {
  parsed: HevyWorkout;
  contentHash: string;
  /** Existing row id when updating; null when creating. */
  existingId: string | null;
  /** 'create' | 'update' | 'unchanged' */
  action: 'create' | 'update' | 'unchanged';
}

/**
 * Parse + import a Hevy export for `userId`.
 *
 * `fileText` is the raw CSV string; `fileName` is only stored for
 * provenance/diagnostics.
 */
export async function importHevyCsv(
  userId: string,
  fileText: string,
  fileName?: string,
): Promise<HevyImportDiagnostics> {
  // 1. Parse. Fatal if the file is not recognisable as Hevy CSV.
  const parsed = parseHevyCsv(fileText);
  const fatal = parsed.warnings.find((w) => w.startsWith('Missing required column'));
  if (fatal || parsed.workouts.length === 0) {
    const warnings = fatal ? [fatal] : ['No workouts found in the file.'];
    return {
      importId: null,
      status: 'failed',
      workoutsChecked: parsed.workouts.length,
      workoutsCreated: 0,
      workoutsUpdated: 0,
      workoutsUnchanged: 0,
      setsProcessed: 0,
      dateMin: null,
      dateMax: null,
      warnings,
    };
  }

  const valid = parsed.workouts.filter((w) => w.sourceStartTime !== '');
  const skippedEmpty = parsed.workouts.length - valid.length;
  const warnings: string[] = [...parsed.warnings];
  if (skippedEmpty > 0) {
    warnings.push(`Skipped ${skippedEmpty} workout(s) with no start time.`);
  }

  // 2. Create the import record up-front so workouts can reference it.
  const { data: importRow, error: importCreateError } = await supabase
    .from('hevy_imports')
    .insert({ user_id: userId, raw_file_name: fileName ?? null })
    .select('id')
    .single();

  if (importCreateError || !importRow) {
    console.warn('[hevy-import] failed to create import record:', importCreateError?.message);
    return {
      importId: null,
      status: 'failed',
      workoutsChecked: valid.length,
      workoutsCreated: 0,
      workoutsUpdated: 0,
      workoutsUnchanged: 0,
      setsProcessed: 0,
      dateMin: null,
      dateMax: null,
      warnings: ['Could not create the import record.'],
    };
  }
  const importId = importRow.id as string;

  // 3. Load existing workouts to detect create vs update vs unchanged.
  const { data: existingRows, error: existingError } = await supabase
    .from('hevy_workouts')
    .select('id, source_start_time, content_hash')
    .eq('user_id', userId);

  if (existingError) {
    await markFailed(importId, 'Could not read existing workouts.');
    return failedDiagnostics(importId, valid.length, warnings);
  }

  const existing = new Map<string, ExistingWorkout>();
  for (const row of (existingRows ?? []) as ExistingWorkout[]) {
    existing.set(row.source_start_time, row);
  }

  // 4. Partition.
  const prepared: PreparedWorkout[] = valid.map((w) => {
    const contentHash = computeWorkoutContentHash(w);
    const found = existing.get(w.sourceStartTime);
    if (!found) return { parsed: w, contentHash, existingId: null, action: 'create' };
    if (found.content_hash !== contentHash) {
      return { parsed: w, contentHash, existingId: found.id, action: 'update' };
    }
    return { parsed: w, contentHash, existingId: found.id, action: 'unchanged' };
  });

  const toCreate = prepared.filter((p) => p.action === 'create');
  const toUpdate = prepared.filter((p) => p.action === 'update');
  const unchanged = prepared.filter((p) => p.action === 'unchanged');
  const toWrite = [...toCreate, ...toUpdate];

  let totalSets = 0;
  for (const w of valid) {
    for (const e of w.exercises) totalSets += e.sets.length;
  }

  try {
    // 5. Insert new workouts → map source_start_time → id.
    const workoutIdBySource = new Map<string, string>();
    if (toCreate.length > 0) {
      for (const batch of chunk(toCreate, CHUNK_SIZE)) {
        const { data, error } = await supabase
          .from('hevy_workouts')
          .insert(
            batch.map((p) => workoutRow(userId, importId, p)),
          )
          .select('id, source_start_time');
        if (error) throw error;
        for (const row of (data ?? []) as Array<{ id: string; source_start_time: string }>) {
          workoutIdBySource.set(row.source_start_time, row.id);
        }
      }
    }
    for (const p of toUpdate) {
      if (p.existingId) workoutIdBySource.set(p.parsed.sourceStartTime, p.existingId);
    }

    // 6. Update changed workouts (title / times / hash / provenance).
    for (const p of toUpdate) {
      if (!p.existingId) continue;
      const { error } = await supabase
        .from('hevy_workouts')
        .update({
          title: p.parsed.title,
          description: p.parsed.description,
          start_time: p.parsed.startTime?.toISOString() ?? null,
          end_time: p.parsed.endTime?.toISOString() ?? null,
          content_hash: p.contentHash,
          source_import_id: importId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', p.existingId);
      if (error) throw error;
    }

    // 7. Replace children of changed workouts (exercises delete cascades sets).
    const updateIds = toUpdate.map((p) => p.existingId).filter((id): id is string => !!id);
    if (updateIds.length > 0) {
      const { error } = await supabase
        .from('hevy_workout_exercises')
        .delete()
        .in('workout_id', updateIds);
      if (error) throw error;
    }

    // 8. Insert exercises for created + updated workouts.
    const exerciseIdByKey = new Map<string, string>();
    const exerciseRows: Array<Record<string, unknown>> = [];
    for (const p of toWrite) {
      const workoutId = workoutIdBySource.get(p.parsed.sourceStartTime);
      if (!workoutId) continue;
      for (const e of p.parsed.exercises) {
        exerciseRows.push(exerciseRow(userId, workoutId, e));
      }
    }
    for (const batch of chunk(exerciseRows, CHUNK_SIZE)) {
      const { data, error } = await supabase
        .from('hevy_workout_exercises')
        .insert(batch)
        .select('id, workout_id, order_index');
      if (error) throw error;
      for (const row of (data ?? []) as Array<{ id: string; workout_id: string; order_index: number }>) {
        exerciseIdByKey.set(`${row.workout_id}:${row.order_index}`, row.id);
      }
    }

    // 9. Insert sets.
    const setRows: Array<Record<string, unknown>> = [];
    for (const p of toWrite) {
      const workoutId = workoutIdBySource.get(p.parsed.sourceStartTime);
      if (!workoutId) continue;
      for (const e of p.parsed.exercises) {
        const exerciseId = exerciseIdByKey.get(`${workoutId}:${e.orderIndex}`);
        if (!exerciseId) continue;
        for (const s of e.sets) {
          setRows.push(setRow(userId, exerciseId, s));
        }
      }
    }
    for (const batch of chunk(setRows, CHUNK_SIZE)) {
      const { error } = await supabase.from('hevy_workout_sets').insert(batch);
      if (error) throw error;
    }

    // 10. Finalise the import record.
    const dateMin = minDate(valid.map((w) => w.startTime));
    const dateMax = maxDate(valid.map((w) => w.startTime));
    const { error: finalizeError } = await supabase
      .from('hevy_imports')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        workouts_checked: valid.length,
        workouts_created: toCreate.length,
        workouts_updated: toUpdate.length,
        workouts_unchanged: unchanged.length,
        sets_processed: totalSets,
        date_min: dateMin,
        date_max: dateMax,
        warnings,
      })
      .eq('id', importId);

    if (finalizeError) {
      console.warn('[hevy-import] finalise error:', finalizeError.message);
    }

    return {
      importId,
      status: 'completed',
      workoutsChecked: valid.length,
      workoutsCreated: toCreate.length,
      workoutsUpdated: toUpdate.length,
      workoutsUnchanged: unchanged.length,
      setsProcessed: totalSets,
      dateMin,
      dateMax,
      warnings,
    };
  } catch (err) {
    console.warn('[hevy-import] pipeline error:', err);
    await markFailed(importId, err instanceof Error ? err.message : String(err));
    return failedDiagnostics(importId, valid.length, warnings);
  }
}

// ─── Row builders ──────────────────────────────────────────────────

function workoutRow(
  userId: string,
  importId: string,
  p: PreparedWorkout,
): Record<string, unknown> {
  return {
    user_id: userId,
    source_start_time: p.parsed.sourceStartTime,
    title: p.parsed.title,
    description: p.parsed.description,
    start_time: p.parsed.startTime?.toISOString() ?? null,
    end_time: p.parsed.endTime?.toISOString() ?? null,
    content_hash: p.contentHash,
    source_import_id: importId,
  };
}

function exerciseRow(
  userId: string,
  workoutId: string,
  e: HevyExercise,
): Record<string, unknown> {
  return {
    user_id: userId,
    workout_id: workoutId,
    name: e.name,
    superset_id: e.supersetId,
    notes: e.notes,
    order_index: e.orderIndex,
  };
}

function setRow(
  userId: string,
  exerciseId: string,
  s: HevyExercise['sets'][number],
): Record<string, unknown> {
  return {
    user_id: userId,
    workout_exercise_id: exerciseId,
    set_index: s.setIndex,
    set_type: s.setType,
    weight_kg: s.weightKg,
    reps: s.reps,
    distance_km: s.distanceKm,
    duration_seconds: s.durationSeconds,
    rpe: s.rpe,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────

function minDate(dates: Array<Date | null>): string | null {
  const valid = dates.filter((d): d is Date => d !== null);
  if (valid.length === 0) return null;
  return isoDate(new Date(Math.min(...valid.map((d) => d.getTime()))));
}

function maxDate(dates: Array<Date | null>): string | null {
  const valid = dates.filter((d): d is Date => d !== null);
  if (valid.length === 0) return null;
  return isoDate(new Date(Math.max(...valid.map((d) => d.getTime()))));
}

async function markFailed(importId: string, message: string): Promise<void> {
  try {
    await supabase
      .from('hevy_imports')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        warnings: [message],
      })
      .eq('id', importId);
  } catch (err) {
    console.warn('[hevy-import] failed to mark import as failed:', err);
  }
}

function failedDiagnostics(
  importId: string,
  workoutsChecked: number,
  warnings: string[],
): HevyImportDiagnostics {
  return {
    importId,
    status: 'failed',
    workoutsChecked,
    workoutsCreated: 0,
    workoutsUpdated: 0,
    workoutsUnchanged: 0,
    setsProcessed: 0,
    dateMin: null,
    dateMax: null,
    warnings,
  };
}
