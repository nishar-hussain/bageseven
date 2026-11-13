CREATE TABLE IF NOT EXISTS entitlement_records (
  key text PRIMARY KEY,
  chain_id integer NOT NULL,
  registry text NOT NULL,
  provider_id text NOT NULL,
  kind text NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS entitlement_records_provider ON entitlement_records(provider_id, chain_id, registry);
