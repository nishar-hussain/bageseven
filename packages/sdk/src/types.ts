/** ArcenPay / Schematic-style: boolean = on/off until TTL; numeric = metered credits on Registry. */
export type FeatureValueType = 'boolean' | 'numeric';

export type Entitlement = {
  feature: string;
  /** Whether the living Registry grant currently grants access. */
  enabled: boolean;
  value_type?: FeatureValueType;
  remaining: string;
  allocation: string;
  /** Sum of living grants for this holder and feature (check endpoint). */
  total_remaining?: string;
  /** Version of the confirmed grant snapshot; used to reject stale reads. */
  updated_at?: string;
  paid_through: string | null;
  grant_id: string | null;
  registry_grant_id?: string;
  registry_address?: string;
  payment_tx?: string;
  explorer_url?: string | null;
  settlement_network?: string;
  renewal_enabled?: boolean;
  /** Same as enabled — handy for boolean feature flags. */
  value?: boolean;
};

export type ConsumeResult = {
  entitlement: Entitlement;
  grant?: unknown;
  dual_gate?: { mandate: string; grant: string };
};

export type IdentifyResult = {
  token: string;
  holder: string;
  expires_in: number;
};

export type Subscription = {
  id: string; checkout_id: string; holder: string; plan_id: string; feature: string;
  amount: string; credits: string; period_seconds: number; status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'ENDED' | 'RECONCILIATION_REQUIRED';
  contract: string; subscription_key: string; chain_id: number; payer: string; paid_through: string;
  next_attempt_at: string; failures: number; last_error: string | null; grant_id: string; payment_tx: string;
  token: string; cancel_data: string; attempts: Array<{ at: number; reason: string; paymentTx?: string }>;
};
