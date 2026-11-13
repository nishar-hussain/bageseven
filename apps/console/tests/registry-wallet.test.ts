import { expect, it, vi } from 'vitest';
import { submitRegistryDeployment } from '../lib/registry-wallet';
const draft = { chain_id: 43113, genesis_hash: 'public-genesis', rpc_url: 'https://fuji.example.com',
  transaction: { from: '0x' + '11'.repeat(20), data: '0x1234', value: '0x0' } };
const hash = '0x' + 'ab'.repeat(32);
it('opens only the deployment approval when already on public Fuji', async () => {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return '0xa869';
    if (method === 'eth_getBlockByNumber') return { hash: draft.genesis_hash };
    if (method === 'eth_sendTransaction') return hash;
    throw { code: -32002 };
  });
  expect(await submitRegistryDeployment({ request }, draft)).toBe(hash);
  expect(request.mock.calls.map(([input]) => input.method)).toEqual(['eth_chainId', 'eth_chainId', 'eth_getBlockByNumber', 'eth_sendTransaction']);
});
it('does not send a deployment when a needed network switch is pending', async () => {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return '0x1';
    throw { code: -32002 };
  });
  await expect(submitRegistryDeployment({ request }, draft)).rejects.toEqual({ code: -32002 });
  expect(request.mock.calls.map(([input]) => input.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
});
it('rejects a different RPC genesis even when its chain id matches Fuji', async () => {
  const request = vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0xa869' : { hash: 'local-genesis' });
  await expect(submitRegistryDeployment({ request }, draft)).rejects.toThrow('not public Fuji');
  expect(request.mock.calls.some(([input]) => input.method === 'eth_sendTransaction')).toBe(false);
});
