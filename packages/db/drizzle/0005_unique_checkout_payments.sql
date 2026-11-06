CREATE UNIQUE INDEX IF NOT EXISTS "idx_checkout_payment_unique" ON "checkout_sessions" ("chain_id", "payment_tx");
