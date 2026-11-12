CREATE INDEX idx_pending_subscription_plans ON subscription_plans(id)
WHERE data->>'status' = 'preparing';
