import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { errorResponse, type ServiceDeps } from '@bagseven/server';
import type { MandateClient } from '@bagseven/onchain';
import { readMandateAvailability, readMandateSnapshot } from './mandate-state.js';
import { buildPolicyRoutes } from './routes.js';
import { decodeFunctionData, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { canonicalMandate } from '@bagseven/onchain';

const rpc = vi.hoisted(() => ({
  getCode: vi.fn(), isRevoked: vi.fn(), vaultBalance: vi.fn(), spendState: vi.fn(),
  lifetimeSpent: vi.fn(), token: vi.fn(), workerState: vi.fn(), fund: vi.fn(),
  deploy: vi.fn(),
}));
vi.mock('@bagseven/onchain', async (original) => ({
  ...await original<typeof import('@bagseven/onchain')>(),
  MandateClient: class {
    address: string;
    constructor(key: string) { this.address = key === 'funded-deployer' ? '0x3333333333333333333333333333333333333333' : '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'; }
    deploy = rpc.deploy;
    publicClient = { getCode: rpc.getCode }; isRevoked = rpc.isRevoked;
    vaultBalance = rpc.vaultBalance; spendState = rpc.spendState; lifetimeSpent = rpc.lifetimeSpent;
    token = rpc.token; workerState = rpc.workerState; fund = rpc.fund; },
}));

const missing = '0xbc0262141b15563be329022c10c7702ec9bb9842';
const deployed = '0xf3837d9e760640dcd5217135d104f19ccc6f69a2';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const client = { publicClient: { getCode: rpc.getCode }, ...rpc } as unknown as MandateClient;
const record = {
  id: 'ff247eb7-5a34-4ab6-a209-aab8ca6c025e', contractAddress: missing,
  ownerAddress: owner, operatorAddress: owner, status: 'active', budgetPerWindow: '1',
  lifetimeCap: '1', perPurchaseCap: '0.1', perSellerPct: 10000, windowSeconds: 3600, maxDepth: 2,
};
const agent = { id: '110c3d3f-a158-4b12-bf91-2da6666fc44a', mandateId: record.id,
  operatorAddress: owner, allocation: '1', depth: 0, sharePercent: '100', status: 'active' };
const apps: ReturnType<typeof Fastify>[] = [];
async function app(config: NodeJS.ProcessEnv = {}) {
  const server = Fastify();
  apps.push(server);
  server.setErrorHandler((error, _req, reply) => {
    const result = errorResponse(error);
    return reply.code(result.status).send(result.body);
  });
  buildPolicyRoutes(server, {
    config: { PROVIDER_FUNDED_GAS: 'false', DAEMON_EXECUTOR_KEY: 'configured', AVALANCHE_USDC: owner, ...config }, redis: {},
    db: { transaction: async (run: (tx: unknown) => Promise<void>) => run({ insert: () => ({ values: () => ({ returning: async () => [agent] }) }) }), query: {
      mandates: { findMany: async () => [record, { ...record, id: 'healthy', contractAddress: deployed }], findFirst: async () => record },
      agents: { findMany: async () => [agent], findFirst: async () => agent },
      refusals: { findMany: async () => [] },
    } },
  } as unknown as ServiceDeps);
  return server;
}
beforeEach(() => {
  vi.resetAllMocks();
  rpc.getCode.mockImplementation(async ({ address }) => address === missing ? undefined : '0x6000');
  rpc.isRevoked.mockResolvedValue(false);
  rpc.vaultBalance.mockResolvedValue(90000n);
  rpc.spendState.mockResolvedValue(10000n);
  rpc.lifetimeSpent.mockResolvedValue(10000n);
  rpc.token.mockResolvedValue(owner);
  rpc.workerState.mockResolvedValue([owner, owner, 100000n, 10000n, 0, true]);
  rpc.deploy.mockResolvedValue(deployed);
});
afterEach(async () => { await Promise.all(apps.splice(0).map((server) => server.close())); });

describe('mandate deployment availability', () => {
  it.each([undefined, '0x'])('does not call revoked on absent bytecode (%s)', async (code) => {
    rpc.getCode.mockResolvedValue(code);
    expect(await readMandateAvailability(client, missing)).toMatchObject({ chain: { status: 'unavailable', code: 'NO_CONTRACT' }, revoked: null });
    expect(rpc.isRevoked).not.toHaveBeenCalled();
  });
  it('handles undeployed records and RPC failures without inventing revocation state', async () => {
    expect(await readMandateAvailability(client, null)).toMatchObject({ revoked: null, chain: { code: 'NO_CONTRACT' } });
    rpc.getCode.mockRejectedValue(new Error('RPC offline'));
    expect(await readMandateAvailability(client, deployed)).toMatchObject({ revoked: null, chain: { code: 'RPC_UNAVAILABLE' } });
  });
  it('handles incompatible deployments', async () => {
    rpc.isRevoked.mockRejectedValue(new Error('revoked returned no data'));
    expect(await readMandateSnapshot(client, deployed)).toMatchObject({ revoked: null, vault: 0n, chain: { status: 'unavailable' } });
  });
  it('preserves a healthy revoked flag and actual balances', async () => {
    rpc.isRevoked.mockResolvedValue(true);
    expect(await readMandateSnapshot(client, deployed)).toMatchObject({ chain: { status: 'available' }, revoked: true, vault: 90000n, windowSpent: 10000n });
  });
  it('discards partial balance reads when a state call fails', async () => {
    rpc.lifetimeSpent.mockRejectedValue(new Error('read failed'));
    expect(await readMandateSnapshot(client, deployed)).toMatchObject({ chain: { status: 'unavailable' }, revoked: null, vault: 0n, windowSpent: 0n, lifetimeSpent: 0n });
  });
});

describe('mandate API recovery', () => {
  async function signedCreation() {
    const signer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
    const payload = { owner_address: signer.address, operator_address: owner, budget_per_window: '1', window_seconds: 86400,
      lifetime_cap: '10', per_purchase_cap: '0.1', per_seller_pct: 10000, max_depth: 2, chain_id: 43113 };
    const message = canonicalMandate({ owner: signer.address.toLowerCase() as `0x${string}`, operator: owner,
      budgetPerWindow: '1', windowSeconds: 86400, lifetimeCap: '10', perPurchaseCap: '0.1', perSellerPct: 10000, maxDepth: 2, chainId: 43113 });
    return { ...payload, signature: await signer.signMessage({ message }) };
  }
  it('creates a signed permission with a separate gas payer while retaining the executor as enforcer', async () => {
    const response = await (await app({ MANDATE_DEPLOYER_KEY: 'funded-deployer' })).inject({ method: 'POST', url: '/v1/mandates', payload: await signedCreation() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ contract_address: deployed, status: 'active' });
    expect(rpc.deploy).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ enforcer: owner }));
  });
  it('returns a clear gas funding error instead of 500 when the deployer lacks AVAX', async () => {
    rpc.deploy.mockRejectedValue(new Error('The total cost (gas * gas fee + value) exceeds the balance of the account. Insufficient funds.'));
    const response = await (await app()).inject({ method: 'POST', url: '/v1/mandates', payload: await signedCreation() });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({ code: 'DEPLOYER_GAS_INSUFFICIENT', message: expect.stringContaining('needs more AVAX') });
  });
  it('does not automatically retry uncertain deployment failures', async () => {
    rpc.deploy.mockRejectedValue(new Error('receipt timed out'));
    const response = await (await app()).inject({ method: 'POST', url: '/v1/mandates', payload: await signedCreation() });
    expect(response.statusCode).toBe(502); expect(response.json().error.code).toBe('MANDATE_DEPLOYMENT_FAILED');
    expect(rpc.deploy).toHaveBeenCalledOnce();
  });
  it('prepares a canonical owner signature before creation without calling the chain', async () => {
    const response = await (await app()).inject({ method: 'POST', url: '/v1/mandates/prepare', payload: {
      owner_address: owner, operator_address: owner, budget_per_window: '1', window_seconds: 86400,
      lifetime_cap: '10', per_purchase_cap: '0.1', per_seller_pct: 10000, max_depth: 2, chain_id: 43113,
    } });
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toBe(`bagseven-mandate-v1|${owner}|${owner}|1|86400|10|0.1|10000|2|43113`);
    expect(rpc.getCode).not.toHaveBeenCalled();
  });
  it('prepares exact owner-wallet funding, withdrawal, and revocation calls without submitting transactions', async () => {
    rpc.getCode.mockResolvedValue('0x6000');
    const server = await app();
    const abi = parseAbi(['function transfer(address,uint256) returns(bool)', 'function withdraw(uint256,address)', 'function revoke()']);
    for (const [action, name, args] of [
      ['fund', 'transfer', [missing, 10000n]], ['withdraw', 'withdraw', [10000n, owner]], ['revoke', 'revoke', undefined],
    ] as const) {
      const response = await server.inject({ method: 'POST', url: `/v1/mandates/${record.id}/transaction`, payload: { action, amount: '0.01' } });
      expect(response.statusCode).toBe(200);
      const draft = response.json();
      expect(draft).toMatchObject({ chain_id: 43113, from: owner, to: action === 'fund' ? owner : missing, value: '0x0' });
      const decoded = decodeFunctionData({ abi, data: draft.data });
      expect(decoded.functionName).toBe(name); expect(decoded.args?.map(a => typeof a === 'string' ? a.toLowerCase() : a)).toEqual(args);
    }
    expect(rpc.fund).not.toHaveBeenCalled();
  });
  it('rejects transaction drafts for missing contracts, zero amounts, insufficient funds and revoked funding', async () => {
    const server = await app();
    const draft = (action: string, amount: string) => server.inject({ method: 'POST', url: `/v1/mandates/${record.id}/transaction`, payload: { action, amount } });
    expect((await draft('fund', '0.01')).statusCode).toBe(409);
    rpc.getCode.mockResolvedValue('0x6000');
    expect((await draft('fund', '0')).statusCode).toBe(400);
    expect((await draft('withdraw', '1')).statusCode).toBe(409);
    rpc.isRevoked.mockResolvedValue(true);
    expect((await draft('fund', '0.01')).statusCode).toBe(409);
    // Revocation cannot trap the remaining owner funds.
    expect((await draft('withdraw', '0.01')).statusCode).toBe(200);
  });
  it('lists valid and missing deployments together without failing the page', async () => {
    const response = await (await app()).inject(`/v1/mandates?scope=owner&owner_address=${owner}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().mandates).toMatchObject([
      { status: 'unavailable', record_status: 'active', onchain_state: { code: 'NO_CONTRACT' } },
      { status: 'active', onchain_state: { status: 'available' } },
    ]);
  });
  it('keeps detail and signed terms readable with zero drawable capacity', async () => {
    const server = await app();
    const detail = await server.inject(`/v1/mandates/${record.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ mandate: { status: 'unavailable' }, onchain_revoked: null });
    const overview = await server.inject(`/v1/mandates/${record.id}/overview`);
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ can_be_drawn_now: '0.00', terms: { signed: true }, onchain_state: { code: 'NO_CONTRACT' } });
  });
  it('blocks agent spending when its mandate deployment is missing', async () => {
    const response = await (await app()).inject(`/v1/resolve?ref=${agent.id}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ agent: { onchain_active: false }, remaining: { can_draw: '0' }, mandate: { status: 'unavailable' } });
    expect(rpc.workerState).not.toHaveBeenCalled();
  });
  it('rejects funding before sending any transaction to a missing deployment', async () => {
    const response = await (await app()).inject({ method: 'POST', url: `/v1/vaults/${record.id}/fund`, payload: { amount: '0.01' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('MANDATE_UNAVAILABLE');
    expect(rpc.fund).not.toHaveBeenCalled();
  });
  it('keeps healthy agents spendable and fails closed if their registration cannot be read', async () => {
    rpc.getCode.mockResolvedValue('0x6000');
    const server = await app();
    const healthy = await server.inject(`/v1/resolve?ref=${agent.id}`);
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json()).toMatchObject({ mandate: { status: 'active' }, remaining: { can_draw: '0.09' } });
    rpc.workerState.mockRejectedValue(new Error('RPC worker read failed'));
    const failed = await server.inject(`/v1/resolve?ref=${agent.id}`);
    expect(failed.statusCode).toBe(200);
    expect(failed.json()).toMatchObject({ mandate: { status: 'unavailable' }, remaining: { can_draw: '0' } });
  });
});
