'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import Link from 'next/link';
import {
  listWeightEntries,
  createWeightEntry,
  deleteWeightEntry,
  getWeightTarget,
  setWeightTarget,
} from '@/lib/fitness/weight';
import { computeWeightProgress } from '@/lib/fitness/weight';
import type { WeightEntry, WeightTarget } from '@/lib/fitness/types';
import {
  fmtKg,
  fmtLongDate,
  twelveWeekMovingAverage,
} from '@/lib/fitness/format';

/**
 * BodyweightDetailView — full history + chart + CRUD form (Stage 5 §5).
 *
 * - 12-week moving average line is the headline metric.
 * - Raw measurements drawn at lower opacity underneath.
 * - Optional target line.
 * - The entry form (add / delete / change target) reuses the existing
 *   bodyweight system untouched.
 */

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BodyweightDetailView({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<WeightEntry[]>([]);
  const [target, setTarget] = useState<WeightTarget | null>(null);
  const [loading, setLoading] = useState(true);

  // Add-entry form state.
  const [weight, setWeight] = useState('');
  const [recordedAt, setRecordedAt] = useState<string>(todayISO());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Target form state.
  const [targetKg, setTargetKg] = useState('90');
  const [targetNotes, setTargetNotes] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    const [es, t] = await Promise.all([
      listWeightEntries(userId),
      getWeightTarget(userId),
    ]);
    setEntries(es);
    setTarget(t);
    if (t?.target_kg) setTargetKg(String(t.target_kg));
    if (t?.notes) setTargetNotes(t.notes);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sortedAsc = useMemo(
    () =>
      [...entries].sort((a, b) =>
        a.recorded_at.localeCompare(b.recorded_at),
      ),
    [entries],
  );

  const progress = useMemo(
    () => computeWeightProgress(sortedAsc, target),
    [sortedAsc, target],
  );

  const maSeries = useMemo(
    () =>
      twelveWeekMovingAverage(
        sortedAsc.map((e) => ({
          date: e.recorded_at.slice(0, 10),
          value: e.weight_kg,
        })),
      ),
    [sortedAsc],
  );

  const chartSeries = useMemo(() => {
    return maSeries.map((p) => ({
      week: p.weekEndIso,
      ma: p.ma,
      raw: p.raw,
    }));
  }, [maSeries]);

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
    void reload();
  }

  async function handleDeleteEntry(id: string) {
    const ok = await deleteWeightEntry(id);
    if (ok) void reload();
  }

  async function handleSaveTarget() {
    const kg = parseFloat(targetKg);
    if (!Number.isFinite(kg) || kg <= 0) return;
    const updated = await setWeightTarget({
      user_id: userId,
      target_kg: kg,
      notes: targetNotes.trim() || null,
    });
    if (updated) {
      setTarget(updated);
      void reload();
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/fitness"
        className="mb-3 inline-block text-xs text-zinc-500 hover:text-zinc-200"
      >
        ← Overview
      </Link>
      <header className="mb-5">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Bodyweight
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
          Weight trend
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Raw measurements + 12-week moving average.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat
          label="Current"
          value={
            sortedAsc.length > 0
              ? fmtKg(sortedAsc[sortedAsc.length - 1].weight_kg, true)
              : '—'
          }
        />
        <Stat
          label="12w avg"
          value={fmtKg(maSeries[maSeries.length - 1]?.ma ?? null, true)}
        />
        <Stat
          label="Entries"
          value={String(sortedAsc.length)}
        />
        <Stat
          label="Range (min)"
          value={
            sortedAsc.length > 0
              ? fmtKg(
                  Math.min(...sortedAsc.map((e) => e.weight_kg)),
                  true,
                )
              : '—'
          }
        />
        <Stat
          label="Range (max)"
          value={
            sortedAsc.length > 0
              ? fmtKg(
                  Math.max(...sortedAsc.map((e) => e.weight_kg)),
                  true,
                )
              : '—'
          }
        />
      </div>

      {progress && (
        <div className="mb-5 rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-4 py-3">
          <div className="text-[11px] text-zinc-400">
            Progress vs target ({fmtKg(progress.target_kg, true)}):{' '}
            <span className="font-mono text-zinc-100">
              {progress.direction_to_go === 'reached'
                ? 'reached'
                : `${progress.delta_kg > 0 ? '+' : ''}${fmtKg(progress.delta_kg)}`}
            </span>{' '}
            · {Math.round(progress.pct_complete * 100)}% complete
          </div>
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Weight + 12-week moving average
            </h2>
            <p className="text-[11px] text-zinc-500">
              Faint = raw measurements. Pink = 12-week moving average.
            </p>
          </div>
        </header>
        {sortedAsc.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-zinc-500">
            No measurements yet — log your first one below.
          </div>
        ) : (
          <div className="h-72 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartSeries} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="week"
                  tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis
                  domain={['dataMin - 1', 'dataMax + 1']}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  width={32}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => fmtLongDate(l as string)}
                  formatter={(v, n) => [
                    fmtKg(typeof v === 'number' ? v : Number(v), true),
                    n === 'ma' ? '12w avg' : 'Measurement',
                  ]}
                />
                {target && (
                  <ReferenceLine
                    y={Number(target.target_kg)}
                    stroke="#f43f5e"
                    strokeDasharray="4 4"
                    strokeOpacity={0.6}
                  />
                )}
                <Line
                  dataKey="raw"
                  stroke="#52525b"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="ma"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">Add entry</h2>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
          <label className="sm:col-span-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Weight (kg)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="72.4"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Date
            </span>
            <input
              type="date"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              max={todayISO()}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Notes
            </span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between">
          {error && <span className="text-xs text-amber-300">{error}</span>}
          <div className="ml-auto">
            <button
              onClick={handleAddEntry}
              disabled={saving || !weight}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save entry'}
            </button>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">Target</h2>
          <p className="text-[11px] text-zinc-500">
            One row per user; the chart&apos;s pink reference line obeys this.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Target (kg)
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={targetKg}
              onChange={(e) => setTargetKg(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Notes
            </span>
            <input
              type="text"
              value={targetNotes}
              onChange={(e) => setTargetNotes(e.target.value)}
              placeholder="Why this number?"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleSaveTarget}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-xs font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
          >
            Save target
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-zinc-100">
            All measurements
          </h2>
          <p className="text-[11px] text-zinc-500">
            Newest first. Delete to correct a typo.
          </p>
        </header>
        {loading ? (
          <div className="flex h-20 items-center justify-center text-xs text-zinc-500">
            Loading…
          </div>
        ) : sortedAsc.length === 0 ? (
          <div className="text-xs text-zinc-500">No entries yet.</div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {[...sortedAsc]
              .sort((a, b) =>
                b.recorded_at.localeCompare(a.recorded_at),
              )
              .map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div>
                    <div className="font-mono text-sm text-zinc-100">
                      {fmtKg(e.weight_kg, true)}
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {fmtLongDate(e.recorded_at)}
                      {e.notes ? ` · ${e.notes}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(e.id)}
                    className="text-xs text-zinc-500 hover:text-zinc-200"
                  >
                    Delete
                  </button>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-3 py-2.5">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 8,
  color: '#e4e4e7',
  fontSize: 11,
};
