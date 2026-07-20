'use client';

import { useState, useEffect, useMemo } from 'react';
import { findOrCreateExercise, SUGGESTED_EXERCISES } from '@/lib/fitness/exercises';
import type { Exercise, ExerciseCategory } from '@/lib/fitness/types';

/**
 * ExerciseManager — modal for browsing, adding, and suggesting exercises.
 *
 * Features:
 *   - Add custom exercises with optional category
 *   - One-tap add from 12 common suggested exercises
 *   - Shows all user exercises with category badges
 *   - Searches/filters existing exercises
 */
export default function ExerciseManager({
  userId,
  exercises,
  onExercisesChange,
  onClose,
}: {
  userId: string;
  exercises: Exercise[];
  onExercisesChange: (exercises: Exercise[]) => void;
  onClose: () => void;
}) {
  // Close on Escape key
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!mounted) {
      setMounted(true);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, mounted]);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<ExerciseCategory | ''>('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Track which names already exist
  const existingNames = useMemo(
    () => new Set(exercises.map((e) => e.name.toLowerCase())),
    [exercises]
  );

  const missingSuggestions = SUGGESTED_EXERCISES.filter(
    (s) => !existingNames.has(s.name.toLowerCase())
  );

  const filteredExercises = useMemo(() => {
    if (!search.trim()) return exercises;
    const q = search.toLowerCase();
    return exercises.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        (e.category && e.category.includes(q))
    );
  }, [exercises, search]);

  async function handleAddCustom() {
    const name = customName.trim();
    if (!name) return;
    if (existingNames.has(name.toLowerCase())) {
      setError(`"${name}" already exists in your library.`);
      return;
    }
    setAdding(true);
    setError(null);
    const ex = await findOrCreateExercise(
      name,
      userId,
      (customCategory || null) as ExerciseCategory | null
    );
    setAdding(false);
    if (ex) {
      onExercisesChange([...exercises, ex]);
      setCustomName('');
      setCustomCategory('');
    } else {
      setError('Failed to add exercise. Check your connection.');
    }
  }

  async function handleAddSuggested(
    name: string,
    category: ExerciseCategory
  ) {
    if (existingNames.has(name.toLowerCase())) return;
    const ex = await findOrCreateExercise(name, userId, category);
    if (ex) {
      onExercisesChange([...exercises, ex]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-700/50 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            Exercise Library
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* ── Add custom exercise ── */}
          <div className="mb-5 rounded-xl border border-zinc-800/70 bg-zinc-900/60 p-4">
            <label className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Add custom exercise
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Bulgarian Split Squat"
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAddCustom();
                }}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
              />
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value as ExerciseCategory | '')}
                className="w-28 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-2 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
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
                onClick={handleAddCustom}
                disabled={adding || !customName.trim()}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {adding ? '…' : 'Add'}
              </button>
            </div>
          </div>

          {/* ── Suggested exercises ── */}
          {missingSuggestions.length > 0 && (
            <div className="mb-5">
              <label className="mb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Suggested exercises
              </label>
              <div className="flex flex-wrap gap-1.5">
                {missingSuggestions.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => void handleAddSuggested(s.name, s.category)}
                    className="rounded-lg border border-zinc-700/60 bg-zinc-800/50 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-700/60"
                  >
                    + {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Search / filter existing ── */}
          <div className="mb-3">
            <input
              type="text"
              placeholder="Search exercises…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
          </div>

          {/* ── Existing exercises list ── */}
          {filteredExercises.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
              {search.trim()
                ? 'No exercises match your search.'
                : 'No exercises yet. Add some above!'}
            </p>
          ) : (
            <div className="space-y-1">
              {filteredExercises.map((ex) => (
                <div
                  key={ex.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-zinc-800/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-200">{ex.name}</span>
                    {ex.category && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider ${
                          categoryColor(ex.category)
                        }`}
                      >
                        {ex.category}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-600">
                    {exercises.indexOf(ex) >= 0
                      ? `${exercises.filter((e) => e.id === ex.id).length > 0 ? `#${exercises.indexOf(ex) + 1}` : ''}`
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800/60 px-5 py-3">
          <p className="text-[10px] text-zinc-600">
            {exercises.length} exercise{exercises.length !== 1 ? 's' : ''} in your library
            {missingSuggestions.length > 0
              ? ` · ${missingSuggestions.length} suggestions available`
              : ''}
          </p>
        </div>
      </div>
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
