import { signRequest } from '@worldcoin/idkit-core/signing';
import { z } from 'zod';
import { privateKeyToAccount } from 'viem/accounts';

const VERIFY_URL = (rpId: string) => `https://developer.world.org/api/v4/verify/${encodeURIComponent(rpId)}`;

export type RpSignature = {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
};

/** Server-only: sign an IDKit proof request with the Developer Portal RP signing key. */
export function signWorldIdKitRequest(input: {
  signingKeyHex: string;
  /** Omit for session-only proofs (World ID 4.0 returning-user checks). */
  action?: string;
  ttl?: number;
  expectedSignerAddress?: string;
}): RpSignature {
  const key = input.signingKeyHex.startsWith('0x') ? input.signingKeyHex : `0x${input.signingKeyHex}`;
  const signer = privateKeyToAccount(key as `0x${string}`);
  if (input.expectedSignerAddress && signer.address.toLowerCase() !== input.expectedSignerAddress.toLowerCase()) {
    throw new Error('WORLD_SIGNER_MISMATCH: RP signing key does not match WORLD_SIGNER_ADDRESS');
  }
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: key,
    ...(input.action ? { action: input.action } : {}),
    ttl: input.ttl ?? 300,
  });
  return {
    sig,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
  };
}

export const IdKitResultSchema = z
  .object({
    protocol_version: z.enum(['3.0', '4.0']),
    nonce: z.string().min(1),
    action: z.string().min(1).optional(),
    session_id: z.string().optional(),
    environment: z.string().optional(),
    responses: z.array(z.record(z.string(), z.unknown())).min(1),
  })
  .passthrough()
  .refine((v) => Boolean(v.action || v.session_id), { message: 'IDKit result needs action or session_id' });

export type IdKitResult = z.infer<typeof IdKitResultSchema>;

export type IdKitVerifyOk = {
  ok: true;
  nullifier: string;
  action: string;
  human_id: string;
  world_proof_id: string;
  environment: string;
  verification: Record<string, unknown>;
  returning?: boolean;
  session_id?: string;
};

export type IdKitVerifyFail = {
  ok: false;
  code: 'WORLD_DENIED' | 'WORLD_IDKIT_FAILED';
  detail: string;
};

function extractNullifier(result: IdKitResult): string | null {
  const responses = result.responses ?? [];
  for (const row of responses) {
    const n = row.nullifier;
    if (typeof n === 'string' && n.length > 0) return n;
    const sn = row.session_nullifier;
    if (Array.isArray(sn) && typeof sn[0] === 'string') return sn[0];
  }
  return null;
}

/**
 * Forward IDKit result to Developer Portal verify API and require success.
 * Caller must enforce nullifier uniqueness for one-time mint actions.
 *
 * Login may set `allowReturningUser`: World ID 4.0 uniqueness nullifiers are
 * one-shot per action. A second login yields `nullifier_replayed` — docs say
 * treat that as already-verified for returning users (docs.world.org error codes).
 */
export async function verifyWorldIdKitProof(input: {
  rpId: string;
  idkitResponse: unknown;
  expectedEnvironment?: string;
  expectedAction?: string;
  /** When true, nullifier_replayed / max_verifications_reached still signs the human in. */
  allowReturningUser?: boolean;
}): Promise<IdKitVerifyOk | IdKitVerifyFail> {
  const expectedEnvironment = input.expectedEnvironment ?? 'production';
  let parsed: IdKitResult;
  try {
    parsed = IdKitResultSchema.parse(input.idkitResponse);
  } catch {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Invalid IDKit payload' };
  }

  if (parsed.environment && parsed.environment !== expectedEnvironment) {
    return {
      ok: false,
      code: 'WORLD_IDKIT_FAILED',
      detail: `IDKit environment mismatch (got ${parsed.environment}, want ${expectedEnvironment})`,
    };
  }
  if (input.expectedAction && parsed.action && parsed.action !== input.expectedAction) {
    return {
      ok: false,
      code: 'WORLD_IDKIT_FAILED',
      detail: `IDKit action mismatch (got ${parsed.action}, want ${input.expectedAction})`,
    };
  }

  const response = await fetch(VERIFY_URL(input.rpId), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ ...parsed, environment: expectedEnvironment }),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  let verification: Record<string, unknown>;
  try {
    verification = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: `Verify API non-JSON (${response.status})` };
  }

  const portalCode = typeof verification.code === 'string' ? verification.code : '';
  const returningCodes = new Set(['nullifier_replayed', 'max_verifications_reached']);

  if ((!response.ok || verification.success !== true) && input.allowReturningUser && returningCodes.has(portalCode)) {
    const nullifier = extractNullifier(parsed);
    if (!nullifier) {
      return { ok: false, code: 'WORLD_DENIED', detail: portalCode };
    }
    // Portal already recognized this nullifier for the action — proof was accepted before uniqueness reject.
    const action = parsed.action || input.expectedAction || 'login';
    const session_id = typeof parsed.session_id === 'string' ? parsed.session_id : undefined;
    return {
      ok: true,
      returning: true,
      nullifier,
      action,
      human_id: `world:nullifier:${nullifier}`,
      world_proof_id: `world:idkit:${action}:${nullifier}`,
      environment: expectedEnvironment,
      verification,
      session_id,
    };
  }

  if (!response.ok || verification.success !== true) {
    const detail =
      typeof verification.detail === 'string'
        ? verification.detail
        : portalCode || `Verify API failed (${response.status})`;
    return { ok: false, code: 'WORLD_DENIED', detail };
  }
  if (verification.environment && verification.environment !== expectedEnvironment) {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Verify response environment mismatch' };
  }
  if (verification.action && parsed.action && verification.action !== parsed.action) {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Verify response action mismatch' };
  }

  const nullifier = extractNullifier(parsed);
  if (!nullifier) {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Verified payload missing nullifier' };
  }
  if (typeof verification.nullifier === 'string' && verification.nullifier !== nullifier) {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Verify response nullifier mismatch' };
  }
  const action = parsed.action || input.expectedAction || 'unknown';
  const session_id =
    typeof verification.session_id === 'string'
      ? verification.session_id
      : typeof parsed.session_id === 'string'
        ? parsed.session_id
        : undefined;
  return {
    ok: true,
    nullifier,
    action,
    human_id: `world:nullifier:${nullifier}`,
    world_proof_id: `world:idkit:${action}:${nullifier}`,
    environment: expectedEnvironment,
    verification,
    session_id,
  };
}
