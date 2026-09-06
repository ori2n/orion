'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCurrentUserId } from '@/lib/auth';
import TodoList from '@/components/todo-list';
import CalendarPanel from '@/components/time-management/calendar-panel';
import HabitHistoryDashboard from '@/components/time-management/habit-history-dashboard';

type View = 'calendar' | 'habits' | 'todos';

type Habit = {
  id: string;
  name: string;
  frequency: string;
  custom_frequency?: string | null;
  created_at?: string;
};

type Completion = {
  habit_id: string;
  completed_date: string;
};

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isFutureIatError(message: string | undefined): boolean {
  const value = message?.toLowerCase() ?? '';
  return value.includes('jwt issued at future') || value.includes('issued at future') || value.includes('token is issued in the future');
}

const FUTURE_IAT_RETRY_DELAY_MS = 750;
const FUTURE_IAT_MAX_RETRIES = 3;

async function retryFutureIat<T extends { data: unknown; error: { message?: string } | null }>(run: () => PromiseLike<T>): Promise<T> {
  let result = await run();
  for (let attempt = 0; result.error && isFutureIatError(result.error.message) && attempt < FUTURE_IAT_MAX_RETRIES; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, FUTURE_IAT_RETRY_DELAY_MS));
    result = await run();
  }
  return result;
}

export default function TimeManagementPage() {
  const [view, setView] = useState<View>('calendar');
  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayCompletions, setTodayCompletions] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);


  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const uid = await getCurrentUserId();
    setUserId(uid);
    const [habitsResult, completionsResult] = await Promise.all([
      supabase.from('habits').select('*').order('created_at'),
      uid
        ? supabase.from('habit_completions').select('habit_id, completed_date').eq('user_id', uid).eq('completed_date', today())
        : Promise.resolve({ data: [], error: null }),
    ]);
    const fixedHabits = habitsResult.error && isFutureIatError(habitsResult.error.message)
      ? await retryFutureIat(() => supabase.from('habits').select('*').order('created_at'))
      : habitsResult;
    const fixedCompletions = completionsResult.error && uid && isFutureIatError(completionsResult.error.message)
      ? await retryFutureIat(() => supabase.from('habit_completions').select('habit_id, completed_date').eq('user_id', uid).eq('completed_date', today()))
      : completionsResult;

    if (fixedHabits.error) setError(`Failed to load habits: ${fixedHabits.error.message}`);
    else setHabits((fixedHabits.data ?? []) as Habit[]);
    if (fixedCompletions.error) setError(`Failed to load completions: ${fixedCompletions.error.message}`);
    else setTodayCompletions(new Set((fixedCompletions.data ?? []).map((row: Completion) => row.habit_id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const handleViewCycle = () => {
      setView((current) => current === 'habits' ? 'todos' : current === 'todos' ? 'calendar' : 'habits');
    };
    window.addEventListener('orion-time-view-cycle', handleViewCycle);
    return () => window.removeEventListener('orion-time-view-cycle', handleViewCycle);
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('orion-time-view-change', { detail: view }));
  }, [view]);

  if (loading) {
    return <div className="flex h-full w-full items-center justify-center bg-zinc-50 dark:bg-zinc-950"><div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" /></div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="text-base leading-none">🧭</span>
          <h1 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">Time Management</h1>
        </div>
        <span className="ml-auto hidden text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500 sm:block">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-hidden px-2 pb-2 sm:px-3">
        {error && <div className="mb-2 shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}<button type="button" onClick={() => setError(null)} className="ml-3 font-medium underline">Dismiss</button></div>}
        {view === 'calendar' && <div className="min-h-0 min-w-0 flex-1"><CalendarPanel refreshKey={calendarRefreshKey} habits={habits} habitCompletions={todayCompletions} onSidebarSchedule={() => setCalendarRefreshKey((value) => value + 1)} /></div>}
        {view === 'habits' && <HabitHistoryDashboard habits={habits} userId={userId} error={error} onError={setError} onChanged={() => void loadData()} />}
        {view === 'todos' && <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"><TodoList /></div>}
      </main>

    </div>
  );
}
