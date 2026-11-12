CREATE TABLE x402_authorities (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  mandate_id uuid NOT NULL REFERENCES mandates(id),
  worker_id uuid NOT NULL REFERENCES agents(id),
  chain_id integer NOT NULL,
  merchant text NOT NULL,
  owner_address text NOT NULL,
  payer_address text NOT NULL,
  encrypted_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  challenge jsonb,
  "authorization" jsonb,
  authorization_signature text,
  expires_at timestamptz
);
CREATE UNIQUE INDEX idx_x402_authority_binding ON x402_authorities(provider_id, mandate_id, worker_id, chain_id, merchant);
--> statement-breakpoint
CREATE TABLE x402_jobs (
  id uuid PRIMARY KEY,
  authority_id uuid NOT NULL REFERENCES x402_authorities(id),
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL,
  data jsonb NOT NULL,
  lease integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);
CREATE UNIQUE INDEX idx_x402_job_idempotency ON x402_jobs(authority_id, idempotency_key);
CREATE INDEX idx_x402_job_due ON x402_jobs(next_attempt_at, id) WHERE state NOT IN ('SETTLED', 'REFUNDED', 'REJECTED');
CREATE UNIQUE INDEX idx_x402_one_unresolved_job ON x402_jobs(authority_id)
WHERE state NOT IN ('SETTLED', 'REFUNDED', 'REJECTED');
CREATE UNIQUE INDEX idx_x402_funding_transaction ON x402_jobs((data->>'fundingHash')) WHERE data->>'fundingHash' IS NOT NULL;
--> statement-breakpoint
ALTER TABLE reservations ADD COLUMN recipient text;
ALTER TABLE reservations ADD COLUMN settlement_hash text;
CREATE UNIQUE INDEX uq_reservation_settlement ON reservations(settlement_hash);
