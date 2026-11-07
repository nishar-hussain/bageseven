# Bagseven

Infrastructure for autonomous agents: a **mandate** (spend ceiling) plus a **living entitlement** (Arkiv grant). Humans mint. Humans and agents check through an SDK. Agents spend through MCP. Settlement is Whitechain. Unique humans via World.

The LLM proposes. Deterministic code disposes.

## Two URLs

| Surface | URL | What |
| --- | --- | --- |
| **Landing** | http://localhost:3001 | Marketing (`apps/landing`) |
| **Dashboard** | http://localhost:3000/app | Operator app (`apps/console`) |
| **SDK** | http://localhost:3000/app/sdk | Drop-in React snippet + live embed |

Sign-in is **World-primary** (`/app/login`, mock locally). Email is optional and verified later via OTP from Account. Magic link remains recovery/invite only.

## Start

```bash
pnpm run setup      # .env, postgres/redis/anvil, build, migrate, funded local worker
pnpm start:local    # landing + dashboard + gateway + policy + daemon
# pnpm dev is the same command
```

If `pnpm` itself errors with a missing global path, your shell shim is broken — use `corepack pnpm` or reinstall: `corepack prepare pnpm@10.33.0 --activate`.

Then: landing → **Start free** → **Continue with World** (mock locally) → Overview → Mint / Credits / Grants.

Setup creates a funded mandate and saves `BAGSEVEN_MCP_WORKER` in `.env`. World proofs and Whitechain settlement use local mock modes; Arkiv uses memory. The isolated Anvil chain runs on `58545` as Whitechain chain ID `1874`, without real funds.

Verify the full local flow without sending email:

Use a disposable local development `.env` without live signing/storage credentials. The smoke check refuses public RPCs and live credentials; do not replace your live `.env` to run it.

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
packages/        sdk entitlements world notify db money onchain server
```

## MCP

```bash
BAGSEVEN_MCP_WORKER=<uuid> pnpm mcp:local
```

Tools: `bagseven_status`, `grant_status`, `check_entitlement`, `consume_entitlement`, `mint_with_world`, `buy_credits`, `paid_run`, `cancel_renewal`, `explain_denial`, `bagseven_fetch`.

## Agent skills

The reusable skills are [bagseven](./skills/bagseven/SKILL.md) for connected MCP agents and [bagseven-development](./skills/bagseven-development/SKILL.md) for SDK integration and platform maintenance. Install from this checkout with `npx skills add . --skill bagseven bagseven-development`. Remote installation and skills.sh distribution steps are in [the developer guide](./docs/DEVELOPERS.md#agent-skills).

## Production deployment

Deploy landing and console on **Vercel**, and daemon, gateway, policy, MCP, Postgres and Redis on **Railway**. Service configs and variable templates are in `deploy/railway/` and `deploy/vercel/`; follow [docs/HOSTING.md](./docs/HOSTING.md) for setup, shared secrets and the live World / Whitechain / Arkiv tracks. World is the primary login; `AUTH_ALLOWLIST` controls email recovery access.

Run `pnpm setup:prod`, fill in the root `.env.prod`, then rerun it to generate private per-service imports. Railway Root Directory is `/` for every backend service (root `railway.json` defaults to daemon). Deploy the Vercel projects separately with roots `apps/landing` and `apps/console`.
