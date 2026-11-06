'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IDKitRequestWidget, proofOfHuman, type RpContext } from '@worldcoin/idkit';
import { payUsdtOnWhitechain } from '@bagseven/sdk/wallet';
import { StatusBadges } from '../../../components/app/StatusBadges';
import { entitlementsApi } from '../../../lib/entitlements-client';
import { FEATURE_OPTIONS, TTL_PRESETS, featureLabel, shortId, useOperator } from '../../../lib/use-operator';

export default function MintPage() {
  const op = useOperator();
  const APP_ID = (op.status?.tracks.world.app_id || '') as `app_${string}`;
  const RP_ID = op.status?.tracks.world.rp_id || '';
  const ACTION = op.status?.tracks.world.action || 'bagseven-mint';
  const ENVIRONMENT = op.status?.tracks.world.environment || 'production';
  const router = useRouter();
  const [feature, setFeature] = useState('ocr');
  const [credits, setCredits] = useState('5');
  const [ttl, setTtl] = useState(900);
  const [msg, setMsg] = useState('');
  const [lastLabel, setLastLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [idkitOpen, setIdkitOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ context: string; payment_tx: string; customer_wallet: string; payment_signature?: string } | null>(null);

  const idkitReady = Boolean(APP_ID && RP_ID && op.status?.tracks.world.idkit);
  const agentPassReady = Boolean(op.status?.tracks.world.agent_pass);
  const mockAllowed = op.status?.tracks.world.mock_proofs === true;
  const verifiedSession = Boolean(op.worldHumanId && !op.mock && !op.worldHumanId.startsWith('email:'));

  /** End-to-end create: Whitechain settle + Arkiv grant for the signed-in operator. */
  const createEntitlement = async (opts?: { idkit_response?: unknown; id_token?: string; world_proof_id?: string }) => {
    if (!op.holder) {
      setMsg('Sign in first — we mint the entitlement to your email.');
      return;
    }
    setBusy(true);
    setMsg('Creating living entitlement (Whitechain settle → Arkiv write)…');
    try {
      let payment: { payment_tx?: string; customer_wallet?: string; payment_signature?: string } = {};
      const context = `entitlement:${op.holder}:${feature}:${credits}`;
      const rail = op.status?.tracks.whitechain;
      if (!rail) throw new Error('Payment configuration is still loading');
      if (!rail.demo_settle) {
        if (!rail.pay_to || !rail.usdt) throw new Error('The operator must configure the Whitechain payment recipient before purchases are available');
        if (pendingPayment && pendingPayment.context !== context) throw new Error('Finish the existing payment before changing the feature or credit amount');
        if (pendingPayment) payment = pendingPayment;
        else {
          setMsg(`Confirm ${credits} USDT.e in your Whitechain wallet…`);
          const paid = await payUsdtOnWhitechain({ merchantWallet: rail.pay_to, amount: credits, usdt: rail.usdt, chainId: rail.chain_id, context });
          payment = paid;
          setPendingPayment({ context, ...paid });
        }
      }
      const r = await entitlementsApi.mint({
        feature,
        holder: op.holder,
        remaining: credits,
        ttl_seconds: ttl,
        settlement_network: 'whitechain',
        ...payment,
        renewal_enabled: true,
        ...(opts?.idkit_response !== undefined ? { idkit_response: opts.idkit_response } : {}),
        ...(opts?.id_token ? { id_token: opts.id_token } : {}),
        ...(opts?.world_proof_id ? { world_proof_id: opts.world_proof_id } : {}),
        ...(!opts?.idkit_response && !opts?.id_token && mockAllowed
          ? { world_proof_id: `world:ok:${op.holder}` }
          : {}),
      });
      setLastLabel(`${featureLabel(r.grant.feature)} · ${r.grant.remaining} credits · ${shortId(r.grant.id)}`);
      setPendingPayment(null);
      setMsg(
        `Done. Entitlement for feature “${featureLabel(feature)}” is live (${r.grant.remaining} credits).` +
          (r.settlement?.explorer_url ? `\nWhitechain: ${r.settlement.explorer_url}` : '') +
          `\nOpen Entitlements to spend it, or Connect agent so MCP can call paid_run.`,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const beginIdKit = useCallback(async () => {
    if (!op.holder) {
      setMsg('Sign in first.');
      return;
    }
    setBusy(true);
    setMsg('Opening World ID… scan the QR with World App.');
    try {
      const sig = await entitlementsApi.worldRpSignature(ACTION);
      setRpContext({
        rp_id: (sig.rp_id || RP_ID) as `rp_${string}`,
        nonce: sig.nonce,
        created_at: sig.created_at,
        expires_at: sig.expires_at,
        signature: sig.sig,
      });
      setIdkitOpen(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [op.holder, RP_ID, ACTION]);

  const beginAgentPass = useCallback(async () => {
    if (!op.holder) return;
    setBusy(true);
    try {
      const redirectUri = `${window.location.origin}/app/mint`;
      const auth = await entitlementsApi.worldAuthorize(redirectUri);
      if (!auth.authorize_url) {
        setMsg(
          auth.note ||
            `Agent Pass unavailable (mode=${auth.mode ?? 'unknown'}). Use Create entitlement with World IDKit until auth.world.org/portal allowlists your Google.`,
        );
        setBusy(false);
        return;
      }
      window.location.assign(auth.authorize_url);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [op.holder]);

  // Agent Pass OIDC return
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const iss = params.get('iss');
    if (params.get('error')) {
      setMsg(`Agent Pass error: ${params.get('error')}`);
      window.history.replaceState({}, '', '/app/mint');
      return;
    }
    if (!code || !state) return;
    void (async () => {
      setBusy(true);
      try {
        const redirectUri = `${window.location.origin}/app/mint`;
        const cb = await entitlementsApi.worldCallback({ code, state, redirect_uri: redirectUri, iss: iss || undefined });
        await createEntitlement({ id_token: cb.id_token, world_proof_id: cb.world_proof_id });
        window.history.replaceState({}, '', '/app/mint');
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
        window.history.replaceState({}, '', '/app/mint');
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = useMemo(() => proofOfHuman({ signal: op.holder || 'bagseven-operator' }), [op.holder]);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-[2rem] font-semibold tracking-tight">Create entitlement</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Schematic-style: pick a <strong>feature</strong>, then mint the <strong>entitlement</strong> (credits + TTL) that
          lets agents use it. OCR is only a demo feature — not the product.
        </p>
        <div className="mt-4">
          <StatusBadges />
        </div>
      </div>

      <ol className="space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5 text-sm shadow-[var(--sh)]">
        <li>
          <strong className="text-[var(--ink)]">1. You are signed in</strong>
          <div className="mt-1 text-[var(--muted)]">
            {op.loading ? 'Loading…' : op.holder ? <>Holder = <span className="font-medium text-[var(--ink)]">{op.holder}</span></> : 'Sign in first'}
          </div>
        </li>
        <li>
          <strong className="text-[var(--ink)]">2. Choose the feature to entitle</strong>
          <p className="mt-1 text-[var(--muted)]">
            A feature is a capability you gate (like Schematic). Choosing OCR does not mean you already have OCR access —
            it means the entitlement you create will cover that feature key.
          </p>
        </li>
        <li>
          <strong className="text-[var(--ink)]">3. Mint the living entitlement</strong>
          <p className="mt-1 text-[var(--muted)]">
            World verifies the human → Whitechain stamps payment → Arkiv stores the grant. Then agents spend via MCP.
          </p>
        </li>
      </ol>

      <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[var(--sh)]">
        <div className="fi-field">
          <label htmlFor="feature">Feature to entitle</label>
          <select
            id="feature"
            value={feature}
            onChange={(e) => setFeature(e.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
          >
            {FEATURE_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} — {f.blurb}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="fi-field">
            <label htmlFor="credits">Starting credits</label>
            <input id="credits" value={credits} onChange={(e) => setCredits(e.target.value)} />
          </div>
          <div className="fi-field">
            <label htmlFor="ttl">How long it stays live</label>
            <select
              id="ttl"
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
              className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
            >
              {TTL_PRESETS.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || !op.holder || op.loading}
          onClick={() => void (verifiedSession || mockAllowed ? createEntitlement() : beginIdKit())}
          className="w-full rounded-full bg-[var(--blue)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? 'Creating…'
            : verifiedSession || mockAllowed
              ? `Create entitlement for ${featureLabel(feature)}`
              : 'Verify with World ID & create entitlement'}
        </button>
        {!op.status?.tracks.whitechain.demo_settle && <p className="text-sm text-[var(--muted)]">Your wallet pays {credits} USDT.e on Whitechain Sepolia before the entitlement is created.</p>}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy || !idkitReady || !op.holder}
            onClick={() => void beginIdKit()}
            className="rounded-full border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            World IDKit (QR / World App)
          </button>
          <button
            type="button"
            disabled={busy || !agentPassReady || !op.holder}
            onClick={() => void beginAgentPass()}
            className="rounded-full border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            title={agentPassReady ? undefined : 'Blocked until World allowlists your Google for auth.world.org/portal'}
          >
            Agent Pass {agentPassReady ? '' : '(needs portal access)'}
          </button>
        </div>

        <Link href="/app/grants" className="inline-block text-sm font-medium text-[var(--blue)] underline">
          After creating → open Entitlements
        </Link>

        {rpContext && (
          <IDKitRequestWidget
            open={idkitOpen}
            onOpenChange={setIdkitOpen}
            app_id={APP_ID}
            action={ACTION}
            rp_context={rpContext}
            allow_legacy_proofs
            environment={ENVIRONMENT}
            preset={preset}
            handleVerify={async (result) => {
              await createEntitlement({ idkit_response: result });
            }}
            onSuccess={() => {
              setIdkitOpen(false);
            }}
            onError={(code) => {
              setMsg(`World ID failed (${String(code)})`);
            }}
          />
        )}

        {msg && <pre className="whitespace-pre-wrap text-sm text-[var(--muted)]">{msg}</pre>}
        {lastLabel && (
          <div className="rounded-xl border border-[var(--good)]/30 bg-[var(--good)]/5 px-4 py-3 text-sm">
            <div className="font-semibold text-[var(--ink)]">{lastLabel}</div>
            <button
              type="button"
              className="mt-2 text-sm font-semibold text-[var(--blue)] underline"
              onClick={() => router.push('/app/grants')}
            >
              View my entitlements →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
