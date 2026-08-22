-- ORION Finance v2 — Complete database schema
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- Extends the v1 migration (accounts + transactions) with full finance tracking

-- ============================================================
-- 0. EXTEND EXISTING TABLES
-- ============================================================

-- Add columns to existing accounts table
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'GBP';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS institution TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_number_last4 TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add duplicate detection + category FK to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS description_hash TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_id UUID;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_transactions_description_hash ON transactions(description_hash);
CREATE INDEX IF NOT EXISTS idx_transactions_import_batch_id ON transactions(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);

-- ============================================================
-- 1. SPENDING CATEGORIES
-- ============================================================

CREATE TABLE IF NOT EXISTS transaction_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  is_system BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_user_id ON transaction_categories(user_id);

ALTER TABLE transaction_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns categories" ON transaction_categories;
CREATE POLICY "User owns categories" ON transaction_categories
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Add FK from transactions to categories
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_category
  FOREIGN KEY (category_id) REFERENCES transaction_categories(id) ON DELETE SET NULL;

-- ============================================================
-- 2. CATEGORY RULES (auto-categorisation)
-- ============================================================

CREATE TABLE IF NOT EXISTS category_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  category_id UUID NOT NULL REFERENCES transaction_categories(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('contains', 'starts_with', 'ends_with', 'exact', 'regex')),
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_rules_user_id ON category_rules(user_id);

ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns category rules" ON category_rules;
CREATE POLICY "User owns category rules" ON category_rules
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. RECURRING TRANSACTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  description TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category_id UUID REFERENCES transaction_categories(id) ON DELETE SET NULL,
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  first_seen DATE,
  last_seen DATE,
  occurrence_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recurring_user_id ON recurring_transactions(user_id);

ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns recurring transactions" ON recurring_transactions;
CREATE POLICY "User owns recurring transactions" ON recurring_transactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 4. CSV IMPORT BATCHES
-- ============================================================

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  filename TEXT NOT NULL,
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  row_count INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0,
  skipped_duplicates INTEGER DEFAULT 0,
  column_mapping JSONB,
  imported_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_batches_user_id ON import_batches(user_id);

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns import batches" ON import_batches;
CREATE POLICY "User owns import batches" ON import_batches
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 5. INVESTMENT HOLDINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS investment_holdings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  units DECIMAL(12, 6) DEFAULT 0,
  average_cost DECIMAL(12, 6),
  total_contributed DECIMAL(12, 2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holdings_user_id ON investment_holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_holdings_account_id ON investment_holdings(account_id);

ALTER TABLE investment_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns investment holdings" ON investment_holdings;
CREATE POLICY "User owns investment holdings" ON investment_holdings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 6. INVESTMENT SNAPSHOTS (historical portfolio values)
-- ============================================================

CREATE TABLE IF NOT EXISTS investment_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  holding_id UUID REFERENCES investment_holdings(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  units DECIMAL(12, 6),
  price_per_unit DECIMAL(12, 6),
  total_value DECIMAL(12, 2) NOT NULL,
  daily_change DECIMAL(12, 2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_snapshots_user_id ON investment_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_snapshots_account_id ON investment_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_inv_snapshots_date ON investment_snapshots(snapshot_date DESC);

ALTER TABLE investment_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns investment snapshots" ON investment_snapshots;
CREATE POLICY "User owns investment snapshots" ON investment_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 7. NET WORTH SNAPSHOTS (historical net worth)
-- ============================================================

CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_cash DECIMAL(12, 2) DEFAULT 0,
  total_investments DECIMAL(12, 2) DEFAULT 0,
  total_assets DECIMAL(12, 2) DEFAULT 0,
  total_liabilities DECIMAL(12, 2) DEFAULT 0,
  net_worth DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nw_snapshots_user_id ON net_worth_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_nw_snapshots_date ON net_worth_snapshots(snapshot_date DESC);

-- Unique constraint: one snapshot per user per date
CREATE UNIQUE INDEX IF NOT EXISTS idx_nw_snapshots_user_date ON net_worth_snapshots(user_id, snapshot_date);

ALTER TABLE net_worth_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns net worth snapshots" ON net_worth_snapshots;
CREATE POLICY "User owns net worth snapshots" ON net_worth_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 8. FINANCIAL GOALS
-- ============================================================

CREATE TABLE IF NOT EXISTS financial_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid(),
  name TEXT NOT NULL,
  target_amount DECIMAL(12, 2) NOT NULL,
  target_date DATE,
  target_age INTEGER,
  current_amount DECIMAL(12, 2) DEFAULT 0,
  goal_type TEXT NOT NULL DEFAULT 'portfolio' CHECK (goal_type IN ('portfolio', 'savings', 'investment', 'net_worth', 'custom')),
  is_primary BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user_id ON financial_goals(user_id);

ALTER TABLE financial_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns financial goals" ON financial_goals;
CREATE POLICY "User owns financial goals" ON financial_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 9. PROJECTION SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS projection_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID DEFAULT auth.uid() UNIQUE,
  birth_date DATE,
  current_monthly_investment DECIMAL(12, 2) DEFAULT 0,
  conservative_return DECIMAL(5, 4) DEFAULT 0.05,
  base_return DECIMAL(5, 4) DEFAULT 0.07,
  optimistic_return DECIMAL(5, 4) DEFAULT 0.10,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE projection_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User owns projection settings" ON projection_settings;
CREATE POLICY "User owns projection settings" ON projection_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 10. SEED DEFAULT CATEGORIES
-- ============================================================

-- Insert default spending categories for the user
-- (These run per-user via RLS, so we insert with auth.uid())
INSERT INTO transaction_categories (user_id, name, icon, color, is_system, sort_order)
SELECT auth.uid(), name, icon, color, true, sort_order
FROM (VALUES
  ('Food', '🍽️', '#10b981', 1),
  ('Transport', '🚌', '#3b82f6', 2),
  ('Shopping', '🛍️', '#8b5cf6', 3),
  ('Entertainment', '🎬', '#f59e0b', 4),
  ('Subscriptions', '🔄', '#ec4899', 5),
  ('Travel', '✈️', '#06b6d4', 6),
  ('Sport', '⚽', '#14b8a6', 7),
  ('Education', '📚', '#6366f1', 8),
  ('Health', '💊', '#ef4444', 9),
  ('Gifts', '🎁', '#f472b6', 10),
  ('Other', '📦', '#6b7280', 11),
  ('Income', '💰', '#22c55e', 0),
  ('Savings', '🏦', '#0ea5e9', 0)
) AS v(name, icon, color, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM transaction_categories tc
  WHERE tc.user_id = auth.uid() AND tc.name = v.name
);
