CREATE TABLE IF NOT EXISTS "billing_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "feature" text NOT NULL,
  "name" text NOT NULL,
  "amount" text NOT NULL,
  "interval" text DEFAULT 'once' NOT NULL,
  "credits" text DEFAULT '10' NOT NULL,
  "ttl_seconds" integer DEFAULT 3600 NOT NULL,
  "merchant_wallet" text NOT NULL,
  "active" text DEFAULT 'true' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_billing_plans_feature" ON "billing_plans" ("feature");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkout_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "holder" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "amount" text NOT NULL,
  "chain_id" integer DEFAULT 43113 NOT NULL,
  "customer_wallet" text,
  "payment_tx" text,
  "grant_id" text,
  "success_url" text,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_plan_id_billing_plans_id_fk"
    FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_checkout_sessions_plan" ON "checkout_sessions" ("plan_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_checkout_sessions_holder" ON "checkout_sessions" ("holder");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_checkout_sessions_status" ON "checkout_sessions" ("status");
