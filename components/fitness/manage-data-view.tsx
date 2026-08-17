'use client';

import { useState } from 'react';
import HevyImport from '@/components/fitness/hevy-import';
import HevyImportHistory from '@/components/fitness/hevy-import-history';
import HevyExerciseMeta from '@/components/fitness/hevy-exercise-meta';
import MuscleTargetsEditor from '@/components/fitness/muscle-targets-editor';

/**
 * Manage Data — the consolidated home for stage-1-4 imports,
 * diagnostics, history, and per-muscle targets. This is Stage 5 §18:
 * "He doesn't need a big IMPORT HEVY button cluttering the dashboard."
 *
 * Section order (intentional):
 *   1. Per-muscle targets (the most common edit).
 *   2. Hevy import (action; infrequently needed).
 *   3. Hevy import history (diagnostics; rarely needed).
 */
export default function ManageDataView({ userId }: { userId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Manage Data
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-100">
          Imports, diagnostics &amp; muscle targets
        </h1>
        <p className="mt-1 max-w-2xl text-xs text-zinc-500">
          ORION analyses the real data once it lands from Hevy. Import
          weekly or bi-weekly. Per-muscle targets determine the
          &quot;On target / Below / Above&quot; badges.
        </p>
      </header>

      <div className="space-y-6">
        <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/30 p-4 sm:p-5">
          <MuscleTargetsEditor
            userId={userId}
            refreshKey={refreshKey}
          />
        </section>

        <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/30 p-4 sm:p-5">
          <HevyImport
            userId={userId}
            onSaved={() => setRefreshKey((k) => k + 1)}
          />
        </section>

        <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/30 p-4 sm:p-5">
          <HevyExerciseMeta userId={userId} refreshKey={refreshKey} />
        </section>

        <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/30 p-4 sm:p-5">
          <HevyImportHistory userId={userId} refreshKey={refreshKey} />
        </section>
      </div>
    </div>
  );
}
