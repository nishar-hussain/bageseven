import { randomBytes } from 'node:crypto';
import { createPublicClient, createWalletClient, fallback, http, type Address, type Hex, type PublicClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { avalancheFuji } from 'viem/chains';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload, PaymentRequired } from '@x402/core/types';
import type { X402Requirements } from './x402.js';

const erc20Abi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

const authorizationTypes = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export interface X402PayerConfig {
  key: Hex;
  rpcUrl: string;
  rpcFallbackUrl?: string;
  chainId: number;
  usdc: Address;
}

export interface X402Payment {
  header: string;
  payer: Address;
  amount: bigint;
  validBefore: number;
}

/** An isolated, non-operator EOA used only for x402 EIP-3009 authorizations. */
export class X402Payer {
  readonly account: PrivateKeyAccount;
  readonly publicClient: PublicClient;
  private readonly walletClient;
  private readonly usdc: Address;
  private readonly chainId: number;

  constructor(config: X402PayerConfig) {
    const chain = config.chainId === 43113 ? avalancheFuji : undefined;
    if (!chain) throw new Error(`unsupported chain id ${config.chainId}; expected Avalanche Fuji (43113)`);
    this.account = privateKeyToAccount(config.key);
    const fallbackUrl = config.rpcFallbackUrl;
    this.publicClient = createPublicClient({
      chain,
      transport: fallback([
        http(config.rpcUrl, { retryCount: 3, retryDelay: 500 }),
        ...(fallbackUrl && fallbackUrl !== config.rpcUrl ? [http(fallbackUrl, { retryCount: 3, retryDelay: 750 })] : []),
      ]),
    });
    this.walletClient = createWalletClient({ account: this.account, chain, transport: http(config.rpcUrl) });
    this.usdc = config.usdc;
    this.chainId = config.chainId;
  }

  async balance(): Promise<bigint> {
    return this.publicClient.readContract({ address: this.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [this.account.address] });
  }

  async refund(to: Address, amount: bigint): Promise<Hex> {
    const hash = await this.walletClient.writeContract({ address: this.usdc, abi: erc20Abi, functionName: 'transfer', args: [to, amount] });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async createPayment(payment: PaymentRequired, requirement: X402Requirements): Promise<X402Payment> {
    const now = Math.floor(Date.now() / 1000);
    const validBefore = now + requirement.maxTimeoutSeconds;
    const nonce = `0x${randomBytes(32).toString('hex')}` as Hex;
    const extra = requirement.extra ?? {};
    const name = typeof extra.name === 'string' ? extra.name : 'USD Coin';
    const version = typeof extra.version === 'string' ? extra.version : '2';
    const signature = await this.account.signTypedData({
      domain: { name, version, chainId: this.chainId, verifyingContract: requirement.asset.toLowerCase() as Address },
      types: authorizationTypes,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: this.account.address,
        to: requirement.payTo.toLowerCase() as Address,
        value: BigInt(requirement.amount),
        validAfter: 0n,
        validBefore: BigInt(validBefore),
        nonce,
      },
    });
    const payload: PaymentPayload = {
      x402Version: payment.x402Version,
      resource: payment.resource,
      accepted: requirement as PaymentPayload['accepted'],
      payload: {
        signature,
        authorization: {
          from: this.account.address,
          to: requirement.payTo,
          value: requirement.amount,
          validAfter: '0',
          validBefore: String(validBefore),
          nonce,
        },
      },
    };
    return { header: encodePaymentSignatureHeader(payload), payer: this.account.address, amount: BigInt(requirement.amount), validBefore };
  }
}

export function x402PayerFromEnv(config: NodeJS.ProcessEnv, operator: string, enforcer: string): X402Payer {
  const key = config.BAGSEVEN_X402_PAYER_KEY;
  if (!key) throw new Error('BAGSEVEN_X402_PAYER_KEY is not configured');
  if (!config.USDC_ADDRESS) throw new Error('USDC_ADDRESS is not configured');
  const payer = new X402Payer({
    key: key as Hex,
    rpcUrl: config.RPC_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc',
    rpcFallbackUrl: config.RPC_FALLBACK_URL ?? 'https://api.avax-test.network/ext/bc/C/rpc',
    chainId: Number(config.CHAIN_ID ?? 43113),
    usdc: config.USDC_ADDRESS as Address,
  });
  if (payer.account.address.toLowerCase() === operator.toLowerCase()) throw new Error('x402 payer must not be the worker operator');
  if (payer.account.address.toLowerCase() === enforcer.toLowerCase()) throw new Error('x402 payer must not be the contract enforcer');
  return payer;
}
