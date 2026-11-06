import { signRequest } from '@worldcoin/idkit-core/signing';
import { z } from 'zod';

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
  action: string;
  ttl?: number;
}): RpSignature {
  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex: input.signingKeyHex,
    action: input.action,
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
    protocol_version: z.string().optional(),
    nonce: z.string().optional(),
    action: z.string().optional(),
    environment: z.string().optional(),
    responses: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export type IdKitResult = z.infer<typeof IdKitResultSchema>;

export type IdKitVerifyOk = {
  ok: true;
  nullifier: string;
  action: string;
  human_id: string;
  world_proof_id: string;
  environment: string;
  verification: Record<string, unknown>;
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
 * Caller must enforce nullifier uniqueness (replay protection).
 */
export async function verifyWorldIdKitProof(input: {
  rpId: string;
  idkitResponse: unknown;
  expectedEnvironment?: string;
  expectedAction?: string;
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
  });
  const raw = await response.text();
  let verification: Record<string, unknown> = {};
  try {
    verification = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: `Verify API non-JSON (${response.status})` };
  }
  if (!response.ok || verification.success !== true) {
    const detail =
      typeof verification.detail === 'string'
        ? verification.detail
        : typeof verification.code === 'string'
          ? verification.code
          : `Verify API failed (${response.status})`;
    return { ok: false, code: 'WORLD_DENIED', detail };
  }
  if (verification.environment && verification.environment !== expectedEnvironment) {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Verify response environment mismatch' };
  }

  const nullifier = extractNullifier(parsed);
  if (!nullifier) {
    return { ok: false, code: 'WORLD_IDKIT_FAILED', detail: 'Verified payload missing nullifier' };
  }
  const action = parsed.action || input.expectedAction || 'unknown';
  return {
    ok: true,
    nullifier,
    action,
    human_id: `world:nullifier:${nullifier.slice(0, 18)}`,
    world_proof_id: `world:idkit:${action}:${nullifier}`,
    environment: expectedEnvironment,
    verification,
  };
}
