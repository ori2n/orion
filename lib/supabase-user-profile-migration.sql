-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- Adds a user_profiles table for storing shared user settings like birth_date.

-- 1. User profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID DEFAULT auth.uid() PRIMARY KEY,
  birth_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 3. Drop old policies before creating new ones
DROP POLICY IF EXISTS "User owns profile" ON user_profiles;

-- 4. RLS policy — each user can only access their own profile
CREATE POLICY "User owns profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
