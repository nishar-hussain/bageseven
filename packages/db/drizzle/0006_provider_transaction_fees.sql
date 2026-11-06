-- Historic checkouts remain fee-free. New checkouts snapshot the agreed fee.
ALTER TABLE checkout_sessions ADD COLUMN platform_fee_bps integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE checkout_sessions ADD COLUMN platform_fee_amount text NOT NULL DEFAULT '0';
--> statement-breakpoint
ALTER TABLE billing_plans ADD COLUMN provider_id text NOT NULL DEFAULT 'legacy';
