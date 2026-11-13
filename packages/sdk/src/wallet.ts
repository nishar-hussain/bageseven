/** Browser wallet helpers for Avalanche C-Chain and Fuji. */
import { withWalletOperation } from './wallet-operations.js';
export { withWalletOperation, getWalletOperation, subscribeWalletOperation, dismissWalletReminder } from './wallet-operations.js';

export const AVALANCHE_FUJI = {
  chainId: 43113,
  chainIdHex: '0xa869',
  name: 'Avalanche Fuji',
  rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
  explorer: 'https://testnet.snowtrace.io',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  /** Checkout supplies the explicitly configured six-decimal payment token. */
  usdt: '',
} as const;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  providers?: EthereumProvider[];
};

function pickProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) return null;
  if (eth.providers?.length) {
    const preferred =
      eth.providers.find((p) => p.isMetaMask) ||
      eth.providers[0];
    return preferred ?? eth;
  }
  return eth;
}

function walletNetwork(chainId: number) {
  if (chainId === 43113) return AVALANCHE_FUJI;
  if (chainId === 43114) return { ...AVALANCHE_FUJI, chainId: 43114, chainIdHex: '0xa86a', name: 'Avalanche C-Chain', rpcUrl: 'https://api.avax.network/ext/bc/C/rpc', explorer: 'https://snowtrace.io' };
  throw new Error('Unsupported Avalanche network');
}

async function connectAvalancheWalletImpl(chainId = 43113): Promise<{ address: string; provider: EthereumProvider }> {
  const network = walletNetwork(chainId);
  const provider = pickProvider();
  if (!provider) {
    throw new Error('No EVM wallet found. Connect an Avalanche-compatible wallet to Fuji (43113).');
  }
  const existing = await provider.request({ method: 'eth_accounts' });
  const accounts = (Array.isArray(existing) && existing.length ? existing : await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('Wallet returned no accounts');
  try {
    if (Number(await provider.request({ method: 'eth_chainId' })) !== chainId) await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: network.chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: network.chainIdHex,
            chainName: network.name,
            nativeCurrency: network.nativeCurrency,
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: [network.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
  const actualChain = await provider.request({ method: 'eth_chainId' });
  if (Number(actualChain) !== chainId) throw new Error('Wallet is connected to the wrong network');
  return { address, provider };
}

function encodeUsdtTransfer(to: string, amountHuman: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error('Invalid merchant wallet');
  if (!/^\d+(\.\d{1,6})?$/.test(amountHuman)) throw new Error('stablecoin amount must have at most 6 decimal places');
  // transfer(address,uint256) selector + args; amount as 6-decimal stablecoin
  const [whole, frac = ''] = amountHuman.split('.');
  const fracPad = (frac + '000000').slice(0, 6);
  const units = BigInt(whole || '0') * 1_000_000n + BigInt(fracPad || '0');
  if (units <= 0n) throw new Error('stablecoin amount must be positive');
  const selector = '0xa9059cbb';
  const toWord = to.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const amtWord = units.toString(16).padStart(64, '0');
  return `${selector}${toWord}${amtWord}`;
}

/** Wallet authorization binds a visible transaction to exactly one purchase. */
async function authorizeAvalanchePaymentImpl(input: { payment_tx: string; context: string; chainId?: number }): Promise<{ customer_wallet: string; payment_signature: string }> {
  const { address, provider } = await connectAvalancheWalletImpl(input.chainId ?? 43113);
  const message = `Bagseven payment confirmation\nContext: ${input.context}\nChain: ${input.chainId ?? 43113}\nTransaction: ${input.payment_tx.toLowerCase()}`;
  const hex = '0x' + Array.from(new TextEncoder().encode(message)).map((v) => v.toString(16).padStart(2, '0')).join('');
  const signature = await provider.request({ method: 'personal_sign', params: [hex, address] });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Wallet did not authorize this purchase');
  return { customer_wallet: address, payment_signature: signature };
}

async function payStablecoinOnAvalancheImpl(input: {
  merchantWallet: string;
  amount: string;
  usdt?: string;
  chainId?: number;
  context?: string;
  onTransactionSubmitted?: (hash: string) => void;
}): Promise<{ payment_tx: string; customer_wallet: string; payment_signature?: string }> {
  const { address, provider } = await connectAvalancheWalletImpl(input.chainId ?? 43113);
  const usdt = input.usdt || ((input.chainId ?? 43113) === 43113 ? AVALANCHE_FUJI.usdt : '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(usdt)) throw new Error('The checkout has no valid stablecoin contract');
  const data = encodeUsdtTransfer(input.merchantWallet, input.amount);
  const payment_tx = (await provider.request({
    method: 'eth_sendTransaction',
    params: [
      {
        from: address,
        to: usdt,
        data,
        value: '0x0',
      },
    ],
  })) as string;
  if (!/^0x[0-9a-fA-F]{64}$/.test(payment_tx)) throw new Error('Wallet returned an invalid transaction hash');
  input.onTransactionSubmitted?.(payment_tx);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [payment_tx] }) as { status: string; blockNumber: string } | null;
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('Avalanche payment reverted');
      const tip = await provider.request({ method: 'eth_blockNumber' }) as string;
      if (BigInt(tip) - BigInt(receipt.blockNumber) >= 1n) {
        const authorization = input.context ? await authorizeAvalanchePaymentImpl({ payment_tx, context: input.context, chainId: input.chainId }) : { customer_wallet: address };
        return { payment_tx, ...authorization };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Payment is still pending. Retry confirmation with transaction ${payment_tx}`);
}

async function confirmedWalletTransaction(provider: EthereumProvider, hash: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('Wallet returned an invalid transaction hash');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as { status: string; blockNumber: string } | null;
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('Wallet transaction reverted');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Transaction pending: ${hash}. Check its receipt before retrying.`);
}

/** Explicit customer action: bounded ERC-20 approval, then the fixed-plan subscription. */
async function subscribeOnAvalancheImpl(input: {
  contract: string; subscribeData: string; amount: string; usdt: string; chainId: number; checkoutId: string;
  onTransactionSubmitted?: (hash: string) => void;
}) {
  for (const address of [input.contract, input.usdt]) if (!/^0x[\da-fA-F]{40}$/.test(address)) throw new Error('Invalid subscription address');
  if (!/^0x[\da-fA-F]{136}$/.test(input.subscribeData)) throw new Error('Invalid subscription transaction');
  const { address, provider } = await connectAvalancheWalletImpl(input.chainId);
  const [whole, fraction = ''] = input.amount.split('.');
  if (!/^\d+(\.\d{1,6})?$/.test(input.amount)) throw new Error('Invalid subscription amount');
  const amount = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  const owner = address.slice(2).padStart(64, '0'); const spender = input.contract.slice(2).padStart(64, '0');
  const allowance = BigInt(await provider.request({ method: 'eth_call', params: [{ to: input.usdt, data: `0xdd62ed3e${owner}${spender}` }, 'latest'] }) as string);
  if (allowance < amount) {
    const approve = async (value: bigint) => {
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: input.usdt, value: '0x0', data: `0x095ea7b3${spender}${value.toString(16).padStart(64, '0')}` }] }) as string;
      await confirmedWalletTransaction(provider, hash);
    };
    // Reset existing allowance for stablecoin variants which require zero-first approval.
    if (allowance > 0n) await approve(0n);
    await approve(amount * 12n);
  }
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: input.contract, value: '0x0', data: input.subscribeData }] }) as string;
  input.onTransactionSubmitted?.(hash);
  await confirmedWalletTransaction(provider, hash);
  return { payment_tx: hash, ...await authorizeAvalanchePaymentImpl({ payment_tx: hash, context: `checkout:${input.checkoutId}`, chainId: input.chainId }) };
}

/** Returns only after the paying wallet has signed and its cancellation has landed. */
async function cancelAvalancheSubscriptionImpl(input: { contract: string; key: string; payer: string; chainId: number; cancelData: string }) {
  const { address, provider } = await connectAvalancheWalletImpl(input.chainId);
  if (address.toLowerCase() !== input.payer.toLowerCase()) throw new Error('Connect the wallet that pays this subscription');
  if (!/^0x[\da-fA-F]{40}$/.test(input.contract) || !/^0x[\da-fA-F]{64}$/.test(input.key) || !/^0x[\da-fA-F]{72}$/.test(input.cancelData)) throw new Error('Invalid cancellation transaction');
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: input.contract, value: '0x0', data: input.cancelData }] }) as string;
  await confirmedWalletTransaction(provider, hash);
  return hash;
}

async function renewSubscriptionAllowanceImpl(input: { contract: string; payer: string; chainId: number; usdt: string; amount: string }) {
  const { address, provider } = await connectAvalancheWalletImpl(input.chainId);
  if (address.toLowerCase() !== input.payer.toLowerCase()) throw new Error('Connect the wallet that pays this subscription');
  if (![input.contract, input.usdt].every(value => /^0x[\da-fA-F]{40}$/.test(value)) || !/^\d+(\.\d{1,6})?$/.test(input.amount)) throw new Error('Invalid allowance terms');
  const [whole, fraction = ''] = input.amount.split('.');
  const units = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  if (units <= 0n) throw new Error('Invalid allowance amount');
  const spender = input.contract.slice(2).padStart(64, '0');
  for (const amount of [0n, units * 12n]) {
    const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: input.usdt, value: '0x0', data: `0x095ea7b3${spender}${amount.toString(16).padStart(64, '0')}` }] }) as string;
    await confirmedWalletTransaction(provider, hash);
  }
}

export function connectAvalancheWallet(chainId = 43113) { return withWalletOperation("Connect wallet", () => connectAvalancheWalletImpl(chainId)); }

export function authorizeAvalanchePayment(input: Parameters<typeof authorizeAvalanchePaymentImpl>[0]) { return withWalletOperation("Confirm purchase ownership", () => authorizeAvalanchePaymentImpl(input)); }

export function payStablecoinOnAvalanche(input: Parameters<typeof payStablecoinOnAvalancheImpl>[0]) { return withWalletOperation("Pay for access", () => payStablecoinOnAvalancheImpl(input)); }

export function subscribeOnAvalanche(input: Parameters<typeof subscribeOnAvalancheImpl>[0]) { return withWalletOperation("Authorize subscription", () => subscribeOnAvalancheImpl(input)); }

export function cancelAvalancheSubscription(input: Parameters<typeof cancelAvalancheSubscriptionImpl>[0]) { return withWalletOperation("Cancel subscription", () => cancelAvalancheSubscriptionImpl(input)); }

export function renewSubscriptionAllowance(input: Parameters<typeof renewSubscriptionAllowanceImpl>[0]) { return withWalletOperation("Renew subscription allowance", () => renewSubscriptionAllowanceImpl(input)); }
