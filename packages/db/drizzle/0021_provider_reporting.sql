-- Keep provider reports and bounded checkout pages within a provider's catalog.
CREATE INDEX idx_billing_plans_provider ON billing_plans(provider_id, id);
CREATE INDEX idx_checkout_sessions_plan_created ON checkout_sessions(plan_id, created_at DESC, id DESC);
CREATE INDEX idx_subscription_provider_status ON billing_subscriptions(provider_id, status, next_attempt_at, id);
