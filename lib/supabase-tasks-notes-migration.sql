-- ============================================================
-- MIGRATION: Add optional notes column to the tasks table
-- ============================================================
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- if your `tasks` table already exists without the `notes` column.
-- Safe to re-run.
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT;
