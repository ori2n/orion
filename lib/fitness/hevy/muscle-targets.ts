/**
 * Per-muscle training targets + user notes.
 *
 * Reads + writes for `hevy_muscle_targets`. The calculation engine
 * (calculations.ts) merges these into the per-muscle summary so the
 * dashboard can answer "On target / Below target / Above target" using
 * the user's own target rather than hard-coded "2×/week".
 *
 * The notes column is user context — Stage 5 explicitly forbids any
 * pipeline (including the future ORION AI) from silently rewriting it.
 */
import { supabase } from '@/lib/supabase';

// ─── Row ────────────────────────────────────────────────────────────

export interface HevyMuscleTarget {
  id: string;
  /** Matches the canonical Muscle union. Lower-case comparison handled server-side. */
  muscle: string;
  /** 0 means "not actively targeted". */
  targetSessionsPerWeek: number;
  notes: string | null;
  updatedAt: string;
}

interface Row {
  id: string;
  muscle: string;
  target_sessions_per_week: number;
  notes: string | null;
  updated_at: string;
}

function mapRow(row: Row): HevyMuscleTarget {
  return {
    id: row.id,
    muscle: row.muscle,
    targetSessionsPerWeek: Number(row.target_sessions_per_week) || 0,
    notes: row.notes ?? null,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD ──────────────────────────────────────────────────────────

/** List all target rows for the user, alphabetical by muscle name. */
export async function listMuscleTargets(
  userId: string | null,
): Promise<HevyMuscleTarget[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('hevy_muscle_targets')
      .select('*')
      .eq('user_id', userId)
      .order('muscle', { ascending: true });
    if (error) {
      console.warn('[hevy-muscle-targets] list error:', error.message);
      return [];
    }
    return ((data ?? []) as Row[]).map(mapRow);
  } catch (err) {
    console.warn('[hevy-muscle-targets] list exception:', err);
    return [];
  }
}

/**
 * Upsert one (user, muscle) target row.
 *  - If `upsert: true` (default), inserts or updates.
 *  - Pass `notes: undefined` to preserve an existing note; pass
 *    `notes: null` (or any string) to overwrite it.
 */
export async function upsertMuscleTarget(
  userId: string | null,
  muscle: string,
  patch: { targetSessionsPerWeek?: number; notes?: string | null },
): Promise<boolean> {
  if (!userId) return false;
  try {
    // Read-then-upsert so an unspecified patch field doesn't clobber
    // what the user edited earlier.
    const { data: existing } = await supabase
      .from('hevy_muscle_targets')
      .select('target_sessions_per_week, notes')
      .eq('user_id', userId)
      .eq('muscle', muscle)
      .maybeSingle();

    const row = {
      user_id: userId,
      muscle,
      target_sessions_per_week:
        patch.targetSessionsPerWeek !== undefined
          ? patch.targetSessionsPerWeek
          : ((existing as { target_sessions_per_week: number } | null)?.target_sessions_per_week ?? 0),
      notes:
        patch.notes !== undefined
          ? patch.notes
          : ((existing as { notes: string | null } | null)?.notes ?? null),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('hevy_muscle_targets')
      .upsert(row, { onConflict: 'user_id,muscle' });
    if (error) {
      console.warn('[hevy-muscle-targets] upsert error:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[hevy-muscle-targets] upsert exception:', err);
    return false;
  }
}

/**
 * Bulk update target rows for the entire canonical muscle list in a
 * single round-trip. Used by the "apply to all" / seeding flow.
 * Skips rows whose target + notes already match the desired value.
 */
export async function bulkUpsertMuscleTargets(
  userId: string | null,
  rows: Array<{ muscle: string; targetSessionsPerWeek: number; notes: string | null }>,
): Promise<void> {
  if (!userId) return;
  for (const r of rows) {
    await upsertMuscleTarget(userId, r.muscle, {
      targetSessionsPerWeek: r.targetSessionsPerWeek,
      notes: r.notes,
    });
  }
}
