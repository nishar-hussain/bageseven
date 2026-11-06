/** Browser Whitechain wallet helpers (WhiteWallet-ready). */

export const WHITECHAIN_SEPOLIA = {
  chainId: 1874,
  chainIdHex: '0x752',
  name: 'Whitechain Testnet',
  rpcUrl: 'https://rpc.testnet.whitechain.io',
  explorer: 'https://explorer.testnet.whitechain.io',
  nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 },
  /** Portal prize USDT on Whitechain Sepolia */
  usdt: '0xaa7962d073935D387e8d442DA1D7149C81388f46',
} as const;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isWhiteWallet?: boolean;
  providers?: EthereumProvider[];
};

function pickProvider(): EthereumProvider | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as unknown as { ethereum?: EthereumProvider; whitewallet?: EthereumProvider }).ethereum;
  const ww = (window as unknown as { whitewallet?: EthereumProvider }).whitewallet;
  if (ww) return ww;
  if (!eth) return null;
  if (eth.providers?.length) {
    const preferred =
      eth.providers.find((p) => p.isWhiteWallet) ||
      eth.providers.find((p) => p.isMetaMask) ||
      eth.providers[0];
    return preferred ?? eth;
  }
  return eth;
}

export async function connectWhitechainWallet(): Promise<{ address: string; provider: EthereumProvider }> {
  const provider = pickProvider();
  if (!provider) {
    throw new Error('No EVM wallet found. Install WhiteWallet (when available) or MetaMask, then connect to Whitechain Testnet (1874).');
  }
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  const address = accounts[0];
  if (!address) throw new Error('Wallet returned no accounts');
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: WHITECHAIN_SEPOLIA.chainIdHex }],
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: WHITECHAIN_SEPOLIA.chainIdHex,
            chainName: WHITECHAIN_SEPOLIA.name,
            nativeCurrency: WHITECHAIN_SEPOLIA.nativeCurrency,
            rpcUrls: [WHITECHAIN_SEPOLIA.rpcUrl],
            blockExplorerUrls: [WHITECHAIN_SEPOLIA.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
  return { address, provider };
}

function encodeUsdtTransfer(to: string, amountHuman: string): string {
  // transfer(address,uint256) selector + args; amount as 6-decimal USDT
  const [whole, frac = ''] = amountHuman.split('.');
  const fracPad = (frac + '000000').slice(0, 6);
  const units = BigInt(whole || '0') * 1_000_000n + BigInt(fracPad || '0');
  const selector = '0xa9059cbb';
  const toWord = to.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const amtWord = units.toString(16).padStart(64, '0');
  return `${selector}${toWord}${amtWord}`;
}

export async function payUsdtOnWhitechain(input: {
  merchantWallet: string;
  amount: string;
  usdt?: string;
}): Promise<{ payment_tx: string; customer_wallet: string }> {
  const { address, provider } = await connectWhitechainWallet();
  const usdt = (input.usdt || WHITECHAIN_SEPOLIA.usdt) as string;
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
  return { payment_tx, customer_wallet: address };
}
