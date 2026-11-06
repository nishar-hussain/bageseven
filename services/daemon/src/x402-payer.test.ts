import { describe, expect, it } from 'vitest';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { X402Payer } from './x402-payer.js';

const payment: PaymentRequired = {
  x402Version: 2,
  resource: { url: 'https://provider.example/resource' },
  accepts: [{
    scheme: 'exact',
    network: 'eip155:43113',
    amount: '10000',
    payTo: '0x1111111111111111111111111111111111111111',
    asset: '0x5425890298aed601595a70AB815c96711a31Bc65',
    maxTimeoutSeconds: 300,
    extra: { name: 'USDC', version: '2' },
  }],
};

const requirement = {
  x402Version: 2 as const,
  scheme: 'exact',
  network: 'eip155:43113',
  amount: '10000',
  payTo: '0x1111111111111111111111111111111111111111' as `0x${string}`,
  asset: '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`,
  maxTimeoutSeconds: 300,
  extra: { name: 'USDC', version: '2' },
};

describe('isolated x402 payer', () => {
  it('creates a valid EIP-3009 payment signature header without using the operator key', async () => {
    const payer = new X402Payer({
      key: '0x0123456789012345678901234567890123456789012345678901234567890123',
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 43113,
      usdc: requirement.asset,
    });
    const paymentResult = await payer.createPayment(payment, requirement);
    const decoded = decodePaymentSignatureHeader(paymentResult.header);
    const payload = decoded.payload as { signature: string; authorization: { from: string; to: string; value: string; validBefore: string; nonce: string } };
    expect(payload.signature).toMatch(/^0x[0-9a-f]+$/);
    expect(payload.authorization.from.toLowerCase()).toBe(payer.account.address.toLowerCase());
    expect(payload.authorization.to.toLowerCase()).toBe(requirement.payTo.toLowerCase());
    expect(payload.authorization.value).toBe('10000');
    expect(payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(paymentResult.amount).toBe(10000n);
  });

  it('rejects unsupported payer chain configuration', () => {
    expect(() => new X402Payer({ key: '0x0123456789012345678901234567890123456789012345678901234567890123', rpcUrl: 'http://127.0.0.1:8545', chainId: 11155111, usdc: requirement.asset })).toThrow('unsupported chain id');
  });

  it('supports Avalanche Fuji payer configuration', async () => {
    const payer = new X402Payer({
      key: '0x0123456789012345678901234567890123456789012345678901234567890123',
      rpcUrl: 'http://127.0.0.1:8545',
      chainId: 43113,
      usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
    });
    expect(payer.account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
