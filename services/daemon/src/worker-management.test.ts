import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { errorResponse } from '@bagseven/server';
import { decodeFunctionData, parseAbi } from 'viem';
import { registerWorkerManagement } from './worker-management.js';
const owner = '0x1111111111111111111111111111111111111111';
const contract = '0x2222222222222222222222222222222222222222';
const token = '0x3333333333333333333333333333333333333333';
const id = '11111111-1111-4111-8111-111111111111';
async function fixture() {
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => { const result = errorResponse(error); return reply.code(result.status).send(result.body); });
  const policy = vi.fn(async (_method: string, path: string, _body?: unknown) => path.includes('foreign') ? { mandate: { id: 'foreign', owner_address: contract }, agents: [] } : { mandate: { id, owner_address: owner, contract_address: contract }, token_address: token, agents: [{ id: 'root' }] });
  registerWorkerManagement(app, { config: { WHITECHAIN_USDT: token }, policy, resolve: async worker => ({ agent: { id: worker, operator_address: owner }, mandate: { id, owner_address: owner, contract_address: contract } }) });
  return { app, policy };
}
describe('MCP worker management scope and wallet approvals', () => {
  it('discovers the configured owner instead of accepting a caller-selected owner', async () => {
    const { app, policy } = await fixture();
    try { expect((await app.inject('/internal/workers/root/mandates?owner_address=attacker')).statusCode).toBe(200); expect(policy).toHaveBeenCalledWith('GET', `/v1/mandates?owner_address=${owner}`); } finally { await app.close(); }
  });
  it('rejects reading another owner’s mandate', async () => {
    const { app } = await fixture();
    try { expect((await app.inject('/internal/workers/root/mandate?mandate_id=foreign')).statusCode).toBe(403); } finally { await app.close(); }
  });
  it('returns an exact unsigned funding transfer and never sends it', async () => {
    const { app, policy } = await fixture();
    try {
      const res = await app.inject({ method: 'POST', url: '/internal/workers/root/mandate/funding', payload: { amount: '0.000001' } });
      expect(res.statusCode).toBe(200); const data = res.json(); expect(data.requires_wallet_approval).toBe(true); expect(data.transaction.to).toBe(token);
      const decoded = decodeFunctionData({ abi: parseAbi(['function transfer(address,uint256) returns(bool)']), data: data.transaction.data });
      expect(decoded.args).toEqual([contract, 1n]); expect(policy.mock.calls.every(call => call[0] === 'GET')).toBe(true);
    } finally { await app.close(); }
  });
  it('refuses deployment without an owner signature', async () => {
    const { app, policy } = await fixture();
    try { expect((await app.inject({ method: 'POST', url: '/internal/workers/root/mandates', payload: {} })).statusCode).toBe(400); expect(policy).not.toHaveBeenCalled(); } finally { await app.close(); }
  });
});
