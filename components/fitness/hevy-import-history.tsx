'use client';

import { useEffect, useState } from 'react';
import {
  deleteHevyImport,
  getHevyWorkoutDetail,
  listHevyImports,
  listHevyWorkouts,
} from '@/lib/fitness/hevy/history';
import type { HevyImportRecord, HevyWorkoutDetail } from '@/lib/fitness/hevy/types';

type WorkoutSummary = Awaited<ReturnType<typeof listHevyWorkouts>>[number];

/**
 * HevyImportHistory — Stage 2 import history + management + verification.
 *
 * Lists past imports with their diagnostics, supports deleting a specific
 * import (with a deliberate two-step confirm), and lets the user browse
 * the stored workouts/sets to confirm the importer was faithful. This is
 * a verification tool, not the final Fitness dashboard.
 */
export default function HevyImportHistory({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [imports, setImports] = useState<HevyImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showVerify, setShowVerify] = useState(false);
  const [workouts, setWorkouts] = useState<WorkoutSummary[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HevyWorkoutDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const rows = await listHevyImports(userId);
      if (cancelled) return;
      setImports(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    setMessage(null);
    const res = await deleteHevyImport(userId, id);
    if (res.ok) {
      setMessage(
        `Import deleted — removed ${res.deletedWorkouts} workout(s), ${res.deletedSets} set(s).`,
      );
      setConfirmId(null);
      setImports(await listHevyImports(userId));
    } else {
      setMessage(res.error ?? 'Delete failed.');
    }
    setDeletingId(null);
  }

  async function toggleVerify() {
    const next = !showVerify;
    setShowVerify(next);
    if (next && workouts.length === 0) {
      setWorkouts(await listHevyWorkouts(userId));
    }
  }

  async function toggleDetail(id: string) {
    if (detailId === id) {
      setDetailId(null);
      setDetail(null);
      return;
    }
    setDetailId(id);
    setDetail(await getHevyWorkoutDetail(userId, id));
  }

  return (
    <section aria-label="Hevy import history" className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Import History
          </div>
          <h3 className="mt-1 text-base font-semibold text-zinc-100">
            Past imports &amp; verification
          </h3>
        </div>
        <button
          onClick={toggleVerify}
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
        >
          {showVerify ? 'Hide records' : 'Verify records'}
        </button>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-3 text-xs text-zinc-400">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
          Loading…
        </div>
      )}

      {!loading && imports.length === 0 && (
        <p className="mt-4 text-xs text-zinc-500">No imports yet.</p>
      )}

      {!loading && imports.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-800/60">
          {imports.map((imp) => (
            <li key={imp.id} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        imp.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-300'
                          : 'bg-red-500/10 text-red-300'
                      }`}
                    >
                      {imp.status}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {formatTime(imp.startedAt)}
                    </span>
                    {imp.rawFileName && (
                      <span className="truncate text-[10px] text-zinc-600">
                        {imp.rawFileName}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-300">
                    {imp.workoutsChecked} checked · {imp.workoutsCreated} new ·{' '}
                    {imp.workoutsUpdated} updated · {imp.setsProcessed.toLocaleString()} sets
                  </p>
                  {(imp.dateMin || imp.dateMax) && (
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {imp.dateMin && imp.dateMax
                        ? `${short(imp.dateMin)} → ${short(imp.dateMax)}`
                        : '—'}
                    </p>
                  )}
                  {imp.warnings.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-amber-300/80">
                      ⚠ {imp.warnings.length} warning{imp.warnings.length === 1 ? '' : 's'}
                    </p>
                  )}
                </div>

                <div className="shrink-0">
                  {confirmId === imp.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(imp.id)}
                        disabled={deletingId === imp.id}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
                      >
                        {deletingId === imp.id ? 'Deleting…' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        disabled={deletingId === imp.id}
                        className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(imp.id)}
                      className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-red-900/50 hover:text-red-300"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-300">
          {message}
        </div>
      )}

      {showVerify && (
        <div className="mt-4 border-t border-zinc-800/60 pt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Stored records (newest first)
          </div>
          {workouts.length === 0 ? (
            <p className="mt-2 text-xs text-zinc-500">No workouts stored.</p>
          ) : (
            <ul className="mt-2 max-h-96 divide-y divide-zinc-800/60 overflow-y-auto pr-1">
              {workouts.map((w) => (
                <li key={w.id}>
                  <button
                    onClick={() => toggleDetail(w.id)}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left"
                  >
                    <span className="truncate text-xs text-zinc-200">
                      {w.title ?? 'Untitled'}{' '}
                      <span className="text-zinc-500">— {w.source_start_time}</span>
                    </span>
                    <span className="shrink-0 text-zinc-500">
                      {detailId === w.id ? '−' : '+'}
                    </span>
                  </button>
                  {detailId === w.id && (
                    <WorkoutDetail detail={detail} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function WorkoutDetail({ detail }: { detail: HevyWorkoutDetail | null }) {
  if (!detail) {
    return <div className="pb-2 text-xs text-zinc-500">Loading…</div>;
  }
  return (
    <div className="space-y-2 pb-3 pl-1">
      {detail.exercises.map((ex) => (
        <div key={`${detail.id}-${ex.orderIndex}-${ex.name}`}>
          <div className="text-xs font-medium text-zinc-300">{ex.name}</div>
          <div className="text-[11px] text-zinc-500">
            {ex.sets.length === 0
              ? 'No sets'
              : ex.sets
                  .map((s) =>
                    s.durationSeconds !== null
                      ? `${s.durationSeconds}s`
                      : `${s.weightKg ?? 'bw'}×${s.reps ?? '-'}`,
                  )
                  .join(' · ')}
          </div>
        </div>
      ))}
    </div>
  );
}

function short(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
