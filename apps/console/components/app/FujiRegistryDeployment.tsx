'use client';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { connectedSpendingWallet, signSpendingMessage } from '../../lib/spending-wallet-client';
import { ConnectWallet } from '../wallet/ConnectWallet';
import { errorMessage } from '../../lib/error-message';
import { formatEther } from 'viem';

type Deployment = { address: string; transaction: string; token: string; rpc_url: string };
type Draft = { deployment?: Deployment; chain_id: number; genesis_hash: string; token: string; rpc_url: string;
  balance_wei: string; estimated_max_fee_wei: string; transaction: { from: string; data: string; value: string } };
async function api(action: string, body: unknown) {
  const r = await fetch(`/api/daemon/deployments/registry/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw Error(errorMessage(data.error, 'Deployment request failed')); return data;
}
export function FujiRegistryDeployment() {
  const { address, connector } = useAccount();
  const [draft, setDraft] = useState<Draft | null>(null), [deployment, setDeployment] = useState<Deployment | null>(null);
  const [hash, setHash] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const button = 'rounded-full bg-[var(--ink)] px-4 py-2 text-sm text-white disabled:opacity-50';
  const matchesConnected = Boolean(address && draft?.transaction?.from.toLowerCase() === address.toLowerCase());
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function verifyWallet(expected?: string) {
    if (!address || !connector) throw Error('Connect the wallet you want to use for this deployment');
    const wallet = await connectedSpendingWallet(connector, address, expected);
    const response = await fetch(`/api/deployment-wallet/verify?owner=${encodeURIComponent(address)}`, { cache: 'no-store' });
    const challenge = await response.json();
    if (!response.ok) throw Error(errorMessage(challenge.error, 'Could not verify deployment wallet'));
    const signature = await signSpendingMessage(wallet, address, challenge.message);
    const verified = await fetch('/api/deployment-wallet/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }) });
    const result = await verified.json();
    if (!verified.ok) throw Error(errorMessage(result.error, 'Deployment wallet verification failed'));
    if (result.owner_address?.toLowerCase() !== address.toLowerCase()) throw Error('Wallet changed during verification. Prepare again.');
    return wallet;
  }
  async function deploy() {
    if (!draft || !address || !connector) throw Error('Prepare the deployment and connect your verified wallet first');
    const wallet = await connectedSpendingWallet(connector, address, draft.transaction.from);
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa869' }] });
    const genesis = await wallet.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }) as { hash?: string };
    if (genesis?.hash !== draft.genesis_hash) throw Error(`Your wallet is pointing at Anvil or another network with chain ID 43113. Select public Fuji RPC ${draft.rpc_url} in your wallet before approving this deployment.`);
    // Only this explicit button requests the financial wallet approval.
    const sent = await wallet.request({ method: 'eth_sendTransaction', params: [draft.transaction] }); setHash(String(sent));
  }
  return <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Public Fuji deployment</h2><ConnectWallet compact /></div>
    <p className="text-sm text-[var(--muted)]">Prepare the entitlement registry for public Avalanche Fuji, review the test AVAX fee, then approve in your wallet. Your local Anvil deployment stays selected until you explicitly activate a verified public deployment.</p>
    {address && <p className="break-all text-sm">Connected deployment wallet: {address}</p>}
    {error && <p role="alert" className="break-words text-sm text-[var(--deny)]">{error}</p>}
    <button className={button} disabled={busy || !address || !connector} onClick={() => void run(async () => {
      if (hash && !deployment) throw Error('Verify the existing deployment transaction before preparing another one');
      setDraft(null);
      await verifyWallet();
      const prepared: Draft = await api('prepare', {}); setDraft(prepared); if (prepared.deployment) setDeployment(prepared.deployment);
    })}>Prepare Fuji registry</button>
    {draft && !deployment && <div className="space-y-3 text-sm"><p className="break-all">Network: public Fuji (43113) · USDC: {draft.token}</p><p>Wallet: {draft.transaction.from}</p><p>Balance: {formatEther(BigInt(draft.balance_wei))} test AVAX · Estimated fee allowance: {formatEther(BigInt(draft.estimated_max_fee_wei))} test AVAX</p>{!matchesConnected && <p role="status">Your connected wallet changed. Prepare a new draft for that wallet before approving.</p>}<button className={button} disabled={busy || !!hash || !matchesConnected || BigInt(draft.balance_wei) < BigInt(draft.estimated_max_fee_wei)} onClick={() => void run(deploy)}>Review and approve deployment in wallet</button></div>}
    <div className="flex flex-wrap gap-2"><input aria-label="Fuji deployment transaction" placeholder="Deployment transaction 0x…" value={hash} onChange={e => setHash(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm" /><button className={button} disabled={busy || !/^0x[\da-f]{64}$/i.test(hash)} onClick={() => void run(async () => {
      await verifyWallet(draft?.transaction?.from);
      const verified = await api('confirm', { hash }); setDeployment(verified.deployment);
    })}>Verify deployment</button></div>
    {deployment && <div role="status" className="space-y-2 break-all text-sm"><p>Confirmed registry: {deployment.address}</p><a href={`https://testnet.snowtrace.io/tx/${deployment.transaction}`} target="_blank" rel="noreferrer" className="text-[var(--blue)] underline">View confirmed deployment</a><p>Use this verified address in the public deployment configuration. This verification does not enroll customers or grant payment authority.</p></div>}
  </section>;
}
