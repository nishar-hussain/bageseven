import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  decodeErrorResult,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import { avalancheFuji } from 'viem/chains';
import { BagMandateAbi } from './abi.js';
import { BagMandateBytecode } from './bytecode.js';

export { BagMandateAbi } from './abi.js';

/** The local anvil chain (chainId 31337). */
export const localChain = defineChain({
  id: 31337,
  name: 'Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:8545'] } },
});

export interface MandateCaps {
  owner: Address;
  operator: Address;
  enforcer: Address;
  usdc: Address;
  budgetPerWindow: bigint;
  windowSeconds: number;
  lifetimeCap: bigint;
  perPurchaseCap: bigint;
  perSellerPct: number;
  maxDepth: number;
  rootWorker: Hex;
  rootAllocation: bigint;
}

export interface MandateClientOpts {
  rpcUrl: string;
  rpcFallbackUrl?: string;
  chainId?: number;
}

export const SUPPORTED_CHAIN_IDS = [43113] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const chainConfig = {
  43113: {
    id: 43113,
    name: 'Avalanche Fuji',
    network: 'eip155:43113',
    nativeSymbol: 'AVAX',
    defaultRpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    usdc: '0x5425890298aed601595a70AB815c96711a31Bc65',
  },
} as const;

export function chainForId(chainId: number) {
  if (chainId === 43113) return avalancheFuji;
  throw new Error(`unsupported chain id ${chainId}; expected Avalanche Fuji (43113)`);
}

export function chainConfigForId(chainId: number) {
  if (chainId === 43113) return chainConfig[chainId];
  throw new Error(`unsupported chain id ${chainId}; expected Avalanche Fuji (43113)`);
}

const abi: any = BagMandateAbi as any;

export class MandateClient {
  readonly publicClient: PublicClient;
  private readonly wallet: WalletClient;
  readonly address: Address;

  constructor(privateKey: Hex, opts: MandateClientOpts) {
    const chain = opts.chainId === 31337 ? localChain : chainForId(opts.chainId ?? 43113);
    const transport = opts.rpcFallbackUrl && opts.rpcFallbackUrl !== opts.rpcUrl
      ? fallback([
        http(opts.rpcUrl, { retryCount: 2, retryDelay: 500 }),
        http(opts.rpcFallbackUrl, { retryCount: 2, retryDelay: 750 }),
      ])
      : http(opts.rpcUrl, { retryCount: 2, retryDelay: 500 });
    this.publicClient = createPublicClient({ chain, transport });
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    this.wallet = createWalletClient({ account, chain, transport });
  }

  async deploy(caps: MandateCaps): Promise<Address> {
    const hash = await this.wallet.deployContract({
      abi,
      bytecode: BagMandateBytecode,
      args: [
        caps.owner,
        caps.operator,
        caps.enforcer,
        caps.usdc,
        caps.budgetPerWindow,
        BigInt(caps.windowSeconds),
        caps.lifetimeCap,
        caps.perPurchaseCap,
        BigInt(caps.perSellerPct),
        caps.maxDepth,
        caps.rootWorker,
        caps.rootAllocation,
      ],
    } as any);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error('deploy produced no contract address');
    return receipt.contractAddress;
  }

  async vaultBalance(contract: Address): Promise<bigint> {
    return this.read('vaultBalance', [], contract) as Promise<bigint>;
  }

  /** Pure bounds check (eth_call — 0 = ok, else an error code). */
  async check(contract: Address, amount: bigint, recipient: Address, depth: number): Promise<number> {
    return Number((await this.read('check', [amount, recipient, depth], contract)) as bigint);
  }

  async checkWorker(contract: Address, amount: bigint, recipient: Address, workerId: Hex): Promise<number> {
    return Number((await this.read('checkWorker', [amount, recipient, workerId], contract)) as bigint);
  }

  async spendState(contract: Address): Promise<bigint> {
    return this.read('spendState', [], contract) as Promise<bigint>;
  }

  async lifetimeSpent(contract: Address): Promise<bigint> {
    return this.read('lifetimeSpent', [], contract) as Promise<bigint>;
  }

  async sellerSpent(contract: Address, recipient: Address): Promise<bigint> {
    return this.read('sellerSpent', [recipient], contract) as Promise<bigint>;
  }

  /** Fund the vault from this client's key. */
  async fund(contract: Address, usdc: Address, amount: bigint): Promise<Hex> {
    const approve = await this.write(usdc, erc20Abi, 'approve', [contract, amount]);
    await this.publicClient.waitForTransactionReceipt({ hash: approve });
    const hash = await this.write(contract, abi, 'fund', [amount]);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Execute a spend as the enforcer. Throws with the NAMED error on violation. */
  async execute(contract: Address, amount: bigint, recipient: Address, workerId: Hex): Promise<Hex> {
    try {
      const hash = await this.write(contract, abi, 'execute', [amount, recipient, workerId]);
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new Error('execute reverted');
      return hash;
    } catch (err) {
      throw new Error(decodeRevert(err), { cause: err });
    }
  }

  async registerWorker(contract: Address, workerId: Hex, parentId: Hex, operator: Address, allocation: bigint, depth: number): Promise<Hex> {
    const hash = await this.write(contract, abi, 'registerWorker', [workerId, parentId, operator, allocation, depth]);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** Owner withdraw. */
  async withdraw(contract: Address, amount: bigint, to: Address): Promise<Hex> {
    const hash = await this.write(contract, abi, 'withdraw', [amount, to]);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async revoke(contract: Address): Promise<Hex> {
    const hash = await this.write(contract, abi, 'revoke', []);
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  private async read(fn: string, args: unknown[], contract: Address): Promise<unknown> {
    return this.publicClient.readContract({ address: contract, abi, functionName: fn, args });
  }

  private async write(contract: Address, contractAbi: any, fn: string, args: unknown[]): Promise<Hex> {
    const hash = await this.wallet.writeContract({ address: contract, abi: contractAbi, functionName: fn, args } as any);
    return hash;
  }
}

const erc20Abi = [
  {
    type: 'function' as const,
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable' as const,
  },
] as never;

function decodeRevert(err: unknown): string {
  const e = err as { walk?: (fn: (x: { type: string; data?: string }) => void) => void };
  let data: string | undefined;
  try {
    e.walk?.((node) => {
      if (node.type === 'revert' && node.data) data = node.data;
    });
  } catch {
    /* ignore */
  }
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: BagMandateAbi, data: data as Hex });
      return decoded.errorName;
    } catch {
      /* fall through */
    }
  }
  return (err as Error).message?.slice(0, 120) ?? 'execute failed';
}
/* ── EIP-191 / EIP-712 signature helpers ───────────────────────────── */

export interface SpendIntent {
  agentId: string;
  amount: string;
  recipient: Address;
  nonce: number;
  timestamp: number;
  chainId: number;
}

export const spendIntentTypes = {
  SpendIntent: [
    { name: 'agentId', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'recipient', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'chainId', type: 'uint256' },
  ],
} as const;

export function spendIntentDomain(chainId: number): {
  name: string;
  version: string;
  chainId: number;
} {
  return { name: 'Bagseven', version: '1', chainId };
}

/** Recover the EIP-191 (personal_sign) signer of a canonical mandate payload. */
export async function recoverEip191(message: string, signature: Hex): Promise<Address> {
  return recoverMessageAddress({ message, signature });
}

/** Recover the EIP-712 signer of a spend intent. Must equal the agent's operator. */
export async function recoverSpendIntentSigner(intent: SpendIntent, signature: Hex, chainId: number): Promise<Address> {
  return recoverTypedDataAddress({
    domain: spendIntentDomain(chainId),
    types: spendIntentTypes,
    primaryType: 'SpendIntent',
    message: { ...intent, nonce: BigInt(intent.nonce), timestamp: BigInt(intent.timestamp), chainId: BigInt(chainId) },
    signature,
  });
}

/* ── Canonical payloads (EIP-191 personal_sign) ───────────────────── */

export function canonicalMandate(input: {
  owner: Address;
  operator: Address;
  budgetPerWindow: string;
  windowSeconds: number;
  lifetimeCap: string;
  perPurchaseCap: string;
  perSellerPct: number;
  maxDepth: number;
  chainId: number;
}): string {
  return [
    'bagseven-mandate-v1',
    input.owner,
    input.operator,
    input.budgetPerWindow,
    input.windowSeconds,
    input.lifetimeCap,
    input.perPurchaseCap,
    input.perSellerPct,
    input.maxDepth,
    input.chainId,
  ].join('|');
}

export function canonicalSpawn(input: {
  mandateId: string;
  parentAgentId: string;
  operator: Address;
  sharePercent: number;
  chainId: number;
}): string {
  return ['bagseven-spawn-v1', input.mandateId, input.parentAgentId, input.operator, input.sharePercent, input.chainId].join('|');
}

export function workerKey(workerId: string): Hex {
  return keccak256(stringToHex(workerId));
}

export function canonicalWithdraw(input: { mandateId: string; amount: string; to: Address; chainId: number }): string {
  return ['bagseven-withdraw-v1', input.mandateId, input.amount, input.to, input.chainId].join('|');
}
