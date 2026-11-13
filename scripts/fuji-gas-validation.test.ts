import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';
import { validateFujiGasFunding } from './fuji-gas-validation.mjs';
const signer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const to = `0x${'22'.repeat(20)}` as const;
const plan = {
  kind: 'bagseven_fuji_gas_v1',
  chainId: 43113,
  owner: signer.address,
  to,
  nonce: 1,
  value: '50000000000000000',
  gas: '26250',
  maxFeePerGas: '1000',
  maxPriorityFeePerGas: '10',
};
const tx = {
  type: 'eip1559' as const,
  chainId: 43113,
  to,
  nonce: 1,
  value: 50000000000000000n,
  gas: 26250n,
  maxFeePerGas: 1000n,
  maxPriorityFeePerGas: 10n,
};
describe('keystore-approved public Fuji gas deposits', () => {
  it('accepts only the exact reviewed native transfer', async () => {
    const raw = await signer.signTransaction(tx);
    expect(await validateFujiGasFunding(plan, raw)).toBe(keccak256(raw));
  });
  it('rejects changed destinations, values, network, calldata and fees', async () => {
    for (const change of [
      { to: `0x${'33'.repeat(20)}` as const },
      { value: 60000000000000000n },
      { chainId: 43114 },
      { data: '0x1234' as const },
      { maxFeePerGas: 2000n },
    ])
      await expect(
        validateFujiGasFunding(plan, await signer.signTransaction({ ...tx, ...change })),
      ).rejects.toThrow('reviewed transaction');
  });
  it('rejects another signer even if all transaction fields match', async () => {
    const another = privateKeyToAccount(`0x${'44'.repeat(32)}`);
    await expect(validateFujiGasFunding(plan, await another.signTransaction(tx))).rejects.toThrow(
      'signer mismatch',
    );
  });
  it('bounds a deposit and rejects invalid recipient plans', async () => {
    const raw = await signer.signTransaction(tx);
    await expect(validateFujiGasFunding({ ...plan, value: '100000000000000001' }, raw)).rejects.toThrow(
      'Invalid',
    );
    await expect(validateFujiGasFunding({ ...plan, to: `0x${'00'.repeat(20)}` }, raw)).rejects.toThrow(
      'Invalid',
    );
  });
});
