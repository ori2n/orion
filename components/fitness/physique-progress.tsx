'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  listPhysiquePhotos,
  pickFeaturedPhoto,
  pickLatestPinnedCover,
  groupPhotosIntoSessions,
  type HydratedPhoto,
} from '@/lib/fitness/physique';
import PhysiqueTimeline from './physique-timeline';
import PhysiqueUploadFlow from './physique-upload-flow';
import PhysiqueGallery from './physique-gallery';

/**
 * PhysiqueProgress — the dashboard-level Physique surface.
 *
 * New shape (ORION rewrite):
 *   1. **Compact "Latest" card** — 64×64 thumbnail on the left,
 *      date + title + featured indicator on the right, two primary
 *      actions (Open Gallery + View Timeline). Reads the SAME cover
 *      pin state the gallery uses (`pickLatestPinnedCover`), so the
 *      two thumbnails are visually guaranteed to match.
 *   2. **Inline horizontal timeline** (always visible, scroll
 *      sideways if many sessions). Click a tile to expand an
 *      inline session-detail panel below the strip.
 *   3. **Inline upload flow** — "+ Add Progress" toggles the
 *      session-first upload flow.
 *   4. **Optimistic mutations** — every mutation (star / cover /
 *      session edit) updates local state immediately, then awaits
 *      the Supabase roundtrip. On failure, the previous state is
 *      restored and a one-liner flash toast surfaces the error.
 *      This component NEVER calls `onSaved` for purely-local
 *      mutations — bumping the dashboard's `refreshKey` would
 *      force WorkoutLog / StrengthProgress / WeightTracking /
 *      SleepTracking to refetch uselessly.
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
  const [allPhotos, setAllPhotos] = useState<HydratedPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [quickCompareIds, setQuickCompareIds] = useState<string[] | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  /** Inline flash message at the top of the section; auto-clears after 6 s. */
  const [flash, setFlash] = useState<{ kind: 'error' | 'info'; text: string; key: number } | null>(null);

  // First-ever mount refetches. Subsequent refreshKey bumps (e.g. on
  // adding new photos from the upload flow) also refetch — but only
  // for the upload case, which is wired explicitly below.
  const initialMountRef = useRef(true);
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      void reload();
      return;
    }
    // Subsequent refreshKey bumps are deliberate refresh signals
    // from the parent (e.g., a settings change). Refresh then.
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function reload() {
    setLoading(true);
    const list = await listPhysiquePhotos(userId);
    setAllPhotos(list);
    setLoading(false);
  }

  // Derived state — sessions and the latest cover pin.
  const sessions = useMemo(
    () => groupPhotosIntoSessions(allPhotos),
    [allPhotos],
  );
  const latest = useMemo(
    () => pickLatestPinnedCover(allPhotos) ?? pickFeaturedPhoto(allPhotos),
    [allPhotos],
  );

  // ─── Optimistic mutation infrastructure ────────────────────────
  //
  // Children call this when a mutation fires. We:
  //   1. Snapshot the current photos array (closure capture).
  //   2. Apply the optimistic state change.
  //   3. Await the underlying Supabase call.
  //   4. On failure, restore the snapshot AND show a flash toast.
  const applyPhotosChange = useCallback(
    (updater: (prev: HydratedPhoto[]) => HydratedPhoto[]) => {
      setAllPhotos(updater);
    },
    [],
  );

  // Wrap a mutation with snapshot+revert logic. Children pass the
  // optimistic updater and the async function to call. Any failure
  // reverts and surfaces an inline flash.
  async function runOptimistic(args: {
    optimistic: (prev: HydratedPhoto[]) => HydratedPhoto[];
    asyncFn: () => Promise<boolean>;
    failureText: string;
  }): Promise<boolean> {
    let before: HydratedPhoto[] | null = null;
    setAllPhotos((prev) => {
      before = prev;
      return args.optimistic(prev);
    });
    const ok = await args.asyncFn();
    if (!ok) {
      if (before) setAllPhotos(() => before as HydratedPhoto[]);
      showFlash('error', args.failureText);
    }
    return ok;
  }

  const showFlash = useCallback(
    (kind: 'error' | 'info', text: string) => {
      setFlash({ kind, text, key: Date.now() });
      // Auto-clear is also done in the useEffect below.
    },
    [],
  );

  // Auto-dismiss flash after 6 s.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ─── Quick compare entrypoint (unchanged semantically) ─────────
  function openQuickCompare() {
    const candidates = allPhotos.filter((p) => p.is_favourited);
    const pool = candidates.length >= 2 ? candidates : allPhotos;
    if (pool.length < 2) {
      setQuickCompareIds([]);
    } else {
      const sorted = [...pool].sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1));
      setQuickCompareIds([sorted[0].id, sorted[sorted.length - 1].id]);
    }
    setGalleryOpen(true);
  }

  // ─── Handle uploads ──────────────────────────────────────────
  async function handleUploadSaved() {
    setUploadOpen(false);
    // Adding photos IS cross-section data — refresh the whole
    // dashboard's refreshKey. (Local state update would suffice,
    // but bumping upstream feels safer given future modules.)
    onSaved();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800/40 bg-zinc-900/30 py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Compact "Latest Physique" card ───────────────── */}
      <section
        aria-label="Physique"
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900/45 p-5 shadow-sm backdrop-blur-sm"
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">
              Physique
            </div>
            <h3 className="mt-1 text-base font-semibold tracking-tight text-zinc-100">
              📸 Latest Progress
            </h3>
          </div>
          <button
            onClick={() => setUploadOpen((s) => !s)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
          >
            {uploadOpen ? 'Cancel' : '+ Add Progress'}
          </button>
        </div>

        {latest ? (
          <LatestCard photo={latest} />
        ) : (
          <EmptyLatestCard onAddUpdate={() => setUploadOpen(true)} />
        )}

        {/* Two primary actions: Open Gallery + View Timeline. The */}
        {/* timeline is already visible below; "View Timeline"    */}
        {/* scrolls the section into view (smooth, no jump).      */}
        <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-800/60 pt-4">
          <button
            onClick={openQuickCompare}
            disabled={allPhotos.length < 2}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Quick comparison
          </button>
          <button
            onClick={() => {
              document
                .getElementById('physique-timeline')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            View timeline
          </button>
          <button
            onClick={() => setGalleryOpen(true)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Open Gallery
          </button>
        </div>

        {/* Inline upload flow */}
        {uploadOpen && (
          <div className="mt-4">
            <PhysiqueUploadFlow
              userId={userId}
              onError={(msg) => showFlash('error', msg)}
              onCancel={() => setUploadOpen(false)}
              onSaved={() => void handleUploadSaved()}
            />
          </div>
        )}
      </section>

      {/* ── Inline flash toast ─────────────────────────────── */}
      {flash && (
        <div
          key={flash.key}
          role="alert"
          className={`rounded-xl border px-4 py-2 text-sm shadow-lg backdrop-blur ${
            flash.kind === 'error'
              ? 'border-red-900/40 bg-red-950/40 text-red-200'
              : 'border-zinc-700/60 bg-zinc-900/70 text-zinc-200'
          }`}
        >
          {flash.text}
          <button
            className="ml-2 text-zinc-500 hover:text-zinc-300"
            onClick={() => setFlash(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Always-visible horizontal timeline ─────────────── */}
      <section id="physique-timeline" aria-label="Featured timeline">
        <PhysiqueTimeline
          photos={allPhotos}
          onPhotosChanged={applyPhotosChange}
          showToast={(text) => showFlash('error', text)}
        />
      </section>

      {/* ── Gallery modal ──────────────────────────────────── */}
      {galleryOpen && (
        <PhysiqueGallery
          photos={allPhotos}
          userId={userId}
          initialSelection={quickCompareIds ?? undefined}
          initialComparing={quickCompareIds !== null}
          applyPhotosChange={applyPhotosChange}
          showToast={(text) => showFlash('error', text)}
          onClose={() => {
            setGalleryOpen(false);
            setQuickCompareIds(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Compact LatestCard (replaces the old big 16:9 hero) ─────────

function LatestCard({ photo }: { photo: HydratedPhoto }) {
  const label = photo.pose_type ?? 'Photo';
  const featuredBadge = photo.is_favourited ? '⭐ Featured' : 'Latest';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      {/* 64×64 thumbnail on the left */}
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black">
        {photo.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={`Latest featured progress — ${photo.taken_at}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
            loading…
          </div>
        )}
      </div>
      {/* Info column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-zinc-800/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-300">
            {label}
          </span>
          <span className="font-mono text-xs text-zinc-300">
            {photo.taken_at}
          </span>
          {photo.body_weight_kg && (
            <span className="text-[10px] text-zinc-500">
              · {photo.body_weight_kg}kg
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-zinc-200">
          {photo.session_title ?? <span className="italic text-zinc-500">Untitled session</span>}
        </div>
        <div className="mt-0.5 text-[10px] text-zinc-500">{featuredBadge}</div>
      </div>
    </div>
  );
}

function EmptyLatestCard({ onAddUpdate }: { onAddUpdate: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-8 text-center">
      <div className="mx-auto mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
        <CameraIcon />
      </div>
      <h4 className="text-sm font-semibold text-zinc-100">No progress photos yet</h4>
      <p className="mt-1 text-[11px] text-zinc-500">
        Add your first progress session — front / side / back, all on the same day, with optional notes.
      </p>
      <button
        onClick={onAddUpdate}
        className="mt-3 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
      >
        + Add Progress
      </button>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
