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
pnpm run setup      # .env, docker postgres/redis, build, migrate
pnpm start:local    # landing + dashboard + gateway + policy + daemon
# pnpm dev is the same command
```

If `pnpm` itself errors with a missing global path, your shell shim is broken — use `corepack pnpm` or reinstall: `corepack prepare pnpm@10.33.0 --activate`.

Then: landing → **Start free** → email → Overview → Mint / Credits / Grants.

Docs: [docs/DEVELOPERS.md](./docs/DEVELOPERS.md) · [docs/HOSTING.md](./docs/HOSTING.md) · [llms.txt](./llms.txt) · [AGENTS.md](./AGENTS.md)

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
