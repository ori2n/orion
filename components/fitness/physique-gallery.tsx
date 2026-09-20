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
  applyNewSession,
  type SupabaseFailure,
  type HydratedPhoto,
  type PhysiqueSession,
  PHYSIQUE_PHOTOS_FIX_MIGRATION_SQL,
  PHYSIQUE_PHOTOS_FIX_MIGRATION_PATH,
} from '@/lib/fitness/physique';
import { logEvent, EventTypes } from '@/lib/events';
import PhysiqueComparison from './physique-comparison';
import PhysiqueUploadFlow from './physique-upload-flow';

type Filter = 'all' | 'starred';
type Mode = 'library' | 'album';

/**
 * Height of the app's sticky header, as a CSS calc operand:
 * `AppHeader` is `h-11` (44px) plus `env(safe-area-inset-top)`.
 *
 * Why the gallery needs it: every page under the Fitness layout is
 * rendered inside `<main class="relative z-10">`, which traps this
 * modal (and each of its full-screen layers) in that stacking
 * context — so the header's `z-40` always paints ABOVE us, no matter
 * how high our own z-index goes. Reserving the header's band at the
 * top of each layer is therefore the only way to keep a control (the
 * red X in particular) out from under the nav bar.
 */
const HEADER_OFFSET = 'env(safe-area-inset-top, 0px) + 44px';
/** Padding that pushes a layer's content below the app header. */
const BELOW_HEADER_PADDING = `calc(${HEADER_OFFSET})`;
/** Position for a control pinned just under the app header. */
const BELOW_HEADER_INSET = `calc(${HEADER_OFFSET} + 0.75rem)`;

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
 * True when a history entry is the gallery's own Back guard (see the
 * `armHistoryGuard` block inside the component). Reads defensively
 * because the entry may carry Next's router state, be `null`, or be a
 * state pushed by unrelated code.
 */
function isGuardState(state: unknown): boolean {
  return Boolean(
    state &&
      typeof state === 'object' &&
      (state as { physiqueGallery?: boolean }).physiqueGallery,
  );
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
 * The dashboard's "Quick comparison" button still seeds the compare
 * board via `initialSelection: string[]`; with `initialComparing` the
 * gallery opens straight into Compare mode with both slots already
 * filled (the pair is still swappable from the picker).
 *
 * Compare mode itself is a *view inside the gallery*: it shows two
 * slots plus the gallery photos grouped by session, and only renders
 * the side-by-side comparison once the user has chosen both photos.
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
  /**
   * Compare view — a dedicated in-gallery mode, NOT an instant
   * comparison against a predetermined photo. Opening it never
   * compares anything by itself: the user lands on the two-slot
   * picker, browses the gallery/session photos, and the side-by-side
   * view appears as soon as both slots are filled. `selected` doubles
   * as the compare board, so pins made in the library or a session
   * grid carry straight into Compare mode.
   */
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const [viewer, setViewer] = useState<HydratedPhoto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  /**
   * Session-first add flow (the pre-remake "Add Session" entry).
   * Renders `PhysiqueUploadFlow` inline inside the gallery modal so
   * the user can create a new session without first closing the
   * gallery and hunting for the dashboard's upload button. While
   * open, the library grid is replaced so the flow has full height.
   */
  const [addSessionOpen, setAddSessionOpen] = useState(false);

  // ── Browser / mobile Back integration ───────────────────────────
  //
  // While the gallery is open it keeps exactly ONE guard entry in the
  // history stack. Pressing Back (browser button, Android back
  // gesture) peels the innermost open layer — photo viewer → compare
  // → cover picker → add-session → session → gallery — instead of
  // throwing the user out of the route and losing the gallery state.
  // Every peel re-arms the guard, so the next Back continues from
  // where the user stopped. The final Back (library layer) closes the
  // modal, consumes the guard entry, and leaves the history exactly
  // as it was before the gallery was opened — no dead entries, no URL
  // churn, no new route.
  //
  // `closeTopLayerRef` / `requestCloseRef` hold the newest closures so
  // the mount-once popstate listener never reads stale state.
  const closeTopLayerRef = useRef<() => boolean>(() => false);
  const requestCloseRef = useRef<() => void>(() => {});
  const suppressPopRef = useRef(0);
  const guardAliveRef = useRef(false);

  /** Mark the current history entry as ours (idempotent). */
  function armHistoryGuard() {
    if (typeof window === 'undefined') return;
    if (!guardAliveRef.current && !isGuardState(window.history.state)) {
      // Spread the existing state so Next's own router internals on this
      // entry survive; we only add our marker on top.
      window.history.pushState(
        { ...((window.history.state as object | null) ?? {}), physiqueGallery: true },
        '',
      );
    }
    guardAliveRef.current = true;
  }

  useEffect(() => {
    armHistoryGuard();

    function onPop() {
      // Our own `history.back()` (dropping the guard on an in-app close)
      // — nothing to peel.
      if (suppressPopRef.current > 0) {
        suppressPopRef.current -= 1;
        return;
      }
      if (closeTopLayerRef.current()) {
        // A layer was closed — re-arm so the next Back peels the next one.
        guardAliveRef.current = false;
        armHistoryGuard();
        return;
      }
      // Library layer: the guard entry is consumed, so the modal closes
      // without touching history again.
      guardAliveRef.current = false;
      requestCloseRef.current();
    }

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * Close the whole gallery. Drops our guard entry first (so the user
   * does not have to press Back an extra time afterwards) and then lets
   * the parent unmount us.
   */
  function requestClose() {
    if (
      guardAliveRef.current &&
      typeof window !== 'undefined' &&
      isGuardState(window.history.state)
    ) {
      suppressPopRef.current += 1;
      guardAliveRef.current = false;
      window.history.back();
    }
    onClose();
  }

  // Seeded once on mount by the dashboard's Quick-compare button.
  useEffect(() => {
    if (initialSelection && initialSelection.length > 0) {
      setSelected(initialSelection.map((id) => ({ kind: 'photo', id })));
      if (initialComparing && initialSelection.length === 2) {
        setCompareOpen(true);
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

  // Escape mirrors Back exactly: peel the innermost open layer (viewer →
  // add-session → compare → cover-pick → session) and only close the
  // whole gallery once the library layer is on screen.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (closeTopLayerRef.current()) return;
      requestCloseRef.current();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  /**
   * Compare-picker fill rule: the first tap fills slot 1, the second
   * fills slot 2, and every later tap *replaces slot 2* — so the photo
   * the user anchored in slot 1 stays put while they hunt for the photo
   * to compare it against. Tapping something already on the board
   * takes it back off.
   */
  function pickForCompare(sel: Selection) {
    setSelected((prev) => {
      if (prev.some((s) => sameSelection(s, sel))) {
        return prev.filter((s) => !sameSelection(s, sel));
      }
      if (prev.length === 0) return [sel];
      return [prev[0], sel];
    });
  }

  /** Empty one compare slot (0 = the first photo, 1 = the second). */
  function clearSlot(index: number) {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  }

  /** Resolve any compare-board entry to the photo it stands for. */
  const resolveSelection = useCallback(
    (sel: Selection): HydratedPhoto | null => {
      if (sel.kind === 'photo') return photoLookup.get(sel.id) ?? null;
      const session = sessions.find((s) => s.taken_at === sel.taken_at);
      if (!session) return null;
      return resolveSessionRepresentative(session.photos);
    },
    [photoLookup, sessions],
  );

  function resolvePair(): [HydratedPhoto, HydratedPhoto] | null {
    if (selected.length !== 2) return null;
    const a = resolveSelection(selected[0]);
    const b = resolveSelection(selected[1]);
    if (!a || !b) return null;
    return [a, b];
  }

  /**
   * Open Compare mode. This never compares against a predetermined
   * photo: with fewer than two entries on the board it lands on the
   * two-slot picker so the user can browse the gallery and choose both
   * photos themselves.
   */
  function openCompare() {
    setCompareOpen(true);
    if (selected.length === 0) return;
    const first = selected[0];
    const second = selected[1];
    void logEvent(EventTypes.COMPARISON_VIEWED, {
      a_kind: first.kind,
      a_id: first.kind === 'photo' ? first.id : first.taken_at,
      b_kind: second?.kind ?? null,
      b_id:
        second === undefined
          ? null
          : second.kind === 'photo'
            ? second.id
            : second.taken_at,
      auto_resolved_session: selected.some((s) => s.kind === 'session'),
      slots_filled: selected.length,
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

  /**
   * Peel the innermost open layer, in the same order for the Escape key
   * and the browser/Android Back button: photo viewer → add-session
   * flow → compare view → cover picker → session view. Returns false
   * when only the library is left, which tells the caller to close the
   * whole gallery.
   */
  function closeTopLayer(): boolean {
    if (viewer) {
      setViewer(null);
      return true;
    }
    if (addSessionOpen) {
      setAddSessionOpen(false);
      return true;
    }
    if (compareOpen) {
      setCompareOpen(false);
      return true;
    }
    if (coverPickOpen) {
      setCoverPickOpen(false);
      setCoverFailure(null);
      return true;
    }
    if (mode === 'album') {
      closeAlbum();
      return true;
    }
    return false;
  }

  // Hand the mount-once Escape/popstate listeners the freshest closures.
  // (Assigning these refs during render is not allowed — React forbids
  // ref writes in the render phase.)
  useEffect(() => {
    closeTopLayerRef.current = closeTopLayer;
    requestCloseRef.current = requestClose;
  });

  /**
   * A new session (or extra photos appended to an existing one) was
   * created by the inline upload flow. Optimistically splice the
   * hydrated rows into the gallery's photo list, then bubble to the
   * parent so the timeline/snapshot refetch. Opening the album
   * immediately only makes sense when the user picked TODAY'S date —
   * any other `taken_at` already had its own session, so we just
   * drop back to the grid where the new/updated album shows up with
   * its first uploaded photo as the cover.
   */
  async function handleSessionCreated(newPhotos: HydratedPhoto[], takenAt: string) {
    setAddSessionOpen(false);
    if (newPhotos.length > 0) {
      applyPhotosChange?.((prev) => applyNewSession(prev, newPhotos));
    }
    onChange?.();
    const sessionExists = sessions.some((s) => s.taken_at === takenAt);
    if (!sessionExists) {
      const created = groupPhotosIntoSessions(newPhotos).find(
        (s) => s.taken_at === takenAt,
      );
      if (created) {
        openAlbum(created);
        return;
      }
    }
    setMode('library');
    setCurrentSession(null);
  }

  // ─── Render ──────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      // Reserve the sticky app header's band (see HEADER_OFFSET) so the
      // gallery's own header row — and its red X — never hide underneath
      // the nav bar.
      style={{ paddingTop: BELOW_HEADER_PADDING }}
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
        onClick={requestClose}
        aria-hidden
      />

      {/* Cover-swap fade-in keyframe (used when the album hero's
          `key` changes because the user picked a new cover photo). */}
      <style
        dangerouslySetInnerHTML={{
          __html: `@keyframes cover-swap { 0% { opacity: 0; transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } } .cover-swap { animation: cover-swap 480ms cubic-bezier(0.16, 1, 0.3, 1); }`,
        }}
      />

      {compareOpen ? (
        <CompareView
          sessions={sessions}
          selected={selected}
          resolveSelection={resolveSelection}
          onPick={pickForCompare}
          onClearSlot={clearSlot}
          onClearAll={clearSelection}
          pair={resolvePair()}
          onFlip={() => setSelected((s) => [...s].reverse())}
          onClose={() => setCompareOpen(false)}
        />
      ) : addSessionOpen ? (
        /* Session-first add flow — replaces the library grid while
           open so the flow has full height (pre-remake behaviour). */
        <div className="relative z-10 flex h-full w-full flex-col bg-zinc-950">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-6 py-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Physique
              </div>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-zinc-100">
                Add session
              </h2>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Pick a date and one or more photos — they become a new
                album (or join the existing session for that day).
              </p>
            </div>
            <button
              onClick={() => setAddSessionOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Cancel add session"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          </header>
          <div className="flex-1 overflow-y-auto p-5">
            <PhysiqueUploadFlow
              userId={userId}
              onError={(msg) => showToast?.(msg)}
              onCancel={() => setAddSessionOpen(false)}
              onSaved={(created, takenAt) =>
                void handleSessionCreated(created, takenAt)
              }
            />
          </div>
        </div>
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
          onCompare={openCompare}
          onOpenAlbum={openAlbum}
          onClose={requestClose}
          onAddSession={() => setAddSessionOpen(true)}
        />
      ) : currentSession ? (
        <AlbumView
          session={currentSession}
          busy={busyDate === currentSession.taken_at}
          onBack={closeAlbum}
          onCompare={openCompare}
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
  onCompare,
  onOpenAlbum,
  onClose,
  onAddSession,
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
  onCompare: () => void;
  onOpenAlbum: (s: PhysiqueSession) => void;
  onClose: () => void;
  onAddSession: () => void;
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
          {/* Restored "Add Session" entry (pre-remake upload flow). */}
          <button
            onClick={onAddSession}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            aria-label="Add a new progress session"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add session
          </button>
          {selected.length > 0 && (
            <button
              onClick={clearSelection}
              className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-300"
            >
              Clear ({selected.length})
            </button>
          )}
          <span className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            {selected.length === 0
              ? 'Pick photos to compare'
              : selected.length === 1
                ? 'Selected 1/2'
                : 'Ready to compare'}
          </span>
          {/* Compare is always reachable: it opens the dedicated compare
              view, which starts on the two-slot picker whenever fewer
              than two photos are on the board. */}
          <button
            onClick={onCompare}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
            aria-label="Open the compare view"
          >
            <CompareIcon />
            Compare
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {sessions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-16 text-center text-sm text-zinc-500">
            {photosCount === 0
              ? 'No photos yet — tap "Add session" above to create your first one.'
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
            <GalleryImage
              src={cover.url}
              alt={displayTitle}
              className="h-full w-full object-cover"
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
  onCompare,
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
  /** Open the compare view (session photos stay on screen behind it). */
  onCompare: () => void;
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
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        {/* Always-visible back pill — returns to the Gallery grid
            (library view), never all the way out of the modal. */}
        <button
          onClick={onBack}
          className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-semibold text-zinc-100 transition-colors hover:border-zinc-600 hover:bg-zinc-800 sm:h-auto sm:py-1.5 sm:pl-2.5 sm:pr-3.5"
          aria-label="Back to the gallery grid"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {/* Label only where there is room — the icon keeps the mobile
              header from crowding out the red X. */}
          <span className="hidden sm:inline">Back to gallery</span>
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() =>
              toggleSelected({ kind: 'session', taken_at: session.taken_at })
            }
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 ${
              sessionSelSelected
                ? 'border-rose-500 bg-rose-600 text-white'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
            title="Pin this album for compare"
            aria-label={
              sessionSelSelected
                ? 'Remove this album from the compare board'
                : 'Pin this album for compare'
            }
            aria-pressed={sessionSelSelected}
          >
            <span className="hidden sm:inline">
              {sessionSelSelected ? '✓ Pinned' : 'Pin for compare'}
            </span>
            <span className="sm:hidden">{sessionSelSelected ? '✓' : 'Pin'}</span>
          </button>
          <button
            onClick={onFavourite}
            disabled={busy}
            className={`hidden items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 sm:flex ${
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
            className="hidden rounded-lg border border-red-700/40 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-40 sm:block"
          >
            Delete
          </button>
          <button
            onClick={onCompare}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 sm:px-3"
            aria-label="Open the compare view"
            title="Compare photos across sessions"
          >
            <CompareIcon size={14} />
            <span className="hidden sm:inline">Compare</span>
          </button>
          {/* Always-visible red X — top-right corner of the session display.
              Returns to the gallery grid (never out of the modal). */}
          <CloseX
            onClick={onBack}
            label="Close session and return to the gallery"
          />
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
                <GalleryImage
                  key={`cover-${cover.id}`}
                  src={cover.url}
                  alt={`Album cover ${formatAlbumDate(session.taken_at)}`}
                  className="absolute inset-0 h-full w-full object-cover cover-swap"
                  eager
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
          <GalleryImage
            src={photo.url}
            alt={`Album photo ${label} ${photo.taken_at}`}
            className="h-full w-full object-cover"
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
            title={isPicked ? 'On the compare board' : 'Add to compare board'}
            className={`flex h-6 w-6 items-center justify-center rounded ${
              isPicked
                ? 'bg-rose-500 text-white'
                : 'text-zinc-200 hover:bg-zinc-700'
            }`}
            aria-label={isPicked ? 'Remove from compare board' : 'Add to compare board'}
            aria-pressed={isPicked}
          >
            {isPicked ? <CheckIcon size={12} /> : <CompareIcon size={12} />}
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
      // Same header band as the gallery shell — the Cancel button lives
      // in this overlay's own header row.
      style={{ paddingTop: BELOW_HEADER_PADDING }}
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
                  <GalleryImage
                    src={p.url}
                    alt="Cover candidate"
                    className="h-full w-full object-cover"
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

// ─── Compare view (in-gallery mode, not a page) ────────────────

/**
 * The single "get me out of here" affordance used by the session
 * view, the photo viewer and the compare view: a filled red X pinned
 * to the top-right corner. `size="lg"` bumps the hit area to 44 px so
 * it stays an easy thumb target on mobile, where a bare glyph would
 * not be.
 */
function CloseX({
  onClick,
  label,
  size = 'md',
  className = '',
  style,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Accessible name — also spells out where the user lands. */
  label: string;
  size?: 'md' | 'lg';
  className?: string;
  /** Escape hatch for absolute positioning inside a full-screen layer. */
  style?: React.CSSProperties;
}) {
  const dims = size === 'lg' ? 'h-11 w-11' : 'h-9 w-9';
  const icon = size === 'lg' ? 20 : 18;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={style}
      className={`flex shrink-0 items-center justify-center rounded-lg bg-red-600 text-white shadow-lg shadow-red-950/40 transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/70 active:scale-95 ${dims} ${className}`}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </svg>
    </button>
  );
}

/**
 * Compare is a *mode inside the gallery*, never a route: it opens over
 * whatever the user was looking at and closing it reveals that view
 * again (library or session), so all gallery state survives.
 *
 * Layout:
 *   1. Two explicit slots — "First photo" / "Second photo" — each with
 *      its own ✕, so either side can be re-picked.
 *   2. The side-by-side comparison, shown as soon as both slots are
 *      filled. It reuses `PhysiqueComparison` in its split mode, so
 *      the existing alignment / zoom / pan tooling keeps working.
 *   3. A picker that mirrors the library: a session-chip strip (pin a
 *      whole session, auto-resolved to its best pose) plus one section
 *      per session with horizontally scrollable thumbnails.
 *
 * Fill rule (see `pickForCompare`): first tap → slot 1, second tap →
 * slot 2, later taps replace slot 2 so slot 1 stays anchored.
 */
function CompareView({
  sessions,
  selected,
  resolveSelection,
  onPick,
  onClearSlot,
  onClearAll,
  pair,
  onFlip,
  onClose,
}: {
  sessions: PhysiqueSession[];
  selected: Selection[];
  resolveSelection: (sel: Selection) => HydratedPhoto | null;
  onPick: (entry: Selection) => void;
  onClearSlot: (index: number) => void;
  onClearAll: () => void;
  pair: [HydratedPhoto, HydratedPhoto] | null;
  onFlip: () => void;
  onClose: () => void;
}) {
  const first = selected[0] ?? null;
  const second = selected[1] ?? null;
  const firstPhoto = first ? resolveSelection(first) : null;
  const secondPhoto = second ? resolveSelection(second) : null;

  /** 1-based slot number for a board entry, or null when it is not on
   *  the board. Drives every "picked" badge in the picker. */
  function slotNumber(entry: Selection): number | null {
    if (first && sameSelection(first, entry)) return 1;
    if (second && sameSelection(second, entry)) return 2;
    return null;
  }

  const hint = pair
    ? 'Tap another photo below to swap the second one — slot 1 stays put.'
    : firstPhoto
      ? 'Now pick the photo you want to compare it against.'
      : 'Pick a photo below, then a second one to compare against.';
  const hasPhotos = sessions.length > 0;

  return (
    <div className="relative z-20 flex h-full w-full flex-col bg-zinc-950">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-400/80">
            Compare
          </div>
          <h2 className="mt-0.5 truncate text-lg font-bold tracking-tight text-zinc-100">
            {pair
              ? `${formatAlbumDate(pair[0].taken_at)} → ${formatAlbumDate(pair[1].taken_at)}`
              : 'Pick two photos'}
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selected.length > 0 && (
            <button
              onClick={onClearAll}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
            >
              Reset
            </button>
          )}
          <CloseX
            onClick={onClose}
            label="Close compare and return to the gallery"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6">
          {/* The two slots the user is filling. */}
          <div className="grid grid-cols-2 gap-3">
            <CompareSlot
              index={0}
              photo={firstPhoto}
              selection={first}
              onClear={() => onClearSlot(0)}
            />
            <CompareSlot
              index={1}
              photo={secondPhoto}
              selection={second}
              onClear={() => onClearSlot(1)}
            />
          </div>

          {/* Side-by-side, once both slots are filled. */}
          {pair ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                  Side by side
                </h3>
                <button
                  onClick={onFlip}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  ⇄ Flip order
                </button>
              </div>
              <PhysiqueComparison
                key={`${pair[0].id}:${pair[1].id}`}
                before={pair[0]}
                after={pair[1]}
                initialMode="split"
              />
            </section>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
              {!hasPhotos
                ? 'No photos yet — add a session from the gallery first.'
                : firstPhoto
                  ? 'Pick a second photo — the side-by-side view appears here.'
                  : 'Pick your first photo from the gallery below.'}
            </p>
          )}

          {/* Whole-session shortcuts (auto-resolved to the best pose). */}
          {sessions.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Compare whole sessions (best pose)
              </h3>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {sessions.map((s) => {
                  const entry: Selection = {
                    kind: 'session',
                    taken_at: s.taken_at,
                  };
                  const num = slotNumber(entry);
                  return (
                    <button
                      key={s.taken_at}
                      type="button"
                      onClick={() => onPick(entry)}
                      aria-pressed={Boolean(num)}
                      className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        num
                          ? 'border-rose-500 bg-rose-600 text-white'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                      }`}
                    >
                      <SlotBadge number={num} />
                      {s.title || formatAlbumDate(s.taken_at)}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Every gallery photo, grouped exactly like the library. */}
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              {hasPhotos ? 'Pick a photo from your gallery' : 'Your gallery is empty'}
            </h3>
            <div className="space-y-4">
              {sessions.map((s) => {
                const sessionNum = slotNumber({
                  kind: 'session',
                  taken_at: s.taken_at,
                });
                return (
                  <div
                    key={s.taken_at}
                    className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="truncate text-xs font-semibold text-zinc-200">
                        {s.title || formatAlbumDate(s.taken_at)}
                      </div>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {sessionNum
                          ? `Session in slot ${sessionNum}`
                          : `${s.count} photo${s.count === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                      {s.photos.map((p) => {
                        const entry: Selection = { kind: 'photo', id: p.id };
                        const num = slotNumber(entry);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => onPick(entry)}
                            aria-pressed={Boolean(num)}
                            aria-label={
                              num
                                ? `Remove ${p.pose_type ?? 'photo'} from slot ${num}`
                                : `Add ${p.pose_type ?? 'photo'} ${p.taken_at} to compare`
                            }
                            className={`relative h-24 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all sm:h-28 sm:w-24 ${
                              num
                                ? 'border-rose-500 ring-2 ring-rose-500/40'
                                : 'border-zinc-800 hover:border-zinc-600'
                            }`}
                          >
                            {p.url ? (
                              <GalleryImage
                                src={p.url}
                                alt={`${p.pose_type ?? 'Photo'} ${p.taken_at}`}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
                                …
                              </span>
                            )}
                            <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/85 to-transparent px-1.5 py-1 text-[9px] font-medium uppercase tracking-wider text-white/95">
                              {p.pose_type ?? 'Photo'}
                            </span>
                            {num && (
                              <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow">
                                {num}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * One of the two compare slots. Shows the resolved photo (a whole
 * session resolves to its representative "best pose") plus a ✕ that
 * re-opens that slot for picking.
 */
function CompareSlot({
  index,
  photo,
  selection,
  onClear,
}: {
  index: number;
  photo: HydratedPhoto | null;
  selection: Selection | null;
  onClear: () => void;
}) {
  const label = index === 0 ? 'First photo' : 'Second photo';
  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${
        photo
          ? 'border-rose-500/50 bg-zinc-900'
          : 'border-dashed border-zinc-700 bg-zinc-900/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-400">
          {label}
        </span>
        {photo && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear the ${label.toLowerCase()}`}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        )}
      </div>
      <div className="relative aspect-[3/4] w-full bg-black/40">
        {photo?.url ? (
          <GalleryImage
            src={photo.url}
            alt={`${label} — ${photo.taken_at}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-zinc-500">
            <CompareIcon size={18} />
            {index === 0 ? 'Tap a photo below' : 'Then a second one'}
          </span>
        )}
      </div>
      <div className="truncate px-3 py-2 text-[10px] text-zinc-400">
        {photo
          ? `${formatAlbumDate(photo.taken_at)} · ${photo.pose_type ?? 'Photo'}${
              selection?.kind === 'session' ? ' · session best pose' : ''
            }`
          : 'Empty'}
      </div>
    </div>
  );
}

/** Slot number chip for the picker; falls back to the compare glyph. */
function SlotBadge({ number }: { number: number | null }) {
  if (!number) return <CompareIcon size={12} />;
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[9px] font-bold">
      {number}
    </span>
  );
}

// ─── Misc small components ─────────────────────────────────────

/**
 * Comparison icon — two portrait frames side-by-side with opposing
 * compare arrows in the gap, mirroring the before/after slider.
 * Scales with `size`; inherits `currentColor` like every other inline
 * SVG in the codebase (the project has no icon library).
 */
function CompareIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Left photo frame */}
      <rect x="2" y="4" width="7.5" height="16" rx="1.5" />
      {/* Right photo frame */}
      <rect x="14.5" y="4" width="7.5" height="16" rx="1.5" />
      {/* Comparison arrows crossing the gap between frames */}
      <path d="M9.5 10.5h5" />
      <path d="M12.5 8.5l2 2-2 2" />
      <path d="M14.5 15.5h-5" />
      <path d="M11.5 13.5l-2 2 2 2" />
    </svg>
  );
}

/**
 * Gallery image with a skeleton placeholder. Renders a soft zinc
 * block (with the same aspect ratio as the tile) until the browser
 * has decoded the image, then crossfades the photo in — no more
 * "loading…" text or layout jank on slow mobile connections.
 *
 * `fetchpriority` stays default (low) so grid images never compete
 * with the page shell; `decoding="async"` keeps big JPEG decodes off
 * the main thread.
 */
function GalleryImage({
  src,
  alt,
  className = '',
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Load immediately (above-the-fold covers) instead of lazily. */
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="relative block h-full w-full">
      {!loaded && (
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse rounded-none bg-zinc-800/80"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className={`${className} transition-opacity duration-300 ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
    </span>
  );
}

/** Small tick used when a photo is already on the compare board. */
function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

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
      // Fixed layers position against the viewport, not the gallery shell,
      // so the header band has to be reserved here too — otherwise the
      // viewer's red X lands under the nav bar. The `+ 1rem` keeps the
      // original `p-4` breathing room at the top.
      style={{ paddingTop: `calc(${HEADER_OFFSET} + 1rem)` }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Red X pinned to the top-right of the photo. Closing it returns to
          the session's thumbnail grid (the album view underneath), not to
          the main gallery. `size="lg"` keeps it an easy thumb target. */}
      <CloseX
        size="lg"
        className="absolute right-4 z-10"
        style={{ top: BELOW_HEADER_INSET }}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        label="Close photo and return to the session"
      />
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
