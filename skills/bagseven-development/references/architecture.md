# Architecture and verification

## Code ownership

| Concern | Repository path |
| --- | --- |
| Console World/session login | `apps/console/app/api/auth/`, `apps/console/lib/auth.ts`, `session-crypto.ts` |
| BFF auth and scope | `apps/console/app/api/daemon/[...path]/route.ts`, policy/public routes, `lib/daemon-bff.ts` |
| Connected spending wallet | `apps/console/lib/spending-wallet.ts`, wallet verification route, `SpendingControls.tsx` |
| Grant mint/consume/denial | `services/daemon/src/grants.ts` |
| Public SDK API/key scopes | `services/daemon/src/public-entitlements.ts`, `api-keys.ts` |
| Plans, checkout, provider fees | `services/daemon/src/billing.ts`, `billing-store.ts` |
| Whitechain receipts and replay | `whitechain-payment.ts`, `whitechain-settle.ts`, `payment-ledger.ts` in daemon |
| New payment executor and x402 | `services/daemon/src/index.ts`, `x402.ts`, `x402-payer.ts`, request ledger |
| Agent/mandate discovery | `services/daemon/src/worker-management.ts` |
| Gateway authentication/proxy | `services/gateway/src/index.ts` |
| Spend permissions and chain reads | `services/policy/src/routes.ts`, `mandate-state.ts`, `usdt-units.ts` |
| Shared HTTP service/CORS | `packages/server/src/` |
| Arkiv and memory grants | `packages/entitlements/src/` |
| Onchain client, ABI/bytecode | `packages/onchain/src/` |
| World verification/OIDC | `packages/world/src/` |
| Email | `packages/notify/src/` |
| MCP/OAuth/tool schemas | `scripts/bagseven-mcp.ts`, `mcp-oauth-as.ts`, `mcp-management-tools.ts` |

Paths are relative to a Bagseven checkout, not to the installed skill folder. If source is unavailable, do not invent routes or capabilities; use advertised MCP schemas and the operator's documented API.

## Invariants to preserve

- World OIDC uses PKCE and server-held verifier; IDKit RP credentials and Agent Pass OIDC credentials are distinct. Do not disable JWKS or synthesize World proofs in production.
- Policy has no browser session. The authenticated BFF binds actor/holder/owner scope before forwarding. Never trust internet-supplied actor headers without the service authentication boundary.
- New payments fail closed when the chain, contract, grant or mandate cannot be verified. Preserve revoked/unavailable states rather than treating them as an empty successful read.
- Owner-signed prepare/create/delegate messages bind terms, chain and freshness. Funding/withdrawal/revoke transaction drafts require the owner's connected wallet approval.
- Receipt verification binds transaction, network, token, amount, buyer and merchant. Preserve replay protection and idempotency when altering checkout or x402 flows.
- Local development can use memory grants and Anvil. Live access uses Arkiv; a public RPC URL by itself is not a configured grant store.
- The feature registry is persisted on disk. MCP OAuth/session maps and some Arkiv hold state are process-local; additional replicas require a deliberate persistence/concurrency design.

## Focused checks

Use grant/prepaid tests for access-only changes, payment/ledger tests for transfers, policy mandate-state tests for onchain availability, API-key/billing tests for provider scope, spending-wallet/BFF tests for wallet ownership, and MCP OAuth tests for consent/token behavior. Inspect actual tests rather than relying on an outdated list of filenames.

For a whole-platform change, run the root test suite and affected builds. Do not count a `--passWithNoTests` exit as proof of behavior. Keep generated onchain ABI/bytecode paired with the contract source; they are runtime assets, not disposable build debris.
