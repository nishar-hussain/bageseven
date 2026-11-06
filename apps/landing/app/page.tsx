const APP = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000';

function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M6 22V10l10-6 10 6v12l-10 6-10-6Z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16v12M16 16L6 10M16 16l10-6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--hero)] text-white">
      <header className="nav t-dark over fixed inset-x-0 top-0 z-40">
        <div className="fi-wrap flex h-[var(--navh)] items-center justify-between gap-4">
          <a href="/" className="flex items-center gap-2 text-[15px]">
            <Mark className="h-7 w-7" />
            <span className="font-medium">Bagseven</span>
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
              Beta
            </span>
          </a>
          <nav className="hidden items-center gap-8 text-[14px] text-white/70 md:flex">
            <a href="#product" className="hover:text-white">Product</a>
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#developers" className="hover:text-white">Developers</a>
            <a href="/docs/introduction" className="hover:text-white">Documentation</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href={`${APP}/app/login`} className="hidden text-sm text-white/70 hover:text-white sm:inline">
              Sign in
            </a>
            <a href={`${APP}/app/login`} className="fi-btn fi-btn-light !py-2.5 !px-4 text-sm">
              Start free
            </a>
          </div>
        </div>
      </header>

      <main>
        <section className="hero relative pt-[var(--navh)]">
          <div className="fi-wrap relative animate-fi-up pb-20 pt-16 md:pb-28 md:pt-24">
            <h1 className="fi-display max-w-4xl text-[2.8rem] text-white md:text-[4.6rem]">
              Public entitlements.
              <span className="block">Paid straight on Whitechain.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg text-white/65 md:text-xl">
              Humans approve mint once, up to a TTL. Each spend checks a mandate and a living Arkiv grant.
              Bagseven never holds settlement.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <a href={`${APP}/app/login`} className="fi-btn fi-btn-light">
                Open dashboard
              </a>
              <a href="#product" className="fi-btn fi-btn-ghost">
                Watch how it works
              </a>
            </div>
          </div>
        </section>

        <section className="stmt border-t border-white/10 py-16 md:py-20">
          <div className="fi-wrap max-w-4xl">
            <p className="fi-display text-center text-3xl text-white md:text-[2.6rem]">
              Humans mint once<span className="text-white/45">,</span> up to a TTL.
              <span className="block text-white/55"> Each month of access lives on Arkiv until it evaporates.</span>
            </p>
          </div>
        </section>

        <section id="product" className="fi-band-blue py-20 md:py-24">
          <div className="fi-wrap">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Two ways in</p>
            <h2 className="fi-display mt-3 text-4xl text-white md:text-[3.2rem]">Pick the one that sounds like you.</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-2">
              <a href={`${APP}/app/login`} className="group block overflow-hidden rounded-[16px] bg-[var(--hero)] p-7 text-white">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">For humans</div>
                <h3 className="mt-3 text-2xl font-medium">I mint access for an agent</h3>
                <p className="mt-3 text-white/70">World Agent Pass. Arkiv entitlement. Cancel renewal without killing the period already paid.</p>
                <span className="mt-8 inline-block text-sm font-semibold underline underline-offset-4">Start in the dashboard →</span>
              </a>
              <a href={`${APP}/app/mcp`} className="group block overflow-hidden rounded-[16px] bg-white p-7 text-[var(--ink)]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">For agents</div>
                <h3 className="mt-3 text-2xl font-medium">I check and consume through MCP</h3>
                <p className="mt-3 text-[var(--muted)]">SDK + MCP: check_entitlement, consume_entitlement, paid_run. Dual-gate on mandate + grant.</p>
                <span className="mt-8 inline-block text-sm font-semibold underline underline-offset-4">MCP setup →</span>
              </a>
            </div>
          </div>
        </section>

        <section className="bg-[var(--hero)] py-20 md:py-24">
          <div className="fi-wrap">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">For operators</p>
            <h2 className="fi-display mt-3 max-w-3xl text-4xl md:text-[3.2rem]">Sell access from your own dashboard. No inspector tab.</h2>
            <p className="mt-5 max-w-xl text-white/65">
              Overview, grants, mint, credits, SDK embed. Live vs Mock badges so judging (and you) always know the mode.
            </p>
            <ol className="mt-12 grid gap-3 md:grid-cols-4">
              {[
                { n: '01', t: 'Sign in', d: 'Magic link via Resend. 8-hour session.' },
                { n: '02', t: 'Mint', d: 'World gate. Deny writes nothing.' },
                { n: '03', t: 'Settle', d: 'Whitechain buy_credits stamps payment_tx.' },
                { n: '04', t: 'Spend', d: 'paid_run dual-gate. Email on each event.' },
              ].map((s) => (
                <li key={s.n} className="rounded-[16px] border border-white/10 bg-white/[0.04] p-5">
                  <div className="font-mono text-xs text-white/45">{s.n}</div>
                  <div className="mt-2 text-lg font-medium">{s.t}</div>
                  <p className="mt-2 text-sm text-white/60">{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="developers" className="fi-band-soft py-20 md:py-24 text-[var(--ink)]">
          <div className="fi-wrap">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">For developers and builders</p>
            <h2 className="fi-display mt-3 text-4xl md:text-[3.2rem]">Wire it into billing in an afternoon.</h2>
            <p className="mt-4 max-w-2xl text-[var(--muted)]">
              Drop-in React SDK for humans. MCP for agents. Same checkEntitlement verb. Daemon BFF never puts operator keys in the browser.
            </p>
            <pre className="mt-10 overflow-auto rounded-[16px] bg-[var(--hero)] p-6 font-mono text-xs leading-relaxed text-white/85">
{`npm install @bagseven/sdk

<BagsevenProvider publishableKey={pk}>
  <FeatureFlagGuard feature="ocr"><OcrButton /></FeatureFlagGuard>
  <BagsevenEmbed accessToken={token} />
</BagsevenProvider>

# Agent MCP
check_entitlement · consume_entitlement · paid_run`}
            </pre>
            <a href={`${APP}/app/login`} className="fi-btn mt-8 !bg-[var(--ink)] !text-white">
              Start free
            </a>
          </div>
        </section>

        <section className="fi-band-blue py-20">
          <div className="fi-wrap">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Product</p>
            <h2 className="fi-display mt-3 text-4xl text-white md:text-[3.2rem]">Entitlements, SDK embed, MCP and a dashboard.</h2>
            <ul className="mt-10 grid gap-3 md:grid-cols-3">
              {[
                { t: 'Overview', d: 'Revenue-style activity, attention queue, living grants.', href: `${APP}/app` },
                { t: 'Mint / Credits', d: 'World gate + Whitechain settle + explorer.', href: `${APP}/app/mint` },
                { t: 'Email', d: 'Resend on mint, deny, settle, paid_run, sign-in.', href: `${APP}/app/login` },
              ].map((x) => (
                <li key={x.t}>
                  <a href={x.href} className="block rounded-[16px] border border-white/25 bg-white/[0.08] p-5 hover:bg-white/12">
                    <div className="text-xl font-medium text-white">{x.t}</div>
                    <p className="mt-2 text-sm text-white/70">{x.d}</p>
                    <span className="mt-4 inline-block text-sm font-semibold">Open →</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="security" className="bg-[var(--hero)] py-20 md:py-24">
          <div className="fi-wrap">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Security</p>
            <h2 className="fi-display mt-3 text-4xl text-white md:text-[3.2rem]">Four things Bagseven cannot do.</h2>
            <p className="mt-4 max-w-2xl text-white/55">If we shut down, settlement is already on Whitechain and access is already a public Arkiv object.</p>
            <ul className="mt-12 grid gap-4 md:grid-cols-2">
              {[
                { k: 'Hold your USDC', v: 'We record Whitechain payment_tx. There is no Bagseven balance.' },
                { k: 'Mint without World', v: 'Backend verify. Deny writes nothing to Arkiv.' },
                { k: 'Spend after TTL', v: 'Expired grants leave the query surface.' },
                { k: 'Bypass dual-gate', v: 'Mandate remaining and living grant must both pass.' },
              ].map((t) => (
                <li key={t.k} className="rounded-[16px] border border-white/10 px-5 py-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">We cannot</div>
                  <div className="mt-1 text-lg font-medium">{t.k}</div>
                  <p className="mt-1 text-sm text-white/60">{t.v}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="fi-band-soft py-16 text-[var(--ink)]">
          <div className="fi-wrap">
            <h2 className="fi-display text-3xl">What people ask first.</h2>
            <dl className="mt-8 grid gap-4 md:grid-cols-2">
              {[
                { q: 'Does Bagseven hold the money?', a: 'No. Whitechain settlement is wallet-to-record. We stamp payment_tx.' },
                { q: 'How do I sign in?', a: 'Operator email + magic link (Resend). Session lasts 8 hours.' },
                { q: 'What if World denies mint?', a: 'Nothing is written. You get WORLD_DENIED and an email.' },
                { q: 'Is this live or mock?', a: 'Dashboard badges. Keys in .env switch Live vs Mock per track.' },
              ].map((f) => (
                <div key={f.q} className="rounded-[16px] border border-[var(--line)] bg-white p-5">
                  <dt className="font-medium">{f.q}</dt>
                  <dd className="mt-2 text-sm text-[var(--muted)]">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="fi-band-blue py-20 text-center">
          <h2 className="fi-display text-4xl text-white md:text-[3.2rem]">Start collecting this week.</h2>
          <p className="mx-auto mt-4 max-w-lg text-white/75">No Bagseven fee in beta. You never hold network gas for Whitechain demo settle.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={`${APP}/app/login`} className="fi-btn fi-btn-light">
              Start free
            </a>
            <a href={`${APP}/app/login`} className="fi-btn fi-btn-ghost">
              Sign in
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[var(--hero)] py-10 text-sm text-white/50">
        <div className="fi-wrap flex flex-col gap-4 md:flex-row md:justify-between">
          <div className="flex items-center gap-2 font-medium text-white">
            <Mark className="h-5 w-5" /> Bagseven
          </div>
          <a href="/docs/introduction" className="hover:text-white">Documentation ↗</a>
          <div>World · Whitechain · Arkiv · © {new Date().getFullYear()}</div>
        </div>
      </footer>
    </div>
  );
}
