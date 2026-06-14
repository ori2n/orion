'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPhysiqueLogs } from '@/lib/health/storage';
import type { PhysiqueLog } from '@/lib/health/storage';

// ─── Types ──────────────────────────────────────────────────────────

interface DateGroup {
  dateKey: string; // 'YYYY-MM-DD'
  label: string;   // formatted display date
  photos: PhysiqueLog[];
}

type ViewMode = 'folders' | 'date';

// ─── Helpers ────────────────────────────────────────────────────────

function groupByDate(logs: PhysiqueLog[]): DateGroup[] {
  const groups = new Map<string, PhysiqueLog[]>();

  for (const log of logs) {
    if (!log.photo_url) continue;
    const dateKey = new Date(log.created_at).toISOString().slice(0, 10);
    const existing = groups.get(dateKey);
    if (existing) {
      existing.push(log);
    } else {
      groups.set(dateKey, [log]);
    }
  }

  return Array.from(groups.entries())
    .map(([dateKey, photos]) => ({
      dateKey,
      label: formatDateLabel(dateKey),
      photos,
    }))
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey)); // newest first
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = yesterday.toISOString().slice(0, 10);

  if (dateKey === todayKey) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateFull(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ─── Folder Card ────────────────────────────────────────────────────

function FolderCard({
  group,
  onClick,
}: {
  group: DateGroup;
  onClick: () => void;
}) {
  const thumbnail = group.photos[group.photos.length - 1]?.photo_url;
  const photoCount = group.photos.length;

  return (
    <button
      onClick={onClick}
      type="button"
      className="group w-full text-left"
    >
      <div className="relative overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/50 transition-all duration-200 hover:border-zinc-700/80 hover:bg-zinc-900/80 hover:shadow-[0_0_20px_rgba(6,182,212,0.06)]">
        {/* Thumbnail background */}
        <div className="aspect-[3/2] overflow-hidden bg-zinc-800/40">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={`Progress ${group.label}`}
              className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-3xl opacity-30">📷</span>
            </div>
          )}
        </div>

        {/* Gradient overlay */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-900/90 via-zinc-900/40 to-transparent" />

        {/* Info */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-200 drop-shadow-sm">
              {group.label}
            </span>
            <span className="rounded-full bg-zinc-900/70 px-2 py-0.5 text-[10px] font-medium text-zinc-400 backdrop-blur-sm">
              {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
            </span>
          </div>
          {group.photos.some((p) => p.bodyweight) && (
            <span className="mt-1 block text-[10px] text-zinc-500">
              {group.photos
                .filter((p) => p.bodyweight)
                .map((p) => `${p.bodyweight}kg`)
                .join(' · ')}
            </span>
          )}
        </div>

        {/* Hover-accent line */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/0 to-transparent transition-all duration-300 group-hover:via-cyan-500/40" />
      </div>
    </button>
  );
}

// ─── Photo Grid ─────────────────────────────────────────────────────

function PhotoGrid({
  photos,
  onBack,
}: {
  photos: PhysiqueLog[];
  onBack: () => void;
}) {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  // Get the date key from the first photo
  const dateKey = photos.length > 0
    ? new Date(photos[0].created_at).toISOString().slice(0, 10)
    : '';

  return (
    <div className="animate-in fade-in slide-in-from-right-3 duration-200">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={onBack}
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <div>
          <h3 className="text-sm font-medium text-zinc-200">{formatDateFull(dateKey)}</h3>
          <p className="text-[10px] text-zinc-500">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>
        </div>
      </div>

      {/* Photo Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {photos.map((log) => (
          <button
            key={log.id}
            onClick={() => setSelectedPhoto(log.photo_url === selectedPhoto ? null : log.photo_url)}
            type="button"
            className={`group relative overflow-hidden rounded-lg border transition-all duration-200 ${
              log.photo_url === selectedPhoto
                ? 'border-cyan-500/60 ring-1 ring-cyan-500/30'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <img
              src={log.photo_url}
              alt={`Progress ${new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
              className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            {/* Bodyweight badge */}
            {log.bodyweight && (
              <div className="absolute left-1.5 top-1.5 rounded-full bg-zinc-900/80 px-1.5 py-0.5 text-[9px] font-medium text-zinc-300 backdrop-blur-sm">
                {log.bodyweight}kg
              </div>
            )}
            {/* Time overlay */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-900/70 to-transparent p-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span className="text-[9px] text-zinc-400">
                {new Date(log.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            {/* Selected indicator */}
            {log.photo_url === selectedPhoto && (
              <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-500 shadow-lg">
                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Expanded photo view */}
      {selectedPhoto && (
        <div className="mt-3 animate-in fade-in duration-200">
          <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/80">
            <img
              src={selectedPhoto}
              alt="Selected progress photo"
              className="w-full object-contain max-h-[50vh]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────────────

function EmptyGallery() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="mb-3 text-4xl opacity-40">📸</span>
      <p className="text-sm font-medium text-zinc-400">No progress photos yet</p>
      <p className="mt-1 text-[11px] text-zinc-600">
        Upload your first progress photo to start your visual archive
      </p>
    </div>
  );
}

// ─── Main Progress Gallery ──────────────────────────────────────────

interface ProgressGalleryProps {
  /** Optional: pass logs in directly to share data with parent */
  logs?: PhysiqueLog[];
  /** Callback when component wants to refresh data */
  onRefresh?: () => void;
}

export default function ProgressGallery({ logs: externalLogs, onRefresh }: ProgressGalleryProps) {
  const [internalLogs, setInternalLogs] = useState<PhysiqueLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('folders');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPhysiqueLogs(365); // get a full year
      setInternalLogs(data);
    } catch {
      // silent fail — logs stay empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!externalLogs) {
      load();
    } else {
      setLoading(false);
    }
  }, [externalLogs, load]);

  // Re-fetch when onRefresh signals
  useEffect(() => {
    if (!onRefresh) return;
    const handler = () => {
      if (externalLogs) {
        onRefresh();
      } else {
        load();
      }
    };
    window.addEventListener('health-data-saved', handler);
    return () => window.removeEventListener('health-data-saved', handler);
  }, [onRefresh, externalLogs, load]);

  const logs = externalLogs ?? internalLogs;

  const dateGroups = useMemo(() => groupByDate(logs), [logs]);
  const activeGroup = selectedDate
    ? dateGroups.find((g) => g.dateKey === selectedDate) ?? null
    : null;

  function handleOpenDate(dateKey: string) {
    setSelectedDate(dateKey);
    setViewMode('date');
  }

  function handleBackToFolders() {
    setSelectedDate(null);
    setViewMode('folders');
  }

  // ── Render ──

  return (
    <div className="space-y-3">
      {/* Section header with photo count */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
            Progress Gallery
          </h2>
          {dateGroups.length > 0 && (
            <p className="mt-0.5 text-[10px] text-zinc-600">
              {dateGroups.length} day{dateGroups.length > 1 ? 's' : ''} ·{' '}
              {logs.filter((l) => l.photo_url).length} photos
            </p>
          )}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
        </div>
      )}

      {/* Empty state */}
      {!loading && dateGroups.length === 0 && <EmptyGallery />}

      {/* Folder view */}
      {!loading && viewMode === 'folders' && dateGroups.length > 0 && (
        <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-2.5">
          {dateGroups.map((group) => (
            <FolderCard
              key={group.dateKey}
              group={group}
              onClick={() => handleOpenDate(group.dateKey)}
            />
          ))}
        </div>
      )}

      {/* Date gallery view */}
      {!loading && viewMode === 'date' && activeGroup && (
        <PhotoGrid
          photos={activeGroup.photos}
          onBack={handleBackToFolders}
        />
      )}
    </div>
  );
}
