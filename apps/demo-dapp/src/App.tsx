import { useEffect, useState } from 'react';
import {
  BagsevenEmbed,
  BagsevenProvider,
  EMBED_COMPONENTS,
  FeatureFlagGuard,
  useBagseven,
  useConsumeEntitlement,
  useEntitlement,
  useFlag,
  type EmbedComponentId,
} from '@bagseven/sdk/react';

type Bootstrap = {
  holder: string;
  publishableKey: string;
  accessToken: string;
  apiUrl: string;
  entitlements: {
    pro: { enabled: boolean; value_type?: string; remaining: string; paid_through: string | null };
    ocr: { enabled: boolean; value_type?: string; remaining: string; paid_through: string | null };
  };
};

function SubscriberSurface({ serverNote }: { serverNote: string }) {
  const proOn = useFlag('pro_notes');
  const ocr = useEntitlement('ocr');
  const pro = useEntitlement('pro_notes');
  const { consume } = useConsumeEntitlement();
  const { refresh, pending, accessToken, holder, publishableKey, apiUrl } = useBagseven();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [embedMode, setEmbedMode] = useState<'full' | EmbedComponentId>('full');

  const burn = async () => {
    setBusy(true);
    setMsg('');
    try {
      const next = await consume('ocr', '1');
      setMsg(`Burned 1 OCR credit via React SDK → ${next.remaining} left`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="panel">
        <div className="row">
          <span className={`pill ${proOn ? 'on' : 'off'}`}>
            useFlag(&apos;pro_notes&apos;) → {String(proOn)}
          </span>
          <span className="pill">
            pro {pro.value_type ?? '…'} · {pro.enabled ? 'On' : 'Off'} until {pro.paid_through ?? '—'}
          </span>
          <span className="pill">
            ocr {ocr.value_type ?? '…'} · {ocr.remaining} credits
            {pending ? ' · refreshing…' : ''}
          </span>
        </div>

        <FeatureFlagGuard
          feature="pro_notes"
          fallback={
            <p className="note">
              Pro is gated off — mint a boolean entitlement for this holder in the Bagseven console, then refresh.
            </p>
          }
        >
          <div className="premium">
            <h2>Pro workspace unlocked</h2>
            <p style={{ margin: '8px 0 0', opacity: 0.9 }}>
              Boolean subscription flag via <span className="mono">FeatureFlagGuard</span> — Arkiv says you&apos;re on
              until the access period ends.
            </p>
          </div>
        </FeatureFlagGuard>

        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn" disabled={busy || !ocr.enabled} onClick={() => void burn()}>
            {busy ? 'Burning…' : 'Use 1 OCR credit (React SDK)'}
          </button>
          <button type="button" className="btn secondary" onClick={() => void refresh()}>
            Refresh entitlements
          </button>
        </div>
        {msg ? <p className="note">{msg}</p> : null}
        {serverNote ? <p className="note">{serverNote}</p> : null}
      </div>

      <div className="panel">
        <h2 style={{ margin: '0 0 8px', fontSize: '1.4rem' }}>Bagseven embed</h2>
        <p className="note" style={{ marginTop: 0 }}>
          One full billing surface (pricing · plan · checkout). Switch to a single Schematic component to preview drop-ins.
        </p>
        <div className="row" style={{ marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className={`btn ${embedMode === 'full' ? '' : 'secondary'}`}
            onClick={() => setEmbedMode('full')}
          >
            Full embed
          </button>
          {EMBED_COMPONENTS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`btn ${embedMode === c.id ? '' : 'secondary'}`}
              onClick={() => setEmbedMode(c.id)}
              title={c.blurb}
            >
              {c.label}
            </button>
          ))}
        </div>

        {!accessToken || !holder ? (
          <p className="note">Waiting for customer token…</p>
        ) : (
          <div key={embedMode} style={{ border: '1px solid var(--line, #e2e8f0)', borderRadius: 16, padding: 12 }}>
            {embedMode === 'full' ? (
              <BagsevenEmbed
                accessToken={accessToken}
                publishableKey={publishableKey}
                holder={holder}
                apiUrl={apiUrl}
                initialView="pricing"
              />
            ) : (
              <BagsevenEmbed
                component={embedMode}
                accessToken={accessToken}
                publishableKey={publishableKey}
                holder={holder}
                apiUrl={apiUrl}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [err, setErr] = useState('');
  const [serverNote, setServerNote] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/demo/bootstrap');
        const j = (await r.json()) as Bootstrap & { error?: { message?: string } };
        if (!r.ok) throw new Error(j.error?.message || `bootstrap ${r.status}`);
        setBoot(j);
        const check = await fetch('/api/demo/check?feature=pro_notes').then((x) => x.json());
        setServerNote(
          `Node SDK checkFlag(pro_notes)=${String(check.flag)} · remaining=${check.remaining} · ${check.via}`,
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="app">
      <p className="mono" style={{ color: 'var(--muted)', margin: 0 }}>
        Merchant demo dapp · powered by Bagseven
      </p>
      <h1 className="brand">Acme Notes</h1>
      <p className="lede">
        Fake SaaS that installs <strong>@bagseven/sdk/react</strong> in the browser and{' '}
        <strong>@bagseven/sdk/node</strong> on the merchant server — same entitlement product you operate from the
        console.
      </p>

      {err ? <p className="note">Bootstrap failed: {err}</p> : null}
      {!boot && !err ? <p className="note">Bootstrapping subscriber session…</p> : null}

      {boot ? (
        <BagsevenProvider
          publishableKey={boot.publishableKey}
          apiUrl={boot.apiUrl}
          accessToken={boot.accessToken}
          holder={boot.holder}
        >
          <div className="panel" style={{ marginTop: 20 }}>
            <div className="mono">
              holder {boot.holder}
              <br />
              pk {boot.publishableKey.slice(0, 18)}…
            </div>
          </div>
          <SubscriberSurface serverNote={serverNote} />
        </BagsevenProvider>
      ) : null}
    </div>
  );
}
