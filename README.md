# Bagseven

Infrastructure for autonomous agents: a **mandate** (spend ceiling) plus a **living entitlement** (Arkiv grant). Humans mint. Agents spend through MCP. Settlement is Hedera. Unique humans via World.

The LLM proposes. Deterministic code disposes.

## Two URLs

| Surface | URL | What |
| --- | --- | --- |
| **Landing** | http://localhost:3001 | Marketing (`apps/landing`) |
| **Dashboard** | http://localhost:3000/app | Operator app (`apps/console`) |

Sign-in is a magic link to **any email** (`/app/login`). Mail is sent from `bags@cesthq.com` via Resend. Locally, without `RESEND_API_KEY`, the link is printed on the page.

## Start

```bash
pnpm run setup      # .env, postgres/redis/anvil, build, migrate, funded local worker
pnpm start:local    # landing + dashboard + gateway + policy + daemon
# pnpm dev is the same command
```

If `pnpm` itself errors with a missing global path, your shell shim is broken — use `corepack pnpm` or reinstall: `corepack prepare pnpm@10.33.0 --activate`.

Then: landing → **Start free** → email → Overview → Mint / Credits / Grants.

Setup creates a funded mandate and saves `BAGSEVEN_MCP_WORKER` in `.env`. World proofs and Hedera settlement use local mock modes; Arkiv uses memory. The isolated Anvil chain runs on `58545` with local USDC, without real funds.

Verify the full local flow without sending email:

```bash
NOTIFY_MODE=log pnpm start:local
# In another terminal:
NOTIFY_MODE=log pnpm smoke:e2e
```

**What ships + demo + World vs MCP auth:** [docs/PRODUCT.md](./docs/PRODUCT.md)

Docs: [docs/](./docs/README.md) · [docs/DEVELOPERS.md](./docs/DEVELOPERS.md) · [docs/HOSTING.md](./docs/HOSTING.md) · [llms.txt](./llms.txt) · [AGENTS.md](./AGENTS.md)

## Dual-gate

Every paid tool call must pass **both**:

1. Mandate remaining (policy / `SIGNER_MODE=dev`)
2. Living Arkiv grant (`remaining` + `paid_through`)

Access is a queryable Arkiv object, not a private `/check` flag. Cancel renewal does not kill the period already paid.

## Layout

```
apps/landing     marketing :3001
apps/console     dashboard :3000 /app
services/gateway :4000
services/daemon  :4001
services/policy  :4003
packages/        entitlements world notify db money onchain server
```

## MCP

```bash
BAGSEVEN_MCP_WORKER=<uuid> pnpm mcp:local
```

Tools: `bagseven_status`, `grant_status`, `mint_with_world`, `buy_credits`, `paid_run`, `cancel_renewal`, `explain_denial`, `bagseven_fetch`.

## Production

See [docs/HOSTING.md](./docs/HOSTING.md). Required: `AUTH_SECRET`, `DAEMON_AUTH_TOKEN`, `RESEND_API_KEY`. Sign-in is open unless you set `AUTH_ALLOWLIST`.
