'use client';

import { useState, useEffect, useCallback } from 'react';
import { getTasks, insertTask, toggleTaskStatus, deleteTask as deleteTaskApi, rescheduleTask } from '@/lib/tasks';
import type { Task } from '@/lib/tasks';

// Re-export for backwards compatibility
/** @deprecated Import from @/lib/tasks instead */
export type { Task };

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Section labels ───────────────────────────────────────────────

type Section = 'overdue' | 'today' | 'tomorrow' | 'upcoming';

type Bucket = { label: string; section: Section };

function getBuckets(): Bucket[] {
  return [
    { label: 'Overdue', section: 'overdue' },
    { label: 'Today', section: 'today' },
    { label: 'Tomorrow', section: 'tomorrow' },
    { label: 'Upcoming', section: 'upcoming' },
  ];
}

function getSectionFromDate(dateStr: string): Section {
  const t = today();
  if (dateStr < t) return 'overdue';
  if (dateStr === t) return 'today';
  if (dateStr === addDays(t, 1)) return 'tomorrow';
  return 'upcoming';
}

// ─── Component ───────────────────────────────────────────────────────

export default function TodoList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New task form state
  const [title, setTitle] = useState('');
  const [scheduledFor, setScheduledFor] = useState(today());
  const [duration, setDuration] = useState(30);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  // Load tasks from Supabase on mount
  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await getTasks();
    setTasks(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  async function addTask() {
    if (!title.trim()) return;

    const result = await insertTask({
      title: title.trim(),
      scheduled_for: scheduledFor,
      duration_minutes: duration,
    });

    if (result.error) {
      setError(`Failed to add task: ${result.error}`);
      return;
    }

    if (result.data) {
      setTasks((prev) => [...prev, result.data!]);
    }

    setTitle('');
    setDuration(30);
  }

  async function toggleTask(id: string) {
    const original = tasks.find((t) => t.id === id);
    if (!original) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? { ...t, status: t.status === 'pending' ? 'completed' : 'pending' }
          : t,
      ),
    );

    const success = await toggleTaskStatus(id);
    if (!success) {
      // Revert on failure
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: original.status } : t,
        ),
      );
      setError('Failed to update task status');
    }
  }

  async function deleteTask(id: string) {
    const original = tasks.find((t) => t.id === id);
    if (!original) return;

    // Optimistic remove
    setTasks((prev) => prev.filter((t) => t.id !== id));

    const success = await deleteTaskApi(id);
    if (!success) {
      // Revert on failure — re-insert at the right position
      setError('Failed to delete task');
      const data = await getTasks();
      setTasks(data);
    }
  }

  const moveTask = useCallback(
    async (taskId: string, newDate: string) => {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, scheduled_for: newDate } : t,
        ),
      );

      const success = await rescheduleTask(taskId, newDate);
      if (!success) {
        setError('Failed to reschedule task');
        // Reload from server on failure
        const data = await getTasks();
        setTasks(data);
      }
    },
    [],
  );

  // Group tasks by section
  const grouped = getBuckets().map((bucket) => {
    const items = tasks
      .filter((t) => getSectionFromDate(t.scheduled_for) === bucket.section)
      .sort((a, b) => {
        // Completed tasks at bottom
        if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
        return a.scheduled_for.localeCompare(b.scheduled_for);
      });
    return { ...bucket, tasks: items };
  });

  // ─── Drag handlers ─────────────────────────────────────────────

  function handleDragStart(e: React.DragEvent, taskId: string) {
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(taskId);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault(); // Required for onDrop to fire
    e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: React.DragEvent, targetDate: string) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      moveTask(taskId, targetDate);
    }
    setDraggedId(null);
  }

  function handleDragEnd() {
    setDraggedId(null);
  }

  // ─── Loading state ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
      </div>
    );
  }

  const totalPending = tasks.filter((t) => t.status === 'pending').length;
  const hasAnyPending = totalPending > 0;

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-3 font-medium underline underline-offset-2 hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* New Task Form */}
      <section className="mb-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-5 text-sm font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          New Task
        </h2>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-3">
          <div className="flex-1">
            <label htmlFor="task-title" className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Title
            </label>
            <input
              id="task-title"
              type="text"
              placeholder="e.g. Review design mockups"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </div>
          <div className="w-full sm:w-40">
            <label htmlFor="task-date" className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Scheduled for
            </label>
            <input
              id="task-date"
              type="date"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </div>
          <div className="w-full sm:w-28">
            <label htmlFor="task-duration" className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Minutes
            </label>
            <input
              id="task-duration"
              type="number"
              min={1}
              max={480}
              value={duration}
              onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </div>
          <button
            onClick={addTask}
            disabled={!title.trim()}
            className="flex h-10 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        </div>
      </section>

      {/* Section-grouped rows */}
      {!hasAnyPending ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 rounded-full bg-zinc-100 p-4 dark:bg-zinc-800">
            <svg className="h-8 w-8 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
          </div>
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            No tasks yet — create your first one above.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((bucket) => (
            <TaskRow
              key={bucket.section}
              label={bucket.label}
              section={bucket.section}
              tasks={bucket.tasks}
              draggedId={draggedId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onToggle={toggleTask}
              onDelete={deleteTask}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Task Row ──────────────────────────────────────────────────────

function TaskRow({
  label,
  section,
  tasks,
  draggedId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  onDelete,
}: {
  label: string;
  section: Section;
  tasks: Task[];
  draggedId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetDate: string) => void;
  onDragEnd: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isOverdue = section === 'overdue';
  const isToday = section === 'today';
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;

  const sectionColor = isOverdue
    ? 'border-red-200 bg-red-50/30 dark:border-red-900 dark:bg-red-950/20'
    : isToday
    ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900 dark:bg-emerald-950/20'
    : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900';

  const labelColor = isOverdue
    ? 'text-red-700 dark:text-red-300'
    : isToday
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-zinc-900 dark:text-zinc-100';

  const badgeColor = isOverdue
    ? 'bg-red-200 text-red-700 dark:bg-red-800 dark:text-red-200'
    : isToday
    ? 'bg-emerald-200 text-emerald-700 dark:bg-emerald-800 dark:text-emerald-200'
    : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300';

  const headerBorderColor = isOverdue
    ? 'border-red-200 dark:border-red-900'
    : isToday
    ? 'border-emerald-200 dark:border-emerald-900'
    : 'border-zinc-200 dark:border-zinc-700';

  return (
    <div
      onDragOver={onDragOver}
      onDrop={(e) => {
        const taskId = e.dataTransfer.getData('text/plain');
        if (!taskId) return;
        const t = today();
        let newDate: string;
        if (section === 'overdue') {
          newDate = addDays(t, -1);
        } else if (section === 'today') {
          newDate = t;
        } else if (section === 'tomorrow') {
          newDate = addDays(t, 1);
        } else {
          newDate = addDays(t, 7);
        }
        onDrop(e, newDate);
      }}
      className={`rounded-xl border transition-all duration-200 ${sectionColor} ${draggedId ? 'min-h-[120px]' : ''}`}
    >
      {/* Row header */}
      <div className={`border-b px-4 py-3 ${headerBorderColor}`}>
        <div className="flex items-center justify-between">
          <h3 className={`text-sm font-semibold ${labelColor}`}>
            {label}
          </h3>
          {pendingCount > 0 && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeColor}`}>
              {pendingCount}
            </span>
          )}
        </div>
      </div>

      {/* Tasks */}
      <div className="space-y-2 p-3">
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center rounded-lg border-2 border-dashed border-zinc-200 py-6 dark:border-zinc-700">
            <p className="text-xs text-zinc-300 dark:text-zinc-600">
              {section === 'overdue' ? 'No overdue tasks' : section === 'today' ? 'No tasks for today' : section === 'tomorrow' ? 'No tasks for tomorrow' : 'No upcoming tasks'}
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              draggedId={draggedId}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Task Card ──────────────────────────────────────────────────────

function TaskCard({
  task,
  draggedId,
  onDragStart,
  onDragEnd,
  onToggle,
  onDelete,
}: {
  task: Task;
  draggedId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isCompleted = task.status === 'completed';
  const isDragging = draggedId === task.id;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onDragEnd={onDragEnd}
      className={`group cursor-grab rounded-lg border p-3 transition-all duration-200 active:cursor-grabbing ${
        isCompleted
          ? 'border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/60'
          : 'border-zinc-200 bg-white shadow-sm hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900'
      } ${isDragging ? 'opacity-50 shadow-lg ring-2 ring-violet-400 dark:ring-violet-500' : ''}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Checkbox */}
        <button
          onClick={() => onToggle(task.id)}
          className={`relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 ${
            isCompleted
              ? 'border-emerald-400 bg-emerald-400 text-white dark:border-emerald-500 dark:bg-emerald-500'
              : 'border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:hover:border-zinc-500'
          }`}
          aria-label={isCompleted ? 'Mark as pending' : 'Mark as completed'}
        >
          {isCompleted && (
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium transition-colors duration-200 ${
              isCompleted
                ? 'text-zinc-400 line-through dark:text-zinc-500'
                : 'text-zinc-900 dark:text-zinc-100'
            }`}
          >
            {task.title}
          </p>
          {task.duration_minutes != null && (
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              {task.duration_minutes}m
            </p>
          )}
        </div>

        {/* Drag handle */}
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-zinc-200 opacity-0 transition-all group-hover:opacity-100 dark:text-zinc-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>

        {/* Delete */}
        <button
          onClick={() => onDelete(task.id)}
          className="shrink-0 rounded-md p-0.5 text-zinc-200 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-red-400"
          aria-label="Delete task"
          onDragStart={(e) => e.stopPropagation()}
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
