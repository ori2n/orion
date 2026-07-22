'use client';

import { useEffect, useState, useRef } from 'react';
import type { HydratedPhoto } from '@/lib/fitness/physique';

/**
 * PhysiqueComparison — pair-wise physique photo comparison with
 * per-photo manual alignment.
 *
 * Modes (`mode` prop):
 *   - `slider` — draggable before/after split (default).
 *     Keyboard: ←/→ adjusts split.
 *   - `split`  — side-by-side panels.
 *
 * Per-photo alignment (`Alignment` `{ zoom, panX, panY }`):
 *   Each photo carries its own transform so the user can manually
 *   nudge ONE image (e.g. lift the head or shift the hips) without
 *   dragging the other. The default for every photo
 *   `{ zoom: 1, panX: 0, panY: 0 }` is the "auto-aligned" baseline.
 *
 *   Persisted under `localStorage` key `physique:align:<photoId>` so
 *   the user does not have to redo the alignment every time the same
 *   photo appears in a comparison.
 *
 * Target selector (`target`):
 *   - `both`   — controls write the same transform to both photos
 *     (linked, identical alignment). Default.
 *   - `before` — controls write to the BEFORE photo only.
 *   - `after`  — controls write to the AFTER photo only.
 *
 * Move mode (`moveMode`):
 *   When ON, pointer-drag inside the comparison area pans the
 *   targeted photo(s) by the drag delta. When OFF (default),
 *   pointer-drag controls the slider divider (slider mode only).
 */
type Mode = 'slider' | 'split';
type Target = 'both' | 'before' | 'after';

interface Alignment {
  zoom: number;
  panX: number;
  panY: number;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;
const PAN_STEP = 16; // px per nudge-button press
const PAN_LIMIT = 320; // px of pan before clamping (lifted from 200 for body-shift room)
const KEY_PAN_STEP = 24;
const ZOOM_STEP = 0.1;
const DEFAULT_ALIGNMENT: Alignment = { zoom: 1, panX: 0, panY: 0 };
const STORAGE_PREFIX = 'physique:align:';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function clampZoom(a: Alignment): Alignment {
  return { ...a, zoom: clamp(a.zoom, ZOOM_MIN, ZOOM_MAX) };
}
function clampPan(a: Alignment): Alignment {
  return {
    ...a,
    panX: clamp(a.panX, -PAN_LIMIT, PAN_LIMIT),
    panY: clamp(a.panY, -PAN_LIMIT, PAN_LIMIT),
  };
}
function clampAlign(a: Alignment): Alignment {
  return clampPan(clampZoom(a));
}
function isDefault(a: Alignment): boolean {
  return (
    Math.abs(a.zoom - DEFAULT_ALIGNMENT.zoom) < 0.001 &&
    a.panX === DEFAULT_ALIGNMENT.panX &&
    a.panY === DEFAULT_ALIGNMENT.panY
  );
}

/** Read a per-photo alignment override from localStorage. Falls back
 *  to the auto-aligned default if no override exists or storage is
 *  unavailable (private mode / quota errors / SSR). */
function loadAlign(photoId: string): Alignment {
  if (typeof window === 'undefined') return DEFAULT_ALIGNMENT;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + photoId);
    if (!raw) return DEFAULT_ALIGNMENT;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_ALIGNMENT;
    return clampAlign({
      zoom: Number(parsed.zoom) || DEFAULT_ALIGNMENT.zoom,
      panX: Number(parsed.panX) || 0,
      panY: Number(parsed.panY) || 0,
    });
  } catch {
    return DEFAULT_ALIGNMENT;
  }
}

/** Persist a per-photo alignment override. Silent failure on quota /
 *  private-mode errors is acceptable — the in-memory state still
 *  works for the current session. */
function saveAlign(photoId: string, align: Alignment): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + photoId,
      JSON.stringify(align),
    );
  } catch {
    // ignore — quota / disabled storage / SSR
  }
}

export default function PhysiqueComparison({
  before,
  after,
  initialMode = 'slider',
}: {
  before: HydratedPhoto;
  after: HydratedPhoto;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [target, setTarget] = useState<Target>('both');
  /** When true, pointer-drag inside the comparison area pans the
   *  targeted photo(s). When false (default), pointer-drag acts as
   *  the slider-divider control in slider mode. */
  const [moveMode, setMoveMode] = useState(false);
  const [split, setSplit] = useState(50); // % from left when mode === 'slider'

  // Per-photo alignment. Loaded from storage on mount and whenever
  // the photo pair changes.
  const [beforeAlign, setBeforeAlign] = useState<Alignment>(() =>
    loadAlign(before.id),
  );
  const [afterAlign, setAfterAlign] = useState<Alignment>(() =>
    loadAlign(after.id),
  );

  // Reset alignment AND slider split whenever the photo pair
  // changes — switching sessions can mean very different body heights
  // and pose labels, so centring on the new pair avoids carrying
  // stale offsets or a randomly-positioned divider between
  // comparisons. Reset target to 'both' so the comparison starts in
  // linked mode for the fresh pair.
  useEffect(() => {
    setBeforeAlign(loadAlign(before.id));
    setAfterAlign(loadAlign(after.id));
    setSplit(50);
    setTarget('both');
    setMoveMode(false);
  }, [before.id, after.id]);

  // Persist each photo's alignment whenever it changes. Writes are
  // debounced (~150 ms) so rapid drag-pan motion doesn't slam
  // localStorage with a synchronous write per `pointermove` event
  // (which would block the main thread). The final unmount flush
  // guarantees the latest values still reach storage even if the
  // user closes the comparison mid-debounce. Tracking the LATEST
  // pending values via refs means we never drop a write — we just
  // coalesce a burst into a single disk hit.
  const beforeAlignRef = useRef(beforeAlign);
  const afterAlignRef = useRef(afterAlign);
  beforeAlignRef.current = beforeAlign;
  afterAlignRef.current = afterAlign;
  useEffect(() => {
    const t = window.setTimeout(
      () => saveAlign(before.id, beforeAlign),
      150,
    );
    return () => window.clearTimeout(t);
  }, [before.id, beforeAlign]);
  useEffect(() => {
    const t = window.setTimeout(() => saveAlign(after.id, afterAlign), 150);
    return () => window.clearTimeout(t);
  }, [after.id, afterAlign]);
  useEffect(() => {
    // Final flush on unmount so a debounced write that hasn't
    // fired yet still lands.
    return () => {
      saveAlign(before.id, beforeAlignRef.current);
      saveAlign(after.id, afterAlignRef.current);
    };
  }, []);

  /** Apply a partial alignment update to the targeted photo(s).
   *
   *  - `before` / `after` Sets that single photo to the new
   *    absolute values.
   *  - `both`: compute the *delta* from `beforeAlign`'s current
   *    values and apply the same delta (pan X/Y additive, zoom
   *    multiplicative via ratio) to BOTH photos. This preserves
   *    any per-photo offset the user has already dialled in
   *    instead of snapping the after photo to whatever before
   *    currently is. */
  function applyToTarget(updates: Partial<Alignment>) {
    if (target === 'before') {
      setBeforeAlign((a) => clampAlign({ ...a, ...updates }));
      return;
    }
    if (target === 'after') {
      setAfterAlign((a) => clampAlign({ ...a, ...updates }));
      return;
    }
    // target === 'both': apply the delta to both photos.
    const before = beforeAlign;
    const after = afterAlign;
    const nextBefore = clampAlign({ ...before, ...updates });
    const dx = nextBefore.panX - before.panX;
    const dy = nextBefore.panY - before.panY;
    const zoomFactor =
      before.zoom > 0 ? nextBefore.zoom / before.zoom : 1;
    setBeforeAlign(nextBefore);
    setAfterAlign(
      clampAlign({
        ...after,
        panX: after.panX + dx,
        panY: after.panY + dy,
        zoom: after.zoom * zoomFactor,
      }),
    );
  }

  /** Key-pan helpers — operate on the targeted photo's current value
   *  + an explicit delta. Used for keyboard arrow keys so the nudge
   *  accumulates against the targeted photo's existing pan even when
   *  the two photos are intentionally diverged. */
  const keyPanX = (delta: number) => {
    const cur = target === 'after' ? afterAlign.panX : beforeAlign.panX;
    applyToTarget({ panX: cur + delta });
  };
  const keyPanY = (delta: number) => {
    const cur = target === 'after' ? afterAlign.panY : beforeAlign.panY;
    applyToTarget({ panY: cur + delta });
  };

  const setZoom = (zoom: number) => applyToTarget({ zoom });
  const nudgePanX = (delta: number) => keyPanX(delta);
  const nudgePanY = (delta: number) => keyPanY(delta);
  const resetTarget = () => applyToTarget(DEFAULT_ALIGNMENT);

  // Body-keyboard shortcuts work without focusing the comparison.
  // ←/→ move the divider in slider mode; ↑/↓ nudge Y; ←/→ while in
  // side-by-side mode nudge X; +/- zoom; 0 resets the active target.
  // `used` is gated so only handled keys consume the event — page
  // scroll / tab movements remain intact on unmapped keys.
  //
  // The dependency is `[mode, target]` so the listener re-binds
  // when the user toggles modes or switches which photo is being
  // edited; otherwise the captured closures would target stale state.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      let used = true;
      switch (e.key) {
        case 'ArrowLeft':
          if (mode === 'slider') {
            setSplit((s) => Math.max(0, s - 5));
          } else {
            keyPanX(-KEY_PAN_STEP);
          }
          break;
        case 'ArrowRight':
          if (mode === 'slider') {
            setSplit((s) => Math.min(100, s + 5));
          } else {
            keyPanX(KEY_PAN_STEP);
          }
          break;
        case 'ArrowUp':
          keyPanY(KEY_PAN_STEP);
          break;
        case 'ArrowDown':
          keyPanY(-KEY_PAN_STEP);
          break;
        case '+':
        case '=':
          setZoom(Math.min(ZOOM_MAX, getActiveZoom() + ZOOM_STEP));
          break;
        case '-':
        case '_':
          setZoom(Math.max(ZOOM_MIN, getActiveZoom() - ZOOM_STEP));
          break;
        case '0':
          resetTarget();
          break;
        default:
          used = false;
      }
      if (used) e.preventDefault();
    }
    function getActiveZoom(): number {
      return target === 'after' ? afterAlign.zoom : beforeAlign.zoom;
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, target, beforeAlign, afterAlign]);

  return (
    <div className="flex w-full flex-col items-stretch gap-3">
      {/* Mode toggle sits above the comparison area. */}
      <div className="flex items-center justify-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1 backdrop-blur">
        <ModeChip
          active={mode === 'slider'}
          onClick={() => setMode('slider')}
          label="Slider"
          icon="⇔"
        />
        <ModeChip
          active={mode === 'split'}
          onClick={() => setMode('split')}
          label="Side-by-side"
          icon="▮▮"
        />
      </div>

      {/* Image area */}
      {mode === 'slider' ? (
        <SliderStage
          before={before}
          after={after}
          beforeAlign={beforeAlign}
          afterAlign={afterAlign}
          target={target}
          moveMode={moveMode}
          split={split}
          onSplitChange={setSplit}
          onPanTarget={(dx, dy) => {
            if (target === 'before') {
              setBeforeAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
            } else if (target === 'after') {
              setAfterAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
            } else {
              setBeforeAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
              setAfterAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
            }
          }}
        />
      ) : (
        <SplitStage
          before={before}
          after={after}
          beforeAlign={beforeAlign}
          afterAlign={afterAlign}
          target={target}
          moveMode={moveMode}
          onPanTarget={(dx, dy) => {
            if (target === 'before') {
              setBeforeAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
            } else if (target === 'after') {
              setAfterAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
            } else {
              setBeforeAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
              setAfterAlign((a) =>
                clampPan({ ...a, panX: a.panX + dx, panY: a.panY + dy }),
              );
            }
          }}
        />
      )}

      {/* Alignment controls */}
      <AlignmentPanel
        target={target}
        setTarget={setTarget}
        moveMode={moveMode}
        setMoveMode={setMoveMode}
        effectiveAlign={
          target === 'after' ? afterAlign : beforeAlign
        }
        onZoom={setZoom}
        onNudgeX={nudgePanX}
        onNudgeY={nudgePanY}
        onReset={resetTarget}
      />
    </div>
  );
}

// ─── Stage components ────────────────────────────────────────────

interface StagePanProps {
  before: HydratedPhoto;
  after: HydratedPhoto;
  beforeAlign: Alignment;
  afterAlign: Alignment;
  target: Target;
  moveMode: boolean;
  onPanTarget: (dx: number, dy: number) => void;
}

function SliderStage({
  before,
  after,
  beforeAlign,
  afterAlign,
  target,
  moveMode,
  split,
  onSplitChange,
  onPanTarget,
}: StagePanProps & {
  split: number;
  onSplitChange: (n: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);
  const dragKind = useRef<'divider' | 'pan' | null>(null);
  const lastPos = useRef({ x: 0, y: 0 });

  function handleDown(e: React.PointerEvent) {
    if (moveMode) {
      dragKind.current = 'pan';
      lastPos.current = { x: e.clientX, y: e.clientY };
    } else {
      dragKind.current = 'divider';
      isDragging.current = true;
    }
    containerRef.current?.setPointerCapture(e.pointerId);
  }
  function handleUp(e: React.PointerEvent) {
    isDragging.current = false;
    dragKind.current = null;
    containerRef.current?.releasePointerCapture(e.pointerId);
  }
  function handleMove(e: React.PointerEvent) {
    if (!containerRef.current) return;
    if (dragKind.current === 'divider') {
      if (!isDragging.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onSplitChange(pct);
    } else if (dragKind.current === 'pan') {
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      onPanTarget(dx, dy);
    }
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerMove={handleMove}
      onPointerCancel={handleUp}
      tabIndex={0}
      className={`relative aspect-[4/5] w-full select-none overflow-hidden rounded-xl border border-zinc-800 bg-black focus:outline-none focus:ring-2 focus:ring-rose-500/40 sm:aspect-[4/3] ${
        moveMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-ew-resize'
      }`}
      role="slider"
      aria-label="Before / after slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      aria-valuetext={`${Math.round(split)}% toward After · ${
        moveMode ? 'drag to pan' : 'drag to divide'
      }`}
    >
      {/* After (background wrapper — no clip, no transform). */}
      <div
        className={`absolute inset-0 ${selectedOverlay(target, 'after', moveMode)}`}
        aria-hidden
      >
        <AlignedImage photo={after} align={afterAlign} />
      </div>
      {/* Before (clipped wrapper — clip stays in screen space while the
          child image is transformed underneath). */}
      <div
        className={`absolute inset-0 ${selectedOverlay(target, 'before', moveMode)}`}
        style={{
          clipPath: `polygon(0 0, ${split}% 0, ${split}% 100%, 0 100%)`,
        }}
        aria-hidden
      >
        <AlignedImage photo={before} align={beforeAlign} />
      </div>
      {/* Divider line + handle. Hidden in pan mode so the user has a
          clean canvas for photo-drag. */}
      {!moveMode && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
            style={{ left: `${split}%`, transform: 'translateX(-50%)' }}
          />
          <div
            className="pointer-events-none absolute top-1/2 z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-black/60 text-white shadow-lg"
            style={{ left: `${split}%` }}
          >
            <span className="text-base leading-none">⇔</span>
          </div>
        </>
      )}
      {/* Date labels. */}
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
        Before · {before.taken_at}
      </div>
      <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
        After · {after.taken_at}
      </div>
      {/* Move-mode badge so the user knows drag will pan, not divide. */}
      {moveMode && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-rose-600/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white shadow"
        >
          ⋖ drag to pan {target === 'both' ? 'both' : target} ⋗
        </div>
      )}
    </div>
  );
}

function SplitStage({
  before,
  after,
  beforeAlign,
  afterAlign,
  target,
  moveMode,
  onPanTarget,
}: StagePanProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const dragging = useRef(false);

  function handleDown(e: React.PointerEvent) {
    if (!moveMode) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    containerRef.current?.setPointerCapture(e.pointerId);
  }
  function handleUp(e: React.PointerEvent) {
    dragging.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  }
  function handleMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    onPanTarget(dx, dy);
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerMove={handleMove}
      onPointerCancel={handleUp}
      className={`relative aspect-[4/5] w-full select-none overflow-hidden rounded-xl border border-zinc-800 bg-black sm:aspect-[4/3] ${
        moveMode ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
    >
      <div className="grid h-full w-full grid-cols-2">
        <div
          className={`relative h-full overflow-hidden border-r border-zinc-800 ${selectedRing(target, 'before', moveMode)}`}
        >
          <AlignedImage photo={before} align={beforeAlign} />
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            Before · {before.taken_at}
          </div>
        </div>
        <div
          className={`relative h-full overflow-hidden ${selectedRing(target, 'after', moveMode)}`}
        >
          <AlignedImage photo={after} align={afterAlign} />
          <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white">
            After · {after.taken_at}
          </div>
        </div>
      </div>
      {moveMode && (
        <div
          className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full bg-rose-600/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white shadow"
        >
          ⋖ drag to pan {target === 'both' ? 'both' : target} ⋗
        </div>
      )}
    </div>
  );
}

/**
 * Visual indicator for which side of a slider the user's pointer hit
 * — a faint rose glow around the targeted photo. Gated on `moveMode`
 * so the affordance never claims drag-on-photo behaviour that isn't
 * actually wired up yet (when moveMode is OFF, drag still moves the
 * slider divider in slider mode).
 */
function selectedOverlay(
  target: Target,
  which: 'before' | 'after',
  moveMode: boolean,
): string {
  if (target === 'both' || !moveMode) return '';
  return target === which ? 'ring-2 ring-rose-500/40 ring-inset' : '';
}

/**
 * Side-by-side ring analogue of `selectedOverlay` — applies a thin
 * rose ring around the targeted photo's panel so the user sees which
 * side the controls are acting on.
 */
function selectedRing(
  target: Target,
  which: 'before' | 'after',
  moveMode: boolean,
): string {
  if (target === 'both' || !moveMode) return '';
  return target === which ? 'ring-2 ring-inset ring-rose-500/40' : '';
}

/**
 * AlignedImage — renders a physique photo with its own transform.
 *
 * Each photo gets its OWN alignment (not shared) so the user can
 * independently nudge one without dragging the other. The transform
 * order is `translate(...) scale(...)` with `transform-origin: center
 * bottom`, keeping the feet anchored so zooming grows toward the head.
 */
function AlignedImage({
  photo,
  align,
}: {
  photo: HydratedPhoto;
  align: Alignment;
}) {
  if (!photo.url) return null;
  const { zoom, panX, panY } = align;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt={`${photo.pose_type ?? 'Physique'} ${photo.taken_at}`}
      className="absolute inset-0 h-full w-full object-cover"
      draggable={false}
      style={{
        transformOrigin: 'center bottom',
        transition: 'transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
      }}
    />
  );
}

// ─── Alignment control panel ─────────────────────────────────────

function AlignmentPanel({
  target,
  setTarget,
  moveMode,
  setMoveMode,
  effectiveAlign,
  onZoom,
  onNudgeX,
  onNudgeY,
  onReset,
}: {
  target: Target;
  setTarget: (t: Target) => void;
  moveMode: boolean;
  setMoveMode: (b: boolean) => void;
  effectiveAlign: Alignment;
  onZoom: (n: number) => void;
  onNudgeX: (delta: number) => void;
  onNudgeY: (delta: number) => void;
  onReset: () => void;
}) {
  const zoomPct = Math.round(effectiveAlign.zoom * 100);
  const isAligned = isDefault(effectiveAlign);
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/45 p-3 text-xs text-zinc-200 backdrop-blur"
      role="group"
      aria-label="Photo alignment"
    >
      {/* Target selector + move-mode toggle row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            Align
          </span>
          <TargetChip
            active={target === 'both'}
            onClick={() => setTarget('both')}
            label="Both"
          />
          <TargetChip
            active={target === 'before'}
            onClick={() => setTarget('before')}
            label="Before"
          />
          <TargetChip
            active={target === 'after'}
            onClick={() => setTarget('after')}
            label="After"
          />
        </div>
        <label className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/80 px-2 py-1 text-[11px] font-medium text-zinc-300"
          title="Drag inside the comparison to pan the active photo."
        >
          <input
            type="checkbox"
            checked={moveMode}
            onChange={(e) => setMoveMode(e.target.checked)}
            className="h-3 w-3 cursor-pointer accent-rose-500"
            aria-label="Enable drag-to-pan"
          />
          Drag to pan
        </label>
      </div>

      {/* Zoom slider */}
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
          Zoom
        </span>
        <input
          type="range"
          min={ZOOM_MIN * 100}
          max={ZOOM_MAX * 100}
          step={5}
          value={Math.round(effectiveAlign.zoom * 100)}
          onChange={(e) => onZoom(Number(e.target.value) / 100)}
          aria-label="Zoom active photo"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-700 accent-rose-500"
          style={{
            background: `linear-gradient(to right, rgb(244 63 94) 0%, rgb(244 63 94) ${
              ((effectiveAlign.zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100
            }%, rgb(63 63 70) ${
              ((effectiveAlign.zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100
            }%, rgb(63 63 70) 100%)`,
          }}
        />
        <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-300">
          {zoomPct}%
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
          Pan X
        </span>
        <div className="flex items-center gap-1">
          <NudgeButton onClick={() => onNudgeX(-PAN_STEP)} label="Pan left" symbol="←" />
          <NudgeButton onClick={() => onNudgeX(PAN_STEP)} label="Pan right" symbol="→" />
        </div>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400">
          {effectiveAlign.panX > 0 ? '+' : ''}
          {effectiveAlign.panX}px
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-zinc-500">
          Pan Y
        </span>
        <div className="flex items-center gap-1">
          <NudgeButton onClick={() => onNudgeY(PAN_STEP)} label="Pan up" symbol="↑" />
          <NudgeButton onClick={() => onNudgeY(-PAN_STEP)} label="Pan down" symbol="↓" />
        </div>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-400">
          {effectiveAlign.panY > 0 ? '+' : ''}
          {effectiveAlign.panY}px
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {!isAligned && (
          <span className="rounded-full border border-rose-500/40 bg-rose-950/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-rose-300">
            Custom alignment
          </span>
        )}
        <button
          type="button"
          onClick={onReset}
          disabled={isAligned}
          className="ml-auto rounded-md border border-zinc-700 bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          title={`Reset ${target} alignment to auto`}
        >
          ↺ Reset
        </button>
      </div>

      <p className="mt-1 text-[10px] text-zinc-500">
        Tip: ←/→ move the divider (slider mode), ↑/↓ and +/− fine-tune
        alignment, 0 resets the active photo. Toggle <em>Drag to pan</em> to
        re-pose by hand.
      </p>
    </div>
  );
}

function NudgeButton({
  onClick,
  label,
  symbol,
}: {
  onClick: () => void;
  label: string;
  symbol: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800 active:scale-95"
    >
      {symbol}
    </button>
  );
}

function TargetChip({
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-all ${
        active
          ? 'bg-rose-500 text-white shadow-sm'
          : 'border border-zinc-700 bg-zinc-900/70 text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}

function ModeChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
        active
          ? 'bg-zinc-100 text-zinc-900 shadow-sm'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <span aria-hidden className="text-sm">
        {icon}
      </span>
      {label}
    </button>
  );
}
