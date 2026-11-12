'use client';
import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { connectedSpendingWallet, signSpendingMessage } from '../../lib/spending-wallet-client';
import { errorMessage } from '../../lib/error-message';
import type { MandateOverview } from '../../lib/mandate-client';

type Authority = { id: string; mandate_id: string; worker_id: string; payer: string; merchant: string; status: string };
type Payment = { x402_job_id: string; status: string; payer: string; amount_atomic: string; last_error: string | null };
async function api(path: string, body?: unknown) {
  const res = await fetch(`/api/daemon/x402/${path}`, { cache: 'no-store', ...(body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const data = await res.json();
  if (!res.ok) throw Error(errorMessage(data.error, 'Payment request failed'));
  return data;
}
export function X402Payments({ mandateId, overview }: { mandateId: string | null; overview: MandateOverview | null }) {
  const { address, connector } = useAccount();
  const [authorities, setAuthorities] = useState<Authority[]>([]), [payments, setPayments] = useState<Payment[]>([]);
  const [worker, setWorker] = useState(''), [merchant, setMerchant] = useState(''), [origin, setOrigin] = useState('');
  const [amount, setAmount] = useState('0.1'), [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function refresh() { const [a, p] = await Promise.all([api('authorities'), api('payments')]); setAuthorities(a); setPayments(p); }
  useEffect(() => { void refresh().catch(e => setError(errorMessage(e))); }, [mandateId]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); await refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const input = 'w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm';
  const button = 'rounded-full bg-[var(--ink)] px-4 py-2 text-sm text-white disabled:opacity-50';
  return <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5">
    <h2 className="font-semibold">Isolated x402 payments</h2>
    <p className="text-sm text-[var(--muted)]">Approve a separate payment signer for one merchant and resource origin. It receives only mandate-authorized funding. Gas authorization stays separate. Vault limits apply on-chain to funding this payer; merchant restrictions are enforced by the server. Refunds return to the original vault without resetting spent limits.</p>
    {error && <p role="alert" className="break-words text-sm text-[var(--deny)]">{error}</p>}
    {message && <p role="status" className="break-words text-sm">{message}</p>}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); void run(async () => {
      if (!address || !connector || !mandateId || !overview) throw Error('Select a spending permission and connect its owner wallet');
      const wallet = await connectedSpendingWallet(connector, address, overview.terms.owner_address);
      const prepared = await api('prepare', { mandate_id: mandateId, worker_id: worker, merchant, provider_origin: origin,
        max_amount: amount, expires: Date.now() + Number(days) * 86400000 });
      const signature = await signSpendingMessage(wallet, address, prepared.message);
      await api('authorize', { authority_id: prepared.authority_id, signature });
      setMessage(`Payment authority approved for payer ${prepared.terms.payer}. No funds were transferred by this approval.`);
    }); }}>
      <label className="text-sm">Agent<select required className={input} value={worker} onChange={e => setWorker(e.target.value)}><option value="">Choose agent</option>{overview?.agents.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}</select></label>
      <label className="text-sm">Merchant wallet<input required className={input} value={merchant} onChange={e => setMerchant(e.target.value)} placeholder="0x…" /></label>
      <label className="text-sm">Resource origin<input required type="url" className={input} value={origin} onChange={e => setOrigin(e.target.value)} placeholder="https://provider.example" /></label>
      <label className="text-sm">Maximum per payment (USDC)<input required className={input} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="text-sm">Expires in days<input required type="number" min="1" max="365" className={input} value={days} onChange={e => setDays(e.target.value)} /></label>
      <div className="self-end"><button disabled={busy || !mandateId} className={button}>Review and sign payment authority</button></div>
    </form>
    {authorities.filter(a => a.mandate_id === mandateId).map(a => <div key={a.id} className="space-y-2 border-t border-[var(--line)] pt-3 text-sm"><p className="break-all">{a.status} · {a.payer} → {a.merchant}</p><button className={button} disabled={busy || a.status !== 'active'} onClick={() => void run(async () => { await api('revoke', { authority_id: a.id }); setMessage('New signing revoked. Existing signatures may settle until expiry; unused funding is reconciled back to its vault.'); })}>Revoke payment signing</button></div>)}
    <button className={button} disabled={busy} onClick={() => void run(refresh)}>Refresh payments</button>
    {payments.map(p => <div key={p.x402_job_id} className="space-y-2 border-t border-[var(--line)] pt-3 text-sm"><p className="break-all">{p.x402_job_id} · {p.status} · {Number(p.amount_atomic) / 1e6} USDC</p>{p.last_error && <p className="break-words">{p.last_error}</p>}<button className={button} disabled={busy} onClick={() => void run(async () => { await api(`payments/${p.x402_job_id}/reconcile`, {}); })}>Reconcile payment</button><button className={`${button} ml-2`} disabled={busy} onClick={() => void run(async () => {
      const draft = await api(`payments/${p.x402_job_id}/recovery-draft`, {});
      // Display the draft; never automatically send a financial transaction.
      setMessage(JSON.stringify(draft));
    })}>Show recovery transaction</button></div>)}
  </section>;
}
