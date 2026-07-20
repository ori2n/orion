/**
 * Strength analytics — pure functions for estimated-1RM, PR tier
 * ranking, and exercise-stats aggregation. No DB calls here — callers
 * fetch the raw sets from `workouts.ts` and pass them in for
 * aggregation. Keeps the algorithm 100% testable and side-effect free.
 */
import type {
  Exercise,
  Workout,
  WorkoutSet,
  ExerciseStats,
  PREntry,
  WorkoutPeak,
} from './types';

/**
 * Epley estimated-1RM formula: `weight * (1 + reps/30)`.
 *
 * Accuracy drops sharply beyond 10 reps, so we cap the input at 10
 * (sets with more reps return their actual weight as the estimate —
 * i.e. epley(weight, 10) which is `weight * 4/3`). Sets with no reps
 * return 0.
 */
export function estimated1RM(weightKg: number, reps: number): number {
  if (!Number.isFinite(weightKg) || weightKg <= 0 || !Number.isInteger(reps) || reps <= 0) return 0;
  const cappedReps = Math.min(reps, 10);
  return weightKg * (1 + cappedReps / 30);
}

/**
 * Build the per-exercise stats object from a flat set list.
 * Pure — does no DB I/O. The caller supplies the workout map (workout_id
 * → performed_at) so we can attach timestamps.
 */
export function buildExerciseStats(
  exercise: Exercise,
  sets: WorkoutSet[],
  workoutMap: Map<string, Workout>,
): ExerciseStats {
  const exSets = sets.filter((s) => s.exercise_id === exercise.id);
  if (exSets.length === 0) {
    return {
      exercise,
      actual_1rm: null,
      estimated_1rm: null,
      estimated_1rm_at: null,
      timeline: [],
      pr_leaderboard: [],
      total_volume_kg: 0,
      workouts_count: 0,
    };
  }

  // Estimated 1RM per set.
  const withEst = exSets.map((s) => ({
    set: s,
    est: estimated1RM(s.weight_kg, s.reps),
    performed_at: workoutMap.get(s.workout_id)?.performed_at ?? s.created_at,
  }));

  // Workout-day peak per (workout_id) — for the timeline.
  const peakByWorkout = new Map<string, (typeof withEst)[number]>();
  for (const x of withEst) {
    const cur = peakByWorkout.get(x.set.workout_id);
    if (!cur || x.est > cur.est) peakByWorkout.set(x.set.workout_id, x);
  }

  // Chronological timeline (oldest → newest).
  const timeline = Array.from(peakByWorkout.values())
    .sort(
      (a, b) =>
        new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime(),
    )
    .map((x) => ({
      at: x.performed_at,
      estimated_1rm: Math.round(x.est * 100) / 100,
      weight_kg: x.set.weight_kg,
      reps: x.set.reps,
    }));

  // Best estimated 1RM (across all workouts).
  const bestEst = withEst.reduce(
    (acc, x) => (x.est > acc.est ? x : acc),
    withEst[0],
  );

  // Best actual 1RM = max weight at reps === 1.
  const oneRepMaxes = exSets.filter((s) => s.reps === 1);
  const actual1RM =
    oneRepMaxes.length === 0 ? null : Math.max(...oneRepMaxes.map((s) => s.weight_kg));

  // PR leaderboard:
  //   Group sets by rep_count (1..10) → max weight per group → flatten,
  //   sort by weight DESC. Top 3 = the user's best-ever top-tier PRs.
  const byRep = new Map<number, WorkoutSet>();
  for (const s of exSets) {
    const cur = byRep.get(s.reps);
    if (!cur || s.weight_kg > cur.weight_kg) byRep.set(s.reps, s);
  }
  const prRaw = Array.from(byRep.values()).sort((a, b) => b.weight_kg - a.weight_kg);
  const prLeaderboard: PREntry[] = prRaw.slice(0, 3).map((s) => ({
    exercise_id: exercise.id,
    exercise_name: exercise.name,
    weight_kg: s.weight_kg,
    reps: s.reps,
    estimated_1rm: estimated1RM(s.weight_kg, s.reps),
    achieved_at:
      workoutMap.get(s.workout_id)?.performed_at ?? s.created_at,
    workout_id: s.workout_id,
  }));

  const totalVolume = exSets.reduce(
    (acc, s) => acc + s.weight_kg * s.reps,
    0,
  );
  const workoutsCount = new Set(exSets.map((s) => s.workout_id)).size;

  return {
    exercise,
    actual_1rm: actual1RM,
    estimated_1rm: Math.round(bestEst.est * 100) / 100,
    estimated_1rm_at: bestEst.performed_at,
    timeline,
    pr_leaderboard: prLeaderboard,
    total_volume_kg: Math.round(totalVolume),
    workouts_count: workoutsCount,
  };
}

/**
 * Human-readable progress deltas — e.g. "Bench press estimated 1RM
 * increased by 17.5kg since October". Returns null when the comparison
 * anchor yields no data.
 */
export function describeProgressDelta(
  stats: ExerciseStats,
  compareSinceISO: string,
): string | null {
  if (stats.timeline.length < 2) return null;
  const anchor = stats.timeline.find((p) => p.at >= compareSinceISO);
  if (!anchor || anchor === stats.timeline[stats.timeline.length - 1]) return null;
  const latest = stats.timeline[stats.timeline.length - 1];
  const kgDelta =
    Math.round((latest.estimated_1rm - anchor.estimated_1rm) * 10) / 10;
  if (kgDelta === 0) return null;
  const arrow = kgDelta > 0 ? '↑' : '↓';
  return `${stats.exercise.name} estimated 1RM ${arrow} ${Math.abs(kgDelta).toFixed(1)}kg since ${formatMonthLabel(compareSinceISO)}.`;
}

function formatMonthLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** Build a flat per-workout/per-exercise peak table — useful for charts. */
export function buildWorkoutPeaks(
  sets: WorkoutSet[],
  workouts: Workout[],
  exercises: Exercise[],
): WorkoutPeak[] {
  const wmap = new Map(workouts.map((w) => [w.id, w]));
  const emap = new Map(exercises.map((e) => [e.id, e]));
  const peakByWorkoutExercise = new Map<string, WorkoutPeak>();
  for (const s of sets) {
    const w = wmap.get(s.workout_id);
    const e = emap.get(s.exercise_id);
    if (!w || !e) continue;
    const est = estimated1RM(s.weight_kg, s.reps);
    const key = `${s.workout_id}|${s.exercise_id}`;
    const cur = peakByWorkoutExercise.get(key);
    if (!cur || est > cur.estimated_1rm) {
      peakByWorkoutExercise.set(key, {
        workout_id: s.workout_id,
        performed_at: w.performed_at,
        name: w.name,
        exercise_id: s.exercise_id,
        exercise_name: e.name,
        weight_kg: s.weight_kg,
        reps: s.reps,
        estimated_1rm: Math.round(est * 100) / 100,
      });
    }
  }
  return Array.from(peakByWorkoutExercise.values()).sort(
    (a, b) => new Date(a.performed_at).getTime() - new Date(b.performed_at).getTime(),
  );
}

/**
 * Convenience: aggregate `estimated_1rm` deltas across all exercises
 * within the last `days` days for a sidebar-style summary card.
 */
export function overallEstimated1RM(
  workoutPeaks: WorkoutPeak[],
  days = 30,
): { value: number; delta: number } | null {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = workoutPeaks.filter(
    (p) => new Date(p.performed_at).getTime() >= cutoff,
  );
  if (recent.length === 0) return null;
  const maxEst = Math.max(...recent.map((p) => p.estimated_1rm));
  // Compare to the peak just before the window opens.
  const before = workoutPeaks.filter(
    (p) => new Date(p.performed_at).getTime() < cutoff,
  );
  if (before.length === 0) return { value: maxEst, delta: 0 };
  const priorPeak = Math.max(...before.map((p) => p.estimated_1rm));
  return { value: Math.round(maxEst * 10) / 10, delta: Math.round((maxEst - priorPeak) * 10) / 10 };
}
