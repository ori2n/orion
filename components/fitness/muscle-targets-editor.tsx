'use client';

import { useEffect, useState } from 'react';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import {
  listMuscleTargets,
  upsertMuscleTarget,
  type HevyMuscleTarget,
} from '@/lib/fitness/hevy/muscle-targets';
import { MUSCLES } from '@/lib/fitness/hevy/muscle-data';

/**
 * MuscleTargetsEditor — full per-muscle targets + notes.
 *
 * Stage 5 §12:
 *   - Each muscle has a target sessions/week entry.
 *   - Each muscle can have a free-form note.
 *   - Notes are USER context; no automated rewrite.
 *
 * Behaviour:
 *   - Loads existing targets + computed summaries; pre-fills the form
 *     with whatever is stored, defaulting to 2×/wk when no row exists.
 *   - Per-row Save button writes only that muscle.
 *   - "Apply to all" bulk-saves the current form values for any
 *     muscle whose row is dirty.
 *   - Each save recomputes the engine so any badge consuming the
 *     status updates without a remount.
 */

interface DraftRow {
  muscle: string;
  sessions: number;
  notes: string;
}

export default function MuscleTargetsEditor({
  userId,
  refreshKey,
}: {
  userId: string;
  refreshKey: number;
}) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [stored, setStored] = useState<HevyMuscleTarget[]>([]);
  const [statusByMuscle, setStatusByMuscle] = useState<
    Record<string, 'on' | 'below' | 'above' | null>
  >({});
  const [loading, setLoading] = useState(true);
  const [savingMuscle, setSavingMuscle] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [list, calcs] = await Promise.all([
        listMuscleTargets(userId),
        computeHevyCalculations(userId),
      ]);
      if (cancelled) return;
      setStored(list);
      const storedByMuscle = new Map(list.map((t) => [t.muscle, t]));
      // Show every canonical muscle; pre-fill from stored or default.
      const drafts: DraftRow[] = MUSCLES.map((m) => {
        const t = storedByMuscle.get(m);
        return {
          muscle: m,
          sessions: t?.targetSessionsPerWeek ?? 2,
          notes: t?.notes ?? '',
        };
      });
      setDrafts(drafts);
      const next: Record<string, 'on' | 'below' | 'above' | null> = {};
      for (const ms of calcs.muscles) {
        next[ms.muscle] = ms.onTarget;
      }
      setStatusByMuscle(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  function updateDraft(muscle: string, patch: Partial<DraftRow>) {
    setDrafts((rows) =>
      rows.map((r) => (r.muscle === muscle ? { ...r, ...patch } : r)),
    );
  }

  async function saveOne(muscle: string) {
    const row = drafts.find((r) => r.muscle === muscle);
    if (!row) return;
    setSavingMuscle(muscle);
    const ok = await upsertMuscleTarget(userId, muscle, {
      targetSessionsPerWeek: row.sessions,
      notes: row.notes.trim() === '' ? null : row.notes.trim(),
    });
    if (ok) {
      const calcs = await computeHevyCalculations(userId);
      const next: Record<string, 'on' | 'below' | 'above' | null> = {};
      for (const ms of calcs.muscles) {
        next[ms.muscle] = ms.onTarget;
      }
      setStatusByMuscle(next);
      setStored(await listMuscleTargets(userId));
      setLastSavedAt(Date.now());
    }
    setSavingMuscle(null);
  }

  async function saveAll() {
    setSavingAll(true);
    for (const row of drafts) {
      await upsertMuscleTarget(userId, row.muscle, {
        targetSessionsPerWeek: row.sessions,
        notes: row.notes.trim() === '' ? null : row.notes.trim(),
      });
    }
    const calcs = await computeHevyCalculations(userId);
    const next: Record<string, 'on' | 'below' | 'above' | null> = {};
    for (const ms of calcs.muscles) {
      next[ms.muscle] = ms.onTarget;
    }
    setStatusByMuscle(next);
    setStored(await listMuscleTargets(userId));
    setLastSavedAt(Date.now());
    setSavingAll(false);
  }

  function isDirty(row: DraftRow): boolean {
    const t = stored.find((s) => s.muscle === row.muscle);
    if (!t) return row.sessions !== 2 || (row.notes.trim() !== '');
    return (
      row.sessions !== t.targetSessionsPerWeek ||
      (row.notes.trim() || null) !== (t.notes ?? null)
    );
  }

  return (
    <div>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Per-muscle targets
          </div>
          <h2 className="mt-1 text-base font-semibold text-zinc-100">
            How often do you want to train each muscle?
          </h2>
          <p className="mt-1 text-[11px] text-zinc-500">
            Each row is independent — e.g. Legs can stay at 1×/wk for
            football / sprint reasons while Chest targets 2×/wk.
            Notes are private; no automated process will rewrite them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSavedAt > 0 && (
            <span className="text-[10px] text-emerald-300">Saved</span>
          )}
          <button
            onClick={saveAll}
            disabled={savingAll || loading}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
          >
            {savingAll ? 'Applying…' : 'Apply to all'}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="flex h-32 items-center justify-center text-xs text-zinc-500">
          Loading…
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {drafts.map((row) => {
            const status = statusByMuscle[row.muscle] ?? null;
            return (
              <li
                key={row.muscle}
                className="rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">
                      {row.muscle}
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={row.sessions}
                      onChange={(e) =>
                        updateDraft(row.muscle, {
                          sessions: Number(e.target.value) || 0,
                        })
                      }
                      className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500">×/wk</span>
                    <button
                      onClick={() => saveOne(row.muscle)}
                      disabled={
                        savingMuscle === row.muscle || !isDirty(row)
                      }
                      className="rounded-md bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {savingMuscle === row.muscle ? '…' : 'Save'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={1}
                  value={row.notes}
                  onChange={(e) =>
                    updateDraft(row.muscle, { notes: e.target.value })
                  }
                  placeholder="Optional note (e.g. &quot;Keep lower because of football.&quot;)"
                  className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: 'on' | 'below' | 'above' | null;
}) {
  if (status === null) {
    return (
      <span className="text-[10px] uppercase tracking-wider text-zinc-600">
        —
      </span>
    );
  }
  if (status === 'on') {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
        · on target
      </span>
    );
  }
  if (status === 'below') {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        · below
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">
      · above
    </span>
  );
}
