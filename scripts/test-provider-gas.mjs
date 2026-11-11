/* global process, Buffer, fetch, AbortSignal, console */
/** Local HTTP regression: isolated, unfunded accounts; no blockchain transaction is broadcast. */
import { createHmac, randomUUID } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createDb } from '@bagseven/db';
import { canonicalMandate } from '@bagseven/onchain';

if (process.env.NODE_ENV === 'production') throw new Error('Run this isolated regression against the local development services.');
const provider = `gas-e2e:${randomUUID()}`;
const owner = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const db = createDb({ connectionString: process.env.DATABASE_URL });
const results = [];
function proof() {
  const payload = Buffer.from(JSON.stringify({ provider, expires: Date.now() + 60000 })).toString('base64url');
  return `${payload}.${createHmac('sha256', process.env.PROVIDER_GAS_ENCRYPTION_KEY).update(`bagseven-provider-scope-v1:${payload}`).digest('base64url')}`;
}
async function request(path, { body, scoped = true, gateway = false } = {}) {
  const response = await fetch(`http://localhost:${gateway ? 4000 : 4001}${path}`, { method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${gateway ? process.env.GATEWAY_AUTH_TOKEN || process.env.POLICY_INTERNAL_TOKEN : process.env.DAEMON_AUTH_TOKEN}`,
      'x-bagseven-provider': provider, ...(scoped ? { 'x-bagseven-provider-scope': proof() } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: await response.json() };
}
function check(name, actual, expected) {
  if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
  results.push({ name, passed: true });
}
try {
  check('Service bearer alone cannot impersonate a provider', (await request('/internal/provider-gas', { scoped: false })).status, 403);
  check('Fresh provider has no gas account', (await request('/internal/provider-gas')).body.configured, false);
  const prepare = await request('/internal/provider-gas/prepare', { body: { owner: owner.address, avalancheBudget: '0.05', registryBudget: '0.05', avalancheTxLimit: '0.02', registryTxLimit: '0.01', expires: Date.now() + 3600000 } });
  check('Prepare account and reviewable limits', prepare.status, 200);
  const wrong = await other.signMessage({ message: prepare.body.message });
  check('Other wallet cannot authorize', (await request('/internal/provider-gas/authorize', { body: { signature: wrong } })).status, 403);
  const signature = await owner.signMessage({ message: prepare.body.message });
  check('Owner authorizes bounded signing', (await request('/internal/provider-gas/authorize', { body: { signature } })).status, 200);
  check('Authorization nonce cannot be replayed', (await request('/internal/provider-gas/authorize', { body: { signature } })).status, 409);
  const status = await request('/internal/provider-gas');
  check('Account remains unfunded on Avalanche', status.body.balances.avalanche, '0');
  check('Account remains unfunded on Registry', status.body.balances.registry, '0');
  check('Status never returns an encrypted or private signing key', JSON.stringify(status.body).includes('encryptedKey'), false);
  const plan = await request('/v1/plans', { body: { feature: 'ocr', name: 'Unfunded provider regression', amount: '0.01', credits: '1', ttl_seconds: 120, merchant_wallet: owner.address } });
  check('Provider can prepare a plan without charging gas', plan.status, 200);
  const checkout = await request('/v1/checkout-sessions', { body: { plan_id: plan.body.plan.id, holder: 'gas-test-customer' } });
  check('Checkout blocked before a customer pays an unfunded provider', checkout.body.error.code, 'PROVIDER_GAS_EMPTY');
  check('Revoke delegated signing', (await request('/internal/provider-gas/revoke', { body: {} })).status, 200);
  const terms = { owner_address: owner.address, operator_address: owner.address, budget_per_window: '1', window_seconds: 86400, lifetime_cap: '10', per_purchase_cap: '0.1', per_seller_pct: 10000, max_depth: 2, chain_id: 43113 };
  const message = canonicalMandate({ owner: owner.address.toLowerCase(), operator: owner.address.toLowerCase(), budgetPerWindow: '1', windowSeconds: 86400, lifetimeCap: '10', perPurchaseCap: '0.1', perSellerPct: 10000, maxDepth: 2, chainId: 43113 });
  const denied = await request('/v1/mandates', { gateway: true, body: { ...terms, signature: await owner.signMessage({ message }) } });
  check('Gateway preserves provider scope; revoked account cannot fall back to platform deployment', denied.body.error.code, 'PROVIDER_GAS_REQUIRED');
  console.log(JSON.stringify({ passed: results.length, checks: results, blockchainTransactionsBroadcast: 0 }, null, 2));
} finally {
  await db.$client.query('DELETE FROM billing_plans WHERE provider_id = $1', [provider]);
  await db.$client.query('DELETE FROM provider_gas_accounts WHERE provider_id = $1', [provider]);
  await db.$client.end();
}
