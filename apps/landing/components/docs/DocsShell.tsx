'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, ChevronRight, Command, Menu, Moon, Search, Sun, X } from 'lucide-react';
import type { docsNavigation } from '../../lib/docs';

type Navigation = typeof docsNavigation;
const groups = ['Get started', 'Core concepts', 'Guides', 'SDKs', 'API reference', 'Resources'];

export function DocsShell({ pages, appUrl, children }: { pages: Navigation; appUrl: string; children: ReactNode }) {
  const path = usePathname();
  const current = pages.find(page => `/docs/${page.slug}` === path);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const results = pages.filter(page => `${page.title} ${page.description} ${page.sections.map(s => s.title).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.current?.focus(); setSearching(true); }
      if (event.key === 'Escape') { setSearching(false); setMobileOpen(false); search.current?.blur(); }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  function navigate() { setSearching(false); setQuery(''); setMobileOpen(false); }

  return <div className={`docs-root${dark ? ' docs-dark' : ''}`}>
    <a className="docs-skip" href="#documentation-content">Skip to content</a>
    <header className="docs-header">
      <div className="docs-header-main">
        <Link href="/" className="docs-brand" aria-label="Bagseven home"><span className="docs-mark">b<span>7</span></span><span>Bagseven</span><span className="docs-brand-divider" /><span className="docs-brand-label">docs</span></Link>
        <div className="docs-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSearching(false); }}>
          <Search size={17} aria-hidden="true" />
          <input ref={search} type="search" placeholder="Search documentation…" aria-label="Search documentation" value={query} onFocus={() => setSearching(true)} onChange={e => { setQuery(e.target.value); setSearching(true); }} />
          <kbd><Command size={11} /> K</kbd>
          {searching && <div className="docs-search-results" aria-label="Documentation search results">
            <div className="docs-search-caption">{query ? `${results.length} results` : 'Explore documentation'}</div>
            {results.length ? results.map(page => <Link key={page.slug} href={`/docs/${page.slug}`} onClick={navigate}><BookOpen size={16} /><span><strong>{page.title}</strong><small>{page.description}</small></span><ChevronRight size={14} /></Link>) : <p>No matching pages. Try “wallet”, “credits”, or “MCP”.</p>}
          </div>}
        </div>
        <div className="docs-header-actions"><button aria-label={dark ? 'Use light theme' : 'Use dark theme'} onClick={() => setDark(d => !d)} className="docs-icon-button">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><a href={`${appUrl}/app`} className="docs-dashboard">Dashboard <ArrowUpRight size={14} /></a></div>
      </div>
      <div className="docs-header-sub"><nav aria-label="Documentation sections">{[{ title: 'Documentation', slug: 'introduction', active: current?.group !== 'SDKs' && current?.group !== 'API reference' }, { title: 'SDKs', slug: 'sdk/node', active: current?.group === 'SDKs' }, { title: 'API reference', slug: 'api/overview', active: current?.group === 'API reference' }].map(tab => <Link key={tab.slug} href={`/docs/${tab.slug}`} className={tab.active ? 'active' : ''} onClick={navigate}>{tab.title}</Link>)}</nav><span className="docs-version"><span /> Platform documentation</span></div>
    </header>
    <div className="docs-mobile-bar"><button onClick={() => setMobileOpen(o => !o)} aria-expanded={mobileOpen} aria-controls="docs-sidebar">{mobileOpen ? <X size={16} /> : <Menu size={16} />} Menu</button><span>{current?.title ?? 'Documentation'}</span></div>
    <div className="docs-grid">
      <aside id="docs-sidebar" className={`docs-sidebar${mobileOpen ? ' is-open' : ''}`} aria-label="Documentation navigation">
        <Link href="/docs/introduction" className="docs-sidebar-home" onClick={navigate}><BookOpen size={16} /> Documentation</Link>
        {groups.map(group => <div className="docs-nav-group" key={group}><div className="docs-nav-label">{group}</div><nav aria-label={group}>{pages.filter(page => page.group === group).map(page => <Link key={page.slug} href={`/docs/${page.slug}`} onClick={navigate} aria-current={current?.slug === page.slug ? 'page' : undefined}>{page.title}{current?.slug === page.slug && <span className="docs-active-dot" />}</Link>)}</nav></div>)}
        <a href={`${appUrl}/app/mcp`} className="docs-sidebar-help">Build with an agent <ArrowUpRight size={14} /></a>
      </aside>
      <main id="documentation-content" className="docs-main" key={path}>{children}</main>
      <aside className="docs-toc" aria-label="On this page"><div>On this page</div><nav>{current?.sections.map(section => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}</nav><div className="docs-toc-footer"><span>Ready to build?</span><a href={`${appUrl}/app`}>Open your dashboard <ArrowUpRight size={13} /></a></div></aside>
    </div>
  </div>;
}
