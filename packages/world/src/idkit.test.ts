import { afterEach, describe, expect, it, vi } from 'vitest';
import { signWorldIdKitRequest, verifyWorldIdKitProof } from './idkit.js';
import { worldMocksAllowed } from './config.js';
import { verifyWorldAgentPass } from './index.js';
const proof = { protocol_version: '4.0', nonce: 'nonce', action: 'bagseven-mint', responses: [{ identifier: 'proof_of_human', nullifier: '0x123456', proof: 'proof' }] };
afterEach(() => vi.unstubAllGlobals());

describe('live World verification', () => {
  it('rejects mocks by default and in production even if explicitly enabled', async () => {
    expect(worldMocksAllowed({})).toBe(false);
    expect(worldMocksAllowed({ WORLD_MOCK_PROOFS: 'true', NODE_ENV: 'production' })).toBe(false);
    expect((await verifyWorldAgentPass({ world_proof_id: 'world:ok:forged' }, { WORLD_MOCK_PROOFS: 'false' })).ok).toBe(false);
    expect((await verifyWorldAgentPass({}, { WORLD_MOCK_PROOFS: 'true', NODE_ENV: 'production' })).ok).toBe(false);
  });
  it('refuses an RP key that does not match the registered signer address', () => {
    expect(() => signWorldIdKitRequest({ signingKeyHex: `0x${'01'.repeat(32)}`, action: 'bagseven-mint', expectedSignerAddress: '0x0000000000000000000000000000000000000001' })).toThrow('WORLD_SIGNER_MISMATCH');
  });
  it('forwards the complete result to the official verifier and keeps the full identity', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, action: proof.action, environment: 'production' })));
    vi.stubGlobal('fetch', fetcher);
    const result = await verifyWorldIdKitProof({ rpId: 'rp_test', idkitResponse: proof, expectedAction: proof.action });
    expect(result).toMatchObject({ ok: true, human_id: 'world:nullifier:0x123456' });
    expect(fetcher).toHaveBeenCalledWith('https://developer.world.org/api/v4/verify/rp_test', expect.objectContaining({ body: JSON.stringify({ ...proof, environment: 'production' }) }));
  });
  it.each([
    { ...proof, action: 'other-action' },
    { ...proof, environment: 'staging' },
    { ...proof, action: undefined },
    { ...proof, nonce: undefined },
    { ...proof, responses: [] },
  ])('rejects an incorrect or incomplete request before calling World', async (payload) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await verifyWorldIdKitProof({ rpId: 'rp_test', idkitResponse: payload, expectedAction: proof.action })).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects a denied proof instead of falling back to a mock', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 403 })));
    expect((await verifyWorldIdKitProof({ rpId: 'rp_test', idkitResponse: proof, expectedAction: proof.action })).ok).toBe(false);
  });
  it('never turns a replay rejection into an authenticated returning user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'nullifier_replayed' }), { status: 400 })));
    expect((await verifyWorldIdKitProof({ rpId: 'rp_test', idkitResponse: proof, expectedAction: proof.action })).ok).toBe(false);
  });
  it('keeps the verified session as account identity when per-proof nullifiers change', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))));
    const results = [];
    for (const nullifier of ['first', 'second']) {
      results.push(await verifyWorldIdKitProof({ rpId: 'rp_test', sessionProof: true, expectedSessionId: 'session_account', idkitResponse: {
        protocol_version: '4.0', nonce: `nonce-${nullifier}`, session_id: 'session_account', responses: [{ identifier: 'proof_of_human', session_nullifier: [nullifier, 'action'], proof: [] }],
      } }));
    }
    for (const result of results) expect(result).toMatchObject({ ok: true, human_id: 'world:session:session_account', session_id: 'session_account' });
  });
  it('rejects a different saved session or weaker credential before calling World', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const response of [
      { session_id: 'session_wrong', responses: [{ identifier: 'proof_of_human', session_nullifier: ['n', 'a'] }] },
      { session_id: 'session_saved', responses: [{ identifier: 'selfie', session_nullifier: ['n', 'a'] }] },
    ]) {
      expect((await verifyWorldIdKitProof({ rpId: 'rp_test', sessionProof: true, expectedSessionId: 'session_saved', idkitResponse: { protocol_version: '4.0', nonce: 'nonce', ...response } })).ok).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
