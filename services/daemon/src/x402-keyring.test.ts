import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { EncryptedX402Keyring, transferAuthorizationTypes } from './x402-keyring.js';
describe('isolated payment key custody', () => {
  it('signs only for its bound payer and rejects moving encrypted keys between authorities', async () => {
    const keys = new EncryptedX402Keyring({ X402_PAYMENT_ENCRYPTION_KEY: 'ab'.repeat(32) });
    const key = await keys.create('provider:mandate:merchant');
    expect(key.reference).not.toContain(key.address);
    const authorization = { from: key.address, to: `0x${'11'.repeat(20)}` as const, value: 1n,
      validAfter: 0n, validBefore: 1800000000n, nonce: `0x${'22'.repeat(32)}` as const };
    const domain = { name: 'USD Coin', version: '2', chainId: 43113, verifyingContract: `0x${'33'.repeat(20)}` as const };
    const signature = await keys.sign('provider:mandate:merchant', key.reference, authorization, domain);
    expect((await recoverTypedDataAddress({ domain, types: transferAuthorizationTypes,
      primaryType: 'TransferWithAuthorization', message: authorization, signature })).toLowerCase()).toBe(key.address.toLowerCase());
    await expect(keys.sign('other-provider', key.reference, authorization, domain)).rejects.toThrow();
    await expect(keys.sign('provider:mandate:merchant', key.reference, { ...authorization, from: authorization.to }, domain)).rejects.toThrow('SIGNER_MISMATCH');
  });
  it('requires a separate payment encryption secret', async () => {
    await expect(new EncryptedX402Keyring({ PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32) }).create('binding')).rejects.toThrow('KEY_MANAGEMENT_REQUIRED');
    await expect(new EncryptedX402Keyring({ PROVIDER_GAS_ENCRYPTION_KEY: 'ab'.repeat(32), X402_PAYMENT_ENCRYPTION_KEY: 'ab'.repeat(32) }).create('binding')).rejects.toThrow('SEPARATE_ENCRYPTION_KEY_REQUIRED');
  });
});
