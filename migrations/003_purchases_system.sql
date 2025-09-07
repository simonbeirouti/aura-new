-- Migration 003: Purchases System
-- Creates tables and triggers for token-based purchases

-- Products table to define purchasable items
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    token_cost INTEGER NOT NULL CHECK (token_cost >= 0), -- Allow 0 for IAP products
    category TEXT DEFAULT 'general',
    is_active BOOLEAN DEFAULT TRUE,
    metadata TEXT, -- JSON for additional product data
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchases table to track user purchases
CREATE TABLE IF NOT EXISTS purchases (
    id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    token_cost INTEGER NOT NULL,
    purchase_status TEXT DEFAULT 'completed' CHECK (purchase_status IN ('pending', 'completed', 'failed', 'refunded')),
    transaction_id TEXT, -- For external transaction tracking
    metadata TEXT, -- JSON for additional purchase data
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_purchases_user_id ON purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product_id ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(purchase_status);
CREATE INDEX IF NOT EXISTS idx_purchases_created_at ON purchases(created_at);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);

-- Create function for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update products updated_at
DROP TRIGGER IF EXISTS update_products_timestamp ON products;
CREATE TRIGGER update_products_timestamp 
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update purchases updated_at
DROP TRIGGER IF EXISTS update_purchases_timestamp ON purchases;
CREATE TRIGGER update_purchases_timestamp 
    BEFORE UPDATE ON purchases
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Fix token_transactions table schema - add missing updated_at column
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'token_transactions' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE token_transactions 
        ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Add trigger for token_transactions updated_at if it doesn't exist
DROP TRIGGER IF EXISTS update_token_transactions_timestamp ON token_transactions;
CREATE TRIGGER update_token_transactions_timestamp 
    BEFORE UPDATE ON token_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to validate sufficient tokens before purchase (used in application logic)
-- This is a view that can be used to check if user has sufficient tokens
DROP VIEW IF EXISTS user_purchase_eligibility;
CREATE VIEW user_purchase_eligibility AS
SELECT 
    utb.user_id,
    utb.total_tokens,
    utb.tokens_used,
    (utb.total_tokens - utb.tokens_used) as tokens_available,
    p.id as product_id,
    p.name as product_name,
    p.token_cost,
    CASE 
        WHEN (utb.total_tokens - utb.tokens_used) >= p.token_cost THEN 1 
        ELSE 0 
    END as can_purchase
FROM user_tokens utb
CROSS JOIN products p
WHERE p.is_active = TRUE
    AND utb.user_id = auth.uid();

-- Insert some example products (consumables and cosmetics only)
-- Use ON CONFLICT for PostgreSQL instead of INSERT OR REPLACE
INSERT INTO products (id, name, description, token_cost, category, metadata) VALUES
-- Consumables
('consumable_1', 'Extra Processing Power', 'Boost your processing capacity for 24 hours', 50, 'consumables', '{"type": "consumable", "duration": "24h"}'),
('consumable_2', 'Priority Support', 'Get priority customer support for 7 days', 75, 'consumables', '{"type": "consumable", "duration": "7d"}'),
('consumable_3', 'Speed Boost', 'Increase app performance for 1 hour', 25, 'consumables', '{"type": "consumable", "duration": "1h"}'),
('consumable_4', 'Data Export Credits', 'Export your data in premium formats (5 uses)', 30, 'consumables', '{"type": "consumable", "uses": 5}'),
-- Cosmetics
('cosmetic_1', 'Dark Theme Pro', 'Exclusive premium dark theme with animations', 25, 'cosmetics', '{"type": "cosmetic", "duration": "permanent"}'),
('cosmetic_2', 'Custom Avatar Pack', 'Collection of premium avatar customizations', 40, 'cosmetics', '{"type": "cosmetic", "duration": "permanent"}'),
('cosmetic_3', 'Rainbow UI Effects', 'Colorful interface animations and transitions', 35, 'cosmetics', '{"type": "cosmetic", "duration": "permanent"}'),
('cosmetic_4', 'Premium Icons Set', 'Exclusive icon pack with 100+ premium icons', 60, 'cosmetics', '{"type": "cosmetic", "duration": "permanent"}')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    token_cost = EXCLUDED.token_cost,
    category = EXCLUDED.category,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();

-- Enable Row Level Security
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- RLS Policies for products table
-- Users can read all active products but cannot insert/update/delete
CREATE POLICY "products_read_policy" ON products
    FOR SELECT
    TO authenticated
    USING (is_active = TRUE);

-- RLS Policies for purchases table
-- Users can only see their own purchases
CREATE POLICY "purchases_select_policy" ON purchases
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Users can only insert purchases for themselves
CREATE POLICY "purchases_insert_policy" ON purchases
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users can only update their own purchases (for status changes, etc.)
CREATE POLICY "purchases_update_policy" ON purchases
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Users cannot delete purchases (for audit trail)
-- No delete policy = no delete access

-- Users cannot delete purchases (for audit trail)
-- No delete policy = no delete access

-- Create a view for purchase history with product details
-- Note: This view is created at the end to avoid dependency issues during table modifications
DROP VIEW IF EXISTS purchase_history;
CREATE VIEW purchase_history AS
SELECT 
    p.id,
    p.user_id,
    p.product_id,
    prod.name as product_name,
    prod.description as product_description,
    prod.category,
    p.token_cost,
    p.purchase_status,
    p.transaction_id,
    p.created_at,
    p.updated_at
FROM purchases p
JOIN products prod ON p.product_id = prod.id
WHERE p.user_id = auth.uid()
ORDER BY p.created_at DESC;
