'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { EnergyScoreInputs } from '@/lib/health/energy-score';
import { computeEnergyScore } from '@/lib/health/energy-score';
import {
  getSleepLogs,
  getTrainingLogs,
  getNutritionLogs,
  getRecoveryLogs,
  getPhysiqueLogs,
  insertSleepLog,
  insertTrainingLog,
  insertNutritionLog,
  insertRecoveryLog,
  insertPhysiqueLog,
} from '@/lib/health/storage';
import { notifyHealthDataSaved } from '@/lib/health/events';
import type { SleepLog, WorkoutLog, NutritionLog, RecoveryLog, PhysiqueLog } from '@/lib/health/storage';
import {
  SleepInsightPanel,
  FitnessInsightPanel,
  NutritionInsightPanel,
  PhysiqueInsightPanel,
  StateInsightPanel,
} from '@/components/health/orion-insight-panels';

// ─── Types ──────────────────────────────────────────────────────────

type ModuleKey = 'sleep' | 'fitness' | 'nutrition' | 'physique' | 'state';

interface ModuleDef {
  key: ModuleKey;
  label: string;
  angle: number;
  hue: number;
}

const MODULES: ModuleDef[] = [
  { key: 'sleep',     label: 'SLEEP',     angle: 270, hue: 260 },
  { key: 'nutrition', label: 'NUTRITION', angle: 342, hue: 200 },
  { key: 'fitness',   label: 'FITNESS',   angle: 54,  hue: 160 },
  { key: 'physique',  label: 'PHYSIQUE',  angle: 126, hue: 140 },
  { key: 'state',     label: 'STATE',     angle: 198, hue: 240 },
];

const MODULE_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 0],
];

// ─── Helpers ────────────────────────────────────────────────────────

function scoreHue(score: number): number {
  if (score >= 80) return 160;
  if (score >= 60) return 140;
  if (score >= 40) return 100;
  if (score >= 20) return 45;
  return 0;
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'PEAK';
  if (score >= 80) return 'HIGH';
  if (score >= 65) return 'GOOD';
  if (score >= 50) return 'FAIR';
  if (score >= 35) return 'LOW';
  return 'DEPLETED';
}

function getPos(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad) * radius, y: Math.sin(rad) * radius };
}

// ─── System Map Decorations ─────────────────────────────────────────

function OrbitalRings({ radius, expanded }: { radius: number; expanded: boolean }) {
  const innerR = radius * 0.65;
  const midR = radius * 0.45;

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
      <circle cx="50%" cy="50%" r={radius}
        fill="none"
        stroke="rgba(148, 163, 184, 0.06)"
        strokeWidth={0.5}
      />
      <circle cx="50%" cy="50%" r={innerR}
        fill="none"
        stroke="rgba(148, 163, 184, 0.04)"
        strokeWidth={0.5}
        strokeDasharray="3 6"
      />
      <circle cx="50%" cy="50%" r={midR}
        fill="none"
        stroke="rgba(148, 163, 184, 0.03)"
        strokeWidth={0.5}
        strokeDasharray="2 8"
      />
      {expanded && (
        <circle cx="50%" cy="50%" r={radius * 1.35}
          fill="none"
          stroke="rgba(148, 163, 184, 0.04)"
          strokeWidth={0.5}
          strokeDasharray="4 12"
          style={{ animation: 'spin 60s linear infinite' }}
        />
      )}
    </svg>
  );
}

function ConstellationLines({
  positions,
  activeModules,
  expanded,
  orbRadius,
}: {
  positions: { key: ModuleKey; x: number; y: number }[];
  activeModules: Set<ModuleKey>;
  expanded: boolean;
  orbRadius: number;
}) {
  const cx = 0, cy = 0;

  const lines: { x1: number; y1: number; x2: number; y2: number; active: boolean }[] = [];

  // Core to each module
  for (const p of positions) {
    const isActive = activeModules.has(p.key);
    lines.push({ x1: cx, y1: cy, x2: p.x, y2: p.y, active: isActive });
  }

  // Between connected modules
  for (const [i, j] of MODULE_CONNECTIONS) {
    const a = positions[i];
    const b = positions[j];
    const bothActive = activeModules.has(a.key) && activeModules.has(b.key);
    lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, active: bothActive });
  }

  // Module to analytics plume (expanded mode)
  if (expanded) {
    const plumeRad = orbRadius * 1.35;
    for (const p of positions) {
      if (!activeModules.has(p.key)) continue;
      const plume = getPos(MODULES.find(m => m.key === p.key)!.angle, plumeRad);
      lines.push({ x1: p.x, y1: p.y, x2: plume.x, y2: plume.y, active: true });
    }
  }

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>
      {lines.map((l, i) => (
        <line key={i}
          x1={`calc(50% + ${l.x1}px)`}
          y1={`calc(50% + ${l.y1}px)`}
          x2={`calc(50% + ${l.x2}px)`}
          y2={`calc(50% + ${l.y2}px)`}
          stroke={l.active ? 'rgba(148, 163, 184, 0.15)' : 'rgba(148, 163, 184, 0.04)'}
          strokeWidth={l.active ? 0.5 : 0.3}
          strokeDasharray={l.active ? '2 4' : '1 6'}
          style={{ transition: 'stroke 0.5s, stroke-width 0.5s' }}
        />
      ))}
    </svg>
  );
}

function ScannerOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 40 }}>
      {/* Horizontal scan line */}
      <div className="absolute left-0 right-0 h-px animate-scan-down"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(148, 163, 184, 0.08), transparent)' }}
      />
      {/* Vertical scan line */}
      <div className="absolute top-0 bottom-0 w-px animate-scan-right"
        style={{ background: 'linear-gradient(180deg, transparent, rgba(148, 163, 184, 0.08), transparent)' }}
      />
      {/* Corner brackets */}
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        <div className="flex gap-1">
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
          <div className="flex-1" />
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        </div>
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
      </div>
      <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        <div className="flex gap-1">
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
          <div className="flex-1" />
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        </div>
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
      </div>
      <div className="absolute bottom-3 left-3 flex flex-col gap-1">
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        <div className="flex gap-1">
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
          <div className="flex-1" />
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        </div>
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 items-end">
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        <div className="flex gap-1">
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
          <div className="flex-1" />
          <div className="w-px h-3" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
        </div>
        <div className="w-3 h-px" style={{ background: 'rgba(148, 163, 184, 0.08)' }} />
      </div>
    </div>
  );
}

function AmbientParticles({ count = 12 }: { count?: number }) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 1.5 + 0.5,
      delay: Math.random() * 8,
      duration: Math.random() * 6 + 6,
    }));
  }, [count]);

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: 'rgba(148, 163, 184, 0.15)',
            animation: `float-particle ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function HUDIndicators({ expanded, score, activeCount }: { expanded: boolean; score: number; activeCount: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 30, fontFamily: 'var(--font-mono)' }}>
      {/* Top-left: mode */}
      <div className="absolute top-3 left-4 flex items-center gap-2">
        <span className="text-[7px] tracking-[0.25em]"
          style={{ color: expanded ? 'rgba(148, 163, 184, 0.2)' : 'rgba(148, 163, 184, 0.1)' }}
        >
          {expanded ? 'ANALYTICS' : 'MONITOR'}
        </span>
        <span className="text-[6px]" style={{ color: 'rgba(148, 163, 184, 0.08)' }}>
          v2.1
        </span>
      </div>
      {/* Top-right: score */}
      <div className="absolute top-3 right-4 flex items-center gap-2">
        <span className="text-[7px] tracking-[0.15em]"
          style={{ color: 'rgba(148, 163, 184, 0.12)' }}
        >
          {score}
        </span>
        <span className="text-[6px]" style={{ color: 'rgba(148, 163, 184, 0.08)' }}>
          {activeCount > 0 ? `${activeCount} linked` : 'idle'}
        </span>
      </div>
      {/* Bottom-right: system status */}
      <div className="absolute bottom-4 right-4">
        <span className="text-[7px] tracking-[0.2em]"
          style={{ color: 'rgba(148, 163, 184, 0.1)' }}
        >
          {expanded ? 'DIAGNOSTICS' : 'NORMAL'}
        </span>
      </div>
    </div>
  );
}

// ─── Quick-Log Forms ──────────────────────────────────────────────

function SleepQuickLog({ onSave }: { onSave: () => void }) {
  const [sleepStart, setSleepStart] = useState('23:00');
  const [sleepEnd, setSleepEnd] = useState('07:00');
  const [quality, setQuality] = useState(7);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const now = new Date();
    const startH = parseInt(sleepStart.split(':')[0]);
    const startM = parseInt(sleepStart.split(':')[1]);
    const endH = parseInt(sleepEnd.split(':')[0]);
    const endM = parseInt(sleepEnd.split(':')[1]);

    const startDate = new Date(now);
    startDate.setHours(startH, startM, 0, 0);
    const endDate = new Date(now);
    endDate.setHours(endH, endM, 0, 0);
    if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);

    const result = await insertSleepLog({
      sleep_start: startDate.toISOString(),
      sleep_end: endDate.toISOString(),
      quality,
      notes: '',
    });
    if (result.data) notifyHealthDataSaved();
    setSaving(false);
    onSave();
  };

  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <div className="text-[8px] text-slate-600">BED</div>
          <input type="time" value={sleepStart} onChange={e => setSleepStart(e.target.value)}
            className="w-full bg-transparent px-0 py-0.5 text-[11px] text-slate-400 border-b border-slate-800 focus:border-slate-600 focus:outline-none" />
        </div>
        <div className="flex-1">
          <div className="text-[8px] text-slate-600">WAKE</div>
          <input type="time" value={sleepEnd} onChange={e => setSleepEnd(e.target.value)}
            className="w-full bg-transparent px-0 py-0.5 text-[11px] text-slate-400 border-b border-slate-800 focus:border-slate-600 focus:outline-none" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[8px] text-slate-600">Q</span>
        <input type="range" min={1} max={10} value={quality} onChange={e => setQuality(Number(e.target.value))}
          className="flex-1 h-0.5 cursor-pointer appearance-none bg-slate-800 accent-slate-500" />
        <span className="text-[10px] text-slate-500 w-4 text-right">{quality}</span>
      </div>
      <button onClick={handleSave} disabled={saving}
        className="text-left text-[9px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30">
        {saving ? '...' : '> LOG SLEEP'}
      </button>
    </div>
  );
}

function TrainingQuickLog({ onSave }: { onSave: () => void }) {
  const [type, setType] = useState('Upper');
  const [exercise, setExercise] = useState('');
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [rpe, setRpe] = useState(7);
  const [saving, setSaving] = useState(false);

  const workoutTypes = ['Upper', 'Lower', 'Push', 'Pull', 'Legs', 'Full Body', 'Cardio', 'Run'];

  const handleSave = async () => {
    if (!exercise.trim()) return;
    setSaving(true);
    await insertTrainingLog({
      workout_type: type,
      exercise: exercise.trim(),
      weight_lbs: weight ? Number(weight) : null,
      reps: reps ? Number(reps) : null,
      rpe,
      notes: '',
    });
    notifyHealthDataSaved();
    setExercise('');
    setWeight('');
    setReps('');
    setSaving(false);
    onSave();
  };

  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <select value={type} onChange={e => setType(e.target.value)}
        className="bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5">
        {workoutTypes.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="flex gap-2 items-end">
        <input type="text" placeholder="exercise" value={exercise} onChange={e => setExercise(e.target.value)}
          className="flex-1 bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5 placeholder-slate-700" />
        <input type="number" placeholder="kg" value={weight} onChange={e => setWeight(e.target.value)}
          className="w-14 bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5 placeholder-slate-700" />
        <input type="number" placeholder="reps" value={reps} onChange={e => setReps(e.target.value)}
          className="w-12 bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5 placeholder-slate-700" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[8px] text-slate-600">RPE</span>
        <input type="range" min={1} max={10} value={rpe} onChange={e => setRpe(Number(e.target.value))}
          className="flex-1 h-0.5 cursor-pointer appearance-none bg-slate-800 accent-slate-500" />
        <span className="text-[10px] text-slate-500 w-4 text-right">{rpe}</span>
      </div>
      <button onClick={handleSave} disabled={saving || !exercise.trim()}
        className="text-left text-[9px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30">
        {saving ? '...' : '> LOG SET'}
      </button>
    </div>
  );
}

function NutritionQuickLog({ onSave }: { onSave: () => void }) {
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await insertNutritionLog({ calories: Number(calories) || 0, protein_g: Number(protein) || 0 });
    notifyHealthDataSaved();
    setCalories('');
    setProtein('');
    setSaving(false);
    onSave();
  };

  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <div className="text-[8px] text-slate-600">CAL</div>
          <input type="number" placeholder="kcal" value={calories} onChange={e => setCalories(e.target.value)}
            className="w-full bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5 placeholder-slate-700" />
        </div>
        <div className="flex-1">
          <div className="text-[8px] text-slate-600">PRO</div>
          <input type="number" placeholder="g" value={protein} onChange={e => setProtein(e.target.value)}
            className="w-full bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5 placeholder-slate-700" />
        </div>
      </div>
      <button onClick={handleSave} disabled={saving}
        className="text-left text-[9px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30">
        {saving ? '...' : '> LOG NUTRITION'}
      </button>
    </div>
  );
}

function RecoveryQuickLog({ onSave }: { onSave: () => void }) {
  const [energy, setEnergy] = useState(7);
  const [stress, setStress] = useState(4);
  const [soreness, setSoreness] = useState(3);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await insertRecoveryLog({ energy_level: energy, stress_level: stress, soreness_level: soreness, notes: '' });
    notifyHealthDataSaved();
    setSaving(false);
    onSave();
  };

  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ fontFamily: 'var(--font-mono)' }}>
      {[
        { label: 'EN', value: energy, set: setEnergy },
        { label: 'ST', value: stress, set: setStress },
        { label: 'SO', value: soreness, set: setSoreness },
      ].map(s => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="text-[8px] text-slate-600 w-5">{s.label}</span>
          <input type="range" min={1} max={10} value={s.value} onChange={e => s.set(Number(e.target.value))}
            className="flex-1 h-0.5 cursor-pointer appearance-none bg-slate-800 accent-slate-500" />
          <span className="text-[10px] text-slate-500 w-4 text-right">{s.value}</span>
        </div>
      ))}
      <button onClick={handleSave} disabled={saving}
        className="text-left text-[9px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30">
        {saving ? '...' : '> LOG STATE'}
      </button>
    </div>
  );
}

function PhysiqueQuickLog({ onSave }: { onSave: () => void }) {
  const [bodyweight, setBodyweight] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!bodyweight.trim()) return;
    setSaving(true);
    await insertPhysiqueLog({ bodyweight: Number(bodyweight), photo_url: '', notes: '' });
    notifyHealthDataSaved();
    setBodyweight('');
    setSaving(false);
    onSave();
  };

  return (
    <div className="flex flex-col gap-1.5 py-1" style={{ fontFamily: 'var(--font-mono)' }}>
      <div className="text-[8px] text-slate-600">BW</div>
      <input type="number" step={0.1} placeholder="kg" value={bodyweight} onChange={e => setBodyweight(e.target.value)}
        className="w-full bg-transparent text-[11px] text-slate-400 border-b border-slate-800 focus:outline-none focus:border-slate-600 py-0.5 placeholder-slate-700" />
      <button onClick={handleSave} disabled={saving || !bodyweight.trim()}
        className="text-left text-[9px] text-slate-600 hover:text-slate-400 transition-colors disabled:opacity-30">
        {saving ? '...' : '> LOG WEIGHT'}
      </button>
    </div>
  );
}

// ─── Module Node ─────────────────────────────────────────────────────

function ModuleNode({
  def,
  isActive,
  onClick,
  position,
  orbRadius,
  quickFormOpen,
  onQuickLogToggle,
}: {
  def: ModuleDef;
  isActive: boolean;
  onClick: () => void;
  position: { x: number; y: number };
  orbRadius: number;
  quickFormOpen: boolean;
  onQuickLogToggle: () => void;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: `calc(50% + ${position.x}px)`,
        top: `calc(50% + ${position.y}px)`,
        transform: 'translate(-50%, -50%)',
        zIndex: isActive ? 30 : 10,
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* Quick-log form above module */}
      {quickFormOpen && (
        <div className="absolute" style={{ bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)', zIndex: 50 }}>
          {def.key === 'sleep' && <SleepQuickLog onSave={onQuickLogToggle} />}
          {def.key === 'fitness' && <TrainingQuickLog onSave={onQuickLogToggle} />}
          {def.key === 'nutrition' && <NutritionQuickLog onSave={onQuickLogToggle} />}
          {def.key === 'physique' && <PhysiqueQuickLog onSave={onQuickLogToggle} />}
          {def.key === 'state' && <RecoveryQuickLog onSave={onQuickLogToggle} />}
        </div>
      )}

      {/* Active indicator dot (just a tiny dot, no box) */}
      {isActive && (
        <div
          className="absolute"
          style={{
            top: 'calc(100% + 3px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 2,
            height: 2,
            borderRadius: '50%',
            background: `hsla(${def.hue}, 60%, 55%, 0.4)`,
            boxShadow: `0 0 4px hsla(${def.hue}, 50%, 50%, 0.2)`,
            animation: 'pulse-glow 2s ease-in-out infinite',
          }}
        />
      )}

      {/* Label + log button */}
      <button
        type="button"
        onClick={onClick}
        className="cursor-pointer transition-all duration-300 outline-none"
        style={{ fontFamily: 'var(--font-mono)' }}
      >
        <div
          className="transition-all duration-300"
          style={{
            color: isActive ? `hsla(${def.hue}, 60%, 55%, 0.9)` : 'rgba(148, 163, 184, 0.2)',
            fontSize: isActive ? `${Math.max(10, orbRadius * 0.055)}px` : `${Math.max(9, orbRadius * 0.045)}px`,
            fontWeight: isActive ? 600 : 400,
            letterSpacing: '0.2em',
            textShadow: isActive ? `0 0 12px hsla(${def.hue}, 50%, 35%, 0.15)` : 'none',
          }}
        >
          {def.label}
        </div>

        <div className="flex items-center gap-2 justify-center mt-0.5">
          {isActive && (
            <span
              className="text-[7px] tracking-[0.2em] transition-colors duration-200"
              style={{ color: `hsla(${def.hue}, 40%, 50%, 0.35)` }}
              onClick={(e) => { e.stopPropagation(); onQuickLogToggle(); }}
            >
              {quickFormOpen ? 'CLOSE' : 'LOG'}
            </span>
          )}
        </div>
      </button>
    </div>
  );
}

// ─── Analytics Content (Expanded Mode) ────────────────────────────

function AnalyticsPanel({
  mod,
  position,
  isActive,
  expanded,
  sleepLogs,
  trainingLogs,
  nutritionLogs,
  recoveryLogs,
  physiqueLogs,
  nutritionLog,
  recoveryLog,
}: {
  mod: ModuleDef;
  position: { x: number; y: number };
  isActive: boolean;
  expanded: boolean;
  sleepLogs: SleepLog[];
  trainingLogs: WorkoutLog[];
  nutritionLogs: NutritionLog[];
  recoveryLogs: RecoveryLog[];
  physiqueLogs: PhysiqueLog[];
  nutritionLog: NutritionLog | null;
  recoveryLog: RecoveryLog | null;
}) {
  const visible = expanded && isActive;

  return (
    <div
      className="absolute transition-all duration-500"
      style={{
        left: `calc(50% + ${position.x}px)`,
        top: `calc(50% + ${position.y}px)`,
        transform: 'translate(-50%, 0)',
        opacity: visible ? 0.85 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        zIndex: visible ? 20 : 0,
        fontFamily: 'var(--font-mono)',
        transitionTimingFunction: 'ease-out',
      }}
    >
      <div style={{ width: 200 }}>
        {mod.key === 'sleep' && (
          <SleepInsightPanel
            sleepLogs={sleepLogs}
            trainingLogs={trainingLogs}
            nutritionLog={nutritionLog}
            recoveryLog={recoveryLog}
          />
        )}
        {mod.key === 'fitness' && (
          <FitnessInsightPanel
            trainingLogs={trainingLogs}
            sleepLogs={sleepLogs}
            recoveryLog={recoveryLog}
          />
        )}
        {mod.key === 'nutrition' && (
          <NutritionInsightPanel
            nutritionLogs={nutritionLogs}
            sleepLogs={sleepLogs}
            trainingLogs={trainingLogs}
            recoveryLog={recoveryLog}
          />
        )}
        {mod.key === 'physique' && (
          <PhysiqueInsightPanel
            physiqueLogs={physiqueLogs}
            nutritionLogs={nutritionLogs}
          />
        )}
        {mod.key === 'state' && (
          <StateInsightPanel
            recoveryLogs={recoveryLogs}
            sleepLogs={sleepLogs}
            trainingLogs={trainingLogs}
          />
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────────────

export default function HealthDashboard() {
  // ── State ──
  const [expanded, setExpanded] = useState(false);
  const [activeModules, setActiveModules] = useState<Set<ModuleKey>>(new Set());
  const [quickForm, setQuickForm] = useState<ModuleKey | null>(null);

  // ── Data ──
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sleepLogs, setSleepLogs] = useState<SleepLog[]>([]);
  const [trainingLogs, setTrainingLogs] = useState<WorkoutLog[]>([]);
  const [nutritionLogs, setNutritionLogs] = useState<NutritionLog[]>([]);
  const [recoveryLogs, setRecoveryLogs] = useState<RecoveryLog[]>([]);
  const [physiqueLogs, setPhysiqueLogs] = useState<PhysiqueLog[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ orbRadius: 150, containerSize: 600 });

  // Responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { height, width } = entry.contentRect;
        if (height <= 0 || width <= 0) continue;
        const maxR = Math.min(width, height) * 0.28;
        const orbR = Math.max(110, Math.round(maxR));
        const size = Math.max(600, orbR * 4);
        setDims({ orbRadius: orbR, containerSize: size });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load data
  const loadAll = useCallback(async () => {
    setLoadError(null);
    try {
      const [sleep, training, nutritionList, recoveryList, physique] = await Promise.all([
        getSleepLogs(7),
        getTrainingLogs(14),
        getNutritionLogs(7),
        getRecoveryLogs(7),
        getPhysiqueLogs(30),
      ]);
      setSleepLogs(sleep);
      setTrainingLogs(training);
      setNutritionLogs(nutritionList);
      setRecoveryLogs(recoveryList);
      setPhysiqueLogs(physique);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[HealthDashboard] Failed to load:', err);
      setLoadError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll, refreshKey]);

  // Listen for refresh events
  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('health-data-saved', handler);
    return () => window.removeEventListener('health-data-saved', handler);
  }, []);

  // Compute energy score
  const energyInputs: EnergyScoreInputs = useMemo(() => ({
    sleepHistory: sleepLogs,
    recentTraining: trainingLogs,
    nutrition: nutritionLogs[0] ?? null,
    recovery: recoveryLogs[0] ?? null,
  }), [sleepLogs, trainingLogs, nutritionLogs, recoveryLogs]);
  const score = useMemo(() => computeEnergyScore(energyInputs), [energyInputs]);

  // ── Handlers ──
  const handleCoreToggle = () => {
    setExpanded(e => !e);
  };

  const handleModuleClick = (key: ModuleKey) => {
    if (quickForm === key) setQuickForm(null);
    setActiveModules(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleQuickLogToggle = (key: ModuleKey) => {
    setQuickForm(prev => prev === key ? null : key);
  };

  // ── Derived ──
  const latestNutrition = nutritionLogs.length > 0 ? nutritionLogs[0] : null;
  const latestRecovery = recoveryLogs.length > 0 ? recoveryLogs[0] : null;

  const modulePositions = useMemo(() =>
    MODULES.map(mod => ({ key: mod.key, ...getPos(mod.angle, dims.orbRadius) })),
    [dims.orbRadius]
  );

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* Error text */}
      {loadError && (
        <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2" style={{ fontFamily: 'var(--font-mono)' }}>
          <span className="text-[10px] text-amber-600/60">! {loadError}</span>
          <button onClick={() => setLoadError(null)} className="ml-2 text-[9px] text-slate-600 hover:text-slate-400">dismiss</button>
        </div>
      )}

      {/* Loading text */}
      {loading && (
        <div className="flex flex-col items-center gap-2" style={{ fontFamily: 'var(--font-mono)' }}>
          <div className="text-[8px] tracking-[0.3em] text-slate-700 animate-pulse">&gt;</div>
          <span className="text-[9px] tracking-widest text-slate-700">INITIALISING</span>
        </div>
      )}

      {!loading && (
        <>
          {/* System map decorations */}
          <AmbientParticles count={16} />
          <OrbitalRings radius={dims.orbRadius} expanded={expanded} />
          <ConstellationLines
            positions={modulePositions}
            activeModules={activeModules}
            expanded={expanded}
            orbRadius={dims.orbRadius}
          />

          {/* Scanner overlay in expanded mode */}
          <ScannerOverlay visible={expanded} />

          {/* HUD indicators */}
          <HUDIndicators
            expanded={expanded}
            score={score}
            activeCount={activeModules.size}
          />

          {/* Energy Core */}
          <div className="text-center" style={{ fontFamily: 'var(--font-mono)', zIndex: 15 }}>
            {/* Subtle ring around core when expanded */}
            {expanded && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: dims.orbRadius * 0.3,
                  height: dims.orbRadius * 0.3,
                  borderRadius: '50%',
                  border: '0.5px solid rgba(148, 163, 184, 0.08)',
                  animation: 'spin 30s linear infinite',
                }}
              />
            )}

            <button onClick={handleCoreToggle} type="button" className="cursor-pointer outline-none group relative">
              <div
                className="transition-all duration-500"
                style={{
                  fontSize: `${Math.max(28, Math.round(dims.orbRadius * 0.22))}px`,
                  fontWeight: 600,
                  letterSpacing: '0.05em',
                  color: expanded ? `hsla(${scoreHue(score)}, 60%, 55%, 0.8)` : `hsla(${scoreHue(score)}, 50%, 50%, 0.5)`,
                }}
              >
                {score}
              </div>
              <div className="text-[7px] tracking-[0.3em] transition-all duration-300"
                style={{ color: expanded ? 'rgba(148, 163, 184, 0.3)' : 'rgba(148, 163, 184, 0.12)' }}
              >
                {expanded ? '▲' : '▼'}
              </div>
              <div className="text-[7px] tracking-[0.25em] mt-0.5"
                style={{ color: `hsla(${scoreHue(score)}, 40%, 45%, 0.25)` }}
              >
                {scoreLabel(score)}
              </div>
            </button>
          </div>

          {/* Module nodes */}
          {MODULES.map(mod => {
            const pos = getPos(mod.angle, dims.orbRadius);
            return (
              <ModuleNode
                key={mod.key}
                def={mod}
                isActive={activeModules.has(mod.key)}
                onClick={() => handleModuleClick(mod.key)}
                position={pos}
                orbRadius={dims.orbRadius}
                quickFormOpen={quickForm === mod.key}
                onQuickLogToggle={() => handleQuickLogToggle(mod.key)}
              />
            );
          })}

          {/* Analytics panels (Expanded Mode) */}
          {MODULES.map(mod => {
            const plumeRad = dims.orbRadius * 1.35;
            const plumePos = getPos(mod.angle, plumeRad);
            return (
              <AnalyticsPanel
                key={`plume-${mod.key}`}
                mod={mod}
                position={plumePos}
                isActive={activeModules.has(mod.key)}
                expanded={expanded}
                sleepLogs={sleepLogs}
                trainingLogs={trainingLogs}
                nutritionLogs={nutritionLogs}
                recoveryLogs={recoveryLogs}
                physiqueLogs={physiqueLogs}
                nutritionLog={latestNutrition}
                recoveryLog={latestRecovery}
              />
            );
          })}
        </>
      )}
    </div>
  );
}
