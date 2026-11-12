# Bagseven on Avalanche

Paid service access and bounded agent spending on Avalanche C-Chain. Providers sell plans; customers approve stablecoin payments and recurring subscriptions with their wallet. The entitlement registry tracks credits and paid-through times. Applications use the SDK, and assistants use MCP.

Sign in with verified email, then link a wallet by signing an expiring ownership message. Email is used for receipts and recovery. Wallet signatures authorize financial actions. These credentials do not establish unique-person identity.

## Run

Use Node 24, pnpm, PostgreSQL and Redis. Install with `pnpm install`, configure `.env` from `.env.example`, apply `pnpm db:migrate`, and build with `pnpm build`. Start existing services with `pnpm start:local`; start MCP with `pnpm mcp:local`.

Live entitlements require a deployed `BagEntitlementRegistry`, `ENTITLEMENT_STORE=avalanche`, `AVALANCHE_ENTITLEMENT_REGISTRY`, and a persistent `ENTITLEMENT_SUBJECT_SECRET`. Fuji uses chain 43113. Set the exact six-decimal payment token in `AVALANCHE_USDC`; no token address is guessed. Providers must sign a fresh gas authorization and fund the dedicated signer with AVAX. Production never falls back to a platform gas wallet.

For public Fuji registry deployment, use `pnpm fuji:registry import`, `plan`, then `deploy` in your own terminal. Foundry prompts for secrets locally and uses an encrypted keystore; never paste keys into chat. See [secure deployment and recovery](docs/HOSTING.md#secure-public-fuji-registry-deployment).

## Verify

`pnpm test` builds libraries and runs regressions. `pnpm typecheck` checks the workspace. `node scripts/test-entitlement-registry.mjs` uses an isolated local EVM to verify registry credit accounting, retry safety, holds, expiry, and cancellation. Local tests do not prove public deployment readiness.

Read [product semantics](docs/PRODUCT.md), [developer integration](docs/DEVELOPERS.md), and [hosting](docs/HOSTING.md). The existing console is on port 3000, landing on 3001, daemon on 4001, policy on 4003, gateway on 4000, and MCP on 4009.

Isolated x402 payments use a separately approved EIP-3009 signer, funded only through an agent's on-chain mandate. Manage it on the existing Spending page; use `bagseven_x402_payment` to reconcile uncertain payments. See [developer lifecycle and local verification](docs/DEVELOPERS.md#isolated-x402-payments) and [hosting requirements](docs/HOSTING.md). Apply migrations through 0020 and preserve the separate payment-custody key.
