CREATE TYPE "public"."agent_status" AS ENUM('active', 'suspended', 'retired');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('active', 'revoked', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('reserved', 'committed', 'settled', 'released');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('reserve', 'commit', 'withdraw', 'fund');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"parent_agent_id" uuid,
	"operator_address" text NOT NULL,
	"share_percent" numeric(10, 2) NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_address" text NOT NULL,
	"operator_address" text NOT NULL,
	"contract_address" text,
	"budget_per_window" numeric(38, 18) NOT NULL,
	"window_seconds" bigint NOT NULL,
	"lifetime_cap" numeric(38, 18) NOT NULL,
	"per_purchase_cap" numeric(38, 18) NOT NULL,
	"per_seller_pct" integer NOT NULL,
	"max_depth" integer NOT NULL,
	"signature" text NOT NULL,
	"status" "mandate_status" DEFAULT 'active' NOT NULL,
	"superseded_at" timestamp with time zone,
	"window_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_spent" numeric(38, 18) DEFAULT '0' NOT NULL,
	"lifetime_spent" numeric(38, 18) DEFAULT '0' NOT NULL,
	"seller_spent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refusals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"seller" text,
	"bound" text NOT NULL,
	"reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"status" "reservation_status" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"agent_id" uuid,
	"tx_hash" text,
	"amount" numeric(38, 18) NOT NULL,
	"type" "tx_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mandate_id" uuid NOT NULL,
	"contract_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refusals" ADD CONSTRAINT "refusals_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refusals" ADD CONSTRAINT "refusals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agents_mandate" ON "agents" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "idx_agents_operator" ON "agents" USING btree ("operator_address");--> statement-breakpoint
CREATE INDEX "idx_mandates_owner" ON "mandates" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "idx_mandates_status" ON "mandates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_refusals_mandate_created" ON "refusals" USING btree ("mandate_id","requested_at");--> statement-breakpoint
CREATE INDEX "idx_reservations_mandate" ON "reservations" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_mandate" ON "transactions" USING btree ("mandate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vault_mandate" ON "vaults" USING btree ("mandate_id");