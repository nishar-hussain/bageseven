# Bagseven on Avalanche

Paid service access and bounded agent spending on Avalanche C-Chain. Providers sell plans; customers approve stablecoin payments and recurring subscriptions with their wallet. The entitlement registry tracks credits and paid-through times. Applications use the SDK, and assistants use MCP.

Sign in with an email verification code, then link a wallet by signing an expiring ownership message. Returning users reconnect their saved wallet; replacing it is a separate email-code and signature flow. Email is used for receipts and recovery. Wallet signatures authorize financial actions. These credentials do not establish unique-person identity.

## Run

Use Node 24.x, pnpm, PostgreSQL and Redis. Configure `.env` from `.env.example` with real email delivery, shared secrets, token and verified registry before starting. For a new public Fuji installation, follow the wallet-approved deployment steps below first.

```bash
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm start:local
# Another terminal, with the intended worker configured:
pnpm mcp:local
```

Apply migrations through **0024**. `pnpm build` builds deployment artifacts; contract changes also require rebuilding their paired ABI/bytecode artifacts. Public-Fuji local mode uses real testnet contracts with localhost web services. It does not publish Railway or Vercel hosting.

Live entitlements require a deployed `BagEntitlementRegistry`, `ENTITLEMENT_STORE=avalanche`, `AVALANCHE_ENTITLEMENT_REGISTRY`, and a persistent `ENTITLEMENT_SUBJECT_SECRET`. Fuji uses chain 43113. Set the exact six-decimal payment token in `AVALANCHE_USDC`; no token address is guessed. Providers must sign a fresh gas authorization and fund the dedicated signer with AVAX. Production never falls back to a platform gas wallet.

For public Fuji registry deployment, use `pnpm fuji:registry import`, `plan`, then `deploy` in your own terminal. Foundry prompts for secrets locally and uses an encrypted keystore; never paste keys into chat. Then run `pnpm fuji:prepare`, `pnpm fuji:activate` for a read-only preflight, and `pnpm fuji:activate --apply` to use the verified registry on the existing product ports with a separate public-chain database. See [secure deployment and recovery](docs/HOSTING.md#secure-public-fuji-registry-deployment).

The active product uses public Fuji, with no seeded grants or development signing authority. Anvil is opt-in for isolated tests only. `pnpm setup` will not generate mock wallets by default or overwrite a public runtime with `--force`.

## Provider workflow

| Page | What it does |
| --- | --- |
| `/app` | Provider checkout cohorts, current subscription health and catalog activity. |
| `/app/plans` | One-time plans and explicitly authorized 30-day subscriptions. |
| `/app/builder` | Design and publish one customer embed for plans, wallets, checkout and access management. |
| `/app/customers` | Search checkout holders and inspect their billing history. |
| `/app/invoices` | Private issued invoices, own purchases, verified payment receipts and print/save PDF. |
| `/app/settings` | Network readiness, provider gas authorization and dedicated AVAX funding. |
| `/app/mandate` | Optional bounded authority for new agent payments; not required for prepaid consumption. |
| `/app/mcp` | Connect an assistant with HTTPS MCP and email-code plus wallet consent. |

Account sign-in uses email OTP; wallet linking requires an explicit ownership signature. Disconnecting preserves the binding and shows **Reconnect wallet**. A different wallet uses the explicit replacement flow, with a fresh inbox proof and new signature. Changing an account wallet does not migrate existing payouts, subscription payers or mandates.

Monthly billing uses `BagSubscriptionPlan`, payer-approved token allowance and subscribe/cancel transactions, with durable collection and fulfillment journals. Cancellation preserves paid time. Provider gas must explicitly cover subscriptions and have at least 31 days remaining at checkout.

Invoices snapshot checkout terms and each renewal separately. Verified payment creates receipt evidence independently of access fulfillment. Paid invoices and receipts are emailed to the authenticated customer through a durable delivery queue. Tax assessment is not included. A historical token or payment time that was never recorded stays unknown.

The browser coordinates wallet actions across screens and same-origin tabs. It does not queue or silently retry approvals. For an existing pending MetaMask request, review or dismiss it in the wallet, then acknowledge the reminder. An already-connected Fuji wallet does not need another account/network prompt.

## Verify

`pnpm test` builds libraries and runs regressions. `pnpm typecheck` checks the workspace. `node scripts/test-entitlement-registry.mjs` uses an isolated local EVM to verify registry credit accounting, retry safety, holds, expiry, and cancellation. Local tests do not prove public deployment readiness.

Read [product semantics](docs/PRODUCT.md), [developer integration](docs/DEVELOPERS.md), and [hosting](docs/HOSTING.md). The existing console is on port 3000, landing on 3001, daemon on 4001, policy on 4003, gateway on 4000, and MCP on 4009.

The public [documentation index](http://localhost:3001/docs/introduction) includes authentication, Builder, subscriptions, customer invoices, provider gas, SDK/API and x402 guides. Website documentation content lives in `apps/landing/lib/docs.ts`; root and website `llms.txt` copies must stay synchronized. The ReceiptBox integration is optional; see [developer integration](docs/DEVELOPERS.md) before running its state-changing demo checks.

Isolated x402 payments use a separately approved EIP-3009 signer, funded only through an agent's on-chain mandate. Manage it on the existing Spending page; use `bagseven_x402_payment` to reconcile uncertain payments. See [developer lifecycle and local verification](docs/DEVELOPERS.md#isolated-x402-payments) and [hosting requirements](docs/HOSTING.md). Apply migrations through 0024 and preserve the separate payment-custody key.

ChatGPT MCP consent reuses an existing verified console session with an explicit authorization button. Set `CONSOLE_URL` and a stable `BAGSEVEN_MCP_PUBLIC_URL` for hosting. Temporary tunnel changes require updating the ChatGPT connection; keep one current Bagseven app. See [session consent](docs/DEVELOPERS.md#mcp-console-session-consent).
