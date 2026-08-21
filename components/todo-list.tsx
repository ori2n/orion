'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getTasks,
  insertTask,
  updateTask,
  toggleTaskStatus,
  deleteTask as deleteTaskApi,
  rescheduleTask,
} from '@/lib/tasks';
import type { Task } from '@/lib/tasks';
import {
  buildEventFromTask,
  createCalendarEvent,
} from '@/lib/calendar-scheduling';

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

type EditPatch = {
  title?: string;
  scheduled_for?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
};

function getBuckets(): Bucket[] {
  return [
    { label: 'Overdue', section: 'overdue' },
    { label: 'Today', section: 'today' },
    { label: 'Tomorrow', section: 'tomorrow' },
    { label: 'Upcoming', section: 'upcoming' },
  ];
}

function getSectionFromDate(dateStr: string | null): Section {
  if (!dateStr) return 'upcoming';
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
  const [noDate, setNoDate] = useState(false);
  const [duration, setDuration] = useState(30);
  const [notes, setNotes] = useState('');
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
      scheduled_for: noDate ? null : scheduledFor,
      duration_minutes: duration,
      notes: notes.trim() || null,
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
    setNotes('');
    setNoDate(false);
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

  const editTask = useCallback(async (taskId: string, patch: EditPatch) => {
    // Optimistic update — notes are part of the patch so they are
    // preserved alongside any title/date/duration edits.
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    );

    const success = await updateTask(taskId, patch);
    if (!success) {
      setError('Failed to update task');
      // Reload from server on failure
      const data = await getTasks();
      setTasks(data);
    }
  }, []);

  // Group tasks by section
  const grouped = getBuckets().map((bucket) => {
    const items = tasks
      .filter((t) => getSectionFromDate(t.scheduled_for) === bucket.section)
      .sort((a, b) => {
        // Completed tasks at bottom
        if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
        return (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '');
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
        <div className="flex flex-col gap-4">
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
              disabled={noDate}
              onChange={(e) => setScheduledFor(e.target.value)}
              className={`w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-500 dark:focus:ring-zinc-700 ${
                noDate ? 'cursor-not-allowed opacity-50' : ''
              }`}
            />
            <label className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={noDate}
                onChange={(e) => setNoDate(e.target.checked)}
                className="h-3.5 w-3.5 accent-zinc-900 dark:accent-zinc-100"
              />
              No date
            </label>
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

          <div>
            <label htmlFor="task-notes" className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Notes (optional)
            </label>
            <textarea
              id="task-notes"
              rows={2}
              placeholder="Add details, context, or sub-steps…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 transition-colors focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-500 dark:focus:ring-zinc-700"
            />
          </div>
        </div>
      </section>

      {/* Section-grouped rows — all four categories always visible, even when empty. */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
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
            onUpdate={editTask}
          />
        ))}
      </div>
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
  onUpdate,
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
  onUpdate: (id: string, patch: EditPatch) => void;
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
      className={`flex h-full flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 ${sectionColor} ${draggedId ? 'min-h-[160px]' : ''}`}
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
      <div className="space-y-2 p-4">
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
              onUpdate={onUpdate}
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
  onUpdate,
}: {
  task: Task;
  draggedId: string | null;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: EditPatch) => void;
}) {
  const isCompleted = task.status === 'completed';
  const isDragging = draggedId === task.id;

  // Stage 9 — explicit "Add to calendar" toggle on each task. Inserts a
  // REAL calendar_event for the task's scheduled date — the task itself
  // is never mutated. The two systems stay independent.
  const [calOpen, setCalOpen] = useState(false);
  const [calTime, setCalTime] = useState('09:00');
  const [calDuration, setCalDuration] = useState<number>(task.duration_minutes ?? 30);
  const [calSaving, setCalSaving] = useState(false);
  const [calFeedback, setCalFeedback] = useState<string | null>(null);
  const [calError, setCalError] = useState<string | null>(null);

  // Inline edit state — notes are edited alongside title/date/duration
  // so they are always preserved across an edit.
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDate, setEditDate] = useState<string>(task.scheduled_for ?? '');
  const [editDuration, setEditDuration] = useState<number>(
    task.duration_minutes ?? 30,
  );
  const [editNotes, setEditNotes] = useState(task.notes ?? '');

  function startEdit() {
    setEditTitle(task.title);
    setEditDate(task.scheduled_for ?? '');
    setEditDuration(task.duration_minutes ?? 30);
    setEditNotes(task.notes ?? '');
    setCalOpen(false);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function saveEdit() {
    const trimmedTitle = editTitle.trim();
    if (!trimmedTitle) return;
    onUpdate(task.id, {
      title: trimmedTitle,
      scheduled_for: editDate || null,
      duration_minutes: editDuration,
      notes: editNotes.trim() || null,
    });
    setEditing(false);
  }

  async function handleAddToCalendar() {
    if (!task.scheduled_for) return;
    setCalError(null);
    setCalFeedback(null);
    setCalSaving(true);
    try {
      const ev = buildEventFromTask({
        taskTitle: task.title,
        taskDate: task.scheduled_for,
        taskDurationMinutes: task.duration_minutes ?? null,
        startTime: calTime,
        durationMinutes: calDuration,
      });
      const result = await createCalendarEvent(ev);
      if (!result.ok) {
        setCalError(result.error ?? 'Failed to add to calendar.');
        return;
      }
      setCalFeedback('Added to calendar');
      window.setTimeout(() => {
        setCalOpen(false);
        setCalFeedback(null);
      }, 1400);
    } finally {
      setCalSaving(false);
    }
  }

  return (
    <div
      draggable={!editing}
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
          onDragStart={(e) => e.stopPropagation()}
        >
          {isCompleted && (
            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                placeholder="Task title"
                autoFocus
                className="w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">
                  <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Date</span>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>
                <label className="block">
                  <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Minutes</span>
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={editDuration}
                    onChange={(e) => setEditDuration(Math.max(1, parseInt(e.target.value) || 1))}
                    className="mt-0.5 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  />
                </label>
              </div>
              <label className="block">
                <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Notes (optional)</span>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Add details…"
                  className="mt-0.5 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                />
              </label>
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={!editTitle.trim()}
                  className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
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
              {task.notes ? (
                <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
                  {task.notes}
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* Action buttons (hidden while editing) */}
        {!editing && (
          <>
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

            {/* Edit */}
            <button
              onClick={startEdit}
              className="shrink-0 rounded-md p-0.5 text-zinc-200 opacity-0 transition-all hover:text-zinc-700 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-zinc-300"
              aria-label="Edit task"
              onDragStart={(e) => e.stopPropagation()}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>

            {/* Add to calendar */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCalOpen((v) => !v);
                setCalFeedback(null);
                setCalError(null);
              }}
              onDragStart={(e) => e.stopPropagation()}
              disabled={!task.scheduled_for}
              title={
                task.scheduled_for
                  ? 'Add this task to the calendar (creates a new event)'
                  : 'Set a date before adding this task to the calendar'
              }
              aria-label={`Add ${task.title} to the calendar`}
              aria-expanded={calOpen}
              className={`shrink-0 rounded-md p-0.5 transition-all ${
                calOpen
                  ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:ring-rose-900'
                  : 'text-zinc-200 opacity-0 hover:text-rose-500 group-hover:opacity-100 dark:text-zinc-600 dark:hover:text-rose-400'
              }`}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>

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
          </>
        )}
      </div>

      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          calOpen ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'
        }`}
        aria-hidden={!calOpen}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="mt-2 space-y-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Add to calendar
            </span>
            {calFeedback && (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                {calFeedback}
              </span>
            )}
            {calError && (
              <span className="text-[10px] font-medium text-red-600 dark:text-red-400">
                {calError}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="block">
              <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Date</span>
              <input
                type="text"
                value={task.scheduled_for ?? ''}
                readOnly
                className="mt-0.5 w-full cursor-default rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Time</span>
              <input
                type="time"
                step={900}
                value={calTime}
                onChange={(e) => setCalTime(e.target.value)}
                className="mt-0.5 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
            <label className="block">
              <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Minutes</span>
              <input
                type="number"
                min={15}
                max={480}
                step={15}
                value={calDuration}
                onChange={(e) => setCalDuration(Math.max(15, parseInt(e.target.value, 10) || 15))}
                className="mt-0.5 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setCalOpen(false);
                setCalFeedback(null);
                setCalError(null);
              }}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleAddToCalendar();
              }}
              disabled={calSaving}
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {calSaving ? 'Saving…' : 'Add to calendar'}
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
            Creates a new calendar event. The task itself is unchanged.
          </p>
        </div>
      </div>
    </div>
  );
}
