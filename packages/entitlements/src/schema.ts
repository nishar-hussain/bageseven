import { dec, defineSchema, str } from '@arkiv-network/sdk/schema';

/**
 * Public Arkiv schema for Bagseven grants.
 * See `/arkiv/schema.md` for judge-facing docs.
 */
export const BagsevenGrants = defineSchema('bagseven_grants', {
  grant_id: str().indexed(),
  feature: str().indexed(),
  holder: str().indexed(),
  human_id: str().indexed(),
  merchant: str(),
  enabled: str().indexed(),
  remaining: dec().indexed(),
  renewal_enabled: str().indexed(),
  paid_through: str(),
  payment_tx: str().indexed(),
  settlement_network: str().indexed(),
  world_proof_id: str(),
  mandate_id: str().indexed(),
  worker_id: str().indexed(),
  created_at: str(),
  updated_at: str(),
});

export type BagsevenGrantsSchema = typeof BagsevenGrants;
