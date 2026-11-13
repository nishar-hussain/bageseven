import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as overview } from '../app/api/overview/route';
import { GET as checkouts } from '../app/api/provider-checkouts/route';
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  sessionIsValid: vi.fn(),
  sessionHolder: () => 'signed-in-provider',
}));
const reporting = vi.hoisted(() => ({ providerOverview: vi.fn(), providerCheckouts: vi.fn() }));
const database = vi.hoisted(() => ({ pool: 'test' }));
vi.mock('../lib/auth', () => auth);
vi.mock('../lib/provider-overview', () => reporting);
vi.mock('../lib/account-profiles', () => ({ consoleDatabase: () => database }));
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ email: 'provider' });
  auth.sessionIsValid.mockReturnValue(true);
  reporting.providerOverview.mockResolvedValue({ metrics: { paid: 2 } });
  reporting.providerCheckouts.mockResolvedValue({ total: 0, sessions: [] });
});
describe('provider reporting BFF', () => {
  it('requires a valid session before any billing query', async () => {
    auth.sessionIsValid.mockReturnValue(false);
    expect((await overview(new Request('http://localhost/api/overview'))).status).toBe(401);
    expect((await checkouts(new Request('http://localhost/api/provider-checkouts'))).status).toBe(401);
    expect(reporting.providerOverview).not.toHaveBeenCalled();
    expect(reporting.providerCheckouts).not.toHaveBeenCalled();
  });
  it('ignores requested provider/holder and scopes the report to the signed-in identity', async () => {
    const res = await overview(
      new Request('http://localhost/api/overview?provider=foreign&holder=another&days=7'),
    );
    expect(reporting.providerOverview).toHaveBeenCalledWith(database, 'signed-in-provider', 7);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
  it('bounds reporting ranges and checkout pagination before querying', async () => {
    for (const days of ['0', '100000', 'NaN'])
      expect((await overview(new Request(`http://localhost/api/overview?days=${days}`))).status).toBe(400);
    for (const query of ['page=-1', 'page=501', 'page=1.5', 'status=UNKNOWN', 'days=10000'])
      expect((await checkouts(new Request(`http://localhost/api/provider-checkouts?${query}`))).status).toBe(
        400,
      );
    expect(reporting.providerOverview).not.toHaveBeenCalled();
    expect(reporting.providerCheckouts).not.toHaveBeenCalled();
  });
  it('uses server identity for filtered checkout pages', async () => {
    await checkouts(
      new Request('http://localhost/api/provider-checkouts?provider=foreign&status=PAID&page=2'),
    );
    expect(reporting.providerCheckouts).toHaveBeenCalledWith(database, 'signed-in-provider', 'PAID', 2, 0);
  });
  it('reports unavailability without leaking SQL errors or inventing zero balances', async () => {
    reporting.providerOverview.mockRejectedValue(new Error('private SQL details'));
    const res = await overview(new Request('http://localhost/api/overview'));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('private SQL');
  });
});
