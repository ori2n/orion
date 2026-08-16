/**
 * Pure Hevy calculation helpers + result types.
 *
 * Deliberately free of Supabase/React imports so these can be unit-tested
 * in isolation (plain Node) against the real data — the same pattern as
 * `parser.ts`.
 *
 * Conventions:
 *   - Volume = weight × reps (kg). Bodyweight/timed sets contribute 0.
 *   - Estimated 1RM uses the Epley formula (w × (1 + reps/30)) with reps
 *     clamped to ≤ 10; it is a display metric and NEVER overwrites the
 *     manual 1RM.
 *   - Weeks are bucketed by the UTC Monday of a workout's start time.
 */
import type { Muscle } from './muscle-data';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Volume for one set: weight × reps (0 when either is missing). */
export function setVolumeKg(weightKg: number | null, reps: number | null): number {
  if (weightKg === null || reps === null) return 0;
  return round2(weightKg * reps);
}

/** Estimated 1RM via Epley, reps clamped to ≤ 10. Null for non-lift sets. */
export function estimate1RM(
  weightKg: number | null,
  reps: number | null,
): number | null {
  if (weightKg === null || reps === null || weightKg <= 0 || reps < 1) return null;
  const r = Math.min(reps, 10);
  return round1(weightKg * (1 + r / 30));
}

/** UTC Monday of the week containing `date`, as 'YYYY-MM-DD'. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday=1 .. Sunday=7
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

/** Add `n` weeks to a 'YYYY-MM-DD' week key. */
export function addWeeks(weekKey: string, n: number): string {
  const d = new Date(weekKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString().slice(0, 10);
}

/** Arithmetic mean (null for empty input). */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Mean of the last `window` values. */
export function movingAverage(values: number[], window: number): number | null {
  if (values.length === 0) return null;
  return average(values.slice(-window));
}

// ─── Result types ──────────────────────────────────────────────────

export interface ExerciseSummary {
  name: string;
  muscle: Muscle | null;
  heaviestWeightKg: number | null;
  estimated1rmKg: number | null;
  manual1rmKg: number | null;
  totalVolumeKg: number;
  totalSets: number;
  firstTrained: string | null;
  lastTrained: string | null;
}

export interface WeeklyBucket {
  week: string;
  volumeKg: number;
  sets: number;
  sessions: number;
}

export interface MuscleWeeklyPoint {
  week: string;
  sets: number;
  sessions: number;
  volumeKg: number;
}

export interface MuscleSummary {
  muscle: string;
  totalSets: number;
  totalVolumeKg: number;
  /** Sets per week across weeks the muscle was actually trained. */
  avgSetsPerWeek: number | null;
  /** Training frequency: sessions per week across active weeks. */
  sessionsPerWeek: number | null;
  /** Average weekly sets over the last 4 calendar weeks (zero-filled). */
  last4WeekSetsAvg: number | null;
  /** Average weekly sets over the last 8 calendar weeks (zero-filled). */
  last8WeekSetsAvg: number | null;
  /** Configurable target (default 2 sessions/week). */
  targetSessionsPerWeek: number;
  onTarget: boolean | null;
  weekly: MuscleWeeklyPoint[];
}

export interface HevyCalculations {
  exercises: ExerciseSummary[];
  weekly: WeeklyBucket[];
  muscles: MuscleSummary[];
  /** Exercise names present in data but missing a muscle mapping. */
  unmappedExercises: string[];
  totalVolumeKg: number;
  totalSets: number;
}
