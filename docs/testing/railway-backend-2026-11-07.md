# Railway backend verification — 2026-11-07

The repository now provides project-wide Railway IaC at `.railway/railway.ts`, with three application services (daemon includes MCP), managed Postgres and Redis, and a persistent daemon volume. `setup:prod` generates an ignored shared-variable import file without checking credentials into source.

Verified locally:

- All ten backend/workspace build tasks pass.
- A clean Node 24 Docker image installs the frozen pnpm lockfile and builds the backend dependency graph successfully.
- The Railway authoring file passes TypeScript and ESLint; `pnpm check:railway` validates resource wiring and shared-variable names.
- `pnpm test:railway-image` migrates a disposable Postgres database including provider gas accounts, starts daemon/policy/gateway/MCP in production mode, and verifies all four health checks.
- An authenticated gateway request reaches policy and reads the migrated database. Unauthenticated daemon/MCP requests are rejected and MCP OAuth discovery responds successfully.
- Test containers use an isolated network, ephemeral credentials and no host ports; all are removed afterward. No transactions or notification emails are sent.

## Hosted repair and acceptance checks

Railway and Vercel CLI authentication were completed with the account owner's approval. The official Railway plugin's OAuth callback error was bypassed with CLI device authorization; its OAuth client registration is outside this repository.

Railway project: `zonal-cat`, production environment. Postgres and Redis were already healthy. The original application service had empty rendered `DATABASE_URL` and `REDIS_URL`; these were replaced directly on the service and verified after reference rendering. The service was renamed `daemon`. Missing policy and gateway services were created and connected to the same GitHub repository. The free-plan service limit prevented a sixth service, so MCP shares the daemon container. A persistent `/data` volume was attached.

The initial gateway deployment captured an empty policy hostname before policy's first deployment provisioned its private endpoint. Redeploying gateway after policy became ready refreshed the reference. All five Railway services reached SUCCESS. No database or Redis service was replaced.

Public origins:

- Dashboard: https://bageseven-app.vercel.app
- Landing/docs: https://bageseven.vercel.app
- Daemon and MCP: https://daemon-production-6858.up.railway.app
- Gateway: https://gateway-production-9ebe.up.railway.app
- MCP connector: https://daemon-production-6858.up.railway.app/mcp

Both existing Vercel projects were configured for Node 24 and the correct monorepo roots, supplied their generated production variable subsets, and deployed. The production development auth secret was replaced; provider account encryption was preserved. Dedicated unfunded operator/executor identities were generated, without funding a platform wallet. Owner-wallet allowlisting remains optional because providers can verify their connected wallets.

A hosted login check found that the dashboard readiness endpoint incorrectly required RP credentials locally on Vercel. It now reads public signing readiness through the authenticated daemon BFF and returns only allowlisted public fields. The RP signing key remains on Railway. Regression tests cover missing Vercel RP keys, an unavailable daemon, a missing signing key, and filtering unexpected private fields.

Verification completed:

- Eleven focused unit tests; console typecheck; changed-file lint and whitespace checks.
- Backend Docker build and isolated integration smoke, including shared daemon/MCP readiness, both authentication gates, OAuth discovery and authenticated billing reads.
- `pnpm check:prod`: PRODUCTION_CONFIG_OK, with no remaining placeholders.
- `pnpm check:railway`: shared-mode resource and environment wiring valid.
- `pnpm integrations:check --env-file .env.prod`: World signer matches; live Whitechain chain 1874 and configured USDT reports six decimals. Provider mode correctly does not require funding the platform executor.
- `pnpm check:hosted`: twelve HTTPS checks pass, covering daemon/gateway health, protected-route rejection, MCP discovery, billing database reads, live Arkiv entitlement reads, gateway → private policy → database/cache, signing configuration, backend World challenge, dashboard login readiness and dashboard → daemon challenge.

The account owner then confirmed successful sign-in through World App on the live dashboard.

No payments, grants, charges or notification emails were created by the automated checks. Provider wallet authorization/funding and customer checkout remain separate wallet steps. Changes were deployed from the local workspace without committing or pushing pending repository changes.
