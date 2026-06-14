/**
 * User profile storage — shared across health + finance modules.
 *
 * Stores a single birth_date per user, from which age is computed.
 * Used by both the Health page (for input) and Finance page (for projections).
 */
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import { computeAge } from '@/lib/age';

// ─── Types ──────────────────────────────────────────────────────────

export interface UserProfile {
  user_id: string;
  birth_date: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Queries ────────────────────────────────────────────────────────

/**
 * Fetch the current user's profile (birth_date).
 * Returns null if no profile exists or if not authenticated.
 */
export async function getUserProfile(): Promise<UserProfile | null> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return data as UserProfile | null;
  } catch (err) {
    console.warn('[user-profile] get failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Get the computed age from the user's birth_date.
 * Returns null if no birth_date is set.
 */
export async function getUserAge(): Promise<number | null> {
  const profile = await getUserProfile();
  if (!profile?.birth_date) return null;
  return computeAge(profile.birth_date);
}

/**
 * Upsert the user's birth_date.
 * Creates the profile row if it doesn't exist, updates it if it does.
 */
export async function upsertBirthDate(birthDate: string): Promise<boolean> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return false;
    const { error } = await supabase.from('user_profiles').upsert(
      {
        user_id: userId,
        birth_date: birthDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) {
      console.warn('[user-profile] upsert error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[user-profile] upsert failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
