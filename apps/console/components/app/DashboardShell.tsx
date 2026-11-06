'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Coins,
  CreditCard,
  Fingerprint,
  LayoutDashboard,
  Puzzle,
  Search,
  Settings2,
  Shield,
  SquareStack,
  Terminal,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { entitlementsApi } from '../../lib/entitlements-client';

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: number };

/** Schematic / ArcenPay-shaped: catalog + living access + embed. No payment-link Checkouts nav. */
const primary: NavItem[] = [
  { href: '/app', label: 'Overview', icon: LayoutDashboard },
  { href: '/app/grants', label: 'Entitlements', icon: CreditCard },
  { href: '/app/plans', label: 'Plans', icon: WalletCards },
  { href: '/app/builder', label: 'Builder', icon: SquareStack },
  { href: '/app/mint', label: 'Create entitlement', icon: Fingerprint },
  { href: '/app/credits', label: 'Buy credits', icon: Coins },
  { href: '/app/sdk', label: 'SDK', icon: Puzzle },
];

const access: NavItem[] = [
  { href: '/app/mandate', label: 'Mandate', icon: Shield },
  { href: '/app/mcp', label: 'Connect agent', icon: Terminal },
];

const settings: NavItem[] = [
  { href: '/app/account', label: 'Account', icon: UserRound },
  { href: '/app/attention', label: 'Needs attention', icon: AlertTriangle },
  { href: '/app/settings', label: 'Tracks', icon: Settings2 },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition ${
        active
          ? 'bg-white font-semibold text-[var(--ink)] shadow-[var(--sh)]'
          : 'text-[var(--ink2)] hover:bg-white/70 hover:text-[var(--ink)]'
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="rounded-full bg-[var(--warn-t)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn)]">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function Group({ title, items, pathname }: { title: string; items: NavItem[]; pathname: string }) {
  return (
    <div className="mt-5">
      <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--faint)]">{title}</div>
      <div className="space-y-0.5">
        {items.map((item) => {
          const active = pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
          return <NavLink key={item.href} item={item} active={active} />;
        })}
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [attention, setAttention] = useState(0);
  const [networkLabel, setNetworkLabel] = useState('Connecting…');
  const isBare =
    pathname === '/app/login' ||
    pathname.startsWith('/app/login/') ||
    pathname === '/app/onboarding' ||
    pathname.startsWith('/app/onboarding/');

  useEffect(() => {
    if (isBare) return;
    void (async () => {
      try {
        const [status, live] = await Promise.all([
          entitlementsApi.status().catch(() => null),
          // All living entitlements (any feature SKU), not OCR-only
          entitlementsApi.live().catch(() => ({ grants: [] })),
        ]);
        const liveCount = live.grants?.length ?? 0;
        // Settings → Needs attention badge: empty entitlements or offline tracks
        let n = 0;
        if (liveCount === 0) n += 1;
        if (status && !status.tracks.arkiv.live) n += 1;
        if (status?.tracks.world.mock_proofs) n += 1;
        setAttention(n);
        if (status) {
          const worldOk =
            status.tracks.world.mode === 'dual' ||
            status.tracks.world.mode === 'idkit' ||
            status.tracks.world.mode === 'agent_pass' ||
            status.tracks.world.mode === 'live' ||
            status.tracks.world.mode === 'oidc';
          const parts = [
            worldOk ? 'World · live' : 'World · setup needed',
            status.tracks.arkiv.live ? 'Arkiv · live' : 'Arkiv · local',
          ];
          setNetworkLabel(parts.join(' · '));
        }
      } catch {
        /* ignore */
      }
    })();
  }, [pathname, isBare]);

  const withBadge = primary;
  const settingsWithBadge = settings.map((p) => (p.href === '/app/attention' ? { ...p, badge: attention } : p));

  if (isBare) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[var(--dash-bg,#f2f2f2)] text-[var(--ink)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] flex-col border-r border-[var(--line)] bg-[var(--soft)] px-3 py-4 lg:flex">
        <Link href="/app" className="flex items-center gap-2 px-2 pb-4">
          <span className="text-[17px] font-semibold tracking-tight text-[var(--blue)]">Bagseven</span>
        </Link>

        <div className="mx-1 mb-3 flex items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-white px-3 py-2.5 shadow-[var(--sh)]">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--hero)] text-[11px] font-bold text-white">
            B7
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">Workspace</div>
            <div className="truncate text-[11px] text-[var(--muted)]">{networkLabel}</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-0.5 pb-4">
          <div className="space-y-0.5">
            {withBadge.map((item) => {
              const active = pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
              return <NavLink key={item.href} item={item} active={active} />;
            })}
          </div>
          <Group title="Access" items={access} pathname={pathname} />
          <Group title="Settings" items={settingsWithBadge} pathname={pathname} />
        </nav>

        <div className="mx-1 space-y-1">
          <a
            href={process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://localhost:3001'}
            className="block rounded-xl px-3 py-2 text-[12px] text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"
          >
            ← Marketing site
          </a>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="w-full rounded-xl px-3 py-2 text-left text-[12px] text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--dash-bg,#f2f2f2)]/90 px-4 backdrop-blur md:px-6">
          <div className="relative mx-auto hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
            <input
              className="w-full rounded-full border border-[var(--line)] bg-white py-2 pl-9 pr-3 text-sm shadow-[var(--sh)] placeholder:text-[var(--faint)]"
              placeholder="Search coming soon"
              disabled
              aria-disabled="true"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/app/mint"
              className="rounded-full bg-[var(--ink)] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-black"
            >
              Create entitlement
            </Link>
            <Link
              href="/app/mcp"
              className="hidden rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-[13px] font-medium sm:inline-flex"
            >
              Connect agent
            </Link>
          </div>
        </header>

        {/* mobile nav */}
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--soft)] px-3 py-2 lg:hidden">
          {[...withBadge, ...access, ...settingsWithBadge].map((item) => {
            const active = pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${
                  active ? 'bg-white font-semibold shadow-sm' : 'text-[var(--muted)]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
