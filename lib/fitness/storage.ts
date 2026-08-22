/**
 * Storage helpers for the private `physique-photos` Supabase Storage
 * bucket. All object keys are namespaced under the user's auth.uid so
 * the RLS policy can scope access cleanly.
 */
import { supabase } from '@/lib/supabase';

const BUCKET = 'physique-photos';

/**
 * Signed URLs live for 7 days (Supabase's max). The UI re-hydrates on
 * every load, but a phone PWA can be restored from a suspended state
 * hours later — a 1-hour token would already be dead by then, showing
 * broken images until a manual refresh.
 */
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 604800

/**
 * Uploads come straight off a phone camera / screenshots: 12MP JPEGs
 * and 7.5 MB PNGs. A mobile browser can be slow to download those and
 * can even fail to decode them. Downscale client-side before upload so
 * the stored object is always display-friendly. The original is never
 * kept — photos are for on-device viewing, not archival.
 */
const MAX_UPLOAD_DIMENSION = 1600;
const UPLOAD_JPEG_QUALITY = 0.85;

/**
 * Downscale an image blob in the browser. Returns the same blob when
 * it is already small enough or cannot be decoded — never throws, so
 * an exotic file type (e.g. HEIC on a browser without HEIC support)
 * still uploads as-is instead of failing.
 */
export async function resizeImageBlob(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await decodeImage(blob);
    try {
      const scale = Math.min(
        1,
        MAX_UPLOAD_DIMENSION / Math.max(bitmap.width, bitmap.height),
      );
      if (scale >= 1) return blob;

      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return blob;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', UPLOAD_JPEG_QUALITY),
      );
      return out ?? blob;
    } finally {
      if ('close' in bitmap) bitmap.close();
    }
  } catch {
    return blob;
  }
}

/** Decode a blob into an ImageBitmap (preferred) or an <img>. */
async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // fall through to the <img> path (older browsers / odd encodings)
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/** Upload one photo blob. Returns `{ path }` on success. */
export async function uploadPhysiquePhoto(
  userId: string,
  file: File | Blob,
  ext = 'jpg',
): Promise<{ path: string } | null> {
  if (!userId) return null;

  // Downscale before upload so phones never store 12MP / 7.5MB files.
  const resized = await resizeImageBlob(file);
  const resizedExt = resized === file ? ext : 'jpg';

  // Random object id — collision-safe across the user namespace.
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `${userId}/${id}.${resizedExt}`;

  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, resized, {
      cacheControl: '3600',
      upsert: false,
      contentType: resizedExt === 'jpg' ? 'image/jpeg' : undefined,
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

/**
 * Mint a short-lived signed URL the browser can use to render the image.
 *
 * We intentionally do NOT pass a storage transform here: this project's
 * storage server ignores the transform on `createSignedUrl` (verified
 * live — it returns an unscaled URL). Sizes are instead handled at
 * upload time (`resizeImageBlob`), so the stored object is already
 * display-friendly.
 */
export async function signedPhysiquePhotoUrl(
  path: string,
  expiresInSec = SIGNED_URL_TTL_SECONDS,
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

/**
 * Mint signed URLs for many photos in ONE storage API call
 * (`createSignedUrls`), instead of one round-trip per photo. The
 * gallery/timeline hydrate dozens of photos — signing each separately
 * was dozens of serial-ish network requests per page load.
 */
export async function signedPhysiquePhotoUrls(
  paths: string[],
  expiresInSec = SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string | null>> {
  if (paths.length === 0) return new Map();
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(paths, expiresInSec);
    if (error) {
      console.warn('[fitness] signedPhysiquePhotoUrls error:', error.message);
      return new Map();
    }
    const byPath = new Map<string, string | null>();
    for (const item of data ?? []) {
      if (item.path) {
        byPath.set(item.path, item.error ? null : (item.signedUrl ?? null));
      }
    }
    return byPath;
  } catch (err) {
    console.warn('[fitness] signedPhysiquePhotoUrls exception:', err);
    return new Map();
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
