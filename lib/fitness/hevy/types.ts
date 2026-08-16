/**
 * Pure data types for the Hevy import module.
 *
 * These types mirror the columns of a standard Hevy CSV export and are
 * intentionally free of Supabase / React imports so the parser can be
 * unit-tested in isolation (plain Node) against a real export file.
 */

/** A single set within an exercise. */
export interface HevySet {
  setIndex: number;
  setType: string | null;
  weightKg: number | null;
  reps: number | null;
  distanceKm: number | null;
  durationSeconds: number | null;
  rpe: number | null;
}

/** An exercise block within a workout (its sets are contiguous). */
export interface HevyExercise {
  /** Hevy exercise title, e.g. "Bench Press (Barbell)". */
  name: string;
  /** Hevy superset group id. NULL = not supersetted. */
  supersetId: number | null;
  notes: string | null;
  /** Position of this exercise block within the workout (0-based). */
  orderIndex: number;
  sets: HevySet[];
}

/** One Hevy workout session. */
export interface HevyWorkout {
  title: string | null;
  description: string | null;
  /** Raw "16 Aug 2026, 19:23" string — used as the idempotency key. */
  sourceStartTime: string;
  sourceEndTime: string;
  /** Parsed timestamps (local time). Null if the raw string is malformed. */
  startTime: Date | null;
  endTime: Date | null;
  exercises: HevyExercise[];
}

/** Result of parsing a Hevy export. */
export interface HevyParseResult {
  workouts: HevyWorkout[];
  /** Non-fatal problems encountered while parsing. */
  warnings: string[];
}

/** Result of running a Hevy import against the database. */
export interface HevyImportDiagnostics {
  importId: string | null;
  status: 'completed' | 'failed';
  workoutsChecked: number;
  workoutsCreated: number;
  workoutsUpdated: number;
  workoutsUnchanged: number;
  setsProcessed: number;
  dateMin: string | null;
  dateMax: string | null;
  warnings: string[];
}
