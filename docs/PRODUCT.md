# Bagseven — what this product is

One sentence: **humans mint entitlements (World + Whitechain + Arkiv); humans and agents both `checkEntitlement`; agents spend only under a dual-gate.**

**Entitlement (Schematic-style):** the right to use a **feature** with a limit (credits) and expiry — not the feature name itself.

Canonical catalog (`packages/entitlements/src/features.ts`):

| Feature | Meters |
| --- | --- |
| `ocr` | `paid_run` (demo) |
| `research_fetch` | `bagseven_fetch` + `paid_run` |

OCR is a **demo SKU**, not the product. The product is the SDK + the living Arkiv grant.

## Surfaces (what to open)

| URL | Role |
| --- | --- |
| http://localhost:3001 | Marketing landing |
| http://localhost:3000/app | Operator dashboard (magic-link) |
| http://localhost:3000/app/sdk | Human SDK playground + embed snippet |
| http://localhost:3000/embed?token= | Token-gated entitlement portal (iframe) |
| daemon `:4001` | Policy + entitlements API |
| MCP (`pnpm mcp:local`) | What Cursor / Claude / external agents attach to |

## SDK (the core)

```
npm install @bagseven/sdk
```

- `@bagseven/sdk/react` — `BagsevenProvider`, `useFlag`, `useEntitlement`, `useConsumeEntitlement`, `FeatureFlagGuard`, `BagsevenEmbed`
- `@bagseven/sdk/node` — `BagsevenClient.checkFlag / checkEntitlement / consumeEntitlement / identify`
- `@bagseven/sdk/agent` — same verbs for programmatic agents

React is UI gating. Authoritative checks always go through Node / daemon. Agents never hold World credentials.

## Prepaid access and agent spending

`paid_run`, `consume_entitlement`, and SDK `/v1/usage/consume` use already-paid credits. Both humans and agents need an active entitlement, enough credits, and valid holder/worker scope. They do not require a USDT mandate or send another payment. Cancelling renewal leaves access valid until `paid_through`.

New payments through `bagseven_fetch` require an active registered agent, sufficient on-chain mandate capacity, and a living grant for the payment feature. Mandates limit USDT spending per purchase, window, lifetime, provider, and delegated worker.

Manage these at `/app/mandate` (**Agent spending**):

- Create: connect an allowed owner wallet, review fixed limits, sign the canonical permission. The backend verifies the signature and deploys the contract with a root agent. Deployment gas is paid in WBT by `MANDATE_DEPLOYER_KEY` when configured, falling back to the executor key. A separate deployment signer does not change the contract enforcer or owner. Insufficient gas returns `DEPLOYER_GAS_INSUFFICIENT`; successful creation selects the new permission in the dashboard.
- Fund: approve a USDT transfer from the owner wallet into the deployed vault.
- Delegate: select a parent and sign a narrower child allocation.
- Withdraw: return unused USDT to the owner wallet.
- Revoke: permanently block future spending; withdrawals remain available.

Funding, withdrawal, and revocation are transaction drafts sent only by the connected wallet. Agent spending uses the active RainbowKit/wagmi connector, including WalletConnect. A signed-in account can add its connected wallet to spending scope by signing a five-minute ownership challenge. The server verifies the signature and issues an HttpOnly ownership cookie bound to that account and website for eight hours. An optional, unverified profile wallet is not sufficient. Existing local operator wallets remain available; managing an existing permission still requires its actual owner. Creating a root agent does not automatically rebind the running MCP instance; configure its worker to the intended root or child. Missing deployments stay visible with spending disabled.

## Auth: World vs MCP vs SDK (three doors)

```
Human (dashboard)
  magic link → mint / buy_credits
                 └─ World verifies uniqueness
                 └─ Whitechain stamps payment_tx
                 └─ Arkiv stores living grant

Human (your app)
  pk_ + embed token → useFlag / BagsevenEmbed

Agent (Cursor / Claude)
  MCP process with BAGSEVEN_MCP_WORKER
                 └─ NEVER holds World ID credentials
                 └─ check_entitlement / consume_entitlement / paid_run
                 └─ Daemon checks prepaid access; new payments also require a spending permission
```

## Live tracks

| Track | Env | Meaning |
| --- | --- | --- |
| World | `WORLD_CLIENT_ID` (+ optional `id_token`) | Unique human at mint |
| Whitechain | `WHITECHAIN_PRIVATE_KEY` + `WHITECHAIN_PAY_TO` | USDT / native stamp → explorer `payment_tx` |
| Arkiv | `ARKIV_ACCESS_KEY` + `ARKIV_PRIVATE_KEY` | Grants stored on Rabdi, not memory |

## Thin billing (Plans + Checkout Sessions)

Merchants define a **Plan** (feature + USDT + credits). `createCheckoutSession` opens a session; Embed/`/checkout` collects a Whitechain payment (WhiteWallet-ready); confirm mints the living grant. Same `checkEntitlement` surface.

## Intentionally not a feature

- Payment-link product line, products catalog, invoices
- Charts on Overview are illustrative until usage telemetry ships
- Agents do not see the Fianto dashboard — they only see MCP tools

## Win angle

> “We don’t give agents wallets. Humans approve mint once under World. Settlement is Whitechain. Access lives on Arkiv until TTL. Humans check via SDK. Agents consume via MCP — and new payments also check spending permissions.”

Demo (daemon running): `pnpm sdk:demo` — human `checkEntitlement` → agent consume → living grant evaporates.
