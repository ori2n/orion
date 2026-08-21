/**
 * Hevy calculation engine — deterministic metrics from imported data.
 *
 * Loads the full dataset once and derives everything in memory (the
 * export is only ~800 sets, so this is simple + fast). Pure math and the
 * result types live in `./calc` (no Supabase imports) so they can be
 * tested in isolation; this module is the thin DB layer.
 */
import { supabase } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listExerciseMeta, type Muscle } from './muscles';
import {
  listMuscleTargets,
  type HevyMuscleTarget,
} from './muscle-targets';
import {
  addWeeks,
  average,
  estimate1RM,
  isoWeekKey,
  setVolumeKg,
} from './calc';
import type {
  ExerciseSummary,
  HevyCalculations,
  MuscleOnTargetStatus,
  MuscleSummary,
  MuscleWeeklyPoint,
  WeeklyBucket,
} from './calc';

export {
  addWeeks,
  average,
  estimate1RM,
  isoWeekKey,
  movingAverage,
  setVolumeKg,
} from './calc';
export type {
  ExerciseSummary,
  HevyCalculations,
  MuscleOnTargetStatus,
  MuscleSummary,
  MuscleWeeklyPoint,
  WeeklyBucket,
} from './calc';

// ─── Raw row shapes ────────────────────────────────────────────────

interface WorkoutRow { id: string; start_time: string | null }
interface ExerciseRow { id: string; workout_id: string; name: string }
interface SetRow {
  workout_exercise_id: string;
  weight_kg: number | null;
  reps: number | null;
}

// ─── Engine ────────────────────────────────────────────────────────

/**
 * Default target applied when a user has not customised one yet.
 * Stage 5 explicitly does NOT offer a single hard-coded "2×/week"
 * across all muscles, but until the user customises, this is a
 * sensible placeholder.
 */
const DEFAULT_TARGET_SESSIONS_PER_WEEK = 2;

/**
 * Compare actual vs target sessions over a recent rolling window and
 * reduce to a 3-band status. Bands are intentionally generous so
 * normal scheduling jitter doesn't flip a "On target" badge.
 */
function bandOnTarget(
  actual: number | null,
  target: number,
): MuscleOnTargetStatus {
  if (actual === null) return null;
  if (target <= 0) return null; // user opted out of tracking this muscle
  const ratio = actual / target;
  if (ratio < 0.6) return 'below';
  if (ratio > 1.2) return 'above';
  return 'on';
}

/** Load all Hevy data for a user, joined in memory.
 *
 * If `userId` is supplied AND `targetsOverride` is omitted, the
 * user's stored per-muscle targets are loaded from
 * `hevy_muscle_targets` and merged into the result. Pass
 * `targetsOverride` to bypass DB round-tripping (used by tests / the
 * editor when a freshly-edited value should re-run calculations
 * without writing to the DB first).
 */
export async function computeHevyCalculations(
  userId: string | null,
  targetsOverride?: HevyMuscleTarget[] | null,
  db: SupabaseClient = supabase,
): Promise<HevyCalculations> {
  const empty: HevyCalculations = {
    exercises: [],
    weekly: [],
    muscles: [],
    unmappedExercises: [],
    totalVolumeKg: 0,
    totalSets: 0,
  };
  if (!userId) return empty;

  try {
    const [workouts, exercises, sets, meta, storedTargets] = await Promise.all([
      db.from('hevy_workouts').select('id, start_time').eq('user_id', userId),
      db.from('hevy_workout_exercises')
        .select('id, workout_id, name')
        .eq('user_id', userId),
      db.from('hevy_workout_sets')
        .select('workout_exercise_id, weight_kg, reps')
        .eq('user_id', userId),
      listExerciseMeta(userId, db),
      targetsOverride === undefined
        ? listMuscleTargets(userId, db)
        : Promise.resolve(targetsOverride ?? []),
    ]);

    if (workouts.error || exercises.error || sets.error) {
      console.warn(
        '[hevy-calculations] query error:',
        workouts.error?.message ?? exercises.error?.message ?? sets.error?.message,
      );
      return empty;
    }

    const workoutDate = new Map<string, Date>();
    for (const w of (workouts.data ?? []) as WorkoutRow[]) {
      if (w.start_time) workoutDate.set(w.id, new Date(w.start_time));
    }

    const exName = new Map<string, string>();
    const exWorkout = new Map<string, string>();
    for (const e of (exercises.data ?? []) as ExerciseRow[]) {
      exName.set(e.id, e.name);
      exWorkout.set(e.id, e.workout_id);
    }

    const muscleBy = new Map<string, Muscle | null>();
    const manualBy = new Map<string, number | null>();
    for (const m of meta) {
      muscleBy.set(m.exerciseName, m.muscle);
      manualBy.set(m.exerciseName, m.manual1rmKg);
    }

    // Per-muscle user-defined targets + notes.
    const targetBy = new Map<string, HevyMuscleTarget>();
    for (const t of storedTargets) {
      targetBy.set(t.muscle, t);
    }

    // Per-exercise aggregation.
    const agg = new Map<
      string,
      {
        name: string;
        heaviest: number | null;
        est1rm: number | null;
        volume: number;
        sets: number;
        first: Date | null;
        last: Date | null;
      }
    >();
    // Week → {volume, sets, sessions} for the global weekly series.
    const weekly = new Map<string, { volume: number; sets: number; sessions: Set<string> }>();
    // muscle → week → accumulator. `sessions` is a Set of distinct training
    // day keys so multiple exercises/sets for the same muscle on the same
    // date count as a single training day.
    const muscleWeekly = new Map<
      string,
      Map<string, { week: string; sets: number; sessions: Set<string>; volumeKg: number }>
    >();

    for (const s of (sets.data ?? []) as SetRow[]) {
      const name = exName.get(s.workout_exercise_id);
      if (!name) continue;
      const workoutId = exWorkout.get(s.workout_exercise_id);
      const date = workoutId ? workoutDate.get(workoutId) : undefined;

      const volume = setVolumeKg(s.weight_kg, s.reps);
      const est = estimate1RM(s.weight_kg, s.reps);

      const a = agg.get(name) ?? {
        name,
        heaviest: null,
        est1rm: null,
        volume: 0,
        sets: 0,
        first: null,
        last: null,
      };
      a.sets += 1;
      a.volume = Math.round((a.volume + volume) * 100) / 100;
      if (s.weight_kg !== null && (a.heaviest === null || s.weight_kg > a.heaviest)) {
        a.heaviest = s.weight_kg;
      }
      if (est !== null && (a.est1rm === null || est > a.est1rm)) a.est1rm = est;
      if (date) {
        if (a.first === null || date < a.first) a.first = date;
        if (a.last === null || date > a.last) a.last = date;

        const week = isoWeekKey(date);
        const wb = weekly.get(week) ?? { volume: 0, sets: 0, sessions: new Set<string>() };
        wb.sets += 1;
        wb.volume = Math.round((wb.volume + volume) * 100) / 100;
        if (workoutId) wb.sessions.add(workoutId);
        weekly.set(week, wb);

        const muscle = muscleBy.get(name) ?? null;
        const mKey = muscle ?? 'Unmapped';
        let mw = muscleWeekly.get(mKey);
        if (!mw) {
          mw = new Map();
          muscleWeekly.set(mKey, mw);
        }
        const mp = mw.get(week) ?? {
          week,
          sets: 0,
          sessions: new Set<string>(),
          volumeKg: 0,
        };
        mp.sets += 1;
        mp.volumeKg = Math.round((mp.volumeKg + volume) * 100) / 100;
        // Count each DISTINCT training day once per muscle — multiple sets
        // or exercises on the same date are one training day.
        if (date) mp.sessions.add(date.toISOString().slice(0, 10));
        mw.set(week, mp);
      }
      agg.set(name, a);
    }

    // Exercises summary.
    const exercisesSummary: ExerciseSummary[] = [...agg.values()]
      .map((a) => ({
        name: a.name,
        muscle: muscleBy.get(a.name) ?? null,
        heaviestWeightKg: a.heaviest,
        estimated1rmKg: a.est1rm,
        manual1rmKg: manualBy.get(a.name) ?? null,
        totalVolumeKg: a.volume,
        totalSets: a.sets,
        firstTrained: a.first ? a.first.toISOString().slice(0, 10) : null,
        lastTrained: a.last ? a.last.toISOString().slice(0, 10) : null,
      }))
      .sort((x, y) => x.name.localeCompare(y.name));

    // Global weekly series.
    const weeklyBuckets: WeeklyBucket[] = [...weekly.entries()]
      .map(([week, w]) => ({
        week,
        volumeKg: w.volume,
        sets: w.sets,
        sessions: w.sessions.size,
      }))
      .sort((a, b) => a.week.localeCompare(b.week));

    // Latest week across all data (for the last-4/8-week windows).
    const maxWeek = weeklyBuckets.length
      ? weeklyBuckets[weeklyBuckets.length - 1].week
      : null;

    // Muscle summaries.
    const muscles: MuscleSummary[] = [];
    for (const m of MUSCLE_ORDER) {
      const mw = muscleWeekly.get(m);
      if (!mw) continue;
      const points: MuscleWeeklyPoint[] = [...mw.values()]
        .map((p) => ({
          week: p.week,
          sets: p.sets,
          sessions: p.sessions.size,
          volumeKg: p.volumeKg,
        }))
        .sort((a, b) => a.week.localeCompare(b.week));
      const totalSets = points.reduce((n, p) => n + p.sets, 0);
      const totalVolume = points.reduce((n, p) => n + p.volumeKg, 0);
      const tgt = targetBy.get(m);
      const sessionsLast4 =
        maxWeek ? countSessionsInWindow(points, maxWeek, 4) : 0;
      const actualLast4 = maxWeek ? sessionsLast4 / 4 : null;
      muscles.push({
        muscle: m,
        totalSets,
        totalVolumeKg: Math.round(totalVolume * 100) / 100,
        avgSetsPerWeek: average(points.map((p) => p.sets)),
        sessionsPerWeek: average(points.map((p) => p.sessions)),
        sessionsLast4Weeks: sessionsLast4,
        actualSessionsPerWeekLast4: actualLast4,
        last4WeekSetsAvg: maxWeek ? averageWeekWindow(points, maxWeek, 4) : null,
        last8WeekSetsAvg: maxWeek ? averageWeekWindow(points, maxWeek, 8) : null,
        targetSessionsPerWeek: tgt?.targetSessionsPerWeek ?? DEFAULT_TARGET_SESSIONS_PER_WEEK,
        targetNotes: tgt?.notes ?? null,
        onTarget: bandOnTarget(
          actualLast4,
          tgt?.targetSessionsPerWeek ?? DEFAULT_TARGET_SESSIONS_PER_WEEK,
        ),
        weekly: points,
      });
    }

    // Frequency comparison is now done inline per muscle above.

    // Unmapped exercise names present in the data.
    const unmappedExercises = [...agg.keys()]
      .filter((n) => !muscleBy.has(n))
      .sort();

    return {
      exercises: exercisesSummary,
      weekly: weeklyBuckets,
      muscles,
      unmappedExercises,
      totalVolumeKg: Math.round(exercisesSummary.reduce((n, e) => n + e.totalVolumeKg, 0) * 100) / 100,
      totalSets: exercisesSummary.reduce((n, e) => n + e.totalSets, 0),
    };
  } catch (err) {
    console.warn('[hevy-calculations] exception:', err);
    return empty;
  }
}

/** Muscle display order (the canonical taxonomy). */
const MUSCLE_ORDER: string[] = [
  'Chest',
  'Shoulders',
  'Upper Back',
  'Lats',
  'Lower Back',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Traps',
  'Cardio',
  'Unmapped',
];

/** Average weekly sets over the last `n` calendar weeks (zero-filled). */
function averageWeekWindow(
  points: MuscleWeeklyPoint[],
  maxWeek: string,
  n: number,
): number | null {
  if (n <= 0) return null;
  const byWeek = new Map(points.map((p) => [p.week, p.sets]));
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) {
    const wk = addWeeks(maxWeek, -i);
    sum += byWeek.get(wk) ?? 0;
  }
  return Math.round((sum / n) * 10) / 10;
}

/** Sum sessions in the last `n` calendar weeks (zero-filled). */
function countSessionsInWindow(
  points: MuscleWeeklyPoint[],
  maxWeek: string,
  n: number,
): number {
  if (n <= 0) return 0;
  const byWeek = new Map(points.map((p) => [p.week, p.sessions]));
  let sum = 0;
  for (let i = n - 1; i >= 0; i--) {
    const wk = addWeeks(maxWeek, -i);
    sum += byWeek.get(wk) ?? 0;
  }
  return sum;
}
