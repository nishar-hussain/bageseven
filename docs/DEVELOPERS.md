# Developer guide

Bagseven is a product, not a demo harness. Humans mint access. Humans and agents `checkEntitlement`. Agents spend under a mandate. Access lives on Arkiv until `paid_through`. Money settles on Whitechain. Unique humans via World. The dashboard is a Fianto-shaped operator app; the SDK + MCP are the product surfaces.

If you are an LLM, also read [`../llms.txt`](../llms.txt), [`../AGENTS.md`](../AGENTS.md), and [`LIVE.md`](./LIVE.md) for the go-live credential checklist.

## Mental model

Three clocks, all independent:

| Clock | Question | Source of truth |
| --- | --- | --- |
| Payment | Did money move? | Whitechain `payment_tx` |
| Renewal | Will we collect again? | `renewal_enabled` on the grant |
| Access | Can they use the feature *now*? | Living Arkiv grant (`remaining` + `paid_through`) |

**Access vs payment:** `paid_run` and SDK consume use prepaid grants without a USDT mandate. New payments (`bagseven_fetch`) need mandate remaining **and** a living grant. Fail closed on payment checks.

The daemon uses `BAGSEVEN_MCP_WORKER` as the default worker for dashboard mint and credit purchases, storing the binding on the grant. Paid runs use an explicit `worker_id`, then the grant's saved worker, then this server default for older unbound grants. Prepaid runs check grant scope and available credits without mandate capacity; new payments through bagseven_fetch still require a registered worker and mandate. Set this variable on the daemon as well as the MCP process.

The LLM never authorizes money. Policy issues a spend token; daemon executes. See [DECISIONS.md](./DECISIONS.md).

## Repo map

```
apps/landing     marketing  :3001
apps/console     dashboard  :3000  /app  (magic-link auth, BFF)
services/gateway public API :4000
services/daemon  dual-gate, grants, World, Whitechain :4001
services/policy  budgets / spend tokens :4003
packages/sdk           React + Node + agent entitlement SDK
packages/entitlements  Arkiv + memory store
packages/world         Agent Pass verify
packages/notify        Resend (from bags@cesthq.com)
```

Do not add a third UI.

## Local

```bash
pnpm run setup
pnpm start:local   # same as pnpm dev
pnpm status:local  # show the five service ports
pnpm stop:local    # stop this checkout's services; keep data containers
```

Requires Node 24+, pnpm 10.33.0, and a running Docker engine. Setup installs locked dependencies, creates local secrets, starts isolated Postgres (`55432`), Redis (`56379`), and Anvil (`58545`), builds the workspace, and applies migrations. It preserves an existing `.env`; use `--force` only to replace it.

Anvil uses chain ID `1874` to exercise the Whitechain mandate contract path with local tokens. Setup deploys a local USDC faucet, funds a mandate, and writes its worker UUID to `BAGSEVEN_MCP_WORKER`. Reruns reuse the worker; chain state persists in a Docker volume. This is a local chain impersonating Whitechain Testnet, not the public Whitechain RPC. An existing environment needs `RPC_URL=http://localhost:58545` and `CHAIN_ID=1874` to opt into local seeding; custom RPC configurations are preserved. Recreate the Anvil volume if it was previously chain `43113`.

| URL | Surface |
| --- | --- |
| http://localhost:3001 | Landing |
| http://localhost:3000/app | Dashboard |
| http://localhost:3000/app/sdk | SDK playground (Provider + Guard + Embed) |
| http://localhost:3000/embed?token= | Token-gated entitlement portal |
| http://localhost:4000 | Gateway |
| http://localhost:4001 | Daemon |
| http://localhost:4003 | Policy |

Sign in with **any email**. Resend sends the link from `bags@cesthq.com`. Without `RESEND_API_KEY`, the login page prints the link.

`pnpm start` also starts the local stack. Starting again shuts down the previous launcher and its process tree, waits for the ports to close, builds shared libraries, then launches the five services. macOS/Linux ownership checks leave processes from another checkout running and report the conflicting port. Ctrl+C and `pnpm stop:local` shut down owned children. Remove a stale local stack lock only after verifying its recorded process is no longer running; ordinary restarts handle stale locks automatically.

Local startup uses `GATEWAY_PORT`, `DAEMON_PORT` and `POLICY_PORT` separately; a generic inherited `PORT` is ignored for the multi-service launcher. Railway's individual services still honor `PORT`. The local launcher uses the installed pnpm executable through the normal PATH, without generating a Corepack shim.

## Auth

- **World is primary** (`POST /api/auth/world`). Mock World works locally when `WORLD_MOCK_PROOFS=true`.
- Session cookie `bagseven_session` (HMAC, 8h) carries `world_human_id` and optional `email` / `email_verified_at`.
- **Email verify-later:** Account → OTP (`/api/auth/email/start` + `/verify`). Unverified email is fine for using the app; receipts/recovery want verification.
- Magic link is **recovery / invite only**, not the login hero.
- Optional invite-only when email is used: `AUTH_ALLOWLIST=a@x.com,b@y.com`.
- Browser never holds `DAEMON_*` keys.

## Email

From: `Bagseven <bags@cesthq.com>` (`RESEND_FROM`).

| Event | Who gets it |
| --- | --- |
| Magic link | The address they typed |
| Mint / deny / credits / paid_run / cancel | Signed-in user **and** `OPERATOR_NOTIFY_EMAIL` if set (product ops copy) |

Email + DNS: [HOSTING.md](./HOSTING.md).

## Product loop (what to click)

1. Landing → Start free → **Continue with World (mock)** → Overview  
2. Account → optionally verify email with OTP  
3. Plans → create a thin plan (feature + USDT + credits + payout wallet)  
4. Checkouts → open session → public `/checkout?session=` → WhiteWallet/EVM pay (or demo tx) → grant live  
5. SDK page → Provider + Guard + Embed checkout  
6. MCP → `create_checkout_session` / `check_entitlement` / `consume_entitlement` / `paid_run`  

Live tracks: set World / Whitechain / Arkiv keys in `.env`. Leave mock flags **off** in production.

## SDK

```bash
npm install @bagseven/sdk
```

### 1. Provider (human app)

```tsx
import { BagsevenProvider, FeatureFlagGuard, BagsevenEmbed } from '@bagseven/sdk/react';

<BagsevenProvider publishableKey={pk}>
  <FeatureFlagGuard feature="ocr"><OcrButton /></FeatureFlagGuard>
  <BagsevenEmbed accessToken={token} initialView="portal" />
</BagsevenProvider>
```

`pk_` can identify and check. It cannot consume or mint. Copy-paste this from `/app/sdk`.

### 2. identify → embed token

```ts
import { BagsevenClient } from '@bagseven/sdk/node';
const client = new BagsevenClient({ apiKey: process.env.BAGSEVEN_SECRET_KEY!, baseUrl: 'http://127.0.0.1:4001' });
const { token } = await client.identify({ holder: 'user@example.com' });
```

Holder-scoped JWT (`bgs_tok_…`, ~15 min). Drop it in `BagsevenEmbed` or `/embed?token=`.

### 3. Server `checkEntitlement` (authoritative)

```ts
const ent = await client.checkEntitlement('ocr', { holder: 'user@example.com' });
// { enabled, remaining, allocation, paid_through, arkiv_entity_key, payment_tx }
await client.consumeEntitlement({ feature: 'ocr', holder: 'user@example.com', idempotencyKey: 'run-1' });
```

React is UI gating. Authoritative checks always go through Node / daemon.

### 4. MCP (agent)

Same verbs: `check_entitlement` / `consume_entitlement` / `create_checkout_session`. Secret consume and `paid_run` consume prepaid credits without a mandate; new payments through `bagseven_fetch` require mandate remaining ∧ living grant. Agents never hold World credentials.

### Plans + checkout

```ts
await client.createPlan({ feature: 'ocr', name: 'OCR Starter', amount: '5.00', credits: '10', merchant_wallet: '0x…' });
await client.createCheckoutSession({ plan_id, holder });
// Buyer: BagsevenEmbed checkoutSessionId=… or /checkout?session=
```

Public routes also include `POST/GET /v1/plans`, `POST /v1/checkout-sessions`, `GET|POST /v1/public/checkout/:id`. No payment-link product line.

Demo (daemon running): `pnpm sdk:demo` — plan → checkout confirm → human Guard → agent consume → grant evaporates.

## MCP tools

`bagseven_status`, `grant_status`, `check_entitlement`, `consume_entitlement`, `mint_with_world`, `buy_credits`, `create_checkout_session`, `paid_run`, `cancel_renewal`, `explain_denial`, `bagseven_fetch`

```bash
BAGSEVEN_MCP_WORKER=<uuid> BAGSEVEN_MCP_PORT=4009 pnpm mcp:local
```

**ChatGPT / remote:** expose `:4009` over HTTPS (`BAGSEVEN_MCP_PUBLIC_URL`), set `MCP_OAUTH_REQUIRED=true`. World consent runs on Bagseven’s authorize page; ChatGPT stores a Bagseven access token. Plugin Server URL is typically `https://…/mcp`. Durable notes: [`../AGENTS.md`](../AGENTS.md).

## Design

[design.md](./design.md) — Fianto tokens (`#0002f8`, landing dark, dashboard `#f2f2f2`). Landing and dashboard stay separate.

## Tests / smoke

```bash
pnpm smoke
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @bagseven/console typecheck
pnpm --filter @bagseven/daemon typecheck
```

SDK loop against a running daemon: `pnpm sdk:demo`.

`pnpm smoke` is read-only: service health and authenticated daemon track status. It creates no grants, consumes no credits, sends no mail and makes no payments. `pnpm test` builds the workspace libraries and runs the complete unit/integration test collection without starting services or building the Next.js sites. `pnpm lint` checks source directly; production builds remain a separate `pnpm build` step. `pnpm mcp:local` parses quoted `.env` values and starts MCP directly through Node; the local launcher checks its dedicated port and stops only an older instance from the same checkout.

For full HTTP and MCP checks, use a disposable local development checkout/environment with memory grants, mocked World, no live signing/storage credentials, and local Anvil. Run `NOTIFY_MODE=log pnpm start:local`, then `NOTIFY_MODE=log pnpm smoke:e2e` in another terminal. The check refuses public endpoints and live credentials. It checks landing/docs, World-primary login and recovery, dashboard routes/BFF scope, SDK checks and idempotent prepaid consumption, MCP checkout confirmation, entitlement-only agents, renewal cancellation, expiry, and a bounded local token payment. Prepaid access does not require a mandate; new payments do. `NOTIFY_MODE=log` suppresses email delivery. Browser interaction/visual QA is separate from these HTTP checks. Do not overwrite an existing live `.env` to run this fixture.

### MCP mandate and agent tools

The MCP catalog includes owner-scoped `list_mandates`, `get_mandate`, `list_agents`, `get_agent`, owner-signed `prepare_mandate` / `create_mandate`, `prepare_mandate_funding`, and `list_agent_entitlements`. Use `list_features` and `list_plans` to choose a capability and provider plan, then `create_checkout_session` with the intended `worker_id` for a root or child. Checkout returns the existing hosted wallet URL; payment creates the worker-bound Arkiv grant. `mint_with_world` and `buy_credits` now guide callers to provider checkout rather than asking agents for World credentials or producing unpaid grants.

`bagseven_spawn` defaults to the bound root and mandate. A configured signer must match the actual owner/operator, or an owner signature must be supplied. Direct payments accept `idempotency_key`; reuse the same inputs and key for retries. Uncertain attempted payments remain held for reconciliation.

See [the real MCP verification](testing/mcp-agents-mandates-live-2026-11-07.md) for scope, evidence and operational limits.

## Agent skills

`skills/bagseven/` teaches connected agents the live MCP workflows: entitlement discovery, prepaid usage, provider checkout, new payments, owner-signed mandates and denials. `skills/bagseven-development/` teaches developers the SDK, service boundaries, verification and Railway/Vercel deployment. Both use standard `SKILL.md` frontmatter, self-contained references and optional Codex UI metadata. A skill does not connect MCP, issue credentials or publish the private SDK package.

Install from a checkout:

```bash
npx skills add . --list
npx skills add . --skill bagseven bagseven-development --agent codex --global
```

Choose another supported agent or omit `--agent` for the installer's selection. For a project-local installation, omit `--global`. Invoke `$bagseven` or `$bagseven-development` in Codex after its skill catalog refreshes; other agents use their own skill invocation UI. To refresh a local-source install after changing the skill, rerun the local install command.

### Distribute through GitHub and skills.sh

Keep each skill in its own `skills/<name>/SKILL.md` folder. Supporting files must stay inside that skill folder so installation works outside this monorepo. Do not include `.env`, `.env.prod`, tokens, test receipts with personal data or local filesystem paths. The supplied skills contain public instructions only.

Commit and push the reviewed skill folders and their documentation to the intended GitHub branch. There is no separate npm package release for these instruction files. Once the skills are on the remote repository, users can inspect and install them with:

```bash
npx skills add nishar-hussain/bageseven --list
npx skills add nishar-hussain/bageseven --skill bagseven bagseven-development
# Optional global Codex install:
npx skills add nishar-hussain/bageseven --skill bagseven bagseven-development --agent codex --global
```

Public discovery requires an accessible public source; a private repository installation requires the installer's GitHub access. Do not change repository visibility merely to list a skill. If only the skills should be public, copy the two self-contained skill folders into a separate public repository and substitute that owner/repository in the command.

According to the [skills.sh FAQ](https://skills.sh/docs/faq), skills are tracked and appear on the leaderboard through CLI installation telemetry; there is no separate leaderboard submission command. A local install or discovery check does not prove that a remote listing is published. The [CLI documentation](https://skills.sh/docs/cli) describes telemetry; `DISABLE_TELEMETRY=1` opts out. Do not generate artificial installs to influence rankings.

For later GitHub-sourced updates, users can run `npx skills update`. Skill distribution is separate from deploying Bagseven, connecting its MCP server or publishing `@bagseven/sdk`.

When editing skills, validate their frontmatter and links, check examples against current MCP schemas/SDK exports, and rerun local discovery. Read-only checks, prepaid consumption, new payments, worker mismatch, cancelled renewal, pending checkout and restart recovery should remain distinct workflows.
