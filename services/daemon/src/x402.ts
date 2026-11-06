import { decodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { ApiError } from '@bagseven/server';

export const AVALANCHE_FUJI_NETWORK = 'eip155:43113';

export interface X402Requirements {
  x402Version: 2;
  scheme: string;
  network: string;
  amount: string;
  payTo: `0x${string}`;
  asset: `0x${string}`;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface X402PolicyLimits {
  perPurchaseCap: bigint;
  remainingWindow: bigint;
  remainingLifetime: bigint;
  vaultAvailable: bigint;
}

export type SettlementState =
  | { state: 'settled'; transaction?: string; network?: string }
  | { state: 'pending'; transaction?: string; network?: string; reason?: string }
  | { state: 'failed'; reason: string };

export function x402ChallengeKey(hostname: string, requirement: X402Requirements): string {
  return `x402:v2:${hostname.toLowerCase()}:${requirement.network}:${requirement.asset.toLowerCase()}:${requirement.amount}:${requirement.payTo.toLowerCase()}`;
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function parseAtomicAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ApiError(502, 'X402_INVALID_AMOUNT', 'x402 amount must be an unsigned atomic-unit string');
  }
  const amount = BigInt(value);
  if (amount <= 0n) throw new ApiError(502, 'X402_INVALID_AMOUNT', 'x402 amount must be greater than zero');
  return amount;
}

/** Decode the official PAYMENT-REQUIRED header or JSON body. */
export function decodeX402PaymentRequired(header?: string | null, body?: unknown): PaymentRequired {
  if (header) {
    try { return decodePaymentRequiredHeader(header); }
    catch (error) { throw new ApiError(502, 'X402_INVALID_REQUIREMENTS', `invalid PAYMENT-REQUIRED header: ${(error as Error).message}`); }
  }
  if (!body || typeof body !== 'object') throw new ApiError(502, 'X402_INVALID_REQUIREMENTS', 'x402 payment requirements are missing');
  return body as PaymentRequired;
}

/** Select and validate an exact USDC payment option for the configured EVM testnet. */
export function selectX402Requirements(
  payment: PaymentRequired,
  expectedAsset: `0x${string}`,
  expectedNetwork = AVALANCHE_FUJI_NETWORK,
): X402Requirements {
  if (payment.x402Version !== 2) throw new ApiError(501, 'X402_VERSION_UNSUPPORTED', `x402 version ${payment.x402Version} is not supported`);
  const option = payment.accepts?.find((candidate) => candidate.scheme === 'exact' && candidate.network === expectedNetwork && candidate.asset.toLowerCase() === expectedAsset.toLowerCase());
  if (!option) {
    throw new ApiError(501, 'X402_REQUIREMENT_UNSUPPORTED', `provider has no exact ${expectedNetwork} payment option for the configured USDC token`, { accepts: payment.accepts });
  }
  if (!isAddress(option.payTo)) throw new ApiError(502, 'X402_INVALID_RECIPIENT', 'x402 payTo is not a valid EVM address');
  const amount = parseAtomicAmount(option.amount);
  const timeout = option.maxTimeoutSeconds;
  if (!Number.isInteger(timeout) || timeout <= 0) throw new ApiError(502, 'X402_INVALID_TIMEOUT', 'x402 maxTimeoutSeconds must be a positive integer');
  return { x402Version: 2, scheme: option.scheme, network: option.network, amount: amount.toString(), payTo: option.payTo as `0x${string}`, asset: option.asset as `0x${string}`, maxTimeoutSeconds: timeout, extra: option.extra as Record<string, unknown> | undefined };
}

/** Apply the same budget bounds before any x402 signing or reservation. */
export function validateX402AgainstPolicy(requirement: X402Requirements, limits: X402PolicyLimits): bigint {
  const amount = BigInt(requirement.amount);
  if (amount > limits.perPurchaseCap) throw new ApiError(403, 'X402_PER_PURCHASE_LIMIT', 'x402 amount exceeds the mandate per-purchase limit');
  if (amount > limits.remainingWindow) throw new ApiError(403, 'X402_WINDOW_LIMIT', 'x402 amount exceeds the remaining mandate window budget');
  if (amount > limits.remainingLifetime) throw new ApiError(403, 'X402_LIFETIME_LIMIT', 'x402 amount exceeds the remaining mandate lifetime budget');
  if (amount > limits.vaultAvailable) throw new ApiError(403, 'X402_VAULT_LIMIT', 'x402 amount exceeds the available vault balance');
  return amount;
}

/**
 * Kept as an explicit guard for deployments that have not configured the
 * isolated Fuji testnet payer. A BagMandate vault is not itself an EIP-3009
 * payer; the daemon must never silently fall back to the operator or enforcer.
 */
export function assertVaultSupportsEip3009(): never {
  throw new ApiError(
    501,
    'X402_VAULT_EIP3009_UNSUPPORTED',
    'BagMandate vault cannot produce EIP-3009 transferWithAuthorization; x402 v2 settlement is disabled until a vault-compatible facilitator flow is deployed',
  );
}

export function classifyX402Settlement(input: { ok: boolean; transaction?: string; network?: string; body?: unknown }): SettlementState {
  if (input.ok) return { state: 'settled', transaction: input.transaction, network: input.network };
  if (input.transaction || (typeof input.body === 'object' && input.body !== null && (input.body as { settlement_pending?: boolean }).settlement_pending)) {
    return { state: 'pending', transaction: input.transaction, network: input.network, reason: 'provider reported settlement pending' };
  }
  return { state: 'failed', reason: typeof input.body === 'string' ? input.body : 'x402 settlement failed' };
}
