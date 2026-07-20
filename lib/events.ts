import { supabase } from './supabase';

/**
 * Known event types for future AI agent actions.
 * Add new constants here as features are added.
 */
export const EventTypes = {
  /** Habit completion toggle */
  HABIT_LOG: 'habit_log',
  /** Future: journal entries */
  JOURNAL_ENTRY: 'journal_entry',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

/**
 * Log an event to the events table.
 *
 * This is the single entry point for all event logging.
 * AI agents can call this directly without touching UI state or components.
 * Always includes the authenticated user ID to comply with RLS.
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
