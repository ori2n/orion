/**
 * Shared TypeScript types for the ORION Fitness module.
 * Mirrors `lib/supabase-fitness-migration.sql` row shapes.
 */
export type ExerciseCategory =
  | 'push'
  | 'pull'
  | 'legs'
  | 'core'
  | 'cardio'
  | 'other';

export interface Exercise {
  id: string;
  user_id: string;
  name: string;
  category: ExerciseCategory | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  name: string | null;
  performed_at: string;          // ISO timestamp
  notes: string | null;
  /** Raw text from a voice/text input — preserved for future AI replay. */
  ai_raw_text: string | null;
  created_at: string;
}

export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  user_id: string;
  set_order: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  notes: string | null;
  created_at: string;
}

export interface WeightEntry {
  id: string;
  user_id: string;
  weight_kg: number;
  recorded_at: string;
  notes: string | null;
  created_at: string;
}

export interface WeightTarget {
  user_id: string;
  target_kg: number;
  set_at: string;
  notes: string | null;
}

export type PhysiquePose = 'front' | 'back' | 'side' | 'other';

export interface PhysiquePhoto {
  id: string;
  user_id: string;
  taken_at: string;               // YYYY-MM-DD
  pose_type: PhysiquePose | null;
  photo_path: string;            // Storage object key
  body_weight_kg: number | null;
  notes: string | null;
  created_at: string;
}

export interface SleepEntry {
  id: string;
  user_id: string;
  sleep_date: string;            // YYYY-MM-DD
  bedtime: string;               // ISO timestamp
  wake_time: string;             // ISO timestamp
  hours: number;                 // generated column
  quality: number | null;        // 1..5
  notes: string | null;
  created_at: string;
}

export interface DailyCheckin {
  id: string;
  user_id: string;
  checkin_date: string;
  sleep_id: string | null;
  workout_id: string | null;
  notes: string | null;
  created_at: string;
}

export type MilestoneKind = 'auto' | 'manual';

export interface Milestone {
  id: string;
  user_id: string;
  kind: MilestoneKind;
  title: string;
  description: string | null;
  achieved_at: string;
  related_data: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Pr leaderboard entry — computed at view time (not stored).
 * One row per (exercise, rep_count) for the user's best-ever set at
 * that rep count. Sorted by weight DESC; the user picks the top 3.
 */
export interface PREntry {
  exercise_id: string;
  exercise_name: string;
  weight_kg: number;
  reps: number;
  /** Estimated 1RM from this set, using Epley capped at 10 reps. */
  estimated_1rm: number;
  achieved_at: string;            // when this PR was set
  workout_id: string;
}

export interface ExerciseStats {
  exercise: Exercise;
  /** Best single-rep weight ever (max weight at reps === 1). */
  actual_1rm: number | null;
  /** Best estimate from any set in any workout (Epley, capped 10 reps). */
  estimated_1rm: number | null;
  /** When the estimated_1rm was achieved. */
  estimated_1rm_at: string | null;
  /** Estimated 1RM over time — one point per workout, max within that workout. */
  timeline: Array<{ at: string; estimated_1rm: number; weight_kg: number; reps: number }>;
  /** Top-3 PRs (🥇🥈🥉 leaderboard). */
  pr_leaderboard: PREntry[];
  /** Volume (kg × reps) total across all sets. */
  total_volume_kg: number;
  /** Number of workouts touching this exercise. */
  workouts_count: number;
}

/** One row per workout with the day's peak estimated 1RM per exercise. */
export interface WorkoutPeak {
  workout_id: string;
  performed_at: string;
  name: string | null;
  exercise_id: string;
  exercise_name: string;
  weight_kg: number;
  reps: number;
  estimated_1rm: number;
}
