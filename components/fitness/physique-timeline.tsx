'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  groupPhotosIntoSessions,
  type HydratedPhoto,
  type PhysiqueSession,
} from '@/lib/fitness/physique';

/**
 * PhysiqueTimeline — vertical 2×3 photo grid showing the album covers
 * of the LATEST 6 progress sessions (oldest of the six at the top,
 * freshest at the bottom-right of the 2×3 grid).
 *
 * Each cell is `aspect-[3/4]` portrait so the photos aren't cropped
 * top/bottom (the "trim width rather than height" preference for
 * portrait physique photos). Click a cell to open the matching session
 * in the gallery via the parent's `onOpenSessionInGallery(takenAt)`
 * callback. The `highlightedDate` prop still gives the dashboard's
 * Latest hero a scroll + 2.2 s rose-ring pulse on the matching cell.
 */

const LATEST_COUNT = 6;

// Animated rose‑ring pulse, used for the highlight effect.
// Module‑scoped so it's allocated once, not per render.
const PULSE_CSS = `@keyframes highlight-pulse { 0% { box-shadow: 0 0 0 0 rgba(244,63,94,0.45); } 60% { box-shadow: 0 0 0 10px rgba(244,63,94,0); } 100% { box-shadow: 0 0 0 0 rgba(244,63,94,0); } } .highlight-pulse { animation: highlight-pulse 2.2s ease-out 1; border-color: rgb(244 63 94) !important; }`;

export default function PhysiqueTimeline({
  photos,
  highlightedDate,
  onHighlightConsumed,
  onOpenSessionInGallery,
}: {
  photos: HydratedPhoto[];
  /**
   * Optional controlled prop — the matching cover cell is scrolled
   * into view AND pulsed with a rose ring for ~2.2 s. Consumed by the
   * parent via `onHighlightConsumed` so each click only fires the
   * highlight once.
   */
  highlightedDate?: string | null;
  /**
   * Fired once after the timeline has applied the `highlightedDate`
   * value, so the parent can clear its own copy.
   */
  onHighlightConsumed?: () => void;
  /** Open the matching session in the gallery. */
  onOpenSessionInGallery?: (takenAt: string) => void;
}) {
  // Latest six sessions, most‑recent rendered FIRST (top of grid) so
  // the freshest progress is always the most prominent spot.
  const sessions = useMemo(
    () =>
      [...groupPhotosIntoSessions(photos)]
        .slice(0, LATEST_COUNT)
        .filter(
          (s): s is PhysiqueSession & { cover_photo: HydratedPhoto } =>
            Boolean(s.cover_photo),
        ),
    [photos],
  );

  // Tile refs — keyed by session `taken_at`. The LatestCard deep
  // link uses this map to scroll the matching cell into view.
  const tileRefs = useRef<Map<string, HTMLElement>>(new Map());
  const makeSetTileRef = useCallback(
    (takenAt: string) => (el: HTMLElement | null) => {
      if (el) tileRefs.current.set(takenAt, el);
      else tileRefs.current.delete(takenAt);
    },
    [],
  );
  // Drop ref entries for sessions that no longer exist (deleted,
  // filtered) so the map never accumulates stale DOM nodes.
  useEffect(() => {
    const live = new Set(sessions.map((s) => s.taken_at));
    for (const key of [...tileRefs.current.keys()]) {
      if (!live.has(key)) tileRefs.current.delete(key);
    }
  }, [sessions]);

  // Apply external (parent‑driven) highlight requests. Mirrors
  // the contract documented on the props: only re‑apply when the
  // prop transitions to a NEW value, never bounce back from null.
  const lastPropRef = useRef<string | null | undefined>(highlightedDate);
  const consumedRef = useRef<(() => void) | undefined>(onHighlightConsumed);
  consumedRef.current = onHighlightConsumed;
  useEffect(() => {
    if (highlightedDate && highlightedDate !== lastPropRef.current) {
      const tile = tileRefs.current.get(highlightedDate);
      if (tile) {
        tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      consumedRef.current?.();
    }
    lastPropRef.current = highlightedDate;
  }, [highlightedDate]);

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-12 text-center text-xs text-zinc-500">
        Add progress photos — your latest six will appear here.
      </div>
    );
  }

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: PULSE_CSS }} />
      <div
        className="grid grid-cols-2 gap-px"
        aria-label={`Latest ${sessions.length} progress ${sessions.length === 1 ? 'session' : 'sessions'}`}
      >
        {sessions.map((session) => (
          <PhotoCell
            key={session.taken_at}
            session={session}
            isHighlighted={highlightedDate === session.taken_at}
            tileRef={makeSetTileRef(session.taken_at)}
            onOpenGallery={onOpenSessionInGallery}
          />
        ))}
      </div>
    </div>
  );
}

// ─── PhotoCell ─────────────────────────────────────────────────

function PhotoCell({
  session,
  isHighlighted,
  tileRef,
  onOpenGallery,
}: {
  session: PhysiqueSession & { cover_photo: HydratedPhoto };
  isHighlighted: boolean;
  tileRef: (el: HTMLElement | null) => void;
  onOpenGallery?: (takenAt: string) => void;
}) {
  // Locally‑driven highlight so the rose‑ring pulse completes even
  // if the parent clears `highlightedDate` immediately after
  // consuming it.
  const [localHighlight, setLocalHighlight] = useState(false);
  useEffect(() => {
    if (!isHighlighted) return;
    setLocalHighlight(true);
    const t = window.setTimeout(() => setLocalHighlight(false), 2300);
    return () => window.clearTimeout(t);
  }, [isHighlighted]);

  const cover = session.cover_photo;

  return (
    <button
      ref={tileRef}
      type="button"
      onClick={() => onOpenGallery?.(session.taken_at)}
      aria-label={`Open ${session.taken_at} session in gallery`}
      className={`group/photo relative block aspect-square w-full overflow-hidden rounded-xl border bg-black focus:outline-none focus:ring-2 focus:ring-rose-500/40 ${
        localHighlight
          ? 'highlight-pulse border-rose-500'
          : 'border-zinc-800 hover:border-zinc-600'
      }`}
    >
      {cover?.url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={cover.url}
          alt={`Latest progress session — ${session.taken_at}`}
          className="absolute inset-0 object-cover transition-transform duration-300 ease-out group-hover/photo:scale-[1.04]"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
          …
        </div>
      )}
    </button>
  );
}
