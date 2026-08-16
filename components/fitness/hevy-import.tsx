'use client';

import { useRef, useState } from 'react';
import { importHevyCsv } from '@/lib/fitness/hevy/import';
import type { HevyImportDiagnostics } from '@/lib/fitness/hevy/types';

/**
 * HevyImport — minimal Stage 1 upload + diagnostics card.
 *
 * The user exports their history from Hevy (a .csv) and uploads it here.
 * ORION parses it, stores the workouts, and reports a simple summary so
 * the user can confirm the data landed. This is a verification tool, not
 * the final Fitness dashboard.
 */
export default function HevyImport({
  userId,
  onSaved,
}: {
  userId: string;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HevyImportDiagnostics | null>(null);

  function pickFile() {
    inputRef.current?.click();
  }

  function onFileChange(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setResult(null);
  }

  async function handleImport() {
    const file = inputRef.current?.files?.[0];
    if (!file || busy) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const diagnostics = await importHevyCsv(userId, text, file.name);
      setResult(diagnostics);
      if (diagnostics.status === 'failed') {
        setError('Import failed. See details below.');
      } else {
        onSaved();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed unexpectedly.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Hevy import">
      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Hevy Import
            </div>
            <h3 className="mt-1 text-base font-semibold text-zinc-100">
              Import your workout history
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Export from Hevy (Settings → Export Data) and upload the .csv.
              Re-importing the same history won&apos;t create duplicates.
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => onFileChange(e.target.files)}
            />
            <button
              onClick={pickFile}
              disabled={busy}
              className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40"
            >
              {fileName ?? 'Choose file'}
            </button>
            <button
              onClick={handleImport}
              disabled={!fileName || busy}
              className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {busy && (
          <div className="mt-4 flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
            <span className="text-xs text-zinc-400">Processing export…</span>
          </div>
        )}

        {result && <Diagnostics result={result} />}
      </div>
    </section>
  );
}

function Diagnostics({ result }: { result: HevyImportDiagnostics }) {
  const existing = result.workoutsUpdated + result.workoutsUnchanged;
  const ok = result.status === 'completed';

  return (
    <div
      className={`mt-4 rounded-xl border p-4 ${
        ok
          ? 'border-emerald-800/40 bg-emerald-950/10'
          : 'border-red-900/40 bg-red-950/20'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
            ok
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-red-500/15 text-red-300'
          }`}
        >
          {ok ? <TickIcon /> : <CrossIcon />}
        </span>
        <span
          className={`text-sm font-semibold ${
            ok ? 'text-emerald-200' : 'text-red-300'
          }`}
        >
          {ok ? 'Import complete' : 'Import failed'}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Stat label="Workouts checked" value={String(result.workoutsChecked)} />
        <Stat label="New workouts" value={String(result.workoutsCreated)} />
        <Stat label="Existing workouts" value={String(existing)} />
        <Stat label="Updated workouts" value={String(result.workoutsUpdated)} />
        <Stat label="Sets processed" value={result.setsProcessed.toLocaleString()} />
        <Stat
          label="Date range"
          value={
            result.dateMin && result.dateMax
              ? `${short(result.dateMin)} → ${short(result.dateMax)}`
              : '—'
          }
        />
      </dl>

      {result.warnings.length > 0 && (
        <div className="mt-3 border-t border-zinc-800/60 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-400/80">
            Warnings ({result.warnings.length})
          </div>
          <ul className="mt-1.5 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-200/80">
                • {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm text-zinc-100">{value}</dd>
    </div>
  );
}

function short(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function TickIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
