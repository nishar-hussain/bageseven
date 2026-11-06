'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi } from '../../../lib/entitlements-client';

export default function MintPage() {
  const [holder, setHolder] = useState('demo-human');
  const [proof, setProof] = useState('world:ok:demo-human');
  const [idToken, setIdToken] = useState('');
  const [ttl, setTtl] = useState(120);
  const [msg, setMsg] = useState('');
  const [lastId, setLastId] = useState('');
  const [busy, setBusy] = useState(false);

  const mint = async (denied: boolean) => {
    setBusy(true);
    setMsg(denied ? 'Deny path…' : 'Minting (World + Hedera stamp + Arkiv write — often 5–15s)…');
    try {
      const r = await entitlementsApi.mint({
        feature: 'ocr',
        holder,
        remaining: '5',
        ttl_seconds: ttl,
        settlement_network: 'hedera',
        world_proof_id: denied ? 'world:cancel:demo' : proof,
        id_token: idToken.trim() || undefined,
        renewal_enabled: true,
      });
      setLastId(r.grant.id);
      setMsg(`Minted ${r.grant.id} · world=${r.world?.mode ?? '?'} · ${r.settlement?.hashscan_url ?? ''}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const authorize = async () => {
    setBusy(true);
    setMsg('Resolving World authorize URL…');
    try {
      const r = await entitlementsApi.worldAuthorize();
      setMsg(r.authorize_url || r.note || r.mode);
      if (r.authorize_url) window.open(r.authorize_url, '_blank', 'noopener');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Mint</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">World Agent Pass gate before any Arkiv write. Deny/cancel writes nothing.</p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--blue)]/20 bg-[var(--tint)] px-4 py-3 text-sm text-[var(--ink)]">
        Mock mode uses <code className="fi-mono text-xs">world:ok:…</code> proofs. Live mode needs{' '}
        <code className="fi-mono text-xs">WORLD_CLIENT_ID</code> + pasted <code className="fi-mono text-xs">id_token</code>.
      </div>

      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="fi-field">
          <label htmlFor="holder">Holder</label>
          <input id="holder" value={holder} onChange={(e) => setHolder(e.target.value)} />
        </div>
        <div className="fi-field">
          <label htmlFor="proof">world_proof_id (mock: world:ok:…)</label>
          <input id="proof" className="fi-mono text-sm" value={proof} onChange={(e) => setProof(e.target.value)} />
        </div>
        <div className="fi-field">
          <label htmlFor="idToken">id_token (live World Agent Pass)</label>
          <textarea
            id="idToken"
            rows={4}
            className="fi-mono text-xs"
            value={idToken}
            onChange={(e) => setIdToken(e.target.value)}
            placeholder="Paste OIDC id_token when WORLD_CLIENT_ID is set"
          />
        </div>
        <div className="fi-field max-w-xs">
          <label htmlFor="ttl">TTL seconds</label>
          <input id="ttl" type="number" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void mint(false)} className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? 'Working…' : 'Mint with World'}
          </button>
          <button type="button" disabled={busy} onClick={() => void mint(true)} className="rounded-full bg-[var(--deny)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            Deny path
          </button>
          <button type="button" disabled={busy} onClick={() => void authorize()} className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium disabled:opacity-50">
            World authorize URL
          </button>
          <Link href="/app/grants" className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium">
            View grants
          </Link>
        </div>
        {msg && <p className="fi-mono whitespace-pre-wrap text-xs text-[var(--muted)]">{msg}</p>}
        {lastId && (
          <p className="text-sm">
            Grant id: <code className="fi-mono">{lastId}</code>
          </p>
        )}
      </div>
    </div>
  );
}
