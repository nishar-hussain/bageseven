/** Explicit local demo setup. Reloading the app never refills exhausted credits. */
import { FEATURES, HOLDER, internal } from "../demo-config.mjs";
import { createDb } from "@bagseven/db";
import { AvalancheGrantStore, configureProviderGrantSigners } from "@bagseven/entitlements";
import { ProviderGasManager } from "@bagseven/onchain";

const rpcUrl = process.env.AVALANCHE_RPC_URL || process.env.RPC_URL;
let localRpc = false;
try { localRpc = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(rpcUrl).hostname); } catch { /* Report field names only. */ }
if (process.env.ENTITLEMENT_STORE !== "avalanche" || process.env.DEV_MODE !== "true" || process.env.NODE_ENV === "production" || !process.env.DEMO_PROVIDER_ID || !localRpc) {
  throw new Error(
    "Demo seed requires explicit development mode, a local Avalanche registry, and DEMO_PROVIDER_ID",
  );
}
const version = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'web3_clientVersion', params: [] }) }).then(r => r.json());
if (!/anvil/i.test(version.result ?? '')) throw new Error('Demo seed requires local Anvil; public networks are refused');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Demo seed requires local PostgreSQL');
const db = createDb({ connectionString: process.env.DATABASE_URL });
try {
const gas = new ProviderGasManager(db, process.env);
const provider = process.env.DEMO_PROVIDER_ID;
const permission = await gas.status(provider);
if (!permission.configured || permission.owner.toLowerCase() !== '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266') throw new Error('Demo seed requires the known Anvil fixture provider; real wallet permissions are refused');
configureProviderGrantSigners(id => gas.account(id, 'registry'));
const store = new AvalancheGrantStore(db, process.env);
const features = (await internal("GET", "/internal/features")).features;
const grants = (
  await internal(
    "GET",
    `/internal/grants/live?holder=${encodeURIComponent(HOLDER)}`,
  )
).grants;
for (const feature of FEATURES) {
  if (!features.some((f) => f.id === feature.id)) {
    await internal("POST", "/internal/features", {
      id: feature.id,
      label: feature.label,
      value_type: feature.boolean ? "boolean" : "numeric",
    });
  }
  if (
    grants.some(
      (g) =>
        g.feature === feature.id && g.merchant === process.env.DEMO_PROVIDER_ID,
    )
  ) {
    console.log(`KEEP ${feature.label}: existing provider grant`);
    continue;
  }
  await store.mint({
    merchant: provider,
    feature: feature.id,
    holder: HOLDER,
    remaining: feature.credits,
    ttl_seconds: 86400,
    settlement_network: "avalanche",
    worker_id: process.env.BAGSEVEN_MCP_WORKER,
    renewal_enabled: false,
  });
  console.log(
    `READY ${feature.label}: ${feature.credits} (seeded demo access; no customer payment)`,
  );
}
} finally { await db.$client.end(); }
