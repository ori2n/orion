-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- v2 — Merged ISA/JISA into single type with is_jisa flag + contribution tracking

-- 1. Accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('savings', 'cash', 'investment', 'isa')),
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  interest_rate DECIMAL(5, 2),
  is_jisa BOOLEAN DEFAULT false,
  birth_date DATE,
  contribution_ytd DECIMAL(12, 2) DEFAULT 0.00,
  contribution_year INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  amount DECIMAL(12, 2) NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  transfer_to_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC);

-- 4. Enable RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 5. Drop old policies before creating new ones
DROP POLICY IF EXISTS "User owns accounts" ON accounts;
DROP POLICY IF EXISTS "User owns transactions" ON transactions;

-- 6. RLS policies — rows scoped to the authenticated user
CREATE POLICY "User owns accounts" ON accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "User owns transactions" ON transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 7. Migration helper: convert old JISA-type accounts to new format
-- Run this once if you had existing 'JISA' type accounts:
-- UPDATE accounts SET type = 'isa', is_jisa = true WHERE type = 'JISA';
-- UPDATE accounts SET type = 'isa' WHERE type = 'ISA';
