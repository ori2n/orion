import type { SupabaseClient } from '@supabase/supabase-js';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import type { HevyCalculations } from '@/lib/fitness/hevy/calc';
import type { AiToolExecutor } from './types';

export const ORION_TOOL_DECLARATIONS = [
  {
    name: 'get_calendar',
    description: 'Read fixed calendar commitments for a bounded date range. Tasks and habits are not calendar events unless explicitly scheduled by the user.',
    parameters: {
      type: 'OBJECT',
      properties: {
        start_date: { type: 'STRING', description: 'Start date in YYYY-MM-DD format. Defaults to today.' },
        days: { type: 'INTEGER', description: 'Number of calendar days to read, from 1 to 14. Defaults to 1.' },
      },
    },
  },
  {
    name: 'get_tasks',
    description: 'Read the authenticated user\'s one-off tasks, optionally filtered to a date and completion state.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'Optional date in YYYY-MM-DD format. Omit to read a bounded task list.' },
        include_completed: { type: 'BOOLEAN', description: 'Whether completed tasks should be included. Defaults to true.' },
      },
    },
  },
  {
    name: 'get_habits',
    description: 'Read the authenticated user\'s habits and today\'s completion state.',
    parameters: {
      type: 'OBJECT',
      properties: {
        include_completed_today: { type: 'BOOLEAN', description: 'Include today\'s completion state. Defaults to true.' },
      },
    },
  },
  {
    name: 'get_memory',
    description: 'Read the user\'s explicitly saved ORION AI memory, including goals, preferences, routines, facts, and projects.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'create_memory',
    description: 'Save one useful persistent memory only when the user explicitly asks ORION to remember it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', description: 'One of goal, preference, routine, fact, or project.' },
        memory_key: { type: 'STRING', description: 'Short stable key, maximum 80 characters.' },
        value: { type: 'STRING', description: 'The memory value, maximum 500 characters.' },
      },
      required: ['kind', 'memory_key', 'value'],
    },
  },
  {
    name: 'update_memory',
    description: 'Update one existing saved memory only when the user explicitly asks to change it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', description: 'One of goal, preference, routine, fact, or project.' },
        memory_key: { type: 'STRING', description: 'The exact saved memory key.' },
        value: { type: 'STRING', description: 'The replacement memory value, maximum 500 characters.' },
      },
      required: ['kind', 'memory_key', 'value'],
    },
  },
  {
    name: 'delete_memory',
    description: 'Delete one saved memory only when the user explicitly asks ORION to forget it.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', description: 'One of goal, preference, routine, fact, or project.' },
        memory_key: { type: 'STRING', description: 'The exact saved memory key.' },
      },
      required: ['kind', 'memory_key'],
    },
  },
  {
    name: 'get_fitness_summary',
    description: 'Read the authenticated user\'s calculated Hevy fitness summary including total sets, volume, exercise summaries, weekly totals, and muscle summaries.',
    parameters: {
      type: 'OBJECT',
      properties: {
        exercise_name: { type: 'STRING', description: 'Optional exact exercise name to focus the response.' },
      },
    },
  },
  {
    name: 'get_exercise_progress',
    description: 'Read dated strength progression for one Hevy exercise over a bounded number of recent entries.',
    parameters: {
      type: 'OBJECT',
      properties: {
        exercise_name: { type: 'STRING', description: 'Exact or partial Hevy exercise name.' },
        limit: { type: 'INTEGER', description: 'Maximum dated points, from 1 to 100. Defaults to 30.' },
      },
      required: ['exercise_name'],
    },
  },
  {
    name: 'get_workout_history',
    description: 'Read recent imported Hevy workout sessions with exercises and sets.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: { type: 'INTEGER', description: 'Number of workouts, from 1 to 10. Defaults to 5.' },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Create one simple task immediately. This is a low-risk Level 1 action; report the exact task created after success.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Task title, maximum 200 characters.' },
        scheduled_for: { type: 'STRING', description: 'Optional date in YYYY-MM-DD format.' },
        duration_minutes: { type: 'INTEGER', description: 'Optional estimated duration from 1 to 480 minutes.' },
        notes: { type: 'STRING', description: 'Optional task notes, maximum 2000 characters.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description: 'Mark one existing task complete immediately. This is a low-risk Level 1 action; verify the task belongs to the user first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_id: { type: 'STRING', description: 'The exact task id returned by get_tasks.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'uncomplete_task',
    description: 'Mark one existing task pending immediately. This is a low-risk Level 1 action; verify the task belongs to the user first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_id: { type: 'STRING', description: 'The exact task id returned by get_tasks.' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'move_task',
    description: 'Move one existing task to a new date immediately. This is a low-risk Level 1 action; verify the task belongs to the user first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task_id: { type: 'STRING', description: 'The exact task id returned by get_tasks.' },
        scheduled_for: { type: 'STRING', description: 'New date in YYYY-MM-DD format.' },
      },
      required: ['task_id', 'scheduled_for'],
    },
  },
  {
    name: 'complete_habit',
    description: 'Mark one existing habit complete for a date, defaulting to today. This is a low-risk Level 1 action; verify the habit belongs to the user first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        habit_id: { type: 'STRING', description: 'The exact habit id returned by get_habits.' },
        date: { type: 'STRING', description: 'Optional date in YYYY-MM-DD format. Defaults to today.' },
      },
      required: ['habit_id'],
    },
  },
  {
    name: 'uncomplete_habit',
    description: 'Remove one existing habit completion for a date, defaulting to today. This is a low-risk Level 1 action; verify the habit belongs to the user first.',
    parameters: {
      type: 'OBJECT',
      properties: {
        habit_id: { type: 'STRING', description: 'The exact habit id returned by get_habits.' },
        date: { type: 'STRING', description: 'Optional date in YYYY-MM-DD format. Defaults to today.' },
      },
      required: ['habit_id'],
    },
  },
] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function asDate(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  return value;
}

function asBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const MEMORY_KINDS = ['goal', 'preference', 'routine', 'fact', 'project'] as const;
type MemoryKind = (typeof MEMORY_KINDS)[number];

function memoryKind(value: unknown): MemoryKind {
  if (typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)) {
    return value as MemoryKind;
  }
  throw new Error('kind must be goal, preference, routine, fact, or project.');
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  const result = clampString(value, maxLength);
  if (!result) throw new Error(`${field} is required.`);
  return result;
}

function requiredUuid(value: unknown, field: string): string {
  const result = requiredString(value, field, 80);
  if (!/^[0-9a-f-]{36}$/i.test(result)) throw new Error(`${field} must be a valid id.`);
  return result;
}

function clampString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function compactHevySummary(calculations: HevyCalculations, exerciseName: string | null) {
  const exercises = exerciseName
    ? calculations.exercises.filter((exercise) => exercise.name.toLowerCase().includes(exerciseName.toLowerCase()))
    : calculations.exercises.slice(0, 100);
  return {
    total_volume_kg: calculations.totalVolumeKg,
    total_sets: calculations.totalSets,
    exercise_count: calculations.exercises.length,
    exercises,
    weekly: calculations.weekly.slice(-16),
    muscles: calculations.muscles,
    unmapped_exercises: calculations.unmappedExercises,
  };
}

async function getCalendar(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const startDate = asDate(args.start_date, today());
  const days = asBoundedInteger(args.days, 1, 1, 14);
  const endDate = addDays(startDate, days);
  const { data, error } = await db
    .from('calendar_events')
    .select('id, title, start_at, end_at, location, notes, color, all_day, recurrence, source')
    .eq('user_id', userId)
    .gte('start_at', `${startDate}T00:00:00.000Z`)
    .lt('start_at', `${endDate}T00:00:00.000Z`)
    .order('start_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(`Calendar read failed: ${error.message}`);
  return { start_date: startDate, days, events: data ?? [] };
}

async function getTasks(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const date = typeof args.date === 'string' ? asDate(args.date, '') : null;
  const includeCompleted = asBoolean(args.include_completed, true);
  let query = db
    .from('tasks')
    .select('id, title, status, scheduled_for, duration_minutes, notes, created_at')
    .eq('user_id', userId)
    .order('scheduled_for', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(200);
  if (date) query = query.eq('scheduled_for', date);
  if (!includeCompleted) query = query.eq('status', 'pending');
  const { data, error } = await query;
  if (error) throw new Error(`Task read failed: ${error.message}`);
  return { date, include_completed: includeCompleted, tasks: data ?? [] };
}

async function getHabits(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const includeCompletedToday = asBoolean(args.include_completed_today, true);
  const { data: habits, error: habitsError } = await db
    .from('habits')
    .select('id, name, frequency, custom_frequency, tag_id, duration_minutes, priority')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (habitsError) throw new Error(`Habit read failed: ${habitsError.message}`);

  if (!includeCompletedToday) return { date: today(), habits: habits ?? [] };
  const { data: completions, error: completionError } = await db
    .from('habit_completions')
    .select('habit_id, completed_date')
    .eq('user_id', userId)
    .eq('completed_date', today())
    .limit(200);
  if (completionError) throw new Error(`Habit completion read failed: ${completionError.message}`);
  const completedIds = new Set((completions ?? []).map((completion) => completion.habit_id));
  return {
    date: today(),
    habits: (habits ?? []).map((habit) => ({ ...habit, completed_today: completedIds.has(habit.id) })),
  };
}

async function getMemory(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from('ai_memory')
    .select('id, kind, memory_key, value, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Memory read failed: ${error.message}`);
  return { memories: data ?? [] };
}

async function writeMemory(
  db: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  mode: 'create' | 'update',
) {
  const kind = memoryKind(args.kind);
  const memoryKey = requiredString(args.memory_key, 'memory_key', 80);
  const value = requiredString(args.value, 'value', 500);
  const payload = {
    user_id: userId,
    kind,
    memory_key: memoryKey,
    value,
    updated_at: new Date().toISOString(),
  };
  const query = mode === 'create'
    ? db.from('ai_memory').upsert(payload, { onConflict: 'user_id,kind,memory_key' })
    : db.from('ai_memory').update({ value, updated_at: payload.updated_at }).eq('user_id', userId).eq('kind', kind).eq('memory_key', memoryKey);
  const { data, error } = await query.select('id, kind, memory_key, value, updated_at').maybeSingle();
  if (error || !data) {
    throw new Error(`Memory ${mode} failed: ${error?.message ?? 'Memory was not returned.'}`);
  }
  return { action: mode === 'create' ? 'created' : 'updated', memory: data };
}

async function deleteMemory(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const kind = memoryKind(args.kind);
  const memoryKey = requiredString(args.memory_key, 'memory_key', 80);
  const { data, error } = await db
    .from('ai_memory')
    .delete()
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('memory_key', memoryKey)
    .select('id, kind, memory_key, value')
    .maybeSingle();
  if (error) throw new Error(`Memory deletion failed: ${error.message}`);
  if (!data) throw new Error('Memory not found for this user.');
  return { action: 'deleted', memory: data };
}

async function getFitnessSummary(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const calculations = await computeHevyCalculations(userId, undefined, db);
  return compactHevySummary(calculations, clampString(args.exercise_name, 120));
}

async function getExerciseProgress(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const exerciseName = clampString(args.exercise_name, 120);
  if (!exerciseName) throw new Error('exercise_name is required.');
  const limit = asBoundedInteger(args.limit, 30, 1, 100);

  const { data: exercises, error: exerciseError } = await db
    .from('hevy_workout_exercises')
    .select('id, workout_id, name')
    .eq('user_id', userId)
    .ilike('name', `%${exerciseName}%`)
    .limit(20);
  if (exerciseError) throw new Error(`Exercise progress read failed: ${exerciseError.message}`);
  const exerciseRows = (exercises ?? []) as Array<{ id: string; workout_id: string; name: string }>;
  const exerciseIds = exerciseRows.map((exercise) => exercise.id);
  if (exerciseIds.length === 0) return { exercise_name: exerciseName, matches: [], points: [] };

  const workoutIds = [...new Set(exerciseRows.map((exercise) => exercise.workout_id))];
  const [{ data: workouts, error: workoutError }, { data: sets, error: setError }] = await Promise.all([
    db.from('hevy_workouts').select('id, start_time, title').eq('user_id', userId).in('id', workoutIds),
    db.from('hevy_workout_sets').select('workout_exercise_id, set_index, weight_kg, reps, set_type').eq('user_id', userId).in('workout_exercise_id', exerciseIds).order('set_index', { ascending: true }),
  ]);
  if (workoutError) throw new Error(`Workout progress read failed: ${workoutError.message}`);
  if (setError) throw new Error(`Set progress read failed: ${setError.message}`);

  const workoutById = new Map((workouts ?? []).map((workout) => [workout.id, workout]));
  const exerciseById = new Map(exerciseRows.map((exercise) => [exercise.id, exercise]));
  const points = (sets ?? []).map((set) => {
    const exercise = exerciseById.get(set.workout_exercise_id);
    const workout = exercise ? workoutById.get(exercise.workout_id) : undefined;
    return {
      exercise_name: exercise?.name ?? exerciseName,
      date: workout?.start_time ?? null,
      workout_title: workout?.title ?? null,
      set_index: set.set_index,
      weight_kg: set.weight_kg,
      reps: set.reps,
      set_type: set.set_type,
    };
  }).filter((point) => point.date !== null).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, limit);

  return { exercise_name: exerciseName, matches: exerciseRows.map((exercise) => exercise.name), points };
}

async function createTask(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const title = requiredString(args.title, 'title', 200);
  const scheduledFor = args.scheduled_for === undefined || args.scheduled_for === null
    ? null
    : asDate(args.scheduled_for, '');
  if (args.scheduled_for !== undefined && args.scheduled_for !== null && !scheduledFor) {
    throw new Error('scheduled_for must be a date in YYYY-MM-DD format.');
  }
  const durationMinutes = args.duration_minutes === undefined || args.duration_minutes === null
    ? null
    : asBoundedInteger(args.duration_minutes, 30, 1, 480);
  const notes = args.notes === undefined || args.notes === null ? null : clampString(args.notes, 2000);
  const { data, error } = await db
    .from('tasks')
    .insert({
      user_id: userId,
      title,
      scheduled_for: scheduledFor,
      duration_minutes: durationMinutes,
      notes,
      status: 'pending',
    })
    .select('id, title, status, scheduled_for, duration_minutes, notes, created_at')
    .single();
  if (error || !data) throw new Error(`Task creation failed: ${error?.message ?? 'No task returned.'}`);
  return { action: 'created', task: data };
}

async function setTaskStatus(db: SupabaseClient, userId: string, args: Record<string, unknown>, status: 'pending' | 'completed') {
  const taskId = requiredUuid(args.task_id, 'task_id');
  const { data: current, error: readError } = await db
    .from('tasks')
    .select('id, title, status, scheduled_for, duration_minutes')
    .eq('user_id', userId)
    .eq('id', taskId)
    .maybeSingle();
  if (readError) throw new Error(`Task read failed: ${readError.message}`);
  if (!current) throw new Error('Task not found for this user.');
  if (current.status === status) return { action: 'unchanged', task: current };
  const { data, error } = await db
    .from('tasks')
    .update({ status })
    .eq('user_id', userId)
    .eq('id', taskId)
    .select('id, title, status, scheduled_for, duration_minutes')
    .single();
  if (error || !data) throw new Error(`Task update failed: ${error?.message ?? 'No task returned.'}`);
  return { action: status === 'completed' ? 'completed' : 'uncompleted', task: data };
}

async function moveTask(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const taskId = requiredUuid(args.task_id, 'task_id');
  const scheduledFor = asDate(args.scheduled_for, '');
  if (!scheduledFor) throw new Error('scheduled_for must be a date in YYYY-MM-DD format.');
  const { data, error } = await db
    .from('tasks')
    .update({ scheduled_for: scheduledFor })
    .eq('user_id', userId)
    .eq('id', taskId)
    .select('id, title, status, scheduled_for, duration_minutes')
    .maybeSingle();
  if (error) throw new Error(`Task move failed: ${error.message}`);
  if (!data) throw new Error('Task not found for this user.');
  return { action: 'moved', task: data };
}

async function setHabitCompletion(
  db: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  completed: boolean,
) {
  const habitId = requiredUuid(args.habit_id, 'habit_id');
  const date = args.date === undefined || args.date === null ? today() : asDate(args.date, '');
  if (!date) throw new Error('date must be a date in YYYY-MM-DD format.');

  const { data: habit, error: habitError } = await db
    .from('habits')
    .select('id, name')
    .eq('user_id', userId)
    .eq('id', habitId)
    .maybeSingle();
  if (habitError) throw new Error(`Habit read failed: ${habitError.message}`);
  if (!habit) throw new Error('Habit not found for this user.');

  if (completed) {
    const { error } = await db
      .from('habit_completions')
      .upsert(
        { habit_id: habitId, user_id: userId, completed_date: date },
        { onConflict: 'habit_id,completed_date', ignoreDuplicates: true },
      );
    if (error) throw new Error(`Habit completion failed: ${error.message}`);
    return { action: 'completed', habit, date };
  }

  const { error } = await db
    .from('habit_completions')
    .delete()
    .eq('habit_id', habitId)
    .eq('user_id', userId)
    .eq('completed_date', date);
  if (error) throw new Error(`Habit uncompletion failed: ${error.message}`);
  return { action: 'uncompleted', habit, date };
}

async function getWorkoutHistory(db: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const limit = asBoundedInteger(args.limit, 5, 1, 10);
  const { data: workouts, error: workoutError } = await db
    .from('hevy_workouts')
    .select('id, title, description, start_time, end_time, source_start_time')
    .eq('user_id', userId)
    .order('start_time', { ascending: false })
    .limit(limit);
  if (workoutError) throw new Error(`Workout history read failed: ${workoutError.message}`);
  const rows = (workouts ?? []) as Array<{ id: string; title: string | null; description: string | null; start_time: string | null; end_time: string | null; source_start_time: string }>;
  const ids = rows.map((workout) => workout.id);
  if (ids.length === 0) return { workouts: [] };
  const { data: exercises, error: exerciseError } = await db
    .from('hevy_workout_exercises')
    .select('id, workout_id, name, order_index')
    .eq('user_id', userId)
    .in('workout_id', ids)
    .order('order_index', { ascending: true });
  if (exerciseError) throw new Error(`Workout exercise read failed: ${exerciseError.message}`);
  const exerciseRows = (exercises ?? []) as Array<{ id: string; workout_id: string; name: string; order_index: number }>;
  const exerciseIds = exerciseRows.map((exercise) => exercise.id);
  const { data: sets, error: setError } = exerciseIds.length
    ? await db.from('hevy_workout_sets').select('workout_exercise_id, set_index, weight_kg, reps, duration_seconds, set_type').eq('user_id', userId).in('workout_exercise_id', exerciseIds).order('set_index', { ascending: true })
    : { data: [], error: null };
  if (setError) throw new Error(`Workout set read failed: ${setError.message}`);
  const setsByExercise = new Map<string, unknown[]>();
  for (const set of sets ?? []) {
    const list = setsByExercise.get(set.workout_exercise_id) ?? [];
    list.push({ set_index: set.set_index, weight_kg: set.weight_kg, reps: set.reps, duration_seconds: set.duration_seconds, set_type: set.set_type });
    setsByExercise.set(set.workout_exercise_id, list);
  }
  return {
    workouts: rows.map((workout) => ({
      ...workout,
      exercises: exerciseRows.filter((exercise) => exercise.workout_id === workout.id).map((exercise) => ({
        name: exercise.name,
        sets: setsByExercise.get(exercise.id) ?? [],
      })),
    })),
  };
}

export function createAiToolExecutor(
  db: SupabaseClient,
  userId: string,
  allowImmediateActions = false,
  allowMemoryActions = false,
): AiToolExecutor {
  return async (name, args) => {
    switch (name) {
      case 'get_calendar': return getCalendar(db, userId, args);
      case 'get_tasks': return getTasks(db, userId, args);
      case 'get_habits': return getHabits(db, userId, args);
      case 'get_memory': return getMemory(db, userId);
      case 'get_fitness_summary': return getFitnessSummary(db, userId, args);
      case 'get_exercise_progress': return getExerciseProgress(db, userId, args);
      case 'get_workout_history': return getWorkoutHistory(db, userId, args);
      case 'create_task':
        if (!allowImmediateActions) throw new Error('This action requires a clear user request.');
        return createTask(db, userId, args);
      case 'complete_task':
        if (!allowImmediateActions) throw new Error('This action requires a clear user request.');
        return setTaskStatus(db, userId, args, 'completed');
      case 'uncomplete_task':
        if (!allowImmediateActions) throw new Error('This action requires a clear user request.');
        return setTaskStatus(db, userId, args, 'pending');
      case 'move_task':
        if (!allowImmediateActions) throw new Error('This action requires a clear user request.');
        return moveTask(db, userId, args);
      case 'complete_habit':
        if (!allowImmediateActions) throw new Error('This action requires a clear user request.');
        return setHabitCompletion(db, userId, args, true);
      case 'uncomplete_habit':
        if (!allowImmediateActions) throw new Error('This action requires a clear user request.');
        return setHabitCompletion(db, userId, args, false);
      case 'create_memory':
        if (!allowMemoryActions) throw new Error('Saving memory requires an explicit remember request.');
        return writeMemory(db, userId, args, 'create');
      case 'update_memory':
        if (!allowMemoryActions) throw new Error('Changing memory requires an explicit remember request.');
        return writeMemory(db, userId, args, 'update');
      case 'delete_memory':
        if (!allowMemoryActions) throw new Error('Deleting memory requires an explicit forget request.');
        return deleteMemory(db, userId, args);
      default: throw new Error(`Unknown AI tool: ${name}`);
    }
  };
}
