/**
 * Storage helpers for the private `physique-photos` Supabase Storage
 * bucket. All object keys are namespaced under the user's auth.uid so
 * the RLS policy can scope access cleanly.
 */
import { supabase } from '@/lib/supabase';

const BUCKET = 'physique-photos';

/** Upload one photo blob. Returns `{ path }` on success. */
export async function uploadPhysiquePhoto(
  userId: string,
  file: File | Blob,
  ext = 'jpg',
): Promise<{ path: string } | null> {
  if (!userId) return null;
  // Random object id — collision-safe across the user namespace.
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${userId}/${id}.${ext}`;

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (error) {
      console.warn('[fitness] uploadPhysiquePhoto error:', error.message);
      return null;
    }
    return { path };
  } catch (err) {
    console.warn('[fitness] uploadPhysiquePhoto exception:', err);
    return null;
  }
}

/** Mint a short-lived signed URL the browser can use to render the image. */
export async function signedPhysiquePhotoUrl(
  path: string,
  expiresInSec = 3600,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expiresInSec);
    if (error) {
      console.warn('[fitness] signedPhysiquePhotoUrl error:', error.message);
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (err) {
    console.warn('[fitness] signedPhysiquePhotoUrl exception:', err);
    return null;
  }
}

/** Delete one photo object. */
export async function deletePhysiquePhoto(path: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) {
      console.warn('[fitness] deletePhysiquePhoto error:', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
