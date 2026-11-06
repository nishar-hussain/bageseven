import { privateKeyToAccount } from 'viem/accounts';
import type { Session } from './auth';
import { sessionHolder } from './auth';

const ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Wallets this signed-in operator may inspect (mandates / vaults). */
export function operatorOwnerAddresses(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  for (const raw of [env.DAEMON_OWNER_ADDRESS, env.WHITECHAIN_PAY_TO, env.OPERATOR_WALLET]) {
    const v = raw?.trim();
    if (v && ADDR.test(v)) out.add(v.toLowerCase());
  }
  const key = env.DAEMON_OWNER_KEY?.trim();
  if (key) {
    try {
      const hex = (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
      out.add(privateKeyToAccount(hex).address.toLowerCase());
    } catch {
      /* ignore malformed local key */
    }
  }
  return [...out];
}

export function assertOwnerAllowed(owner: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!owner || !ADDR.test(owner)) return false;
  const allowed = operatorOwnerAddresses(env);
  if (allowed.length === 0) return false;
  return allowed.includes(owner.toLowerCase());
}

export function sessionActorHeaders(session: Session): Record<string, string> {
  const headers: Record<string, string> = {
    'x-bagseven-actor': sessionHolder(session),
  };
  if (!session.mock && session.world_human_id && !session.world_human_id.startsWith('email:')) {
    headers['x-bagseven-world-human'] = session.world_human_id;
  }
  return headers;
}

export function gatewayAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const token = env.GATEWAY_AUTH_TOKEN?.trim() || env.POLICY_INTERNAL_TOKEN?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}
