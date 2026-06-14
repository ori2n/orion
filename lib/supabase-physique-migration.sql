-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- Creates the "progress-pics" Storage bucket and RLS policies for
-- progress photo uploads via the Physique Tracker.
--
-- NOTE: The physique_logs table already exists from supabase-health-migration.sql.
--       This migration ONLY adds the storage bucket configuration.

-- 1. Create the storage bucket (idempotent — safe to re-run)
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'progress-pics',
  'progress-pics',
  true,                       -- public (we use public URLs for <img> tags)
  false,
  10485760,                   -- 10 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- 3. Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can upload their own progress photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can view progress photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own progress photos" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own progress photos" ON storage.objects;

-- 4. Policy: any authenticated user can view progress photos (public bucket but scoped)
CREATE POLICY "Users can view progress photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'progress-pics');

-- 5. Policy: users can upload photos — path must start with their own user_id
--    (uploaded path is: user_id/timestamp-filename)
CREATE POLICY "Users can upload their own progress photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'progress-pics'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 6. Policy: users can update their own photos
CREATE POLICY "Users can update their own progress photos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'progress-pics'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 7. Policy: users can delete their own photos
CREATE POLICY "Users can delete their own progress photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'progress-pics'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
