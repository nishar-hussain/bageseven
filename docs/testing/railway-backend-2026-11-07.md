# Railway backend verification — 2026-11-07

The repository now provides project-wide Railway IaC at `.railway/railway.ts`, with four application services, managed Postgres and Redis, and a persistent daemon volume. `setup:prod` generates an ignored shared-variable import file without checking credentials into source.

Verified locally:

- All ten backend/workspace build tasks pass.
- A clean Node 24 Docker image installs the frozen pnpm lockfile and builds the backend dependency graph successfully.
- The Railway authoring file passes TypeScript and ESLint; `pnpm check:railway` validates resource wiring and shared-variable names.
- `pnpm test:railway-image` migrates a disposable Postgres database including provider gas accounts, starts daemon/policy/gateway/MCP in production mode, and verifies all four health checks.
- An authenticated gateway request reaches policy and reads the migrated database. Unauthenticated daemon/MCP requests are rejected and MCP OAuth discovery responds successfully.
- Test containers use an isolated network, ephemeral credentials and no host ports; all are removed afterward. No transactions or notification emails are sent.

Deployment is not verified in a Railway account: no authenticated Railway CLI or connector is available in this session. The private production configuration still needs the daemon/gateway/MCP and frontend public URLs, agent operator/executor keys and public owner/executor addresses. `pnpm check:prod` reports those outstanding checks without revealing values. See `docs/HOSTING.md` for linking the existing project, importing shared variables, reviewing/applying the plan and completing hosted acceptance checks.
