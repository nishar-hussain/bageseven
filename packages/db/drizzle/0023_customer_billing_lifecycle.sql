ALTER TABLE checkout_sessions ADD COLUMN billing_email text;
ALTER TABLE billing_documents ADD COLUMN billing_email text;
--> statement-breakpoint
CREATE INDEX idx_checkout_expiration ON checkout_sessions(status,expires_at,id);
CREATE INDEX idx_checkout_customer_open ON checkout_sessions(plan_id,holder,created_at DESC) WHERE status='PENDING' AND payment_tx IS NULL;
CREATE INDEX idx_billing_document_email ON billing_documents(billing_email,created_at DESC,id DESC) WHERE billing_email IS NOT NULL;
--> statement-breakpoint
CREATE TABLE billing_email_deliveries (
  document_id text PRIMARY KEY REFERENCES billing_documents(id),
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','RECONCILIATION_REQUIRED')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  first_attempt_at timestamptz,
  lease_id uuid,
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz
);
CREATE INDEX idx_billing_email_due ON billing_email_deliveries(status,next_attempt_at,lease_until,document_id);
