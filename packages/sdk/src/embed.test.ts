import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { BagsevenEmbed } from './embed.js';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
it('presents real billing history without a credit-consuming test action in the customer portal', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/entitlements')
    ? { entitlements: [{ feature: 'ocr', remaining: '4', enabled: true, grant_id: 'g', paid_through: '2099-01-01T00:00:00Z' }] }
    : url.endsWith('/subscriptions') ? { subscriptions: [] }
    : { email: 'customer@example.com', documents: [{ id: 'invoice', paid_at: '2026-11-13T10:00:00Z', url: 'https://console.example.com/billing/invoice', terms: { planName: 'Starter receipt', amount: '1', chainId: 43113, token: '0x5425890298aed601595a70AB815c96711a31Bc65' } }] }
  ))));
  await act(async () => { renderer = create(createElement(BagsevenEmbed, { accessToken: 'customer-token', holder: 'customer', initialView: 'portal' })); });
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).toContain('Recent invoices'); expect(text).toContain('Starter receipt'); expect(text).toContain('USDC');
  expect(text).not.toContain('Use 1 credit');
});

it('keeps the newly selected checkout after a previous checkout was paid', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const storage = new Map([['bagseven-checkout:/api:customer', 'cs_old']]);
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  const plan = { id: 'monthly', name: 'Monthly plan', feature: 'ocr', amount: '10', credits: '100', interval: 'month', ttl_seconds: 2592000, active: true, merchant_wallet: '0x' + '11'.repeat(20) };
  const checkout = (id: string) => ({ id, status: id === 'cs_old' ? 'PAID' : 'PENDING', amount: '10', holder: 'customer', expires_at: '2099-01-01', chain_id: 43113, payment: { chain_id: 43113, usdt: '0x' + '22'.repeat(20) }, plan: { ...plan, name: id === 'cs_old' ? 'Previous paid plan' : 'New monthly checkout' } });
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const data = options?.method === 'POST' ? { session: checkout('cs_new') }
      : url.includes('/public/checkout/') ? url.endsWith('/subscription') ? {} : { session: checkout(url.split('/').at(-1)!) }
      : url.includes('/plans?') ? { plans: [plan] }
      : url.endsWith('/subscriptions') ? { subscriptions: [] }
      : url.endsWith('/billing-documents') ? { email: 'buyer@example.com', documents: [] } : { entitlements: [] };
    return new Response(JSON.stringify(data));
  }));
  await act(async () => { renderer = create(createElement(BagsevenEmbed, { apiUrl: '/api', accessToken: 'token', holder: 'customer', initialView: 'customer' })); });
  const click = async (label: string) => { const button = renderer!.root.findAllByType('button').find(node => node.children.join('') === label); expect(button).toBeDefined(); await act(async () => { await button!.props.onClick(); }); };
  await click('Plans');
  await click('Choose plan');
  const text = JSON.stringify(renderer!.toJSON());
  expect(text).toContain('New monthly checkout');
  expect(text).not.toContain('Previous paid plan');
});
