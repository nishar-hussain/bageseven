import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as customers } from '../app/api/customers/route';
import { GET as invoices } from '../app/api/billing-documents/route';
const auth = vi.hoisted(() => ({ getSession: vi.fn(), sessionIsValid: vi.fn(), sessionHolder: () => 'authenticated-identity' }));
const billing = vi.hoisted(() => ({ customerDirectory: vi.fn(), documentList: vi.fn(), billingDocument: vi.fn() }));
const db = vi.hoisted(() => ({}));
vi.mock('../lib/auth', () => auth);
vi.mock('../lib/account-profiles', () => ({ consoleDatabase: () => db }));
vi.mock('../lib/provider-billing', () => billing);
beforeEach(() => {
  vi.clearAllMocks(); auth.getSession.mockResolvedValue({ email: 'owner' }); auth.sessionIsValid.mockReturnValue(true);
  billing.customerDirectory.mockResolvedValue({ total: 0, customers: [] });
  billing.documentList.mockResolvedValue({ total: 0, documents: [] });
  billing.billingDocument.mockResolvedValue(null);
});
const request = (query = '') => new Request('http://localhost/api/billing-documents?' + query);
describe('private customer billing routes', () => {
  it('requires a valid authenticated session before reading customer or invoice data', async () => {
    auth.sessionIsValid.mockReturnValue(false);
    expect((await customers(request())).status).toBe(401);
    expect((await invoices(request())).status).toBe(401);
    expect(billing.customerDirectory).not.toHaveBeenCalled();
    expect(billing.documentList).not.toHaveBeenCalled();
  });
  it('ignores a forged provider and scopes both ownership views to the signed-in identity', async () => {
    await customers(request('provider=foreign&search=buyer&page=2'));
    expect(billing.customerDirectory).toHaveBeenCalledWith(db, 'authenticated-identity', 'buyer', 2);
    await invoices(request('provider=foreign&view=issued&customer=buyer'));
    expect(billing.documentList).toHaveBeenCalledWith(db, 'authenticated-identity', 'issued', 'ALL', 'buyer', 0);
    const res = await invoices(request('holder=foreign&view=purchases'));
    expect(billing.documentList).toHaveBeenLastCalledWith(db, 'authenticated-identity', 'purchases', 'ALL', '', 0);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('returns an indistinguishable not-found result for an inaccessible document', async () => {
    const id = 'inv_' + 'a'.repeat(32);
    expect((await invoices(request('id=' + id))).status).toBe(404);
    expect(billing.billingDocument).toHaveBeenCalledWith(db, 'authenticated-identity', id);
  });
  it('rejects unbounded pages, unexpected statuses/views and invalid identifiers before querying', async () => {
    for (const q of ['page=501', 'page=-1', 'page=0.5', 'page=NaN', 'view=all', 'status=wat', 'id=../private', 'customer=' + 'x'.repeat(321)])
      expect((await invoices(request(q))).status).toBe(400);
    expect((await customers(request('search=' + 'x'.repeat(101)))).status).toBe(400);
    expect(billing.documentList).not.toHaveBeenCalled();
    expect(billing.billingDocument).not.toHaveBeenCalled();
  });
  it('does not leak SQL or private connection details on failure', async () => {
    billing.documentList.mockRejectedValue(Error('password and private SQL'));
    const res = await invoices(request());
    expect(res.status).toBe(503); expect(await res.text()).not.toContain('private SQL');
  });
});
