'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Habit {
  id: string;
  name: string;
  frequency: string;
  custom_frequency?: string | null;
  created_at?: string | null;
}

interface CompletionRow {
  habit_id: string;
  completed_date: string;
}

interface HabitHistoryDashboardProps {
  habits: Habit[];
  userId: string | null;
  error: string | null;
  onError: (message: string | null) => void;
  onChanged: () => void;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEK_LABELS = ['This week', 'Last week', 'Two weeks ago'];
const WEEK_COUNT = 3;
const DAYS_PER_WEEK = 7;
const TOTAL_DAYS = WEEK_COUNT * DAYS_PER_WEEK;

type FrequencyGroup = {
  key: string;
  label: string;
  habits: Habit[];
};

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const mondayOffset = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - mondayOffset);
  return result;
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function buildDates(): Date[] {
  const currentWeek = startOfWeek(new Date());
  return Array.from({ length: TOTAL_DAYS }, (_, index) => {
    const weekOffset = Math.floor(index / DAYS_PER_WEEK);
    const dayOffset = index % DAYS_PER_WEEK;
    return addDays(currentWeek, -(weekOffset * DAYS_PER_WEEK) + dayOffset);
  });
}

function parseCustomFrequency(value: string | null | undefined): { everyDays?: number; perWeek?: number } {
  const text = (value ?? '').toLowerCase().trim();
  if (!text) return {};
  if (/every\s+other\s+day|alternate\s+day|隔日/.test(text)) return { everyDays: 2 };
  const perWeek = text.match(/(\d+)\s*(?:x|times?)?\s*(?:per|a|\/)?\s*week/);
  if (perWeek) return { perWeek: Math.max(1, Math.min(7, Number(perWeek[1]))) };
  if (/several|few/.test(text)) return { perWeek: 3 };
  if (/weekly|once\s+a\s+week/.test(text)) return { perWeek: 1 };
  return {};
}

function frequencyGroup(habit: Habit): string {
  const frequency = habit.frequency.toLowerCase();
  const custom = (habit.custom_frequency ?? '').toLowerCase();
  const schedule = `${frequency} ${custom}`;
  if (frequency === 'daily' || /daily|every\s+day/.test(schedule)) return 'daily';
  if (frequency === 'weekly' || /weekly|once\s+a\s+week/.test(schedule)) return 'weekly';
  if (/every\s+other|alternate|隔日/.test(schedule)) return 'every_other_day';
  if (/several|few|\d+\s*(?:x|times?)?\s*(?:per|a|\/)?\s*week/.test(schedule)) return 'several_per_week';
  return 'other';
}

function groupLabel(key: string): string {
  if (key === 'daily') return 'Daily habits';
  if (key === 'every_other_day') return 'Every other day';
  if (key === 'several_per_week') return 'Several times per week';
  if (key === 'weekly') return 'Weekly habits';
  return 'Other lower-frequency habits';
}

function isExpected(habit: Habit, date: Date): boolean {
  const group = frequencyGroup(habit);
  const anchor = new Date(habit.created_at ?? dateKey(new Date()));
  anchor.setHours(0, 0, 0, 0);
  if (date < anchor) return false;
  if (group === 'daily') return true;

  const custom = parseCustomFrequency(`${habit.frequency} ${habit.custom_frequency ?? ''}`);
  anchor.setHours(0, 0, 0, 0);
  const daysSinceAnchor = Math.round((date.getTime() - anchor.getTime()) / 86_400_000);
  if (group === 'every_other_day' || custom.everyDays) {
    return daysSinceAnchor >= 0 && daysSinceAnchor % (custom.everyDays ?? 2) === 0;
  }
  if (group === 'weekly') {
    return date.getDay() === anchor.getDay();
  }
  if (custom.perWeek) {
    const perWeek = custom.perWeek;
    const weekDay = (date.getDay() + 6) % 7;
    const scheduledDays = new Set(
      Array.from({ length: perWeek }, (_, index) => Math.floor((index * 7) / perWeek)),
    );
    return scheduledDays.has(weekDay);
  }
  return true;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function HabitHistoryDashboard({
  habits,
  userId,
  error,
  onError,
  onChanged,
}: HabitHistoryDashboardProps) {
  const dates = useMemo(() => buildDates(), []);
  const [completionKeys, setCompletionKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  // Bumped after every committed toggle so an in-flight history load can
  // detect that its snapshot went stale and avoid clobbering the update.
  const mutationEpochRef = useRef(0);
  const [newHabitName, setNewHabitName] = useState('');
  const [newFrequency, setNewFrequency] = useState('daily');
  const [newCustomFrequency, setNewCustomFrequency] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const loadCompletions = useCallback(async () => {
    if (!userId) {
      setCompletionKeys(new Set());
      setLoading(false);
      return;
    }
    setLoading(true);
    for (;;) {
      // Snapshot the mutation epoch before fetching: if a toggle commits while
      // this query is in flight, the snapshot is stale and must not overwrite
      // the fresh optimistic state.
      const epochAtStart = mutationEpochRef.current;
      // `dates` is NOT in chronological order: it is newest week first, each
      // week running Monday → Sunday. Bounding the query by dates[0] (the
      // current week's Monday) silently excluded every completion from
      // Tuesday onward, so checked days reset after a refresh; bounding by
      // dates[dates.length - 1] additionally dropped the older week's first
      // six days. Always derive the window from the actual min/max instead.
      const oldest = dates.reduce((min, date) => (date < min ? date : min), dates[0]);
      const newest = dates.reduce((max, date) => (date > max ? date : max), dates[0]);
      const { data, error: queryError } = await supabase
        .from('habit_completions')
        .select('habit_id, completed_date')
        .eq('user_id', userId)
        .gte('completed_date', dateKey(oldest))
        .lte('completed_date', dateKey(newest));
      if (queryError) {
        onError(`Failed to load habit history: ${queryError.message}`);
        setLoading(false);
        return;
      }
      if (mutationEpochRef.current === epochAtStart) {
        setCompletionKeys(new Set((data ?? []).map((row: CompletionRow) => `${row.habit_id}:${row.completed_date}`)));
        setLoading(false);
        return;
      }
      // A toggle committed mid-fetch — refetch so the snapshot includes it.
    }
  }, [dates, onError, userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCompletions();
  }, [loadCompletions]);

  const groups = useMemo<FrequencyGroup[]>(() => {
    const order = ['daily', 'every_other_day', 'several_per_week', 'weekly', 'other'];
    return order
      .map((key) => ({ key, label: groupLabel(key), habits: habits.filter((habit) => frequencyGroup(habit) === key) }))
      .filter((group) => group.habits.length > 0);
  }, [habits]);

  const dailyRates = useMemo(() => dates.slice(0, DAYS_PER_WEEK).map((date) => {
    const expected = habits.filter((habit) => isExpected(habit, date));
    const completed = expected.filter((habit) => completionKeys.has(`${habit.id}:${dateKey(date)}`)).length;
    return { expected: expected.length, completed, rate: expected.length ? Math.round((completed / expected.length) * 100) : 0 };
  }), [completionKeys, dates, habits]);

  async function toggleCompletion(habitId: string, date: Date) {
    if (!userId) return;
    const key = `${habitId}:${dateKey(date)}`;
    if (busyKeys.has(key)) return;
    setBusyKeys((current) => new Set(current).add(key));
    const wasCompleted = completionKeys.has(key);
    const result = wasCompleted
      ? await supabase.from('habit_completions').delete().eq('habit_id', habitId).eq('user_id', userId).eq('completed_date', dateKey(date))
      : await supabase.from('habit_completions').upsert(
          { habit_id: habitId, user_id: userId, completed_date: dateKey(date) },
          { onConflict: 'habit_id,completed_date', ignoreDuplicates: true },
        );
    if (result.error) {
      // Do NOT flip the checkbox on failure — re-read the database instead so
      // the UI always reflects stored truth.
      onError(`Failed to update completion: ${result.error.message}`);
      void loadCompletions();
    } else {
      mutationEpochRef.current += 1;
      setCompletionKeys((current) => {
        const next = new Set(current);
        if (wasCompleted) next.delete(key);
        else next.add(key);
        return next;
      });
    }
    setBusyKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }

  async function addHabit() {
    const name = newHabitName.trim();
    if (!name || !userId) return;
    const { error: insertError } = await supabase.from('habits').insert({
      name,
      frequency: newFrequency,
      custom_frequency: newFrequency === 'custom' ? newCustomFrequency.trim() : '',
      user_id: userId,
      tag_id: null,
    });
    if (insertError) {
      onError(`Failed to add habit: ${insertError.message}`);
      return;
    }
    setNewHabitName('');
    setNewFrequency('daily');
    setNewCustomFrequency('');
    setShowAdd(false);
    onChanged();
  }

  async function deleteHabit(habitId: string) {
    if (!userId) return;
    const { error: completionError } = await supabase.from('habit_completions').delete().eq('habit_id', habitId).eq('user_id', userId);
    if (completionError) {
      onError(`Failed to delete habit completions: ${completionError.message}`);
      return;
    }
    const { error: deleteError } = await supabase.from('habits').delete().eq('id', habitId).eq('user_id', userId);
    if (deleteError) onError(`Failed to delete habit: ${deleteError.message}`);
    else onChanged();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Habit history</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">Expected completions are calculated from each habit&apos;s frequency.</p>
        </div>
        <button type="button" onClick={() => setShowAdd((value) => !value)} className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
          {showAdd ? 'Close' : 'Add habit'}
        </button>
      </div>

      {showAdd && (
        <div className="flex shrink-0 flex-wrap items-end gap-2 border-b border-zinc-200 bg-zinc-50/70 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/30">
          <label className="min-w-[12rem] flex-1"><span className="block text-[10px] font-medium text-zinc-500">Title</span><input value={newHabitName} onChange={(event) => setNewHabitName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addHabit(); }} className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" autoFocus /></label>
          <label><span className="block text-[10px] font-medium text-zinc-500">Frequency</span><select value={newFrequency} onChange={(event) => setNewFrequency(event.target.value)} className="mt-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="custom">Custom</option></select></label>
          {newFrequency === 'custom' && <label><span className="block text-[10px] font-medium text-zinc-500">Schedule</span><input value={newCustomFrequency} onChange={(event) => setNewCustomFrequency(event.target.value)} placeholder="Every other day" className="mt-1 w-36 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" /></label>}
          <button type="button" onClick={() => void addHabit()} disabled={!newHabitName.trim()} className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">Save</button>
        </div>
      )}

      {error && <div className="mx-3 mt-2 shrink-0 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-3">
        <div className="min-w-[980px]">
          <div className="grid" style={{ gridTemplateColumns: 'minmax(190px, 1.4fr) repeat(21, minmax(32px, 1fr))' }}>
            <div className="border-b border-zinc-200 pb-2 dark:border-zinc-800"><span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Completion</span></div>
            {dailyRates.map((item, index) => <div key={dateKey(dates[index])} className="flex h-16 items-end justify-center border-b border-zinc-200 px-1 pb-2 dark:border-zinc-800" title={`${formatDate(dates[index])}: ${item.completed}/${item.expected} expected`}><div className="relative flex h-11 w-full max-w-[24px] items-end rounded-sm bg-zinc-100 dark:bg-zinc-800"><div className="w-full rounded-sm bg-emerald-400 transition-[height] dark:bg-emerald-500" style={{ height: `${item.rate}%` }} /></div></div>)}
            {dates.slice(DAYS_PER_WEEK).map((date) => <div key={`chart-empty-${dateKey(date)}`} className="h-16 border-b border-zinc-200 dark:border-zinc-800" />)}
          </div>

          <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={{ gridTemplateColumns: 'minmax(190px, 1.4fr) repeat(21, minmax(32px, 1fr))' }}>
            <div className="border-r border-zinc-200 py-2 dark:border-zinc-800" />
            {Array.from({ length: WEEK_COUNT }, (_, weekIndex) => <div key={WEEK_LABELS[weekIndex]} className="col-span-7 border-r border-zinc-200 py-2 text-center text-[10px] font-semibold text-zinc-600 last:border-r-0 dark:border-zinc-800 dark:text-zinc-300">{WEEK_LABELS[weekIndex]}</div>)}
          </div>

          <div className="grid border-b border-zinc-200 dark:border-zinc-800" style={{ gridTemplateColumns: 'minmax(190px, 1.4fr) repeat(21, minmax(32px, 1fr))' }}>
            <div className="border-r border-zinc-200 py-2 dark:border-zinc-800"><span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Habit</span></div>
            {dates.map((date, index) => <div key={dateKey(date)} className={`border-r border-zinc-200 py-1.5 text-center last:border-r-0 dark:border-zinc-800 ${index % 7 === 6 ? 'border-r-2' : ''}`}><div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{DAY_LABELS[index % 7]}</div><div className="mt-0.5 text-xs tabular-nums text-zinc-800 dark:text-zinc-200">{date.getDate()}</div></div>)}
          </div>

          {loading && <div className="py-8 text-center text-xs text-zinc-500">Loading history...</div>}
          {!loading && groups.length === 0 && <div className="py-8 text-center text-xs text-zinc-500">No habits yet.</div>}
          {!loading && groups.map((group) => (
            <div key={group.key}>
              <div className="grid border-b border-zinc-100 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-950/20" style={{ gridTemplateColumns: 'minmax(190px, 1.4fr) repeat(21, minmax(32px, 1fr))' }}><div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400" style={{ gridColumn: '1 / -1' }}>{group.label}</div></div>
              {group.habits.map((habit) => (
                <div key={habit.id} className="grid border-b border-zinc-100 hover:bg-zinc-50/70 dark:border-zinc-800 dark:hover:bg-zinc-800/30" style={{ gridTemplateColumns: 'minmax(190px, 1.4fr) repeat(21, minmax(32px, 1fr))' }}>
                  <div className="flex min-h-12 min-w-0 items-center gap-2 border-r border-zinc-200 px-2 dark:border-zinc-800"><span className="min-w-0 flex-1 break-words text-xs font-medium text-zinc-800 dark:text-zinc-200">{habit.name}</span><button type="button" onClick={() => void deleteHabit(habit.id)} aria-label={`Delete ${habit.name}`} title="Delete habit" className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30">×</button></div>
                  {dates.map((date, index) => {
                    const key = `${habit.id}:${dateKey(date)}`;
                    const completed = completionKeys.has(key);
                    const expected = isExpected(habit, date);
                    return <div key={key} className={`flex min-h-12 items-center justify-center border-r border-zinc-100 dark:border-zinc-800 ${index % 7 === 6 ? 'border-r-2' : ''}`}><button type="button" onClick={() => void toggleCompletion(habit.id, date)} disabled={busyKeys.has(key)} aria-label={`${habit.name}, ${formatDate(date)}, ${completed ? 'completed' : 'not completed'}${expected ? '' : ', not scheduled'}`} title={expected ? `${formatDate(date)}: ${completed ? 'Completed' : 'Not completed'}` : `${formatDate(date)}: Not scheduled`} className={`flex h-6 w-6 items-center justify-center rounded border text-xs transition-colors ${completed ? 'border-emerald-500 bg-emerald-500 font-bold text-white' : expected ? 'border-zinc-300 bg-white text-transparent hover:border-emerald-400 dark:border-zinc-600 dark:bg-zinc-900' : 'border-dashed border-zinc-200 bg-zinc-50 text-transparent opacity-50 dark:border-zinc-700 dark:bg-zinc-950'}`}>{completed ? '✓' : '·'}</button></div>;
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
