/**
 * Physique photo CRUD + sessions.
 *
 * Schema: every photo is a row in `physique_photos`. **Sessions** are
 * a *derived* grouping — photos sharing the same `taken_at` for the
 * same `user_id` form a session. Notes, body weight, favourite
 * status, session title, and the chosen cover photo are denormalized
 * across the session's rows so editing the session is one UPDATE.
 *
 * Two-tier UX:
 *
 *   • Curation: every photo can be starred individually
 *     (`is_favourited` + `featured_at`). Star/unstar also works at
 *     the session level — applies to every photo on the date.
 *
 *   • Album library: sessions are presented like Spotify albums. The
 *     "cover" is either a user-pinned photo (`cover_photo_id`) or
 *     the first uploaded photo (`created_at` ASC fallback).
 *
 *   • Sessions: compare-by-session auto-resolves to a representative
 *     photo (preferred: front pose → back → side → other → first by
 *     `created_at`).
 */
import { supabase } from '@/lib/supabase';
import type { PhysiquePhoto, PhysiquePoseLabel } from './types';
import {
  deletePhysiquePhoto as deletePhotoObject,
  signedPhysiquePhotoUrl,
  uploadPhysiquePhoto,
} from './storage';
import { logEvent, EventTypes } from '@/lib/events';

export interface HydratedPhoto extends PhysiquePhoto {
  url: string | null;             // short-lived signed URL (or null while loading)
}

async function safeRun<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[fitness] ${label} exception:`, err);
    return fallback;
  }
}

/**
 * Structured failure shape returned by Supabase (PostgREST).
 * `code` is the SQLSTATE — see `coverErrorToUserMessage` for the
 * friendly mappings.
 */
export interface SupabaseFailure {
  message: string;
  /** SQLSTATE code, e.g. '42703' (column missing), 'PGRST0' (RLS 0-row). */
  code?: string;
  hint?: string;
  details?: string;
}

/**
 * Discriminated result returned by every write to `physique_photos`.
 * Lets the UI surface the *actual* failure mode (column missing,
 * RLS denial, FK violation, …) instead of just "false".
 */
export type SupabaseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: SupabaseFailure };

/**
 * Wrap a single Supabase operation so we capture `error.code`,
 * `error.hint`, and `error.details` (PostgREST surface) instead of
 * just `error.message`. The browser then maps these to a friendly
 * copy-pastable runbook.
 */
async function captureDb<T>(
  label: string,
  fn: () => PromiseLike<{
    data: T | null;
    error: { message: string; code?: string; hint?: string; details?: string } | null;
  }>,
): Promise<SupabaseResult<T>> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn(`[fitness] ${label} failure:`, error);
      return {
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details,
        },
      };
    }
    return { ok: true, data: (data ?? null) as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[fitness] ${label} exception:`, err);
    return { ok: false, error: { message } };
  }
}

/**
 * Friendly one-liner for a Supabase failure. Falls back to a
 * concatenation of message + hint so the user never sees a bare
 * SQLSTATE string.
 */
export function coverErrorToUserMessage(err: SupabaseFailure): string {
  // No SQLSTATE code — either our synthetic PGRST0 hint-only
  // failure or a thrown JS error. Render the most useful field we
  // have rather than falling through with an empty message.
  if (!err.code) {
    return err.hint ?? err.message ?? 'Save failed for an unknown reason.';
  }
  switch (err.code) {
    case '42703':
      return 'The `cover_photo_id` column does not exist on `physique_photos`. Run the fix migration (see the panel below) in Supabase SQL Editor, then refresh the page.';
    case 'PGRST0':
      // PGRST0 is our synthetic code synthesised when an UPDATE
      // silently affected 0 rows — usually an RLS denial.
      return (
        err.hint ??
        'Update affected 0 rows. Either the session has no photos, or Row Level Security silently denied the UPDATE.'
      );
    case '23503':
      return 'The selected cover photo no longer exists (it was deleted). Refresh the page and pick another.';
    case '42501':
      return 'Row Level Security denied the update. Re-run the fix migration to reset the policy.';
    default:
      return err.hint ? `${err.message} — ${err.hint}` : err.message;
  }
}

/**
 * List the user's photos. Default order is newest-first by
 * `taken_at`. Pass `favouritedOnly: true` to fetch only starred rows
 * (used by the Timeline). Pass `archiveSort: true` to keep starred
 * photos at the top when sorting the Gallery.
 */
export async function listPhysiquePhotos(
  userId: string | null,
  opts?: { favouritedOnly?: boolean; archiveSort?: boolean },
): Promise<HydratedPhoto[]> {
  if (!userId) return [];

  const rows = await safeRun('listPhysiquePhotos rows', async () => {
    let q = supabase
      .from('physique_photos')
      .select('*')
      .eq('user_id', userId);
    if (opts?.favouritedOnly) {
      q = q.eq('is_favourited', true);
    }
    // Starred-first when archiveSort: starred desc, then non-starred asc.
    if (opts?.archiveSort) {
      q = q
        .order('is_favourited', { ascending: false })
        .order('taken_at', { ascending: false });
    } else {
      q = q.order('taken_at', { ascending: false });
    }
    const { data, error } = await q;
    if (error) {
      console.warn('[fitness] listPhysiquePhotos query error:', error.message);
      return [];
    }
    return (data ?? []) as PhysiquePhoto[];
  }, []);

  // Sign URLs in parallel — each is independent.
  const hydrated = await Promise.all(
    rows.map(async (p) => ({
      ...p,
      url: await signedPhysiquePhotoUrl(p.photo_path, 3600),
    })),
  );
  return hydrated;
}

export interface CreatePhysiquePhotoInput {
  user_id: string;
  taken_at: string;                       // YYYY-MM-DD
  pose_type: PhysiquePoseLabel | null;
  photo_path: string;
  body_weight_kg?: number | null;
  notes?: string | null;
  is_favourited?: boolean;
}

export async function createPhysiquePhoto(
  input: CreatePhysiquePhotoInput,
): Promise<HydratedPhoto | null> {
  return safeRun('createPhysiquePhoto', async () => {
    const isFav = input.is_favourited === true;
    const { data, error } = await supabase
      .from('physique_photos')
      .insert({
        user_id: input.user_id,
        taken_at: input.taken_at,
        pose_type: input.pose_type ?? null,
        photo_path: input.photo_path,
        body_weight_kg: input.body_weight_kg ?? null,
        notes: input.notes ?? null,
        is_favourited: isFav,
        featured_at: isFav ? new Date().toISOString() : null,
      })
      .select('*')
      .single();
    if (error) {
      console.warn('[fitness] createPhysiquePhoto error:', error.message);
      return null;
    }
    const photo = data as PhysiquePhoto;
    const url = await signedPhysiquePhotoUrl(photo.photo_path, 3600);
    return { ...photo, url };
  }, null);
}

/**
 * Update an individual photo's pose label (Front / Side / Back /
 * Custom…). Used by the timeline session-expansion UI for inline
 * renaming.
 */
export async function updatePoseLabel(
  photoId: string,
  pose: PhysiquePoseLabel | null,
): Promise<boolean> {
  return safeRun('updatePoseLabel', async () => {
    const { error } = await supabase
      .from('physique_photos')
      .update({ pose_type: pose })
      .eq('id', photoId);
    if (error) {
      console.warn('[fitness] updatePoseLabel error:', error.message);
      return false;
    }
    return true;
  }, false);
}

/**
 * Update session-level metadata (notes and/or body weight). Applied
 * to ALL photos of the given date — sessions stay internally
 * consistent because users treat a single date as a single session.
 *
 * Pass `null` to clear a field. Only fields present in `patch` are
 * touched; passing an empty patch is a no-op.
 */
export async function updateSessionMetadata(
  userId: string,
  takenAt: string,
  patch: { notes?: string | null; body_weight_kg?: number | null },
): Promise<boolean> {
  if (!userId || !takenAt) return false;
  const ok = await safeRun('updateSessionMetadata', async () => {
    const update: Record<string, unknown> = {};
    if ('notes' in patch) update.notes = patch.notes ?? null;
    if ('body_weight_kg' in patch) {
      update.body_weight_kg =
        patch.body_weight_kg === null || patch.body_weight_kg === undefined
          ? null
          : patch.body_weight_kg;
    }
    if (Object.keys(update).length === 0) return true;
    const { error } = await supabase
      .from('physique_photos')
      .update(update)
      .eq('user_id', userId)
      .eq('taken_at', takenAt);
    if (error) {
      console.warn('[fitness] updateSessionMetadata error:', error.message);
      return false;
    }
    return true;
  }, false);
  if (ok) {
    void logEvent(EventTypes.SESSION_NOTES_EDITED, {
      user_id: userId,
      taken_at: takenAt,
      patch,
    });
  }
  return ok;
}

/**
 * Set or rename a session's album title. Pass `null` (or empty
 * string) to clear the title. Applied across every photo of the
 * session (denormalized).
 */
export async function setSessionTitle(
  userId: string,
  takenAt: string,
  title: string | null,
): Promise<boolean> {
  if (!userId || !takenAt) return false;
  const normalized = (title ?? '').trim() || null;
  const ok = await safeRun('setSessionTitle', async () => {
    const { error } = await supabase
      .from('physique_photos')
      .update({ session_title: normalized })
      .eq('user_id', userId)
      .eq('taken_at', takenAt);
    if (error) {
      console.warn('[fitness] setSessionTitle error:', error.message);
      return false;
    }
    return true;
  }, false);
  if (ok) {
    void logEvent(EventTypes.SESSION_TITLE_EDITED, {
      user_id: userId,
      taken_at: takenAt,
      title: normalized,
    });
  }
  return ok;
}

/**
 * Pin a specific photo as this session's album cover. Pass `null`
 * to clear the pin (UI then falls back to "first uploaded photo").
 *
 * Returns a `SupabaseResult` (not a bare boolean) so the UI can
 * surface the real failure — column missing (42703), RLS silently
 * denying the UPDATE (we detect this by appending `.select('id')`
 * and treating `data.length === 0` as a synthetic PGRST0 failure),
 * or a stale FK target (23503).
 */
export async function setSessionCover(
  userId: string,
  takenAt: string,
  coverPhotoId: string | null,
): Promise<SupabaseResult<{ rowCount: number }>> {
  if (!userId || !takenAt) {
    return {
      ok: false,
      error: { message: 'Missing user id or session date.' },
    };
  }
  const result = await captureDb(
    'setSessionCover',
    async () => {
      const { data, error } = await supabase
        .from('physique_photos')
        .update({ cover_photo_id: coverPhotoId })
        .eq('user_id', userId)
        .eq('taken_at', takenAt)
        .select('id');
      return { data, error };
    },
  );
  if (!result.ok) return result;

  // RLS UPDATE denials return success-but-zero-rows in PostgREST
  // (no error thrown, no 42501 surfaced). Detect by counting what
  // the .select() returned. The session must always have rows if
  // the user can see it in the UI, so 0 rows == RLS denial.
  const rowCount = result.data?.length ?? 0;
  if (rowCount === 0) {
    return {
      ok: false,
      error: {
        message: 'Update affected 0 rows.',
        code: 'PGRST0',
        hint:
          'Either the session has no photos, or Row Level Security is silently denying the UPDATE. Run `lib/supabase-physique-photos-fix-migration.sql` in the Supabase SQL Editor to reset the policy and reload.',
      },
    };
  }

  void logEvent(EventTypes.SESSION_COVER_CHANGED, {
    user_id: userId,
    taken_at: takenAt,
    cover_photo_id: coverPhotoId,
  });
  return { ok: true, data: { rowCount } };
}

/**
 * Compact, copy-pastable schema fix that the UI surfaces inside the
 * cover-pick error banner. Mirrors the file at
 * `lib/supabase-physique-photos-fix-migration.sql` — kept small so
 * the user can paste it without scrolling.
 *
 * IMPORTANT: this constant must stay in lock-step with the file.
 * The earlier version iterated `pg_policies` and issued multiple
 * `DROP POLICY IF EXISTS` calls in a loop, which deadlocked inside
 * Supabase's implicit transaction with SQLSTATE 40P01. This version
 * issues a single DROP for the canonical policy name and a single
 * CREATE — no DO block, no pg_policies scan, preserves every other
 * policy you may have defined.
 */
export const PHYSIQUE_PHOTOS_FIX_MIGRATION_SQL = [
  '-- ORION: deadlock-safe schema fix. Pastes top-to-bottom in Supabase → SQL Editor.',
  '-- The previous version of this script deadlocked (40P01) because it iterated pg_policies.',
  '-- This rewrite touches ONE well-known policy and leaves everything else alone.',
  'ALTER TABLE physique_photos ADD COLUMN IF NOT EXISTS session_title TEXT;',
  "ALTER TABLE physique_photos ADD COLUMN IF NOT EXISTS cover_photo_id UUID REFERENCES physique_photos(id) ON DELETE SET NULL;",
  "CREATE INDEX IF NOT EXISTS idx_physique_photos_cover ON physique_photos(user_id, cover_photo_id) WHERE cover_photo_id IS NOT NULL;",
  'ALTER TABLE physique_photos ENABLE ROW LEVEL SECURITY;',
  'DROP POLICY IF EXISTS "User owns physique photos" ON physique_photos;',
  'CREATE POLICY "User owns physique photos" ON physique_photos',
  '  FOR ALL TO authenticated',
  '  USING      (user_id = auth.uid())',
  '  WITH CHECK (user_id = auth.uid());',
].join('\n');

export const PHYSIQUE_PHOTOS_FIX_MIGRATION_PATH =
  'lib/supabase-physique-photos-fix-migration.sql';

/**
 * Star or unstar an entire session. Updates every photo on the date
 * to the same value and stamps `featured_at` consistently so the
 * dashboard hero pick has a stable tie-breaker.
 */
export async function setSessionFavourite(
  userId: string,
  takenAt: string,
  isFavourited: boolean,
): Promise<boolean> {
  if (!userId || !takenAt) return false;
  const ok = await safeRun('setSessionFavourite', async () => {
    const { error } = await supabase
      .from('physique_photos')
      .update({
        is_favourited: isFavourited,
        featured_at: isFavourited ? new Date().toISOString() : null,
      })
      .eq('user_id', userId)
      .eq('taken_at', takenAt);
    if (error) {
      console.warn('[fitness] setSessionFavourite error:', error.message);
      return false;
    }
    return true;
  }, false);
  if (ok) {
    void logEvent(
      isFavourited ? EventTypes.SESSION_FEATURED : EventTypes.SESSION_UNFEATURED,
      { user_id: userId, taken_at: takenAt },
    );
  }
  return ok;
}

/**
 * Toggle the favourited status of a single photo. Used by the
 * Gallery's per-photo star control; for whole-session starring use
 * `setSessionFavourite`.
 */
export async function togglePhysiqueFavourite(
  photoId: string,
  isFavourited: boolean,
): Promise<boolean> {
  const ok = await safeRun('togglePhysiqueFavourite', async () => {
    const { error } = await supabase
      .from('physique_photos')
      .update({
        is_favourited: isFavourited,
        featured_at: isFavourited ? new Date().toISOString() : null,
      })
      .eq('id', photoId);
    if (error) {
      console.warn('[fitness] togglePhysiqueFavourite error:', error.message);
      return false;
    }
    return true;
  }, false);
  if (ok) {
    void logEvent(
      isFavourited ? EventTypes.PHOTO_FEATURED : EventTypes.PHOTO_UNFEATURED,
      { photo_id: photoId },
    );
  }
  return ok;
}

/**
 * Delete a photo from storage AND its DB row. Used by the gallery
 * (per-photo delete) and the timeline (per-photo delete inside an
 * expanded session). For whole-session deletion, call this in a
 * loop over each photo.
 *
 * If the deleted photo is the session's cover, falls back to
 * `setSessionCover` with NULL so the gallery stops pointing at a
 * dead row.
 */
export async function deletePhysiquePhotoRecord(
  photo: PhysiquePhoto,
  userId: string,
): Promise<boolean> {
  // First clear any cover pointer that references this photo so we
  // don't leak dangling FK references on the denormalized rows.
  await safeRun('deletePhysiquePhotoRecord clear cover', async () => {
    const { error } = await supabase
      .from('physique_photos')
      .update({ cover_photo_id: null })
      .eq('user_id', userId)
      .eq('cover_photo_id', photo.id);
    if (error) {
      console.warn('[fitness] clear cover pointer error:', error.message);
    }
    return null;
  }, null);

  const ok = await deletePhotoObject(photo.photo_path);
  if (!ok) return false;
  const deleted = await safeRun('deletePhysiquePhotoRecord', async () => {
    const { error } = await supabase
      .from('physique_photos')
      .delete()
      .eq('id', photo.id);
    if (error) {
      console.warn('[fitness] deletePhysiquePhotoRecord error:', error.message);
      return false;
    }
    return true;
  }, false);
  if (deleted) {
    void logEvent(EventTypes.PHOTO_DELETED, { photo_id: photo.id });
  }
  return deleted;
}

/**
 * End-to-end: upload a file to storage, then insert the DB row.
 * Used by the upload flow (one call per picked photo); session-level
 * metadata is applied via `updateSessionMetadata` after the batch
 * completes.
 */
export interface UploadAndSaveInput {
  userId: string;
  file: File | Blob;
  taken_at: string;
  pose_type: PhysiquePoseLabel | null;
  body_weight_kg?: number | null;
  notes?: string | null;
  ext?: string;
  is_favourited?: boolean;
}

export async function uploadAndSavePhysiquePhoto(
  input: UploadAndSaveInput,
): Promise<HydratedPhoto | null> {
  const ext = input.ext ?? guessExtension(input.file) ?? 'jpg';
  const upload = await uploadPhysiquePhoto(input.userId, input.file, ext);
  if (!upload) return null;
  return createPhysiquePhoto({
    user_id: input.userId,
    taken_at: input.taken_at,
    pose_type: input.pose_type,
    photo_path: upload.path,
    body_weight_kg: input.body_weight_kg ?? null,
    notes: input.notes ?? null,
    is_favourited: input.is_favourited === true,
  });
}

/**
 * Latest Pinned Cover — the newest session whose user-set
 * `cover_photo_id` resolves to a still-existing photo on that date.
 *
 * Used by `PhysiqueProgress` to pick the "Latest Physique"
 * thumbnail so it ALWAYS matches the cover visible in the gallery's
 * album hero. Falls through to `pickFeaturedPhoto` (called as the
 * second-step fallback by the parent) when no session has a
 * custom pin yet.
 */
export function pickLatestPinnedCover(
  photos: HydratedPhoto[],
): HydratedPhoto | null {
  const sessions = groupPhotosIntoSessions(photos);
  for (const s of sessions) {
    if (s.cover_photo) return s.cover_photo;
  }
  return null;
}

/**
 * Pure optimistic-state helpers.
 *
 * Each returns the NEXT photos array the parent should set in
 * state, computed AS IF the operation succeeded. The caller is
 * responsible for: (1) snapshotting the previous photos (a closure
 * capture is fine), (2) calling the underlying Supabase lib,
 * (3) restoring the snapshot if the lib call returns failure.
 */
export function applyStarFlip(
  photos: HydratedPhoto[],
  userId: string,
  takenAt: string,
  next: boolean,
): HydratedPhoto[] {
  const now = new Date().toISOString();
  return photos.map((p) =>
    p.user_id === userId && p.taken_at === takenAt
      ? { ...p, is_favourited: next, featured_at: next ? now : null }
      : p,
  );
}

export function applyPoseLabel(
  photos: HydratedPhoto[],
  photoId: string,
  pose: PhysiquePoseLabel | null,
): HydratedPhoto[] {
  return photos.map((p) =>
    p.id === photoId ? { ...p, pose_type: pose } : p,
  );
}

export function applyCoverPin(
  photos: HydratedPhoto[],
  userId: string,
  takenAt: string,
  coverPhotoId: string | null,
): HydratedPhoto[] {
  return photos.map((p) =>
    p.user_id === userId && p.taken_at === takenAt
      ? { ...p, cover_photo_id: coverPhotoId }
      : p,
  );
}

export function applySessionText(
  photos: HydratedPhoto[],
  userId: string,
  takenAt: string,
  patch: { notes?: string | null; body_weight_kg?: number | null },
): HydratedPhoto[] {
  return photos.map((p) =>
    p.user_id === userId && p.taken_at === takenAt
      ? { ...p, ...patch }
      : p,
  );
}

export function applySessionTitle(
  photos: HydratedPhoto[],
  userId: string,
  takenAt: string,
  title: string | null,
): HydratedPhoto[] {
  return photos.map((p) =>
    p.user_id === userId && p.taken_at === takenAt
      ? { ...p, session_title: title }
      : p,
  );
}

export function applyDeletePhoto(
  photos: HydratedPhoto[],
  photoId: string,
): HydratedPhoto[] {
  return photos.filter((p) => p.id !== photoId);
}

/**
 * Dashboard hero pick rule:
 *
 *   1. Latest starred `front` pose.
 *   2. Otherwise the latest starred photo (any pose).
 *   3. Otherwise the most recent photo into storage.
 *
 * Pre-call this AFTER `pickLatestPinnedCover` so the hero shows
 * user-set album covers before falling through to "latest starred
 * front".
 */
export function pickFeaturedPhoto(
  photos: HydratedPhoto[],
): HydratedPhoto | null {
  if (photos.length === 0) return null;
  const starred = photos.filter((p) => p.is_favourited);
  if (starred.length > 0) {
    const front = starred.find(
      (p) => p.pose_type?.toLowerCase() === 'front',
    );
    return front ?? starred[0];
  }
  return photos[0] ?? null;
}

// ─── Sessions ────────────────────────────────────────────────────

/**
 * A progress session — every photo taken on the same `taken_at` for
 * one user. Derived (NOT a separate table). Notes, body weight,
 * favourite status, title, and cover photo are denormalized across
 * all photos of the date.
 */
export interface PhysiqueSession {
  user_id: string;
  /** YYYY-MM-DD — the session key. */
  taken_at: string;
  /** Sorted ascending by `created_at`. */
  photos: HydratedPhoto[];
  /** Denormalized across all session photos — read once per session. */
  notes: string | null;
  /** Denormalized across all session photos. */
  body_weight_kg: number | null;
  /** True iff every photo in the session is starred. */
  is_favourited: boolean;
  /** Latest `featured_at` of any session photo (tie-breaker for the dashboard hero). */
  featured_at: string | null;
  /** User-given album title (e.g. "Summer Bulk"). NULL = untitled. */
  title: string | null;
  /**
   * The session's chosen cover photo. Resolved from
   * `cover_photo_id` (user-pinned) with a deterministic fallback to
   * the first uploaded photo (created_at ASC) when none pinned.
   * Always populated as long as the session has any photos.
   */
  cover_photo: HydratedPhoto | null;
  /** Convenience count, equal to `photos.length`. */
  count: number;
}

/**
 * Group a flat list of photos into sessions, newest session first.
 * Assumes `taken_at` uses YYYY-MM-DD format.
 */
export function groupPhotosIntoSessions(photos: HydratedPhoto[]): PhysiqueSession[] {
  const byDate = new Map<string, HydratedPhoto[]>();
  for (const p of photos) {
    const arr = byDate.get(p.taken_at) ?? [];
    arr.push(p);
    byDate.set(p.taken_at, arr);
  }
  const sessions: PhysiqueSession[] = [];
  for (const [taken_at, list] of byDate) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) =>
      a.created_at < b.created_at ? -1 : 1,
    );
    const allFav = sorted.every((p) => p.is_favourited);
    const anyFeatured = sorted
      .map((p) => p.featured_at)
      .filter((f): f is string => Boolean(f))
      .sort()
      .pop() ?? null;

    // Cover resolution: prefer user-pinned (cover_photo_id), else
    // fall back to first uploaded (created_at ASC = the album's
    // first image). Both yield a fully hydrated row so the album
    // card can render its cover URL directly.
    const pinnedId = sorted[0]?.cover_photo_id ?? null;
    const cover_photo =
      (pinnedId ? sorted.find((p) => p.id === pinnedId) : null) ??
      sorted[0] ??
      null;

    sessions.push({
      user_id: sorted[0].user_id,
      taken_at,
      photos: sorted,
      notes: sorted[0].notes ?? null,
      body_weight_kg: sorted[0].body_weight_kg ?? null,
      is_favourited: allFav,
      featured_at: anyFeatured,
      title: sorted[0].session_title ?? null,
      cover_photo,
      count: sorted.length,
    });
  }
  return sessions.sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1));
}

/**
 * Pick a single representative photo for a session — used when the
 * user selects a session (rather than a single photo) for the
 * before/after slider.
 *
 *   1. Front pose if any photo has that label.
 *   2. Back.
 *   3. Side.
 *   4. Other.
 *   5. Earliest `created_at`.
 */
export function resolveSessionRepresentative(
  photos: HydratedPhoto[],
): HydratedPhoto | null {
  if (photos.length === 0) return null;
  const posePriority = ['front', 'back', 'side', 'other'];
  for (const target of posePriority) {
    const match = photos.find(
      (p) => p.pose_type?.toLowerCase() === target,
    );
    if (match) return match;
  }
  return [...photos].sort((a, b) =>
    a.created_at < b.created_at ? -1 : 1,
  )[0] ?? null;
}

function guessExtension(blob: File | Blob): string | null {
  if (blob instanceof File && blob.name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(blob.name);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
