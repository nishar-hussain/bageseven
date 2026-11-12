import { z } from 'zod';
const address = z.string().regex(/^0x[\da-f]{40}$/i).transform(s => s.toLowerCase());
export const X402ApprovalInput = z.object({
  mandate_id: z.string().uuid(), worker_id: z.string().uuid(), merchant: address,
  provider_origin: z.string().url(), max_amount: z.string().regex(/^\d+(\.\d{1,6})?$/), expires: z.number().int(),
});
export const X402AuthorityTerms = z.object({
  kind: z.literal('bagseven_x402_authority_v1'), id: z.string().uuid(), provider: z.string().min(1),
  owner: address, mandate_id: z.string().uuid(), mandate_contract: address, worker_id: z.string().uuid(),
  chain_id: z.number().int(), token: address, payer: address, merchant: address,
  provider_origin: z.string().url(), facilitator: z.string().url(), max_amount: z.string(),
  expires: z.number().int(), nonce: z.string().uuid(), challenge_expires: z.number().int(),
});
export type X402Authority = z.infer<typeof X402AuthorityTerms>;
export function x402AuthorityMessage(terms: X402Authority) {
  return ['Bagseven isolated x402 payment authority',
    JSON.stringify(Object.fromEntries(Object.entries(terms).sort(([a], [b]) => a.localeCompare(b)))),
    'Approve only the stated token, chain, merchant and resource origin, funded by this mandate.',
    'This key has no owner or enforcer access to the main vault. Gas authority is unchanged.',
    'The vault applies its limits to funding the payer; downstream merchant restrictions are server-enforced.',
    'Unused job funding may return only to the same mandate. Refunds do not reset on-chain spend counters.',
    'Expiration and revocation stop new payment signing. Recovery of previously allocated funds remains permitted only to the original mandate.',
    'Existing payment signatures can settle until their expiration.',
  ].join('\n');
}
export const X402JobStates = ['PREPARED', 'FUNDING', 'FUNDED', 'SIGNED', 'SUBMITTED', 'PAID', 'SETTLED', 'REFUND_PENDING', 'RETURNED', 'REFUNDED', 'REJECTING', 'REJECTED', 'RECONCILIATION_REQUIRED'] as const;
export type X402JobState = typeof X402JobStates[number];
export type JournaledAuthorization = {
  from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string; signature: string;
};
export type X402JobData = {
  authority: X402Authority; amount: string; url: string; domain: { name: string; version: string };
  requirement: import('./x402.js').X402Requirements;
  fundingRaw?: string; fundingHash?: string; fundingBlock?: string; reservationId?: string;
  authorization?: JournaledAuthorization; refundAuthorization?: JournaledAuthorization;
  settlementHash?: string; refundHash?: string; providerStatus?: number; providerBody?: string;
  grantId?: string; completedResult?: unknown;
  holdApplied?: boolean; paymentScanBlock?: string; refundScanBlock?: string;
  authoritySignature?: string;
};
