import { describe, expect, it } from 'vitest';
import { errorMessage } from '../lib/error-message';

describe('user-facing wallet errors', () => {
  it('shows a plain JSON-RPC rejection instead of object Object', () => {
    expect(errorMessage({ code: -32603, message: { message: 'Wallet is locked. Unlock it and retry.' } })).toBe('Wallet is locked. Unlock it and retry.');
    expect(errorMessage({ code: -32603, data: { originalError: { message: 'Signing is unavailable on this wallet.' } } })).toBe('Signing is unavailable on this wallet.');
  });
  it('gives actionable rejection and pending-request messages', () => {
    expect(errorMessage({ code: 4001, message: 'User rejected the request.' })).toMatch(/declined/i);
    expect(errorMessage({ code: -32002, message: 'Request already pending.' })).toMatch(/pending.*wallet/i);
    expect(errorMessage(new Error('Network unavailable'))).toBe('Network unavailable');
  });
  it('uses a safe fallback for unknown, empty and circular failures', () => {
    const circular: { cause?: unknown } = {}; circular.cause = circular;
    expect(errorMessage(circular, 'Could not authorize')).toBe('Could not authorize');
    expect(errorMessage({}, 'Could not authorize')).toBe('Could not authorize');
    expect(errorMessage(new Error(''), 'Could not authorize')).toBe('Could not authorize');
  });
});
