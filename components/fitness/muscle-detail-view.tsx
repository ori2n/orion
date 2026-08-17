'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';
import { getCurrentUserId } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import type { MuscleSummary } from '@/lib/fitness/hevy/calc';
import { upsertMuscleTarget } from '@/lib/fitness/hevy/muscle-targets';
import { computeHevyCalculations } from '@/lib/fitness/hevy/calculations';
import { fmtKg, fmtLongDate } from '@/lib/fitness/format';

/**
 * MuscleDetailView — drill-down for a single muscle group.
 *
 * Stage 5 §10 + §11 + §12:
 *   - Frequency bar chart (sessions/week) — polished, not raw.
 *   - Status badge (On target / Below / Above).
 *   - Target per-week + notes editor.
 *
 * Note: the muscle for THIS page is supplied by parent — saving the
 * editor recomputes everything via `computeHevyCalculations` so the
 * badge flips without a full refetch.
 */

export default function MuscleDetailView({
  muscle,
  summary,
}: {
  muscle: string;
  summary: MuscleSummary;
}) {
  const [currentSummary, setCurrentSummary] = useState(summary);
  const [currentStatus, setCurrentStatus] = useState(summary.onTarget);

  async function save(next: {
    sessions: number;
    notes: string | null;
  }) {
    const userId = await getCurrentUserId();
    if (!userId) return;
    const ok = await upsertMuscleTarget(userId, muscle, {
      targetSessionsPerWeek: next.sessions,
      notes: next.notes,
    });
    if (!ok) return;
    // Recompute the entire engine so the latest measurements update
    // the badge; we mirror only the affected muscle back into local
    // state to keep the page snappy.
    const calcs = await computeHevyCalculations(userId);
    const updated = calcs.muscles.find((m) => m.muscle === muscle);
    if (updated) {
      setCurrentStatus(updated.onTarget);
      setCurrentSummary(updated);
    }
  }

  // Frequency chart: each bar is a week. Color encodes on-target band.
  const series = currentSummary.weekly.slice(-26).map((p) => ({
    week: p.week,
    sessions: p.sessions,
    sets: p.sets,
    volumeKg: p.volumeKg,
  }));

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
          Muscle drill-down
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
          {currentSummary.muscle}
        </h1>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={currentStatus} />
          <span className="text-xs text-zinc-500">
            Last 4w: <span className="font-mono text-zinc-200">{fmtKg(currentStatus === null ? 0 : (currentSummary.actualSessionsPerWeekLast4 ?? 0))}×/wk</span> · Target{' '}
            <span className="font-mono text-zinc-200">{fmtKg(currentSummary.targetSessionsPerWeek)}×/wk</span>
          </span>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Sessions (last 4w)"
          value={String(currentSummary.sessionsLast4Weeks)}
        />
        <Stat
          label="Sets (last 4w avg)"
          value={fmtKg(currentSummary.last4WeekSetsAvg ?? 0)}
        />
        <Stat
          label="Sets (last 8w avg)"
          value={fmtKg(currentSummary.last8WeekSetsAvg ?? 0)}
        />
        <Stat
          label="Total volume"
          value={`${Math.round(currentSummary.totalVolumeKg).toLocaleString()} kg`}
        />
      </div>

      <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
        <header className="mb-2">
          <h2 className="text-sm font-semibold text-zinc-100">Weekly frequency</h2>
          <p className="text-[11px] text-zinc-500">
            Sessions per week. The dashed line is your target.
          </p>
        </header>
        {series.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-xs text-zinc-500">
            No sessions recorded yet for this muscle.
          </div>
        ) : (
          <div className="h-56 sm:h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="week"
                  tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={20}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#71717a' }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(l) => fmtLongDate(l as string)}
                />
                <ReferenceLine
                  y={currentSummary.targetSessionsPerWeek}
                  stroke="#f43f5e"
                  strokeDasharray="4 4"
                  strokeOpacity={0.6}
                />
                <Bar dataKey="sessions" isAnimationActive={false}>
                  {series.map((p, idx) => {
                    const ratio = p.sessions / Math.max(1, currentSummary.targetSessionsPerWeek);
                    const color =
                      ratio < 0.6
                        ? '#f59e0b'
                        : ratio > 1.2 && currentSummary.targetSessionsPerWeek > 0
                          ? '#38bdf8'
                          : '#34d399';
                    return <Cell key={idx} fill={color} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <TargetEditor
        muscle={muscle}
        target={{
          sessions: currentSummary.targetSessionsPerWeek,
          notes: currentSummary.targetNotes ?? null,
        }}
        onSave={save}
      />

      <ExercisesForMuscle muscle={muscle} />
    </div>
  );
}

function StatusBadge({ status }: { status: MuscleSummary['onTarget'] }) {
  if (status === 'on') {
    return (
      <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
        On target
      </span>
    );
  }
  if (status === 'below') {
    return (
      <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
        Below target
      </span>
    );
  }
  if (status === 'above') {
    return (
      <span className="rounded-full bg-sky-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
        Above target
      </span>
    );
  }
  return (
    <span className="rounded-full bg-zinc-800/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      No data
    </span>
  );
}

function TargetEditor({
  muscle,
  target,
  onSave,
}: {
  muscle: string;
  target: { sessions: number; notes: string | null };
  onSave: (next: { sessions: number; notes: string | null }) => void;
}) {
  const [sessions, setSessions] = useState(String(target.sessions));
  const [notes, setNotes] = useState(target.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number>(0);

  const dirty =
    Number(sessions) !== target.sessions ||
    (notes || null) !== target.notes;

  async function handleSave() {
    if (saving || !dirty) return;
    setSaving(true);
    await onSave({
      sessions: Number(sessions) || 0,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    setSaving(false);
    setSavedAt(Date.now());
  }

  return (
    <section className="mb-6 rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Target &amp; note — {muscle}
        </h2>
        <p className="text-[11px] text-zinc-500">
          Sessions per week you&apos;d like to train this muscle, plus
          context for future reference (kept private to you).
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[120px,1fr,auto]">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Target / week
          </span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              className="w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
            />
            <span className="text-xs text-zinc-500">sessions</span>
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Note (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Keep lower because of football, tennis and sprint training."
            rows={2}
            className="block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </label>
        <div className="flex items-end justify-end">
          <button
            disabled={saving || !dirty}
            onClick={handleSave}
            className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className="mt-2 text-[10px] text-zinc-500">
        {savedAt > 0 && (
          <span className="text-emerald-300">Saved just now ·</span>
        )}{' '}
        Note is user-controlled — no automated rewrite.
      </div>
    </section>
  );
}

function ExercisesForMuscle({ muscle }: { muscle: string }) {
  const [list, setList] = useState<
    Array<{ name: string; heaviest: number | null; last: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('hevy_exercise_meta')
        .select('exercise_name, muscle')
        .eq('user_id', userId)
        .eq('muscle', muscle);
      const names = ((data ?? []) as Array<{ exercise_name: string }>).map(
        (r) => r.exercise_name,
      );
      const calcs = await computeHevyCalculations(userId);
      const rows = names
        .map((name) => {
          const e = calcs.exercises.find((x) => x.name === name);
          return {
            name,
            heaviest: e?.heaviestWeightKg ?? null,
            last: e?.lastTrained ?? null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      if (cancelled) return;
      setList(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [muscle]);

  return (
    <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/40 p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Mapped exercises ({list.length})
        </h2>
        <p className="text-[11px] text-zinc-500">
          Exercises the muscle meta table attributes to this group. Click
          to drill into the full progression chart.
        </p>
      </header>
      {loading ? (
        <div className="flex h-20 items-center justify-center text-xs text-zinc-500">
          Loading…
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800/60 bg-zinc-950/30 px-4 py-5 text-center text-xs text-zinc-500">
          No exercises mapped to {muscle} yet. Map one in Manage Data.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((e) => (
            <li key={e.name}>
              <Link
                href={`/fitness/strength/${encodeURIComponent(e.name)}`}
                className="group flex items-center justify-between gap-2 rounded-lg border border-zinc-800/40 bg-zinc-900/40 px-3 py-2 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
              >
                <div>
                  <div className="text-sm font-medium text-zinc-100 group-hover:text-white">
                    {e.name}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Last: {fmtLongDate(e.last)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-zinc-100">
                    {fmtKg(e.heaviest, true)}
                  </div>
                  <div className="text-[9px] text-zinc-500">PR</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <div className="rounded-xl border border-zinc-800/40 bg-zinc-950/40 px-4 py-3">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base text-zinc-100">{value}</div>
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
