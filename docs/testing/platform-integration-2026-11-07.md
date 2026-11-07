# Platform integration verification — 2026-11-07

Upstream `main` commit `23da6ad` (documentation site) was merged with the existing local Railway deployment commit into `41283a5`. Local cleanup and skill changes were preserved. No changes were pushed remotely.

## Verification completed

| Check | Result |
| --- | --- |
| Frozen pnpm installation | Passed |
| Repository tests | 167 tests across 30 files passed |
| Landing, console, gateway, daemon and policy typechecks | Passed |
| Production backend and both frontend builds | Passed in clean Linux Docker environment; final daemon changes also rebuilt successfully |
| HTTP/MCP product smoke | Passed in a disposable local stack |
| Mandate integration matrix | 22 passed, 0 failed |
| Production readiness | Incomplete: actual hosting/wallet/OIDC values still required |

The disposable stack ran the existing landing, console, gateway, daemon and policy plus fresh Postgres, Redis and Anvil in a separate container network namespace. No host ports or existing user data volumes were attached. All transfers used local faucet tokens on Anvil; World was mocked, grants used memory, and email was suppressed. This verifies local integration, not a live human World scan, Arkiv write, public Whitechain payment, browser interaction or deployed Railway/Vercel acceptance.

The smoke covered landing/documentation routes; service health; unauthorized request refusal; World-primary local login and email recovery; dashboard routes and the checkout-to-builder redirect; BFF holder binding; SDK reads, consumption, retry idempotency and publishable-key write refusal; MCP prepaid usage; plan/checkout creation and demo confirmation; renewal cancellation without loss of paid time; entitlement-only worker access; missing-agent payment refusal; grant expiry; local onchain payment, repeat-request idempotency and per-purchase refusal.

The mandate matrix covered ownership signatures, creation/funding, idempotent creation, required grants, token transfer and vault accounting, per-purchase boundaries, signed withdrawals, wrong/stale spend signatures, nonce replay, internal reservation authorization, window/lifetime/seller/vault limits, child allocation/depth, prepaid usage independent of payment capacity, grant exhaustion, cancellation, dashboard worker binding and revocation. Revocation blocks new payments while preserving already-paid grant usage.

## Fixes made while verifying

- Restored landing's `lucide-react` dependency: the newly pulled documentation components use it.
- Allowed unauthenticated GET/HEAD on the registered daemon `/healthz` route so Railway probes succeed; internal and similarly named routes still require authentication. Added a regression test.
- Removed the redundant pre-consume balance check that rejected retries of an already-completed credit burn. Holder/worker/expiry checks remain; the store handles idempotency and insufficient credits. Extended the MCP regression to cover retrying the final credit.
- Updated obsolete smoke/matrix expectations to the current prepaid-versus-new-payment model, current checkout states, real route redirects and canonical research-fetch feature.
- Aligned isolated local checkout/mandate token and RPC settings in the local seed.
- Added the shared default MCP worker to the Railway daemon variable template.
- Aligned the private production mandate token with its configured Whitechain checkout token and regenerated per-service imports. Live source `.env` was not modified.
- Added `--env-file` support and production placeholder checks to the read-only integration checker; it does not print credential values.

## Production inputs still required

`pnpm integrations:check --env-file .env.prod` correctly exits nonzero while these fields contain placeholders:

- `DAEMON_URL`, `GATEWAY_URL`, `BAGSEVEN_MCP_PUBLIC_URL`.
- `NEXT_PUBLIC_CONSOLE_URL`, `NEXT_PUBLIC_LANDING_URL`.
- `DAEMON_OPERATOR_KEY`, `DAEMON_EXECUTOR_KEY`, `DAEMON_EXECUTOR_ADDRESS`, `DAEMON_OWNER_ADDRESS`.
- `WORLD_CLIENT_SECRET` for the enabled World Agent Pass OIDC flow.

Production checks passed for available secret configuration, World signer consistency, disabled mock flags, Arkiv storage selection, matching mandate/checkout token, live Whitechain chain ID and token decimals. No production wallet was generated or inferred from public Anvil development keys. Arkiv live reads/writes, human consent, public payment/receipt confirmation and hosted acceptance still need actual completion after configuration/deployment. See [HOSTING.md](../HOSTING.md).

## Repeat checks

Run `pnpm exec vitest run`, the affected package typechecks/builds, and the read-only production checker. For integration scripts, use an isolated disposable development checkout/stack created by local setup. Do not overwrite a live `.env` or run live audit scripts just to reproduce these local results.

With the local development stack running and email disabled:

```bash
NOTIFY_MODE=log pnpm smoke:e2e
NOTIFY_MODE=log pnpm test:mandate
```
