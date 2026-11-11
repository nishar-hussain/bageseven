import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { providerGasEnabled, avalancheConfig } from '@bagseven/onchain';
import { usdtAbi, usdtUnits, verifyPaymentAuthorization, verifyAvalanchePayment } from './avalanche-payment.js';

export type AvalancheSettleInput = {
  amount: string; feature: string; holder: string; grant_id?: string; payment_tx?: string; reason?: string;
  customer_wallet?: string; payment_signature?: string;
};
export type AvalancheSettleResult = {
  payment_tx: string; settlement_network: 'avalanche'; network: 'fuji' | 'mainnet';
  explorer_url: string; mode: 'provided' | 'operator' | 'demo';
};
export function avalancheExplorerUrl(tx: string, network: 'fuji' | 'mainnet' = 'fuji'): string {
  return `${network === 'mainnet' ? 'https://snowtrace.io' : 'https://testnet.snowtrace.io'}/tx/${tx}`;
}

/** Explicit development fixture; a failed live payment never falls back to it. */
export function avalancheDemoAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.AVALANCHE_DEMO_SETTLE === 'true';
}

/** Prefer AVALANCHE_PAY_TO; otherwise derive from AVALANCHE_PRIVATE_KEY so Mint/Credits work out of the box. */
export function resolveAvalanchePayTo(env: NodeJS.ProcessEnv = process.env): `0x${string}` | null {
  const configured = env.AVALANCHE_PAY_TO?.trim();
  if (configured && isAddress(configured)) return configured as `0x${string}`;
  const rawKey = env.AVALANCHE_PRIVATE_KEY?.trim();
  if (!rawKey) return null;
  try {
    const account = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex);
    return account.address;
  } catch {
    return null;
  }
}

export async function settleAvalancheUsdt(input: AvalancheSettleInput, env: NodeJS.ProcessEnv = process.env): Promise<AvalancheSettleResult> {
  usdtUnits(input.amount);
  const network = env.AVALANCHE_NETWORK === 'mainnet' ? 'mainnet' : 'fuji';
  const result = (hash: string, mode: AvalancheSettleResult['mode']): AvalancheSettleResult => ({
    payment_tx: hash, settlement_network: 'avalanche', network, explorer_url: avalancheExplorerUrl(hash, network), mode,
  });
  if (avalancheDemoAllowed(env)) return result(input.payment_tx || `0x${randomBytes(32).toString('hex')}`, 'demo');
  if (providerGasEnabled(env)) throw new Error('PROVIDER_CHECKOUT_REQUIRED: use a provider plan checkout; platform-funded or global-recipient entitlement purchases are disabled');

  const payTo = resolveAvalanchePayTo(env);
  if (!payTo) throw new Error('AVALANCHE_UNCONFIGURED: set AVALANCHE_PAY_TO (or AVALANCHE_PRIVATE_KEY) as the payment recipient');
  if (input.payment_tx) {
    await verifyPaymentAuthorization({ wallet: input.customer_wallet, signature: input.payment_signature, context: `entitlement:${input.holder}:${input.feature}:${input.amount}`, hash: input.payment_tx }, env);
    await verifyAvalanchePayment({ payment_tx: input.payment_tx, amount: input.amount, merchant_wallet: payTo, customer_wallet: input.customer_wallet }, env);
    return result(input.payment_tx, 'provided');
  }
  // An operator settlement must opt into a dedicated key; never borrow the mandate owner key.
  if (providerGasEnabled(env)) throw new Error('PROVIDER_PAYMENT_REQUIRED: use a wallet-approved checkout; platform-funded USDT purchases are disabled');
  const rawKey = env.AVALANCHE_PRIVATE_KEY?.trim();
  if (!rawKey) throw new Error('AVALANCHE_UNCONFIGURED: pay through checkout or configure AVALANCHE_PRIVATE_KEY for operator-funded USDT payments');
  const config = avalancheConfig(env);
  if (!isAddress(config.usdt)) throw new Error('AVALANCHE_USDC is not configured for this network');
  const account = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex);
  const transport = http(config.rpcUrl);
  const client = createPublicClient({ chain: config.chain, transport });
  if (await client.getChainId() !== config.chainId) throw new Error('AVALANCHE_RPC_CHAIN_MISMATCH');
  const wallet = createWalletClient({ account, chain: config.chain, transport });
  const hash = await wallet.writeContract({ address: config.usdt, abi: usdtAbi, functionName: 'transfer', args: [payTo, usdtUnits(input.amount)] });
  await client.waitForTransactionReceipt({ hash, confirmations: config.confirmations, timeout: 90_000 });
  await verifyAvalanchePayment({ payment_tx: hash, amount: input.amount, merchant_wallet: payTo, customer_wallet: account.address }, env);
  return result(hash, 'operator');
}
