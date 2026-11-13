import Image from 'next/image';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, Plus } from 'lucide-react';
import { IntegrationCode } from '../components/home/BillingPreview';
import styles from '../components/home/landing.module.css';
import { ProductExperience, PageMotion } from '../components/home/ProductExperience';

const APP = (process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function Brand({ large = false }: { large?: boolean }) {
  return (
    <a href="/" className={`${styles.brand} ${large ? styles.brandLarge : ''}`} aria-label="Bagseven home">
      <Image src="/icon.svg" width={36} height={36} alt="" />
      Bagseven
    </a>
  );
}

const questions = [
  [
    'What does Bagseven actually do?',
    'Bagseven connects what a customer pays for to what they can use. Create a plan, sell it through checkout, and issue access with a credit balance or an expiry date. Your app and connected agents can check and use that access through the SDK or MCP.',
  ],
  [
    'Do customers need a wallet?',
    'Customers use verified email and a wallet ownership signature for authentication. On-chain payments, subscription approvals and cancellations require explicit approval in their wallet. An email address or wallet signature does not prove unique humanity.',
  ],
  [
    'Do agents need a spending mandate to use prepaid credits?',
    'No. Prepaid usage needs an authorized, living grant with enough credits, plus its worker binding when present. A new agent payment also needs an active spending mandate with sufficient capacity.',
  ],
  [
    'What happens when a subscription is cancelled?',
    'Cancellation stops future collections once confirmed on-chain. Access already paid for remains available until its paid-through date, subject to the remaining credits and grant terms.',
  ],
  [
    'Where do credits and permissions live?',
    'The Avalanche entitlement registry is authoritative for credit balances, access expiry and reservations. PostgreSQL stores private discovery and recovery metadata. Raw billing emails stay off-chain.',
  ],
  [
    'Who pays for the network fees?',
    'Providers fund the delegated gas used for registry operations. Customers approve their own payment and subscription transactions and need the applicable network gas. Provider gas permission and agent payment authority are separate.',
  ],
];

export default function LandingPage() {
  return (
    <div className={styles.site}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <PageMotion />
      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <Image
            className={styles.landscape}
            src="/images/access-landscape.webp"
            alt="A stone path climbing an Alpine ridge toward a gateway beneath a cobalt sky"
            fill
            priority
            sizes="100vw"
          />
          <div className={styles.heroShade} />
          <header className={styles.nav}>
            <a className={styles.navSide} href="#manifesto">
              OUR MANIFESTO <ArrowDown size={13} />
            </a>
            <div className={styles.navCenter}>
              <Brand />
              <details className={styles.menu}>
                <summary aria-label="Open navigation">
                  <span />
                  <span />
                  <span />
                  <span />
                </summary>
                <nav aria-label="Main navigation">
                  <a href="#product">
                    The product <ArrowUpRight size={15} />
                  </a>
                  <a href="#how-it-works">
                    How it works <ArrowUpRight size={15} />
                  </a>
                  <a href="#developers">
                    For developers <ArrowUpRight size={15} />
                  </a>
                  <a href="/docs/introduction">
                    Documentation <ArrowUpRight size={15} />
                  </a>
                  <a href={`${APP}/app/login`}>
                    Open dashboard <ArrowUpRight size={15} />
                  </a>
                </nav>
              </details>
            </div>
            <a className={styles.navSide} href={`${APP}/app/login`}>
              OPEN THE APP <ArrowUpRight size={15} />
            </a>
          </header>
          <div className={styles.heroTitle}>
            <p className={styles.mono}>PAYMENTS IN. ACCESS ON.</p>
            <h1 id="hero-title">
              Sell your product.
              <br />
              Keep access in sync.<span className={styles.star}>✳</span>
            </h1>
          </div>
          <div className={styles.heroBottom}>
            <p>
              Sell subscriptions and credit packs.
              <br />
              Keep customer access in sync.
              <br />
              Built on Avalanche.
            </p>
            <a className={styles.buttonWhite} href={`${APP}/app/login`}>
              Open your workspace <ArrowUpRight size={20} />
            </a>
          </div>
          <div className={styles.heroFoot}>
            <span className={styles.mono}>BUILT FOR PEOPLE. READY FOR AGENTS.</span>
            <a href="#manifesto" aria-label="Discover Bagseven">
              <ArrowDown size={18} />
            </a>
            <span className={styles.mono}>POWERED BY AVALANCHE ↗</span>
          </div>
        </section>

        <section data-reveal id="manifesto" className={styles.manifesto}>
          <div className={styles.sectionLabel}>
            <span className={styles.mono}>01 / THE IDEA</span>
            <span className={styles.mono}>LESS FRICTION. MORE POSSIBILITY.</span>
          </div>
          <div className={styles.manifestoGrid}>
            <span className={styles.orbit} aria-hidden="true">
              ✳
            </span>
            <div>
              <h2>
                Payment confirmed.
                <br />
                Access unlocked.
              </h2>
              <p>
                A customer buys a subscription or a pack of credits. Your app needs to know what they can use,
                how much remains and when access ends.
              </p>
              <p>
                Bagseven connects checkout to an entitlement your app can verify. Confirm the payment, unlock
                the feature and account for usage against the same grant.
              </p>
              <a className={styles.textLink} href="#product">
                Meet your access layer <ArrowDown size={16} />
              </a>
            </div>
          </div>
          <div className={styles.principles}>
            <div>
              <span>01</span>
              <p>
                Your product.
                <br />
                <em>Your rules.</em>
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                Clear permissions.
                <br />
                <em>Visible balances.</em>
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                Human approval.
                <br />
                <em>Agent capability.</em>
              </p>
            </div>
          </div>
        </section>

        <section data-reveal id="product" className={styles.product}>
          <div className={styles.sectionLabel}>
            <span className={styles.mono}>02 / ONE CONNECTED EXPERIENCE</span>
            <span className={styles.mono}>FROM CHECKOUT TO WHAT’S NEXT</span>
          </div>
          <div className={styles.productIntro}>
            <h2>
              One billing flow.
              <br />
              One integration.
            </h2>
            <div>
              <p>
                Let customers choose a plan, connect a wallet, pay and manage their access. All inside your
                product. All in one place.
              </p>
              <a className={styles.lightLink} href={`${APP}/app/builder`}>
                Build your experience <ArrowUpRight size={17} />
              </a>
            </div>
          </div>
          <ProductExperience appUrl={APP} />
          <div className={styles.productCaption}>
            <span className={styles.mono}>EXPLORE THE FLOW ABOVE. THEN BUILD YOUR OWN.</span>
            <span>Illustrative example. No real funds or credits move.</span>
          </div>
        </section>

        <section data-reveal id="how-it-works" className={styles.journey}>
          <div className={styles.sectionLabel}>
            <span className={styles.mono}>03 / A CLEAR PATH FORWARD</span>
            <span className={styles.mono}>START WITH WHAT YOU MAKE</span>
          </div>
          <div className={styles.journeyGrid}>
            <div className={styles.journeyHeading}>
              <h2>
                Your plans.
                <br />
                Their access.
              </h2>
              <p>
                Subscriptions for ongoing value.
                <br />
                Credits for every little use.
                <br />
                Permissions that keep it all connected.
              </p>
              <a className={styles.textLink} href="/docs/introduction">
                See how it fits together <ArrowUpRight size={16} />
              </a>
              <div className={styles.pathArt} aria-hidden="true">
                <span>01</span>
                <span>02</span>
                <span>03</span>
                <ArrowUpRight size={55} strokeWidth={1} />
              </div>
            </div>
            <ol className={styles.steps}>
              <li>
                <span className={styles.mono}>01 / DEFINE</span>
                <h3>Create a feature and a plan.</h3>
                <p>
                  Create a feature, choose credits or time-based access, and build a one-time or recurring
                  plan around it.
                </p>
                <span className={styles.stepTag}>PLANS & FEATURES</span>
              </li>
              <li>
                <span className={styles.mono}>02 / CONNECT</span>
                <h3>Add billing to your app.</h3>
                <p>
                  Style the unified embed and add it to your app. Customers approve checkout in their wallet;
                  confirmed payments unlock their access.
                </p>
                <span className={styles.stepTag}>CHECKOUT & SUBSCRIPTIONS</span>
              </li>
              <li>
                <span className={styles.mono}>03 / UNLOCK</span>
                <h3>Check access. Track usage.</h3>
                <p>
                  Check access through the SDK or MCP. Use prepaid credits, track what remains, and keep new
                  agent spending within an approved mandate.
                </p>
                <span className={styles.stepTag}>ENTITLEMENTS & AGENTS</span>
              </li>
            </ol>
          </div>
        </section>

        <section data-reveal className={styles.agents}>
          <div className={styles.sectionLabel}>
            <span className={styles.mono}>04 / CAPABILITY, WITH BOUNDARIES</span>
            <span className={styles.mono}>PREPAID ACCESS ≠ NEW SPENDING</span>
          </div>
          <div className={styles.agentsGrid}>
            <div>
              <h2>
                Agents can act.
                <br />
                You set the limits.
                <br />
                <em>Access stays yours.</em>
              </h2>
              <p>
                Give an agent access to what’s already paid for. When it needs to spend more, give it a
                separate, bounded permission.
              </p>
              <a className={styles.buttonWhite} href={`${APP}/app/mcp`}>
                Connect an agent <ArrowUpRight size={18} />
              </a>
            </div>
            <div className={styles.permissionSheet}>
              <div className={styles.sheetHeader}>
                <span className={styles.mono}>THE PERMISSION PRINCIPLE</span>
                <ArrowUpRight size={22} />
              </div>
              <div className={styles.permissionRow}>
                <span>Use prepaid access</span>
                <p>
                  A living grant. An authorized holder.
                  <br />
                  Enough credits to do the job.
                </p>
                <Check size={18} />
              </div>
              <div className={styles.permissionRow}>
                <span>Make a new payment</span>
                <p>
                  A living grant, plus an active mandate
                  <br />
                  with room in its spending limit.
                </p>
                <Check size={18} />
              </div>
              <div className={styles.permissionRow}>
                <span>Keep control</span>
                <p>
                  Explicit approvals. Scoped credentials.
                  <br />
                  Wallet keys stay out of the agent.
                </p>
                <Check size={18} />
              </div>
              <div className={styles.sheetFoot}>
                <span className={styles.statusDot} /> Two different permissions. One clear boundary.
              </div>
            </div>
          </div>
        </section>

        <section data-reveal id="developers" className={styles.developers}>
          <div className={styles.sectionLabel}>
            <span className={styles.mono}>05 / BUILT TO FIT</span>
            <span className={styles.mono}>YOUR APP. YOUR STACK.</span>
          </div>
          <div className={styles.developerGrid}>
            <div>
              <h2>
                One access model.
                <br />
                Across your stack.
              </h2>
              <p>
                Start with the React embed. Connect your backend to the SDK. Bring agents in through MCP. The
                same access model, wherever your product goes.
              </p>
              <div className={styles.developerLinks}>
                <a className={styles.textLink} href="/docs/sdk/react">
                  Explore the React SDK <ArrowUpRight size={16} />
                </a>
                <a className={styles.textLink} href="/docs/introduction">
                  Read the documentation <ArrowUpRight size={16} />
                </a>
              </div>
              <p className={styles.smallNote}>
                The SDK is currently a private workspace package. See the integration guide for setup.
              </p>
            </div>
            <IntegrationCode />
          </div>
        </section>

        <section data-reveal id="questions" className={styles.faq}>
          <div className={styles.sectionLabel}>
            <span className={styles.mono}>06 / A FEW GOOD QUESTIONS</span>
            <span className={styles.mono}>LET’S MAKE IT CLEAR</span>
          </div>
          <div className={styles.faqGrid}>
            <h2>
              Your questions,
              <br />
              <em>answered.</em>
            </h2>
            <div>
              {questions.map(([q, a]) => (
                <details key={q} className={styles.question}>
                  <summary>
                    {q}
                    <Plus size={19} strokeWidth={1.4} />
                  </summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerTop}>
            <span className={styles.mono}>THE NEXT CHAPTER IS YOURS.</span>
            <span className={styles.mono}>BAGSEVEN / BUILT ON AVALANCHE</span>
          </div>
          <div className={styles.footerCta}>
            <h2>
              Your product.
              <br />
              Your rules.
            </h2>
            <a className={styles.buttonWhite} href={`${APP}/app/login`}>
              Open your workspace <ArrowUpRight size={20} />
            </a>
          </div>
          <div className={styles.footerBottom}>
            <Brand large />
            <nav aria-label="Footer navigation">
              <a href="#manifesto">Manifesto</a>
              <a href="/docs/introduction">Documentation</a>
              <a href={`${APP}/app/login`}>
                Dashboard <ArrowRight size={13} />
              </a>
            </nav>
            <span>Access, on your terms.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
