'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { parseEther } from 'viem';
import { connectedSpendingWallet, fundProviderGas, signSpendingMessage } from '../../lib/spending-wallet-client';
import { ConnectWallet } from '../wallet/ConnectWallet';
import { errorMessage } from '../../lib/error-message';

type Authorization = { whitechainBudget: string; arkivBudget: string; whitechainTxLimit: string; arkivTxLimit: string };
type Status = { configured: boolean; enabled: boolean; whitechain_id: number; arkiv_id: number; address?: string; owner?: string; status?: string; authorization?: Authorization; balances?: { whitechain: string | null; arkiv: string | null }; whitechain_reserved_wei?: string; arkiv_reserved_wei?: string };
const control = 'mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm';
const button = 'rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
async function api(path = '', body?: unknown) {
  const res = await fetch(`/api/provider-gas${path ? `/${path}` : ''}`, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(errorMessage(data.error, 'Provider gas request failed'));
  return data;
}
export function ProviderGas() {
  const { address, connector, isConnected } = useAccount();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [whiteBudget, setWhiteBudget] = useState('0.05'); const [arkivBudget, setArkivBudget] = useState('0.05');
  const [whiteMax, setWhiteMax] = useState('0.02'); const [arkivMax, setArkivMax] = useState('0.01');
  const [days, setDays] = useState('90'); const [amount, setAmount] = useState('0.01'); const [network, setNetwork] = useState<'whitechain' | 'arkiv'>('whitechain');
  async function refresh() { setStatus(await api()); }
  useEffect(() => { void api().then(setStatus).catch(e => setError(errorMessage(e))); }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); await refresh(); } catch (e) { setError(errorMessage(e, 'Provider gas request failed.')); } finally { setBusy(false); } }
  async function wallet() {
    if (!isConnected || !connector || !address) throw new Error('Connect the provider owner wallet first.');
    return connectedSpendingWallet(connector, address, status?.owner);
  }
  async function authorize() {
    const providerWallet = await wallet();
    const prepared = await api('prepare', { owner: address, whitechainBudget: whiteBudget, arkivBudget, whitechainTxLimit: whiteMax, arkivTxLimit: arkivMax, expires: Date.now() + Number(days) * 86400_000 });
    const signature = await signSpendingMessage(providerWallet, address!, prepared.message);
    await api('authorize', { signature });
    setMessage('Authorization saved. Fund the dedicated address on each network before enabling provider operations.');
  }
  async function fund() {
    const providerWallet = await wallet();
    if (!status?.address) throw new Error('Create the dedicated account first.');
    if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n) throw new Error('Enter a positive native-token amount.');
    const chain = network === 'whitechain' ? status.whitechain_id : status.arkiv_id;
    const chainId = `0x${chain.toString(16)}`;
    try { await providerWallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await providerWallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: network === 'arkiv' ? 'Arkiv Rabdi' : chain === 1874 ? 'Whitechain Testnet' : 'Whitechain', nativeCurrency: { name: network === 'arkiv' ? 'Golem' : 'WhiteBIT Coin', symbol: network === 'arkiv' ? 'tGLM' : 'WBT', decimals: 18 }, rpcUrls: [network === 'arkiv' ? 'https://rpc.rabdi.db-chain.testnet.arkiv.network' : chain === 1874 ? 'https://rpc.testnet.whitechain.io' : 'https://rpc.whitechain.io'] }] });
    }
    if (Number(await providerWallet.request({ method: 'eth_chainId' })) !== chain) throw new Error('Wallet is on the wrong funding network.');
    const hash = await fundProviderGas(providerWallet, { owner: address!, to: status.address, value: parseEther(amount), symbol: network === 'arkiv' ? 'tGLM' : 'WBT' });
    setMessage(`Funding submitted: ${hash}. Refresh after confirmation. This transfers native gas currency, not USDT.`);
  }
  async function recover() {
    const providerWallet = await wallet();
    const draft = await api('recovery', { network, amount });
    const signature = await signSpendingMessage(providerWallet, address!, draft.message);
    const result = await api('recover', { signature });
    setMessage(`Recovery submitted: ${result.hash}. Funds return only to the authorized provider owner.`);
  }
  return <section id="provider-gas" className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">Provider-funded gas</h2><ConnectWallet compact /></div>
    <p className="text-sm text-[var(--muted)]">Your dedicated account pays for your entitlement writes and new provider-bound mandate operations. Fund WBT on Whitechain and tGLM on Arkiv separately. This is not your plan’s merchant payout wallet: funds sent to a merchant wallet cannot pay operating gas. Platform wallets do not subsidize these operations. Revoke signing before recovering unused gas funds.</p>
    {error && <p role="alert" className="break-words text-sm text-[var(--deny)]">{error}</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {status?.address && <div className="rounded-xl bg-[var(--soft)] p-3 text-sm"><p className="font-semibold">Dedicated gas address · {status.status}</p><p className="mt-1 break-all font-mono text-xs">{status.address}</p><p className="mt-2 text-[var(--muted)]">Whitechain: {status.balances?.whitechain ?? 'unavailable'} WBT · Arkiv: {status.balances?.arkiv ?? 'unavailable'} tGLM</p><p className="mt-2 break-all text-xs text-[var(--muted)]">Maximum fees reserved: {status.whitechain_reserved_wei ?? '0'} wei (Whitechain), {status.arkiv_reserved_wei ?? '0'} wei (Arkiv). Reservations are conservative limits, not measured transaction costs.</p></div>}
    <fieldset disabled={busy || !status} className="space-y-4 disabled:opacity-60">
      <details open={!status?.configured}><summary className="cursor-pointer text-sm font-semibold">Authorize or renew limited signing</summary>
        <form onSubmit={e => { e.preventDefault(); void run(authorize); }} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Whitechain budget (WBT)<input required className={control} value={whiteBudget} onChange={e => setWhiteBudget(e.target.value)} /></label><label className="text-sm">Arkiv budget (tGLM)<input required className={control} value={arkivBudget} onChange={e => setArkivBudget(e.target.value)} /></label><label className="text-sm">Maximum per transaction (WBT)<input required className={control} value={whiteMax} onChange={e => setWhiteMax(e.target.value)} /></label><label className="text-sm">Maximum per transaction (tGLM)<input required className={control} value={arkivMax} onChange={e => setArkivMax(e.target.value)} /></label><label className="text-sm">Valid for days<input required className={control} type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} /></label></div>
          <p className="text-xs text-[var(--muted)]">The server holds an encrypted delegated key and enforces these limits before signing. This is not an on-chain smart-account restriction. This signature also permits deployment of your fixed-price subscription plans and collection of customer-authorized renewals. Monthly checkout requires at least 31 days of remaining gas authorization; renew it before expiry. New approval resets the authorized fee budgets. Revocation blocks future server signing; previously signed transactions can still settle.</p>
          <button type="submit" className={button}>Review and sign authorization</button>
        </form>
      </details>
      {status?.configured && <div className="space-y-3 border-t border-[var(--line)] pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Network<select className={control} value={network} onChange={e => setNetwork(e.target.value as 'arkiv' | 'whitechain')}><option value="whitechain">Whitechain · WBT</option><option value="arkiv">Arkiv Rabdi · tGLM</option></select></label><label className="text-sm">Native amount<input className={control} value={amount} onChange={e => setAmount(e.target.value)} /></label></div><div className="space-y-3">
        <button type="button" className={button} disabled={status.status !== 'active'} onClick={() => void run(fund)}>Fund {network === 'arkiv' ? 'tGLM on Arkiv' : 'WBT on Whitechain'}</button>
        <p className="break-words text-xs text-[var(--muted)]">Transfer {amount || '0'} {network === 'arkiv' ? 'tGLM' : 'WBT'} from your connected wallet to the dedicated gas address above. Review the network and amount in your wallet. Authorization alone does not deposit funds.</p>
        {status.status !== 'active' && <p className="text-xs text-[var(--warn)]">Authorize signing above before funding this account.</p>}
        <details className="rounded-xl border border-[var(--line)] p-3"><summary className="cursor-pointer text-sm font-medium">Advanced: revoke signing or recover funds</summary>
          <p className="my-3 text-xs text-[var(--muted)]">Recovery returns unused gas to your owner wallet. First revoke future signing; this stops provider operations until you authorize again.</p>
          <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={status.status === 'active'} onClick={() => void run(recover)}>Sign recovery to owner</button><button type="button" className={button} disabled={status.status !== 'active'} onClick={() => void run(async () => { await api('revoke', {}); setMessage('Future signing revoked. Remaining gas funds can still be recovered.'); })}>Revoke signing</button></div>
        </details>
      </div></div>}
      <button type="button" className="text-sm font-medium text-[var(--blue)] underline" onClick={() => void run(refresh)}>Refresh account</button>
    </fieldset>
  </section>;
}
