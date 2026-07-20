'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth';
import ExerciseLibrary from '@/components/fitness/exercise-library';

/**
 * Settings — top-level page for non-logging tasks.
 *
 * Today the only surface is **Exercise Library**, where the user can
 * create / rename / archive movements. The logging flow never has to
 * detour into this view — SearchableExercisePicker handles
 * one-tap-create inline.
 */
export default function SettingsPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = await getCurrentUserId();
      if (cancelled) return;
      setUserId(uid);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-32">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="mx-auto flex max-w-3xl flex-1 items-center justify-center px-6 py-32">
        <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 p-10 text-center shadow-lg backdrop-blur">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            Sign in to access Settings
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Your exercise library and preferences are private.
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
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-8 sm:py-10">
      <header className="mb-8">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
          Settings
        </div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
          Preferences
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Manage your exercise library and other workout preferences.
        </p>
      </header>

      <div className="space-y-6">
        <ExerciseLibrary userId={userId} />
      </div>
    </div>
  );
}
