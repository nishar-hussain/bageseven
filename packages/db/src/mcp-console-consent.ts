import { createHash, randomBytes } from 'node:crypto';
import { CredentialStore } from './credentials.js';
import type { Database } from './client.js';
export type ConsoleConsentRequest = { exp: number; issuer: string; query: string; browserHash: string };
export type ConsoleConsentProof = ConsoleConsentRequest & { email: string; wallet: string };
export const consentBrowserHash = (nonce: string) => createHash('sha256').update(nonce).digest('hex');
/** Cross-origin session bridge: only opaque, short-lived, single-use values cross URLs. */
export class McpConsoleConsent {
  readonly requests: CredentialStore<ConsoleConsentRequest>;
  readonly proofs: CredentialStore<ConsoleConsentProof>;
  constructor(db: Database) {
    this.requests = new CredentialStore(db, 'mcp-console-request');
    this.proofs = new CredentialStore(db, 'mcp-console-proof');
  }
  async begin(issuer: string, query: string) {
    const id = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url');
    await this.requests.set(id, { issuer, query, browserHash: consentBrowserHash(nonce), exp: Date.now() + 600000 });
    return { id, nonce };
  }
  async approve(id: string, email: string, wallet: string) {
    const request = await this.requests.take(id);
    if (!request) throw Error('CONSENT_EXPIRED');
    const code = randomBytes(32).toString('base64url');
    await this.proofs.set(code, { ...request, email, wallet, exp: Math.min(request.exp, Date.now() + 60000) });
    return { code, issuer: request.issuer };
  }
  async finish(code: string, nonce: string, issuer: string) {
    const proof = await this.proofs.get(code);
    if (!proof || proof.issuer !== issuer || proof.browserHash !== consentBrowserHash(nonce)) return undefined;
    return this.proofs.take(code);
  }
}
