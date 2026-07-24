'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import WorkoutLogSimple from '@/components/fitness/log-workout-simple';
import StrengthProgressSimple from '@/components/fitness/strength-progress-simple';
import PhysiqueProgress from '@/components/fitness/physique-progress';
import WeightTracking from '@/components/fitness/weight-tracking';
import SleepTracking from '@/components/fitness/sleep-tracking';

/**
 * FitnessDashboard — scrollable homepage.
 *
 * Section priority order (from the user brief):
 *   1. Today's Workout        — primary CTA / confirmation card
 *      (also hosts Recent PRs + Recent Workouts inline)
 *   2. Strength Progress      — best lifts + 1RM chart + PR leaderboard
 *   3. Physique Timeline      — photo history
 *   4. Weight Progress        — bodyweight trend
 *   5. Sleep                  — confirmation card + history + 7-day avg
 *
 * The dashboard owns:
 *   - userId (resolved once on mount, reused across children)
 *   - refreshKey (ticks N after every save so children re-fetch)
 *   - sign-in gate UI when no user
 */
export default function FitnessDashboard() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

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
        <div
          className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 p-10 text-center shadow-lg backdrop-blur"
          style={{ borderColor: 'rgba(244,63,94,0.18)' }}
        >
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
    <div className="mx-auto w-full max-w-5xl px-6 py-8 sm:px-8 sm:py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
          Fitness
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Progress first. Log in seconds. Browse at a glance.
        </p>
      </header>

      <div className="space-y-10">
        {/* 1. Today's Workout — primary CTA / confirmation */}
        <WorkoutLogSimple userId={userId} refreshKey={refreshKey} onSaved={onSaved} />

        {/* 2. Strength Progress */}
        <StrengthProgressSimple userId={userId} refreshKey={refreshKey} />

        {/* 3. Physique Timeline */}
        <PhysiqueProgress userId={userId} refreshKey={refreshKey} onSaved={onSaved} />

        {/* 4. Weight Progress */}
        <WeightTracking userId={userId} refreshKey={refreshKey} onSaved={onSaved} />

        {/* 5. Sleep */}
        <SleepTracking userId={userId} refreshKey={refreshKey} onSaved={onSaved} />
      </div>
    </div>
  );
}
