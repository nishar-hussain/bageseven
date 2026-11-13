'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { parseEther } from 'viem';
import { connectedSpendingWallet, fundProviderGas, signSpendingMessage } from '../../lib/spending-wallet-client';
import { ConnectWallet } from '../wallet/ConnectWallet';
import { errorMessage } from '../../lib/error-message';
import { avalancheFuji } from '../../lib/wagmi-config';

type Authorization = { avalancheBudget: string; registryBudget: string; avalancheTxLimit: string; registryTxLimit: string };
type Status = { configured: boolean; enabled: boolean; avalanche_id: number; registry_id: number; address?: string; owner?: string; status?: string; authorization?: Authorization; balances?: { avalanche: string | null; registry: string | null }; avalanche_reserved_wei?: string; registry_reserved_wei?: string };
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
  const [whiteBudget, setWhiteBudget] = useState('0.05'); const [registryBudget, setRegistryBudget] = useState('0.05');
  const [whiteMax, setWhiteMax] = useState('0.02'); const [registryMax, setRegistryMax] = useState('0.01');
  const [days, setDays] = useState('90'); const [amount, setAmount] = useState('0.01'); const [network, setNetwork] = useState<'avalanche' | 'registry'>('avalanche');
  async function refresh() { setStatus(await api()); }
  useEffect(() => { void api().then(setStatus).catch(e => setError(errorMessage(e))); }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); await refresh(); } catch (e) { setError(errorMessage(e, 'Provider gas request failed.')); } finally { setBusy(false); } }
  async function wallet() {
    if (!isConnected || !connector || !address) throw new Error('Connect the provider owner wallet first.');
    return connectedSpendingWallet(connector, address, status?.owner);
  }
  async function authorize() {
    const providerWallet = await wallet();
    const prepared = await api('prepare', { owner: address, avalancheBudget: whiteBudget, registryBudget, avalancheTxLimit: whiteMax, registryTxLimit: registryMax, expires: Date.now() + Number(days) * 86400_000 });
    const signature = await signSpendingMessage(providerWallet, address!, prepared.message);
    await api('authorize', { signature });
    setMessage('Authorization saved. Fund the dedicated address with AVAX before enabling provider operations.');
  }
  async function fund() {
    const providerWallet = await wallet();
    if (!status?.address) throw new Error('Create the dedicated account first.');
    if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n) throw new Error('Enter a positive native-token amount.');
    const chain = network === 'avalanche' ? status.avalanche_id : status.registry_id;
    const chainId = `0x${chain.toString(16)}`;
    try { await providerWallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await providerWallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: chain === 43113 ? avalancheFuji.name : 'Avalanche C-Chain', nativeCurrency: avalancheFuji.nativeCurrency, rpcUrls: [chain === 43113 ? avalancheFuji.rpcUrls.default.http[0] : 'https://api.avax.network/ext/bc/C/rpc'] }] });
    }
    if (Number(await providerWallet.request({ method: 'eth_chainId' })) !== chain) throw new Error('Wallet is on the wrong funding network.');
    const hash = await fundProviderGas(providerWallet, { owner: address!, to: status.address, value: parseEther(amount), symbol: network === 'registry' ? 'AVAX' : 'AVAX' });
    setMessage(`Funding submitted: ${hash}. Refresh after confirmation. This transfers native gas currency, not stablecoin.`);
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
    <p className="text-sm text-[var(--muted)]">Your dedicated account pays for entitlement writes, subscriptions and provider-bound mandate operations on Avalanche. Fund this address once with AVAX; settlement and registry signing share its balance and have separate fee budgets. Your merchant payout wallet is separate. Revoke signing before recovering unused gas funds.</p>
    {error && <p role="alert" className="break-words text-sm text-[var(--deny)]">{error}</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    {status?.address && <div className="rounded-xl bg-[var(--soft)] p-3 text-sm"><p className="font-semibold">Dedicated gas address · {status.status}</p><p className="mt-1 break-all font-mono text-xs">{status.address}</p><p className="mt-2 text-[var(--muted)]">Avalanche: {status.balances?.avalanche ?? 'unavailable'} AVAX · Registry: {status.balances?.registry ?? 'unavailable'} AVAX</p><p className="mt-2 break-all text-xs text-[var(--muted)]">Maximum fees reserved: {status.avalanche_reserved_wei ?? '0'} wei (Avalanche), {status.registry_reserved_wei ?? '0'} wei (Registry). Reservations are conservative limits, not measured transaction costs.</p></div>}
    <fieldset disabled={busy || !status} className="space-y-4 disabled:opacity-60">
      <details open={!status?.configured}><summary className="cursor-pointer text-sm font-semibold">Authorize or renew limited signing</summary>
        <form onSubmit={e => { e.preventDefault(); void run(authorize); }} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Avalanche budget (AVAX)<input required className={control} value={whiteBudget} onChange={e => setWhiteBudget(e.target.value)} /></label><label className="text-sm">Registry budget (AVAX)<input required className={control} value={registryBudget} onChange={e => setRegistryBudget(e.target.value)} /></label><label className="text-sm">Maximum per transaction (AVAX)<input required className={control} value={whiteMax} onChange={e => setWhiteMax(e.target.value)} /></label><label className="text-sm">Maximum per transaction (AVAX)<input required className={control} value={registryMax} onChange={e => setRegistryMax(e.target.value)} /></label><label className="text-sm">Valid for days<input required className={control} type="number" min="1" max="365" value={days} onChange={e => setDays(e.target.value)} /></label></div>
          <p className="text-xs text-[var(--muted)]">The server holds an encrypted delegated key and enforces these limits before signing. This is not an on-chain smart-account restriction. This signature also permits deployment of your fixed-price subscription plans and collection of customer-authorized renewals. Monthly checkout requires at least 31 days of remaining gas authorization; renew it before expiry. New approval resets the authorized fee budgets. Revocation blocks future server signing; previously signed transactions can still settle.</p>
          <button type="submit" className={button}>Review and sign authorization</button>
        </form>
      </details>
      {status?.configured && <div className="space-y-3 border-t border-[var(--line)] pt-4"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Fee budget for recovery<select className={control} value={network} onChange={e => setNetwork(e.target.value as 'registry' | 'avalanche')}><option value="avalanche">Settlement operations</option><option value="registry">Registry operations</option></select></label><label className="text-sm">Native amount<input className={control} value={amount} onChange={e => setAmount(e.target.value)} /></label></div><div className="space-y-3">
        <button type="button" className={button} disabled={status.status !== 'active'} onClick={() => void run(fund)}>Fund AVAX on Avalanche</button>
        <p className="break-words text-xs text-[var(--muted)]">Transfer {amount || '0'} {network === 'registry' ? 'AVAX' : 'AVAX'} from your connected wallet to the dedicated gas address above. Review the network and amount in your wallet. Authorization alone does not deposit funds.</p>
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
