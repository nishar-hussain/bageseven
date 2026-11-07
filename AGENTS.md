# Agent instructions (Bagseven)

Monorepo for **Bagseven**: humans mint living Arkiv entitlements; humans and agents `checkEntitlement` via `@bagseven/sdk`; agents make new payments through MCP under a **dual-gate** (mandate remaining ∧ living grant); prepaid credit usage needs only a living grant. Prefer the live product path — no extra UIs, ports, or demo apps.

## Architecture

```
apps/landing     marketing          :3001
apps/console     operator dashboard :3000/app   (magic-link BFF)
services/gateway public API         :4000
services/daemon  grants + dual-gate :4001
services/policy  spend tokens       :4003
scripts/bagseven-mcp.ts  MCP HTTP/stdio  :4009  (agent surface)
packages/        sdk entitlements world notify db money onchain server
```

Start: `pnpm run setup` then `pnpm start:local`. Design tokens: `docs/design.md` (`--blue #0002f8`, landing dark, dashboard `#f2f2f2`).

Do **not** add another web app, revive `bag-dashboard`, or put an inspector on `:3010`. Browser never holds `DAEMON_*` keys — console uses `/api/daemon/*`.

## Dual-gate

| Clock | Truth |
| --- | --- |
| Payment | Whitechain `payment_tx` |
| Renewal | `grant.renewal_enabled` (cancel does **not** kill `paid_through`) |
| Access | Arkiv grant `remaining` + `paid_through` (queryable object, not a private `/check`) |

`paid_run`, `consume_entitlement`, and SDK `/v1/usage/consume` use already-paid access: require a living grant, holder authorization, worker binding when supplied, and enough credits. They do not check a USDT mandate. Credit units are not payment amounts.

New payments through `bagseven_fetch` still require an active agent, mandate capacity, and a living grant (`BAGSEVEN_REQUIRE_GRANT=true`). `entitlements_only` MCP connections can use prepaid credits without a deployed mandate. Dashboard `/app/mandate` manages agent spending permissions: owner-signed create/delegate, owner-wallet funding/withdrawal/revoke. Never expose private keys or auto-send wallet transaction drafts.

## Provider-funded gas

Provider-funded mode is the default. Never spend a platform private-key wallet for provider operations or silently fall back to one. Provider accounts require signed, expiring authorization and native funding on Whitechain (WBT) and Arkiv (tGLM). Keys are AES-GCM encrypted with PROVIDER_GAS_ENCRYPTION_KEY; console/daemon/policy share this deployment secret. Limits are server-enforced EOA restrictions; do not describe them as on-chain smart-account limits. Fee budgets atomically reserve worst-case fees before signing. Legacy platform-owned grants/mandates need explicit migration/reissue; no hidden platform-fee subsidy. x402 without provider payer integration fails closed. See docs/PRODUCT.md.

## Auth + email

- Dashboard: **World-primary** login (`/api/auth/world`); session in `apps/console/lib/auth.ts` carries `world_human_id` + optional verified email. Email OTP verify-later via `/api/auth/email/*`. Magic link is recovery only.
- Resend via `packages/notify` from `bags@cesthq.com`. Grant mails → signed-in actor (`x-bagseven-actor`) + optional `OPERATOR_NOTIFY_EMAIL`.
- Production secrets: `AUTH_SECRET`, `DAEMON_AUTH_TOKEN`, `RESEND_API_KEY`. Hosting: `docs/HOSTING.md`.

**World vs MCP (different doors):** World proves the **human** at mint / OAuth authorize. MCP proves the **agent** to the daemon (daemon Bearer / OAuth access token). Agents never hold World credentials.

**World OIDC (live):** authorize `https://auth.world.org/api/v1/authorize` + token `…/api/v1/token`. Console `/app/mint` starts PKCE, redirects back with `?code=&state=`, daemon `POST /internal/world/callback` exchanges code (server-held verifier) → `id_token` → mint. Mock mode mints as the signed-in email with `world:ok:<email>` — no pasted proofs.

**Human + agent UX:** Operators never paste grant/worker UUIDs for normal flows (select entitlements; MCP hides worker id). Agents should call `paid_run` with `feature: "ocr"` (auto-picks a living grant); `grant_id` is optional.

## MCP (local + ChatGPT)

```bash
BAGSEVEN_MCP_WORKER=<uuid> BAGSEVEN_MCP_PORT=4009 pnpm mcp:local
# ChatGPT remote: HTTPS tunnel to :4009 + MCP_OAUTH_REQUIRED=true + BAGSEVEN_MCP_PUBLIC_URL=https://…
```

Tools: `bagseven_status`, `grant_status`, `check_entitlement`, `consume_entitlement`, `mint_with_world`, `buy_credits`, `create_checkout_session`, `paid_run`, `cancel_renewal`, `explain_denial`, `bagseven_fetch` (+ search/spawn when wired).

| Fact | Detail |
| --- | --- |
| ChatGPT | Needs **HTTPS** streamable HTTP (`/mcp`), not stdio/localhost |
| Auth | World-gated OAuth AS (`scripts/mcp-oauth-as.ts`) — PKCE + DCR; ChatGPT gets a Bagseven Bearer, not World |
| Sessions | In-memory `mcp-session-id`; after MCP restart clients must re-`initialize` (stale sid on initialize is accepted) |
| `grant_status` | Defaults to feature filter only (aligns with `bagseven_status`). Do **not** force `worker_id` — console/curl mints often omit it |
| JSON | `enableJsonResponse: true` — avoids SSE hangs behind ngrok |
| Ngrok free | Browser interstitial on first visit; API POSTs with Bearer are fine. Update ChatGPT plugin URL when the tunnel hostname changes |

Keep MCP alive in a long-lived process (`pnpm bagseven-mcp` / `mcp:local`). Killing the shell kills sessions and OAuth tokens in memory.

## Code map

| Concern | Where |
| --- | --- |
| Dual-gate + grants API | `services/daemon/src/grants.ts` |
| Whitechain settle | `services/daemon/src/whitechain-settle.ts` |
| Entitlement SDK | `packages/sdk` |
| Arkiv store | `packages/entitlements` |
| World verify | `packages/world` |
| Magic link | `apps/console/lib/auth.ts` |
| Daemon BFF | `apps/console/app/api/daemon/[...path]/route.ts` |
| MCP + OAuth | `scripts/bagseven-mcp.ts`, `scripts/mcp-oauth-as.ts` |

## Commands

```bash
pnpm start:local
pnpm smoke
pnpm --filter @bagseven/console typecheck
pnpm --filter @bagseven/daemon typecheck
```

## Docs (keep this set small)

- `README.md` — humans
- `llms.txt` — compact model context
- `docs/PRODUCT.md` · `docs/DEVELOPERS.md` · `docs/HOSTING.md` · `docs/DECISIONS.md` · `docs/design.md`
- `docs/arkiv/` — schema / friction notes

Do not add root audit/plan/report markdown; put durable notes here or in `docs/`.
