-- IAP System Tables
-- Tracks all purchase transactions (both subscriptions and consumables)
CREATE TABLE iap_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Core transaction data
  transaction_id TEXT NOT NULL, -- From IAP plugin
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('subscription', 'consumable')),
  
  -- Purchase details
  purchase_token TEXT NOT NULL,
  order_id TEXT,
  package_name TEXT,
  purchase_time TIMESTAMPTZ NOT NULL,
  purchase_state INTEGER NOT NULL, -- 0 = purchased, 1 = canceled
  
  -- Platform verification
  signature TEXT,
  original_json JSONB, -- Store raw platform data for verification
  is_acknowledged BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate transactions
  UNIQUE(user_id, transaction_id, purchase_token)
);

-- Tracks active subscriptions with renewal/expiry info
CREATE TABLE user_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  transaction_id UUID REFERENCES iap_transactions(id) ON DELETE CASCADE NOT NULL,
  
  -- Subscription details
  product_id TEXT NOT NULL,
  subscription_status TEXT NOT NULL CHECK (subscription_status IN ('active', 'expired', 'cancelled', 'pending')),
  
  -- Timing
  start_date TIMESTAMPTZ NOT NULL,
  expiry_time TIMESTAMPTZ,
  renewal_date TIMESTAMPTZ,
  cancellation_date TIMESTAMPTZ,
  
  -- Auto-renewal
  is_auto_renewing BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Only one active subscription per product per user
  UNIQUE(user_id, product_id) DEFERRABLE INITIALLY DEFERRED
);

-- Tracks user token/points balance from consumable purchases
CREATE TABLE user_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  
  -- Token balance
  total_tokens INTEGER DEFAULT 0 NOT NULL,
  tokens_used INTEGER DEFAULT 0 NOT NULL,
  tokens_available INTEGER GENERATED ALWAYS AS (total_tokens - tokens_used) STORED,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks individual token transactions (purchases and usage)
CREATE TABLE token_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  iap_transaction_id UUID REFERENCES iap_transactions(id) ON DELETE SET NULL,
  
  -- Transaction details
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'usage', 'refund', 'bonus')),
  token_amount INTEGER NOT NULL, -- Positive for additions, negative for usage
  description TEXT,
  
  -- Reference data
  product_id TEXT, -- For purchases
  feature_used TEXT, -- For usage tracking
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE iap_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_transactions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own data (SELECT, INSERT, UPDATE)
CREATE POLICY "Users can view own transactions" ON iap_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions" ON iap_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions" ON iap_transactions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own subscriptions" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions" ON user_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscriptions" ON user_subscriptions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own tokens" ON user_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tokens" ON user_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens" ON user_tokens
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own token transactions" ON token_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own token transactions" ON token_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own token transactions" ON token_transactions
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Service role can manage all data (for backend processing)
CREATE POLICY "Service role can manage transactions" ON iap_transactions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage subscriptions" ON user_subscriptions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage tokens" ON user_tokens
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage token transactions" ON token_transactions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- Indexes for performance
CREATE INDEX idx_iap_transactions_user_id ON iap_transactions(user_id);
CREATE INDEX idx_iap_transactions_product_id ON iap_transactions(product_id);
CREATE INDEX idx_iap_transactions_purchase_time ON iap_transactions(purchase_time);

CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(subscription_status);
CREATE INDEX idx_user_subscriptions_expiry ON user_subscriptions(expiry_time);

CREATE INDEX idx_token_transactions_user_id ON token_transactions(user_id);
CREATE INDEX idx_token_transactions_type ON token_transactions(transaction_type);
CREATE INDEX idx_token_transactions_created ON token_transactions(created_at);

-- Functions for token management
CREATE OR REPLACE FUNCTION update_user_tokens()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert or update user_tokens when token_transactions are added
  INSERT INTO user_tokens (user_id, total_tokens, tokens_used)
  VALUES (
    NEW.user_id,
    CASE WHEN NEW.token_amount > 0 THEN NEW.token_amount ELSE 0 END,
    CASE WHEN NEW.token_amount < 0 THEN ABS(NEW.token_amount) ELSE 0 END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    total_tokens = user_tokens.total_tokens + CASE WHEN NEW.token_amount > 0 THEN NEW.token_amount ELSE 0 END,
    tokens_used = user_tokens.tokens_used + CASE WHEN NEW.token_amount < 0 THEN ABS(NEW.token_amount) ELSE 0 END,
    updated_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update token balances
CREATE TRIGGER trigger_update_user_tokens
  AFTER INSERT ON token_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_tokens();

-- Fix signup trigger circular dependency by modifying the original handle_new_user function
-- to also create user_tokens (instead of using a separate trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  -- Create profile entry
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'avatar_url');
  
  -- Create initial token balance entry
  INSERT INTO public.user_tokens (user_id, total_tokens, tokens_used)
  VALUES (NEW.id, 0, 0);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
