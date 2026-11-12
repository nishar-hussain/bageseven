import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

/** A narrowly scoped backend seam; an HSM/KMS backend can implement the same operations. */
export interface X402Keyring {
  create(binding: string): Promise<{ address: Hex; reference: string }>;
  sign(binding: string, reference: string, authorization: TransferAuthorization, domain: PaymentDomain): Promise<Hex>;
}
export type TransferAuthorization = { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };
export type PaymentDomain = { name: string; version: string; chainId: number; verifyingContract: Hex };
export const transferAuthorizationTypes = { TransferWithAuthorization: [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] } as const;

/** Delegated payment keys are encrypted separately from gas keys and bound by AEAD to their authority. */
export class EncryptedX402Keyring implements X402Keyring {
  constructor(private env: NodeJS.ProcessEnv) {}
  private key() {
    if (!/^[a-f\d]{64}$/i.test(this.env.X402_PAYMENT_ENCRYPTION_KEY ?? '')) throw Error('X402_KEY_MANAGEMENT_REQUIRED');
    if ([this.env.PROVIDER_GAS_ENCRYPTION_KEY, this.env.PROVIDER_SCOPE_SIGNING_KEY].some(key =>
      key?.toLowerCase() === this.env.X402_PAYMENT_ENCRYPTION_KEY!.toLowerCase())) throw Error('X402_SEPARATE_ENCRYPTION_KEY_REQUIRED');
    return Buffer.from(this.env.X402_PAYMENT_ENCRYPTION_KEY!, 'hex');
  }
  async create(binding: string) {
    const raw = generatePrivateKey(), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(`bagseven:x402:${binding}`));
    const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
    return { address: privateKeyToAccount(raw).address, reference: [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64url')).join('.') };
  }
  async sign(binding: string, reference: string, authorization: TransferAuthorization, domain: PaymentDomain) {
    const [iv, tag, ciphertext, extra] = reference.split('.');
    if (!iv || !tag || !ciphertext || extra) throw Error('X402_KEY_REFERENCE_INVALID');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(`bagseven:x402:${binding}`));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const raw = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8') as Hex;
    const account = privateKeyToAccount(raw);
    if (account.address.toLowerCase() !== authorization.from.toLowerCase()) throw Error('X402_SIGNER_MISMATCH');
    return account.signTypedData({ domain, types: transferAuthorizationTypes, primaryType: 'TransferWithAuthorization', message: authorization });
  }
}
