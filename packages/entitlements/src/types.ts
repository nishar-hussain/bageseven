import { z } from 'zod';
/** A failure known to have happened before signing or broadcasting any transaction. */
export class EntitlementPreflightError extends Error {
  constructor(...details: string[]) { super(details.join(': ')); }
}

/** Three clocks: payment happened, renewal may continue, access is still live. */
export const GrantSchema = z.object({
  id: z.string().min(1),
  feature: z.string().min(1),
  holder: z.string().min(1),
  human_id: z.string().min(1).optional(),
  merchant: z.string().min(1).optional(),
  enabled: z.boolean(),
  remaining: z.string(),
  renewal_enabled: z.boolean(),
  paid_through: z.string().datetime(),
  payment_tx: z.string().optional(),
  settlement_network: z.enum(['avalanche', 'local']).default('local'),
  mandate_id: z.string().optional(),
  worker_id: z.string().optional(),
  schema_version: z.literal(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** Contract provenance; absent from the offline memory store. */
  registry_address: z.string().optional(),
  registry_grant_id: z.string().optional(),
});

export type Grant = z.infer<typeof GrantSchema>;

export const MintGrantInputSchema = z.object({
  /** Internal fulfillment identity: one grant per confirmed subscription period. */
  id: z.string().uuid().optional(),
  feature: z.string().min(1),
  holder: z.string().min(1),
  human_id: z.string().min(1).optional(),
  merchant: z.string().min(1).optional(),
  remaining: z.string().default('10'),
  ttl_seconds: z.number().int().positive().default(3600),
  payment_tx: z.string().optional(),
  customer_wallet: z.string().optional(),
  payment_signature: z.string().optional(),
  settlement_network: z.enum(['avalanche', 'local']).default('avalanche'),
  mandate_id: z.string().optional(),
  worker_id: z.string().optional(),
  renewal_enabled: z.boolean().default(true),
});

export type MintGrantInput = z.infer<typeof MintGrantInputSchema>;

export type GrantStoreDescribe = {
  mode: 'memory' | 'avalanche';
  rpcUrl?: string;
  live?: boolean;
};

export interface GrantStore {
  mint(input: MintGrantInput): Promise<Grant>;
  get(id: string): Promise<Grant | null>;
  findLive(query: { holder?: string; feature?: string; worker_id?: string }): Promise<Grant[]>;
  consume(id: string, amount: string, idempotencyKey: string): Promise<Grant>;
  cancelRenewal(id: string): Promise<Grant>;
  hold(id: string, amount: string, holdId: string): Promise<Grant>;
  commit(holdId: string): Promise<Grant>;
  release(holdId: string): Promise<Grant>;
  describe(): GrantStoreDescribe;
}
