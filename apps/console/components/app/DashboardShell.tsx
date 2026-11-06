'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Coins,
  CreditCard,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  Layers,
  Puzzle,
  Search,
  Settings2,
  Shield,
  SquareStack,
  Terminal,
  UserRound,
  WalletCards,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: number };

const mainNav: NavItem[] = [
  { href: '/app', label: 'Overview', icon: LayoutDashboard },
  { href: '/app/grants', label: 'Entitlements', icon: CreditCard },
  { href: '/app/features', label: 'Features', icon: Layers },
  { href: '/app/plans', label: 'Plans', icon: WalletCards },
  { href: '/app/builder', label: 'Builder', icon: SquareStack },
  { href: '/app/developers', label: 'Developers', icon: KeyRound },
];

const catalogNav: NavItem[] = [
  { href: '/app/mint', label: 'Create entitlement', icon: Fingerprint },
  { href: '/app/credits', label: 'Buy credits', icon: Coins },
];

const accessNav: NavItem[] = [
  { href: '/app/mandate', label: 'Mandate', icon: Shield },
  { href: '/app/mcp', label: 'Connect agent', icon: Terminal },
  { href: '/app/sdk', label: 'SDK', icon: Puzzle },
];

const settingsNav: NavItem[] = [
  { href: '/app/account', label: 'Account', icon: UserRound },
  { href: '/app/attention', label: 'Needs attention', icon: AlertTriangle },
  { href: '/app/settings', label: 'Tracks', icon: Settings2 },
  { href: '/app/arkiv', label: 'Arkiv studio', icon: Layers },
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
      {item.badge != null && item.badge > 0 ? (
        <span className="rounded-full bg-[var(--warn-t)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warn)]">
          {item.badge}
        </span>
      ) : null}
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
  const [accountNudge, setAccountNudge] = useState(0);
  const [live, setLive] = useState(false);
  const [workspaceLabel, setWorkspaceLabel] = useState('Workspace');
  const isBare =
    pathname === '/app/login' ||
    pathname.startsWith('/app/login/') ||
    pathname === '/app/onboarding' ||
    pathname.startsWith('/app/onboarding/');

  // Lightweight shell bootstrap — /api/me only (no grants/status hammering).
  useEffect(() => {
    if (isBare) return;
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetch('/api/me', { signal: AbortSignal.timeout(6_000) })
          .then(async (r) =>
            r.ok
              ? ((await r.json()) as {
                  email?: string | null;
                  email_verified?: boolean;
                  wallet_address?: string | null;
                  holder?: string;
                })
              : null,
          )
          .catch(() => null);
        if (cancelled) return;

        let account = 0;
        if (!me?.email_verified) account += 1;
        if (!me?.wallet_address) account += 1;
        setAccountNudge(account);
        setAttention(account);
        setLive(Boolean(me?.holder));
        const label =
          me?.email?.trim() ||
          (me?.holder?.startsWith('world:') ? `World · ${me.holder.slice(6, 14)}…` : me?.holder) ||
          'Workspace';
        setWorkspaceLabel(label);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBare]);

  const settingsWithBadge = settingsNav.map((p) => {
    if (p.href === '/app/attention') return { ...p, badge: attention };
    if (p.href === '/app/account') return { ...p, badge: accountNudge };
    return p;
  });

  if (isBare) return <>{children}</>;

  return (
    <div className="min-h-screen bg-[var(--dash-bg,#f2f2f2)] text-[var(--ink)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-[var(--line)] bg-[var(--soft)] px-3 py-4 lg:flex">
        <Link href="/app" className="px-2 pb-4 text-[17px] font-semibold tracking-tight text-[var(--blue)]">
          Bagseven
        </Link>

        <div className="mx-1 mb-3 flex items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-white px-3 py-2.5 shadow-[var(--sh)]">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--hero)] text-[11px] font-bold text-white">
            B7
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{workspaceLabel}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  live ? 'bg-[var(--good-t)] text-[var(--good)]' : 'bg-[var(--soft)] text-[var(--muted)]'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-[var(--good)]' : 'bg-[var(--muted)]'}`} />
                {live ? 'Signed in' : 'Setup'}
              </span>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-0.5 pb-4">
          <div className="space-y-0.5">
            {mainNav.map((item) => {
              const active = pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href));
              return <NavLink key={item.href} item={item} active={active} />;
            })}
          </div>
          <Group title="Catalog" items={catalogNav} pathname={pathname} />
          <Group title="Access" items={accessNav} pathname={pathname} />
          <Group title="Settings" items={settingsWithBadge} pathname={pathname} />
        </nav>

        <div className="mx-1">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full rounded-xl px-3 py-2 text-left text-[12px] text-[var(--muted)] hover:bg-white hover:text-[var(--ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--dash-bg,#f2f2f2)]/90 px-4 backdrop-blur md:px-6">
          <div className="relative mx-auto hidden w-full max-w-md md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
            <input
              className="w-full rounded-full border border-[var(--line)] bg-white py-2 pl-9 pr-3 text-sm shadow-[var(--sh)] placeholder:text-[var(--faint)]"
              placeholder="Search entitlement, plan, or holder"
              disabled
              aria-disabled="true"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/app/features"
              className="hidden rounded-full border border-[var(--line)] bg-white px-3.5 py-2 text-[13px] font-medium md:inline-flex"
            >
              New feature
            </Link>
            <Link
              href="/app/mint"
              className="rounded-full bg-[var(--ink)] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-black"
            >
              Create entitlement
            </Link>
            <Link
              href="/app/account"
              className="relative flex h-8 w-8 items-center justify-center rounded-full bg-[var(--hero)] text-[11px] font-bold text-white"
              title="Account"
            >
              B7
              {accountNudge > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--warn)] ring-2 ring-[var(--dash-bg,#f2f2f2)]" />
              ) : null}
            </Link>
          </div>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-[var(--soft)] px-3 py-2 lg:hidden">
          {[...mainNav, ...catalogNav, ...accessNav, ...settingsWithBadge].map((item) => {
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
                {item.badge != null && item.badge > 0 ? ` (${item.badge})` : ''}
              </Link>
            );
          })}
        </div>

        <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
