import { formatEther } from 'viem';

export type SpendingWallet = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Check native balance before opening a transfer approval for provider gas. */
export async function fundProviderGas(wallet: SpendingWallet, input: { owner: string; to: string; value: bigint; symbol: string }) {
  const balance = BigInt(await wallet.request({ method: 'eth_getBalance', params: [input.owner, 'latest'] }) as string);
  const insufficient = () => new Error(`Your connected wallet has ${formatEther(balance)} ${input.symbol}. Add enough ${input.symbol} for the deposit and network fees, then try again. Gas funds are separate on Whitechain and Arkiv.`);
  if (balance <= input.value) throw insufficient();
  const transaction = { from: input.owner, to: input.to, value: `0x${input.value.toString(16)}` };
  const gas = BigInt(await wallet.request({ method: 'eth_estimateGas', params: [transaction] }) as string);
  const price = BigInt(await wallet.request({ method: 'eth_gasPrice' }) as string);
  if (balance < input.value + gas * price * 120n / 100n) throw insufficient();
  return wallet.request({ method: 'eth_sendTransaction', params: [transaction] });
}

function rpcCode(error: unknown): number | undefined {
  const seen = new Set<unknown>();
  for (let current = error; current && typeof current === 'object' && !seen.has(current);) {
    seen.add(current);
    const item = current as { code?: unknown; cause?: unknown; data?: { originalError?: unknown } };
    if (typeof item.code === 'number') return item.code;
    current = item.cause ?? item.data?.originalError;
  }
}

/** Reconnect stale account permissions once; never retry a declined signature. */
export async function signSpendingMessage(wallet: SpendingWallet, owner: string, message: string): Promise<string> {
  const hex = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('');
  const request = () => wallet.request({ method: 'personal_sign', params: [hex, owner] });
  let signature: unknown;
  try { signature = await request(); }
  catch (error) {
    if (rpcCode(error) !== 4100) throw error;
    try { await wallet.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] }); }
    catch (permissionError) {
      if (![4200, -32601].includes(rpcCode(permissionError) ?? 0)) throw permissionError;
    }
    const accounts = await wallet.request({ method: 'eth_requestAccounts' });
    if (!Array.isArray(accounts) || !accounts.some(account => typeof account === 'string' && account.toLowerCase() === owner.toLowerCase())) {
      throw new Error('Select the original provider owner account when reconnecting your wallet.', { cause: error });
    }
    signature = await request();
  }
  if (typeof signature !== 'string' || !/^0x[\da-f]{130}$/i.test(signature)) throw new Error('The wallet did not return a valid message signature. Reconnect a wallet that supports personal_sign.');
  return signature;
}

/** Use the active connector's account, including mobile WalletConnect wallets. */
export async function connectedSpendingWallet(connector: { getProvider: () => Promise<unknown> }, owner: string, expected?: string) {
  const wallet = await connector.getProvider() as SpendingWallet | undefined;
  if (!wallet?.request) throw new Error('Your wallet disconnected. Reconnect and try again.');
  const accounts = await wallet.request({ method: 'eth_accounts' }) as string[];
  if (!accounts.some(a => a.toLowerCase() === owner.toLowerCase())) throw new Error('The connected wallet account changed. Reconnect and try again.');
  if (expected && expected.toLowerCase() !== owner.toLowerCase()) throw new Error(`This permission belongs to ${expected}. Switch to that wallet to manage it, or create a permission for your connected wallet ${owner}.`);
  return wallet;
}
