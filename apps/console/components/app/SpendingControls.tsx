'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { mandateApi, type MandateOverview, type SpendingConfig } from '../../lib/mandate-client';
import { connectedSpendingWallet, type SpendingWallet as Wallet } from '../../lib/spending-wallet-client';

const inputClass = 'mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';

export function SpendingControls({ selectedId, overview, onChange, onCreated }: {
  selectedId: string | null; overview: MandateOverview | null; onChange: () => Promise<void>; onCreated: (id: string) => void;
}) {
  const { address, isConnected, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [config, setConfig] = useState<SpendingConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [operator, setOperator] = useState('');
  const [budget, setBudget] = useState('1');
  const [lifetime, setLifetime] = useState('10');
  const [purchase, setPurchase] = useState('0.1');
  const [depth, setDepth] = useState('2');
  const [sellerPct, setSellerPct] = useState('100');
  const [windowHours, setWindowHours] = useState('24');
  const [amount, setAmount] = useState('');
  const [parent, setParent] = useState('');
  const [childOperator, setChildOperator] = useState('');
  const [share, setShare] = useState('10');
  useEffect(() => {
    void mandateApi.config().then(c => { setConfig(c); setOperator(c.operator_address); setChildOperator(c.operator_address); }).catch(e => setError(String(e.message ?? e)));
  }, []);
  const current = overview?.mandate_id === selectedId ? overview : null;
  const available = current?.onchain_state.status === 'available';

  async function ownerWallet(expected?: string) {
    if (!config) throw new Error('Spending configuration has not loaded');
    if (!isConnected || !address || !connector) {
      openConnectModal?.();
      throw new Error('Connect your wallet using Connect Wallet, then try again.');
    }
    // Use the selected RainbowKit/WalletConnect connector, never an unrelated
    // injected provider that happens to be present on window.ethereum.
    const owner = address;
    const wallet = await connectedSpendingWallet(connector, owner, expected);
    const chainId = `0x${config.chain_id.toString(16)}`;
    try { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] }); }
    catch (e) {
      if ((e as { code?: number }).code !== 4902) throw e;
      await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId, chainName: config.chain_id === 1874 ? 'Whitechain Testnet' : 'Whitechain', rpcUrls: [config.rpc_url], nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 } }] });
    }
    const actual = await wallet.request({ method: 'eth_chainId' });
    if (Number(actual) !== config.chain_id) throw new Error('Select the configured Whitechain network in your wallet.');
    if (!config.owner_addresses.some(a => a.toLowerCase() === owner.toLowerCase()) || (!expected && config.owner_addresses[0]?.toLowerCase() !== owner.toLowerCase())) {
      setMessage('Verify wallet ownership with a signature. This does not transfer funds.');
      const challenge = await fetch(`/api/auth/wallet/verify?owner=${encodeURIComponent(owner)}`, { cache: 'no-store' });
      const data = await challenge.json();
      if (!challenge.ok) throw new Error(data.error?.message ?? 'Could not start wallet verification');
      const signature = await sign(wallet, owner, data.message);
      const verified = await fetch('/api/auth/wallet/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }) });
      const result = await verified.json();
      if (!verified.ok) throw new Error(result.error?.message ?? 'Wallet verification failed');
      setConfig(await mandateApi.config());
    }
    return { wallet, owner };
  }
  async function sign(wallet: Wallet, owner: string, text: string) {
    const hex = '0x' + Array.from(new TextEncoder().encode(text), b => b.toString(16).padStart(2, '0')).join('');
    return wallet.request({ method: 'personal_sign', params: [hex, owner] }) as Promise<string>;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); await onChange(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function create() {
    const { wallet, owner } = await ownerWallet();
    const prepared = await mandateApi.prepare({ owner_address: owner, operator_address: operator,
      budget_per_window: budget, lifetime_cap: lifetime, per_purchase_cap: purchase,
      window_seconds: Math.round(Number(windowHours) * 3600), per_seller_pct: Math.round(Number(sellerPct) * 100), max_depth: Number(depth), chain_id: config!.chain_id });
    const signature = await sign(wallet, owner, prepared.message);
    setMessage('Deploying your signed permission to Whitechain…');
    const result = await mandateApi.create({ ...prepared.payload, signature });
    onCreated(result.mandate_id);
    setMessage(`Spending permission created. Root agent: ${result.root_agent_id}. Fund it before authorizing payments.`);
  }
  async function transact(action: 'fund' | 'withdraw' | 'revoke') {
    if (!selectedId || !current) return;
    const { wallet } = await ownerWallet(current.terms.owner_address);
    const draft = await mandateApi.transaction(selectedId, { action, amount });
    const { chain_id: chainId, ...transaction } = draft;
    if (chainId !== config!.chain_id) throw new Error('Transaction network mismatch');
    const hash = await wallet.request({ method: 'eth_sendTransaction', params: [transaction] }) as string;
    setMessage(`Transaction submitted: ${hash}. Waiting for confirmation…`);
    for (let i = 0; i < 45; i++) {
      const receipt = await wallet.request({ method: 'eth_getTransactionReceipt', params: [hash] }) as { status: string } | null;
      if (receipt) {
        if (receipt.status !== '0x1') throw new Error(`Transaction reverted: ${hash}`);
        setMessage(`${action === 'fund' ? 'Funding' : action === 'withdraw' ? 'Withdrawal' : 'Revocation'} confirmed: ${hash}`);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    setMessage(`Transaction still pending: ${hash}. Check your wallet before submitting again, then refresh.`);
  }
  async function delegate() {
    if (!selectedId || !current) return;
    const { wallet, owner } = await ownerWallet(current.terms.owner_address);
    const prepared = await mandateApi.delegate(selectedId, { parent_agent_id: current.agents.some(a => a.id === parent) ? parent : current.agents[0]?.id,
      operator_address: childOperator, share_percent: Number(share), chain_id: config!.chain_id });
    const signature = await sign(wallet, owner, prepared.message);
    const result = await mandateApi.spawn(selectedId, { ...prepared.payload, signature });
    setMessage(`Child agent registered: ${result.agent_id}`);
  }
  return <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
    <h2 className="text-base font-semibold">Manage agent spending</h2>
    <p className="text-sm text-[var(--muted)]">These permissions apply to new USDT payments. Using prepaid service credits does not require a funded permission. Your owner wallet approves each change.</p>
    <p className="text-sm text-[var(--muted)]">Provider gas must be funded and authorized before creating a permission. <Link href="/app/settings" className="text-[var(--blue)] underline">Configure provider-funded gas</Link>.</p>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="break-all text-[var(--muted)]">{isConnected && address ? `Connected: ${address}` : 'Connect a wallet to manage your spending permissions.'}</span>
      <button type="button" disabled={busy || !config} className={buttonClass} onClick={() => {
        if (!isConnected) { openConnectModal?.(); return; }
        void run(async () => { await ownerWallet(); setMessage('Your connected wallet is ready for agent spending.'); });
      }}>{isConnected ? 'Use connected wallet' : 'Connect wallet'}</button>
    </div>
    {error && <p role="alert" className="break-words text-sm text-[var(--deny)]">{error}</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    <fieldset disabled={busy || !config} className="space-y-4 disabled:opacity-60">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Create a spending permission</summary>
        <form onSubmit={e => { e.preventDefault(); void run(create); }} className="mt-3 space-y-3">
          <label className="block text-sm">Agent operator wallet<input required value={operator} onChange={e => setOperator(e.target.value)} className={inputClass} pattern="0x[0-9a-fA-F]{40}" /></label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">Budget per window (USDT)<input required value={budget} onChange={e => setBudget(e.target.value)} className={inputClass} inputMode="decimal" /></label>
            <label className="text-sm">Lifetime limit (USDT)<input required value={lifetime} onChange={e => setLifetime(e.target.value)} className={inputClass} inputMode="decimal" /></label>
            <label className="text-sm">Maximum per payment (USDT)<input required value={purchase} onChange={e => setPurchase(e.target.value)} className={inputClass} inputMode="decimal" /></label>
            <label className="text-sm">Window (hours)<input required type="number" min="1" value={windowHours} onChange={e => setWindowHours(e.target.value)} className={inputClass} /></label>
            <label className="text-sm">Limit per provider (% of lifetime)<input required type="number" min="1" max="100" value={sellerPct} onChange={e => setSellerPct(e.target.value)} className={inputClass} /></label>
            <label className="text-sm">Maximum delegation depth<input required type="number" min="0" max="10" value={depth} onChange={e => setDepth(e.target.value)} className={inputClass} /></label>
          </div>
          <p className="text-xs text-[var(--muted)]">Limits are fixed at creation. Creating a permission does not transfer USDT or change the agent bound to your MCP connection.</p>
          <button className={buttonClass} type="submit">Sign and create permission</button>
        </form>
      </details>
      {current && <div className="space-y-4 border-t border-[var(--line)] pt-4">
        <p className="text-sm font-semibold">Selected permission</p>
        <label className="block text-sm">Amount (USDT)<input value={amount} onChange={e => setAmount(e.target.value)} className={inputClass} inputMode="decimal" placeholder="0.10" /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!available || current.onchain_revoked || !amount} onClick={() => void run(() => transact('fund'))} className={buttonClass}>Fund from wallet</button>
          <button type="button" disabled={!available || !amount} onClick={() => void run(() => transact('withdraw'))} className={buttonClass}>Withdraw to owner</button>
          <button type="button" disabled={!available || current.onchain_revoked === true} onClick={() => void run(() => transact('revoke'))} className={buttonClass}>Revoke spending</button>
        </div>
        <p className="text-xs text-[var(--muted)]">Revocation permanently stops future spending. Remaining funds can still be withdrawn.</p>
        {available && !current.onchain_revoked && <details>
          <summary className="cursor-pointer text-sm font-semibold">Delegate to a child agent</summary>
          <form onSubmit={e => { e.preventDefault(); void run(delegate); }} className="mt-3 space-y-3">
            <label className="block text-sm">Parent agent<select value={current.agents.some(a => a.id === parent) ? parent : current.agents[0]?.id ?? ''} onChange={e => setParent(e.target.value)} className={inputClass}>{current.agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}</select></label>
            <label className="block text-sm">Child operator wallet<input required value={childOperator} onChange={e => setChildOperator(e.target.value)} pattern="0x[0-9a-fA-F]{40}" className={inputClass} /></label>
            <label className="block text-sm">Share of parent allocation (%)<input required type="number" min="1" max="100" value={share} onChange={e => setShare(e.target.value)} className={inputClass} /></label>
            <button type="submit" disabled={!current.agents.length} className={buttonClass}>Sign and register child</button>
          </form>
        </details>}
      </div>}
    </fieldset>
  </section>;
}
