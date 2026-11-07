import { describe, expect, it } from 'vitest';
import { str } from '@arkiv-network/sdk/schema';
import { decodeGrantIdentities, encodeGrantIdentities, identityIndex } from './grant-identities.js';

describe('Arkiv World identity storage', () => {
  it('keeps long World identities losslessly outside the 128-byte string index', () => {
    const holder = `world:${'a'.repeat(150)}`;
    const merchant = `world:${'b'.repeat(150)}`;
    expect(() => str(holder)).toThrow('128-byte');
    const encoded = encodeGrantIdentities({ holder, merchant, human_id: '世'.repeat(100), world_proof_id: 'proof'.repeat(50) });
    for (const field of ['holder', 'merchant', 'human_id', 'world_proof_id'] as const) expect(() => str(encoded[field])).not.toThrow();
    expect(decodeGrantIdentities(encoded.identity_data)).toEqual({ holder, merchant, human_id: '世'.repeat(100), world_proof_id: 'proof'.repeat(50) });
    expect(identityIndex(holder)).not.toBe(identityIndex(`${holder}x`));
  });
  it('preserves old short-identity records and measures UTF-8 bytes', () => {
    expect(encodeGrantIdentities({ holder: 'buyer@example.com' })).toEqual({ holder: 'buyer@example.com', human_id: '', merchant: '', world_proof_id: '' });
    expect(decodeGrantIdentities(undefined)).toEqual({});
    expect(identityIndex('a'.repeat(128))).toBe('a'.repeat(128));
    expect(identityIndex('世'.repeat(43))).toMatch(/^sha256:/);
  });
});
