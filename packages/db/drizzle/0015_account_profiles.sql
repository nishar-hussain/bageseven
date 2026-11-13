CREATE TABLE account_profiles (
  email text PRIMARY KEY,
  wallet_address text,
  onboarding_done_at bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
