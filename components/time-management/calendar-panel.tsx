'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { getTasks, insertTask } from '@/lib/tasks';
import type { Task } from '@/lib/tasks';

export interface CalendarEvent {
  id: string;
  user_id: string;
  title: string;
  start_at: string;
  end_at: string;
  color?: string | null;
  location?: string | null;
  notes?: string | null;
  source?: string | null;
  all_day?: boolean;
  recurrence?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ExpandedEvent extends CalendarEvent {
  sid: string;
  isVirtual: boolean;
}

export interface HabitSummary {
  id: string;
  name: string;
  duration_minutes?: number | null;
  frequency?: string;
}

type View = 'week' | 'month';
type RecurrenceFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

type CalendarPanelProps = {
  events?: CalendarEvent[];
  onMutate?: () => Promise<void> | void;
  refreshKey?: number;
  habits?: HabitSummary[];
  habitCompletions?: Set<string>;
  onSidebarSchedule?: () => void;
};

const HOUR_FLOOR = 0;
const HOUR_CEIL = 24;
const PX_PER_HOUR = 60;
const PX_PER_MINUTE = PX_PER_HOUR / 60;
const SNAP_MINUTES = 15;
const TIMELINE_HEIGHT = (HOUR_CEIL - HOUR_FLOOR) * PX_PER_HOUR;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const MONTH_WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const COLORS = [
  { name: null, cls: 'bg-zinc-300 dark:bg-zinc-700', label: 'none' },
  { name: 'bg-rose-500', cls: 'bg-rose-500', label: 'rose' },
  { name: 'bg-amber-500', cls: 'bg-amber-500', label: 'amber' },
  { name: 'bg-emerald-500', cls: 'bg-emerald-500', label: 'emerald' },
  { name: 'bg-sky-500', cls: 'bg-sky-500', label: 'sky' },
  { name: 'bg-violet-500', cls: 'bg-violet-500', label: 'violet' },
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function startOfMonth(date: Date): Date {
  const result = startOfDay(date);
  result.setDate(1);
  return result;
}

function endOfMonth(date: Date): Date {
  const result = startOfMonth(date);
  result.setMonth(result.getMonth() + 1);
  result.setDate(0);
  return result;
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

function sameDay(first: Date, second: Date): boolean {
  return ymd(first) === ymd(second);
}

function snap(value: number): number {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

function clampMinute(value: number): number {
  return Math.max(0, Math.min(TIMELINE_HEIGHT, value));
}

function timeLabel(hour: number): string {
  return `${pad2(hour)}:00`;
}

function shortTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function weekLabel(date: Date): string {
  const monday = startOfWeek(date);
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${sunday.getDate()}, ${sunday.getFullYear()}`;
  }
  return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${sunday.getFullYear()}`;
}

function recurrenceFrequency(value: string | null | undefined): RecurrenceFreq {
  if (!value) return 'NONE';
  try {
    const parsed = JSON.parse(value) as { freq?: string };
    if (parsed.freq === 'DAILY' || parsed.freq === 'WEEKLY' || parsed.freq === 'MONTHLY') return parsed.freq;
  } catch {
    // Legacy "manual" values are non-recurring.
  }
  return 'NONE';
}

function recurrenceJson(freq: RecurrenceFreq, date: Date): string | null {
  if (freq === 'NONE') return null;
  return JSON.stringify({
    freq,
    ...(freq === 'WEEKLY' ? { byweekday: [WEEKDAY_CODES[(date.getDay() + 6) % 7]] } : {}),
  });
}

function expandEvent(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): ExpandedEvent[] {
  const originalStart = new Date(event.start_at);
  const originalEnd = new Date(event.end_at);
  const frequency = recurrenceFrequency(event.recurrence);
  if (frequency === 'NONE') {
    return [{ ...event, sid: `real-${event.id}`, isVirtual: false }];
  }

  const result: ExpandedEvent[] = [{ ...event, sid: `real-${event.id}`, isVirtual: false }];
  const duration = Math.max(15 * 60_000, originalEnd.getTime() - originalStart.getTime());
  const cursor = startOfDay(new Date(Math.max(rangeStart.getTime(), originalStart.getTime())));
  const last = startOfDay(rangeEnd);
  const originalDay = originalStart.getDate();
  let index = 0;
  while (cursor <= last) {
    const matches = frequency === 'DAILY'
      || (frequency === 'WEEKLY' && ((cursor.getDay() + 6) % 7) === ((originalStart.getDay() + 6) % 7))
      || (frequency === 'MONTHLY' && cursor.getDate() === originalDay);
    if (matches && !sameDay(cursor, originalStart) && cursor >= startOfDay(originalStart)) {
      const start = new Date(cursor);
      start.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
      result.push({
        ...event,
        sid: `virtual-${event.id}-${ymd(cursor)}-${index++}`,
        isVirtual: true,
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + duration).toISOString(),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function expandEvents(events: CalendarEvent[], rangeStart: Date, rangeEnd: Date): ExpandedEvent[] {
  return events.flatMap((event) => expandEvent(event, rangeStart, rangeEnd));
}

function eventColor(event: CalendarEvent): { cls: string; dark: boolean } {
  const match = COLORS.find((color) => color.name === event.color);
  return { cls: match?.cls ?? 'bg-zinc-300 dark:bg-zinc-700', dark: !event.color };
}

export default function CalendarPanel({
  events: propEvents,
  onMutate: propOnMutate,
  refreshKey,
  habits = [],
  habitCompletions = new Set<string>(),
  onSidebarSchedule,
}: CalendarPanelProps = {}) {
  const [internalEvents, setInternalEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<View>('week');
  const [anchorDate, setAnchorDate] = useState(() => startOfDay(new Date()));
  const [editing, setEditing] = useState<ExpandedEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<ExpandedEvent | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<ExpandedEvent | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ date: string; time: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleDeleteKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isEditable = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
        || target?.isContentEditable;
      if (event.key !== 'Delete' || isEditable || !selectedEvent || deleteCandidate) return;
      event.preventDefault();
      setDeleteCandidate(selectedEvent);
    }
    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [deleteCandidate, selectedEvent]);

  const internalRefetch = useCallback(async () => {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const [eventsResult, nextTasks] = await Promise.all([
      supabase.from('calendar_events').select('*').eq('user_id', userId).order('start_at'),
      getTasks(),
    ]);
    if (!eventsResult.error) setInternalEvents((eventsResult.data ?? []) as CalendarEvent[]);
    setTasks(nextTasks);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (propEvents === undefined) void internalRefetch();
  }, [internalRefetch, propEvents]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (propEvents === undefined && refreshKey !== undefined) void internalRefetch();
  }, [internalRefetch, propEvents, refreshKey]);

  const events = propEvents ?? internalEvents;
  const onMutate = propOnMutate ?? internalRefetch;
  const monday = startOfWeek(anchorDate);
  const sunday = addDays(monday, 6);
  const monthStart = startOfMonth(anchorDate);
  const monthEnd = endOfMonth(anchorDate);
  const expandedWeekEvents = useMemo(
    () => expandEvents(events, monday, addDays(sunday, 1)),
    [events, monday, sunday],
  );
  const expandedMonthEvents = useMemo(
    () => expandEvents(events, monthStart, monthEnd),
    [events, monthEnd, monthStart],
  );

  const navigate = useCallback((delta: number) => {
    setAnchorDate((current) => {
      const next = new Date(current);
      if (view === 'week') next.setDate(next.getDate() + delta * 7);
      else next.setMonth(next.getMonth() + delta);
      return startOfDay(next);
    });
  }, [view]);

  const updateEvent = useCallback(async (id: string, startAt: string, endAt: string) => {
    setError(null);
    const { error: updateError } = await supabase
      .from('calendar_events')
      .update({ start_at: startAt, end_at: endAt })
      .eq('id', id);
    if (updateError) {
      setError(`Could not update event: ${updateError.message}`);
      return;
    }
    await onMutate();
  }, [onMutate]);

  const deleteEvent = useCallback(async (id: string) => {
    const { error: deleteError } = await supabase.from('calendar_events').delete().eq('id', id);
    if (deleteError) {
      setError(`Could not delete event: ${deleteError.message}`);
      return;
    }
    setEditing(null);
    setSelectedEvent(null);
    setDeleteCandidate(null);
    await onMutate();
  }, [onMutate]);

  const createTaskFromSlot = useCallback(async (title: string, notes: string, repeat: RecurrenceFreq, date: string, time: string) => {
    const taskResult = await insertTask({ title, scheduled_for: date, notes: notes || null });
    if (taskResult.error) throw new Error(`Could not add task: ${taskResult.error}`);
    const userId = await getCurrentUserId();
    if (!userId) throw new Error('Not signed in.');
    const start = new Date(`${date}T${time}:00`);
    const end = new Date(start.getTime() + 30 * 60_000);
    const { error: eventError } = await supabase.from('calendar_events').insert({
      user_id: userId,
      title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      notes: notes || null,
      all_day: false,
      recurrence: recurrenceJson(repeat, start),
      source: 'task',
    });
    if (eventError) throw new Error(`Task saved, but calendar placement failed: ${eventError.message}`);
    await onMutate();
  }, [onMutate]);

  const handleSidebarDrop = useCallback(async (type: 'habit' | 'task', id: string, date: string, time: string) => {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const habit = type === 'habit' ? habits.find((item) => item.id === id) : null;
    const task = type === 'task' ? tasks.find((item) => item.id === id) : null;
    const title = habit?.name ?? task?.title;
    if (!title) return;
    const duration = habit?.duration_minutes ?? task?.duration_minutes ?? 30;
    const start = new Date(`${date}T${time}:00`);
    const { error: insertError } = await supabase.from('calendar_events').insert({
      user_id: userId,
      title,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + duration * 60_000).toISOString(),
      all_day: false,
      recurrence: null,
      source: type,
    });
    if (!insertError) {
      await onMutate();
      onSidebarSchedule?.();
    }
  }, [habits, onMutate, onSidebarSchedule, tasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:flex-row">
      <aside className="flex max-h-[38vh] w-full shrink-0 flex-col border-b border-zinc-200 dark:border-zinc-800 md:max-h-none md:w-64 md:border-b-0 md:border-r">
        <MiniMonthCalendar
          key={`${anchorDate.getFullYear()}-${anchorDate.getMonth()}`}
          selectedDate={anchorDate}
          onSelectDate={(date) => { setAnchorDate(startOfDay(date)); setView('week'); }}
        />
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
          <CalendarSidebar
            events={events}
            habits={habits}
            completions={habitCompletions}
            tasks={tasks}
            onSelectDate={(date) => { setAnchorDate(startOfDay(date)); setView('week'); }}
          />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CalendarHeader
          view={view}
          anchorDate={anchorDate}
          onNavigate={navigate}
          onToday={() => setAnchorDate(startOfDay(new Date()))}
          onViewChange={setView}
        />
        <div className="min-h-0 flex-1">
          {view === 'week' ? (
            <WeekTimeline
              anchorDate={anchorDate}
              events={expandedWeekEvents}
              selectedEventId={selectedEvent?.id ?? null}
              onClickEvent={(event) => setSelectedEvent(event)}
              onDoubleClickEvent={(event) => { setSelectedEvent(event); setEditing(event); }}
              onCreateSlot={(date, time) => { setSelectedEvent(null); setTaskDraft({ date, time }); }}
              onUpdateEvent={updateEvent}
              onSidebarDrop={handleSidebarDrop}
            />
          ) : (
            <MonthGrid
              anchorDate={anchorDate}
              events={expandedMonthEvents}
              selectedEventId={selectedEvent?.id ?? null}
              onClickEvent={(event) => setSelectedEvent(event)}
              onDoubleClickEvent={(event) => { setSelectedEvent(event); setEditing(event); }}
              onSelectDate={(date) => { setSelectedEvent(null); setAnchorDate(startOfDay(date)); setView('week'); }}
            />
          )}
        </div>
      </main>

      {editing && (
        <EventModal
          event={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await onMutate(); }}
          onRequestDelete={() => setDeleteCandidate(editing)}
        />
      )}
      {deleteCandidate && (
        <DeleteEventModal
          event={deleteCandidate}
          onClose={() => setDeleteCandidate(null)}
          onConfirm={() => { setEditing(null); void deleteEvent(deleteCandidate.id); }}
        />
      )}
      {taskDraft && (
        <AddTaskModal
          date={taskDraft.date}
          time={taskDraft.time}
          onClose={() => setTaskDraft(null)}
          onSave={async (title, notes, repeat) => {
            try {
              setError(null);
              await createTaskFromSlot(title, notes, repeat, taskDraft.date, taskDraft.time);
              setTaskDraft(null);
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Could not add task.');
            }
          }}
        />
      )}
      {error && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow-lg dark:border-red-900 dark:bg-zinc-900 dark:text-red-300">{error}</div>}
    </div>
  );
}

function CalendarHeader({
  view, anchorDate, onNavigate, onToday, onViewChange,
}: {
  view: View;
  anchorDate: Date;
  onNavigate: (delta: number) => void;
  onToday: () => void;
  onViewChange: (view: View) => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous" title="Previous" onClick={() => onNavigate(-1)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <Chevron direction="left" />
        </button>
        <button type="button" onClick={onToday} className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">Today</button>
        <button type="button" aria-label="Next" title="Next" onClick={() => onNavigate(1)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
          <Chevron direction="right" />
        </button>
      </div>
      <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{view === 'week' ? weekLabel(anchorDate) : monthLabel(anchorDate)}</h2>
      <div className="ml-auto flex rounded-md bg-zinc-100 p-0.5 text-[11px] font-medium dark:bg-zinc-800">
        {(['week', 'month'] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => onViewChange(option)} className={`rounded px-2.5 py-1 capitalize ${view === option ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>{option}</button>)}
      </div>
    </header>
  );
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d={direction === 'left' ? 'M15.75 19.5L8.25 12l7.5-7.5' : 'M8.25 4.5l7.5 7.5-7.5 7.5'} /></svg>;
}

function MiniMonthCalendar({ selectedDate, onSelectDate }: { selectedDate: Date; onSelectDate: (date: Date) => void }) {
  const today = startOfDay(new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selectedDate));
  const firstOffset = (startOfMonth(visibleMonth).getDay() + 6) % 7;
  const daysInMonth = endOfMonth(visibleMonth).getDate();
  const cells: Array<Date | null> = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const date = startOfMonth(visibleMonth);
      date.setDate(index + 1);
      return date;
    }),
  ];
  return (
    <div className="shrink-0 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{monthLabel(visibleMonth)}</span>
        <div className="flex gap-0.5"><button type="button" aria-label="Previous month" title="Previous month" onClick={() => setVisibleMonth((date) => { const next = new Date(date); next.setMonth(next.getMonth() - 1); return next; })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Chevron direction="left" /></button><button type="button" aria-label="Next month" title="Next month" onClick={() => setVisibleMonth((date) => { const next = new Date(date); next.setMonth(next.getMonth() + 1); return next; })} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"><Chevron direction="right" /></button></div>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center">{MONTH_WEEKDAYS.map((day, index) => <span key={`${day}-${index}`} className="text-[10px] font-medium text-zinc-400">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((date, index) => date ? <button key={ymd(date)} type="button" onClick={() => onSelectDate(date)} aria-label={date.toLocaleDateString('en-US', { dateStyle: 'full' })} className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] tabular-nums ${sameDay(date, selectedDate) ? 'bg-zinc-900 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900' : sameDay(date, today) ? 'font-bold text-rose-600 ring-1 ring-rose-400/60 dark:text-rose-400' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'}`}>{date.getDate()}</button> : <span key={`blank-${index}`} className="h-7" />)}
      </div>
    </div>
  );
}

function CalendarSidebar({ events, habits, completions, tasks, onSelectDate }: {
  events: CalendarEvent[];
  habits: HabitSummary[];
  completions: Set<string>;
  tasks: Task[];
  onSelectDate: (date: Date) => void;
}) {
  const today = startOfDay(new Date());
  const todayKey = ymd(today);
  const incompleteHabits = habits.filter((habit) => !completions.has(habit.id));
  const todayTasks = tasks.filter((task) => task.status === 'pending' && task.scheduled_for === todayKey);
  const upcoming = events.filter((event) => new Date(event.end_at) >= new Date()).sort((a, b) => a.start_at.localeCompare(b.start_at)).slice(0, 8);
  const unscheduledTasks = tasks.filter((task) => task.status === 'pending' && !task.scheduled_for).slice(0, 8);
  const items = [
    ...incompleteHabits.map((habit) => ({ type: 'habit' as const, id: habit.id, title: habit.name, color: 'bg-emerald-400' })),
    ...unscheduledTasks.map((task) => ({ type: 'task' as const, id: task.id, title: task.title, color: 'bg-sky-400' })),
  ];
  return (
    <div className="space-y-4 px-3 py-3">
      <SidebarSection title="Today">
        {todayTasks.length === 0 && incompleteHabits.length === 0 ? <EmptySidebar text="Nothing left today" /> : <div className="grid grid-cols-2 gap-x-2 gap-y-1">{[
          ...incompleteHabits.slice(0, 8).map((habit) => <DraggableSidebarItem key={`habit-${habit.id}`} type="habit" id={habit.id} title={habit.name} color="bg-emerald-400" />),
          ...todayTasks.slice(0, 8).map((task) => <DraggableSidebarItem key={`task-${task.id}`} type="task" id={task.id} title={task.title} color="bg-sky-400" />),
        ]}</div>}
      </SidebarSection>
      <SidebarSection title="Upcoming">
        {upcoming.length === 0 ? <EmptySidebar text="Nothing upcoming" /> : <div className="grid grid-cols-2 gap-x-2 gap-y-1">{upcoming.map((event) => <button key={`${event.id}-${event.start_at}`} type="button" onClick={() => onSelectDate(new Date(event.start_at))} className="flex min-w-0 items-start gap-1.5 rounded px-1 py-0.5 text-left text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-zinc-400" /><span className="min-w-0 break-words leading-tight"><span className="mr-1 text-zinc-400">{shortTime(new Date(event.start_at))}</span>{event.title}</span></button>)}</div>}
      </SidebarSection>
      {items.length > 0 && <SidebarSection title="Unscheduled - drag to calendar"><div className="grid grid-cols-2 gap-1.5">{items.map((item) => <DraggableSidebarItem key={`${item.type}-${item.id}`} type={item.type} id={item.id} title={item.title} color={item.color} />)}</div></SidebarSection>}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">{title}</h3>{children}</section>;
}

function DraggableSidebarItem({ type, id, title, color }: { type: 'habit' | 'task'; id: string; title: string; color: string }) {
  return <div
    draggable
    onDragStart={(event) => {
      event.dataTransfer.setData('application/x-sidebar-item', JSON.stringify({ type, id }));
      event.dataTransfer.effectAllowed = 'copy';
      event.currentTarget.classList.add('opacity-50', 'ring-1', 'ring-rose-400');
    }}
    onDragEnd={(event) => event.currentTarget.classList.remove('opacity-50', 'ring-1', 'ring-rose-400')}
    className="flex min-w-0 cursor-grab items-start gap-1.5 rounded px-1 py-1 text-[11px] text-zinc-600 transition active:cursor-grabbing dark:text-zinc-300"
    title={`Drag ${title} onto the calendar`}
  >
    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${color}`} />
    <span className="min-w-0 break-words leading-tight">{title}</span>
  </div>;
}

function EmptySidebar({ text }: { text: string }) {
  return <p className="text-[11px] italic text-zinc-400 dark:text-zinc-600">{text}</p>;
}

function WeekTimeline({ anchorDate, events, selectedEventId, onClickEvent, onDoubleClickEvent, onCreateSlot, onUpdateEvent, onSidebarDrop }: {
  anchorDate: Date;
  events: ExpandedEvent[];
  selectedEventId: string | null;
  onClickEvent: (event: ExpandedEvent) => void;
  onDoubleClickEvent: (event: ExpandedEvent) => void;
  onCreateSlot: (date: string, time: string) => void;
  onUpdateEvent: (id: string, start: string, end: string) => Promise<void>;
  onSidebarDrop: (type: 'habit' | 'task', id: string, date: string, time: string) => void;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ type: 'create' | 'move' | 'resize-top' | 'resize-bottom'; id?: string; sid?: string; dayIndex: number; start: number; end: number; origin: number }>({ type: 'create', dayIndex: 0, start: 0, end: 30, origin: 0 });
  const previewRef = useRef<{ sid: string; dayIndex: number; start: number; end: number } | null>(null);
  const suppressClickRef = useRef(false);
  const [preview, setPreview] = useState<{ sid: string; dayIndex: number; start: number; end: number } | null>(null);
  const [draggingSidebar, setDraggingSidebar] = useState(false);
  const monday = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  const allDayEvents = events.filter((event) => event.all_day);
  const timedEvents = events.filter((event) => !event.all_day && days.some((day) => sameDay(new Date(event.start_at), day)));

  function minuteAt(clientY: number): number {
    const element = timelineRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    return clampMinute(snap((clientY - rect.top + element.scrollTop) / PX_PER_MINUTE));
  }

  function dayIndexFromClientX(clientX: number): number {
    const element = timelineRef.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    const axisWidth = 58;
    const contentX = clientX - rect.left + element.scrollLeft - axisWidth;
    const dayWidth = (element.scrollWidth - axisWidth) / 7;
    return Math.max(0, Math.min(6, Math.floor(contentX / dayWidth)));
  }

  function dayIndexFromTarget(target: HTMLElement): number {
    const value = target.closest('[data-day-index]')?.getAttribute('data-day-index');
    return value ? Math.max(0, Math.min(6, Number(value))) : 0;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const resizeHandle = target.closest('[data-resize-edge]') as HTMLElement | null;
    const eventElement = target.closest('[data-event-key]') as HTMLElement | null;
    const dayIndex = dayIndexFromTarget(target);
    const currentMinute = minuteAt(event.clientY);
    if (eventElement) {
      const start = Number(eventElement.dataset.start ?? 0);
      const end = Number(eventElement.dataset.end ?? start + 30);
      const type = resizeHandle?.dataset.resizeEdge === 'top' ? 'resize-top' : resizeHandle?.dataset.resizeEdge === 'bottom' ? 'resize-bottom' : 'move';
      dragRef.current = { type, id: eventElement.dataset.eventId, sid: eventElement.dataset.eventKey, dayIndex, start, end, origin: currentMinute };
      previewRef.current = { sid: eventElement.dataset.eventKey ?? '', dayIndex, start, end };
      setPreview(previewRef.current);
      suppressClickRef.current = false;
    } else {
      const end = Math.min(TIMELINE_HEIGHT / PX_PER_MINUTE, currentMinute + 30);
      dragRef.current = { type: 'create', dayIndex, start: currentMinute, end, origin: currentMinute };
      previewRef.current = { sid: 'draft', dayIndex, start: currentMinute, end };
      setPreview(previewRef.current);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const drag = dragRef.current;
    const currentDayIndex = dayIndexFromClientX(event.clientX);
    const current = minuteAt(event.clientY);
    if (
      Math.abs(current - drag.origin) >= SNAP_MINUTES
      || (drag.type === 'move' && currentDayIndex !== drag.dayIndex)
    ) suppressClickRef.current = true;
    let next: { sid: string; dayIndex: number; start: number; end: number } | null = null;
    if (drag.type === 'create') {
      next = { sid: 'draft', dayIndex: drag.dayIndex, start: Math.min(drag.start, current), end: Math.max(drag.start + 15, Math.max(drag.start, current)) };
    } else if (drag.sid) {
      if (drag.type === 'move') {
        const delta = current - drag.origin;
        const duration = drag.end - drag.start;
        const start = Math.max(0, Math.min(TIMELINE_HEIGHT - duration, snap(drag.start + delta)));
        next = { sid: drag.sid, dayIndex: currentDayIndex, start, end: start + duration };
      } else if (drag.type === 'resize-top') {
        next = { sid: drag.sid, dayIndex: drag.dayIndex, start: Math.min(snap(current), drag.end - 15), end: drag.end };
      } else {
        next = { sid: drag.sid, dayIndex: drag.dayIndex, start: drag.start, end: Math.max(drag.start + 15, snap(current)) };
      }
    }
    previewRef.current = next;
    setPreview(next);
  }

  async  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {

    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    const result = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    if (!result) return;
    if (drag.type === 'create') {
      const date = ymd(days[result.dayIndex]);
      const hour = Math.floor(result.start / 60);
      const minute = result.start % 60;
      onCreateSlot(date, `${pad2(hour)}:${pad2(minute)}`);
      return;
    }
    if (!drag.id || !suppressClickRef.current) return;
    const day = days[result.dayIndex];
    const start = new Date(day);
    start.setHours(Math.floor(result.start / 60), result.start % 60, 0, 0);
    const end = new Date(day);
    end.setHours(Math.floor(result.end / 60), result.end % 60, 0, 0);
    await onUpdateEvent(drag.id, start.toISOString(), end.toISOString());
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingSidebar(false);
    const raw = event.dataTransfer.getData('application/x-sidebar-item');
    if (!raw) return;
    try {
      const item = JSON.parse(raw) as { type: 'habit' | 'task'; id: string };
      const dayIndex = dayIndexFromClientX(event.clientX);
      const minute = minuteAt(event.clientY);
      onSidebarDrop(item.type, item.id, ymd(days[dayIndex]), `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}`);
    } catch {
      // Ignore malformed drag payloads.
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 overflow-x-auto border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="grid min-w-[704px]" style={{ gridTemplateColumns: '58px repeat(7, minmax(92px, 1fr))' }}>
          <div />
          {days.map((day) => <div key={ymd(day)} className="border-l border-zinc-200 px-2 py-2 text-center dark:border-zinc-800"><div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{WEEKDAYS[(day.getDay() + 6) % 7]}</div><div className={`mt-0.5 text-base font-semibold tabular-nums ${sameDay(day, new Date()) ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-900 dark:text-zinc-100'}`}>{day.getDate()}</div></div>)}
        </div>
      </div>
      <div className="shrink-0 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
        <div className="grid min-w-[704px]" style={{ gridTemplateColumns: '58px repeat(7, minmax(92px, 1fr))' }}>
          <div className="flex items-center justify-end px-2 text-[10px] uppercase tracking-wider text-zinc-400">All day</div>
          {days.map((day) => <div key={ymd(day)} className="min-h-8 border-l border-zinc-200 p-1 dark:border-zinc-800">{allDayEvents.filter((item) => sameDay(new Date(item.start_at), day)).map((item) => <button key={item.sid} type="button" onClick={() => onClickEvent(item)} onDoubleClick={() => onDoubleClickEvent(item)} className={`mb-0.5 block w-full truncate rounded px-1.5 py-1 text-left text-[10px] text-zinc-900 dark:text-zinc-100 ${selectedEventId === item.id ? 'bg-rose-400 ring-2 ring-rose-500/60 dark:bg-rose-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>{item.title}</button>)}</div>)}
        </div>
      </div>
      <div ref={timelineRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-sidebar-item')) { event.preventDefault(); setDraggingSidebar(true); } }} onDragLeave={() => setDraggingSidebar(false)} onDrop={handleDrop} className={`min-h-0 flex-1 overflow-x-auto overflow-y-auto ${draggingSidebar ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''}`} style={{ touchAction: 'pan-y' }}>
        <div className="grid min-w-[704px]" style={{ gridTemplateColumns: '58px repeat(7, minmax(92px, 1fr))', height: TIMELINE_HEIGHT }}>
          <div className="relative border-r border-zinc-200 dark:border-zinc-800">{Array.from({ length: 24 }, (_, hour) => <div key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500" style={{ top: hour * PX_PER_HOUR }}>{timeLabel(hour)}</div>)}</div>
          {days.map((day, dayIndex) => {
            const dayEvents = timedEvents.filter((item) => {
              if (preview?.sid === item.sid) return preview.dayIndex === dayIndex;
              return sameDay(new Date(item.start_at), day);
            });
            return <div key={ymd(day)} data-day-index={dayIndex} className="relative border-l border-zinc-200 bg-[linear-gradient(to_bottom,transparent_59px,rgba(161,161,170,0.16)_60px)] dark:border-zinc-800 dark:bg-[linear-gradient(to_bottom,transparent_59px,rgba(113,113,122,0.16)_60px)]" style={{ backgroundSize: '100% 60px' }}>
              {Array.from({ length: 24 }, (_, hour) => <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-zinc-200/60 dark:border-zinc-800/60" style={{ top: hour * PX_PER_HOUR }} />)}
              {dayEvents.map((item) => {
                const baseStart = Math.max(0, (new Date(item.start_at).getHours() * 60) + new Date(item.start_at).getMinutes());
                const baseEnd = Math.min(TIMELINE_HEIGHT, (new Date(item.end_at).getHours() * 60) + new Date(item.end_at).getMinutes());
                const active = preview?.sid === item.sid ? preview : null;
                const start = active?.start ?? baseStart;
                const end = active?.end ?? Math.max(baseStart + 15, baseEnd);
                const colors = eventColor(item);
                return <div key={item.sid} data-event-key={item.sid} data-event-id={item.id} data-day-index={dayIndex} data-start={baseStart} data-end={Math.max(baseStart + 15, baseEnd)} onClick={(event) => { event.stopPropagation(); if (!suppressClickRef.current) onClickEvent(item); suppressClickRef.current = false; }} onDoubleClick={(event) => { event.stopPropagation(); onDoubleClickEvent(item); }} className={`group absolute inset-x-1 z-10 cursor-grab overflow-hidden rounded-md px-2 py-1 text-[11px] font-medium shadow-sm active:cursor-grabbing ${colors.cls} ${colors.dark ? 'text-zinc-900 dark:text-zinc-100' : 'text-white'} ${selectedEventId === item.id ? 'ring-2 ring-rose-500 ring-offset-1 ring-offset-white dark:ring-rose-400 dark:ring-offset-zinc-900' : ''} ${item.isVirtual ? 'opacity-90 ring-1 ring-inset ring-white/30' : ''}`} style={{ top: start * PX_PER_MINUTE, height: Math.max(20, (end - start) * PX_PER_MINUTE) }}>
                  <div data-resize-edge="top" data-resize-edge-value="top" onClick={(event) => event.stopPropagation()} className="absolute inset-x-0 top-0 z-20 h-3 cursor-ns-resize" aria-label="Resize start time" />
                  <div data-resize-edge="bottom" onClick={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-0 z-20 h-3 cursor-ns-resize" aria-label="Resize end time" />
                  <span className="block truncate leading-tight">{item.title}</span>
                  {end - start >= 30 && <span className="block truncate text-[10px] opacity-80">{shortTime(new Date(item.start_at))} - {shortTime(new Date(item.end_at))}</span>}
                </div>;
              })}
              {preview?.dayIndex === dayIndex && preview.sid === 'draft' && <div className="pointer-events-none absolute inset-x-1 z-20 rounded-md border border-dashed border-rose-400 bg-rose-100/60" style={{ top: preview.start * PX_PER_MINUTE, height: Math.max(20, (preview.end - preview.start) * PX_PER_MINUTE) }} />}
            </div>;
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ anchorDate, events, selectedEventId, onClickEvent, onDoubleClickEvent, onSelectDate }: { anchorDate: Date; events: ExpandedEvent[]; selectedEventId: string | null; onClickEvent: (event: ExpandedEvent) => void; onDoubleClickEvent: (event: ExpandedEvent) => void; onSelectDate: (date: Date) => void }) {
  const monthStart = startOfMonth(anchorDate);
  const daysInMonth = endOfMonth(anchorDate).getDate();
  const offset = (monthStart.getDay() + 6) % 7;
  const cells = [...Array.from({ length: offset }, () => null), ...Array.from({ length: daysInMonth }, (_, index) => { const date = new Date(monthStart); date.setDate(index + 1); return date; })];
  return <div className="flex h-full min-h-0 flex-col"><div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/40">{MONTH_WEEKDAYS.map((day, index) => <div key={`${day}-${index}`} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{day}</div>)}</div><div className="grid min-h-0 flex-1 grid-cols-7 auto-rows-[minmax(92px,1fr)] overflow-auto">{cells.map((date, index) => date ? <div key={ymd(date)} onClick={() => onSelectDate(date)} className="group min-w-0 cursor-pointer border-b border-r border-zinc-200 p-1 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/30"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${sameDay(date, new Date()) ? 'bg-rose-500 font-semibold text-white' : 'text-zinc-800 dark:text-zinc-200'}`}>{date.getDate()}</span><div className="mt-1 space-y-0.5 overflow-hidden">{events.filter((event) => new Date(event.start_at).toDateString() === date.toDateString()).slice(0, 4).map((event) => <button key={event.sid} type="button" onClick={(click) => { click.stopPropagation(); onClickEvent(event); }} onDoubleClick={(click) => { click.stopPropagation(); onDoubleClickEvent(event); }} className={`block w-full truncate rounded px-1 py-0.5 text-left text-[10px] text-zinc-900 dark:text-zinc-100 ${selectedEventId === event.id ? 'bg-rose-400 ring-2 ring-rose-500/60 dark:bg-rose-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>{event.title}</button>)}</div></div> : <span key={`blank-${index}`} className="border-b border-r border-zinc-200 dark:border-zinc-800" />)}</div></div>;
}

function AddTaskModal({ date, time, onClose, onSave }: { date: string; time: string; onClose: () => void; onSave: (title: string, notes: string, repeat: RecurrenceFreq) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [repeat, setRepeat] = useState<RecurrenceFreq>('NONE');
  const [saving, setSaving] = useState(false);
  async function save() { if (!title.trim() || saving) return; setSaving(true); try { await onSave(title.trim(), notes.trim(), repeat); } finally { setSaving(false); } }
  return <ModalShell title="Add task" onClose={onClose}><p className="text-xs text-zinc-500 dark:text-zinc-400">{new Date(`${date}T${time}:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {time}</p><label className="block"><span className="label">Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} className="field" /></label><label className="block"><span className="label">Notes</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="field resize-none" /></label><label className="block"><span className="label">Repeat</span><select value={repeat} onChange={(event) => setRepeat(event.target.value as RecurrenceFreq)} className="field"><option value="NONE">Doesn&apos;t repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="button-muted">Cancel</button><button type="button" disabled={!title.trim() || saving} onClick={() => void save()} className="button-primary">{saving ? 'Saving...' : 'Add task'}</button></div></ModalShell>;
}

function EventModal({ event, onClose, onSaved, onRequestDelete }: { event: ExpandedEvent; onClose: () => void; onSaved: () => Promise<void>; onRequestDelete: () => void }) {
  const [title, setTitle] = useState(event.title);
  const [notes, setNotes] = useState(event.notes ?? '');
  const [color, setColor] = useState<string | null>(event.color ?? null);
  const [start, setStart] = useState(() => localInput(new Date(event.start_at)));
  const [end, setEnd] = useState(() => localInput(new Date(event.end_at)));
  const [repeat, setRepeat] = useState<RecurrenceFreq>(recurrenceFrequency(event.recurrence));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!title.trim()) return;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) { setError('End must be after start.'); return; }
    setSaving(true); setError(null);
    const { error: updateError } = await supabase.from('calendar_events').update({ title: title.trim(), notes: notes.trim() || null, color, start_at: startDate.toISOString(), end_at: endDate.toISOString(), recurrence: recurrenceJson(repeat, startDate) }).eq('id', event.id);
    setSaving(false);
    if (updateError) { setError(updateError.message); return; }
    await onSaved();
  }
  return <ModalShell title="Edit event" onClose={onClose}><label className="block"><span className="label">Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="field" /></label><div className="grid grid-cols-2 gap-2"><label className="block"><span className="label">Starts</span><input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} step={900} className="field" /></label><label className="block"><span className="label">Ends</span><input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} step={900} className="field" /></label></div><label className="block"><span className="label">Repeat</span><select value={repeat} onChange={(event) => setRepeat(event.target.value as RecurrenceFreq)} className="field"><option value="NONE">Doesn&apos;t repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></label><div><span className="label">Color</span><div className="mt-1 flex gap-2">{COLORS.map((item) => <button key={item.label} type="button" aria-label={`Color ${item.label}`} aria-pressed={color === item.name} onClick={() => setColor(item.name)} className={`h-5 w-5 rounded-full ${item.cls} ${color === item.name ? 'ring-2 ring-zinc-900 ring-offset-2 dark:ring-zinc-100' : ''}`} />)}</div></div><label className="block"><span className="label">Notes</span><textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="field resize-none" /></label>{error && <p className="text-xs text-red-600">{error}</p>}<div className="flex items-center justify-between gap-2"><button type="button" onClick={onRequestDelete} className="button-danger">Delete</button><div className="flex gap-2"><button type="button" onClick={onClose} className="button-muted">Cancel</button><button type="button" disabled={!title.trim() || saving} onClick={() => void save()} className="button-primary">{saving ? 'Saving...' : 'Save'}</button></div></div></ModalShell>;
}

function localInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function DeleteEventModal({ event, onClose, onConfirm }: { event: ExpandedEvent; onClose: () => void; onConfirm: () => void }) {
  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return <ModalShell title="Delete event?" onClose={onClose}>
    <p className="text-sm text-zinc-600 dark:text-zinc-300">This will permanently remove <strong>{event.title}</strong> from the calendar.</p>
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className="button-muted">Cancel</button>
      <button type="button" onClick={onConfirm} className="button-danger">Delete</button>
    </div>
  </ModalShell>;
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}><div className="w-full max-w-md space-y-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2><button type="button" aria-label="Close" title="Close" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button></div>{children}</div></div>;
}
