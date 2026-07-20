/**
 * Sleep-entry CRUD. `hours` is a generated column in Postgres — we
 * never write it.
 */
import { supabase } from '@/lib/supabase';
import type { SleepEntry } from './types';

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[fitness] ${label} exception:`, err);
    return fallback;
  }
}

export async function listSleepEntries(
  userId: string | null,
  sinceISO?: string,
): Promise<SleepEntry[]> {
  if (!userId) return [];
  return safeRun('listSleepEntries', async () => {
    let q = supabase
      .from('sleep_entries')
      .select('*')
      .eq('user_id', userId)
      .order('sleep_date', { ascending: false });
    if (sinceISO) q = q.gte('sleep_date', sinceISO);
    const { data, error } = await q;
    if (error) {
      console.warn('[fitness] listSleepEntries error:', error.message);
      return [];
    }
    return (data ?? []) as SleepEntry[];
  }, []);
}

export async function createSleepEntry(input: {
  user_id: string;
  sleep_date: string;             // YYYY-MM-DD
  bedtime: string;                // ISO timestamp
  wake_time: string;              // ISO timestamp
  quality?: number | null;
  notes?: string | null;
}): Promise<SleepEntry | null> {
  return safeRun('createSleepEntry', async () => {
    const { data, error } = await supabase
      .from('sleep_entries')
      .insert({
        user_id: input.user_id,
        sleep_date: input.sleep_date,
        bedtime: input.bedtime,
        wake_time: input.wake_time,
        quality: input.quality ?? null,
        notes: input.notes ?? null,
      })
      .select('*')
      .single();
    if (error) {
      console.warn('[fitness] createSleepEntry error:', error.message);
      return null;
    }
    return data as SleepEntry;
  }, null);
}

export async function deleteSleepEntry(id: string): Promise<boolean> {
  return safeRun('deleteSleepEntry', async () => {
    const { error } = await supabase
      .from('sleep_entries')
      .delete()
      .eq('id', id);
    if (error) {
      console.warn('[fitness] deleteSleepEntry error:', error.message);
      return false;
    }
    return true;
  }, false);
}

/** Convenience — compute the hours between two ISO timestamps. */
export function computeHours(bedISO: string, wakeISO: string): number {
  const ms = new Date(wakeISO).getTime() - new Date(bedISO).getTime();
  if (Number.isNaN(ms) || ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** Average hours across a list (e.g. last 7 entries). Returns null if empty. */
export function averageHours(entries: SleepEntry[]): number | null {
  if (entries.length === 0) return null;
  const sum = entries.reduce((acc, e) => acc + (e.hours ?? 0), 0);
  return Math.round((sum / entries.length) * 100) / 100;
}
