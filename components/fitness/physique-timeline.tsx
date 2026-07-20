'use client';

import { useMemo, useState } from 'react';
import {
  setSessionFavourite,
  setSessionTitle,
  updateSessionMetadata,
  updatePoseLabel,
  deletePhysiquePhotoRecord,
  groupPhotosIntoSessions,
  resolveSessionRepresentative,
  applyStarFlip,
  applyPoseLabel,
  applySessionText,
  applySessionTitle,
  applyDeletePhoto,
  type HydratedPhoto,
  type PhysiqueSession,
} from '@/lib/fitness/physique';
import { logEvent, EventTypes } from '@/lib/events';

/**
 * PhysiqueTimeline — Apple-Photos-meets-Spotify horizontal strip +
 * inline session-detail panel.
 *
 * Layout:
 *   1. **Horizontal scroll strip** of session tiles. Each tile
 *      shows the session's resolved cover photo (user-set
 *      `cover_photo_id` or first-uploaded fallback), date pill,
 *      favorite indicator, photo count. Pull sideways to scroll.
 *   2. **Inline session-detail panel** that appears BELOW the
 *      strip the moment a tile is clicked. Holds the per-photo
 *      grid with the existing label editor + delete affordances.
 *
 * The component owns NO photos state — `photos` is fully
 * controlled by the parent (`PhysiqueProgress`). Mutations call
 * `onPhotosChanged(updater)` to apply optimistic state changes,
 * then await the underlying Supabase lib; on failure the parent
 * reverts and shows a toast via `showToast(text)`.
 */
export default function PhysiqueTimeline({
  photos,
  onPhotosChanged,
  showToast,
}: {
  photos: HydratedPhoto[];
  /** Apply a pure function to the parent's photos array (the parent is the source of truth). */
  onPhotosChanged: (updater: (prev: HydratedPhoto[]) => HydratedPhoto[]) => void;
  /** Surface a one-liner failure message in the parent's toast slot. */
  showToast: (text: string) => void;
}) {
  const sessions = useMemo(() => groupPhotosIntoSessions(photos), [photos]);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  const expandedSession = expandedDate
    ? sessions.find((s) => s.taken_at === expandedDate) ?? null
    : null;

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-xs text-zinc-500">
        No progress sessions yet — open the Gallery and tap ★ on a
        session to feature it here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Horizontal strip — scroll-buddy hides scrollbar but keeps touch + keyboard support */}
      <div className="-mx-6 overflow-x-auto px-6 [scrollbar-width:thin] [scrollbar-color:rgba(63,63,70,0.4)_transparent]">
        <div className="flex gap-3 pb-1">
          {sessions.map((s) => (
            <SessionTile
              key={s.taken_at}
              session={s}
              isExpanded={expandedDate === s.taken_at}
              onClick={() =>
                setExpandedDate((prev) =>
                  prev === s.taken_at ? null : s.taken_at,
                )
              }
            />
          ))}
        </div>
      </div>

      {expandedSession && (
        <SessionDetail
          session={expandedSession}
          photos={photos}
          onClose={() => setExpandedDate(null)}
          onPhotosChanged={onPhotosChanged}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Session tile (horizontal strip card) ────────────────────────

function SessionTile({
  session,
  isExpanded,
  onClick,
}: {
  session: PhysiqueSession;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const cover = session.cover_photo;
  const displayLabel = session.title || formatTimelineDate(session.taken_at);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={isExpanded}
      aria-label={`Session ${displayLabel}`}
      className={`group flex w-[120px] shrink-0 cursor-pointer flex-col rounded-lg border bg-zinc-900/40 p-2 text-left transition-all duration-200 ease-out hover:scale-[1.02] ${
        isExpanded
          ? 'border-rose-500/60 shadow-lg shadow-rose-900/30 ring-1 ring-rose-500/40'
          : 'border-zinc-800/70 hover:border-zinc-600'
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
        {cover?.url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={cover.url}
            alt={displayLabel}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
            loading…
          </div>
        )}
        {/* Featured indicator dot */}
        {session.is_favourited && (
          <div className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-md">
            ★
          </div>
        )}
        {/* Tap-to-expand affordance — fades in on hover */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="text-[9px] font-medium uppercase tracking-wider text-white/90">
            {isExpanded ? 'Tap to close' : 'Tap to expand'}
          </span>
        </div>
      </div>
      <div className="mt-1.5 truncate text-[10px] font-medium text-zinc-300">
        {displayLabel}
      </div>
      <div className="text-[9px] text-zinc-500">
        {session.count} photo{session.count === 1 ? '' : 's'}
      </div>
    </button>
  );
}

// ─── Session detail panel (expanded tile) ────────────────────────

function SessionDetail({
  session,
  photos,
  onClose,
  onPhotosChanged,
  showToast,
}: {
  session: PhysiqueSession;
  photos: HydratedPhoto[];
  onClose: () => void;
  onPhotosChanged: (updater: (prev: HydratedPhoto[]) => HydratedPhoto[]) => void;
  showToast: (text: string) => void;
}) {
  const [editingNotes, setEditingNotes] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Optimistic helpers — wrap the parent setter so each handler can
  // snapshot-then-revert uniformly.
  function optimistically(
    optimistic: (prev: HydratedPhoto[]) => HydratedPhoto[],
    asyncFn: () => Promise<boolean>,
    failureText: string,
  ): Promise<boolean> {
    let before: HydratedPhoto[] | null = null;
    onPhotosChanged((prev) => {
      before = prev;
      return optimistic(prev);
    });
    return asyncFn().then((ok) => {
      if (!ok) {
        if (before) onPhotosChanged(() => before!);
        showToast(failureText);
      }
      return ok;
    });
  }

  async function handleFeature() {
    setBusy('feature');
    await optimistically(
      (prev) => applyStarFlip(prev, session.user_id, session.taken_at, !session.is_favourited),
      () => setSessionFavourite(session.user_id, session.taken_at, !session.is_favourited),
      'Could not update the featured flag. Refresh and try again.',
    );
    setBusy(null);
  }

  async function handleTitleSave(value: string) {
    const normalized = value.trim() || null;
    if (normalized === (session.title ?? null)) {
      setEditingTitle(false);
      return;
    }
    setBusy('title');
    await optimistically(
      (prev) => applySessionTitle(prev, session.user_id, session.taken_at, normalized),
      () => setSessionTitle(session.user_id, session.taken_at, value),
      'Could not save the album title.',
    );
    setBusy(null);
    setEditingTitle(false);
  }

  async function handleNotesSave(value: string) {
    const normalized = value.trim() || null;
    if (normalized === (session.notes ?? null)) {
      setEditingNotes(false);
      return;
    }
    setBusy('notes');
    await optimistically(
      (prev) => applySessionText(prev, session.user_id, session.taken_at, { notes: normalized }),
      () =>
        updateSessionMetadata(session.user_id, session.taken_at, {
          notes: value.trim() || null,
        }),
      'Could not save the notes.',
    );
    setBusy(null);
    setEditingNotes(false);
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete your entire progress session on ${formatTimelineDate(session.taken_at)}? This cannot be undone.`,
      )
    )
      return;
    setBusy('delete');
    const before = photos;
    // Optimistic mass-remove
    onPhotosChanged((prev) =>
      prev.filter(
        (p) => !(p.user_id === session.user_id && p.taken_at === session.taken_at),
      ),
    );
    onClose();
    const allOk = await Promise.all(
      session.photos.map((p) =>
        deletePhysiquePhotoRecord(p, session.user_id),
      ),
    ).then((results) => results.every(Boolean));
    if (!allOk) {
      onPhotosChanged(() => before as HydratedPhoto[]);
      showToast('Some photos failed to delete. Refresh to see the current state.');
    }
    setBusy(null);
  }

  async function handleDeletePhoto(photoId: string) {
    const photo = session.photos.find((p) => p.id === photoId);
    if (!photo) return;
    if (!confirm('Delete this photo? It will be removed from storage.')) return;
    setBusy(photoId);
    await optimistically(
      (prev) => applyDeletePhoto(prev, photoId),
      () => deletePhysiquePhotoRecord(photo, session.user_id),
      'Could not delete the photo.',
    );
    setBusy(null);
  }

  async function handleLabelChange(photoId: string, value: string) {
    const normalized = value.trim() || null;
    const photo = session.photos.find((p) => p.id === photoId);
    if (!photo || normalized === (photo.pose_type ?? null)) return;
    setBusy(photoId);
    await optimistically(
      (prev) => applyPoseLabel(prev, photoId, normalized),
      () => updatePoseLabel(photoId, normalized),
      'Could not save the pose label.',
    );
    setBusy(null);
  }

  return (
    <article
      className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-3"
      aria-label={`Session ${formatTimelineDate(session.taken_at)} detail`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-500">
            {formatTimelineDate(session.taken_at)}
          </div>
          {editingTitle ? (
            <TitleEditor
              initial={session.title ?? ''}
              busy={busy === 'title'}
              onSave={handleTitleSave}
              onCancel={() => setEditingTitle(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="mt-0.5 line-clamp-1 max-w-full text-left text-sm font-semibold text-zinc-100 hover:text-white"
            >
              {session.title || (
                <span className="italic text-zinc-500">Untitled session</span>
              )}
            </button>
          )}
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-600">
            <span className={session.is_favourited ? 'text-rose-400/80' : ''}>
              {session.is_favourited ? '⭐ Featured' : 'Not featured'}
            </span>
            <span>·</span>
            <span>
              {session.count} photo{session.count === 1 ? '' : 's'}
            </span>
            {session.body_weight_kg && (
              <>
                <span>·</span>
                <span>{session.body_weight_kg}kg</span>
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={handleFeature}
            disabled={busy !== null}
            className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              session.is_favourited
                ? 'border-rose-500/60 bg-rose-950/30 text-rose-300 hover:bg-rose-950/50'
                : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            } disabled:opacity-40`}
          >
            <span aria-hidden>{session.is_favourited ? '★' : '☆'}</span>
          </button>
          <button
            onClick={() => setEditingNotes((s) => !s)}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
          >
            {editingNotes ? 'Close' : 'Edit notes'}
          </button>
          <button
            onClick={handleDelete}
            disabled={busy !== null}
            className="rounded-md border border-red-700/40 px-2.5 py-1 text-[11px] font-medium text-red-300 hover:bg-red-950/40 disabled:opacity-40"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>

      {/* Notes editor / preview */}
      {editingNotes ? (
        <NotesEditor
          initial={session.notes ?? ''}
          busy={busy === 'notes'}
          onSave={handleNotesSave}
          onCancel={() => setEditingNotes(false)}
        />
      ) : session.notes ? (
        <p className="mt-2 text-[11px] italic leading-relaxed text-zinc-400">
          “{session.notes}”
        </p>
      ) : null}

      {/* Photo grid + per-photo actions */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {session.photos.map((p) => (
          <PhotoTile
            key={p.id}
            photo={p}
            busy={busy === p.id}
            onDelete={() => handleDeletePhoto(p.id)}
            onLabelCommit={(v) => handleLabelChange(p.id, v)}
          />
        ))}
      </div>
    </article>
  );
}

// ─── In-place editors ────────────────────────────────────────────

function TitleEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (v: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void onSave(value);
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={() => void onSave(value)}
      placeholder="e.g. Summer Bulk"
      disabled={busy}
      className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm font-semibold text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-40"
    />
  );
}

function NotesEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (v: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Notes for this session…"
        rows={2}
        disabled={busy}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 focus:border-zinc-500 focus:outline-none disabled:opacity-40"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          onClick={() => void onSave(value)}
          disabled={busy}
          className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-500 disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  busy,
  onDelete,
  onLabelCommit,
}: {
  photo: HydratedPhoto;
  busy: boolean;
  onDelete: () => Promise<void> | void;
  onLabelCommit: (value: string) => Promise<void> | void;
}) {
  const [labelDraft, setLabelDraft] = useState<string | null>(null);
  const [customValue, setCustomValue] = useState('');
  const [editing, setEditing] = useState(false);

  const label = photo.pose_type ?? '';
  const presetPoses = ['front', 'back', 'side', 'other'];
  const isCustomPose = label !== '' && !presetPoses.includes(label.toLowerCase());
  const wantCustomInput = labelDraft === '__custom__';

  function closeEditor() {
    setEditing(false);
    setLabelDraft(null);
    setCustomValue('');
  }

  function commit(value: string) {
    closeEditor();
    void onLabelCommit(value);
  }

  return (
    <div className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900">
      {photo.url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={photo.url}
          alt={`Physique ${photo.taken_at}${label ? ` (${label})` : ''}`}
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
          {label || 'Photo'}
        </span>
        {photo.body_weight_kg && (
          <span className="text-[10px] text-white/70">
            {photo.body_weight_kg}kg
          </span>
        )}
      </div>

      {editing ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-black/85 p-2">
          {isCustomPose ? (
            <input
              key={`edit-custom-${label}`}
              autoFocus
              defaultValue={customValue === '' ? label : customValue}
              maxLength={32}
              onChange={(e) => setCustomValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit((e.target as HTMLInputElement).value);
                }
              }}
              onBlur={(e) => commit(e.target.value)}
              placeholder="e.g. relaxed"
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
            />
          ) : (
            <>
              <select
                autoFocus
                value={labelDraft ?? label}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__custom__') {
                    setLabelDraft('__custom__');
                    setCustomValue('');
                    return;
                  }
                  commit(v);
                }}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
              >
                <option value="">Unlabeled</option>
                <option value="front">Front</option>
                <option value="back">Back</option>
                <option value="side">Side</option>
                <option value="other">Other</option>
                <option value="__custom__">Custom…</option>
              </select>
              {wantCustomInput && (
                <input
                  autoFocus
                  value={customValue}
                  maxLength={32}
                  onChange={(e) => setCustomValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(customValue);
                  }}
                  placeholder="e.g. relaxed"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 focus:outline-none"
                />
              )}
            </>
          )}
          <button
            onClick={closeEditor}
            className="text-[10px] text-zinc-400 hover:text-zinc-200"
          >
            Close
          </button>
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-x-1 top-1 flex items-center justify-between gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCustomValue(isCustomPose ? label : '');
              setEditing(true);
            }}
            disabled={busy}
            className="pointer-events-auto rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          >
            {label || 'Label'}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void onDelete();
            }}
            disabled={busy}
            className="pointer-events-auto rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-600 hover:text-white disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Date format helper ──────────────────────────────────────────

function formatTimelineDate(date: string): string {
  const dt = new Date(date + 'T00:00:00');
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// (useMemo is imported above)
