import type { Plan } from './billing-store.js';

export type SubscriptionPlan = {
  id: string; providerId: string; chainId: number; contract: string; hash?: string; raw?: string;
  status: 'preparing' | 'ready';
};
export type Subscription = {
  id: string; checkoutId: string; holder: string; providerId: string; plan: Plan;
  chainId: number; contract: string; key: string; payer: string;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'ENDED' | 'RECONCILIATION_REQUIRED';
  paidThrough: number; failures: number; nextAttemptAt: number; lastError?: string;
  grantId: string; paymentTx: string; workerId?: string;
  attempts?: Array<{ at: number; reason: string; paymentTx?: string }>;
  humanId?: string; worldProofId?: string;
};
export type SubscriptionPeriod = {
  id: string; subscriptionId: string; due: number;
  stage: 'signed' | 'submitted' | 'confirmed' | 'minting' | 'complete' | 'failed';
  hash: string; raw: string; paidThrough?: number; grantId?: string; platformFeeAmount?: string;
};
export const RETRY_OFFSETS = [120, 3600, 21600, 86400];

export const COLLECTION_WINDOW = 86400 + 300; // Allow confirmation/scheduler jitter on the last retry.
