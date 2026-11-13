CREATE TABLE subscription_plans (
  id text PRIMARY KEY REFERENCES billing_plans(id),
  provider_id text NOT NULL,
  data jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE billing_subscriptions (
  id text PRIMARY KEY,
  checkout_id text NOT NULL UNIQUE REFERENCES checkout_sessions(id),
  holder text NOT NULL,
  provider_id text NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  status text NOT NULL,
  data jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_subscription_due ON billing_subscriptions(status, next_attempt_at);
CREATE INDEX idx_subscription_holder ON billing_subscriptions(holder);
--> statement-breakpoint
CREATE TABLE subscription_periods (
  id text PRIMARY KEY,
  subscription_id text NOT NULL REFERENCES billing_subscriptions(id),
  data jsonb NOT NULL
);
