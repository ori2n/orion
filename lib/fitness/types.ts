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

/**
 * WorkoutSet — one row per (workout, exercise) in the **summary** model.
 *
 * After the workout-summary migration (`supabase-workout-summary-migration.sql`)
 * a `WorkoutSet` row no longer represents a single lift; it represents
 * the **best working set** for that exercise on that day, plus the
 * working-set count that produced it.
 *
 *   - `weight_kg`  : best working set weight (heaviest acceptable lift)
 *   - `reps`       : best working set reps (`NULL` if user skipped this)
 *                    Treated as `1` for PR detection / Epley so users
 *                    who log just weight still capture their "1RM".
 *   - `working_sets_count` : number of working sets performed
 *                    (NULL = legacy multi-set row, treated as 1)
 *
 * AI / Hevy / voice imports land in this same row shape — one summary
 * per exercise — keeping schema uniform regardless of input source.
 */
export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  user_id: string;
  set_order: number;
  weight_kg: number;
  /**
   * Best working set reps — NULL allowed after the workout-summary
   * migration. Analytics treat NULL as 1 rep (so a 100kg weight-only
   * log still surfaces as a candidate "1RM" PR).
   */
  reps: number | null;
  rpe: number | null;
  notes: string | null;
  /**
   * Count of working sets the user performed for this exercise.
   * NULL = legacy pre-migration row (treated as 1 set in analytics)
   * so existing data continues to flow through chart math correctly.
   */
  working_sets_count: number | null;
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
/**
 * Free-form pose label. The fitness migration constrains string length
 * (≤32 chars) but no specific values — the UI exposes
 * front/back/side/other quick-picks plus a "Custom…" text input.
 */
export type PhysiquePoseLabel = string;

/**
 * Photo row + favouriting + album metadata.
 *
 * `is_favourited` drives whether a photo auto-appears in the
 * curated Timeline. `featured_at` is set when the user stars it
 * (used to break ties on the dashboard hero pick).
 *
 * `session_title` and `cover_photo_id` are DENORMALIZED across
 * every photo of a session — same pattern as `notes` and
 * `body_weight_kg`. Editing the session's title or cover writes
 * the new value to every photo on that date.
 *
 * Why denormalized instead of a dedicated `physique_sessions`
 * table: see the rationale block at the top of
 * `lib/supabase-physique-photos-fix-migration.sql`. In short: the
 * photo rows already encode every session-level field; a join
 * table would add a JOIN on every read without giving us anything
 * we can't already read off the first row of the session.
 */
export interface PhysiquePhoto {
  id: string;
  user_id: string;
  taken_at: string;               // YYYY-MM-DD
  pose_type: PhysiquePoseLabel | null;
  photo_path: string;             // Storage object key
  body_weight_kg: number | null;
  notes: string | null;
  is_favourited: boolean;
  featured_at: string | null;
  /** User-given album name (e.g. "Summer Bulk"). NULL = untitled. */
  session_title: string | null;
  /** Pointer to this session's chosen cover photo. NULL = use first uploaded. */
  cover_photo_id: string | null;
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
  /** Best single-rep weight ever (max weight at reps === 1 or NULL). */
  actual_1rm: number | null;
  /** Best estimate from any set in any workout (Epley, capped 10 reps). */
  estimated_1rm: number | null;
  /** When the estimated_1rm was achieved. */
  estimated_1rm_at: string | null;
  /** Estimated 1RM over time — one point per workout, max within that workout. */
  timeline: Array<{
    at: string;
    estimated_1rm: number;
    weight_kg: number;
    /**
     * The reps that produced this timeline point. NULL means the
     * user logged weight-only on that entry.
     */
    reps: number | null;
  }>;
  /** Top-3 PRs (🥇🥈🥉 leaderboard). Treats NULL reps as 1. */
  pr_leaderboard: PREntry[];
  /**
   * Volume: Σ(weight × effective_reps × (working_sets_count ?? 1))
   * across every set. Tells a hypertrophy-focused user how much
   * load they actually moved.
   */
  total_volume_kg: number;
  /**
   * Σ(working_sets_count ?? 1) — the count of working sets performed
   * for this exercise across all time. Cleaner hypertrophy signal
   * than raw volume (which inflates with heavy weights).
   */
  total_working_sets: number;
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
