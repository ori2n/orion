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
 * Shape:
 *   1. **Tall portrait "Latest" hero** on the LEFT — full-bleed photo,
 *      aspect 4:5 so it's portrait-but-not-extreme.
 *   2. **Vertical 2×3 photo grid** on the RIGHT — six latest session
 *      covers, aspect-[3/4] per cell so portrait physique photos aren't
 *      cropped top/bottom.
 *   3. **Deep-link from snapshot** — clicking the LatestCard asks the
 *      timeline to scroll its matching cell into view AND pulse a
 *      rose ring for ~2.2 s, so the user can see that session in
 *      context.
 *   4. **Action row** — Quick comparison + Open Gallery + Add
 *      Progress.
 *   5. **Optimistic mutations** — every mutation (star / cover /
 *      session edit) updates local state immediately, then awaits the
 *      Supabase roundtrip. On failure, the previous state is restored
 *      and a one-liner flash toast surfaces the error. Star / unstar
 *      never triggers a page reload.
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
  /**
   * Drives programmatic deep-linking from the dashboard "Latest"
   * hero into the timeline. Setting this to a session date asks the
   * timeline to scroll that cell into view AND pulse a rose ring
   * around it for ~2 s. Consumed by the timeline via
   * `onHighlightConsumed` so it only fires once per click.
   */
  const [timelineHighlightDate, setTimelineHighlightDate] =
    useState<string | null>(null);
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
  const applyPhotosChange = useCallback(
    (updater: (prev: HydratedPhoto[]) => HydratedPhoto[]) => {
      setAllPhotos(updater);
    },
    [],
  );

  const showFlash = useCallback(
    (kind: 'error' | 'info', text: string) => {
      setFlash({ kind, text, key: Date.now() });
    },
    [],
  );

  // Auto-dismiss flash after 6 s.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ─── Quick compare entrypoint ─────────────────────────────────
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
    onSaved();
  }

  /**
   * Deep-link entrypoint for the Latest hero. Asks the timeline to
   * scroll into view and highlight the session containing the
   * latest photo. The timeline mirrors the signal back via
   * `onHighlightConsumed`, which clears the prop so re-renders
   * don't keep retriggering the highlight.
   */
  function focusTimelineOnSession(takenAt: string) {
    if (!takenAt) return;
    setTimelineHighlightDate(takenAt);
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
      {/* ── Physique Section ─────────────────────────────────── */}
      <section
        aria-label="Physique"
        className="rounded-2xl border border-zinc-800/60 bg-zinc-900/45 p-1.5 shadow-sm backdrop-blur-sm"
      >
        {/* Section header */}
        <div className="mb-1 flex items-center justify-between">
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

        {/* ── Two-column layout: tall snapshot LEFT, 2×3 timeline grid RIGHT ── */}
        <div className="grid grid-cols-1 gap-1 lg:grid-cols-[5fr_7fr] lg:items-start lg:gap-2">
          {latest ? (
            <LatestCard
              photo={latest}
              sessionPhotoCount={
                sessions.find((s) => s.taken_at === latest.taken_at)?.count ?? 1
              }
              onActivate={() => focusTimelineOnSession(latest.taken_at)}
            />
          ) : (
            <EmptyLatestCard onAddUpdate={() => setUploadOpen(true)} />
          )}

          {/* Timeline — vertical 2×3 grid of session cover thumbs. */}
          <div
            id="physique-timeline"
            aria-label="Latest progress photos"
          >
            <PhysiqueTimeline
              photos={allPhotos}
              highlightedDate={timelineHighlightDate}
              onHighlightConsumed={() => setTimelineHighlightDate(null)}
              onOpenSessionInGallery={() => setGalleryOpen(true)}
            />
          </div>
        </div>

        {/* ── Action row (Open Gallery + Quick compare) ─────────── */}
        <div className="mt-1 flex flex-wrap gap-2 border-t border-zinc-800/60 pt-1">
          <button
            onClick={openQuickCompare}
            disabled={allPhotos.length < 2}
            className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Quick comparison
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
          <div className="mt-1">
            <PhysiqueUploadFlow
              userId={userId}
              onError={(msg) => showFlash('error', msg)}
              onCancel={() => setUploadOpen(false)}
              onSaved={() => void handleUploadSaved()}
            />
          </div>
        )}
      </section>

      {/* ── Inline flash toast ─────────────────────────────────── */}
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

      {/* ── Gallery modal ──────────────────────────────────────── */}
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

// ─── Tall LatestCard hero (full image + overlay text) ────────────

function LatestCard({
  photo,
  sessionPhotoCount,
  onActivate,
}: {
  photo: HydratedPhoto;
  sessionPhotoCount: number;
  onActivate: () => void;
}) {
  const label = photo.pose_type ?? 'Photo';
  const featuredBadge = photo.is_favourited ? '⭐ Featured' : 'Latest';
  return (
    <button
      type="button"
      onClick={onActivate}
      className="group relative block h-full w-full aspect-[4/5] overflow-hidden rounded-3xl border border-zinc-800/70 bg-zinc-900/60 text-left transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-zinc-600 hover:shadow-2xl hover:shadow-black/50 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
      aria-label={`Open timeline at ${photo.taken_at} (${
        photo.session_title ?? 'Untitled session'
      })`}
    >
      {/* Full image */}
      <div className="absolute inset-0">
        {photo.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={`Latest progress — ${photo.taken_at}`}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
            loading…
          </div>
        )}
      </div>
      {/* Gradient for legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      {/* Featured chip (top right) */}
      {photo.is_favourited && (
        <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-rose-500/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-900/40 backdrop-blur">
          ★ Featured
        </div>
      )}
      {/* Pose / session-count chip (top left) */}
      <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur">
        <span>{label}</span>
        <span className="text-white/60">·</span>
        <span>
          {sessionPhotoCount === 1
            ? 'Solo'
            : `${sessionPhotoCount} photos`}
        </span>
      </div>
      {/* Overlay footer (title + date + open hint) */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4 text-white">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-300/80">
          Progress session
        </div>
        <div className="line-clamp-2 text-xl font-bold tracking-tight">
          {photo.session_title ?? (
            <span className="italic text-zinc-300">Untitled session</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-200">
          <span className="font-mono">{photo.taken_at}</span>
          {photo.body_weight_kg && (
            <span className="rounded-full bg-zinc-900/60 px-2 py-0.5">
              {photo.body_weight_kg}kg
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-300/90">
          <span>{featuredBadge}</span>
          <span aria-hidden className="text-rose-300/70">
            ·
          </span>
          <span className="transition-colors group-hover:text-white">
            View in timeline →
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyLatestCard({ onAddUpdate }: { onAddUpdate: () => void }) {
  return (
    <div
      className="flex aspect-[4/5] h-full w-full flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-10 text-center"
    >
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
        <CameraIcon />
      </div>
      <h4 className="text-base font-semibold text-zinc-100">
        No progress photos yet
      </h4>
      <p className="mt-1.5 max-w-[28ch] text-[11px] text-zinc-500">
        Add your first progress session — front / side / back on the
        same day, with optional notes.
      </p>
      <button
        onClick={onAddUpdate}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
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
