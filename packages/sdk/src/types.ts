export type Entitlement = {
  feature: string;
  enabled: boolean;
  remaining: string;
  allocation: string;
  paid_through: string | null;
  grant_id: string | null;
  arkiv_entity_key?: string;
  payment_tx?: string;
  explorer_url?: string | null;
  settlement_network?: string;
  renewal_enabled?: boolean;
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
