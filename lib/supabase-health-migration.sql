-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- Health Dashboard tables — stores RAW data only, no derived/computed fields.
-- All tables include user_id for RLS scoping.

-- 1. Sleep Logs
CREATE TABLE sleep_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  sleep_start TIMESTAMPTZ NOT NULL,
  sleep_end TIMESTAMPTZ NOT NULL,
  quality INTEGER NOT NULL CHECK (quality >= 1 AND quality <= 10),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activity Logs
CREATE TABLE activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  activity_type TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  intensity TEXT NOT NULL CHECK (intensity IN ('low', 'medium', 'high')),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Gym Logs (structured workouts)
CREATE TABLE gym_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  exercise TEXT NOT NULL,
  sets INTEGER NOT NULL CHECK (sets > 0),
  reps INTEGER NOT NULL CHECK (reps > 0),
  weight DECIMAL(8,2) NOT NULL CHECK (weight >= 0),
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Physique Logs (body measurements & progress photos)
CREATE TABLE physique_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  bodyweight DECIMAL(5,2),
  photo_url TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Nutrition / Recovery Logs
CREATE TABLE nutrition_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  water_ml INTEGER DEFAULT 0 CHECK (water_ml >= 0),
  caffeine_mg INTEGER DEFAULT 0 CHECK (caffeine_mg >= 0),
  caffeine_time TIMESTAMPTZ,
  creatine_taken BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Manual Inputs (real-time state tracking for AI calibration)
CREATE TABLE manual_inputs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  energy_level INTEGER NOT NULL CHECK (energy_level >= 1 AND energy_level <= 10),
  focus_level INTEGER NOT NULL CHECK (focus_level >= 1 AND focus_level <= 10),
  stress_level INTEGER NOT NULL CHECK (stress_level >= 1 AND stress_level <= 10),
  soreness_level INTEGER NOT NULL CHECK (soreness_level >= 1 AND soreness_level <= 10),
  mood TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for time-series queries
CREATE INDEX IF NOT EXISTS idx_sleep_logs_user ON sleep_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_sleep_logs_start ON sleep_logs(sleep_start);
CREATE INDEX IF NOT EXISTS idx_sleep_logs_end ON sleep_logs(sleep_end);
CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at);
CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_gym_logs_user ON gym_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_gym_logs_created_at ON gym_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_gym_logs_exercise ON gym_logs(exercise);
CREATE INDEX IF NOT EXISTS idx_physique_logs_user ON physique_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_physique_logs_created_at ON physique_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_user ON nutrition_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_logs_created_at ON nutrition_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_manual_inputs_user ON manual_inputs(user_id);
CREATE INDEX IF NOT EXISTS idx_manual_inputs_created_at ON manual_inputs(created_at);

-- Enable Row Level Security
ALTER TABLE sleep_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE physique_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_inputs ENABLE ROW LEVEL SECURITY;

-- Drop old public-access policies before creating user-scoped ones
DROP POLICY IF EXISTS "Public access" ON sleep_logs;
DROP POLICY IF EXISTS "Public access" ON activities;
DROP POLICY IF EXISTS "Public access" ON gym_logs;
DROP POLICY IF EXISTS "Public access" ON physique_logs;
DROP POLICY IF EXISTS "Public access" ON nutrition_logs;
DROP POLICY IF EXISTS "Public access" ON manual_inputs;

-- User-scoped RLS policies (rows must belong to the authenticated user)
CREATE POLICY "User owns data" ON sleep_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON activities
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON gym_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON physique_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON nutrition_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns data" ON manual_inputs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
