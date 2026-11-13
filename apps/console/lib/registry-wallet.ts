import type { SpendingWallet } from './spending-wallet-client';
export async function submitRegistryDeployment(wallet: SpendingWallet, draft: {
  chain_id: number; genesis_hash: string; rpc_url: string; transaction: { from: string; data: string; value: string };
}) {
  if (draft.chain_id !== 43113) throw Error('Registry deployment requires public Avalanche Fuji.');
  if (Number(await wallet.request({ method: 'eth_chainId' })) !== draft.chain_id)
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] });
  if (Number(await wallet.request({ method: 'eth_chainId' })) !== draft.chain_id) throw Error('Select public Avalanche Fuji in your wallet before approving.');
  const genesis = await wallet.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }) as { hash?: string };
  if (genesis?.hash !== draft.genesis_hash) throw Error('The wallet RPC is not public Fuji. Select ' + draft.rpc_url + ' before approving this deployment.');
  const hash = await wallet.request({ method: 'eth_sendTransaction', params: [draft.transaction] });
  if (typeof hash !== 'string' || !/^0x[\da-f]{64}$/i.test(hash)) throw Error('Your wallet did not return a transaction hash. Check wallet activity before attempting another deployment.');
  return hash;
}
