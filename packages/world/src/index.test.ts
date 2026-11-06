import { describe, expect, it } from 'vitest';
import { buildWorldAuthorizeUrl, verifyWorldAgentPass, WORLD_AUTHORIZE_URL } from './index.js';

describe('buildWorldAuthorizeUrl', () => {
  it('uses discovery authorize path with S256 PKCE', () => {
    const url = buildWorldAuthorizeUrl({
      clientId: 'app_test',
      redirectUri: 'http://127.0.0.1:3000/app/mint',
      state: 'st',
      codeChallenge: 'challenge',
    });
    expect(url.startsWith(WORLD_AUTHORIZE_URL)).toBe(true);
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('client_id=app_test');
  });
});

describe('verifyWorldAgentPass', () => {
  it('allows mock ok proof', async () => {
    const r = await verifyWorldAgentPass({ world_proof_id: 'world:ok:alice' }, { WORLD_MOCK_PROOFS: 'true' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.human_id).toBe('alice');
  });

  it('denies cancel / expire / deny without mint side effects', async () => {
    for (const proof of ['world:cancel:x', 'world:expire:x', 'world:deny:x']) {
      const r = await verifyWorldAgentPass({ world_proof_id: proof }, {});
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('WORLD_DENIED');
    }
  });

  it('honors world_denied boolean', async () => {
    const r = await verifyWorldAgentPass({ world_denied: true, world_proof_id: 'world:ok:x' }, {});
    expect(r.ok).toBe(false);
  });
});
