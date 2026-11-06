CREATE TYPE "public"."provider_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" text NOT NULL,
	"address" text NOT NULL,
	"status" "provider_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_providers_hostname" ON "providers" USING btree ("hostname");
