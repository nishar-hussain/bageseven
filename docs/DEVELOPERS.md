# Developer guide

Bagseven is a product, not a demo harness. Humans mint access. Agents spend under a mandate. Access lives on Arkiv until `paid_through`. Money settles on Hedera. Unique humans via World. The dashboard is a Fianto-shaped operator app; MCP is the agent surface.

If you are an LLM, also read [`../llms.txt`](../llms.txt) and [`../AGENTS.md`](../AGENTS.md).

## Mental model

Three clocks, all independent:

| Clock | Question | Source of truth |
| --- | --- | --- |
| Payment | Did money move? | Hedera `payment_tx` |
| Renewal | Will we collect again? | `renewal_enabled` on the grant |
| Access | Can they use the feature *now*? | Living Arkiv grant (`remaining` + `paid_through`) |

**Dual-gate:** a paid tool call (`paid_run`, `bagseven_fetch`) needs mandate remaining **and** a living grant. Fail closed.

The daemon uses `BAGSEVEN_MCP_WORKER` as the default worker for dashboard mint and credit purchases, storing the binding on the grant. Paid runs use an explicit `worker_id`, then the grant's saved worker, then this server default for older unbound grants. Every paid run still checks mandate capacity; missing or unavailable workers cannot bypass the gate. Set this variable on the daemon as well as the MCP process.

The LLM never authorizes money. Policy issues a spend token; daemon executes. See [DECISIONS.md](./DECISIONS.md).

## Repo map

```
apps/landing     marketing  :3001
apps/console     dashboard  :3000  /app  (magic-link auth, BFF)
services/gateway public API :4000
services/daemon  dual-gate, grants, World, Hedera :4001
services/policy  budgets / spend tokens :4003
packages/entitlements  Arkiv + memory store
packages/world         Agent Pass verify
packages/notify        Resend (from bags@cesthq.com)
```

Do not add a third UI.

## Local

```bash
pnpm run setup
pnpm start:local   # same as pnpm dev
```

Requires Node 24+, pnpm 10.33.0, and a running Docker engine. Setup installs locked dependencies, creates local secrets, starts isolated Postgres (`55432`), Redis (`56379`), and Anvil (`58545`), builds the workspace, and applies migrations. It preserves an existing `.env`; use `--force` only to replace it. Redpanda is optional (`pnpm run setup --with-redpanda`).

Anvil uses chain ID `43113` to exercise the supported mandate contract path with local tokens. Setup deploys a local USDC faucet, funds a mandate, and writes its worker UUID to `BAGSEVEN_MCP_WORKER`. Reruns reuse the worker; chain state persists in a Docker volume. This is a local chain, not the public Fuji testnet. An existing environment needs `RPC_URL=http://localhost:58545` and `CHAIN_ID=43113` to opt into local seeding; custom RPC configurations are preserved.

| URL | Surface |
| --- | --- |
| http://localhost:3001 | Landing |
| http://localhost:3000/app | Dashboard |
| http://localhost:4000 | Gateway |
| http://localhost:4001 | Daemon |
| http://localhost:4003 | Policy |

Sign in with **any email**. Resend sends the link from `bags@cesthq.com`. Without `RESEND_API_KEY`, the login page prints the link.

`start:local` frees 3000/3001/4000–4003 if a previous stack is still bound.

## Auth

- Magic link is a **signed token** (15 min). Any console replica with `AUTH_SECRET` can verify it.
- Session cookie `bagseven_session` (HMAC, 8h).
- Default: any email. Optional invite-only: `AUTH_ALLOWLIST=a@x.com,b@y.com`.
- Browser never holds `DAEMON_*` keys. Dashboard uses `/api/daemon/*` and forwards `x-bagseven-actor` (signed-in email) so grant emails go to that user.

## Email

From: `Bagseven <bags@cesthq.com>` (`RESEND_FROM`).

| Event | Who gets it |
| --- | --- |
| Magic link | The address they typed |
| Mint / deny / credits / paid_run / cancel | Signed-in user **and** `OPERATOR_NOTIFY_EMAIL` if set (product ops copy) |

Email + DNS: [HOSTING.md](./HOSTING.md).

## Product loop (what to click)

1. Landing → Start free → email → Overview  
2. Mint (World mock locally) → grant appears on Entitlements  
3. Credits (Hedera demo settle locally)  
4. MCP page → use the `BAGSEVEN_MCP_WORKER` from `.env` → `pnpm mcp:local`
5. Agent calls `paid_run` / `bagseven_fetch` under dual-gate  

Live tracks: set World / Hedera / Arkiv keys in `.env`. Leave mock flags **off** in production.

## MCP tools

`bagseven_status`, `grant_status`, `mint_with_world`, `buy_credits`, `paid_run`, `cancel_renewal`, `explain_denial`, `bagseven_fetch`

```bash
BAGSEVEN_MCP_WORKER=<uuid> BAGSEVEN_MCP_PORT=4009 pnpm mcp:local
```

**ChatGPT / remote:** expose `:4009` over HTTPS (`BAGSEVEN_MCP_PUBLIC_URL`), set `MCP_OAUTH_REQUIRED=true`. World consent runs on Bagseven’s authorize page; ChatGPT stores a Bagseven access token. Plugin Server URL is typically `https://…/mcp`. Durable notes: [`../AGENTS.md`](../AGENTS.md).

## Design

[design.md](./design.md) — Fianto tokens (`#0002f8`, landing dark, dashboard `#f2f2f2`). Landing and dashboard stay separate.

## Tests / smoke

```bash
pnpm smoke
pnpm --filter @bagseven/console typecheck
pnpm --filter @bagseven/daemon typecheck
```

For full HTTP and MCP checks, run `NOTIFY_MODE=log pnpm start:local`, then `NOTIFY_MODE=log pnpm smoke:e2e` in another terminal. This checks authentication, dashboard routes, World mint/deny, Hedera demo credits, funded worker resolution, paid work under both gates, a local token payment, renewal cancellation, and expiry. `NOTIFY_MODE=log` preserves Resend configuration while suppressing delivery. Restart normally to resume email delivery. Browser automation is separate from these HTTP checks.
