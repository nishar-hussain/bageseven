import { describe, expect, it } from 'vitest';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { ApiError } from '@bagseven/server';
import { assertVaultSupportsEip3009, classifyX402Settlement, decodeX402PaymentRequired, selectX402Requirements, validateX402AgainstPolicy, x402ChallengeKey } from './x402.js';

const asset = '0x5425890298aed601595a70AB815c96711a31Bc65' as `0x${string}`;
const payTo = '0xE3837fE309618AE075DbeF0A20735c0615a308E6' as `0x${string}`;
const payment: PaymentRequired = {
  x402Version: 2,
  resource: { url: 'https://provider.example/resource' },
  accepts: [{ scheme: 'exact', network: 'eip155:43113', amount: '10000', payTo, asset, maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } }],
};

function expectCode(fn: () => unknown, code: string): void {
  try { fn(); throw new Error('expected function to throw'); }
  catch (error) { expect(error).toBeInstanceOf(ApiError); expect((error as ApiError).code).toBe(code); }
}

describe('x402 v2 Avalanche Fuji adapter', () => {
  it('decodes the official PAYMENT-REQUIRED header and selects exact USDC', () => {
    const decoded = decodeX402PaymentRequired(encodePaymentRequiredHeader(payment));
    expect(selectX402Requirements(decoded, asset)).toMatchObject({ network: 'eip155:43113', amount: '10000', payTo, asset });
  });

  it('selects exact USDC on Avalanche Fuji when configured', () => {
    expect(selectX402Requirements(payment, asset)).toMatchObject({ network: 'eip155:43113', amount: '10000' });
  });

  it('rejects unsupported networks', () => {
    const unsupported = { ...payment, accepts: [{ ...payment.accepts[0], network: 'eip155:11155111' }] } as PaymentRequired;
    expectCode(() => selectX402Requirements(unsupported, asset), 'X402_REQUIREMENT_UNSUPPORTED');
  });

  it('rejects invalid recipients', () => {
    const invalid = { ...payment, accepts: [{ ...payment.accepts[0], payTo: 'not-an-address' }] } as PaymentRequired;
    expectCode(() => selectX402Requirements(invalid, asset), 'X402_INVALID_RECIPIENT');
  });

  it('rejects amounts above the mandate policy', () => {
    const selected = selectX402Requirements(payment, asset);
    expectCode(() => validateX402AgainstPolicy(selected, { perPurchaseCap: 9_999n, remainingWindow: 100_000n, remainingLifetime: 100_000n, vaultAvailable: 100_000n }), 'X402_PER_PURCHASE_LIMIT');
  });

  it('fails closed because the existing vault cannot sign EIP-3009', () => {
    expectCode(() => assertVaultSupportsEip3009(), 'X402_VAULT_EIP3009_UNSUPPORTED');
  });

  it('denies when the mandate remaining window is insufficient', () => {
    const selected = selectX402Requirements(payment, asset);
    expectCode(() => validateX402AgainstPolicy(selected, { perPurchaseCap: 100_000n, remainingWindow: 9_999n, remainingLifetime: 100_000n, vaultAvailable: 100_000n }), 'X402_WINDOW_LIMIT');
  });

  it('produces a stable replay key for duplicate requests', () => {
    const selected = selectX402Requirements(payment, asset);
    const seen = new Set<string>();
    const key = x402ChallengeKey('Provider.Example', selected);
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    expect(seen.has(x402ChallengeKey('provider.example', selected))).toBe(true);
  });

  it('classifies failed and pending settlement without claiming success', () => {
    expect(classifyX402Settlement({ ok: false, body: { error: 'reverted' } })).toEqual({ state: 'failed', reason: 'x402 settlement failed' });
    expect(classifyX402Settlement({ ok: false, transaction: '0xabc', network: 'eip155:43113' })).toMatchObject({ state: 'pending', transaction: '0xabc' });
    expect(classifyX402Settlement({ ok: true, transaction: '0xdef', network: 'eip155:43113' })).toEqual({ state: 'settled', transaction: '0xdef', network: 'eip155:43113' });
  });
});
