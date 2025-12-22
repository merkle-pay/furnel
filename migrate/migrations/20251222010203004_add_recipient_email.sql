-- Add recipient_email column for sending Coinbase offramp link
-- The recipient (not sender) must click the Coinbase link to complete the transfer

ALTER TABLE payments ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);

-- Index for looking up payments by recipient email (for recipient dashboard, if needed)
CREATE INDEX IF NOT EXISTS idx_payments_recipient_email ON payments(recipient_email);

-- Add new status values for email flow
COMMENT ON COLUMN payments.recipient_email IS 'Email address where Coinbase offramp link is sent';
