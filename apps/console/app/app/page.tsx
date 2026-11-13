'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  RefreshCw,
  Check,
  AlertCircle,
  ShoppingBag,
  CreditCard,
  Users,
  Layers,
} from 'lucide-react';
import type { ProviderOverview } from '../../lib/provider-overview';
import styles from './overview.module.css';

const labels: Record<string, string> = {
  PAID: 'Paid',
  PENDING: 'Awaiting payment',
  EXPIRED: 'Expired',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  PAST_DUE: 'Past due',
  RECONCILIATION_REQUIRED: 'Reconcile payment',
};
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function OverviewPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ProviderOverview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const requestId = useRef({ value: 0 }).current;
  const refresh = useCallback(async () => {
    const id = ++requestId.value;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/overview?days=${days}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not load provider activity.');
      if (id === requestId.value) {
        setData(result);
        setSelected(null);
      }
    } catch (cause) {
      if (id === requestId.value) setError(cause instanceof Error ? cause.message : 'Activity unavailable.');
    } finally {
      if (id === requestId.value) setBusy(false);
    }
  }, [days, requestId]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 60000);
    return () => {
      requestId.value++;
      clearInterval(timer);
    };
  }, [refresh, requestId]);
  const current = data?.days === days ? data : null;
  const metrics = current?.metrics;
  const chart = current?.activity ?? [];
  const max = Math.max(1, ...chart.map((d) => d.opened));
  const focused = chart.find((d) => d.day === selected);
  const attention = (metrics?.pastDue ?? 0) + (metrics?.reconciliation ?? 0);
  return (
    <div className={styles.overview}>
      <header className={styles.intro}>
        <div>
          <div className={styles.eyebrow}>PROVIDER WORKSPACE</div>
          <h1>Overview</h1>
          <p>Sales activity, recurring payments and the next things to take care of.</p>
        </div>
        <div className={styles.toolbar}>
          <select
            aria-label="Reporting period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={() => void refresh()} disabled={busy} aria-label="Refresh provider overview">
            <RefreshCw size={15} className={busy ? styles.spinning : ''} />
          </button>
          <Link href="/app/plans">
            Manage plans <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          <AlertCircle size={17} />
          <p>
            {error} {current && 'Previously loaded data is shown below and may be out of date.'}
          </p>
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      <div className={styles.stats} aria-busy={busy}>
        {[
          {
            label: 'Paid checkouts',
            value: metrics?.paid,
            sub: `From checkouts opened in this period`,
            icon: ShoppingBag,
            href: `/app/checkouts?status=PAID&days=${days}`,
          },
          {
            label: 'Paying customers',
            value: metrics?.customers,
            sub: 'Distinct checkout holders in this period',
            icon: Users,
            href: `/app/checkouts?status=PAID&days=${days}`,
          },
          {
            label: 'Active subscriptions',
            value: metrics?.activeSubscriptions,
            sub: 'Current recurring permissions · all periods',
            icon: CreditCard,
            href: '/app/plans#subscriptions',
          },
          {
            label: 'Active plans',
            value: metrics?.activePlans,
            sub: 'Currently available in your catalog',
            icon: Layers,
            href: '/app/plans',
          },
        ].map((m) => (
          <Link key={m.label} className={styles.stat} href={m.href}>
            <div>
              <span>{m.label}</span>
              <m.icon size={15} />
            </div>
            <strong>{m.value ?? '—'}</strong>
            <p>{m.sub}</p>
            <ArrowUpRight className={styles.statArrow} size={14} />
          </Link>
        ))}
      </div>
      <div className={styles.primaryGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Checkout activity</h2>
              <p>Opened in this period · grouped by creation date, UTC</p>
            </div>
            <span className={styles.liveLabel}>
              {busy
                ? 'Updating…'
                : current
                  ? `Updated ${new Date(current.asOf).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
                  : 'Not loaded'}
            </span>
          </div>
          <div className={styles.chartSummary}>
            <strong>
              {metrics?.checkouts ?? '—'}
              <span>checkouts opened</span>
            </strong>
            <div>
              <span>
                <i />
                Opened
              </span>
              <span>
                <i />
                Now paid
              </span>
            </div>
          </div>
          {current ? (
            <>
              <div
                className={styles.chart}
                role="group"
                aria-label="Daily checkouts, select a day for details"
              >
                {chart.map((day) => (
                  <button
                    key={day.day}
                    className={`${styles.bar} ${selected === day.day ? styles.selectedBar : ''}`}
                    tabIndex={selected === day.day || (!selected && day.day === chart[0]?.day) ? 0 : -1}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      event.preventDefault();
                      const buttons = event.currentTarget.parentElement?.querySelectorAll('button');
                      if (!buttons) return;
                      const index = chart.findIndex((item) => item.day === day.day);
                      const next =
                        event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? chart.length - 1
                            : Math.max(
                                0,
                                Math.min(chart.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)),
                              );
                      buttons[next]?.focus();
                    }}
                    onFocus={() => setSelected(day.day)}
                    onMouseEnter={() => setSelected(day.day)}
                    onClick={() => setSelected(day.day)}
                    aria-label={`${day.day}: ${day.opened} opened, ${day.paid} now paid`}
                    aria-pressed={selected === day.day}
                  >
                    <span style={{ height: `${day.opened ? Math.max(3, (day.opened / max) * 100) : 1}%` }} />
                    <span style={{ height: `${day.paid ? Math.max(3, (day.paid / max) * 100) : 0}%` }} />
                  </button>
                ))}
              </div>
              <div className={styles.chartAxis}>
                <span>{chart[0]?.day}</span>
                <span>{chart.at(-1)?.day}</span>
              </div>
              <p className={styles.chartDetail} aria-live="polite">
                {focused
                  ? `${focused.day} · ${focused.opened} opened · ${focused.paid} now paid`
                  : metrics?.checkouts
                    ? 'Select a day to inspect checkout activity.'
                    : 'No checkouts opened in this period. Share your billing embed to start accepting purchases.'}
              </p>
            </>
          ) : (
            <p className={styles.empty}>
              {busy ? 'Loading checkout activity…' : 'Checkout activity could not be loaded.'}
            </p>
          )}
          <div className={styles.outcomes}>
            <div>
              <strong>{metrics?.paid ?? '—'}</strong>
              <span>Paid</span>
            </div>
            <div>
              <strong>{metrics?.pending ?? '—'}</strong>
              <span>Awaiting payment</span>
            </div>
            <div>
              <strong>{metrics?.expired ?? '—'}</strong>
              <span>Expired</span>
            </div>
            <div>
              <strong>{metrics?.failed ?? '—'}</strong>
              <span>Failed</span>
            </div>
          </div>
        </section>
        <aside className={styles.rightColumn}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2>Needs your attention</h2>
                <p>Current subscription issues</p>
              </div>
              <span className={attention ? styles.countWarn : styles.count}>{metrics ? attention : '—'}</span>
            </div>
            {metrics ? (
              attention ? (
                <>
                  <div className={styles.issueSummary}>
                    {metrics.pastDue > 0 && (
                      <p>
                        <strong>{metrics.pastDue}</strong> past-due subscription
                        {metrics.pastDue === 1 ? '' : 's'}
                      </p>
                    )}
                    {metrics.reconciliation > 0 && (
                      <p>
                        <strong>{metrics.reconciliation}</strong> payment
                        {metrics.reconciliation === 1 ? '' : 's'} needing reconciliation
                      </p>
                    )}
                  </div>
                  {current?.subscriptions.map((sub) => (
                    <Link key={sub.id} href="/app/plans#subscriptions" className={styles.issue}>
                      <AlertCircle size={15} />
                      <span>
                        <strong>{sub.plan}</strong>
                        <small>{labels[sub.status] ?? sub.status}</small>
                      </span>
                      <ArrowUpRight size={13} />
                    </Link>
                  ))}
                  <p className={styles.note}>
                    Resolve uncertain payments before charging or issuing access again.
                  </p>
                </>
              ) : (
                <div className={styles.allClear}>
                  <Check size={20} />
                  <strong>No subscription issues reported</strong>
                  <p>
                    {metrics.activeSubscriptions
                      ? 'No past-due or reconciliation states at the last refresh.'
                      : 'No active recurring subscriptions yet. Customer approval is required before recurring collection.'}
                  </p>
                </div>
              )
            ) : (
              <p className={styles.empty}>Waiting for subscription status.</p>
            )}
          </section>
          <section className={`${styles.panel} ${styles.setup}`}>
            <div className={styles.eyebrow}>CUSTOMER CHECKOUT</div>
            <h2>
              {metrics?.publishedEmbeds
                ? 'Your billing page is published.'
                : 'Put your plans in front of customers.'}
            </h2>
            <p>
              {metrics?.publishedEmbeds
                ? `${metrics.publishedEmbeds} published embed design${metrics.publishedEmbeds === 1 ? '' : 's'}. Review your installation and customer sign-in before sharing.`
                : 'Choose your plans, style the unified embed, then connect it to your app.'}
            </p>
            <Link href="/app/builder">
              {metrics?.publishedEmbeds ? 'Manage your embed' : 'Set up your embed'}
              <ArrowUpRight size={15} />
            </Link>
          </section>
        </aside>
      </div>
      <div className={styles.bottomGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Recent checkouts</h2>
              <p>Latest six in the selected period</p>
            </div>
            <Link href={`/app/checkouts?days=${days}`}>
              View all <ArrowUpRight size={13} />
            </Link>
          </div>
          {current?.recent.length ? (
            <div className={styles.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Plan / checkout</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {current.recent.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.plan}</strong>
                        <small>{row.id.slice(0, 15)}…</small>
                      </td>
                      <td>{date(row.createdAt)}</td>
                      <td>
                        <span className={row.status === 'PAID' ? styles.paid : styles.status}>
                          {labels[row.status] ?? row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.empty}>
              <ShoppingBag size={22} />
              <h3>
                {!current
                  ? busy
                    ? 'Loading checkouts…'
                    : 'Checkouts unavailable'
                  : 'No checkouts in this period'}
              </h3>
              <p>Paid and unfinished checkouts appear here when a customer starts a purchase.</p>
              <Link href="/app/builder">
                Review your checkout experience <ArrowUpRight size={13} />
              </Link>
            </div>
          )}
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Plan performance</h2>
              <p>Checkout counts · selected period</p>
            </div>
            <Link href="/app/plans">
              Catalog <ArrowUpRight size={13} />
            </Link>
          </div>
          {current?.topPlans.length ? (
            <div className={styles.planList}>
              {current.topPlans.map((plan) => (
                <Link key={plan.id} href="/app/plans">
                  <span>
                    <strong>{plan.name}</strong>
                    <small>{plan.opened} opened</small>
                  </span>
                  <span>
                    <strong>{plan.paid}</strong>
                    <small>paid</small>
                  </span>
                  <ArrowUpRight size={13} />
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>
              {busy ? 'Loading plans…' : 'Create your first plan to start tracking checkout activity.'}
            </p>
          )}
          <p className={styles.note}>
            These are checkout counts, not revenue or renewal collections. Directly issued grants are not
            counted as sales.
          </p>
        </section>
      </div>
      <footer className={styles.footnote}>
        Provider-scoped billing records. Credit balances and access validity remain authoritative on
        Avalanche. <Link href="/app/settings">Network & gas ↗</Link>
      </footer>
    </div>
  );
}
