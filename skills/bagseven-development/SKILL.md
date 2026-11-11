---
name: bagseven-development
description: Integrate the Bagseven SDK or maintain and deploy the Bagseven monorepo. Use for entitlement checks, provider checkout integration, email and wallet authentication, Avalanche registry storage, Avalanche settlement, MCP implementation, or Railway/Vercel configuration in Bagseven code.
---

# Bagseven development

Use this skill for implementation and integration. For operating an already-connected MCP server, use its discovered tools and the platform's access/payment semantics.

## Establish the surface

In the Bagseven repository, read the applicable `AGENTS.md`, package manifests and current source before changing behavior. Installed copies of this skill may be older than the checkout. For an external integration, inspect the actual SDK version and server URL; do not assume the SDK is published just because a package name exists. The current repository SDK is a private workspace package.

Read only the reference matching the work:

- [SDK integration](references/sdk.md): React/Node/agent entry points, keys, checks, consume and checkout.
- [Service architecture](references/architecture.md): code ownership, email and wallet/MCP boundaries, grants, policy and meaningful verification.
- [Deployment](references/deployment.md): Railway backends, separate Vercel projects, `.env.prod`, live tracks and session persistence.

## Preserve the domain

| Operation | Required truth |
| --- | --- |
| Authoritative feature access | Living Avalanche registry grant with remaining credits and valid `paid_through`; apply holder and worker authorization |
| Prepaid `paid_run`, `consume_entitlement`, SDK `/v1/usage/consume` | Authorized living grant and sufficient feature credits; no USDT mandate required |
| New payment through `bagseven_fetch` | Registered active policy agent, remaining mandate capacity and living grant |
| Checkout confirmation | Verified Avalanche payment for the plan, intended buyer and merchant; then mint access |
| Cancel renewal | Change `renewal_enabled`; preserve already-paid time |

Credit quantities and token payment amounts are distinct units. Keep decimal money strings and bigint token units; follow the existing six-decimal USDT conversion helpers. Reuse idempotency keys for retries with identical inputs, and preserve unresolved payment holds for reconciliation.

Email and wallet signatures authorize login and consent. MCP proves the agent to the daemon with Bagseven OAuth/Bearer credentials. Agents never hold email and wallet credentials. Publishable API keys are for permitted reads; secret keys stay server-side; embed tokens are holder-scoped. Browser guards are UI hints; the server authorizes use.

## Change the existing product path

The product has `apps/landing` and `apps/console`; console API routes are the browser's BFF. Keep daemon keys out of browser code and use `/api/daemon/*`, `/api/policy/*` and `/api/public/*` as applicable. Do not add another dashboard, inspector or service merely to demonstrate a feature. Keep the optional existing SDK demo separate from production deployment.

Read a module's callers before removing it. Public SDK exports, generated ABI/bytecode, manual audit entry points, Next filesystem routes, workspace build dependencies and peer dependencies can be required without an ordinary source import. Remove code only when the relevant call paths and contracts confirm it is unused.

Preserve the existing Next version's local guidance when changing console/landing behavior; do not migrate middleware conventions or replace build tooling as an incidental edit.

## Verify the behavior you change

Build the affected package dependencies and run focused typechecks/tests. Cover observable authorization, payment, retry or persistence behavior when those change. For backend imports from `@bagseven/*`, build workspace dependencies before running tests against `dist` entry points.

Typical repository commands:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@bagseven/daemon... --filter=@bagseven/policy... --filter=@bagseven/gateway...
pnpm --filter @bagseven/console typecheck
pnpm --filter @bagseven/daemon typecheck
pnpm --filter @bagseven/policy typecheck
```

The root Vitest configuration discovers repository tests; inspect its actual include patterns if a package test unexpectedly reports no tests. Live audit/smoke scripts can send mail, create grants, deploy contracts and transfer funds. Read their entry point and use them only within the user's actual authorization; ordinary code verification should use local/mocked dependencies.

Report the concrete change, verification, unresolved hosting inputs and any live side effect. Never print `.env` values or bundle private environment files with a skill, build image or public artifact.
