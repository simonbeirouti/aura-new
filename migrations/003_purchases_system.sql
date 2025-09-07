-- Migration 003: Purchases System (Combined)
-- Creates tables, triggers, and atomic transaction handling for token-based purchases
-- This combines the original purchases system with double-spend prevention fixes

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

-- Fix token_transactions table schema - add missing columns
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

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'token_transactions'
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE token_transactions
        ADD COLUMN metadata TEXT;
        RAISE NOTICE 'Added metadata column to token_transactions table';
    END IF;
END $$;

-- Add trigger for token_transactions updated_at if it doesn't exist
DROP TRIGGER IF EXISTS update_token_transactions_timestamp ON token_transactions;
CREATE TRIGGER update_token_transactions_timestamp 
    BEFORE UPDATE ON token_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Note: user_purchase_eligibility view is created later in the migration with updated logic

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

-- =================================================================================
-- DOUBLE SPEND PREVENTION FIXES (Originally from Migration 004)
-- =================================================================================

-- First, ensure we have the necessary tables from previous migrations
-- This migration assumes 001_initial.sql and 002_iap_system.sql have been run

-- Create a function to safely make purchases with token validation
CREATE OR REPLACE FUNCTION make_purchase(
    p_user_id UUID,
    p_product_id TEXT,
    p_transaction_id TEXT DEFAULT NULL,
    p_metadata TEXT DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_product RECORD;
    v_user_tokens RECORD;
    v_available_tokens INTEGER;
    v_purchase_id TEXT;
    v_existing_purchase_count INTEGER;
    v_result JSON;
BEGIN
    -- Get product details
    SELECT * INTO v_product
    FROM products
    WHERE id = p_product_id AND is_active = TRUE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Product not found or inactive');
    END IF;

    -- Get user's current token balance
    SELECT
        COALESCE(SUM(CASE WHEN transaction_type IN ('purchase', 'refund', 'bonus') THEN token_amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type = 'usage' THEN ABS(token_amount) ELSE 0 END), 0) as available_tokens
    INTO v_available_tokens
    FROM token_transactions
    WHERE user_id = p_user_id;

    -- Check if user has sufficient tokens
    IF v_available_tokens < v_product.token_cost THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Insufficient tokens',
            'required', v_product.token_cost,
            'available', v_available_tokens
        );
    END IF;

    -- Check if user already owns this product (prevent duplicate purchases)
    -- Comment out this check if you want to allow multiple purchases of the same product
    /*
    SELECT COUNT(*) INTO v_existing_purchase_count
    FROM purchases
    WHERE user_id = p_user_id
      AND product_id = p_product_id
      AND purchase_status = 'completed';

    IF v_existing_purchase_count > 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Product already purchased',
            'product_id', p_product_id
        );
    END IF;
    */

    -- Generate unique purchase ID
    v_purchase_id := 'purchase_' || gen_random_uuid()::TEXT;

    -- Start atomic transaction
    BEGIN
        -- Insert purchase record
        INSERT INTO purchases (
            id,
            user_id,
            product_id,
            token_cost,
            purchase_status,
            transaction_id,
            metadata
        ) VALUES (
            v_purchase_id,
            p_user_id,
            p_product_id,
            v_product.token_cost,
            'completed',
            p_transaction_id,
            CASE
                WHEN p_metadata IS NOT NULL THEN
                    (p_metadata::jsonb || jsonb_build_object('tokens_deducted', true))::text
                ELSE
                    json_build_object('tokens_deducted', true)::text
            END
        );

        -- Deduct tokens (create usage transaction)
        INSERT INTO token_transactions (
            user_id,
            transaction_type,
            token_amount,
            description,
            product_id,
            metadata
        ) VALUES (
            p_user_id,
            'usage',
            -v_product.token_cost, -- Negative for spending
            'Purchase: ' || v_product.name,
            p_product_id,
            json_build_object(
                'purchase_id', v_purchase_id,
                'product_name', v_product.name
            )::TEXT
        );

        -- Commit the transaction
        v_result := json_build_object(
            'success', true,
            'purchase_id', v_purchase_id,
            'product_name', v_product.name,
            'tokens_spent', v_product.token_cost,
            'tokens_remaining', v_available_tokens - v_product.token_cost
        );

    EXCEPTION
        WHEN OTHERS THEN
            -- Rollback will happen automatically
            RETURN json_build_object('success', false, 'error', 'Transaction failed: ' || SQLERRM);
    END;

    RETURN v_result;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a trigger function to validate purchases before insertion
CREATE OR REPLACE FUNCTION validate_purchase_before_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_available_tokens INTEGER;
    v_product RECORD;
BEGIN
    -- Only validate if this is a new completed purchase
    IF NEW.purchase_status = 'completed' THEN
        -- Get product details
        SELECT * INTO v_product
        FROM products
        WHERE id = NEW.product_id AND is_active = TRUE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found or inactive', NEW.product_id;
        END IF;

        -- Check if the token_cost matches the product
        IF NEW.token_cost != v_product.token_cost THEN
            RAISE EXCEPTION 'Token cost mismatch for product %: expected %, got %',
                NEW.product_id, v_product.token_cost, NEW.token_cost;
        END IF;

        -- Get user's current token balance
        SELECT
            COALESCE(SUM(CASE WHEN transaction_type IN ('purchase', 'refund', 'bonus') THEN token_amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN transaction_type = 'usage' THEN ABS(token_amount) ELSE 0 END), 0) as available_tokens
        INTO v_available_tokens
        FROM token_transactions
        WHERE user_id = NEW.user_id;

        -- Check if user has sufficient tokens
        IF v_available_tokens < NEW.token_cost THEN
            RAISE EXCEPTION 'Insufficient tokens for purchase: required %, available %',
                NEW.token_cost, v_available_tokens;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to validate purchases before insertion
DROP TRIGGER IF EXISTS validate_purchase_trigger ON purchases;
CREATE TRIGGER validate_purchase_trigger
    BEFORE INSERT ON purchases
    FOR EACH ROW
    EXECUTE FUNCTION validate_purchase_before_insert();

-- Create a function to handle token deduction after purchase insertion
-- This ensures tokens are deducted only after successful purchase insertion
-- Prevents double deduction by checking if tokens were already deducted
CREATE OR REPLACE FUNCTION deduct_tokens_after_purchase()
RETURNS TRIGGER AS $$
DECLARE
    v_existing_transaction_count INTEGER;
    v_metadata_tokens_deducted TEXT;
BEGIN
    -- Only deduct tokens for completed purchases
    IF NEW.purchase_status = 'completed' THEN
        -- Check if tokens have already been deducted for this purchase
        -- First check if the purchase metadata indicates tokens were already deducted
        BEGIN
            -- Safely parse JSON metadata
            IF NEW.metadata IS NOT NULL THEN
                v_metadata_tokens_deducted := NEW.metadata::json->>'tokens_deducted';
                IF v_metadata_tokens_deducted = 'true' THEN
                    -- Tokens already deducted by make_purchase function, skip trigger
                    RETURN NEW;
                END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- If JSON parsing fails, continue with other checks
            NULL;
        END;

        -- Also check for existing usage transactions with this purchase_id
        -- This is the primary check to prevent double deduction
        SELECT COUNT(*) INTO v_existing_transaction_count
        FROM token_transactions
        WHERE user_id = NEW.user_id
          AND transaction_type = 'usage'
          AND product_id = NEW.product_id
          AND metadata IS NOT NULL
          AND metadata::json->>'purchase_id' = NEW.id::TEXT;

        -- Only deduct if no existing transaction found (prevents double deduction)
        IF v_existing_transaction_count = 0 THEN
            -- Insert token deduction transaction
            INSERT INTO token_transactions (
                user_id,
                transaction_type,
                token_amount,
                description,
                product_id,
                metadata
            ) VALUES (
                NEW.user_id,
                'usage',
                -NEW.token_cost, -- Negative for spending
                'Purchase: ' || (SELECT name FROM products WHERE id = NEW.product_id),
                NEW.product_id,
                json_build_object(
                    'purchase_id', NEW.id,
                    'product_name', (SELECT name FROM products WHERE id = NEW.product_id)
                )::TEXT
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to deduct tokens after successful purchase
-- Only fires if tokens haven't been deducted already (prevents double deduction)
DROP TRIGGER IF EXISTS deduct_tokens_trigger ON purchases;
CREATE TRIGGER deduct_tokens_trigger
    AFTER INSERT ON purchases
    FOR EACH ROW
    WHEN (NEW.purchase_status = 'completed')
    EXECUTE FUNCTION deduct_tokens_after_purchase();

-- Add unique constraint to prevent duplicate purchases of the same product by the same user
-- This prevents buying the same consumable multiple times if that's not intended
-- Comment out if you want to allow multiple purchases of the same product
-- ALTER TABLE purchases ADD CONSTRAINT unique_user_product_purchase
--     UNIQUE (user_id, product_id);

-- Add partial unique constraint for transaction_id to prevent duplicate external transactions
ALTER TABLE purchases ADD CONSTRAINT unique_transaction_id
    EXCLUDE (transaction_id WITH =)
    WHERE (transaction_id IS NOT NULL);

-- Create an index for better performance on token balance queries
CREATE INDEX IF NOT EXISTS idx_token_transactions_user_type ON token_transactions(user_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_token_transactions_created_at ON token_transactions(created_at DESC);

-- Create a function to get user's current token balance
CREATE OR REPLACE FUNCTION get_user_token_balance(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN transaction_type IN ('purchase', 'refund', 'bonus') THEN token_amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type = 'usage' THEN ABS(token_amount) ELSE 0 END), 0) as balance
    INTO v_balance
    FROM token_transactions
    WHERE user_id = p_user_id;

    RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update the user_purchase_eligibility view to use the new function
DROP VIEW IF EXISTS user_purchase_eligibility;
CREATE VIEW user_purchase_eligibility AS
SELECT
    utb.user_id,
    get_user_token_balance(utb.user_id) as total_tokens,
    get_user_token_balance(utb.user_id) as tokens_available,
    p.id as product_id,
    p.name as product_name,
    p.token_cost,
    CASE
        WHEN get_user_token_balance(utb.user_id) >= p.token_cost THEN 1
        ELSE 0
    END as can_purchase
FROM user_tokens utb
CROSS JOIN products p
WHERE p.is_active = TRUE
    AND utb.user_id = auth.uid();

-- Create a function to handle refunds (if needed)
CREATE OR REPLACE FUNCTION refund_purchase(p_purchase_id TEXT)
RETURNS JSON AS $$
DECLARE
    v_purchase RECORD;
    v_result JSON;
BEGIN
    -- Get purchase details
    SELECT * INTO v_purchase
    FROM purchases
    WHERE id = p_purchase_id AND user_id = auth.uid() AND purchase_status = 'completed';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Purchase not found or not eligible for refund');
    END IF;

    -- Update purchase status
    UPDATE purchases
    SET purchase_status = 'refunded', updated_at = NOW()
    WHERE id = p_purchase_id;

    -- Refund tokens
    INSERT INTO token_transactions (
        user_id,
        transaction_type,
        token_amount,
        description,
        product_id,
        metadata
    ) VALUES (
        v_purchase.user_id,
        'refund',
        v_purchase.token_cost, -- Positive for refund
        'Refund: ' || (SELECT name FROM products WHERE id = v_purchase.product_id),
        v_purchase.product_id,
        json_build_object(
            'purchase_id', p_purchase_id,
            'refund_reason', 'user_refund'
        )::TEXT
    );

    v_result := json_build_object(
        'success', true,
        'purchase_id', p_purchase_id,
        'refunded_tokens', v_purchase.token_cost
    );

    RETURN v_result;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION make_purchase(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_token_balance(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_purchase(TEXT) TO authenticated;

-- Add comments to document the fixes
COMMENT ON FUNCTION make_purchase(UUID, TEXT, TEXT, TEXT) IS
'Purchase function with duplicate prevention and correct token deduction logic';
COMMENT ON FUNCTION deduct_tokens_after_purchase() IS
'Token deduction trigger with double deduction prevention.
Checks purchase metadata for tokens_deducted flag to prevent
duplicate token deductions when using make_purchase function.';
