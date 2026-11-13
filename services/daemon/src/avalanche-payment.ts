import { createPublicClient, decodeEventLog, http, isAddress, parseAbi, parseUnits, verifyMessage, type Hex } from 'viem';
import { avalancheConfig } from '@bagseven/onchain';

export const usdtAbi = parseAbi([
  'function transfer(address to,uint256 value) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);

export function usdtUnits(amount: string): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new Error('USDT amount must be a positive decimal with at most 6 decimal places');
  const units = parseUnits(amount, 6);
  if (units <= 0n) throw new Error('USDT amount must be positive');
  return units;
}

export function paymentAuthorizationMessage(context: string, hash: string, chainId: number): string {
  return `Bagseven payment confirmation\nContext: ${context}\nChain: ${chainId}\nTransaction: ${hash.toLowerCase()}`;
}

export async function verifyPaymentAuthorization(input: { wallet?: string; signature?: string; context: string; hash: string }, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!input.wallet || !isAddress(input.wallet) || !input.signature || !/^0x[\da-fA-F]{130}$/.test(input.signature)) throw new Error('PAYMENT_SIGNATURE_REQUIRED: confirm payment ownership with the paying wallet');
  const ok = await verifyMessage({ address: input.wallet, message: paymentAuthorizationMessage(input.context, input.hash, avalancheConfig(env).chainId), signature: input.signature as Hex });
  if (!ok) throw new Error('PAYMENT_SIGNATURE_INVALID: payment does not belong to this wallet and purchase');
}

/** A receipt is payment evidence only if this transaction transferred real USDT. */
export async function verifyAvalanchePayment(input: {
  payment_tx: string; amount: string; merchant_wallet: string; customer_wallet?: string;
  notBefore?: string; notAfter?: string;
}, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!/^0x[\da-fA-F]{64}$/.test(input.payment_tx)) throw new Error('payment_tx must be a 32-byte hex hash');
  if (!isAddress(input.merchant_wallet) || (input.customer_wallet && !isAddress(input.customer_wallet))) throw new Error('Invalid payment wallet address');
  if (input.customer_wallet?.toLowerCase() === input.merchant_wallet.toLowerCase()) throw new Error('SELF_PAYMENT: customer and provider payout wallets must be different');
  const expected = usdtUnits(input.amount);
  const config = avalancheConfig(env);
  if (!isAddress(config.usdt)) throw new Error('AVALANCHE_USDC must be configured with the token contract on this network');
  const client = createPublicClient({ chain: config.chain, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  if (await client.getChainId() !== config.chainId) throw new Error('AVALANCHE_RPC_CHAIN_MISMATCH: RPC is connected to another network');
  const decimals = await client.readContract({ address: config.usdt, abi: usdtAbi, functionName: 'decimals' });
  if (decimals !== 6) throw new Error('Configured USDT token must have 6 decimals');
  const receipt = await client.getTransactionReceipt({ hash: input.payment_tx as Hex });
  if (receipt.status !== 'success') throw new Error('Avalanche transaction reverted');
  const tip = await client.getBlockNumber();
  if (tip - receipt.blockNumber + 1n < BigInt(config.confirmations)) throw new Error('PAYMENT_PENDING: waiting for Avalanche confirmations; retry with the same transaction');
  if (input.notBefore || input.notAfter) {
    const block = await client.getBlock({ blockHash: receipt.blockHash });
    const paidAt = Number(block.timestamp);
    if (input.notBefore && paidAt < Math.floor(Date.parse(input.notBefore) / 1000)) throw new Error('PAYMENT_BEFORE_CHECKOUT: this payment predates checkout');
    if (input.notAfter && paidAt > Math.floor(Date.parse(input.notAfter) / 1000)) throw new Error('CHECKOUT_EXPIRED: payment was made after the payment window closed');
  }
  let received = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== config.usdt.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: usdtAbi, data: log.data, topics: log.topics, eventName: 'Transfer' });
      if (decoded.args.from.toLowerCase() === decoded.args.to.toLowerCase()) continue;
      if (decoded.args.to.toLowerCase() !== input.merchant_wallet.toLowerCase()) continue;
      if (input.customer_wallet && decoded.args.from.toLowerCase() !== input.customer_wallet.toLowerCase()) continue;
      received += decoded.args.value;
    } catch { /* Non-Transfer logs do not count as payment. */ }
  }
  if (received < expected) throw new Error('PAYMENT_UNDERPAID: this transaction does not contain the required USDT transfer to the merchant');
}
