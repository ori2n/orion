/**
 * Auth helpers — thin wrappers around Supabase Auth.
 *
 * Uses the SSR-compatible browser client so the session persists
 * across page refreshes via cookies.
 */
import { createClient } from '@/lib/supabase/client';

/**
 * Get the current authenticated user's ID.
 * Returns `null` if no session exists — never throws.
 *
 * Call this at the start of any Supabase operation that needs
 * to be scoped to a specific user or comply with RLS policies.
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    // If the network is down or Supabase is unreachable,
    // return null so the caller can return an empty/fallback state.
    return null;
  }
}
