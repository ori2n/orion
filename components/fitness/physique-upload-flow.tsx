'use client';

import { useEffect, useRef, useState } from 'react';
import {
  uploadAndSavePhysiquePhoto,
  updateSessionMetadata,
  setSessionFavourite,
} from '@/lib/fitness/physique';
import { logEvent, EventTypes } from '@/lib/events';

/**
 * PhysiqueUploadFlow — session-first upload flow.
 *
 * UX (per user spec):
 *   1. Click "Add Progress" → modal opens.
 *   2. Pick MULTIPLE photos in one go (native file picker, multi).
 *   3. Optional session notes (one textarea for the whole session).
 *   4. Save.
 *
 * Pose labels (Front / Side / Back / …) are intentionally SKIPPED at
 * upload time — labels are optional and editable from the timeline's
 * expanded session view or the gallery's full-screen viewer. This
 * keeps the upload under 30 seconds.
 *
 * Each picked photo becomes its own row in `physique_photos`,
 * sharing the same `taken_at`. After all uploads complete we run one
 * `updateSessionMetadata` call so any session-level data (notes,
 * body weight) is applied to *every* photo of the date — including
 * pre-existing photos that the user is adding to. Pre-existing
 * favourites are preserved: the upload only writes
 * `is_favourited: featured` per-photo on the brand new rows.
 */
export default function PhysiqueUploadFlow({
  userId,
  onSaved,
  onError,
  onCancel,
}: {
  userId: string;
  onSaved: () => void;
  onError: (msg: string) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  type Pick = { file: File; previewUrl: string };
  const [batch, setBatch] = useState<Pick[]>([]);
  const [takenAt, setTakenAt] = useState(todayISO());
  const [bodyWeight, setBodyWeight] = useState('');
  const [notes, setNotes] = useState('');
  const [featured, setFeatured] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Ref-tracked set of every preview URL we ever minted, so unmount
  // cleanup sees them all even if `batch` changes.
  const urlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const row of batch) urlsRef.current.add(row.previewUrl);
  }, [batch]);
  useEffect(
    () => () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current.clear();
    },
    [],
  );

  function handleFiles(picked: File[]) {
    if (picked.length === 0) return;
    setBatch((prev) => [
      ...prev,
      ...picked.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeRow(idx: number) {
    setBatch((prev) => {
      const drop = prev[idx];
      if (drop) URL.revokeObjectURL(drop.previewUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function handleSubmit() {
    if (batch.length === 0) return;
    setUploading(true);
    let succeeded = 0;
    let lastErr: string | null = null;

    // Insert all new photos in parallel — pose_type is null at this
    // point; the user can label them later from the timeline or
    // gallery viewer.
    await Promise.all(
      batch.map(async (row) => {
        const created = await uploadAndSavePhysiquePhoto({
          userId,
          file: row.file,
          taken_at: takenAt,
          pose_type: null,
          body_weight_kg: null,
          notes: null,
          is_favourited: featured,
        });
        if (created) succeeded += 1;
        else lastErr = row.file.name;
      }),
    );

    // Apply session-level fields AFTER the uploads land. We only
    // touch fields the user actually set so pre-existing session
    // notes / body weight / favourites are preserved.
    const sessionNotes = notes.trim() || null;
    const sessionBw =
      bodyWeight.trim() && !Number.isNaN(parseFloat(bodyWeight))
        ? parseFloat(bodyWeight)
        : null;
    if (sessionNotes !== null || sessionBw !== null) {
      await updateSessionMetadata(userId, takenAt, {
        // Only include keys that have a value to write; the helper
        // itself ignores unset ones.
        ...(sessionNotes !== null ? { notes: sessionNotes } : {}),
        ...(sessionBw !== null ? { body_weight_kg: sessionBw } : {}),
      });
    }

    // If the user opted into "Feature this session", flip ALL photos
    // on this date to favourited (including pre-existing ones) so
    // the session's is_favourited derivation stays consistent and the
    // timeline surfaces the session. Pre-existing starred photos are
    // preserved when the toggle is OFF — the upload is purely
    // additive in that case.
    if (featured) {
      await setSessionFavourite(userId, takenAt, true);
    }

    setUploading(false);

    if (succeeded === 0) {
      onError(
        `Failed to upload ${lastErr ? `“${lastErr}”` : 'all photos'}. Check your connection and try again.`,
      );
      return;
    }

    void logEvent(EventTypes.SESSION_CREATED, {
      user_id: userId,
      taken_at: takenAt,
      photo_count: succeeded,
      photo_total: batch.length,
      is_favourited: featured,
      has_notes: sessionNotes !== null,
      has_body_weight: sessionBw !== null,
    });

    if (lastErr) {
      onError(`Uploaded ${succeeded}/${batch.length} — “${lastErr}” failed.`);
    }
    setBatch([]);
    if (fileRef.current) fileRef.current.value = '';
    onSaved();
  }

  const hasPhotos = batch.length > 0;

  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-4">
      {/* Session metadata row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,1fr,auto]">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Session date
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
            Body weight (kg, optional)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min={0}
            value={bodyWeight}
            onChange={(e) => setBodyWeight(e.target.value)}
            placeholder="e.g. 82.4"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-zinc-500 focus:outline-none"
          />
        </div>
        <div className="flex items-end">
          <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-medium text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/60 sm:w-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add photos
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
            />
          </label>
        </div>
      </div>

      {/* Photo chips */}
      {hasPhotos && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            <span>{batch.length} photo{batch.length === 1 ? '' : 's'} ready</span>
            <button
              onClick={() => {
                // Clean removal — revoke each URL and reset batch.
                for (const row of batch) URL.revokeObjectURL(row.previewUrl);
                setBatch([]);
                if (fileRef.current) fileRef.current.value = '';
              }}
              className="text-[10px] font-medium normal-case tracking-normal text-zinc-500 hover:text-zinc-300"
            >
              Clear all
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {batch.map((row, idx) => (
              <div
                key={`${row.file.name}-${idx}`}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-zinc-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={row.previewUrl}
                  alt={row.file.name}
                  className="h-full w-full object-cover"
                />
                <button
                  onClick={() => removeRow(idx)}
                  title="Remove"
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[10px] font-medium text-white hover:bg-red-600"
                  aria-label={`Remove ${row.file.name}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optional session notes */}
      {hasPhotos && (
        <div className="mt-4">
          <label className="mb-1 block text-[10px] uppercase tracking-[0.15em] text-zinc-500">
            Notes for this session (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. After deload week, lighting was better. Front + side + back."
            rows={2}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-500 focus:outline-none"
          />
        </div>
      )}

      {/* Session feature toggle */}
      {hasPhotos && (
        <button
          type="button"
          onClick={() => setFeatured((f) => !f)}
          className={`mt-3 flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-xs font-medium transition-colors ${
            featured
              ? 'border-rose-500/60 bg-rose-950/30 text-rose-300'
              : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
          }`}
          title="Feature this session in your progress timeline"
          aria-pressed={featured}
        >
          <span aria-hidden>{featured ? '★' : '☆'}</span>
          {featured
            ? 'Will feature in timeline'
            : 'Feature this session in timeline'}
        </button>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
        <button
          onClick={onCancel}
          disabled={uploading}
          className="text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={uploading || batch.length === 0}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-40"
        >
          {uploading
            ? 'Uploading…'
            : `Save progress · ${batch.length} photo${batch.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
