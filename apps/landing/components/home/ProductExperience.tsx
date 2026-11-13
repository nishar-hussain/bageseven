'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, RotateCcw, ShieldCheck, Wallet } from 'lucide-react';
import styles from './landing.module.css';

const stages = [
  {
    label: '01 / SELL',
    title: 'A plan your customer can buy.',
    body: 'Offer a prepaid pack or recurring access. Your customer reviews the price and approves the payment in their wallet.',
  },
  {
    label: '02 / UNLOCK',
    title: 'A payment becomes usable access.',
    body: 'After payment confirmation, Bagseven issues a grant with its own balance and expiry. Your app checks the grant before doing the work.',
  },
  {
    label: '03 / USE',
    title: 'Every use has a clear result.',
    body: 'Spend one sample credit and see the remaining balance change. Real usage is authorized and accounted for by the Avalanche registry.',
  },
];
export function ProductExperience({ appUrl }: { appUrl: string }) {
  const [stage, setStage] = useState(0);
  const [plan, setPlan] = useState<'pack' | 'monthly'>('pack');
  const [approved, setApproved] = useState(false);
  const [credits, setCredits] = useState(5);
  const [cancelled, setCancelled] = useState(false);
  const [message, setMessage] = useState('Choose a plan to explore the checkout flow.');
  const reset = () => {
    setStage(0);
    setPlan('pack');
    setApproved(false);
    setCredits(5);
    setCancelled(false);
    setMessage('Choose a plan to explore the checkout flow.');
  };
  const choose = (value: 'pack' | 'monthly') => {
    setPlan(value);
    setApproved(false);
    setCredits(value === 'pack' ? 5 : 100);
    setCancelled(false);
    setMessage(
      value === 'pack'
        ? 'One payment. Five sample credits.'
        : 'Recurring access starts only after explicit subscription approval.',
    );
  };
  const confirm = () => {
    setApproved(true);
    setStage(1);
    setMessage('Sample payment confirmed. Access is now available. No wallet request or payment was sent.');
  };
  return (
    <div className={styles.experience}>
      <div className={styles.experienceTour}>
        <div className={styles.tourLabel}>FOLLOW A CUSTOMER PURCHASE</div>
        {stages.map((s, i) => (
          <button
            key={s.label}
            aria-pressed={stage === i}
            onClick={() => setStage(i)}
            className={stage === i ? styles.tourActive : ''}
          >
            <span>{s.label}</span>
            <h3>{s.title}</h3>
            {stage === i && <p>{s.body}</p>}
            <ArrowRight size={18} />
          </button>
        ))}
        <a href={`${appUrl}/app/builder`}>
          Build this into your app <ArrowUpRight size={15} />
        </a>
      </div>
      <div className={styles.experienceWindow}>
        <div className={styles.experienceChrome}>
          <span>
            <i />
            <i />
            <i />
          </span>
          <span>receiptbox / billing</span>
          <button onClick={reset} aria-label="Reset interactive example">
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
        <div className={styles.exampleLabel}>INTERACTIVE EXAMPLE · NO REAL PAYMENTS</div>
        <div className={styles.exampleHead}>
          <strong>
            ReceiptBox<span>Less paperwork. More time.</span>
          </strong>
          <span>
            <Wallet size={13} /> Example wallet
          </span>
        </div>
        <div className={styles.exampleTabs}>
          {['Choose a plan', 'My access', 'Use a credit'].map((label, i) => (
            <button key={label} aria-pressed={stage === i} onClick={() => setStage(i)}>
              {label}
            </button>
          ))}
        </div>
        <div className={styles.exampleContent}>
          {stage === 0 ? (
            <>
              <h4>Make room for your next receipt.</h4>
              <p>Pick the access that fits your workflow.</p>
              <div className={styles.examplePlans}>
                <button aria-pressed={plan === 'pack'} onClick={() => choose('pack')}>
                  <span>PREPAID PACK</span>
                  <strong>5 scans</strong>
                  <small>One-time purchase</small>
                  <i>{plan === 'pack' && <Check size={11} />}</i>
                </button>
                <button aria-pressed={plan === 'monthly'} onClick={() => choose('monthly')}>
                  <span>MONTHLY PLAN</span>
                  <strong>100 scans</strong>
                  <small>Renews every 30 days</small>
                  <i>{plan === 'monthly' && <Check size={11} />}</i>
                </button>
              </div>
              <div className={styles.exampleCheckout}>
                <span>
                  {plan === 'pack' ? '5 USDC · one-time' : '10 USDC · every 30 days'}
                  <small>Illustrative price, on Avalanche</small>
                </span>
                <button onClick={confirm}>
                  {approved ? 'Confirm example again' : 'Simulate payment approval'}
                  <ArrowRight size={14} />
                </button>
              </div>
              <p className={styles.exampleDisclaimer}>
                In your app, customers review the actual amount, token, network and permissions in their
                wallet.
              </p>
            </>
          ) : stage === 1 ? (
            <>
              <div className={styles.exampleGrant}>
                <span className={styles.exampleState}>
                  {approved ? 'ACCESS ACTIVE' : 'AWAITING CHECKOUT'}
                </span>
                <h4>{approved ? 'Your receipt scans are ready.' : 'Start with a confirmed payment.'}</h4>
                <p>
                  {approved
                    ? 'This sample grant keeps access and billing in sync.'
                    : 'Choose a plan and simulate approval to unlock this example.'}
                </p>
                {approved ? (
                  <>
                    <div className={styles.grantBalance}>
                      <strong>
                        {credits}
                        <small>scans remaining</small>
                      </strong>
                      <span>
                        30-day access period<small>Example dates, not an on-chain record</small>
                      </span>
                    </div>
                    <div className={styles.exampleRenewal}>
                      <span>
                        Renewal
                        <strong>
                          {plan === 'pack'
                            ? 'Not recurring'
                            : cancelled
                              ? 'Cancelled · paid access kept'
                              : 'Enabled'}
                        </strong>
                      </span>
                      {plan === 'monthly' && !cancelled && (
                        <button
                          onClick={() => {
                            setCancelled(true);
                            setMessage(
                              'Future renewal cancelled in this example. Your paid period and remaining scans stay available.',
                            );
                          }}
                        >
                          Simulate cancellation
                        </button>
                      )}
                    </div>
                    <button className={styles.examplePrimary} onClick={() => setStage(2)}>
                      Try a sample scan
                      <ArrowRight size={14} />
                    </button>
                  </>
                ) : (
                  <button className={styles.examplePrimary} onClick={() => setStage(0)}>
                    Go to plans
                    <ArrowRight size={14} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <h4>A scan costs one credit.</h4>
              <p>Access is checked before the work runs.</p>
              <div className={styles.scanDemo}>
                <div className={styles.paperReceipt}>
                  <span>RECEIPT / 007</span>
                  <div />
                  <div />
                  <div />
                  <strong>Total · 24.50</strong>
                </div>
                <div>
                  <span>Available access</span>
                  <strong>
                    {approved ? credits : 0}
                    <small>sample scans</small>
                  </strong>
                  <span>
                    {!approved ? 'Confirm a plan first' : credits > 0 ? 'Ready to scan' : 'Pack used up'}
                  </span>
                </div>
              </div>
              <button
                className={styles.examplePrimary}
                disabled={!approved || credits === 0}
                onClick={() => {
                  setCredits((c) => c - 1);
                  setMessage(
                    `Sample scan complete. ${credits - 1} credits remain. This example has not consumed real credits.`,
                  );
                }}
              >
                Use 1 sample credit
                <ArrowRight size={14} />
              </button>
              {(!approved || credits === 0) && (
                <button className={styles.exampleTextButton} onClick={reset}>
                  Start a new example →
                </button>
              )}
              <p className={styles.exampleDisclaimer}>
                Prepaid usage needs authorized access and enough credits. It does not need an agent payment
                mandate.
              </p>
            </>
          )}
        </div>
        <div className={styles.exampleMessage} role="status" aria-live="polite">
          <ShieldCheck size={14} />
          <span>{message}</span>
        </div>
        <div className={styles.experienceFoot}>
          <span>Powered by Bagseven</span>
          <a href="/docs/concepts/entitlements">How grants work ↗</a>
        </div>
      </div>
    </div>
  );
}

export function PageMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const elements = document.querySelectorAll<HTMLElement>('[data-reveal]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-visible', 'true');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08 },
    );
    for (const element of elements) {
      if (element.getBoundingClientRect().top > innerHeight) {
        element.setAttribute('data-animate', 'true');
        observer.observe(element);
      }
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const total = document.documentElement.scrollHeight - innerHeight;
      if (ref.current) ref.current.style.transform = `scaleX(${total > 0 ? scrollY / total : 0})`;
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', scroll);
      cancelAnimationFrame(frame);
      for (const e of elements) e.removeAttribute('data-animate');
    };
  }, []);
  return <div ref={ref} className={styles.readingProgress} aria-hidden="true" />;
}
