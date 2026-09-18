'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  listMuscleTargets,
  upsertMuscleTarget,
  type HevyMuscleTarget,
} from '@/lib/fitness/hevy/muscle-targets';
import { MUSCLES } from '@/lib/fitness/hevy/muscle-data';

/**
 * MuscleTargetsEditor — "Per-muscle target frequency".
 *
 * Progressive disclosure (Stage 5 §12 behaviour preserved):
 *   - The page shows ONE master control: "Train each muscle: [N]× per
 *     week" + **Apply to All** (writes every muscle in one go).
 *   - **Manually Select** opens a modal listing every muscle with its
 *     own weekly target + optional note. Editing there is draft-only;
 *     nothing is written until **Save**. Closing/cancelling discards
 *     the draft, so values can never be modified accidentally.
 *   - Each muscle keeps its own stored row (1×/wk for Legs while
 *     Chest runs 2×/wk still works); notes remain user context that
 *     no automated flow rewrites.
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
  const [stored, setStored] = useState<HevyMuscleTarget[]>([]);
  const [masterValue, setMasterValue] = useState(2);
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await listMuscleTargets(userId);
      if (cancelled) return;
      setStored(list);
      // Master control mirrors the most common stored value (falls
      // back to 2× — the module default) so Apply to All starts from
      // something sensible.
      if (list.length > 0) {
        const counts = new Map<number, number>();
        for (const t of list) {
          counts.set(
            t.targetSessionsPerWeek,
            (counts.get(t.targetSessionsPerWeek) ?? 0) + 1,
          );
        }
        const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        setMasterValue(dominant || 2);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  /** Reflect freshly saved rows back into the editor (post-save). */
  const refreshStored = useCallback(async () => {
    setStored(await listMuscleTargets(userId));
    setSavedAt(Date.now());
  }, [userId]);

  async function applyToAll() {
    setSavingAll(true);
    for (const muscle of MUSCLES) {
      await upsertMuscleTarget(userId, muscle, {
        targetSessionsPerWeek: masterValue,
        notes: undefined, // preserve each muscle's existing note
      });
    }
    await refreshStored();
    setSavingAll(false);
  }

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center text-xs text-zinc-500">
        Loading targets…
      </div>
    );
  }

  const customCount = stored.filter(
    (t) => t.targetSessionsPerWeek !== masterValue,
  ).length;

  return (
    <div>
      <header className="mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Per-muscle target frequency
        </div>
        <h2 className="mt-1 text-base font-semibold text-zinc-100">
          How often do you want to train each muscle?
        </h2>
        <p className="mt-1 text-[11px] text-zinc-500">
          Drives the &quot;On target / Below / Above&quot; badges on the
          Training Frequency page. Notes stay private to you.
        </p>
      </header>

      {/* Master control */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800/40 bg-zinc-900/30 p-4">
        <span className="text-sm font-medium text-zinc-100">
          Train each muscle:
        </span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={masterValue}
            onChange={(e) =>
              setMasterValue(Math.max(0, Number(e.target.value) || 0))
            }
            className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
          />
          <span className="text-sm text-zinc-400">× per week</span>
        </div>
        <button
          onClick={applyToAll}
          disabled={savingAll}
          className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {savingAll ? 'Applying…' : 'Apply to All'}
        </button>
        {savedAt > 0 && (
          <span className="text-[10px] text-emerald-300">Saved</span>
        )}
      </div>

      {/* Manual per-muscle editing */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-zinc-100">
            Manually Select
          </div>
          <div className="text-[11px] text-zinc-500">
            {stored.length === 0
              ? 'No custom targets yet — every muscle uses its own stored value or the default.'
              : customCount === 0
                ? 'All muscles share the master value.'
                : `${customCount} muscle${customCount === 1 ? '' : 's'} with a custom target.`}
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
        >
          Manually Select
        </button>
      </div>

      {modalOpen && (
        <ManualTargetsModal
          userId={userId}
          stored={stored}
          onClose={() => setModalOpen(false)}
          onSaved={() => void refreshStored()}
        />
      )}
    </div>
  );
}

// ─── Manual per-muscle modal ───────────────────────────────────────

function ManualTargetsModal({
  userId,
  stored,
  onClose,
  onSaved,
}: {
  userId: string;
  stored: HevyMuscleTarget[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Draft state seeded from stored values — edits live ONLY here
  // until Save is pressed, so closing without saving never touches
  // the DB.
  const [drafts, setDrafts] = useState<DraftRow[]>(() =>
    MUSCLES.map((m) => {
      const t = stored.find((s) => s.muscle === m);
      return {
        muscle: m,
        sessions: t?.targetSessionsPerWeek ?? 2,
        notes: t?.notes ?? '',
      };
    }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateDraft(muscle: string, patch: Partial<DraftRow>) {
    setDrafts((rows) =>
      rows.map((r) => (r.muscle === muscle ? { ...r, ...patch } : r)),
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    for (const row of drafts) {
      const ok = await upsertMuscleTarget(userId, row.muscle, {
        targetSessionsPerWeek: row.sessions,
        notes: row.notes.trim() === '' ? null : row.notes.trim(),
      });
      if (!ok) {
        setError('Some rows failed to save — check the console and retry.');
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    onSaved();
    onClose();
  }

  // Close on Escape (treated as cancel — drafts are discarded).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Per-muscle target frequencies"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Set frequency per muscle
            </h2>
            <p className="text-[11px] text-zinc-500">
              Weekly target per muscle. Nothing saves until you press
              Save — closing discards changes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Scrollable muscle list */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <ul className="space-y-2.5">
            {drafts.map((row) => {
              const storedRow = stored.find((s) => s.muscle === row.muscle);
              const dirty =
                row.sessions !== (storedRow?.targetSessionsPerWeek ?? 2) ||
                (row.notes.trim() || null) !== (storedRow?.notes ?? null);
              return (
                <li
                  key={row.muscle}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/40 bg-zinc-900/30 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-zinc-100">
                      {row.muscle}
                    </div>
                    <input
                      type="text"
                      value={row.notes}
                      onChange={(e) =>
                        updateDraft(row.muscle, { notes: e.target.value })
                      }
                      placeholder="Optional note (e.g. &quot;Keep lower — football.&quot;)"
                      className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px] text-zinc-200 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={row.sessions}
                      onChange={(e) =>
                        updateDraft(row.muscle, {
                          sessions: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-zinc-500">×/wk</span>
                    {dirty && (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-rose-500"
                        title="Unsaved change"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800 px-5 py-3">
          {error ? (
            <span className="text-xs text-amber-300">{error}</span>
          ) : (
            <span className="text-[11px] text-zinc-500">
              Changes apply to the Training Frequency badges on save.
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
