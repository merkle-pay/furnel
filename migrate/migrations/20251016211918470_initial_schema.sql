-- Furnel Database Schema
-- USDC → Local Currency Offramp

-- Payments table (main record)
CREATE TABLE IF NOT EXISTS payments (
    id VARCHAR(64) PRIMARY KEY,
    deposit_address VARCHAR(64) NOT NULL,
    amount DECIMAL(20, 6) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'INITIATED',

    -- Recipient bank details
    recipient_name VARCHAR(255),
    recipient_account_number VARCHAR(64),
    recipient_sort_code VARCHAR(20),
    recipient_iban VARCHAR(64),

    -- USDC deposit tracking
    usdc_tx_hash VARCHAR(128),
    usdc_received_at TIMESTAMPTZ,

    -- FX rate
    fx_rate DECIMAL(20, 8),
    fx_locked_at TIMESTAMPTZ,

    -- Offramp tracking
    quote_id VARCHAR(128),
    offramp_url TEXT,
    offramp_order_id VARCHAR(128),
    offramp_callback_status VARCHAR(50),
    offramp_callback_at TIMESTAMPTZ,
    offramp_completed_at TIMESTAMPTZ,

    -- Error handling
    error_message TEXT,

    -- Temporal tracking
    workflow_id VARCHAR(128),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment state transitions (audit log)
CREATE TABLE IF NOT EXISTS payment_state_transitions (
    id SERIAL PRIMARY KEY,
    payment_id VARCHAR(64) NOT NULL REFERENCES payments(id),
    status VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refunds table
CREATE TABLE IF NOT EXISTS refunds (
    id SERIAL PRIMARY KEY,
    payment_id VARCHAR(64) REFERENCES payments(id),
    wallet_address VARCHAR(64) NOT NULL,
    amount DECIMAL(20, 6) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    tx_hash VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Webhook events log
CREATE TABLE IF NOT EXISTS webhook_events (
    id SERIAL PRIMARY KEY,
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    processed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_deposit_address ON payments(deposit_address);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_quote_id ON payments(quote_id);
CREATE INDEX IF NOT EXISTS idx_payments_offramp_order_id ON payments(offramp_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transitions_payment_id ON payment_state_transitions(payment_id);
CREATE INDEX IF NOT EXISTS idx_refunds_wallet ON refunds(wallet_address);
CREATE INDEX IF NOT EXISTS idx_webhook_events_provider ON webhook_events(provider, event_type);
