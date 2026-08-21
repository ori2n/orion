-- ============================================================
-- MIGRATION: Make task day/date optional
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- so tasks can be created without a day. Undated tasks keep a
-- NULL scheduled_for and are classified as "Upcoming".
-- ============================================================

ALTER TABLE tasks ALTER COLUMN scheduled_for DROP NOT NULL;
