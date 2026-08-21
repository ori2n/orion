'use client';

import { useState } from 'react';
import Link from 'next/link';
import { getCurrentUserId } from '@/lib/auth';
import { updateHevyWorkout } from '@/lib/fitness/hevy/history';
import type { HevyWorkoutDetail } from '@/lib/fitness/hevy/types';
import { fmtKg, fmtLongDate, fmtRelativeDate } from '@/lib/fitness/format';

/**
 * WorkoutDetailView — exercise + sets exactly as captured from Hevy
 * (Stage 5 §15), plus an inline editor for the workout's title and
 * description. Sets/reps/weights are a faithful record view and are
 * never mutated here.
 */
export default function WorkoutDetailView({
  detail,
}: {
  detail: HevyWorkoutDetail;
}) {
  const totalSets = detail.exercises.reduce((n, e) => n + e.sets.length, 0);

  const [title, setTitle] = useState(detail.title ?? '');
  const [description, setDescription] = useState(detail.description ?? '');
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(detail.title ?? '');
  const [draftDescription, setDraftDescription] = useState(
    detail.description ?? '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraftTitle(title);
    setDraftDescription(description);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setError(null);
    setEditing(false);
  }

  async function saveEdit() {
    if (!draftTitle.trim()) {
      setError('Title cannot be empty.');
      return;
    }
    const userId = await getCurrentUserId();
    if (!userId) {
      setError('Not signed in.');
      return;
    }
    setSaving(true);
    setError(null);
    const ok = await updateHevyWorkout(userId, detail.id, {
      title: draftTitle.trim() || null,
      description: draftDescription.trim() || null,
    });
    setSaving(false);
    if (!ok) {
      setError('Could not save the workout.');
      return;
    }
    setTitle(draftTitle.trim() || '');
    setDescription(draftDescription.trim() || '');
    setEditing(false);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/fitness/workouts"
        className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← All workouts
      </Link>
      <header className="mb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Workout
          </div>
          {!editing && (
            <button
              onClick={startEdit}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="mt-3 space-y-3 rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-4">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Title
              </span>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Workout title"
                autoFocus
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Description (optional)
              </span>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                placeholder="Notes about this session…"
                rows={2}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
              />
            </label>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={saving}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
              {title.trim() || 'Workout'}
            </h1>
            {description.trim() !== '' && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-400">
                {description}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              <span>{fmtLongDate(detail.startTime ?? detail.sourceStartTime)}</span>
              <span>·</span>
              <span>{fmtRelativeDate(detail.startTime ?? detail.sourceStartTime)}</span>
              <span>·</span>
              <span>
                {detail.exercises.length} exercises · {totalSets} sets
              </span>
            </div>
          </>
        )}
      </header>

      <ul className="space-y-4">
        {detail.exercises.map((ex, idx) => (
          <li
            key={`${detail.id}-${idx}-${ex.name}`}
            className="rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4"
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <Link
                href={`/fitness/strength/${encodeURIComponent(ex.name)}`}
                className="line-clamp-2 text-base font-medium text-zinc-100 hover:text-white"
              >
                {ex.name}
              </Link>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
                {ex.sets.length} set{ex.sets.length === 1 ? '' : 's'}
              </span>
            </div>
            {ex.sets.length === 0 ? (
              <p className="text-xs text-zinc-500">No sets recorded.</p>
            ) : (
              <ol className="grid grid-cols-1 gap-y-1 sm:grid-cols-2">
                {ex.sets.map((s, i) => (
                  <li
                    key={`${idx}-${i}-${s.setIndex}`}
                    className="flex items-baseline justify-between gap-3 font-mono text-xs"
                  >
                    <span className="w-8 text-zinc-500">
                      {i + 1 < 10 ? `0${i + 1}` : i + 1}.
                    </span>
                    <span className="text-zinc-100">
                      {s.durationSeconds !== null
                        ? `${s.durationSeconds}s`
                        : `${fmtKg(s.weightKg)} kg × ${s.reps ?? '–'} reps`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
