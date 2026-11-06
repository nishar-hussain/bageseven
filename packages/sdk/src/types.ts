/** ArcenPay / Schematic-style: boolean = on/off until TTL; numeric = metered credits on Arkiv. */
export type FeatureValueType = 'boolean' | 'numeric';

export type Entitlement = {
  feature: string;
  /** Whether the living Arkiv grant currently grants access. */
  enabled: boolean;
  value_type?: FeatureValueType;
  remaining: string;
  allocation: string;
  paid_through: string | null;
  grant_id: string | null;
  arkiv_entity_key?: string;
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
