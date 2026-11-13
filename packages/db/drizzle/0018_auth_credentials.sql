CREATE TABLE auth_credentials (key text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX idx_auth_credential_expiry ON auth_credentials(expires_at);
