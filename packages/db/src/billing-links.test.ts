import { expect, it } from 'vitest';
import { billingDocumentAccess, verifyBillingDocumentAccess } from './billing-links.js';
it('limits a billing email link to one document and its expiry', () => {
  const id = 'inv_' + 'a'.repeat(32), other = 'inv_' + 'b'.repeat(32), secret = 'secret'.repeat(8);
  const token = billingDocumentAccess(id, 2000, secret);
  expect(verifyBillingDocumentAccess(id, token, secret, 1000000)).toBe(true);
  expect(verifyBillingDocumentAccess(other, token, secret, 1000000)).toBe(false);
  expect(verifyBillingDocumentAccess(id, token, secret, 2000000)).toBe(false);
  expect(verifyBillingDocumentAccess(id, token + 'x', secret, 1000000)).toBe(false);
  expect(verifyBillingDocumentAccess(id, token, 'other'.repeat(8), 1000000)).toBe(false);
});
