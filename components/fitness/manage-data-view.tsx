'use client';

import { useEffect, useState } from 'react';
import HevyImport from '@/components/fitness/hevy-import';
import HevyImportHistory from '@/components/fitness/hevy-import-history';
import HevyExerciseMeta from '@/components/fitness/hevy-exercise-meta';
import MuscleTargetsEditor from '@/components/fitness/muscle-targets-editor';

/**
 * Manage Data — high-level controls on the page, detail modules in
 * popups.
 *
 * Page layout (progressive disclosure):
 *   1. Per-muscle target frequency — master control + Manually
 *      Select modal (see MuscleTargetsEditor).
 *   2. Three launch cards opening popup modules: Hevy import,
 *      exercise/muscle mapping, import history. The heavy UI inside
 *      each modal is the existing component, unchanged.
 */

type ModalId = 'import' | 'meta' | 'history' | null;

export default function ManageDataView({ userId }: { userId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [openModal, setOpenModal] = useState<ModalId>(null);
  const [modalTitle, setModalTitle] = useState('');

  // Close on Escape.
  useEffect(() => {
    if (!openModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenModal(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openModal]);

  function open(id: Exclude<ModalId, null>, title: string) {
    setModalTitle(title);
    setOpenModal(id);
  }

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
        {/* 1. Per-muscle target frequency (high-level control) */}
        <section className="rounded-2xl border border-zinc-800/40 bg-zinc-950/30 p-4 sm:p-5">
          <MuscleTargetsEditor
            userId={userId}
            refreshKey={refreshKey}
          />
        </section>

        {/* 2. Popup-module launchers */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LauncherCard
            title="Hevy import"
            body="Upload an export zip — exercises, sets and body measurements."
            onClick={() => open('import', 'Hevy import')}
          />
          <LauncherCard
            title="Exercise mapping"
            body="Check which muscle each exercise name feeds; fix strays."
            onClick={() => open('meta', 'Exercise mapping')}
          />
          <LauncherCard
            title="Import history"
            body="Past imports, their counts and per-import deletion."
            onClick={() => open('history', 'Import history')}
          />
        </section>
      </div>

      {/* Popup modules — existing components, mounted in a modal shell */}
      {openModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={modalTitle}
        >
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setOpenModal(null)}
            aria-hidden
          />
          <div className="relative flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">
                {modalTitle}
              </h2>
              <button
                onClick={() => setOpenModal(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </header>
            {/* Independently scrollable body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {openModal === 'import' && (
                <HevyImport
                  userId={userId}
                  onSaved={() => setRefreshKey((k) => k + 1)}
                />
              )}
              {openModal === 'meta' && (
                <HevyExerciseMeta userId={userId} refreshKey={refreshKey} />
              )}
              {openModal === 'history' && (
                <HevyImportHistory userId={userId} refreshKey={refreshKey} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LauncherCard({
  title,
  body,
  onClick,
}: {
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-zinc-800/40 bg-zinc-950/40 p-4 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-900/40"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-zinc-100 group-hover:text-white">
          {title}
        </div>
        <span className="text-zinc-500 transition-colors group-hover:text-zinc-200">
          →
        </span>
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">{body}</div>
    </button>
  );
}
