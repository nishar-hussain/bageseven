import { expect, it } from 'vitest';
import { currentSubscriptionPlans } from './subscription-state.js';

it('marks only the subscribed plan current and keeps payment recovery states from creating duplicate enrollments', () => {
  const plans = currentSubscriptionPlans([
    { plan_id: 'ocr-pro', status: 'ACTIVE' }, { plan_id: 'ocr-starter', status: 'CANCELLED' },
    { plan_id: 'expired', status: 'ENDED' }, { plan_id: 'pending-reconciliation', status: 'RECONCILIATION_REQUIRED' },
    { plan_id: 'past-due', status: 'PAST_DUE' },
  ]);
  expect([...plans]).toEqual(['ocr-pro', 'pending-reconciliation', 'past-due']);
  expect(plans.has('ocr-team')).toBe(false);
  expect(currentSubscriptionPlans([]).size).toBe(0);
});
