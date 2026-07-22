'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  togglePhysiqueFavourite,
  deletePhysiquePhotoRecord,
  resolveSessionRepresentative,
  groupPhotosIntoSessions,
  setSessionFavourite,
  setSessionTitle,
  setSessionCover,
  updateSessionMetadata,
  coverErrorToUserMessage,
  applyStarFlip,
  applyCoverPin,
  applySessionTitle,
  applySessionText,
  applyDeletePhoto,
  type SupabaseFailure,
  type HydratedPhoto,
  type PhysiqueSession,
  PHYSIQUE_PHOTOS_FIX_MIGRATION_SQL,
  PHYSIQUE_PHOTOS_FIX_MIGRATION_PATH,
} from '@/lib/fitness/physique';
import { logEvent, EventTypes } from '@/lib/events';
import PhysiqueComparison from './physique-comparison';

type Filter = 'all' | 'starred';
type Mode = 'library' | 'album';

/**
 * Selector for the before/after comparison queue. Sessions and
 * photos are *both* eligible — when Compare is pressed, sessions
 * auto-resolve to a representative photo via
 * `resolveSessionRepresentative` (front pose → back → side → other
 * → earliest created).
 *
 * Sessions are addressed by their `taken_at`; the gallery lookups
 * the canonical `PhysiqueSession` for that date to read the cover
 * photo (or fall back to the all-photos list if the session is
 * missing for some reason).
 */
type Selection =
  | { kind: 'session'; taken_at: string }
  | { kind: 'photo'; id: string };

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.kind === 'session' && b.kind === 'session') {
    return a.taken_at === b.taken_at;
  }
  if (a.kind === 'photo' && b.kind === 'photo') {
    return a.id === b.id;
  }
  return false; // mixed kinds (session vs photo) are always distinct
}

/**
 * PhysiqueGallery — Spotify-style album library.
 *
 * UX (per user spec):
 *   - **Library view**: square album cards, one per session. Each
 *     card has its chosen cover photo, date, optional title,
 *     favourite badge, and photo-count chip.
 *   - **Album view**: opened when an album card is clicked. Shows
 *     the full-width cover hero, inline title editor (with optional
 *     notes), action row (feature/unfeature, change cover,
 *     edit notes, delete session), and a grid of all session
 *     photos. The cover photo carries a "Cover" badge in the grid.
 *   - **Cover-pick overlay**: tap "Change cover" to swap the cover
 *     by tapping any photo on a tile grid. Default cover is the
 *     first uploaded photo (`created_at` ASC) when no pin is set.
 *   - **Compare overlay**: still works across library + album
 *     views; sessions can be pinned from the library, individual
 *     photos from the album.
 *
 * The dashboard's "Quick comparison" button still seeds the
 * compare queue via `initialSelection: string[]` and activates
 * `comparing` directly (skipping library view).
 */
export default function PhysiqueGallery({
  photos,
  userId,
  onClose,
  onChange,
  applyPhotosChange,
  showToast,
  initialSelection,
  initialComparing,
}: {
  photos: HydratedPhoto[];
  userId: string;
  onClose: () => void;
  /**
   * @deprecated prefer `applyPhotosChange` for instant UI; this fires a parent
   * refetch and is no longer the no-reload path. Still wired for fallback.
   */
  onChange?: () => void;
  /** Optimistic-set: parent receives a pure updater fn that returns the NEXT
   *  photos array. The gallery snapshots the current closure value for revert. */
  applyPhotosChange?: (
    updater: (prev: HydratedPhoto[]) => HydratedPhoto[],
  ) => void;
  /** Surface a one-liner message. Used for non-cover failures (star/album-edit). */
  showToast?: (text: string) => void;
  /** Legacy: photo IDs pre-picked (e.g., from dashboard Quick compare). */
  initialSelection?: string[];
  initialComparing?: boolean;
}) {
  const sessions = useMemo(() => groupPhotosIntoSessions(photos), [photos]);
  const photoLookup = useMemo(() => {
    const m = new Map<string, HydratedPhoto>();
    for (const p of photos) m.set(p.id, p);
    return m;
  }, [photos]);

  const [mode, setMode] = useState<Mode>('library');
  const [currentSession, setCurrentSession] = useState<PhysiqueSession | null>(
    null,
  );
  const [coverPickOpen, setCoverPickOpen] = useState(false);
  const [coverFailure, setCoverFailure] = useState<SupabaseFailure | null>(
    null,
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selection[]>([]);
  const [comparing, setComparing] = useState<boolean>(false);
  const [viewer, setViewer] = useState<HydratedPhoto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyDate, setBusyDate] = useState<string | null>(null);

  // Seeded once on mount by the dashboard's Quick-compare button.
  useEffect(() => {
    if (initialSelection && initialSelection.length > 0) {
      setSelected(initialSelection.map((id) => ({ kind: 'photo', id })));
      if (initialComparing && initialSelection.length === 2) {
        setComparing(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // **Critical sync**: keep `currentSession` pointed at the latest copy
  // in `sessions` so the AlbumView reflects fresh cover/title/notes
  // after a state refresh (e.g., after `setSessionCover` reloads photos).
  //
  // Without this, AlbumView would keep rendering the stale snapshot from
  // when the user first opened the session and the cover thumbnail
  // would never update in-place — even though the DB write succeeded.
  useEffect(() => {
    if (!currentSession) return;
    const refreshed = sessions.find(
      (s) => s.taken_at === currentSession.taken_at,
    );
    if (refreshed) {
      if (refreshed !== currentSession) setCurrentSession(refreshed);
    } else {
      // Session no longer exists (e.g., last photo deleted). Close album.
      setMode('library');
      setCurrentSession(null);
    }
  }, [sessions, currentSession]);

  // Escape: close modal → exit compare → close cover-pick → close viewer (in order).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (viewer) setViewer(null);
      else if (comparing) setComparing(false);
      else if (coverPickOpen) setCoverPickOpen(false);
      else if (mode === 'album') setMode('library');
      else onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, viewer, comparing, coverPickOpen, mode]);

  const filteredSessions = useMemo(() => {
    let result = sessions;
    if (filter === 'starred') {
      // Show an album in the ★ tab whenever ANY of its photos is
      // starred — not only when every photo is starred. Single-photo
      // starring (the common workflow) was being hidden before this
      // change, which is what surfaced as "no album" in the UI.
      result = result.filter((s) =>
        s.photos.some((p) => p.is_favourited),
      );
    }
    const q = query.trim().toLowerCase();
    if (q) {
      // Match date prefix, OR any substring of the title — feels more
      // like a real library search.
      result = result.filter((s) => {
        if (s.taken_at.toLowerCase().includes(q)) return true;
        if (s.title?.toLowerCase().includes(q)) return true;
        return false;
      });
    }
    return result;
  }, [sessions, filter, query]);

  const isSelectedShot = useCallback(
    (entry: Selection) => selected.some((s) => sameSelection(s, entry)),
    [selected],
  );

  function toggleSelected(entry: Selection): void {
    setSelected((prev) => {
      if (prev.some((s) => sameSelection(s, entry))) {
        return prev.filter((s) => !sameSelection(s, entry));
      }
      // Cap at 2 so compare always pairs nicely.
      const next = [...prev, entry];
      if (next.length > 2) next.shift();
      return next;
    });
  }

  function clearSelection() {
    setSelected([]);
  }

  function resolvePair(): [HydratedPhoto, HydratedPhoto] | null {
    if (selected.length !== 2) return null;
    const lookup = (sel: Selection): HydratedPhoto | null => {
      if (sel.kind === 'photo') return photoLookup.get(sel.id) ?? null;
      const session = sessions.find((s) => s.taken_at === sel.taken_at);
      if (!session) return null;
      return resolveSessionRepresentative(session.photos);
    };
    const a = lookup(selected[0]);
    const b = lookup(selected[1]);
    if (!a || !b) return null;
    return [a, b];
  }

  function openComparison() {
    if (selected.length !== 2) return;
    const pair = resolvePair();
    if (!pair) return;
    setComparing(true);
    void logEvent(EventTypes.COMPARISON_VIEWED, {
      a_kind: selected[0].kind,
      a_id:
        selected[0].kind === 'photo'
          ? selected[0].id
          : selected[0].taken_at,
      b_kind: selected[1].kind,
      b_id:
        selected[1].kind === 'photo'
          ? selected[1].id
          : selected[1].taken_at,
      auto_resolved_session:
        selected[0].kind === 'session' || selected[1].kind === 'session',
    });
  }

  // ── Optimistic-update helper (snapshot + optimistic + await + revert-on-fail) ──
  // Used by star, cover, title, notes, delete handlers below.
  async function runOptimistic(args: {
    optimistic: (prev: HydratedPhoto[]) => HydratedPhoto[];
    asyncFn: () => Promise<boolean>;
    failureText: string;
  }): Promise<boolean> {
    if (!applyPhotosChange) {
      // Legacy fallback path: no optimistic, just await + report.
      const ok = await args.asyncFn();
      if (!ok) showToast?.(args.failureText);
      return ok;
    }
    let before: HydratedPhoto[] | null = null;
    applyPhotosChange((prev) => {
      before = prev;
      return args.optimistic(prev);
    });
    const ok = await args.asyncFn();
    if (!ok) {
      if (before) applyPhotosChange(() => before!);
      showToast?.(args.failureText);
    }
    return ok;
  }

  async function handleStar(photo: HydratedPhoto) {
    setBusyId(photo.id);
    const before = photos;
    const next = !photo.is_favourited;
    applyPhotosChange?.((prev) =>
      prev.map((p) =>
        p.id === photo.id
          ? {
              ...p,
              is_favourited: next,
              featured_at: next ? new Date().toISOString() : null,
            }
          : p,
      ),
    );
    const ok = await togglePhysiqueFavourite(photo.id, next);
    setBusyId(null);
    if (!ok) {
      if (before && applyPhotosChange) applyPhotosChange(() => before!);
      showToast?.('Could not update the star. Refresh and try again.');
      return;
    }
    onChange?.();
  }

  async function handleDelete(photo: HydratedPhoto) {
    if (
      !confirm(`Delete photo taken on ${photo.taken_at}? This cannot be undone.`)
    ) {
      return;
    }
    setBusyId(photo.id);
    const before = photos;
    applyPhotosChange?.((prev) => applyDeletePhoto(prev, photo.id));
    const ok = await deletePhysiquePhotoRecord(photo, userId);
    setBusyId(null);
    setSelected((prev) =>
      prev.filter((s) => !(s.kind === 'photo' && s.id === photo.id)),
    );
    if (!ok) {
      if (before && applyPhotosChange) applyPhotosChange(() => before!);
      showToast?.('Could not delete the photo.');
      return;
    }
    onChange?.();
  }

  async function handleDownload(photo: HydratedPhoto) {
    if (!photo.url) return;
    const extMatch = /\.([a-zA-Z0-9]+)$/.exec(photo.photo_path);
    const ext = (extMatch?.[1] ?? 'jpg').toLowerCase();
    const filename = `physique_${photo.taken_at}_${photo.id.slice(0, 8)}.${ext}`;
    try {
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      window.open(photo.url, '_blank', 'noopener');
    }
  }

  async function handleAlbumFavourite(session: PhysiqueSession) {
    setBusyDate(session.taken_at);
    const before = photos;
    applyPhotosChange?.((prev) =>
      applyStarFlip(
        prev,
        session.user_id,
        session.taken_at,
        !session.is_favourited,
      ),
    );
    const ok = await setSessionFavourite(
      session.user_id,
      session.taken_at,
      !session.is_favourited,
    );
    setBusyDate(null);
    if (!ok) {
      if (before && applyPhotosChange) applyPhotosChange(() => before!);
      showToast?.('Could not update the featured flag. Refresh and try again.');
      return;
    }
    onChange?.();
  }

  async function handleAlbumDelete(session: PhysiqueSession) {
    if (
      !confirm(
        `Delete your entire progress session on ${formatAlbumDate(session.taken_at)}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyDate(session.taken_at);
    const before = photos;
    applyPhotosChange?.((prev) =>
      prev.filter(
        (p) => !(p.user_id === session.user_id && p.taken_at === session.taken_at),
      ),
    );
    setSelected((prev) =>
      prev.filter((s) => !(s.kind === 'session' && s.taken_at === session.taken_at)),
    );
    // Await first, then drift away from album view ONLY if every
    // sub-delete succeeded. Otherwise a partial revert would still
    // leave the user staring at an emptied library view that
    // magically refilled.
    const allOk = await Promise.all(
      session.photos.map((p) => deletePhysiquePhotoRecord(p, userId)),
    ).then((results) => results.every(Boolean));
    setBusyDate(null);
    if (!allOk) {
      if (before && applyPhotosChange) applyPhotosChange(() => before!);
      showToast?.('Some photos failed to delete. Refresh to see current state.');
      return;
    }
    setMode('library');
    setCurrentSession(null);
    onChange?.();
  }

  function openAlbum(session: PhysiqueSession) {
    setCurrentSession(session);
    setMode('album');
  }

  function closeAlbum() {
    setMode('library');
    setCurrentSession(null);
  }

  // ─── Render ──────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={
        mode === 'album' && currentSession
          ? `Album ${formatAlbumDate(currentSession.taken_at)}`
          : 'Physique gallery'
      }
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Cover-swap fade-in keyframe (used when the album hero's
          `key` changes because the user picked a new cover photo). */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes cover-swap { 0% { opacity: 0; transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } } .cover-swap { animation: cover-swap 480ms cubic-bezier(0.16, 1, 0.3, 1); }`,
        }}
      />

      {comparing ? (
        <CompareOverlay
          pair={resolvePair()}
          selected={selected}
          onFlip={() => setSelected((s) => [...s].reverse())}
          onBack={() => setComparing(false)}
        />
      ) : mode === 'library' ? (
        <LibraryView
          sessions={filteredSessions}
          photosCount={photos.length}
          starredCount={photos.filter((p) => p.is_favourited).length}
          filter={filter}
          setFilter={setFilter}
          query={query}
          setQuery={setQuery}
          selected={selected}
          isSelectedShot={isSelectedShot}
          toggleSelected={toggleSelected}
          clearSelection={clearSelection}
          canCompare={selected.length === 2}
          onCompare={openComparison}
          onOpenAlbum={openAlbum}
          onClose={onClose}
        />
      ) : currentSession ? (
        <AlbumView
          session={currentSession}
          busy={busyDate === currentSession.taken_at}
          onBack={closeAlbum}
          onChange={onChange}
          onOpenPhoto={setViewer}
          onStarPhoto={handleStar}
          onDeletePhoto={handleDelete}
          onDownloadPhoto={handleDownload}
          onFavourite={() => handleAlbumFavourite(currentSession)}
          onDelete={() => handleAlbumDelete(currentSession)}
          onOpenCoverPicker={() => setCoverPickOpen(true)}
          busyPhotoId={busyId}
          selected={selected}
          isSelectedShot={isSelectedShot}
          toggleSelected={toggleSelected}
          applyPhotosChange={applyPhotosChange}
          showToast={showToast}
        />
      ) : null}

      {/* Cover-pick overlay sits over album view */}
      {coverPickOpen && currentSession && (
        <CoverPickOverlay
          session={currentSession}
          failure={coverFailure}
          onCancel={() => {
            setCoverPickOpen(false);
            setCoverFailure(null);
          }}
          onPick={async (photoId) => {
            setBusyId(photoId);
            setCoverFailure(null);
            const before = photos;
            // Optimistic: pin the cover locally so the album hero + library
            // card thumbnail both update on the SAME render — instant feedback
            // for the no-reload UX.
            applyPhotosChange?.((prev) =>
              applyCoverPin(prev, currentSession.user_id, currentSession.taken_at, photoId),
            );
            const result = await setSessionCover(
              currentSession.user_id,
              currentSession.taken_at,
              photoId,
            );
            setBusyId(null);
            if (!result.ok) {
              if (before && applyPhotosChange) applyPhotosChange(() => before!);
              // Structured failure — the overlay renders a tailored
              // runbook depending on the SQLSTATE code (column missing,
              // RLS denial, stale FK target, etc.).
              setCoverFailure(result.error);
              return; // keep cover-pick open so the user can retry
            }
            setCoverPickOpen(false);
            onChange?.();
          }}
          busyPhotoId={busyId}
        />
      )}

      {viewer && (
        <FullScreenViewer
          photo={viewer}
          onClose={() => setViewer(null)}
          onStar={() => handleStar(viewer)}
          onDelete={() => handleDelete(viewer)}
          onDownload={() => handleDownload(viewer)}
        />
      )}
    </div>
  );
}

// ─── Library view ──────────────────────────────────────────────

function LibraryView({
  sessions,
  photosCount,
  starredCount,
  filter,
  setFilter,
  query,
  setQuery,
  selected,
  isSelectedShot,
  toggleSelected,
  clearSelection,
  canCompare,
  onCompare,
  onOpenAlbum,
  onClose,
}: {
  sessions: PhysiqueSession[];
  photosCount: number;
  starredCount: number;
  filter: Filter;
  setFilter: (f: Filter) => void;
  query: string;
  setQuery: (q: string) => void;
  selected: Selection[];
  isSelectedShot: (entry: Selection) => boolean;
  toggleSelected: (entry: Selection) => void;
  clearSelection: () => void;
  canCompare: boolean;
  onCompare: () => void;
  onOpenAlbum: (s: PhysiqueSession) => void;
  onClose: () => void;
}) {
  return (
    <div className="relative z-10 flex h-full w-full flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Physique
          </div>
          <h2 className="mt-0.5 text-xl font-bold tracking-tight text-zinc-100">
            Your progress library
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {photosCount} photo{photosCount === 1 ? '' : 's'} ·{' '}
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close gallery"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-zinc-800/60 px-6 py-3">
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={`All (${photosCount})`}
          />
          <FilterChip
            active={filter === 'starred'}
            onClick={() => setFilter('starred')}
            label={`★ (${starredCount})`}
          />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by date or title…"
          className="w-64 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-3">
          {selected.length > 0 && (
            <button
              onClick={clearSelection}
              className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-300"
            >
              Clear ({selected.length})
            </button>
          )}
          {canCompare ? (
            <button
              onClick={onCompare}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
            >
              Compare photos
            </button>
          ) : (
            <span className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
              {selected.length === 0
                ? 'Pick 2 to compare'
                : `Selected ${selected.length}/2`}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-16 text-center text-sm text-zinc-500">
            {photosCount === 0
              ? 'No photos uploaded yet — open the dashboard and tap "Add Progress".'
              : 'No albums match your filter.'}
          </p>
        ) : (
          <div
            className="grid gap-5"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            }}
          >
            {sessions.map((s) => (
              <AlbumCard
                key={s.taken_at}
                session={s}
                isPinned={isSelectedShot({ kind: 'session', taken_at: s.taken_at })}
                onPin={() =>
                  toggleSelected({ kind: 'session', taken_at: s.taken_at })
                }
                onOpen={() => onOpenAlbum(s)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Album card (Spotify-style) ────────────────────────────────

function AlbumCard({
  session,
  isPinned,
  onPin,
  onOpen,
}: {
  session: PhysiqueSession;
  isPinned: boolean;
  onPin: () => void;
  onOpen: () => void;
}) {
  const cover = session.cover_photo;
  const displayTitle = session.title || formatAlbumDate(session.taken_at);
  const displayDate = formatAlbumDate(session.taken_at);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full cursor-pointer text-left transition-all duration-200 ease-out hover:scale-[1.03] hover:shadow-2xl hover:shadow-black/60"
        aria-label={`Open album ${displayTitle}`}
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-zinc-900 shadow-lg shadow-black/40">
          {cover?.url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={cover.url}
              alt={displayTitle}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
              loading…
            </div>
          )}
          {/* Photo count badge — bottom right, Spotify-style. */}
          {session.count > 1 && (
            <div className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
              +{session.count - 1}
            </div>
          )}
          {/* Featured indicator — top right, rose-gold dot. */}
          {session.is_favourited && (
            <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow-lg shadow-rose-900/40">
              ★
            </div>
          )}
        </div>
        <div className="mt-2 px-1">
          <div className="truncate text-sm font-semibold text-zinc-100 transition-colors group-hover:text-white">
            {displayTitle}
          </div>
          <div className="mt-0.5 truncate text-[11px] text-zinc-500">
            {displayDate} · {session.count} photo
            {session.count === 1 ? '' : 's'}
          </div>
        </div>
      </button>

      {/* Hover-revealed compare pin (Spotify's "Add to queue" energy). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPin();
        }}
        className={`absolute right-1 top-1 flex h-7 items-center justify-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wider opacity-0 shadow-lg transition-all group-hover:opacity-100 ${
          isPinned
            ? 'bg-rose-600 text-white opacity-100'
            : 'bg-zinc-900/90 text-zinc-200 hover:bg-zinc-800'
        }`}
        title={
          isPinned
            ? 'Pinned for compare — click to remove'
            : 'Pin this album for compare'
        }
        aria-label={isPinned ? 'Unpin album' : 'Pin album for compare'}
        aria-pressed={isPinned}
      >
        {isPinned ? '✓ Pinned' : 'Pin'}
      </button>
    </div>
  );
}

// ─── Album view (single session detail) ─────────────────────────

function AlbumView({
  session,
  busy,
  onBack,
  onChange,
  onOpenPhoto,
  onStarPhoto,
  onDeletePhoto,
  onDownloadPhoto,
  onFavourite,
  onDelete,
  onOpenCoverPicker,
  busyPhotoId,
  selected,
  isSelectedShot,
  toggleSelected,
  applyPhotosChange,
  showToast,
}: {
  session: PhysiqueSession;
  busy: boolean;
  onBack: () => void;
  onChange?: () => void;
  onOpenPhoto: (p: HydratedPhoto) => void;
  onStarPhoto: (p: HydratedPhoto) => void;
  onDeletePhoto: (p: HydratedPhoto) => void;
  onDownloadPhoto: (p: HydratedPhoto) => void;
  onFavourite: () => void;
  onDelete: () => void;
  onOpenCoverPicker: () => void;
  busyPhotoId: string | null;
  selected: Selection[];
  isSelectedShot: (entry: Selection) => boolean;
  toggleSelected: (entry: Selection) => void;
  /** Optimistic setter for sessions' text fields. */
  applyPhotosChange?: (
    updater: (prev: HydratedPhoto[]) => HydratedPhoto[],
  ) => void;
  showToast?: (text: string) => void;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title ?? '');
  const [notesDraft, setNotesDraft] = useState(session.notes ?? '');

  // Keep local draft in sync when the underlying session refreshes.
  useEffect(() => {
    setTitleDraft(session.title ?? '');
  }, [session.title]);
  useEffect(() => {
    setNotesDraft(session.notes ?? '');
  }, [session.notes]);

  async function saveTitle() {
    const normalized = titleDraft.trim() || null;
    if (normalized === (session.title ?? null)) {
      setEditingTitle(false);
      return;
    }
    setEditingTitle(false);
    if (!applyPhotosChange) {
      await setSessionTitle(session.user_id, session.taken_at, titleDraft);
      onChange?.();
      return;
    }
    let before: HydratedPhoto[] | null = null;
    applyPhotosChange((prev) => {
      before = prev;
      return applySessionTitle(prev, session.user_id, session.taken_at, normalized);
    });
    const ok = await setSessionTitle(session.user_id, session.taken_at, titleDraft);
    if (!ok) {
      if (before) applyPhotosChange(() => before!);
      showToast?.('Could not save the album title.');
      return;
    }
    onChange?.();
  }

  async function saveNotes() {
    const normalized = notesDraft.trim() || null;
    if (normalized === (session.notes ?? null)) {
      setEditingNotes(false);
      return;
    }
    setEditingNotes(false);
    if (!applyPhotosChange) {
      await updateSessionMetadata(session.user_id, session.taken_at, {
        notes: notesDraft.trim() || null,
      });
      onChange?.();
      return;
    }
    let before: HydratedPhoto[] | null = null;
    applyPhotosChange((prev) => {
      before = prev;
      return applySessionText(prev, session.user_id, session.taken_at, {
        notes: normalized,
      });
    });
    const ok = await updateSessionMetadata(session.user_id, session.taken_at, {
      notes: notesDraft.trim() || null,
    });
    if (!ok) {
      if (before) applyPhotosChange(() => before!);
      showToast?.('Could not save the notes.');
      return;
    }
    onChange?.();
  }

  const titleInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus();
  }, [editingTitle]);

  const cover = session.cover_photo;
  const photoSelSelected = selected.some(
    (s) => s.kind === 'photo',
  );
  const sessionSelSelected = isSelectedShot({
    kind: 'session',
    taken_at: session.taken_at,
  });

  return (
    <div className="relative z-10 flex h-full w-full flex-col bg-zinc-950">
      {/* Top bar: back button + featured + delete + close */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-6 py-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to library
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              toggleSelected({ kind: 'session', taken_at: session.taken_at })
            }
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              sessionSelSelected
                ? 'border-rose-500 bg-rose-600 text-white'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Pin this album for compare"
          >
            {sessionSelSelected ? '✓ Pinned' : 'Pin for compare'}
          </button>
          <button
            onClick={onFavourite}
            disabled={busy}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
              session.is_favourited
                ? 'border-rose-500/60 bg-rose-950/30 text-rose-300 hover:bg-rose-950/50'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <span aria-hidden>{session.is_favourited ? '★' : '☆'}</span>
            {session.is_favourited ? 'Featured' : 'Feature'}
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="rounded-lg border border-red-700/40 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
          {/* Cover hero */}
          <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 shadow-2xl shadow-black/40">
            <button
              type="button"
              onClick={() => cover?.url && onOpenPhoto(cover)}
              className="relative block aspect-[16/9] w-full sm:aspect-[2/1]"
              aria-label="Open cover photo full-screen"
            >
              {cover?.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={`cover-${cover.id}`}
                  src={cover.url}
                  alt={`Album cover ${formatAlbumDate(session.taken_at)}`}
                  className="absolute inset-0 h-full w-full object-cover cover-swap"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm text-zinc-600">
                  loading…
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-5 text-white">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-300">
                  Progress session
                </div>
                <h1 className="text-3xl font-bold tracking-tight">
                  {session.title || formatAlbumDate(session.taken_at)}
                </h1>
                <div className="mt-1 flex items-center gap-3 text-xs text-zinc-300">
                  <span className="font-mono">
                    {formatAlbumDate(session.taken_at)}
                  </span>
                  <span>·</span>
                  <span>
                    {session.count} photo
                    {session.count === 1 ? '' : 's'}
                  </span>
                  {session.body_weight_kg && (
                    <>
                      <span>·</span>
                      <span>{session.body_weight_kg}kg</span>
                    </>
                  )}
                  {session.is_favourited && (
                    <>
                      <span>·</span>
                      <span className="text-rose-300">★ Featured</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          </div>

          {/* Inline title editor + change-cover button */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                  Album title
                </label>
                {editingTitle ? (
                  <input
                    ref={titleInputRef}
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveTitle();
                      if (e.key === 'Escape') setEditingTitle(false);
                    }}
                    placeholder="e.g. Summer Bulk, Cut Phase 2…"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm font-semibold text-zinc-100 focus:border-zinc-500 focus:outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingTitle(true)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm font-semibold text-zinc-100 hover:bg-zinc-900"
                  >
                    {session.title || (
                      <span className="font-normal italic text-zinc-500">
                        Click to name this album…
                      </span>
                    )}
                  </button>
                )}
              </div>
              {editingTitle ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => {
                      setTitleDraft(session.title ?? '');
                      setEditingTitle(false);
                    }}
                    className="rounded-md px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveTitle}
                    className="rounded-md bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-500"
                  >
                    Save title
                  </button>
                </div>
              ) : (
                <button
                  onClick={onOpenCoverPicker}
                  className="shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                >
                  Change cover
                </button>
              )}
            </div>

            {/* Notes editor */}
            <div className="mt-4 border-t border-zinc-800 pt-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                  Notes
                </label>
                {!editingNotes && (
                  <button
                    onClick={() => setEditingNotes(true)}
                    className="text-[10px] font-medium text-zinc-500 hover:text-zinc-300"
                  >
                    {session.notes ? 'Edit' : 'Add notes'}
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="e.g. After deload, lighting was better."
                    rows={2}
                    autoFocus
                    className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setNotesDraft(session.notes ?? '');
                        setEditingNotes(false);
                      }}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveNotes}
                      className="rounded-md bg-rose-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-rose-500"
                    >
                      Save notes
                    </button>
                  </div>
                </div>
              ) : session.notes ? (
                <p className="mt-1 text-[11px] italic leading-relaxed text-zinc-300">
                  "{session.notes}"
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-zinc-600">No notes yet.</p>
              )}
            </div>
          </div>

          {/* Photo grid (cover included with a badge) */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                All photos
              </h3>
              <span className="text-[10px] text-zinc-600">
                {photoSelSelected
                  ? `${selected.length} on the compare board`
                  : 'Tap a pin icon to add to compare'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {session.photos.map((p) => {
                const isCover = cover?.id === p.id;
                const photoSel: Selection = { kind: 'photo', id: p.id };
                const isPicked = isSelectedShot(photoSel);
                const isBusy = busyPhotoId === p.id;
                return (
                  <AlbumPhotoTile
                    key={p.id}
                    photo={p}
                    isCover={isCover}
                    isPicked={isPicked}
                    isBusy={isBusy}
                    onOpen={() => onOpenPhoto(p)}
                    onStar={() => onStarPhoto(p)}
                    onDelete={() => onDeletePhoto(p)}
                    onDownload={() => onDownloadPhoto(p)}
                    onPin={() => toggleSelected(photoSel)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlbumPhotoTile({
  photo,
  isCover,
  isPicked,
  isBusy,
  onOpen,
  onStar,
  onDelete,
  onDownload,
  onPin,
}: {
  photo: HydratedPhoto;
  isCover: boolean;
  isPicked: boolean;
  isBusy: boolean;
  onOpen: () => void;
  onStar: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onPin: () => void;
}) {
  const label = photo.pose_type ?? 'Photo';
  return (
    <div
      className={`group relative overflow-hidden rounded-lg border bg-zinc-900 transition-all ${
        isPicked
          ? 'border-rose-500 ring-2 ring-rose-500/40'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="block aspect-square w-full"
        aria-label={`View ${label} full-screen`}
      >
        {photo.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={`Album photo ${label} ${photo.taken_at}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
            loading…
          </div>
        )}
      </button>
      {isCover && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow">
          ★ Cover
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <span className="truncate text-[10px] font-medium uppercase tracking-wider text-white/95">
          {label}
        </span>
        {photo.body_weight_kg && (
          <span className="text-[10px] text-white/70">
            {photo.body_weight_kg}kg
          </span>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-1 top-1 flex items-center justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5">
          <button
            onClick={onStar}
            disabled={isBusy}
            title={photo.is_favourited ? 'Unstar' : 'Star'}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed"
            aria-label={photo.is_favourited ? 'Unstar photo' : 'Star photo'}
          >
            <span className={photo.is_favourited ? 'text-rose-300' : ''}>
              {photo.is_favourited ? '★' : '☆'}
            </span>
          </button>
          <button
            onClick={onDownload}
            disabled={isBusy}
            title="Download"
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed"
            aria-label="Download"
          >
            ↓
          </button>
          <button
            onClick={onPin}
            title={isPicked ? 'Unselect for compare' : 'Select for compare'}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              isPicked
                ? 'bg-rose-500 text-white'
                : 'text-zinc-200 hover:bg-zinc-700'
            }`}
            aria-label="Select for compare"
          >
            {isPicked ? '✓' : '⨯'}
          </button>
          <button
            onClick={onDelete}
            disabled={isBusy}
            title="Delete"
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed"
            aria-label="Delete"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cover-pick overlay ────────────────────────────────────────

function CoverPickOverlay({
  session,
  onCancel,
  onPick,
  busyPhotoId,
  failure,
}: {
  session: PhysiqueSession;
  onCancel: () => void;
  onPick: (photoId: string) => void | Promise<void>;
  busyPhotoId: string | null;
  failure?: SupabaseFailure | null;
}) {
  const currentCoverId = session.cover_photo?.id ?? null;
  // Only schema/RLS failures get the embedded SQL runbook —
  // transient FK violations just need a refresh.
  const isSchemaFailure =
    failure?.code === '42703' ||
    failure?.code === 'PGRST0' ||
    failure?.code === '42501';
  async function copyFixSql() {
    try {
      await navigator.clipboard.writeText(PHYSIQUE_PHOTOS_FIX_MIGRATION_SQL);
    } catch {
      // Old browsers / insecure contexts — fall back to a textarea.
      const ta = document.createElement('textarea');
      ta.value = PHYSIQUE_PHOTOS_FIX_MIGRATION_SQL;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* swallow — user can manually select from the <pre> */
      }
      ta.remove();
    }
  }
  return (
    <div
      className="fixed inset-0 z-30 flex flex-col bg-zinc-950/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-label="Pick album cover"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400/80">
            Pick a cover
          </div>
          <h2 className="mt-0.5 text-lg font-semibold text-zinc-100">
            {formatAlbumDate(session.taken_at)} · {session.count} photo
            {session.count === 1 ? '' : 's'}
          </h2>
        </div>
        <button
          onClick={onCancel}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Cancel
        </button>
      </header>
      {failure && (
        <div
          role="alert"
          className="border-b border-red-900/40 bg-red-950/40 px-6 py-3 text-xs leading-relaxed text-red-200"
        >
          <div className="text-[13px] font-semibold text-red-100">
            {coverErrorToUserMessage(failure)}
          </div>
          {(failure.code || failure.details) && (
            <div className="mt-1 font-mono text-[10px] text-red-300/70">
              {failure.code && (
                <span>SQLSTATE: {failure.code}</span>
              )}
              {failure.details && (
                <span className="ml-2">{failure.details}</span>
              )}
            </div>
          )}
          {isSchemaFailure && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-red-200 hover:text-red-100">
                Show the schema-fix SQL to paste in Supabase SQL Editor →
              </summary>
              <div className="mt-2 rounded-md border border-red-900/60 bg-zinc-950/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-red-300/60">
                    File: {PHYSIQUE_PHOTOS_FIX_MIGRATION_PATH}
                  </div>
                  <button
                    type="button"
                    onClick={copyFixSql}
                    className="rounded-md border border-red-700/40 bg-zinc-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-200 hover:bg-red-950/40"
                  >
                    Copy SQL
                  </button>
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre rounded bg-zinc-950/80 p-2 font-mono text-[10px] text-zinc-300">
                  {PHYSIQUE_PHOTOS_FIX_MIGRATION_SQL}
                </pre>
                <div className="mt-2 text-[10px] text-red-300/70">
                  Run it once in <span className="font-mono">Supabase → SQL Editor → New query</span>, then click retry below.
                </div>
              </div>
            </details>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-5">
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          }}
        >
          {session.photos.map((p) => {
            const isBusy = busyPhotoId === p.id;
            const isCurrent = currentCoverId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={isBusy || isCurrent}
                onClick={() => void onPick(p.id)}
                className={`group relative block aspect-square overflow-hidden rounded-lg border-2 transition-all hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60 ${
                  isCurrent
                    ? 'border-rose-500 shadow-lg shadow-rose-900/40'
                    : 'border-zinc-800 hover:border-zinc-600'
                }`}
                aria-label={`Set ${p.pose_type ?? 'photo'} as cover`}
              >
                {p.url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.url}
                    alt="Cover candidate"
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                    loading…
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute left-2 top-2 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow">
                    ★ Current
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/85 to-transparent px-2 py-1.5">
                  <span className="truncate text-[10px] font-medium uppercase tracking-wider text-white/95">
                    {p.pose_type ?? 'Photo'}
                  </span>
                  {!isCurrent && (
                    <span className="text-[10px] font-medium text-zinc-200 opacity-0 transition-opacity group-hover:opacity-100">
                      Tap to set
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Compare overlay (unchanged) ──────────────────────────────

function CompareOverlay({
  pair,
  selected,
  onFlip,
  onBack,
}: {
  pair: [HydratedPhoto, HydratedPhoto] | null;
  selected: Selection[];
  onFlip: () => void;
  onBack: () => void;
}) {
  return (
    <div className="relative z-20 flex h-full w-full flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-rose-400/80">
            Compare
          </div>
          <h2 className="mt-0.5 text-base font-semibold text-zinc-100">
            {pair ? `${pair[0].taken_at} → ${pair[1].taken_at}` : 'No selection'}
          </h2>
          <div className="mt-1 hidden text-[10px] text-zinc-500 sm:block">
            {selected
              .map((s) =>
                s.kind === 'session'
                  ? `session ${s.taken_at}`
                  : `photo ${s.id.slice(0, 8)}`,
              )
              .join(' vs ')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onFlip}
            disabled={!pair}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            Flip
          </button>
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Back to library"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center p-4 sm:p-6">
        {pair ? <PhysiqueComparison before={pair[0]} after={pair[1]} /> : null}
      </div>
    </div>
  );
}

// ─── Misc small components ─────────────────────────────────────

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-xs font-medium transition-all ${
        active
          ? 'bg-zinc-100 text-zinc-900 shadow-sm'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}

function FullScreenViewer({
  photo,
  onClose,
  onStar,
  onDelete,
  onDownload,
}: {
  photo: HydratedPhoto;
  onClose: () => void;
  onStar: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onDownload: () => void | Promise<void>;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/95 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-black"
        aria-label="Close viewer"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      </button>
      <div
        className="flex max-h-full max-w-full flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs text-white/80">
          <span className="font-mono">{photo.taken_at}</span>
          {photo.pose_type && (
            <span className="ml-2 text-white/60">· {photo.pose_type}</span>
          )}
          {photo.body_weight_kg && (
            <span className="ml-2 text-white/60">· {photo.body_weight_kg}kg</span>
          )}
        </div>
        {photo.url && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={photo.url}
            alt={`Full-screen ${photo.taken_at}`}
            className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl"
          />
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={onStar}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              photo.is_favourited
                ? 'border-rose-500 bg-rose-950/50 text-rose-300'
                : 'border-zinc-600 bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            {photo.is_favourited ? '★ Featured' : '☆ Feature'}
          </button>
          <button
            onClick={onDownload}
            className="rounded-lg border border-zinc-600 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
          >
            Download
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-red-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAlbumDate(date: string): string {
  const dt = new Date(date + 'T00:00:00');
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
