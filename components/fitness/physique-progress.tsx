'use client';

import { useState, useEffect, useRef } from 'react';
import {
  listPhysiquePhotos,
  uploadAndSavePhysiquePhoto,
  deletePhysiquePhotoRecord,
  type HydratedPhoto,
} from '@/lib/fitness/physique';
import type {
  PhysiquePhoto,
  PhysiquePose,
} from '@/lib/fitness/types';

/**
 * PhysiqueProgress — photographic progress timeline.
 *
 * Photos live in the private `physique-photos` Supabase Storage
 * bucket; the table `physique_photos` holds one row per photo with a
 * date + pose label. The UI:
 *   1. Lets the user upload multiple photos per update with a date.
 *   2. Renders a chronological grid (newest first).
 *   3. Offers a before/after slider — pick any two photos in the
 *      timeline and the UI overlays them with a draggable divider.
 */
export default function PhysiqueProgress({
  userId,
  refreshKey,
  onSaved,
}: {
  userId: string;
  refreshKey: number;
  onSaved: () => void;
}) {
  const [photos, setPhotos] = useState<HydratedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const data = await listPhysiquePhotos(userId);
      if (cancelled) return;
      setPhotos(data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/30 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Progress timeline</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Photos are private to your account.
            </p>
          </div>
          <button
            onClick={() => setShowUpload((s) => !s)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
          >
            {showUpload ? 'Cancel' : '+ Add update'}
          </button>
        </div>

        {showUpload && (
          <UploadForm
            userId={userId}
            onUploaded={() => {
              setShowUpload(false);
              onSaved();
            }}
            onError={(e) => setError(e)}
          />
        )}

        {photos.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-xs text-zinc-500">
            No progress photos yet — click "+ Add update" to record your first entry.
          </div>
        ) : (
          <PhotoTimeline
            photos={photos}
            onDelete={async (photo) => {
              const ok = await deletePhysiquePhotoRecord(photo);
              if (!ok) {
                setError('Failed to delete photo');
                return;
              }
              onSaved();
            }}
          />
        )}
      </div>

      {/* Before / After slider — needs at least 2 photos */}
      {photos.length >= 2 && (
        <ComparisonSlider photos={photos} />
      )}
    </div>
  );
}

// ─── Upload form ────────────────────────────────────────────────

function UploadForm({
  userId,
  onUploaded,
  onError,
}: {
  userId: string;
  onUploaded: () => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [takenAt, setTakenAt] = useState(() => todayISO());
  const [pose, setPose] = useState<PhysiquePose | 'unspecified'>('unspecified');
  const [bodyWeight, setBodyWeight] = useState('');
  const [uploading, setUploading] = useState(false);

  async function handleSubmit() {
    if (files.length === 0) {
      onError('Pick at least one photo before saving');
      return;
    }
    setUploading(true);
    let succeeded = 0;
    let lastErr: string | null = null;
    for (const f of files) {
      const created = await uploadAndSavePhysiquePhoto({
        userId,
        file: f,
        taken_at: takenAt,
        pose_type: pose === 'unspecified' ? null : pose,
        body_weight_kg: bodyWeight.trim() ? parseFloat(bodyWeight) : null,
      });
      if (created) succeeded += 1;
      else lastErr = `Failed to upload ${f.name}`;
    }
    setUploading(false);
    if (succeeded === 0) {
      onError(lastErr ?? 'Upload failed');
      return;
    }
    setFiles([]);
    if (fileRef.current) fileRef.current.value = '';
    onUploaded();
  }

  return (
    <div className="mb-5 rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Date
          </label>
          <input
            type="date"
            value={takenAt}
            onChange={(e) => setTakenAt(e.target.value)}
            max={todayISO()}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Pose
          </label>
          <select
            value={pose}
            onChange={(e) => setPose(e.target.value as PhysiquePose | 'unspecified')}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          >
            <option value="unspecified">—</option>
            <option value="front">Front</option>
            <option value="back">Back</option>
            <option value="side">Side</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Weight (kg, optional)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            value={bodyWeight}
            onChange={(e) => setBodyWeight(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
          Photo(s)
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block w-full text-xs text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-700 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-600"
        />
        {files.length > 0 && (
          <p className="mt-1 text-[10px] text-zinc-500">
            {files.length} photo{files.length === 1 ? '' : 's'} selected
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <button
          onClick={handleSubmit}
          disabled={uploading || files.length === 0}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
        >
          {uploading ? 'Uploading…' : `Save ${files.length || ''} photo${files.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

// ─── Photo timeline ─────────────────────────────────────────────

function PhotoTimeline({
  photos,
  onDelete,
}: {
  photos: HydratedPhoto[];
  onDelete: (p: PhysiquePhoto) => void;
}) {
  // Group photos by taken_at so multiple photos on the same day render
  // as one "update" tile with thumbnails inside.
  const grouped = new Map<string, HydratedPhoto[]>();
  for (const p of photos) {
    const arr = grouped.get(p.taken_at) ?? [];
    arr.push(p);
    grouped.set(p.taken_at, arr);
  }
  const dates = Array.from(grouped.keys()).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="space-y-4">
      {dates.map((date) => {
        const group = grouped.get(date) ?? [];
        return (
          <div key={date} className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-500">
                {formatTimelineDate(date)}
              </div>
              <div className="text-[10px] text-zinc-600">
                {group.length} photo{group.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {group.map((p) => (
                <PhotoTile key={p.id} photo={p} onDelete={() => onDelete(p)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PhotoTile({
  photo,
  onDelete,
}: {
  photo: HydratedPhoto;
  onDelete: () => void;
}) {
  const label = photo.pose_type ? photo.pose_type[0].toUpperCase() + photo.pose_type.slice(1) : 'Photo';
  return (
    <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      {photo.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.url}
          alt={`Physique photo ${photo.taken_at} — ${label}`}
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center text-xs text-zinc-600">
          loading…
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/90">
          {label}
        </span>
        {photo.body_weight_kg && (
          <span className="text-[10px] text-white/70">
            {photo.body_weight_kg}kg
          </span>
        )}
      </div>
      <button
        onClick={onDelete}
        className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-red-300 opacity-0 transition-opacity hover:bg-red-600 hover:text-white group-hover:opacity-100"
        aria-label="Delete photo"
      >
        Delete
      </button>
    </div>
  );
}

// ─── Before / After slider ──────────────────────────────────────

function ComparisonSlider({ photos }: { photos: HydratedPhoto[] }) {
  // Default: oldest on the left, newest on the right.
  const sorted = [...photos].sort((a, b) =>
    a.taken_at < b.taken_at ? -1 : 1
  );
  const initialBefore = sorted[0];
  const initialAfter = sorted[sorted.length - 1];
  const [beforeId, setBeforeId] = useState<string>(initialBefore.id);
  const [afterId, setAfterId] = useState<string>(initialAfter.id);
  const before = photos.find((p) => p.id === beforeId) ?? initialBefore;
  const after = photos.find((p) => p.id === afterId) ?? initialAfter;

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-5 shadow-sm backdrop-blur-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Before / After</h3>
          <p className="mt-0.5 text-xs text-zinc-500">Drag the divider to compare</p>
        </div>
        <div className="flex items-center gap-2">
          <DatePicker
            label="Before"
            options={sorted}
            value={beforeId}
            onChange={setBeforeId}
          />
          <DatePicker
            label="After"
            options={sorted}
            value={afterId}
            onChange={setAfterId}
          />
        </div>
      </div>
      <ComparisonFrame before={before} after={after} />
    </div>
  );
}

function DatePicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: HydratedPhoto[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.taken_at}
          </option>
        ))}
      </select>
    </div>
  );
}

function ComparisonFrame({
  before,
  after,
}: {
  before: HydratedPhoto;
  after: HydratedPhoto;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState(50); // % from the left
  const isDragging = useRef(false);

  function handleDown() {
    isDragging.current = true;
  }
  function handleUp() {
    isDragging.current = false;
  }
  function handleMove(e: React.PointerEvent) {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSplit(pct);
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerMove={handleMove}
      onPointerCancel={handleUp}
      className="relative aspect-[3/4] w-full cursor-ew-resize overflow-hidden rounded-xl border border-zinc-800 bg-black sm:aspect-[4/3]"
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
    >
      {/* After (background) */}
      {after.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={after.url}
          alt={`After — ${after.taken_at}`}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      )}
      {/* Before (clipped) */}
      {before.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={before.url}
          alt={`Before — ${before.taken_at}`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `polygon(0 0, ${split}% 0, ${split}% 100%, 0 100%)` }}
          draggable={false}
        />
      )}
      {/* Divider */}
      <div
        className="absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
        style={{ left: `${split}%`, transform: 'translateX(-50%)' }}
      />
      <div
        className="absolute top-1/2 z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-black/60 text-white shadow-lg"
        style={{ left: `${split}%` }}
      >
        <span className="text-base leading-none">⇔</span>
      </div>
      {/* Labels */}
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
        Before · {before.taken_at}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
        After · {after.taken_at}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatTimelineDate(date: string): string {
  const dt = new Date(date + 'T00:00:00');
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
