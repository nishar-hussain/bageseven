export type SpendingWallet = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Use the active connector's account, including mobile WalletConnect wallets. */
export async function connectedSpendingWallet(connector: { getProvider: () => Promise<unknown> }, owner: string, expected?: string) {
  const wallet = await connector.getProvider() as SpendingWallet | undefined;
  if (!wallet?.request) throw new Error('Your wallet disconnected. Reconnect and try again.');
  const accounts = await wallet.request({ method: 'eth_accounts' }) as string[];
  if (!accounts.some(a => a.toLowerCase() === owner.toLowerCase())) throw new Error('The connected wallet account changed. Reconnect and try again.');
  if (expected && expected.toLowerCase() !== owner.toLowerCase()) throw new Error(`This permission belongs to ${expected}. Switch to that wallet to manage it, or create a permission for your connected wallet ${owner}.`);
  return wallet;
}
