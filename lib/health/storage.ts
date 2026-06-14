/**
 * Supabase CRUD helpers for ORION Health — redesigned for speed & insight.
 *
 * **Quick-log philosophy:**
 * - Sleep: bedtime, wake time, quality       (< 5 sec)
 * - Training: type, exercise, weight, reps, RPE (< 10 sec)
 * - Nutrition: calories, protein              (< 5 sec)
 * - Recovery: energy, stress, soreness        (< 5 sec)
 *
 * **Safe by design:**
 * - Every function is wrapped in a top-level try/catch → NEVER throws.
 * - If auth fails, returns null / [] immediately — no query is made.
 * - All queries include `.eq('user_id', userId)` for RLS compatibility.
 * - All inserts include `user_id` in the payload.
 */
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';

// ─── Types matching Supabase schema ─────────────────────────────────

export interface SleepLog {
  id: string;
  sleep_start: string;
  sleep_end: string;
  quality: number;
  notes: string;
  created_at: string;
}

export interface Activity {
  id: string;
  activity_type: string;
  duration_minutes: number;
  intensity: 'low' | 'medium' | 'high';
  notes: string;
  created_at: string;
}

/** Simplified training log: one row = one exercise in a session */
export interface WorkoutLog {
  id: string;
  workout_type: string;           // free text: 'Upper', 'Push', 'Run', 'Cycling'
  exercise: string;               // primary exercise name
  weight_lbs: number | null;      // best working set weight (lbs)
  reps: number | null;            // best working set reps
  rpe: number;                    // perceived effort 1-10
  notes: string;
  created_at: string;
}

export interface PhysiqueLog {
  id: string;
  bodyweight: number | null;
  photo_url: string;
  notes: string;
  created_at: string;
}

/** Simplified nutrition: calories + protein in one daily log */
export interface NutritionLog {
  id: string;
  calories: number;
  protein_g: number;
  created_at: string;
}

/** Recovery state: energy, stress, soreness */
export interface RecoveryLog {
  id: string;
  energy_level: number;
  stress_level: number;
  soreness_level: number;
  notes: string;
  created_at: string;
}

// ─── Safe helpers ───────────────────────────────────────────────────

async function safeQuery<T>(
  fn: () => Promise<T>,
  label: string,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[storage] ${label} failed:`, err instanceof Error ? err.message : err);
    if (err && typeof err === 'object' && 'message' in err) {
      console.warn(`[storage] ${label} details:`, {
        code: (err as { code?: string }).code ?? 'unknown',
        details: (err as { details?: string }).details ?? '',
        hint: (err as { hint?: string }).hint ?? '',
      });
    }
    return fallback;
  }
}

function unwrapSingle<T>(result: { data: T | null; error: unknown }, label: string): T | null {
  if (result.error) {
    const err = result.error as { message?: string; code?: string; details?: string; hint?: string };
    console.warn(`[storage] ${label} query error:`, err.message ?? 'Unknown error', {
      code: err.code ?? 'unknown',
      details: err.details ?? '',
      hint: err.hint ?? '',
    });
    return null;
  }
  return result.data;
}

function unwrapList<T>(result: { data: T[] | null; error: unknown }, label: string): T[] {
  if (result.error) {
    const err = result.error as { message?: string; code?: string; details?: string; hint?: string };
    console.warn(`[storage] ${label} query error:`, err.message ?? 'Unknown error', {
      code: err.code ?? 'unknown',
      details: err.details ?? '',
      hint: err.hint ?? '',
    });
    return [];
  }
  return result.data ?? [];
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
      const err = error as { message?: string; code?: string; details?: string; hint?: string };
      const msg = `${err.message ?? 'Unknown error'} (code: ${err.code ?? 'unknown'})`;
      console.warn(`[storage] ${label} insert error:`, {
        message: err.message ?? 'Unknown error',
        code: err.code ?? 'unknown',
        details: err.details ?? '',
        hint: err.hint ?? '',
      });
      return { data: null, error: msg };
    }
    return { data: data as T, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[storage] ${label} insert exception:`, msg);
    return { data: null, error: msg };
  }
}

// ─── Sleep ──────────────────────────────────────────────────────────

export async function getLatestSleepLog(): Promise<SleepLog | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const result = await supabase
      .from('sleep_logs')
      .select('*')
      .eq('user_id', userId)
      .order('sleep_start', { ascending: false })
      .limit(1)
      .maybeSingle();
    return unwrapSingle(result, 'sleep_logs.getLatest');
  }, 'sleep_logs.getLatest', null);
}

export async function getSleepLogs(days = 7): Promise<SleepLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('sleep_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('sleep_start', since)
      .order('sleep_start', { ascending: false });
    return unwrapList(result, 'sleep_logs.getLogs');
  }, 'sleep_logs.getLogs', []);
}

export async function insertSleepLog(
  log: Omit<SleepLog, 'id' | 'created_at'>,
): Promise<InsertResult<SleepLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<SleepLog>(
    supabase.from('sleep_logs').insert({ ...log, user_id: userId }),
    'sleep_logs.insert',
  );
}

export async function updateSleepLog(
  id: string,
  updates: Partial<Omit<SleepLog, 'id' | 'user_id'>>,
): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('sleep_logs')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.warn('[storage] sleep_logs.update error:', error.message);
    return false;
  }
  return true;
}

// ─── Training (simplified workout logs) ─────────────────────────────

export async function getTrainingLogs(days = 7): Promise<WorkoutLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('training_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'training_logs.getList');
  }, 'training_logs.getList', []);
}

export async function insertTrainingLog(
  log: Omit<WorkoutLog, 'id' | 'created_at'> & { created_at?: string },
): Promise<InsertResult<WorkoutLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  const payload: Record<string, unknown> = { ...log, user_id: userId };
  if (!payload.created_at) {
    delete payload.created_at;
  }
  return insertAndSelect<WorkoutLog>(
    supabase.from('training_logs').insert(payload),
    'training_logs.insert',
  );
}

// ─── Activities ─────────────────────────────────────────────────────

export async function getRecentActivities(hours = 24): Promise<Activity[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'activities.getRecent');
  }, 'activities.getRecent', []);
}

export async function getActivities(days = 7): Promise<Activity[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('activities')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'activities.getList');
  }, 'activities.getList', []);
}

export async function insertActivity(
  log: Omit<Activity, 'id'>,
): Promise<InsertResult<Activity>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  const payload: Record<string, unknown> = { ...log, user_id: userId };
  if (!payload.created_at) {
    delete payload.created_at;
  }
  return insertAndSelect<Activity>(
    supabase.from('activities').insert(payload),
    'activities.insert',
  );
}

export async function updateActivity(
  id: string,
  updates: Partial<Omit<Activity, 'id' | 'user_id'>>,
): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;
  const { error } = await supabase
    .from('activities')
    .update(updates)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    console.warn('[storage] activities.update error:', error.message);
    return false;
  }
  return true;
}

// ─── Physique ───────────────────────────────────────────────────────

export async function getLatestPhysiqueLog(): Promise<PhysiqueLog | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const result = await supabase
      .from('physique_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return unwrapSingle(result, 'physique_logs.getLatest');
  }, 'physique_logs.getLatest', null);
}

export async function getPhysiqueLogs(days = 30): Promise<PhysiqueLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('physique_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'physique_logs.getList');
  }, 'physique_logs.getList', []);
}

export async function insertPhysiqueLog(
  log: Omit<PhysiqueLog, 'id' | 'created_at'> & { created_at?: string },
): Promise<InsertResult<PhysiqueLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  const payload: Record<string, unknown> = { ...log, user_id: userId };
  if (!payload.created_at) {
    delete payload.created_at;
  }
  return insertAndSelect<PhysiqueLog>(
    supabase.from('physique_logs').insert(payload),
    'physique_logs.insert',
  );
}

export async function uploadProgressPhoto(
  file: File,
): Promise<string | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const ts = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `${userId}/${ts}-${safeName}`;
    const { error } = await supabase.storage
      .from('progress-pics')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });
    if (error) {
      console.warn('[storage] uploadProgressPhoto error:', error.message);
      return null;
    }
    const { data: urlData } = supabase.storage
      .from('progress-pics')
      .getPublicUrl(filePath);
    return urlData?.publicUrl ?? null;
  }, 'uploadProgressPhoto', null);
}

// ─── Nutrition (calories + protein) ─────────────────────────────────

export async function getLatestNutritionLog(): Promise<NutritionLog | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const result = await supabase
      .from('nutrition_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return unwrapSingle(result, 'nutrition_logs.getLatest');
  }, 'nutrition_logs.getLatest', null);
}

export async function getNutritionLogs(days = 7): Promise<NutritionLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('nutrition_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'nutrition_logs.getList');
  }, 'nutrition_logs.getList', []);
}

export async function insertNutritionLog(
  log: Omit<NutritionLog, 'id' | 'created_at'> & { created_at?: string },
): Promise<InsertResult<NutritionLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  const payload: Record<string, unknown> = { ...log, user_id: userId };
  if (!payload.created_at) {
    delete payload.created_at;
  }
  return insertAndSelect<NutritionLog>(
    supabase.from('nutrition_logs').insert(payload),
    'nutrition_logs.insert',
  );
}

// ─── Recovery (energy, stress, soreness) ────────────────────────────

export async function getLatestRecoveryLog(): Promise<RecoveryLog | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const result = await supabase
      .from('recovery_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return unwrapSingle(result, 'recovery_logs.getLatest');
  }, 'recovery_logs.getLatest', null);
}

export async function getRecoveryLogs(days = 7): Promise<RecoveryLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('recovery_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'recovery_logs.getList');
  }, 'recovery_logs.getList', []);
}

export async function insertRecoveryLog(
  log: Omit<RecoveryLog, 'id' | 'created_at'> & { created_at?: string },
): Promise<InsertResult<RecoveryLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  const payload: Record<string, unknown> = { ...log, user_id: userId };
  if (!payload.created_at) {
    delete payload.created_at;
  }
  return insertAndSelect<RecoveryLog>(
    supabase.from('recovery_logs').insert(payload),
    'recovery_logs.insert',
  );
}

// ─── Legacy — Gym Logs (deprecated, use TrainingLogs) ──────────────

/** @deprecated Use getTrainingLogs instead */
export interface GymLog {
  id: string;
  exercise: string;
  sets: number;
  reps: number;
  weight: number;
  notes: string;
  created_at: string;
}

/** @deprecated Use getTrainingLogs instead */
export async function getGymLogs(days = 7): Promise<GymLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('gym_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'gym_logs.getList');
  }, 'gym_logs.getList', []);
}

/** @deprecated Use insertTrainingLog instead */
export async function insertGymLog(
  log: Omit<GymLog, 'id' | 'created_at'>,
): Promise<InsertResult<GymLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<GymLog>(
    supabase.from('gym_logs').insert({ ...log, user_id: userId }),
    'gym_logs.insert',
  );
}

// ─── Legacy — Manual Inputs (deprecated, use RecoveryLogs) ──────────

/** @deprecated Use RecoveryLog instead */
export interface ManualInput {
  id: string;
  energy_level: number;
  stress_level: number;
  soreness_level: number;
  mood: string;
  created_at: string;
}

/** @deprecated Use getRecoveryLogs instead */
export async function getLatestManualInput(): Promise<ManualInput | null> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return null;
    const result = await supabase
      .from('manual_inputs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return unwrapSingle(result, 'manual_inputs.getLatest');
  }, 'manual_inputs.getLatest', null);
}

/** @deprecated Use getRecoveryLogs instead */
export async function getManualInputs(days = 3): Promise<ManualInput[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('manual_inputs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'manual_inputs.getList');
  }, 'manual_inputs.getList', []);
}

/** @deprecated Use insertRecoveryLog instead */
export async function insertManualInput(
  log: Omit<ManualInput, 'id' | 'created_at'>,
): Promise<InsertResult<ManualInput>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<ManualInput>(
    supabase.from('manual_inputs').insert({ ...log, user_id: userId }),
    'manual_inputs.insert',
  );
}

// ─── Legacy — Workout Logs (deprecated, use TrainingLogs) ───────────

/** @deprecated Use WorkoutLog instead */
export interface LegacyWorkoutLog {
  id: string;
  workout_type: 'upper' | 'lower' | 'push' | 'pull' | 'legs' | 'full';
  exercise: string;
  set1_weight: number | null;
  set1_reps: number | null;
  set1_failure: boolean;
  set2_weight: number | null;
  set2_reps: number | null;
  set2_failure: boolean;
  warmup: string;
  created_at: string;
}

/** @deprecated Use getTrainingLogs instead */
export async function getWorkoutLogs(days = 7): Promise<LegacyWorkoutLog[]> {
  return safeQuery(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = await supabase
      .from('workout_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    return unwrapList(result, 'workout_logs.getList');
  }, 'workout_logs.getList', []);
}

/** @deprecated Use insertTrainingLog instead */
export async function insertWorkoutLog(
  log: Omit<LegacyWorkoutLog, 'id' | 'created_at'>,
): Promise<InsertResult<LegacyWorkoutLog>> {
  const userId = await getCurrentUserId();
  if (!userId) return { data: null, error: null };
  return insertAndSelect<LegacyWorkoutLog>(
    supabase.from('workout_logs').insert({ ...log, user_id: userId }),
    'workout_logs.insert',
  );
}

// ─── Legacy — Nutrition Logs (deprecated, use new NutritionLog) ─────

/** @deprecated Use NutritionLog instead */
export interface LegacyNutritionLog {
  id: string;
  water_ml: number;
  caffeine_mg: number;
  caffeine_time: string | null;
  creatine_taken: boolean;
  created_at: string;
}
