import { describe, expect, it } from 'vitest';
import { verifyWorldAgentPass } from './index.js';

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
