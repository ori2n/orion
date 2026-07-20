'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import StrengthProgress from '@/components/fitness/strength-progress';
import WorkoutLog from '@/components/fitness/workout-log';
import PhysiqueProgress from '@/components/fitness/physique-progress';
import WeightTracking from '@/components/fitness/weight-tracking';
import SleepTracking from '@/components/fitness/sleep-tracking';


/**
 * FitnessDashboard — orchestrator.
 *
 * Section priority order: Strength (1) → Physique (2) → Weight (3) → Sleep (4)
 * → Flashback (5) → Check-in (6) → Workout log (7).
 *
 * The dashboard owns:
 *   - userId (resolved once on mount, reused across children)
 *   - refreshKey (ticks N after every save so children re-fetch)
 *   - activeTab state for the sub-section navigation
 *   - A premium summary strip of the user's highlight metrics across all 4 pillars
 */
export default function FitnessDashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] =
    useState<Tab>('strength');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = await getCurrentUserId();
      if (cancelled) return;
      setUserId(uid);
      setAuthLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSaved = useCallback(() => setRefreshKey((k) => k + 1), []);

  if (authLoading) {
    return (
      <div className="mx-auto flex max-w-7xl flex-1 items-center justify-center px-6 py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="mx-auto flex max-w-3xl flex-1 items-center justify-center px-6 py-32">
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 p-10 text-center shadow-lg backdrop-blur" style={{ borderColor: 'rgba(244,63,94,0.18)' }}>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Sign in to access your Fitness data
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Your strength, physique and sleep data live privately in ORION.
            Log in to view your progress.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="mt-6 rounded-lg bg-rose-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8 sm:px-8 sm:py-10">
      {/* Page title */}
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
          Fitness
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Log workouts, track strength progress, and monitor your physique
        </p>
      </header>

      {/* Summary strip — quick highlight metrics that load eagerly so the
          user sees a populated page instantly even before deeper sections
          render. Each card is small (just one KPI) and uses the same
          rounded-2xl aesthetic as the rest of ORION. */}
      <SummaryStrip refreshKey={refreshKey} userId={userId} />

      {/* Sub-section tabs */}
      <nav
        className="mt-10 flex flex-wrap gap-1 rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-1 backdrop-blur-sm"
        role="tablist"
        aria-label="Fitness sections"
      >
        {TABS.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              aria-controls={`fitness-panel-${t.id}`}
              id={`fitness-tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${
                active
                  ? 'bg-zinc-100 text-zinc-900 shadow-sm dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Active section panel — keyed so each tab mount is fresh
          and never carries stale state across switches. */}
      <section
        key={activeTab}
        id={`fitness-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`fitness-tab-${activeTab}`}
        className="mt-6"
      >
        {activeTab === 'strength' && (
          <StrengthProgress userId={userId} refreshKey={refreshKey} onSaved={onSaved} />
        )}
        {activeTab === 'workout' && (
          <WorkoutLog userId={userId} refreshKey={refreshKey} onSaved={onSaved} />
        )}
        {activeTab === 'physique' && (
          <PhysiqueProgress userId={userId} refreshKey={refreshKey} onSaved={onSaved} />
        )}
        {activeTab === 'weight' && (
          <WeightTracking userId={userId} refreshKey={refreshKey} onSaved={onSaved} />
        )}
        {activeTab === 'sleep' && (
          <SleepTracking userId={userId} refreshKey={refreshKey} onSaved={onSaved} />
        )}

      </section>
    </div>
  );
}

type Tab = 'strength' | 'workout' | 'physique' | 'weight' | 'sleep';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'workout', label: 'Log', icon: '➕' },
  { id: 'strength', label: 'Strength', icon: '🏋️' },
  { id: 'physique', label: 'Physique', icon: '📸' },
  { id: 'weight', label: 'Weight', icon: '⚖️' },
  { id: 'sleep', label: 'Sleep', icon: '🌙' },
];

// ─── Summary strip ────────────────────────────────────────────────

function SummaryStrip({ refreshKey, userId }: { refreshKey: number; userId: string }) {
  // Lazy imports — keep the heavy recharts bundle out of the initial
  // summary cards. The cards below use only number formatting.
  const [bestLift, setBestLift] = useState<string>('—');
  const [bestLiftExercise, setBestLiftExercise] = useState<string>('');
  const [lastWeight, setLastWeight] = useState<string>('—');
  const [lastSleep, setLastSleep] = useState<string>('—');
  const [workoutCount, setWorkoutCount] = useState<string>('—');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([
        loadStrength(userId, (val, ex) => {
          if (cancelled) return;
          setBestLift(val);
          setBestLiftExercise(ex);
        }),
        loadWeight(userId, (val) => {
          if (cancelled) return;
          setLastWeight(val);
        }),
        loadSleep(userId, (val) => {
          if (cancelled) return;
          setLastSleep(val);
        }),
        loadWorkoutCount(userId, (val) => {
          if (cancelled) return;
          setWorkoutCount(val);
        }),
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  return (
    <div
      role="group"
      aria-label="Fitness highlights"
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      <SummaryCard
        kicker="PR"
        value={bestLift}
        subtitle={bestLiftExercise ? `${bestLiftExercise} est. 1RM` : 'Log a set to track'}
        tone="rose"
      />
      <SummaryCard
        kicker="Weight"
        value={lastWeight}
        subtitle="Latest body weight"
        tone="zinc"
      />
      <SummaryCard
        kicker="Sleep"
        value={lastSleep}
        subtitle="Last night's hours"
        tone="indigo"
      />
      <SummaryCard
        kicker="Workouts"
        value={workoutCount}
        subtitle="Total sessions"
        tone="zinc"
      />
    </div>
  );
}

function SummaryCard({
  kicker,
  value,
  subtitle,
  tone,
}: {
  kicker: string;
  value: string;
  subtitle: string;
  tone: 'rose' | 'zinc' | 'indigo';
}) {
  const toneClass =
    tone === 'rose'
      ? 'border-rose-900/40'
      : tone === 'indigo'
        ? 'border-indigo-900/40'
        : 'border-zinc-800/60';
  const kickerColor =
    tone === 'rose'
      ? 'text-rose-400/70'
      : tone === 'indigo'
        ? 'text-indigo-400/70'
        : 'text-zinc-500';

  return (
    <div
      className={`rounded-2xl border bg-zinc-900/50 p-4 shadow-sm backdrop-blur-sm transition-colors duration-200 hover:bg-zinc-900/80 ${toneClass}`}
    >
      <div className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${kickerColor}`}>
        {kicker}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-100">
        {value}
      </div>
      <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
    </div>
  );
}

// Lazy data loaders for the summary cards.
import { listAllSetsForUser } from '@/lib/fitness/workouts';
import { listExercises } from '@/lib/fitness/exercises';
import { buildExerciseStats } from '@/lib/fitness/strength';
import { listRecentWorkouts } from '@/lib/fitness/workouts';
import { listWeightEntries } from '@/lib/fitness/weight';
import { listSleepEntries } from '@/lib/fitness/sleep';

async function loadStrength(
  userId: string,
  cb: (val: string, exercise: string) => void
): Promise<void> {
  const [sets, exercises, workouts] = await Promise.all([
    listAllSetsForUser(userId),
    listExercises(userId),
    listRecentWorkouts(userId, 50),
  ]);
  if (sets.length === 0) {
    cb('—', '');
    return;
  }
  const wmap = new Map(workouts.map((w) => [w.id, w]));
  let bestEst = 0;
  let bestExercise = '';
  for (const ex of exercises) {
    const stats = buildExerciseStats(ex, sets, wmap);
    if (stats.estimated_1rm && stats.estimated_1rm > bestEst) {
      bestEst = stats.estimated_1rm;
      bestExercise = ex.name;
    }
  }
  if (bestEst === 0) {
    cb('—', '');
    return;
  }
  cb(`${bestEst.toFixed(1)}kg`, bestExercise);
}

async function loadWeight(
  userId: string,
  cb: (val: string) => void
): Promise<void> {
  const entries = await listWeightEntries(userId);
  if (entries.length === 0) {
    cb('—');
    return;
  }
  const latest = [...entries].sort(
    (a, b) =>
      new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
  )[0];
  cb(`${latest.weight_kg.toFixed(1)}kg`);
}

async function loadSleep(
  userId: string,
  cb: (val: string) => void
): Promise<void> {
  const entries = await listSleepEntries(userId);
  if (entries.length === 0) {
    cb('—');
    return;
  }
  const latest = entries[0];
  cb(`${latest.hours.toFixed(1)}h`);
}

async function loadWorkoutCount(
  userId: string,
  cb: (val: string) => void
): Promise<void> {
  const workouts = await listRecentWorkouts(userId, 1000);
  if (workouts.length === 0) {
    cb('0');
    return;
  }
  cb(String(workouts.length));
}
