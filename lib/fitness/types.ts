/**
 * Shared TypeScript types for the ORION Fitness module.
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


