-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- Adds future_transactions table for persisting projected events

-- 1. Future transactions table
-- Stores income/expense/transfer events scheduled at a future age for projection purposes
CREATE TABLE IF NOT EXISTS future_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,
  age INTEGER NOT NULL CHECK (age > 0),
  description TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  to_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  transfer_mode TEXT CHECK (transfer_mode IN ('fixed', 'percent', 'above_threshold')),
  transfer_value DECIMAL(12, 2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_future_transactions_user_id ON future_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_future_transactions_age ON future_transactions(age);

-- 3. Enable RLS
ALTER TABLE future_transactions ENABLE ROW LEVEL SECURITY;

-- 4. Drop old policies before creating new ones
DROP POLICY IF EXISTS "User owns future transactions" ON future_transactions;

-- 5. RLS policy — rows scoped to the authenticated user
CREATE POLICY "User owns future transactions" ON future_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
