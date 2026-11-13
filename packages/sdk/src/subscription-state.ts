import type { Subscription } from './types.js';

/** Feature access can come from prepaid grants; it is not proof of a subscription. */
export function currentSubscriptionPlans(subscriptions: Pick<Subscription, 'plan_id' | 'status'>[]): Set<string> {
  return new Set(subscriptions.filter(s => s.status !== 'CANCELLED' && s.status !== 'ENDED').map(s => s.plan_id));
}
