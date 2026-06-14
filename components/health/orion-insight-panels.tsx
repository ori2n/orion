'use client';

import { useMemo } from 'react';
import type { SleepLog, WorkoutLog, NutritionLog, RecoveryLog, PhysiqueLog } from '@/lib/health/storage';
import { analyzeEnergyFactors, analyzeRecovery, analyzeProgress, analyzeWeight } from '@/lib/health/insights';

// ─── Shared utilities ──────────────────────────────────────────────

function MetricRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[9px] tracking-wider" style={{ color: 'rgba(148, 163, 184, 0.4)' }}>{label}</span>
      <span className="text-[11px] font-semibold" style={{ color }}>{value}</span>
    </div>
  );
}

function Sparkline({ data, hue, width = 80, height = 20 }: { data: number[]; hue: number; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 4) + 2;
    const y = height - 4 - ((v - min) / range) * (height - 8);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={`hsla(${hue}, 60%, 60%, 0.5)`} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrendArrow({ trend }: { trend: 'up' | 'down' | 'stable' | 'insufficient_data' }) {
  if (trend === 'insufficient_data') return <span className="text-[9px]" style={{ color: 'rgba(148, 163, 184, 0.2)' }}>--</span>;
  const c = trend === 'up' ? 'hsla(160, 50%, 55%, 0.6)' : trend === 'down' ? 'hsla(0, 50%, 55%, 0.6)' : 'rgba(148, 163, 184, 0.3)';
  const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '◆';
  return <span style={{ color: c, fontSize: '8px' }}>{arrow}</span>;
}

function Verdict({ verdict }: { verdict: string }) {
  const c: Record<string, string> = {
    recovering: 'hsla(160, 50%, 55%, 0.6)',
    maintaining: 'hsla(45, 50%, 55%, 0.6)',
    declining: 'hsla(0, 50%, 55%, 0.6)',
    progressing: 'hsla(160, 50%, 55%, 0.6)',
    stalled: 'hsla(0, 50%, 55%, 0.6)',
    gaining: 'hsla(0, 50%, 55%, 0.6)',
    losing: 'hsla(160, 50%, 55%, 0.6)',
    stable: 'hsla(45, 50%, 55%, 0.6)',
  };
  return <span className="text-[8px] font-semibold tracking-[0.15em] uppercase" style={{ color: c[verdict] ?? 'rgba(148, 163, 184, 0.2)' }}>{verdict}</span>;
}

// ─── Sleep ─────────────────────────────────────────────────────────

export function SleepInsightPanel({
  sleepLogs, trainingLogs, nutritionLog, recoveryLog,
}: {
  sleepLogs: SleepLog[];
  trainingLogs: WorkoutLog[];
  nutritionLog: NutritionLog | null;
  recoveryLog: RecoveryLog | null;
}) {
  const hue = 260;

  const recovery = useMemo(() => analyzeRecovery(sleepLogs, trainingLogs, recoveryLog ? [recoveryLog] : []), [sleepLogs, trainingLogs, recoveryLog]);
  const energyFactors = useMemo(() => analyzeEnergyFactors(sleepLogs, trainingLogs, nutritionLog, recoveryLog), [sleepLogs, trainingLogs, nutritionLog, recoveryLog]);

  const durations = sleepLogs.map(l => Math.round((new Date(l.sleep_end).getTime() - new Date(l.sleep_start).getTime()) / 3600000 * 10) / 10);
  const qualities = sleepLogs.map(l => l.quality);
  const sleepDebt = durations.length > 0 ? Math.max(0, 8 - durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  const c = `hsla(${hue}, 60%, 55%, 0.7)`;

  return (
    <div className="space-y-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px]" style={{ color: c }}>~</span>
        <span className="text-[9px] font-semibold tracking-[0.2em]" style={{ color: c }}>SLEEP</span>
        <Verdict verdict={recovery.verdict} />
      </div>
      <MetricRow label="Duration" value={recovery.avgSleepDuration} color={c} />
      {durations.length >= 2 && <div className="flex items-center gap-2"><span className="text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.25)' }}>Trend</span><Sparkline data={durations} hue={hue} width={100} /><TrendArrow trend={recovery.sleepDurationTrend} /></div>}
      <MetricRow label="Quality" value={`${recovery.avgSleepQuality.toFixed(1)}/10`} color={c} />
      {qualities.length >= 2 && <div className="flex items-center gap-2"><span className="text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.25)' }}>Trend</span><Sparkline data={qualities} hue={hue + 20} width={100} /><TrendArrow trend={recovery.sleepQualityTrend} /></div>}
      <MetricRow label="Debt" value={`${sleepDebt.toFixed(1)}h`} color={c} />
      <MetricRow label="vs Energy" value={`${energyFactors.breakdown.sleep}/35`} color={sleepDebt < 1 ? `hsla(160, 50%, 55%, 0.7)` : c} />
    </div>
  );
}

// ─── Fitness ───────────────────────────────────────────────────────

export function FitnessInsightPanel({
  trainingLogs, sleepLogs, recoveryLog,
}: {
  trainingLogs: WorkoutLog[];
  sleepLogs: SleepLog[];
  recoveryLog: RecoveryLog | null;
}) {
  const hue = 160;

  const progress = useMemo(() => analyzeProgress(trainingLogs), [trainingLogs]);
  const recovery = useMemo(() => analyzeRecovery(sleepLogs, trainingLogs, recoveryLog ? [recoveryLog] : []), [sleepLogs, trainingLogs, recoveryLog]);

  const heavySessions = trainingLogs.filter(l => l.rpe >= 8).length;
  const moderateSessions = trainingLogs.filter(l => l.rpe >= 5 && l.rpe < 8).length;
  const avgRPE = trainingLogs.length > 0 ? trainingLogs.reduce((s, l) => s + l.rpe, 0) / trainingLogs.length : 0;

  const c = `hsla(${hue}, 60%, 55%, 0.7)`;
  const cMod = `hsla(${hue - 40}, 50%, 50%, 0.5)`;
  const cHeavy = `hsla(0, 50%, 50%, 0.5)`;

  return (
    <div className="space-y-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px]" style={{ color: c }}>+</span>
        <span className="text-[9px] font-semibold tracking-[0.2em]" style={{ color: c }}>FITNESS</span>
        <Verdict verdict={progress.verdict} />
      </div>
      <MetricRow label="Load" value={`${progress.totalWorkouts} sessions`} color={c} />
      <MetricRow label="Avg RPE" value={`${avgRPE.toFixed(1)}/10`} color={c} />
      <div className="flex gap-3">
        <span className="text-[9px]" style={{ color: cMod }}>{moderateSessions} mod</span>
        <span className="text-[9px]" style={{ color: cHeavy }}>{heavySessions} heavy</span>
      </div>
      <MetricRow label="PRs" value={progress.personalRecords.length > 0 ? `${progress.personalRecords.length} found` : 'none'} color={c} />
      {progress.personalRecords.slice(0, 3).map((pr, i) => (
        <div key={i} className="flex justify-between text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.35)' }}>
          <span>{pr.exercise}</span>
          <span>{pr.weight}kg x {pr.reps}</span>
        </div>
      ))}
      <MetricRow label="Recovery" value={recovery.verdict} color={`hsla(240, 40%, 50%, 0.5)`} />
    </div>
  );
}

// ─── Nutrition ─────────────────────────────────────────────────────

export function NutritionInsightPanel({
  nutritionLogs, sleepLogs, trainingLogs, recoveryLog,
}: {
  nutritionLogs: NutritionLog[];
  sleepLogs: SleepLog[];
  trainingLogs: WorkoutLog[];
  recoveryLog: RecoveryLog | null;
}) {
  const hue = 200;

  const weight = useMemo(() => analyzeWeight([], nutritionLogs), [nutritionLogs]);
  const energyFactors = useMemo(() => analyzeEnergyFactors(sleepLogs, trainingLogs, nutritionLogs[0] ?? null, recoveryLog), [sleepLogs, trainingLogs, nutritionLogs, recoveryLog]);

  const cals = nutritionLogs.map(l => l.calories);
  const proteins = nutritionLogs.map(l => l.protein_g);

  const c = `hsla(${hue}, 60%, 55%, 0.7)`;

  return (
    <div className="space-y-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px]" style={{ color: c }}>*</span>
        <span className="text-[9px] font-semibold tracking-[0.2em]" style={{ color: c }}>NUTRITION</span>
        <Verdict verdict={weight.nutritionStatus} />
      </div>
      <MetricRow label="Calories" value={`${weight.avgCalories} kcal`} color={c} />
      {cals.length >= 2 && <div className="flex items-center gap-2"><span className="text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.25)' }}>Trend</span><Sparkline data={cals} hue={hue} width={100} /></div>}
      <MetricRow label="Protein" value={`${weight.avgProtein} g`} color={c} />
      {proteins.length >= 2 && <div className="flex items-center gap-2"><span className="text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.25)' }}>Trend</span><Sparkline data={proteins} hue={hue + 20} width={100} /></div>}
      <MetricRow label="Consistency" value={`${nutritionLogs.length} logs`} color={c} />
      <MetricRow label="vs Energy" value={`${energyFactors.breakdown.nutrition}/15`} color={c} />
    </div>
  );
}

// ─── Physique ──────────────────────────────────────────────────────

export function PhysiqueInsightPanel({
  physiqueLogs, nutritionLogs,
}: {
  physiqueLogs: PhysiqueLog[];
  nutritionLogs: NutritionLog[];
}) {
  const hue = 140;

  const weight = useMemo(() => analyzeWeight(physiqueLogs, nutritionLogs), [physiqueLogs, nutritionLogs]);

  const weights = physiqueLogs.filter(l => l.bodyweight != null).map(l => Number(l.bodyweight));

  const c = `hsla(${hue}, 60%, 55%, 0.7)`;
  const changeColor = weight.weightChange != null ? (weight.weightChange > 0 ? `hsla(0, 50%, 55%, 0.6)` : `hsla(160, 50%, 55%, 0.6)`) : 'rgba(148, 163, 184, 0.3)';

  return (
    <div className="space-y-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px]" style={{ color: c }}>=</span>
        <span className="text-[9px] font-semibold tracking-[0.2em]" style={{ color: c }}>PHYSIQUE</span>
        <Verdict verdict={weight.trend} />
      </div>
      <MetricRow label="Weight" value={weight.currentWeight?.toFixed(1) ?? '--'} color={c} />
      {weight.weightChange != null && (
        <MetricRow label="Change" value={`${weight.weightChange > 0 ? '+' : ''}${weight.weightChange.toFixed(1)}kg`} color={changeColor} />
      )}
      {weights.length >= 2 && <div className="flex items-center gap-2"><span className="text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.25)' }}>Trend</span><Sparkline data={weights} hue={hue} width={100} /></div>}
      <MetricRow label="Check-ins" value={`${physiqueLogs.length} total`} color={c} />
    </div>
  );
}

// ─── State / Recovery ─────────────────────────────────────────────

export function StateInsightPanel({
  recoveryLogs, sleepLogs, trainingLogs,
}: {
  recoveryLogs: RecoveryLog[];
  sleepLogs: SleepLog[];
  trainingLogs: WorkoutLog[];
}) {
  const hue = 240;

  const recovery = useMemo(() => analyzeRecovery(sleepLogs, trainingLogs, recoveryLogs), [sleepLogs, trainingLogs, recoveryLogs]);

  const energies = recoveryLogs.map(l => l.energy_level);
  const stresses = recoveryLogs.map(l => l.stress_level);
  const sorenesses = recoveryLogs.map(l => l.soreness_level);

  const readiness = recoveryLogs.length > 0
    ? Math.round(recoveryLogs.map(l => (l.energy_level + (10 - l.stress_level) + (10 - l.soreness_level)) / 3 * 10)
        .reduce((a, b) => a + b, 0) / recoveryLogs.length)
    : 0;

  const c = `hsla(${hue}, 55%, 55%, 0.7)`;

  return (
    <div className="space-y-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px]" style={{ color: c }}>#</span>
        <span className="text-[9px] font-semibold tracking-[0.2em]" style={{ color: c }}>STATE</span>
        <Verdict verdict={recovery.verdict} />
      </div>
      <MetricRow label="Readiness" value={`${readiness}/100`} color={c} />
      <MetricRow label="Energy" value={energies.length > 0 ? `${(energies.reduce((a, b) => a + b, 0) / energies.length).toFixed(1)}/10` : '--'} color={`hsla(160, 50%, 55%, 0.6)`} />
      {energies.length >= 2 && <div className="flex items-center gap-2"><span className="text-[8px]" style={{ color: 'rgba(148, 163, 184, 0.25)' }}>Trend</span><Sparkline data={energies} hue={160} width={100} /><TrendArrow trend={recovery.recoveryTrend} /></div>}
      <MetricRow label="Stress" value={stresses.length > 0 ? `${(stresses.reduce((a, b) => a + b, 0) / stresses.length).toFixed(1)}/10` : '--'} color={`hsla(0, 50%, 55%, 0.5)`} />
      <MetricRow label="Soreness" value={sorenesses.length > 0 ? `${(sorenesses.reduce((a, b) => a + b, 0) / sorenesses.length).toFixed(1)}/10` : '--'} color={`hsla(45, 50%, 55%, 0.5)`} />
      <MetricRow label="Recovery" value={`${recovery.avgRecoveryScore.toFixed(1)}/10`} color={c} />
    </div>
  );
}
