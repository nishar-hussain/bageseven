'use client';
import { paymentTokenLabel } from '../../../lib/bagseven-sdk-wallet';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  ChevronRight,
  Code2,
  Copy,
  CreditCard,
  ExternalLink,
  Globe2,
  LayoutTemplate,
  Loader2,
  Monitor,
  Palette,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { BagsevenEmbed } from '../../../lib/bagseven-sdk-react';
import { billingApi, type Plan } from '../../../lib/billing-client';
import {
  designProps,
  iframeInstall,
  newDesign,
  PALETTES,
  reactInstall,
  validateDesign,
  type Design,
  type DesignConfig,
} from '../../../lib/builder-model';
import styles from './builder.module.css';

async function request<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(
    url,
    body === undefined
      ? { cache: 'no-store' }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  );
  const data = await response.json();
  if (!response.ok) throw Error(data.error?.message ?? 'The request could not be completed.');
  return data as T;
}
const fields = [
  ['Text color', 'ink'],
  ['Accent color', 'accent'],
  ['Background', 'soft'],
] as const;

export default function BuilderPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<DesignConfig>(() => newDesign());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [step, setStep] = useState<'design' | 'install'>('design');
  const [section, setSection] = useState<'content' | 'style'>('content');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [codeTab, setCodeTab] = useState<'react' | 'iframe'>('react');
  const [preview, setPreview] = useState<{ token: string; holder: string } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewKey, setPreviewKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<{ title: string; action: () => void } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [legacy, setLegacy] = useState<unknown[]>([]);
  const [origin, setOrigin] = useState('');
  const [hostedPreview, setHostedPreview] = useState(false);
  const hostedFrame = useRef<HTMLIFrameElement>(null);
  const current = designs.find((d) => d.id === selected);
  const dirty = !loading && (!current || JSON.stringify(current.config) !== JSON.stringify(draft));
  const [pk, setPk] = useState('');
  const open = useCallback((design: Design) => {
    setSelected(design.id);
    setDraft(design.config);
    setNotice('');
    setError('');
    setPreviewKey((k) => k + 1);
  }, []);
  const refreshPreview = useCallback(async () => {
    try {
      setPreview(await request<{ token: string; holder: string }>('/api/embed-token', {}));
      setPreviewError('');
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Preview unavailable.');
    }
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [saved, catalog, me, credentials] = await Promise.all([
        request<{ designs: Design[] }>('/api/builder/designs'),
        billingApi.listPlans(),
        request<{ holder: string }>('/api/me'),
        request<{ keys: Array<{ kind: string; public_key: string | null; revoked_at: string | null; expires_at: string }> }>('/api/developer/credentials'),
      ]);
      const owned = catalog.plans.filter((p) => p.active && p.provider_id === me.holder);
      setPk(credentials.keys.find(key => key.kind === 'pk' && !key.revoked_at && Date.parse(key.expires_at) > Date.now())?.public_key || '');
      setDesigns(saved.designs);
      setPlans(owned);
      if (saved.designs[0]) open(saved.designs[0]);
      else {
        setSelected(null);
        setDraft(
          newDesign(
            'cmp_customer',
            owned.map((p) => p.id),
          ),
        );
      }
      await refreshPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Builder unavailable.');
    } finally {
      setLoading(false);
    }
  }, [open, refreshPreview]);
  useEffect(() => {
    setOrigin(window.location.origin);
    void load();
    try {
      const value = JSON.parse(
        localStorage.getItem('bagseven.builder.components.v2') ??
          localStorage.getItem('bagseven.builder.components.v1') ??
          '[]',
      );
      if (Array.isArray(value)) setLegacy(value.filter((v) => v && typeof v === 'object'));
    } catch {
      /* Invalid browser-only designs never replace account designs. */
    }
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void refreshPreview(), 14 * 60000);
    return () => clearInterval(timer);
  }, [refreshPreview]);
  useEffect(() => {
    if (!hostedPreview || !preview || !origin) return;
    const authorize = (event: MessageEvent) => {
      if (
        event.origin === origin &&
        event.source === hostedFrame.current?.contentWindow &&
        event.data?.type === 'bagseven:ready'
      )
        hostedFrame.current?.contentWindow?.postMessage({ type: 'bagseven:authorize', ...preview }, origin);
    };
    window.addEventListener('message', authorize);
    hostedFrame.current?.contentWindow?.postMessage({ type: 'bagseven:authorize', ...preview }, origin);
    return () => window.removeEventListener('message', authorize);
  }, [hostedPreview, preview, origin]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const record = (design: Design) => {
    setDesigns((items) => [design, ...items.filter((d) => d.id !== design.id)]);
    setSelected(design.id);
    setDraft(design.config);
    return design;
  };
  const save = async (): Promise<Design> => {
    const config = validateDesign(draft);
    const result =
      selected && current
        ? await request<{ design: Design }>(
            `/api/builder/designs/${selected}`,
            { action: 'save', config, revision: current.revision },
            'PATCH',
          )
        : await request<{ design: Design }>('/api/builder/designs', { config });
    return record(result.design);
  };
  const act = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy('');
    }
  };
  const guarded = (title: string, action: () => void) => {
    if (dirty) setPending({ title, action });
    else action();
  };
  const publish = () =>
    act('Publishing', async () => {
      const saved = dirty || !current ? await save() : current;
      record(
        (
          await request<{ design: Design }>(
            `/api/builder/designs/${saved.id}`,
            { action: 'publish', revision: saved.revision },
            'PATCH',
          )
        ).design,
      );
      setNotice('Published. Your hosted embed now uses this version.');
      setStep('install');
    });
  const unpublish = () =>
    act('Unpublishing', async () => {
      if (!current) return;
      const changed = (
        await request<{ design: Design }>(
          `/api/builder/designs/${current.id}`,
          { action: 'unpublish', revision: current.revision },
          'PATCH',
        )
      ).design;
      setDesigns((items) => items.map((d) => (d.id === changed.id ? changed : d)));
      setNotice('Unpublished. The hosted page is no longer available.');
    });
  const code = useMemo(
    () =>
      codeTab === 'react'
        ? reactInstall(draft, origin, pk || 'YOUR_PROVIDER_PUBLISHABLE_KEY')
        : iframeInstall(current?.id ?? 'PUBLISH_YOUR_PAGE_FIRST', origin),
    [draft, origin, pk, codeTab, current?.id],
  );
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const importLegacy = () =>
    act('Importing', async () => {
      let count = 0;
      for (const value of legacy) {
        const config = validateDesign({
          ...(value as Record<string, unknown>),
          planIds: plans.map((p) => p.id),
        });
        record((await request<{ design: Design }>('/api/builder/designs', { config })).design);
        count++;
      }
      setLegacy([]);
      setNotice(`Imported ${count} browser designs as private drafts. Your originals were kept.`);
    });

  return (
    <div className={styles.builder}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            <LayoutTemplate size={14} /> CUSTOMER EXPERIENCE
          </div>
          <h1>Make billing feel like your product.</h1>
          <p>
            One embed for plans, wallet connection, checkout and customer access. Make it yours, then add it
            to your app.
          </p>
        </div>
        <Link href="/app/developers" className={styles.docs}>
          Integration guide <ExternalLink size={14} />
        </Link>
      </header>
      <div className={styles.toolbar}>
        <div className={styles.designPicker}>
          <LayoutTemplate size={17} />
          <label className={styles.srOnly} htmlFor="saved-design">
            Saved page
          </label>
          <select
            id="saved-design"
            value={selected ?? ''}
            disabled={loading || !!busy}
            onChange={(e) => {
              const target = designs.find((d) => d.id === e.target.value);
              if (target) guarded('Switch pages?', () => open(target));
            }}
          >
            <option value="" disabled>
              New billing page
            </option>
            {designs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.config.name}
              </option>
            ))}
          </select>
          <span className={styles.saveState}>
            {dirty
              ? 'Unsaved changes'
              : current?.published
                ? current.published_revision === current.revision
                  ? 'Published'
                  : 'Draft changes'
                : 'Private draft'}
          </span>
        </div>
        <div className={styles.actions}>
          <button
            className={styles.iconButton}
            aria-label="New billing page"
            disabled={!!busy || loading}
            onClick={() =>
              guarded('Create a new page?', () => {
                setSelected(null);
                setDraft(
                  newDesign(
                    'cmp_customer',
                    plans.map((p) => p.id),
                  ),
                );
                setStep('design');
              })
            }
          >
            <Plus size={17} />
          </button>
          {current && (
            <button
              className={styles.iconButton}
              aria-label="Delete page"
              disabled={!!busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className={styles.secondary}
            disabled={!!busy || loading || !dirty}
            onClick={() =>
              void act('Saving', async () => {
                await save();
                setNotice('Draft saved to your account.');
              })
            }
          >
            <Save size={14} /> Save draft
          </button>
          <button className={styles.primary} disabled={!!busy || loading} onClick={() => void publish()}>
            {busy ? <Loader2 size={15} className={styles.spin} /> : <Globe2 size={15} />}
            {busy || (current?.published ? 'Publish changes' : 'Publish embed')}
          </button>
        </div>
      </div>
      <nav className={styles.steps} aria-label="Builder steps">
        <button className={step === 'design' ? styles.stepActive : ''} onClick={() => setStep('design')}>
          <span>1</span> Design your embed
        </button>
        <ChevronRight size={14} />
        <button className={step === 'install' ? styles.stepActive : ''} onClick={() => setStep('install')}>
          <span>2</span> Add to your app
        </button>
        <div className={styles.included}>
          <Wallet size={13} /> Wallets <CreditCard size={13} /> Checkout <ShieldCheck size={13} /> Access &
          renewals
        </div>
      </nav>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          <button onClick={() => guarded('Reload saved designs?', () => void load())}>Reload saved designs</button>
        </div>
      )}
      {notice && (
        <div role="status" className={styles.notice}>
          <Check size={15} />
          {notice}
          <button aria-label="Dismiss notice" onClick={() => setNotice('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {loading ? (
        <div className={styles.loading}>
          <Loader2 className={styles.spin} size={22} /> Loading your workspace…
        </div>
      ) : (
        <>
          {legacy.length > 0 && !designs.length && (
            <div className={styles.importNotice}>
              Have designs saved in this browser? Bring them into this account as private drafts.
              <button disabled={!!busy} onClick={() => void importLegacy()}>
                Import {legacy.length} designs
              </button>
            </div>
          )}
          {step === 'design' ? (
            <div className={styles.workspace}>
              <aside className={styles.inspector}>
                <fieldset disabled={!!busy} className={styles.inspectorFields}>
                  <div className={styles.inspectorTabs}>
                    <button
                      className={section === 'content' ? styles.tabActive : ''}
                      onClick={() => setSection('content')}
                    >
                      <LayoutTemplate size={15} /> Content
                    </button>
                    <button
                      className={section === 'style' ? styles.tabActive : ''}
                      onClick={() => setSection('style')}
                    >
                      <Palette size={15} /> Appearance
                    </button>
                  </div>
                  {section === 'content' ? (
                    <div className={styles.controls}>
                      <div className={styles.controlHeading}>
                        <h2>Your billing page</h2>
                        <p>Customers move between plans, checkout and their account in this same embed.</p>
                      </div>
                      <label>
                        Page name
                        <input
                          maxLength={80}
                          value={draft.name}
                          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        />
                        <small>For your team. Customers won’t see this name.</small>
                      </label>
                      <label>
                        Heading
                        <input
                          maxLength={120}
                          value={draft.heading}
                          onChange={(e) => setDraft((d) => ({ ...d, heading: e.target.value }))}
                        />
                      </label>
                      <label>
                        Plan button text
                        <input
                          maxLength={60}
                          value={draft.cta}
                          onChange={(e) => setDraft((d) => ({ ...d, cta: e.target.value }))}
                        />
                      </label>
                      {draft.componentId !== 'cmp_customer' && (
                        <div className={styles.legacyType}>
                          <p>This design uses an earlier standalone component.</p>
                          <button onClick={() => setDraft((d) => ({ ...d, componentId: 'cmp_customer' }))}>
                            Use the complete billing embed <ChevronRight size={13} />
                          </button>
                        </div>
                      )}
                      <div className={styles.planHeading}>
                        <div>
                          <h3>Plans to show</h3>
                          <p>Choose the plans your customers can buy.</p>
                        </div>
                        <Link href="/app/plans">
                          Manage <ExternalLink size={12} />
                        </Link>
                      </div>
                      {plans.length ? (
                        <div className={styles.planList}>
                          {plans.map((plan) => (
                            <label key={plan.id} className={styles.planOption}>
                              <input
                                type="checkbox"
                                checked={draft.planIds.includes(plan.id)}
                                onChange={(e) =>
                                  setDraft((d) => ({
                                    ...d,
                                    planIds: e.target.checked
                                      ? [...d.planIds, plan.id]
                                      : d.planIds.filter((id) => id !== plan.id),
                                  }))
                                }
                              />
                              <span>
                                <strong>{plan.name}</strong>
                                <small>
                                  {plan.credits} {plan.feature} credits
                                </small>
                              </span>
                              <span className={styles.planPrice}>
                                {plan.amount} {paymentTokenLabel(plan.payment?.chain_id, plan.payment?.usdt)}
                                <small>{plan.interval === 'month' ? '/ 30 days' : 'one-time'}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.empty}>
                          <CreditCard size={24} />
                          <strong>Add your first plan</strong>
                          <p>Your pricing section will use real plans from this workspace.</p>
                          <Link href="/app/plans">
                            Create a plan <ChevronRight size={14} />
                          </Link>
                        </div>
                      )}
                      {plans.length > 0 && !draft.planIds.length && (
                        <p className={styles.hint}>Select at least one plan to publish your billing page.</p>
                      )}
                    </div>
                  ) : (
                    <div className={styles.controls}>
                      <div className={styles.controlHeading}>
                        <h2>Match your brand</h2>
                        <p>Your styling applies across plans, checkout and account management.</p>
                      </div>
                      <fieldset className={styles.palettes}>
                        <legend>Start with a palette</legend>
                        {PALETTES.map((p) => (
                          <button
                            key={p.label}
                            aria-label={`Use ${p.label} palette`}
                            aria-pressed={draft.accent === p.accent && draft.soft === p.soft}
                            style={{ background: p.soft }}
                            onClick={() =>
                              setDraft((d) => ({ ...d, ink: p.ink, accent: p.accent, soft: p.soft }))
                            }
                          >
                            <span style={{ background: p.accent }} />
                            <small>{p.label}</small>
                          </button>
                        ))}
                      </fieldset>
                      {fields.map(([label, key]) => (
                        <label key={key}>
                          {label}
                          <div className={styles.colorField}>
                            <input
                              aria-label={`${label} picker`}
                              type="color"
                              value={/^#[a-f\d]{6}$/i.test(draft[key]) ? draft[key] : '#000000'}
                              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            />
                            <input
                              aria-label={label}
                              maxLength={7}
                              value={draft[key]}
                              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            />
                          </div>
                        </label>
                      ))}
                      <label>
                        Corner style
                        <select
                          value={draft.radius}
                          onChange={(e) => setDraft((d) => ({ ...d, radius: e.target.value }))}
                        >
                          <option value="0px">Square</option>
                          <option value="8px">Subtle</option>
                          <option value="12px">Soft</option>
                          <option value="16px">Rounded</option>
                          <option value="20px">Extra rounded</option>
                          <option value="24px">Pillowy</option>
                        </select>
                      </label>
                      <label className={styles.checkRow}>
                        <input
                          type="checkbox"
                          checked={draft.powered}
                          onChange={(e) => setDraft((d) => ({ ...d, powered: e.target.checked }))}
                        />
                        <span>Show “Powered by Bagseven”</span>
                      </label>
                    </div>
                  )}
                  <div className={styles.inspectorFooter}>
                    <ShieldCheck size={16} />
                    <p>Design changes don’t alter prices, credits or payment permissions.</p>
                  </div>
                </fieldset>
              </aside>
              <section className={styles.preview} aria-label="Live embed preview">
                <div className={styles.previewToolbar}>
                  <div>
                    <span className={styles.liveDot} /> Live preview{' '}
                    <span className={styles.previewTag}>Your account</span>
                  </div>
                  <div className={styles.deviceSwitch}>
                    <button
                      aria-label="Desktop preview"
                      aria-pressed={device === 'desktop'}
                      onClick={() => setDevice('desktop')}
                    >
                      <Monitor size={16} />
                    </button>
                    <button
                      aria-label="Mobile preview"
                      aria-pressed={device === 'mobile'}
                      onClick={() => setDevice('mobile')}
                    >
                      <Smartphone size={16} />
                    </button>
                    <button
                      aria-label="Refresh preview"
                      onClick={() => {
                        setPreviewKey((k) => k + 1);
                        void refreshPreview();
                      }}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </div>
                <div className={styles.previewCanvas}>
                  <div className={`${styles.previewFrame} ${device === 'mobile' ? styles.mobileFrame : ''}`}>
                    <div className={styles.browserBar}>
                      <i />
                      <i />
                      <i />
                      <span>your-app.com / billing</span>
                      <ShieldCheck size={12} />
                    </div>
                    <div className={styles.previewContent}>
                      {previewError ? (
                        <div className={styles.empty}>
                          <strong>Preview couldn’t connect</strong>
                          <p>{previewError}</p>
                          <button onClick={() => void refreshPreview()}>Try again</button>
                        </div>
                      ) : !pk ? (
                        <div className={styles.loading}>Create a publishable key in Developers to enable the billing preview and integration.</div>
                      ) : preview ? (
                        <BagsevenEmbed
                          key={previewKey}
                          {...designProps(draft)}
                          accessToken={preview.token}
                          holder={preview.holder}
                          publishableKey={pk || undefined}
                          apiUrl="/api/public"
                        />
                      ) : (
                        <div className={styles.loading}>Connecting to your account…</div>
                      )}
                    </div>
                  </div>
                </div>
                <div className={styles.previewFooter}>
                  <ShieldCheck size={14} />
                  <span>
                    Uses your real workspace data. Payments and renewal changes require wallet approval.
                  </span>
                </div>
              </section>
            </div>
          ) : (
            <section className={styles.install}>
              <div className={styles.installIntro}>
                <div className={styles.codeIcon}>
                  <Code2 size={25} />
                </div>
                <h2>One integration. The whole billing experience.</h2>
                <p>
                  Add the embed once. Your customers can choose plans, connect their wallet, pay and manage
                  access without leaving your app.
                </p>
                <div className={styles.installChecks}>
                  <span>
                    <Check size={14} /> Your plans
                  </span>
                  <span>
                    <Check size={14} /> Wallet & checkout
                  </span>
                  <span>
                    <Check size={14} /> Credits & renewals
                  </span>
                </div>
              </div>
              <div className={styles.installGrid}>
                <div className={styles.codePanel}>
                  <div className={styles.codeTabs}>
                    <button aria-pressed={codeTab === 'react'} onClick={() => setCodeTab('react')}>
                      React
                    </button>
                    <button aria-pressed={codeTab === 'iframe'} onClick={() => setCodeTab('iframe')}>
                      Website / iframe
                    </button>
                    <button
                      className={styles.copy}
                      disabled={codeTab === 'iframe' && !current?.published}
                      onClick={() => void act('Copying', copy)}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? 'Copied' : 'Copy code'}
                    </button>
                  </div>
                  {codeTab === 'iframe' && !current?.published ? (
                    <div className={styles.empty}>
                      <Globe2 size={26} />
                      <strong>Publish to get your hosted embed</strong>
                      <p>
                        Publishing creates a public page with your saved design. Customer credentials stay
                        private.
                      </p>
                      <button onClick={() => void publish()} disabled={!!busy}>
                        Publish embed
                      </button>
                    </div>
                  ) : (
                    <pre>
                      <code>{code}</code>
                    </pre>
                  )}
                </div>
                <aside className={styles.installNotes}>
                  <h3>Connect your customer</h3>
                  <ol>
                    <li>
                      <span>1</span>
                      <div>
                        <strong>Use the workspace SDK</strong>
                        <p>
                          The React code uses <code>@bagseven/sdk/react</code>. Keep secret keys in your
                          backend.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>2</span>
                      <div>
                        <strong>Issue a customer access token</strong>
                        <p>
                          Your authenticated backend calls <code>identify</code> for its signed-in customer.
                          Pass the returned holder and short-lived token to this embed.
                        </p>
                      </div>
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>Let the embed handle billing</strong>
                        <p>
                          Plan selection creates checkout. The customer approves payments in their wallet.
                          Paid access and renewals then appear in My access.
                        </p>
                      </div>
                    </li>
                  </ol>
                  <Link href="/app/developers">
                    Read the integration guide <ExternalLink size={14} />
                  </Link>
                  {current?.published && (
                    <div className={styles.publishedBox}>
                      <Globe2 size={16} />
                      <strong>Hosted embed published</strong>
                      <p>Updates go live when you publish again.</p>
                      <a href={`/embed?design=${current.id}`} target="_blank" rel="noreferrer">
                        Open published page <ExternalLink size={13} />
                      </a>
                      <button onClick={() => setHostedPreview((value) => !value)}>
                        {hostedPreview ? 'Hide published preview' : 'Preview published embed'}
                      </button>
                      <button disabled={!!busy} onClick={() => void unpublish()}>
                        Unpublish hosted page
                      </button>
                    </div>
                  )}
                </aside>
              </div>
              {hostedPreview && current?.published && (
                <div className={styles.hostedTest}>
                  <p>Published embed · authenticated as your current account</p>
                  <iframe
                    ref={hostedFrame}
                    title="Published billing embed"
                    src={`/embed?design=${current.id}&parent=${encodeURIComponent(origin)}`}
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}
            </section>
          )}
        </>
      )}
      {(pending || deleting) && (
        <div className={styles.modalBackdrop}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="builder-dialog-title"
            className={styles.modal}
          >
            <h2 id="builder-dialog-title">{deleting ? 'Delete this page?' : pending?.title}</h2>
            <p>
              {deleting
                ? 'Its hosted embed will stop working. Plans, subscriptions and customer access are kept.'
                : 'Your design has unsaved changes. Save them or discard them before continuing.'}
            </p>
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                onClick={() => {
                  setPending(null);
                  setDeleting(false);
                }}
              >
                Keep editing
              </button>
              {deleting ? (
                <button
                  className={styles.danger}
                  disabled={!!busy}
                  onClick={() =>
                    void act('Deleting', async () => {
                      if (!current) return;
                      await request(
                        `/api/builder/designs/${current.id}`,
                        { action: 'delete', revision: current.revision },
                        'PATCH',
                      );
                      const remaining = designs.filter((d) => d.id !== current.id);
                      setDesigns(remaining);
                      if (remaining[0]) open(remaining[0]);
                      else {
                        setSelected(null);
                        setDraft(
                          newDesign(
                            'cmp_customer',
                            plans.map((p) => p.id),
                          ),
                        );
                      }
                      setDeleting(false);
                    })
                  }
                >
                  Delete page
                </button>
              ) : (
                <>
                  <button
                    className={styles.secondary}
                    onClick={() => {
                      const action = pending?.action;
                      setPending(null);
                      action?.();
                    }}
                  >
                    Discard changes
                  </button>
                  <button
                    className={styles.primary}
                    disabled={!!busy}
                    onClick={() =>
                      void act('Saving', async () => {
                        await save();
                        const action = pending?.action;
                        setPending(null);
                        action?.();
                      })
                    }
                  >
                    Save and continue
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
