CREATE TABLE payments (
    correlation_id UUID NOT NULL,
    requested_at TIMESTAMPTZ,
    processor TEXT,
    amount NUMERIC(10, 2) NOT NULL
);
CREATE INDEX idx_payments_summary_query ON payments (requested_at, processor)
WHERE requested_at IS NOT NULL;