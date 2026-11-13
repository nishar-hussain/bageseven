CREATE TABLE provider_api_keys (
  id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sk','pk')),
  key_hash text NOT NULL UNIQUE,
  hint text NOT NULL,
  public_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CHECK (kind='pk' OR public_key IS NULL)
);
CREATE INDEX idx_provider_api_keys_owner ON provider_api_keys(provider_id,created_at DESC,id);
