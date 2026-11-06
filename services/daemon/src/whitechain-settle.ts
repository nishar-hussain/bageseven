import { randomBytes } from 'node:crypto';
import { createWalletClient, http, parseUnits, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { WHITECHAIN_EXPLORER, WHITECHAIN_RPC_URL, whitechainSepolia } from '@bagseven/onchain';

const erc20TransferAbi = [
  {
    type: 'function' as const,
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable' as const,
  },
] as const;

export type WhitechainSettleInput = {
  amount: string;
  feature: string;
  holder: string;
  grant_id?: string;
  /** Existing Whitechain explorer tx if the client already paid. */
  payment_tx?: string;
  reason?: string;
};

export type WhitechainSettleResult = {
  payment_tx: string;
  settlement_network: 'whitechain';
  network: 'testnet' | 'mainnet';
  explorer_url: string;
  mode: 'provided' | 'operator' | 'demo';
};

export function whitechainExplorerUrl(tx: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  const base = network === 'mainnet' ? 'https://explorer.whitechain.io' : WHITECHAIN_EXPLORER;
  return `${base}/tx/${tx}`;
}

function networkFromEnv(env: NodeJS.ProcessEnv): 'testnet' | 'mainnet' {
  return env.WHITECHAIN_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

function operatorKey(env: NodeJS.ProcessEnv): Hex | null {
  const raw = (env.WHITECHAIN_PRIVATE_KEY ?? env.DAEMON_OWNER_KEY ?? '').trim();
  if (!raw) return null;
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;
}

/**
 * Stamp a Whitechain payment for mint / buy_credits.
 *
 * Priority:
 * 1. Caller-provided payment_tx (already on explorer)
 * 2. Operator native 1-wei transfer when a key + RPC is set
 * 3. Demo settle id when WHITECHAIN_DEMO_SETTLE != false (non-prod default)
 */
export async function settleWhitechainUsdt(
  input: WhitechainSettleInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WhitechainSettleResult> {
  const network = networkFromEnv(env);

  if (input.payment_tx?.trim()) {
    const payment_tx = input.payment_tx.trim();
    return {
      payment_tx,
      settlement_network: 'whitechain',
      network,
      explorer_url: whitechainExplorerUrl(payment_tx, network),
      mode: 'provided',
    };
  }

  const key = operatorKey(env);
  const rpc = (env.WHITECHAIN_RPC_URL ?? env.RPC_URL ?? WHITECHAIN_RPC_URL).trim();
  const payTo = (env.WHITECHAIN_PAY_TO ?? '').trim();
  if (key && rpc && payTo) {
    const account = privateKeyToAccount(key);
    const wallet = createWalletClient({
      account,
      chain: whitechainSepolia,
      transport: http(rpc),
    });
    const usdt = (env.WHITECHAIN_USDT ?? '').trim();
    const hash = usdt
      ? await wallet.writeContract({
          address: usdt as `0x${string}`,
          abi: erc20TransferAbi,
          functionName: 'transfer',
          args: [payTo as `0x${string}`, parseUnits(input.amount || '1', 6)],
        })
      : await wallet.sendTransaction({
          to: payTo as `0x${string}`,
          value: 1n,
        });
    return {
      payment_tx: hash,
      settlement_network: 'whitechain',
      network,
      explorer_url: whitechainExplorerUrl(hash, network),
      mode: 'operator',
    };
  }

  const prod = (env.NODE_ENV ?? 'development') === 'production';
  const demoDefault = prod ? 'false' : 'true';
  if ((env.WHITECHAIN_DEMO_SETTLE ?? demoDefault).toLowerCase() === 'false') {
    throw new Error(
      'WHITECHAIN_UNCONFIGURED: set WHITECHAIN_PRIVATE_KEY + WHITECHAIN_PAY_TO, pass payment_tx, or WHITECHAIN_DEMO_SETTLE=true for non-prod',
    );
  }

  const payment_tx = `0x${randomBytes(32).toString('hex')}`;
  return {
    payment_tx,
    settlement_network: 'whitechain',
    network,
    explorer_url: whitechainExplorerUrl(payment_tx, network),
    mode: 'demo',
  };
}
