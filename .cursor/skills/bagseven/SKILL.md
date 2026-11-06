---
name: bagseven
description: >-
  Work on the Bagseven platform (mandate + Arkiv entitlements, World mint,
  Whitechain settle, entitlement SDK, Fianto landing/dashboard). Use when editing bagseven apps,
  daemon grants, MCP tools, auth/Resend, or when the user mentions dual-gate,
  living grants, or Fianto-style UI.
---

# Bagseven

## Surfaces

- Landing `apps/landing` port **3001**
- Dashboard `apps/console` port **3000** `/app`
- Never merge them. Tokens in `docs/design.md` (`#0002f8`, dashboard `#f2f2f2`).

Start: `pnpm start:local`. **Follow `AGENTS.md`** (architecture, dual-gate, ChatGPT MCP). Compact: `llms.txt`.

## Code map

- Dual-gate + notify: `services/daemon/src/grants.ts`
- Whitechain: `services/daemon/src/whitechain-settle.ts`
- SDK: `packages/sdk`
- World: `packages/world`
- Arkiv store: `packages/entitlements`
- Magic link: `apps/console/lib/auth.ts` — set session cookie on `NextResponse.redirect`
- Resend: `packages/notify`
- BFF: `apps/console/app/api/daemon/[...path]/route.ts`
- MCP + OAuth: `scripts/bagseven-mcp.ts`, `scripts/mcp-oauth-as.ts`

## Rules

1. Browser never sees `DAEMON_*` keys.
2. Paid tools fail closed without mandate **and** living grant.
3. Do not resurrect `bag-dashboard`, inspector `:3010`, or Rainbow/wagmi on the dashboard.
4. Any email can sign in unless `AUTH_ALLOWLIST` is set.
5. Production: `AUTH_SECRET`, `DAEMON_AUTH_TOKEN`, `RESEND_API_KEY`. See `docs/HOSTING.md`.
6. Do not add root audit/plan markdown — durable notes go in `AGENTS.md` / `docs/`.
