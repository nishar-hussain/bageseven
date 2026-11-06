import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { whitechainConfig } from '@bagseven/onchain';
import { usdtAbi, usdtUnits, verifyPaymentAuthorization, verifyWhitechainPayment } from './whitechain-payment.js';

export type WhitechainSettleInput = {
  amount: string; feature: string; holder: string; grant_id?: string; payment_tx?: string; reason?: string;
  customer_wallet?: string; payment_signature?: string;
};
export type WhitechainSettleResult = {
  payment_tx: string; settlement_network: 'whitechain'; network: 'testnet' | 'mainnet';
  explorer_url: string; mode: 'provided' | 'operator' | 'demo';
};
export function whitechainExplorerUrl(tx: string, network: 'testnet' | 'mainnet' = 'testnet'): string {
  return `${network === 'mainnet' ? 'https://explorer.whitechain.io' : 'https://explorer.testnet.whitechain.io'}/tx/${tx}`;
}

/** Explicit development fixture; a failed live payment never falls back to it. */
export function whitechainDemoAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && env.WHITECHAIN_DEMO_SETTLE === 'true';
}

export async function settleWhitechainUsdt(input: WhitechainSettleInput, env: NodeJS.ProcessEnv = process.env): Promise<WhitechainSettleResult> {
  usdtUnits(input.amount);
  const network = env.WHITECHAIN_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  const result = (hash: string, mode: WhitechainSettleResult['mode']): WhitechainSettleResult => ({
    payment_tx: hash, settlement_network: 'whitechain', network, explorer_url: whitechainExplorerUrl(hash, network), mode,
  });
  if (whitechainDemoAllowed(env)) return result(input.payment_tx || `0x${randomBytes(32).toString('hex')}`, 'demo');

  const payTo = env.WHITECHAIN_PAY_TO?.trim();
  if (!payTo || !isAddress(payTo)) throw new Error('WHITECHAIN_UNCONFIGURED: configure WHITECHAIN_PAY_TO with the payment recipient');
  if (input.payment_tx) {
    await verifyPaymentAuthorization({ wallet: input.customer_wallet, signature: input.payment_signature, context: `entitlement:${input.holder}:${input.feature}:${input.amount}`, hash: input.payment_tx }, env);
    await verifyWhitechainPayment({ payment_tx: input.payment_tx, amount: input.amount, merchant_wallet: payTo, customer_wallet: input.customer_wallet }, env);
    return result(input.payment_tx, 'provided');
  }
  // An operator settlement must opt into a dedicated key; never borrow the mandate owner key.
  const rawKey = env.WHITECHAIN_PRIVATE_KEY?.trim();
  if (!rawKey) throw new Error('WHITECHAIN_UNCONFIGURED: pay through checkout or configure WHITECHAIN_PRIVATE_KEY for operator-funded USDT payments');
  const config = whitechainConfig(env);
  if (!isAddress(config.usdt)) throw new Error('WHITECHAIN_USDT is not configured for this network');
  const account = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex);
  const transport = http(config.rpcUrl);
  const client = createPublicClient({ chain: config.chain, transport });
  if (await client.getChainId() !== config.chainId) throw new Error('WHITECHAIN_RPC_CHAIN_MISMATCH');
  const wallet = createWalletClient({ account, chain: config.chain, transport });
  const hash = await wallet.writeContract({ address: config.usdt, abi: usdtAbi, functionName: 'transfer', args: [payTo, usdtUnits(input.amount)] });
  await client.waitForTransactionReceipt({ hash, confirmations: config.confirmations, timeout: 90_000 });
  await verifyWhitechainPayment({ payment_tx: hash, amount: input.amount, merchant_wallet: payTo, customer_wallet: account.address }, env);
  return result(hash, 'operator');
}
