'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, PrimaryButton, SecondaryButton, SoftCard, StatusPill } from '../../../components/app/ui';

type Key = { id: string; name: string; kind: 'sk' | 'pk'; hint: string; public_key: string | null; created_at: string; expires_at: string; last_used_at: string | null; revoked_at: string | null };
type Creds = { keys: Key[]; components: Array<{ id: string; label: string; blurb: string }> };
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export default function DevelopersPage() {
  const [creds, setCreds] = useState<Creds | null>(null);
  const [created, setCreated] = useState<{ key: string; record: Key } | null>(null);
  const [name, setName] = useState(''), [kind, setKind] = useState<'sk' | 'pk'>('sk'), [days, setDays] = useState('90');
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [copied, setCopied] = useState('');
  const [revoking, setRevoking] = useState<Key | null>(null);
  const load = useCallback(async () => {
    const response = await fetch('/api/developer/credentials', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw Error(data.error?.message || 'Could not load API keys.');
    setCreds(data);
  }, []);
  useEffect(() => { void load().catch(error => setMsg(error.message)); }, [load]);
  const copy = async (id: string, key: string) => {
    try { await navigator.clipboard.writeText(key); setCopied(id); setTimeout(() => setCopied(''), 2000); }
    catch { setMsg('Clipboard access is unavailable. Select and copy the key directly.'); }
  };
  const create = async () => {
    setBusy(true); setMsg('');
    try {
      const response = await fetch('/api/developer/credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, kind, days: Number(days) }) });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.message || 'Could not create API key.');
      setCreated(data); setName(''); await load();
    } catch (error) { setMsg(error instanceof Error ? error.message : 'Request failed. Check the list before creating another key.'); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true); setMsg('');
    try {
      const response = await fetch('/api/developer/credentials?id=' + encodeURIComponent(revoking.id), { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error?.message || 'Could not revoke API key.');
      if (created?.record.id === revoking.id) setCreated(null);
      setRevoking(null); await load();
    } catch (error) { setMsg(error instanceof Error ? error.message : 'Revocation failed.'); }
    finally { setBusy(false); }
  };
  return <div className="mx-auto max-w-4xl space-y-6">
    <PageHeader title="Developers" description="Connect your application with keys scoped to your provider account." action={<PrimaryButton href="/app/builder">Open Builder</PrimaryButton>} />
    {msg && <p role="alert" className="text-sm text-[var(--deny)]">{msg}</p>}
    {created && <SoftCard className="space-y-4 border-[var(--blue)] p-5">
      <h2 className="font-semibold">{created.record.kind === 'sk' ? 'Save your secret key now' : 'Your publishable key is ready'}</h2>
      <p className="text-sm text-[var(--muted)]">{created.record.kind === 'sk' ? 'This is the only time the full secret is shown. Save it in your server’s secret manager. It cannot be retrieved later.' : 'Use this key for public plan listings. Private customer access requires a customer token from your backend.'}</p>
      <code className="block break-all rounded-xl bg-[var(--soft)] p-4 text-xs select-all">{created.key}</code>
      <div className="flex flex-wrap gap-3"><SecondaryButton onClick={() => void copy('new', created.key)}>{copied === 'new' ? 'Copied' : 'Copy key'}</SecondaryButton><PrimaryButton onClick={() => setCreated(null)}>I saved it — close</PrimaryButton></div>
    </SoftCard>}
    <SoftCard className="space-y-4 p-5">
      <h2 className="font-semibold">Create an API key</h2>
      <p className="text-sm text-[var(--muted)]">Secret keys belong on your server. Publishable keys belong in your frontend. To rotate, create a replacement, update your integration, then revoke the old key.</p>
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); void create(); }}>
        <label className="grid gap-2 text-xs font-medium">Name<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Production backend" className="rounded-lg border border-[var(--line)] bg-transparent p-3 text-sm" /></label>
        <label className="grid gap-2 text-xs font-medium">Type<select value={kind} onChange={event => setKind(event.target.value as 'sk' | 'pk')} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"><option value="sk">Secret · server</option><option value="pk">Publishable · browser</option></select></label>
        <label className="grid gap-2 text-xs font-medium">Expires after<select value={days} onChange={event => setDays(event.target.value)} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm"><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select></label>
        <div><button type="submit" disabled={busy || !creds || !name.trim() || Boolean(created)} className="rounded-full bg-[var(--blue)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Working…' : 'Create key'}</button></div>
      </form>
    </SoftCard>
    <SoftCard className="overflow-hidden p-5">
      <h2 className="mb-4 font-semibold">Your API keys</h2>
      {!creds ? <p role="status">Loading keys…</p> : !creds.keys.length ? <p className="text-sm text-[var(--muted)]">Create a secret key for your backend and a publishable key for your embed.</p> : <div className="divide-y divide-[var(--line)]">{creds.keys.map(key => {
        const status = key.revoked_at ? 'Revoked' : Date.parse(key.expires_at) <= Date.now() ? 'Expired' : 'Active';
        return <div key={key.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
          <div className="space-y-2"><div className="flex items-center gap-2"><strong className="text-sm">{key.name}</strong><StatusPill tone={status === 'Active' ? 'good' : 'neutral'}>{status}</StatusPill></div>
            <p className="text-xs text-[var(--muted)]">{key.kind === 'sk' ? 'Secret' : 'Publishable'} · <code>{key.hint}</code></p>
            <p className="text-xs text-[var(--muted)]">Created {date(key.created_at)} · Expires {date(key.expires_at)} · {key.last_used_at ? 'Last used ' + date(key.last_used_at) : 'Never used'}</p></div>
          <div className="flex gap-3">{status === 'Active' && key.public_key && <SecondaryButton disabled={busy} onClick={() => void copy(key.id, key.public_key!)}>{copied === key.id ? 'Copied' : 'Copy public key'}</SecondaryButton>}{status === 'Active' && <SecondaryButton disabled={busy} onClick={() => setRevoking(key)}>Revoke</SecondaryButton>}</div>
        </div>;
      })}</div>}
      {revoking && <div role="alertdialog" aria-label="Revoke API key" className="mt-4 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--soft)] p-4"><p className="text-sm">Revoke <strong>{revoking.name}</strong>? New requests using this key, including customer tokens issued by a secret key, will stop working. Requests already in progress may finish. Update your integration first.</p><div className="flex gap-3"><PrimaryButton disabled={busy} onClick={() => void revoke()}>Revoke key</PrimaryButton><SecondaryButton disabled={busy} onClick={() => setRevoking(null)}>Keep key</SecondaryButton></div></div>}
    </SoftCard>
    <SoftCard className="space-y-3 p-5"><h2 className="font-semibold">One embed for your customer account</h2><p className="text-sm text-[var(--muted)]">Configure plans, wallet connection, checkout and billing history in <Link href="/app/builder" className="text-[var(--blue)]">Builder</Link>. Your backend issues a short-lived customer token after authenticating that customer.</p>
      <pre className="overflow-auto rounded-xl bg-[var(--hero)] p-4 text-xs leading-relaxed text-white">{`const client = new BagsevenClient({
  apiKey: process.env.BAGSEVEN_SECRET_KEY!,
  baseUrl: process.env.BAGSEVEN_API_URL!,
});
const { token } = await client.identify({
  holder: user.id,
  email: user.verifiedEmail,
});`}</pre>
    </SoftCard>
  </div>;
}
