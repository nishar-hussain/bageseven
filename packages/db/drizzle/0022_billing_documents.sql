ALTER TABLE checkout_sessions ADD COLUMN payment_token text;
--> statement-breakpoint
CREATE TABLE billing_documents (
  id text PRIMARY KEY,
  source text NOT NULL UNIQUE,
  provider_id text NOT NULL,
  holder text NOT NULL,
  terms jsonb NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PAID','VOID')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  paid_recorded_at timestamptz,
  payment_tx text,
  payer text,
  CHECK(status <> 'PAID' OR (payment_tx IS NOT NULL AND payer IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX idx_billing_documents_provider_created ON billing_documents(provider_id,created_at DESC,id DESC);
CREATE INDEX idx_billing_documents_provider_holder ON billing_documents(provider_id,holder);
CREATE INDEX idx_billing_documents_holder_created ON billing_documents(holder,created_at DESC,id DESC);
--> statement-breakpoint
-- Historical token and payment timestamps were not saved. Leave them unknown.
INSERT INTO billing_documents(id,source,provider_id,holder,terms,status,created_at,expires_at,payment_tx,payer)
SELECT 'inv_'||md5('checkout:'||c.id),'checkout:'||c.id,p.provider_id,c.holder,
  jsonb_build_object('planId',p.id,'planName',p.name,'feature',p.feature,'amount',c.amount,
    'chainId',c.chain_id,'token',NULL,'merchant',p.merchant_wallet,
    'kind',CASE WHEN p.interval='month' THEN 'subscription' ELSE 'once' END),
  CASE WHEN c.status='PAID' AND c.payment_tx IS NOT NULL AND c.customer_wallet IS NOT NULL THEN 'PAID'
       WHEN c.status IN ('FAILED','CANCELLED','EXPIRED') THEN 'VOID' ELSE 'OPEN' END,
  c.created_at,c.expires_at,
  CASE WHEN c.status='PAID' THEN c.payment_tx END,
  CASE WHEN c.status='PAID' THEN c.customer_wallet END
FROM checkout_sessions c JOIN billing_plans p ON p.id=c.plan_id;
--> statement-breakpoint
-- Verified initial collections can precede checkout entitlement fulfillment.
UPDATE billing_documents d SET status='PAID',payment_tx=lower(p.data->>'hash'),payer=lower(s.data->>'payer')
FROM subscription_periods p JOIN billing_subscriptions s ON s.id=p.subscription_id
WHERE p.id=s.id||':initial' AND d.source='checkout:'||s.checkout_id
  AND p.data->>'stage' IN ('confirmed','minting','complete');
--> statement-breakpoint
INSERT INTO billing_documents(id,source,provider_id,holder,terms,status,created_at,payment_tx,payer)
SELECT 'inv_'||md5('period:'||p.id),'period:'||p.id,s.provider_id,s.holder,
  jsonb_build_object('planId',s.data->'plan'->>'id','planName',s.data->'plan'->>'name',
    'feature',s.data->'plan'->>'feature','amount',s.data->'plan'->>'amount','chainId',s.data->'chainId',
    'token',NULL,'merchant',s.data->'plan'->>'merchant_wallet','kind','renewal',
    'periodStart',to_timestamp((p.data->>'due')::double precision),
    'periodEnd',to_timestamp((p.data->>'due')::double precision+(s.data->'plan'->>'ttl_seconds')::double precision)),
  CASE WHEN p.data->>'stage' IN ('confirmed','minting','complete') THEN 'PAID'
       WHEN p.data->>'stage'='failed' THEN 'VOID' ELSE 'OPEN' END,
  to_timestamp((p.data->>'due')::double precision),
  CASE WHEN p.data->>'stage' IN ('confirmed','minting','complete') THEN lower(p.data->>'hash') END,
  CASE WHEN p.data->>'stage' IN ('confirmed','minting','complete') THEN lower(s.data->>'payer') END
FROM subscription_periods p JOIN billing_subscriptions s ON s.id=p.subscription_id
WHERE p.id<>s.id||':initial';
