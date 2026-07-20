'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  listWeightEntries,
} from '@/lib/fitness/weight';
import {
  listAllSetsForUser,
  listRecentWorkouts,
} from '@/lib/fitness/workouts';
import {
  buildFlashbacks,
  listMilestones,
  createMilestone,
  deleteMilestone,
  type FlashbackCard,
} from '@/lib/fitness/flashback';
import type { Milestone, WeightEntry, WorkoutSet } from '@/lib/fitness/types';

/**
 * Flashback — auto + manual memory timeline.
 *
 * - **Auto cards**: engine scans weight_entries + workout_sets nearest
 *   common intervals (1mo / 3mo / 6mo / 1yr) and renders a side-by-side
 *   "then vs now" summary per anchor.
 * - **Manual milestones**: user-created entries stored in the `milestones`
 *   table; rendered in chronological order at the bottom.
 */
export default function Flashback({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [allSets, setAllSets] = useState<WorkoutSet[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mTitle, setMTitle] = useState('');
  const [mDescription, setMDescription] = useState('');
  const [mDate, setMDate] = useState(() => todayISO());
  const [savingMilestone, setSavingMilestone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // We need weights + sets + milestones + workout names for richer lift labels.
      const [w, s, ms, _workouts] = await Promise.all([
        listWeightEntries(userId),
        listAllSetsForUser(userId),
        listMilestones(userId),
        listRecentWorkouts(userId, 5),
      ]);
      if (cancelled) return;
      setWeights(w);
      setAllSets(s);
      setMilestones(ms);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const flashbacks: FlashbackCard[] = useMemo(
    () => buildFlashbacks(weights, allSets),
    [weights, allSets]
  );

  async function handleSaveMilestone() {
    if (savingMilestone) return;
    const title = mTitle.trim();
    if (!title) {
      setError('Title is required.');
      return;
    }
    setSavingMilestone(true);
    setError(null);
    const created = await createMilestone({
      user_id: userId,
      kind: 'manual',
      title,
      description: mDescription.trim() || null,
      achieved_at: new Date(mDate).toISOString(),
    });
    setSavingMilestone(false);
    if (!created) {
      setError('Failed to save milestone.');
      return;
    }
    setMTitle('');
    setMDescription('');
    onSaved();
  }

  async function handleDeleteMilestone(id: string) {
    if (!confirm('Delete this milestone?')) return;
    const ok = await deleteMilestone(id);
    if (!ok) {
      setError('Failed to delete milestone.');
      return;
    }
    onSaved();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  const hasAnyData = weights.length > 0 || allSets.length > 0 || milestones.length > 0;

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Auto flashbacks */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-zinc-100">Auto-generated memories</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            ORION looks back at your data and highlights the difference.
          </p>
        </div>
        {flashbacks.length === 0 || !hasAnyData ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
            Log some workouts and weigh-ins to unlock flashbacks.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {flashbacks.map((f) => (
              <FlashbackCardView key={f.anchorISO} card={f} />
            ))}
          </div>
        )}
      </div>

      {/* Manual milestones */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-zinc-100">Milestones</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Personal achievements — first 75kg bench, hit a body-weight goal, etc.
          </p>
        </div>

        {/* Create form */}
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Title
            </label>
            <input
              type="text"
              placeholder="e.g. First 75kg bench"
              value={mTitle}
              onChange={(e) => setMTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Description
            </label>
            <input
              type="text"
              placeholder="optional"
              value={mDescription}
              onChange={(e) => setMDescription(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Date
            </label>
            <input
              type="date"
              value={mDate}
              onChange={(e) => setMDate(e.target.value)}
              max={todayISO()}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleSaveMilestone}
              disabled={savingMilestone || !mTitle.trim()}
              className="w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
            >
              {savingMilestone ? '…' : 'Add'}
            </button>
          </div>
        </div>

        {/* Timeline */}
        {milestones.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-xs text-zinc-500">
            No milestones yet. Add one above to mark a personal achievement.
          </p>
        ) : (
          <div className="mt-5 space-y-2">
            {milestones.map((m) => (
              <div
                key={m.id}
                className="group flex items-start gap-3 rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-4 py-3 transition-colors hover:bg-zinc-900/80"
              >
                <span
                  aria-hidden
                  className="mt-0.5 text-base"
                >
                  {m.kind === 'auto' ? '✨' : '🚩'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-zinc-200">{m.title}</div>
                  {m.description && (
                    <div className="mt-0.5 text-xs text-zinc-500">{m.description}</div>
                  )}
                  <div className="mt-1 text-[10px] text-zinc-600">
                    {new Date(m.achieved_at).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteMilestone(m.id)}
                  className="text-[10px] font-medium text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FlashbackCardView({ card }: { card: FlashbackCard }) {
  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-900/80">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400/70">
        {card.anchorLabel}
      </div>
      <div className="mt-2 text-sm leading-snug text-zinc-200">
        {card.headline.replace(`${card.anchorLabel}: `, '')}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        {card.weight_then_kg !== null && (
          <div className="rounded-md bg-zinc-900/60 px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-zinc-600">Weight ↑↓</div>
            <div className="mt-0.5 font-mono text-zinc-300">
              {card.weight_then_kg.toFixed(1)}kg → {card.weight_now_kg?.toFixed(1) ?? '—'}kg
            </div>
          </div>
        )}
        {card.estimated_1rm_then !== null && (
          <div className="rounded-md bg-zinc-900/60 px-2.5 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-zinc-600">Best lift</div>
            <div className="mt-0.5 font-mono text-zinc-300">
              {card.estimated_1rm_then.toFixed(1)}kg → {card.estimated_1rm_now?.toFixed(1) ?? '—'}kg
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
