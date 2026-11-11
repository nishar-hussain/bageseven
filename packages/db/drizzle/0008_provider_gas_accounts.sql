ALTER TABLE mandates ADD COLUMN IF NOT EXISTS provider_id text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS provider_gas_accounts (
  provider_id text PRIMARY KEY,
  owner_address text NOT NULL,
  address text NOT NULL,
  encrypted_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  challenge jsonb NOT NULL,
  "authorization" jsonb,
  authorization_signature text,
  recovery_challenge jsonb,
  expires_at timestamptz,
  avalanche_reserved numeric(78,0) NOT NULL DEFAULT 0,
  registry_reserved numeric(78,0) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
