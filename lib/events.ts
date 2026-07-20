/**
 * Known event types for the ORION event stream.
 *
 * `HABIT_LOG`, `SLEEP_LOG`, and the fitness manual pipeline are
 * actively emitted by the UI. The remaining constants are reserved
 * for the future AI pipeline (voice intake, Hevy import, memory
 * engine) so listeners can rely on stable strings.
 *
 * Future AI pipeline (NOT yet wired to UI):
 *   - VOICE_WORKOUT_LOG   — voice transcript captured, awaiting parse
 *   - HEVY_IMPORT         — bulk import from Hevy CSV/JSON
 *   - MEMORY_RECALC       — flashback engine refreshes PR/milestone data
 *                          ── Physique pipeline ──────────────────────
 *   - PHOTO_FEATURED      — user starred an individual photo
 *   - PHOTO_DELETED       — user removed an individual photo
 *   - COMPARISON_VIEWED   — opened the before/after slider
 *   - SESSION_CREATED     — user uploaded a new progress session
 *   - SESSION_FEATURED    — user starred a whole session (timeline)
 *   - SESSION_UNFEATURED  — user unstarred a whole session
 *   - SESSION_NOTES_EDITED — user edited session-level notes/body weight
 */
import { supabase } from './supabase';

/**
 * Known event types for the ORION event stream.
 * Add new constants here as features are added.
 */
export const EventTypes = {
  /** Habit completion toggle */
  HABIT_LOG: 'habit_log',
  /** Sleep entry saved */
  SLEEP_LOG: 'sleep_log',
  /** Future: journal entries */
  JOURNAL_ENTRY: 'journal_entry',
  // ─── Fitness pipeline (backend-ready, UI not yet wired) ──────────────
  /** Workout saved (manual entry today; voice / Hevy tomorrow). */
  WORKOUT_LOG: 'workout_log',
  /** User edited an existing workout (sets added/removed/reordered). */
  WORKOUT_EDITED: 'workout_edited',
  /** User archived an exercise from their library. */
  EXERCISE_ARCHIVED: 'exercise_archived',
  /** User restored an archived exercise. */
  EXERCISE_RESTORED: 'exercise_restored',
  /** Future: voice transcript captured, awaiting parser mapping. */
  VOICE_WORKOUT_LOG: 'voice_workout_log',
  /** Future: bulk import from Hevy export. */
  HEVY_IMPORT: 'hevy_import',
  /** Future: flashback / milestone engine produced new outputs. */
  MEMORY_RECALC: 'memory_recalc',
  // ─── Physique pipeline ───────────────────────────────────────────────
  /** User starred an individual physique photo (timeline). */
  PHOTO_FEATURED: 'photo_featured',
  /** User unstarred an individual physique photo. */
  PHOTO_UNFEATURED: 'photo_unfeatured',
  /** User removed an individual physique photo. */
  PHOTO_DELETED: 'photo_deleted',
  /** User opened the before/after comparison overlay. */
  COMPARISON_VIEWED: 'comparison_viewed',
  /** User uploaded a new progress session (multi-photo with shared date + notes). */
  SESSION_CREATED: 'session_created',
  /** User starred a whole session (every photo on the date). */
  SESSION_FEATURED: 'session_featured',
  /** User unstarred a whole session. */
  SESSION_UNFEATURED: 'session_unfeatured',
  /** User edited session-level notes or body weight. */
  SESSION_NOTES_EDITED: 'session_notes_edited',
  /** User set or renamed a session's title (cover the clear case via a null payload). */
  SESSION_TITLE_EDITED: 'session_title_edited',
  /** User picked a different cover photo for a session. */
  SESSION_COVER_CHANGED: 'session_cover_changed',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/**
 * Log an event to the events table.
 *
 * This is the single entry point for all event logging.
 * AI agents can call this directly without touching UI state or components.
 * Always includes the authenticated user ID to comply with RLS.
 *
 * Never throws — failure is silently logged to console so the calling
 * UI action is not interrupted by analytics side effects.
 *
 * @param type  - The event type (use EventTypes constants).
 * @param payload - Arbitrary JSON-serializable payload.
 */
export async function logEvent(
  type: EventType | string,
  payload: Record<string, unknown>,
) {
  // Fetch the current user to comply with RLS on the events table.
  // Silently skip if no session — avoids blocking UI actions.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { error } = await supabase.from('events').insert({
    type,
    payload,
    user_id: user.id,
  });

  if (error) {
    // Log to console but don't throw — event logging should never
    // break the primary user action.
    console.error(`[events] Failed to log event "${type}":`, error.message);
  }
}
