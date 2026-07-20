'use client';

import { useState, useRef } from 'react';
import type { HydratedPhoto } from '@/lib/fitness/physique';

/**
 * PhysiqueComparison — draggable before/after slider for any two
 * physique photos. Used inside the Gallery's compare overlay.
 *
 * Pure presentation: caller owns which two `HydratedPhoto` rows are
 * passed in. The slider is fully keyboard-accessible via the
 * container's `role="slider"` and supports pointer drag.
 */
export default function PhysiqueComparison({
  before,
  after,
}: {
  before: HydratedPhoto;
  after: HydratedPhoto;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useState(50); // % from the left
  const isDragging = useRef(false);

  function handleDown(e: React.PointerEvent) {
    isDragging.current = true;
    containerRef.current?.setPointerCapture(e.pointerId);
  }
  function handleUp(e: React.PointerEvent) {
    isDragging.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  }
  function handleMove(e: React.PointerEvent) {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSplit(pct);
  }
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSplit((s) => Math.max(0, s - 5));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSplit((s) => Math.min(100, s + 5));
    }
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerMove={handleMove}
      onPointerCancel={handleUp}
      onKeyDown={handleKey}
      tabIndex={0}
      className="relative aspect-[4/5] w-full cursor-ew-resize select-none overflow-hidden rounded-xl border border-zinc-800 bg-black focus:outline-none focus:ring-2 focus:ring-rose-500/40 sm:aspect-[4/3]"
      role="slider"
      aria-label="Before / after slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(split)}
      aria-valuetext={`${Math.round(split)}% toward After`}
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
        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]"
        style={{ left: `${split}%`, transform: 'translateX(-50%)' }}
      />
      <div
        className="pointer-events-none absolute top-1/2 z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white/80 bg-black/60 text-white shadow-lg"
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
