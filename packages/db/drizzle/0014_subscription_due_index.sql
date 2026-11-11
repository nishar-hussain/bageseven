CREATE INDEX idx_subscription_due_batch ON billing_subscriptions (next_attempt_at, id)
WHERE status <> 'ENDED'
  AND (status <> 'CANCELLED' OR data->>'lastError' LIKE 'RENEWAL_FLAG_SYNC_PENDING:%');
