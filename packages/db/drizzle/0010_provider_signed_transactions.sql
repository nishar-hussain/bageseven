CREATE TABLE provider_signed_transactions (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES provider_gas_accounts(provider_id),
  chain_id integer NOT NULL,
  nonce integer NOT NULL,
  intent text,
  raw text NOT NULL
);
CREATE UNIQUE INDEX uq_provider_signed_intent ON provider_signed_transactions(provider_id, chain_id, intent);
