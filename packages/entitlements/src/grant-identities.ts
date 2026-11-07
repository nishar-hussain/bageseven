import { createHash } from 'node:crypto';
import { bytes } from '@arkiv-network/sdk/schema';

const fields = ['holder', 'human_id', 'merchant', 'world_proof_id'] as const;
/** Short identities keep their old index; long identities use a collision-resistant key. */
export function identityIndex(value: string): string {
  return Buffer.byteLength(value, 'utf8') <= 128 ? value : `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
export function encodeGrantIdentities(input: { holder: string; human_id?: string; merchant?: string; world_proof_id?: string }) {
  const full: Record<string, string> = {};
  const indexed: Record<string, string> = {};
  for (const field of fields) {
    const value = input[field] ?? '';
    indexed[field] = identityIndex(value);
    if (indexed[field] !== value) full[field] = value;
  }
  return { ...indexed, ...(Object.keys(full).length ? { identity_data: bytes(new TextEncoder().encode(JSON.stringify(full))) } : {}) } as {
    holder: string; human_id: string; merchant: string; world_proof_id: string; identity_data?: ReturnType<typeof bytes>;
  };
}
export function decodeGrantIdentities(raw: unknown): Record<string, string> {
  if (!raw) return {};
  const hex = typeof raw === 'string' ? raw : (raw as { value?: string }).value;
  if (!hex?.startsWith('0x')) throw new Error('ARKIV_IDENTITY_INVALID');
  const values = JSON.parse(Buffer.from(hex.slice(2), 'hex').toString('utf8')) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const field of fields) {
    if (values[field] !== undefined) {
      if (typeof values[field] !== 'string') throw new Error('ARKIV_IDENTITY_INVALID');
      result[field] = values[field];
    }
  }
  return result;
}
