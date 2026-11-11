CREATE INDEX IF NOT EXISTS entitlement_holder_live ON entitlement_records
  (chain_id, registry, (data->>'holder'), (data->>'paid_through'), key) WHERE kind = 'grant';
CREATE INDEX IF NOT EXISTS entitlement_feature_live ON entitlement_records
  (chain_id, registry, (data->>'feature'), (data->>'paid_through'), key) WHERE kind = 'grant';
CREATE INDEX IF NOT EXISTS entitlement_worker_live ON entitlement_records
  (chain_id, registry, (data->>'worker_id'), (data->>'paid_through'), key) WHERE kind = 'grant';
