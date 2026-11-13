import { createHmac, timingSafeEqual } from 'node:crypto';

const documentId = /^inv_[a-f0-9]{32}$/;
function sign(payload: string, secret: string) {
  if (secret.length < 32) throw Error('BILLING_LINK_SECRET_UNCONFIGURED');
  return createHmac('sha256', secret).update('bagseven-billing-document-v1:' + payload).digest('base64url');
}
/** A narrowly scoped, expiring invoice capability. No email or wallet authority in it. */
export function billingDocumentAccess(id: string, expires: number, secret: string) {
  if (!documentId.test(id) || !Number.isSafeInteger(expires)) throw Error('Invalid billing link');
  const payload = Buffer.from(JSON.stringify({ id, expires })).toString('base64url');
  return payload + '.' + sign(payload, secret);
}
export function verifyBillingDocumentAccess(id: string, token: string, secret: string, now = Date.now()) {
  try {
    if (!documentId.test(id) || token.length > 512) return false;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return false;
    const expected = Buffer.from(sign(payload, secret)), actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.id === id && Number.isSafeInteger(claims.expires) && claims.expires * 1000 > now;
  } catch { return false; }
}
export function billingDocumentUrl(origin: string, id: string, createdAt: Date, secret: string) {
  const url = new URL('/billing/' + id, origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid console origin');
  url.searchParams.set('access', billingDocumentAccess(id, Math.floor(createdAt.getTime() / 1000) + 30 * 86400, secret));
  return url.href;
}
