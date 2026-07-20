/**
 * Weight-entry CRUD + weight-target upsert.
 *
 * `weight_target` is one-row-per-user (PK on user_id), so we use an
 * UPSERT on insert and a plain UPDATE on set.
 */
import { supabase } from '@/lib/supabase';
import type { WeightEntry, WeightTarget } from './types';

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[fitness] ${label} exception:`, err);
    return fallback;
  }
}

export async function listWeightEntries(
  userId: string | null,
  sinceISO?: string,
): Promise<WeightEntry[]> {
  if (!userId) return [];
  return safeRun('listWeightEntries', async () => {
    let q = supabase
      .from('weight_entries')
      .select('*')
      .eq('user_id', userId)
      .order('recorded_at', { ascending: true });
    if (sinceISO) q = q.gte('recorded_at', sinceISO);
    const { data, error } = await q;
    if (error) {
      console.warn('[fitness] listWeightEntries error:', error.message);
      return [];
    }
    return (data ?? []) as WeightEntry[];
  }, []);
}

export async function createWeightEntry(input: {
  user_id: string;
  weight_kg: number;
  recorded_at?: string;
  notes?: string | null;
}): Promise<WeightEntry | null> {
  return safeRun('createWeightEntry', async () => {
    const { data, error } = await supabase
      .from('weight_entries')
      .insert({
        user_id: input.user_id,
        weight_kg: input.weight_kg,
        recorded_at: input.recorded_at ?? new Date().toISOString(),
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (error) {
      console.warn('[fitness] createWeightEntry error:', error.message);
      return null;
    }
    return data as WeightEntry;
  }, null);
}

export async function deleteWeightEntry(id: string): Promise<boolean> {
  return safeRun('deleteWeightEntry', async () => {
    const { error } = await supabase
      .from('weight_entries')
      .delete()
      .eq('id', id);
    if (error) {
      console.warn('[fitness] deleteWeightEntry error:', error.message);
      return false;
    }
    return true;
  }, false);
}

export async function getWeightTarget(userId: string | null): Promise<WeightTarget | null> {
  if (!userId) return null;
  return safeRun('getWeightTarget', async () => {
    const { data, error } = await supabase
      .from('weight_target')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[fitness] getWeightTarget error:', error.message);
      return null;
    }
    return (data as WeightTarget | null) ?? null;
  }, null);
}

/** Upsert: insert on first call, update on subsequent calls. */
export async function setWeightTarget(input: {
  user_id: string;
  target_kg: number;
  notes?: string | null;
}): Promise<WeightTarget | null> {
  return safeRun('setWeightTarget', async () => {
    const { data, error } = await supabase
      .from('weight_target')
      .upsert(
        {
          user_id: input.user_id,
          target_kg: input.target_kg,
          set_at: new Date().toISOString(),
          notes: input.notes ?? null,
        },
        { onConflict: 'user_id' },
      )
      .select('*')
      .single();
    if (error) {
      console.warn('[fitness] setWeightTarget error:', error.message);
      return null;
    }
    return data as WeightTarget;
  }, null);
}

/**
 * Quick progress digest — current weight vs target + % to go.
 * Returns `null` if no entries or no target.
 */
export interface WeightProgress {
  current_kg: number;
  target_kg: number;
  delta_kg: number;             // current - target (positive = above goal)
  direction_to_go: 'down' | 'up' | 'reached';
  pct_complete: number;         // 0..1
}

export function computeWeightProgress(
  entries: WeightEntry[],
  target: WeightTarget | null,
): WeightProgress | null {
  if (entries.length === 0 || !target) return null;
  const sorted = [...entries].sort(
    (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime(),
  );
  const current = sorted[0].weight_kg;
  const delta = current - target.target_kg;
  const reached = Math.abs(delta) < 0.1;
  const direction =
    reached ? 'reached' : delta > 0 ? 'down' /* need to lose */ : 'up' /* need to gain */;
  // Compute % complete using the first-ever entry as the origin.
  const origin = [...entries].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime(),
  )[0].weight_kg;
  const totalDelta = origin - target.target_kg;
  const pct =
    totalDelta === 0 ? 1 : Math.max(0, Math.min(1, (origin - current) / totalDelta));
  return {
    current_kg: current,
    target_kg: target.target_kg,
    delta_kg: Math.round(delta * 10) / 10,
    direction_to_go: direction,
    pct_complete: Math.round(pct * 100) / 100,
  };
}
