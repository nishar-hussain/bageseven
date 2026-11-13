'use client';

import Link from 'next/link';
import Image from 'next/image';
import styles from './dashboard.module.css';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { identityLabel } from '../../lib/identity-label';
import {
  AlertTriangle,
  BookOpen,
  Coins,
  CreditCard,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  Layers,
  Puzzle,
  ShoppingBag,
  Menu,
  Plus,
  ArrowUpRight,
  Settings2,
  Shield,
  SquareStack,
  Terminal,
  UserRound,
  UsersRound,
  FileText,
  WalletCards,
} from 'lucide-react';

type NavItem = { href: string; label: string; icon: React.ElementType; badge?: number };

const mainNav: NavItem[] = [
  { href: '/app', label: 'Overview', icon: LayoutDashboard },
  { href: '/app/grants', label: 'Entitlements', icon: CreditCard },
  { href: '/app/features', label: 'Features', icon: Layers },
  { href: '/app/plans', label: 'Plans', icon: WalletCards },
  { href: '/app/checkouts', label: 'Checkouts', icon: ShoppingBag },
  { href: '/app/customers', label: 'Customers', icon: UsersRound },
  { href: '/app/invoices', label: 'Invoices', icon: FileText },
  { href: '/app/builder', label: 'Builder', icon: SquareStack },
  { href: '/app/developers', label: 'Developers', icon: KeyRound },
];

const catalogNav: NavItem[] = [
  { href: '/app/mint', label: 'Create entitlement', icon: Fingerprint },
  { href: '/app/credits', label: 'Buy credits', icon: Coins },
];

const accessNav: NavItem[] = [
  { href: '/app/mandate', label: 'Agent spending', icon: Shield },
  { href: '/app/mcp', label: 'Connect agent', icon: Terminal },
  { href: '/app/sdk', label: 'SDK', icon: Puzzle },
  {
    href: `${process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://localhost:3001'}/docs/introduction`,
    label: 'Documentation',
    icon: BookOpen,
  },
];

const settingsNav: NavItem[] = [
  { href: '/app/account', label: 'Account', icon: UserRound },
  { href: '/app/attention', label: 'Needs attention', icon: AlertTriangle },
  { href: '/app/settings', label: 'Network & gas', icon: Settings2 },
  { href: '/app/registry', label: 'Registry studio', icon: Layers },
];

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`${styles.navItem} ${active ? styles.active : ''}`}
    >
      <Icon size={16} strokeWidth={1.65} />
      <span>{item.label}</span>
      {item.badge != null && item.badge > 0 ? <span className={styles.badge}>{item.badge}</span> : null}
    </Link>
  );
}
function Group({
  title,
  items,
  pathname,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupLabel}>{title}</div>
      {items.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={pathname === item.href || pathname.startsWith(item.href + '/')}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeNav = () => setMobileOpen(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('a')?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const links = sidebarRef.current?.querySelectorAll<HTMLElement>('a, button');
        if (links?.length) {
          const first = links[0],
            last = links[links.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }
      if (event.key === 'Escape') {
        setMobileOpen(false);
        toggleRef.current?.focus();
      }
    };
    const wide = window.matchMedia('(min-width: 801px)');
    const resized = () => {
      if (wide.matches) setMobileOpen(false);
    };
    window.addEventListener('keydown', escape);
    wide.addEventListener('change', resized);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
      wide.removeEventListener('change', resized);
    };
  }, [mobileOpen]);
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
        const label = me?.email?.trim() || (me?.holder ? identityLabel(me.holder) : '') || 'Workspace';
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

  const currentPage =
    [...mainNav, ...catalogNav, ...accessNav, ...settingsNav].find(
      (item) => pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href + '/')),
    )?.label ?? 'Workspace';
  return (
    <div className={styles.shell}>
      {mobileOpen && (
        <button
          className={styles.backdrop}
          aria-label="Close navigation"
          onClick={() => {
            closeNav();
            toggleRef.current?.focus();
          }}
        />
      )}
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
        aria-label="Workspace navigation"
        className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}
      >
        <Link href="/app" className={styles.brand} onClick={closeNav}>
          <Image src="/icon.svg" width={32} height={32} alt="" />
          Bagseven<small>CONSOLE</small>
        </Link>
        <div className={styles.workspace}>
          <div className={styles.workspaceAvatar}>B7</div>
          <div className={styles.workspaceInfo}>
            <strong title={workspaceLabel}>{workspaceLabel}</strong>
            <span>
              <i />
              {live ? 'Signed in · Email + wallet' : 'Account setup'}
            </span>
          </div>
        </div>
        <nav className={styles.navigation} aria-label="Main navigation">
          {mainNav.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={
                pathname === item.href || (item.href !== '/app' && pathname.startsWith(item.href + '/'))
              }
              onNavigate={closeNav}
            />
          ))}
          <Group title="Catalog" items={catalogNav} pathname={pathname} onNavigate={closeNav} />
          <Group title="Agents & integration" items={accessNav} pathname={pathname} onNavigate={closeNav} />
          <Group title="Workspace" items={settingsWithBadge} pathname={pathname} onNavigate={closeNav} />
        </nav>
        <div className={styles.sidebarFoot}>
          <a href={process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://localhost:3001'}>← Back to website</a>
          <form action="/api/auth/logout" method="post">
            <button type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <div className={styles.mainArea}>
        <header className={styles.topbar}>
          <button
            ref={toggleRef}
            className={styles.mobileToggle}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Open workspace navigation"
            aria-expanded={mobileOpen}
            aria-controls="workspace-navigation"
          >
            <Menu size={18} />
          </button>
          <div className={styles.breadcrumb}>
            <Link href="/app">Workspace</Link>
            <span>/</span>
            <strong>{currentPage}</strong>
          </div>
          <div className={styles.headerActions}>
            <a
              href={`${process.env.NEXT_PUBLIC_LANDING_URL ?? 'http://localhost:3001'}/docs/introduction`}
              className={styles.helpLink}
            >
              Documentation
              <ArrowUpRight size={13} />
            </a>
            <Link href="/app/mint" className={styles.headerCreate} aria-label="Create entitlement">
              <Plus size={14} />
              <span>Create entitlement</span>
            </Link>
            <Link href="/app/account" className={styles.accountLink} aria-label="Account settings">
              B7{accountNudge > 0 && <span />}
            </Link>
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
