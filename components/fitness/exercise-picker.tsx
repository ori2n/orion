'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  findOrCreateExercise,
  SUGGESTED_EXERCISES,
} from '@/lib/fitness/exercises';
import type { Exercise } from '@/lib/fitness/types';

/**
 * SearchableExercisePicker — modal that powers "Add Exercise" inside
 * the Log Workout flow.
 *
 * UX rules (from the user's brief):
 *   - Searchable: typing filters library by name.
 *   - One-tap create: pressing Enter on a non-matching query creates a
 *     brand-new exercise AND closes the modal with `onSelect(newEx)`.
 *   - Empty library: shows the SUGGESTED_EXERCISES starter list.
 *   - Closes on Escape / backdrop click; pending input is discarded.
 *
 * Does NOT own the exercise library — caller passes the current list
 * and a setter so this stays focused on search UX.
 *
 * `keepOpenOnSelect` mode is for fast multi-add logging: tapping a
 * result adds the exercise and keeps the modal open so the user can
 * chain-add the next exercise without re-opening. A "Done" footer
 * button closes manually when the user finishes building the set list.
 */
export default function SearchableExercisePicker({
  userId,
  exercises,
  onSelect,
  onClose,
  onExercisesChange,
  keepOpenOnSelect = false,
}: {
  userId: string;
  exercises: Exercise[];
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
  onExercisesChange: (next: Exercise[]) => void;
  /** When true, picking a result does NOT auto-close the modal — the
   * user taps "Done" to close. Used by the compact workout flow. */
  keepOpenOnSelect?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the search box on mount so the user can start typing.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape closes the modal.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const lowerQ = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!lowerQ) return exercises.slice(0, 8);
    return exercises
      .filter((e) => e.name.toLowerCase().includes(lowerQ))
      .slice(0, 8);
  }, [exercises, lowerQ]);

  const exactMatch = useMemo(
    () => exercises.find((e) => e.name.toLowerCase() === lowerQ) ?? null,
    [exercises, lowerQ],
  );

  // When the library is empty AND there's no query, show the suggested
  // starter list so first-time users have something to tap.
  const missingSuggestions = useMemo(
    () =>
      SUGGESTED_EXERCISES.filter(
        (s) => !exercises.some((e) => e.name.toLowerCase() === s.name.toLowerCase()),
      ).slice(0, 6),
    [exercises],
  );

  async function commitNew(name: string) {
    setBusy(true);
    setError(null);
    const ex = await findOrCreateExercise(name, userId, null);
    setBusy(false);
    if (!ex) {
      setError('Could not create exercise. Try again.');
      return;
    }
    onExercisesChange(
      exercises.some((e) => e.id === ex.id)
        ? exercises
        : [...exercises, ex].sort((a, b) => a.name.localeCompare(b.name)),
    );
    onSelect(ex);
    if (!keepOpenOnSelect) onClose();
    else setQuery(''); // reset for the next add
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = query.trim();
    if (!value) return;
    if (exactMatch) {
      onSelect(exactMatch);
      if (!keepOpenOnSelect) onClose();
      return;
    }
    await commitNew(value);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-label="Pick an exercise"
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-700/60 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-100">
            Add Exercise
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <form onSubmit={handleSubmit} className="border-b border-zinc-800/60 p-5">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Search
          </label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setError(null);
              }}
              placeholder="e.g. Bench Press"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-400">{error}</p>
          )}
        </form>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {filtered.length > 0 && (
            <ul className="space-y-0.5">
              {filtered.map((ex) => (                  <li key={ex.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(ex);
                      if (!keepOpenOnSelect) onClose();
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-zinc-800/60"
                  >
                    <span className="text-sm font-medium text-zinc-100">
                      {ex.name}
                    </span>
                    {ex.category && (
                      <span className="ml-2 rounded bg-zinc-800/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-zinc-400">
                        {ex.category}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Create-new affordance — only when the query has content and no exact match exists */}
          {lowerQ && !exactMatch && (
            <button
              type="button"
              onClick={() => void commitNew(query.trim())}
              disabled={busy}
              className="mt-1 flex w-full items-center justify-between rounded-lg border border-dashed border-zinc-700/70 bg-zinc-900/40 px-3 py-2.5 text-left transition-colors hover:border-rose-700/60 hover:bg-rose-950/20 disabled:opacity-40"
            >
              <span className="text-sm font-medium text-rose-300">
                + Create New Exercise
              </span>
              <span className="text-[11px] font-mono text-zinc-400">
                “{query.trim()}”
              </span>
            </button>
          )}

          {/* Empty library hint */}
          {!lowerQ && filtered.length === 0 && missingSuggestions.length > 0 && (
            <div className="px-1 py-2">
              <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
                Suggestions
              </p>
              <ul className="space-y-0.5">
                {missingSuggestions.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      onClick={() => void commitNew(s.name)}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-zinc-800/60 disabled:opacity-40"
                    >
                      <span className="text-sm text-zinc-200">{s.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                        {s.category}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Empty state */}
          {!lowerQ && filtered.length === 0 && missingSuggestions.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-zinc-500">
              Start typing to find or create a movement.
            </p>
          )}

          {lowerQ && filtered.length === 0 && !exactMatch && busy && (
            <p className="px-3 py-4 text-center text-xs text-zinc-500">
              Creating “{query.trim()}”…
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-800/60 px-5 py-3">
          <p className="text-[10px] text-zinc-600">
            <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
              ↵
            </kbd>{' '}
            to create · <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
              Esc
            </kbd>{' '}
            to close
          </p>
          {keepOpenOnSelect && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
