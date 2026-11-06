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

function walletNetwork(chainId: number) {
  if (chainId === 1874) return WHITECHAIN_SEPOLIA;
  if (chainId === 1875) return { ...WHITECHAIN_SEPOLIA, chainId: 1875, chainIdHex: '0x753', name: 'Whitechain', rpcUrl: 'https://rpc.whitechain.io', explorer: 'https://explorer.whitechain.io' };
  throw new Error('Unsupported Whitechain network');
}

export async function connectWhitechainWallet(chainId = 1874): Promise<{ address: string; provider: EthereumProvider }> {
  const network = walletNetwork(chainId);
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
  if (!/^\d+(\.\d{1,6})?$/.test(amountHuman)) throw new Error('USDT amount must have at most 6 decimal places');
  // transfer(address,uint256) selector + args; amount as 6-decimal USDT
  const [whole, frac = ''] = amountHuman.split('.');
  const fracPad = (frac + '000000').slice(0, 6);
  const units = BigInt(whole || '0') * 1_000_000n + BigInt(fracPad || '0');
  if (units <= 0n) throw new Error('USDT amount must be positive');
  const selector = '0xa9059cbb';
  const toWord = to.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const amtWord = units.toString(16).padStart(64, '0');
  return `${selector}${toWord}${amtWord}`;
}

/** Wallet authorization binds a visible transaction to exactly one purchase. */
export async function authorizeWhitechainPayment(input: { payment_tx: string; context: string; chainId?: number }): Promise<{ customer_wallet: string; payment_signature: string }> {
  const { address, provider } = await connectWhitechainWallet(input.chainId ?? 1874);
  const message = `Bagseven payment confirmation\nContext: ${input.context}\nChain: ${input.chainId ?? 1874}\nTransaction: ${input.payment_tx.toLowerCase()}`;
  const hex = '0x' + Array.from(new TextEncoder().encode(message)).map((v) => v.toString(16).padStart(2, '0')).join('');
  const signature = await provider.request({ method: 'personal_sign', params: [hex, address] });
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Wallet did not authorize this purchase');
  return { customer_wallet: address, payment_signature: signature };
}

export async function payUsdtOnWhitechain(input: {
  merchantWallet: string;
  amount: string;
  usdt?: string;
  chainId?: number;
  context?: string;
}): Promise<{ payment_tx: string; customer_wallet: string; payment_signature?: string }> {
  const { address, provider } = await connectWhitechainWallet(input.chainId ?? 1874);
  const usdt = input.usdt || ((input.chainId ?? 1874) === 1874 ? WHITECHAIN_SEPOLIA.usdt : '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(usdt)) throw new Error('The checkout has no valid USDT contract');
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
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const receipt = await provider.request({ method: 'eth_getTransactionReceipt', params: [payment_tx] }) as { status: string; blockNumber: string } | null;
    if (receipt) {
      if (receipt.status !== '0x1') throw new Error('Whitechain payment reverted');
      const tip = await provider.request({ method: 'eth_blockNumber' }) as string;
      if (BigInt(tip) - BigInt(receipt.blockNumber) >= 1n) {
        const authorization = input.context ? await authorizeWhitechainPayment({ payment_tx, context: input.context, chainId: input.chainId }) : { customer_wallet: address };
        return { payment_tx, ...authorization };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Payment is still pending. Retry confirmation with transaction ${payment_tx}`);
}
