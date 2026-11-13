import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, encodeDeployData, encodeFunctionData,
  getContractAddress, http, keccak256, parseAbi, parseTransaction, stringToHex, type Hex, type Chain } from 'viem';
import { ProviderGasManager, SubscriptionAbi, SubscriptionBytecode, SubscriptionRuntime, avalancheConfig } from '@bagseven/onchain';
import { usdtUnits, verifyAvalanchePayment } from './avalanche-payment.js';
import type { Plan } from './billing-store.js';
import type { Subscription, SubscriptionPlan } from './subscription-types.js';

export type SignedPayment = { raw: string; hash: string };
export type ChainPayment = { paidAt: number; paidThrough: number; hash: string; payer: string; period: number };
export type ChainState = { payer: string; paidThrough: number; payments: number; cancelled: boolean; balance: bigint; allowance: bigint };
export interface SubscriptionChain {
  checkoutReady?(provider: string): Promise<void>;
  preparePlan(plan: Plan): Promise<SubscriptionPlan>;
  verifyPlan(plan: SubscriptionPlan, terms: Plan): Promise<boolean>;
  broadcast(raw: string): Promise<void>;
  state(sub: Pick<Subscription, 'contract' | 'key' | 'payer' | 'chainId'>): Promise<ChainState>;
  signCharge(sub: Subscription): Promise<SignedPayment>;
  recoverCharge?(sub: Subscription): Promise<SignedPayment | null>;
  payment(hash: string, contract: string, key: string, plan: Plan, payer: string): Promise<ChainPayment | null>;
}
export const checkoutKey = (id: string) => keccak256(stringToHex(id));
export const subscriptionKey = (payer: string, checkout: string) => keccak256(encodeAbiParameters(
  [{ type: 'address' }, { type: 'bytes32' }], [payer as Hex, checkoutKey(checkout)]));
export const subscriptionId = (checkout: string) => `sub_${checkout}`;

export class AvalancheSubscriptionChain implements SubscriptionChain {
  private config: Omit<ReturnType<typeof avalancheConfig>, 'chain' | 'usdt'> & { chain: Chain; usdt: Hex };
  private client;
  constructor(private gas: ProviderGasManager, private env: NodeJS.ProcessEnv) {
    const config = avalancheConfig(env);
    this.config = { ...config, usdt: config.usdt as Hex };
    this.client = createPublicClient({ chain: this.config.chain, transport: http(this.config.rpcUrl, { timeout: 15000, retryCount: 1 }) });
  }
  private async network() {
    if (await this.client.getChainId() !== this.config.chainId) throw Error('AVALANCHE_RPC_CHAIN_MISMATCH');
  }
  private async signer(provider: string) {
    const status = await this.gas.status(provider);
    if (!status.authorization?.subscriptions) throw Error('SUBSCRIPTION_GAS_AUTHORIZATION_REQUIRED: renew provider gas authorization in Tracks before enabling recurring plans');
    return this.gas.account(provider, 'avalanche');
  }
  async checkoutReady(provider: string) {
    const active = await this.gas.assertActive(provider);
    if (!active.authorization || !(active.authorization as { subscriptions?: boolean }).subscriptions || !active.expiresAt || active.expiresAt.getTime() < Date.now() + 31 * 86400_000) {
      throw Error('SUBSCRIPTION_GAS_AUTHORIZATION_REQUIRED: authorize at least 31 more days of provider gas signing in Tracks for monthly renewals');
    }
  }
  async preparePlan(plan: Plan): Promise<SubscriptionPlan> {
    await this.network();
    const account = await this.signer(plan.provider_id);
    const wallet = createWalletClient({ account, chain: this.config.chain, transport: http(this.config.rpcUrl) });
    const data = encodeDeployData({ abi: SubscriptionAbi, bytecode: SubscriptionBytecode, args: [this.config.usdt,
      plan.merchant_wallet as Hex, account.address, usdtUnits(plan.amount), BigInt(plan.ttl_seconds), checkoutKey(plan.id)] });
    const previous = await this.gas.signedSubscription(plan.provider_id, this.config.chainId, data);
    const raw = previous ?? await wallet.signTransaction(await wallet.prepareTransactionRequest({ account, data }));
    return { id: plan.id, providerId: plan.provider_id, chainId: this.config.chainId, status: 'preparing',
      contract: getContractAddress({ from: account.address, nonce: BigInt(parseTransaction(raw).nonce!) }), raw, hash: keccak256(raw) };
  }
  async broadcast(raw: string) {
    await this.network();
    // Resubmitting identical bytes is safe. Never generate a new nonce on an ambiguous broadcast.
    try { await this.client.sendRawTransaction({ serializedTransaction: raw as Hex }); }
    catch (error) { if (!/already known|known transaction|nonce too low/i.test(String(error))) throw error; }
  }
  async verifyPlan(plan: SubscriptionPlan, terms: Plan) {
    await this.network();
    if (plan.chainId !== this.config.chainId || !plan.hash) throw Error('SUBSCRIPTION_PLAN_NETWORK_MISMATCH');
    const receipt = await this.receipt(plan.hash);
    if (!receipt) return false;
    const code = await this.client.getCode({ address: plan.contract as Hex });
    if (!code || keccak256(code) !== keccak256(SubscriptionRuntime)) throw Error('SUBSCRIPTION_CONTRACT_INVALID');
    const read = <T extends 'token' | 'merchant' | 'amount' | 'periodSeconds' | 'planKey'>(functionName: T) =>
      this.client.readContract({ address: plan.contract as Hex, abi: SubscriptionAbi, functionName });
    const [token, merchant, amount, period, key] = await Promise.all([read('token'), read('merchant'), read('amount'), read('periodSeconds'), read('planKey')]);
    if (token.toLowerCase() !== this.config.usdt.toLowerCase() || merchant.toLowerCase() !== terms.merchant_wallet.toLowerCase() ||
        amount !== usdtUnits(terms.amount) || period !== BigInt(terms.ttl_seconds) || key !== checkoutKey(terms.id)) throw Error('SUBSCRIPTION_TERMS_MISMATCH');
    return true;
  }
  async state(sub: Pick<Subscription, 'contract' | 'key' | 'payer' | 'chainId'>): Promise<ChainState> {
    await this.network();
    if (sub.chainId !== this.config.chainId) throw Error('SUBSCRIPTION_NETWORK_MISMATCH');
    const [payer, end, payments, cancelled] = await this.client.readContract({ address: sub.contract as Hex, abi: SubscriptionAbi, functionName: 'subscriptions', args: [sub.key as Hex] });
    const token = parseAbi(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)']);
    const [balance, allowance] = await Promise.all([
      this.client.readContract({ address: this.config.usdt, abi: token, functionName: 'balanceOf', args: [sub.payer as Hex] }),
      this.client.readContract({ address: this.config.usdt, abi: token, functionName: 'allowance', args: [sub.payer as Hex, sub.contract as Hex] }),
    ]);
    return { payer, paidThrough: Number(end), payments: Number(payments), cancelled, balance, allowance };
  }
  async signCharge(sub: Subscription): Promise<SignedPayment> {
    const previous = await this.recoverCharge(sub);
    if (previous) return previous;
    const account = await this.signer(sub.providerId);
    const wallet = createWalletClient({ account, chain: this.config.chain, transport: http(this.config.rpcUrl) });
    const data = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [sub.key as Hex, BigInt(sub.paidThrough)] });
    const request = await wallet.prepareTransactionRequest({ account, to: sub.contract as Hex, data });
    const raw = await wallet.signTransaction(request);
    return { raw, hash: keccak256(raw) };
  }
  async recoverCharge(sub: Subscription): Promise<SignedPayment | null> {
    const data = encodeFunctionData({ abi: SubscriptionAbi, functionName: 'charge', args: [sub.key as Hex, BigInt(sub.paidThrough)] });
    const raw = await this.gas.signedSubscription(sub.providerId, sub.chainId, data, sub.contract);
    if (raw) {
      try { await this.receipt(keccak256(raw)); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== 'SUBSCRIPTION_TRANSACTION_REVERTED') throw error;
        await this.gas.revertedSubscription(sub.providerId, sub.chainId, raw);
        return null;
      }
    }
    return raw ? { raw, hash: keccak256(raw) } : null;
  }
  private async receipt(hash: string) {
    const receipt = await this.client.getTransactionReceipt({ hash: hash as Hex }).catch(error => {
      if (error.name === 'TransactionReceiptNotFoundError') return null;
      throw error;
    });
    if (!receipt) return null;
    if (receipt.status !== 'success') throw Error('SUBSCRIPTION_TRANSACTION_REVERTED');
    const tip = await this.client.getBlockNumber({ cacheTime: 0 });
    return tip - receipt.blockNumber + 1n >= BigInt(this.config.confirmations) ? receipt : null;
  }
  async payment(hash: string, contract: string, key: string, plan: Plan, payer: string): Promise<ChainPayment | null> {
    await this.network();
    const receipt = await this.receipt(hash);
    if (!receipt) return null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
      let event;
      try { event = decodeEventLog({ abi: SubscriptionAbi, eventName: 'Paid', topics: log.topics, data: log.data }); }
      catch { continue; }
      if (event.args.subscriptionId !== key || event.args.payer.toLowerCase() !== payer.toLowerCase() || event.args.amount !== usdtUnits(plan.amount)) continue;
      await verifyAvalanchePayment({ payment_tx: hash, merchant_wallet: plan.merchant_wallet, customer_wallet: payer, amount: plan.amount }, this.env);
      return { paidAt: Number((await this.client.getBlock({ blockNumber: receipt.blockNumber })).timestamp), paidThrough: Number(event.args.paidThrough), period: Number(event.args.period), hash, payer };
    }
    throw Error('SUBSCRIPTION_PAYMENT_UNVERIFIED');
  }
}
