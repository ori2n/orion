'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listExercises,
  findOrCreateExercise,
  renameExercise,
  archiveExercise,
  unarchiveExercise,
} from '@/lib/fitness/exercises';
import type { Exercise, ExerciseCategory } from '@/lib/fitness/types';
import { logEvent, EventTypes } from '@/lib/events';

/**
 * ExerciseLibrary — Settings-surface for the user's exercise list.
 *
 * Goals:
 *   - One canonical place to create / rename / archive / restore
 *     movements.
 *   - Light-and-fast: single page, single search box, single column.
 *   - No detours during normal logging — the Log Workout flow uses
 *     SearchableExercisePicker, not this page.
 */
export default function ExerciseLibrary({ userId }: { userId: string }) {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  // ── Create ──────────────────────────────────────────────────
  const [createName, setCreateName] = useState('');
  const [createCategory, setCreateCategory] =
    useState<ExerciseCategory | ''>('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Rename ──────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] =
    useState<ExerciseCategory | ''>('');
  const [editError, setEditError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    const list = await listExercises(userId, {
      includeArchived: showArchived,
    });
    setExercises(list);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, showArchived]);

  const filtered = useMemo(() => {
    if (!search.trim()) return exercises;
    const q = search.toLowerCase();
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.category && e.category.includes(q)),
    );
  }, [exercises, search]);

  async function handleCreate() {
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    const created = await findOrCreateExercise(
      name,
      userId,
      (createCategory || null) as ExerciseCategory | null,
    );
    setCreating(false);
    if (!created) {
      setCreateError('Failed to create. Try again.');
      return;
    }
    setExercises((prev) =>
      prev.some((e) => e.id === created.id)
        ? prev
        : [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCreateName('');
    setCreateCategory('');
  }

  function startEdit(ex: Exercise) {
    setEditingId(ex.id);
    setEditName(ex.name);
    setEditCategory((ex.category ?? '') as ExerciseCategory | '');
    setEditError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setEditError(null);
    const next = await renameExercise(
      editingId,
      editName,
      userId,
      (editCategory || null) as ExerciseCategory | null,
    );
    if (!next) {
      setEditError('That name already exists in your library.');
      return;
    }
    setExercises((prev) =>
      prev.map((e) => (e.id === next.id ? next : e)),
    );
    setEditingId(null);
  }

  async function handleArchive(id: string) {
    if (!confirm('Archive this exercise? It will no longer appear in workout logging but its past sets stay intact.')) {
      return;
    }
    const ok = await archiveExercise(id);
    if (!ok) return;
    void logEvent(EventTypes.EXERCISE_ARCHIVED, { exercise_id: id });
    reload();
  }

  async function handleRestore(id: string) {
    const ok = await unarchiveExercise(id);
    if (!ok) return;
    void logEvent(EventTypes.EXERCISE_RESTORED, { exercise_id: id });
    reload();
  }

  return (
    <section
      aria-label="Exercise Library"
      className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm"
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">
            Exercise Library
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Create, rename, archive movements. Your logging flow doesn't
            require you to visit this page.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
          />
          Show archived
        </label>
      </header>

      {/* ── Create ──────────────────────────────────────────── */}
      <div className="mb-5 rounded-xl border border-zinc-800/70 bg-zinc-900/60 p-4">
        <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
          Add exercise
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="e.g. Bulgarian Split Squat"
            value={createName}
            onChange={(e) => {
              setCreateName(e.target.value);
              setCreateError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleCreate();
            }}
            className="min-w-[180px] flex-1 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
          />
          <select
            value={createCategory}
            onChange={(e) =>
              setCreateCategory(e.target.value as ExerciseCategory | '')
            }
            className="rounded-lg border border-zinc-700 bg-zinc-800/70 px-2 py-2 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
          >
            <option value="">Category</option>
            <option value="push">Push</option>
            <option value="pull">Pull</option>
            <option value="legs">Legs</option>
            <option value="core">Core</option>
            <option value="cardio">Cardio</option>
            <option value="other">Other</option>
          </select>
          <button
            onClick={() => void handleCreate()}
            disabled={creating || !createName.trim()}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
          >
            {creating ? '…' : 'Add'}
          </button>
        </div>
        {createError && (
          <p className="mt-2 text-xs text-red-400">{createError}</p>
        )}
      </div>

      {/* ── Search ───────────────────────────────────────────── */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search exercises…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
          {search.trim()
            ? 'No exercises match your search.'
            : showArchived
              ? 'No archived exercises yet.'
              : 'No exercises yet. Create one above.'}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-800/50">
          {filtered.map((ex) => (
            <li
              key={ex.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              {editingId === ex.id ? (
                <EditRow
                  name={editName}
                  setName={setEditName}
                  category={editCategory}
                  setCategory={setEditCategory}
                  error={editError}
                  onCancel={cancelEdit}
                  onSave={() => void saveEdit()}
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-sm text-zinc-100">
                    {ex.name}
                  </span>
                  {ex.category && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${categoryColor(
                        ex.category,
                      )}`}
                    >
                      {ex.category}
                    </span>
                  )}
                  {ex.is_archived && (
                    <span className="rounded-md bg-zinc-800/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-500">
                      Archived
                    </span>
                  )}
                </div>
              )}

              {editingId !== ex.id && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => startEdit(ex)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    Rename
                  </button>
                  {showArchived ? (
                    <button
                      onClick={() => void handleRestore(ex.id)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-950/30 hover:text-emerald-300"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      onClick={() => void handleArchive(ex.id)}
                      className="rounded-md px-2 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-red-400"
                    >
                      Archive
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Edit row inline ──────────────────────────────────────────

function EditRow({
  name,
  setName,
  category,
  setCategory,
  error,
  onCancel,
  onSave,
}: {
  name: string;
  setName: (v: string) => void;
  category: ExerciseCategory | '';
  setCategory: (v: ExerciseCategory | '') => void;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
            if (e.key === 'Escape') onCancel();
          }}
          className="min-w-[160px] flex-1 rounded-md border border-zinc-600 bg-zinc-800/70 px-2.5 py-1.5 text-sm text-zinc-100 focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as ExerciseCategory | '')
          }
          className="rounded-md border border-zinc-700 bg-zinc-800/70 px-2 py-1.5 text-xs text-zinc-200 focus:outline-none"
        >
          <option value="">Category</option>
          <option value="push">Push</option>
          <option value="pull">Pull</option>
          <option value="legs">Legs</option>
          <option value="core">Core</option>
          <option value="cardio">Cardio</option>
          <option value="other">Other</option>
        </select>
        <button
          onClick={onSave}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function categoryColor(cat: ExerciseCategory): string {
  switch (cat) {
    case 'push':
      return 'bg-blue-900/40 text-blue-400';
    case 'pull':
      return 'bg-amber-900/40 text-amber-400';
    case 'legs':
      return 'bg-emerald-900/40 text-emerald-400';
    case 'core':
      return 'bg-violet-900/40 text-violet-400';
    case 'cardio':
      return 'bg-rose-900/40 text-rose-400';
    case 'other':
      return 'bg-zinc-800/50 text-zinc-400';
    default:
      return 'bg-zinc-800/50 text-zinc-400';
  }
}
