'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import {
  listWeightEntries,
  createWeightEntry,
  deleteWeightEntry,
  getWeightTarget,
  setWeightTarget,
  computeWeightProgress,
} from '@/lib/fitness/weight';
import type { WeightEntry, WeightTarget } from '@/lib/fitness/types';

/**
 * WeightTracking — manual entries with a target-line chart.
 *
 * - Entries are free-form: any date, any weight, optional notes.
 * - Target line overlayed in red; current weight annotated.
 * - "Set target" form exists underneath. Default the first time we see
 *   no target the placeholder reads "90kg goal".
 */
export default function WeightTracking({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [target, setTarget] = useState<WeightTarget | null>(null);
  const [loading, setLoading] = useState(true);

  const [weight, setWeight] = useState('');
  const [recordedAt, setRecordedAt] = useState(() => todayISO());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [targetKg, setTargetKg] = useState('90');
  const [targetNotes, setTargetNotes] = useState('');
  const [showTargetEditor, setShowTargetEditor] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [es, t] = await Promise.all([
        listWeightEntries(userId),
        getWeightTarget(userId),
      ]);
      if (cancelled) return;
      setEntries(es);
      setTarget(t);
      if (t?.target_kg) setTargetKg(String(t.target_kg));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  const progress = useMemo(
    () => computeWeightProgress(entries, target),
    [entries, target]
  );

  async function handleAddEntry() {
    if (saving) return;
    const kg = parseFloat(weight);
    if (!Number.isFinite(kg) || kg <= 0) {
      setError('Enter a valid weight (kg).');
      return;
    }
    setSaving(true);
    setError(null);
    const created = await createWeightEntry({
      user_id: userId,
      weight_kg: kg,
      recorded_at: new Date(recordedAt).toISOString(),
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!created) {
      setError('Failed to add entry.');
      return;
    }
    setWeight('');
    setNotes('');
    onSaved();
  }

  async function handleDelete(id: string) {
    const ok = await deleteWeightEntry(id);
    if (!ok) {
      setError('Failed to delete entry.');
      return;
    }
    onSaved();
  }

  async function handleSaveTarget() {
    const kg = parseFloat(targetKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      setError('Enter a valid target weight.');
      return;
    }
    setError(null);
    const t = await setWeightTarget({
      user_id: userId,
      target_kg: kg,
      notes: targetNotes.trim() || null,
    });
    if (!t) {
      setError('Failed to save target.');
      return;
    }
    setTarget(t);
    setShowTargetEditor(false);
    onSaved();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  // Chart data — show last 90 entries. Each row needs an x label &
  // weight. We keep both entries with notes and the target as flat
  // numeric series so recharts can plot them together.
  const chartData = entries
    .slice(-90)
    .map((e) => ({
      date: new Date(e.recorded_at).toISOString().slice(0, 10),
      label: formatChartDate(e.recorded_at),
      weight: e.weight_kg,
    }));

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Target card */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Target
            </div>
            {target ? (
              <>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
                  {target.target_kg}kg
                </div>
                {progress && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                    <span>
                      Currently <span className="font-mono text-zinc-200">{progress.current_kg.toFixed(1)}kg</span>
                    </span>
                    <span className="text-zinc-700">·</span>
                    <span>
                      <span
                        className={
                          progress.direction_to_go === 'reached'
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }
                      >
                        {progress.direction_to_go === 'reached'
                          ? 'goal reached'
                          : progress.direction_to_go === 'down'
                            ? `${progress.delta_kg.toFixed(1)}kg to lose`
                            : `${Math.abs(progress.delta_kg).toFixed(1)}kg to gain`}
                      </span>
                    </span>
                  </div>
                )}
                {/* Progress bar */}
                {progress && (
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-rose-500 transition-all duration-700 ease-out"
                      style={{ width: `${Math.round(progress.pct_complete * 100)}%` }}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-300">
                  No target set
                </div>
                <p className="mt-1 text-xs text-zinc-500">Set a target weight below to track progress.</p>
              </>
            )}
          </div>
          <button
            onClick={() => setShowTargetEditor((s) => !s)}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            {showTargetEditor ? 'Cancel' : target ? 'Edit' : 'Set target'}
          </button>
        </div>

        {showTargetEditor && (
          <div className="mt-4 grid gap-3 border-t border-zinc-800/60 pt-4 sm:grid-cols-[1fr_2fr_auto]">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                Target (kg)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={targetKg}
                onChange={(e) => setTargetKg(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                Notes
              </label>
              <input
                type="text"
                placeholder="e.g. body-recomposition goal"
                value={targetNotes}
                onChange={(e) => setTargetNotes(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleSaveTarget}
                className="w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Entry form */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <h3 className="mb-3 text-sm font-semibold text-zinc-100">Add weight entry</h3>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto]">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Weight (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="e.g. 82.4"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Date
            </label>
            <input
              type="date"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              max={todayISO()}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              Notes
            </label>
            <input
              type="text"
              placeholder="optional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleAddEntry}
              disabled={saving || !weight.trim()}
              className="w-full rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
            >
              {saving ? '…' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <h3 className="text-sm font-semibold text-zinc-100">Weight over time</h3>
        <p className="mt-0.5 text-xs text-zinc-500">
          {entries.length === 0
            ? 'No entries yet — add your first weight above.'
            : `Last ${Math.min(entries.length, 90)} entries`}
        </p>
        {chartData.length > 0 ? (
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  stroke="#52525b"
                  tick={{ fontSize: 10 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[
                    (dataMin: number) => Math.floor(Math.min(dataMin, target?.target_kg ?? dataMin) - 1),
                    (dataMax: number) => Math.ceil(Math.max(dataMax, target?.target_kg ?? dataMax) + 1),
                  ]}
                  stroke="#52525b"
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: 8,
                    fontSize: 12,
                  }}                    formatter={(v) => [`${(v as number).toFixed(1)}kg`, 'Weight'] as [string, string]}
                />
                {target?.target_kg && (
                  <ReferenceLine
                    y={target.target_kg}
                    stroke="#f43f5e"
                    strokeDasharray="4 4"
                    label={{
                      value: `${target.target_kg}kg target`,
                      position: 'insideTopRight',
                      fill: '#f43f5e',
                      fontSize: 10,
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="weight"
                  stroke="#a5b4fc"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#a5b4fc' }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-xs text-zinc-500">
            Chart will appear once you add at least one entry.
          </div>
        )}
      </div>

      {/* Recent entries list */}
      {entries.length > 0 && (
        <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
          <h3 className="mb-3 text-sm font-semibold text-zinc-100">All entries</h3>
          <div className="space-y-1.5">
            {[...entries]
              .sort((a, b) =>
                new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
              )
              .slice(0, 15)
              .map((e) => (
                <div
                  key={e.id}
                  className="group flex items-center justify-between rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2 transition-colors hover:bg-zinc-900/60"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-semibold text-zinc-200">
                      {e.weight_kg}kg
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(e.recorded_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {e.notes && (
                      <span className="hidden text-xs text-zinc-500 sm:inline">· {e.notes}</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="text-[10px] font-medium text-zinc-700 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    Delete
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatChartDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
