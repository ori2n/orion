/**
 * Physique photo CRUD — wraps the private bucket helper with the
 * DB row management for `physique_photos`.
 */
import { supabase } from '@/lib/supabase';
import type { PhysiquePhoto, PhysiquePose } from './types';
import {
  deletePhysiquePhoto as deletePhotoObject,
  signedPhysiquePhotoUrl,
  uploadPhysiquePhoto,
} from './storage';

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

export async function listPhysiquePhotos(
  userId: string | null,
): Promise<HydratedPhoto[]> {
  if (!userId) return [];
  const rows = await safeRun('listPhysiquePhotos rows', async () => {
    const { data, error } = await supabase
      .from('physique_photos')
      .select('*')
      .eq('user_id', userId)
      .order('taken_at', { ascending: false });
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

export async function createPhysiquePhoto(input: {
  user_id: string;
  taken_at: string;                       // YYYY-MM-DD
  pose_type: PhysiquePose | null;
  photo_path: string;
  body_weight_kg?: number | null;
  notes?: string | null;
}): Promise<HydratedPhoto | null> {
  return safeRun('createPhysiquePhoto', async () => {
    const { data, error } = await supabase
      .from('physique_photos')
      .insert({
        user_id: input.user_id,
        taken_at: input.taken_at,
        pose_type: input.pose_type ?? null,
        photo_path: input.photo_path,
        body_weight_kg: input.body_weight_kg ?? null,
        notes: input.notes ?? null,
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

export async function deletePhysiquePhotoRecord(photo: PhysiquePhoto): Promise<boolean> {
  const ok = await deletePhotoObject(photo.photo_path);
  if (!ok) return false;
  return safeRun('deletePhysiquePhotoRecord', async () => {
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
}

export async function uploadAndSavePhysiquePhoto(input: {
  userId: string;
  file: File | Blob;
  taken_at: string;
  pose_type: PhysiquePose | null;
  body_weight_kg?: number | null;
  notes?: string | null;
  ext?: string;
}): Promise<HydratedPhoto | null> {
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
  });
}

function guessExtension(blob: File | Blob): string | null {
  if (blob instanceof File && blob.name) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(blob.name);
    if (m) return m[1].toLowerCase();
  }
  return null;
}
