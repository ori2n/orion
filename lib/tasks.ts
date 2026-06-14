/**
 * Supabase CRUD helpers for the tasks (to-do) table.
 *
 * Follows the same patterns as lib/health/storage.ts:
 * - Every function is wrapped in safeQuery → NEVER throws.
 * - If auth fails, returns null / [] immediately.
 * - All queries include `.eq('user_id', userId)` for RLS compatibility.
 * - All inserts include `user_id` in the payload.
 */
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';

// ─── Types matching Supabase schema ─────────────────────────────────

export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  scheduled_for: string; // YYYY-MM-DD
  duration_minutes?: number | null;
  created_at: string;
}

// ─── Safe helpers (mirrors lib/health/storage.ts) ───────────────────

async function safeQuery<T>(
  fn: () => Promise<T>,
  label: string,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[tasks] ${label} failed:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

function unwrapList<T>(result: { data: T[] | null; error: unknown }, label: string): T[] {
  if (result.error) {
    const err = result.error as { message?: string };
    console.warn(`[tasks] ${label} query error:`, err.message ?? 'Unknown error');
    return [];
  }
  return result.data ?? [];
}

function unwrapSingle<T>(result: { data: T | null; error: unknown }, label: string): T | null {
  if (result.error) {
    const err = result.error as { message?: string };
    console.warn(`[tasks] ${label} query error:`, err.message ?? 'Unknown error');
    return null;
  }
  return result.data;
}

export interface InsertResult<T> {
  data: T | null;
  error: string | null;
}

async function insertAndSelect<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: any,
  label: string,
): Promise<InsertResult<T>> {
  try {
    const { data, error } = await builder.select().single();
    if (error) {
      const msg = error.message ?? 'Unknown error';
      console.warn(`[tasks] ${label} insert error:`, msg);
      return { data: null, error: msg };
    }
    return { data: data as T, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[tasks] ${label} insert exception:`, msg);
    return { data: null, error: msg };
  }
}

// ─── Read ───────────────────────────────────────────────────────────

/** Get all tasks, ordered by scheduled_for ascending. */
export async function getTasks(): Promise<Task[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const result = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .order('scheduled_for', { ascending: true })
      .order('created_at', { ascending: true });
    return unwrapList(result, 'getTasks');
  }, 'getTasks', []);
}

// ─── Create ─────────────────────────────────────────────────────────

export async function insertTask(
  task: Pick<Task, 'title' | 'scheduled_for'> & { duration_minutes?: number | null },
): Promise<InsertResult<Task>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<Task>(
    supabase.from('tasks').insert({
      title: task.title,
      scheduled_for: task.scheduled_for,
      duration_minutes: task.duration_minutes ?? null,
      user_id: userId,
    }),
    'insertTask',
  );
}

// ─── Update ─────────────────────────────────────────────────────────

/** Toggle a task between 'pending' and 'completed'. */
export async function toggleTaskStatus(id: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  // Read current status first
  const { data: current } = await supabase
    .from('tasks')
    .select('status')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (!current) return false;

  const newStatus = current.status === 'pending' ? 'completed' : 'pending';
  const { error } = await supabase
    .from('tasks')
    .update({ status: newStatus })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.warn('[tasks] toggleTaskStatus update error:', error.message);
    return false;
  }
  return true;
}

/** Move a task to a new scheduled_for date (used for drag-and-drop). */
export async function rescheduleTask(id: string, newDate: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { error } = await supabase
    .from('tasks')
    .update({ scheduled_for: newDate })
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.warn('[tasks] rescheduleTask update error:', error.message);
    return false;
  }
  return true;
}

// ─── Delete ─────────────────────────────────────────────────────────

/** Delete a single task by id. */
export async function deleteTask(id: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.warn('[tasks] deleteTask error:', error.message);
    return false;
  }
  return true;
}
