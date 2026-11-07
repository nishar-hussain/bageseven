# Hosting Bagseven: Vercel + Railway

Use **two Vercel projects** and **four Railway services**, plus Railway Postgres and Redis. Keep the existing product paths.

```text
Vercel landing (apps/landing)
Vercel console (apps/console, including Next API/BFF routes)
  ├── HTTPS + service Bearer → Railway daemon
  └── HTTPS + service Bearer → Railway gateway
Railway gateway / daemon → private network → Railway policy
Railway MCP → private network + Bearer → Railway daemon
ChatGPT / Cursor → HTTPS OAuth → Railway MCP /mcp
Railway services → Railway Postgres + Redis
Daemon → World, Whitechain and Arkiv
```

Vercel runs the console's Next API routes; all long-lived backend services run on Railway. No additional frontend or inspector is needed. Production uses external Whitechain RPC, not Anvil.

## 1. Create Railway services

Create one Railway project/environment with Postgres and Redis, then four services from this repository. Name them exactly `daemon`, `gateway`, `policy`, `mcp` so the supplied variable references work. The database service names in the templates are `Postgres` and `Redis`; adjust references if you use different names.

For **each application service**, set Root Directory to `/` (the repository root, not `services/daemon`). The root `railway.json` automatically configures the daemon when you first import this repository. Railway deploys one process per service: selecting the root does not create all four services automatically. Add the other three services from the same repository, also rooted at `/`, and select their matching config file in Settings → Config-as-code:

| Service | Config file | Port | Public domain |
| --- | --- | --- | --- |
| daemon | `/railway.json` (default; same as `/deploy/railway/daemon.json`) | 4001 | Generate HTTPS domain; Vercel needs it |
| gateway | `/deploy/railway/gateway.json` | 4000 | Generate HTTPS domain; Vercel needs it |
| policy | `/deploy/railway/policy.json` | 4003 | None; private only |
| mcp | `/deploy/railway/mcp.json` | 4009 | Generate HTTPS domain; agent connector |

All four use `deploy/Dockerfile.backend`, Node 24, a frozen pnpm lockfile, `/healthz`, and restart-on-failure. The image builds backend workspace dependencies without building the frontends. `PORT` takes precedence over local service port variables; `HOST=::` accepts public IPv4 and private IPv6 traffic. Set the table's fixed `PORT` values in Railway so private URLs match. Select the matching target port when generating a domain.

Prepare the private `.env.prod` files using the workflow below, then import the matching service file in Railway's variable editor. The checked-in `deploy/railway/<service>.env.example` files remain reusable templates. Railway resolves `${{...}}` references; do not paste them unchanged into Vercel or a local shell.

Attach a **persistent volume at `/data` to daemon** and set `BAGSEVEN_DATA_DIR=/data`. Custom feature definitions live there; container storage is ephemeral. Postgres and Redis also need their managed persistent volumes. Enable backups appropriate to your project. Keep daemon and MCP at one replica: the feature registry, Arkiv holds and MCP OAuth/session maps have process-local state. Keep Railway Serverless/sleep disabled for MCP so active agent sessions stay available. Restarting or redeploying MCP still clears OAuth tokens and sessions; clients must reconnect and authorize again.

The daemon config runs `pnpm db:migrate` as a pre-deploy command, using Railway `DATABASE_URL`. Deploy data services first, then daemon (wait for migrations), then policy, gateway and MCP. Do not also run migration pre-deploy commands on the other services. Health endpoints report process liveness; verify database access and live integrations after deployment.

Railway private addresses never go into Vercel: Vercel cannot resolve `*.railway.internal`. Only internal Railway calls use those addresses. Vercel uses the daemon and gateway public HTTPS URLs, with server-held service tokens.

Configuration reference: [Railway config-as-code](https://docs.railway.com/config-as-code/reference), [private networking](https://docs.railway.com/networking/private-networking).

### Prepare the production environment files

From the repository root:

```bash
pnpm setup:prod
# Edit .env.prod: replace hosted domain and provider credential placeholders.
pnpm setup:prod
```

The root `.env.prod` is the private source for backend configuration and shared frontend values. The first run generates independent auth/service secrets, API keys and a stable worker UUID; subsequent runs preserve them. It does not copy development `.env` keys, localhost RPCs or Anvil wallets. Fill in your existing World, Arkiv, Resend and wallet credentials, public owner/executor addresses, mandate token, WalletConnect ID, and the three Railway/two Vercel public URLs. Fresh deployment API keys must also be configured in any SDK integrations that use them.

The second run writes the individual import files with matching secrets, public configuration and service-specific ports:

| Destination | Private import file |
| --- | --- |
| Railway daemon | `services/daemon/.env.prod` |
| Railway gateway | `services/gateway/.env.prod` |
| Railway policy | `services/policy/.env.prod` |
| Railway MCP | `scripts/.env.prod` |
| Vercel console (Production) | `apps/console/.env.prod` |
| Vercel landing (Production) | `apps/landing/.env.prod` |

Import each file into its matching service's environment variables. Do not import the entire root file into a frontend: it contains backend signing secrets. Each generated frontend file contains only that app's required variables; console service credentials remain server-only. Generated files are overwritten on rerun, so edit the root source instead. `GATEWAY_AUTH_TOKEN`, public World/Whitechain values, the publishable key, API URL and World callback URL are derived from their source settings to avoid drift.

All `.env.prod` files are ignored by Git, excluded from Docker images and created with owner-only file permissions. Railway and Next.js do **not** automatically load the `.env.prod` filename: import the values into Railway/Vercel before deploying. Vercel sets its production runtime environment itself. The script reports unresolved variable names without printing secret values.

## 2. Set shared secrets and service URLs

`pnpm setup:prod` generates independent random secrets and distributes matching values to the import files. If configuring manually, generate independent random secrets (for example `openssl rand -hex 32`) and set matching values at these destinations:

| Variable/value | Destinations |
| --- | --- |
| `AUTH_SECRET` | Vercel console + Railway daemon |
| `DAEMON_AUTH_TOKEN` | Vercel console + Railway daemon + Railway MCP |
| `POLICY_INTERNAL_TOKEN` | Railway daemon + Railway policy + Railway gateway |
| `GATEWAY_AUTH_TOKEN` | Railway gateway + Vercel console; use the **same value as policy token**, since gateway forwards it to policy |
| `BAGSEVEN_MCP_WORKER` | Railway MCP + Vercel console; one stable UUID |
| `BAGSEVEN_MCP_PUBLIC_URL` | Railway MCP + Vercel console; MCP's HTTPS base URL without `/mcp` |
| `RESEND_API_KEY`, `RESEND_FROM` | Railway daemon + Vercel console |
| `NEXT_PUBLIC_CONSOLE_URL`, `NEXT_PUBLIC_LANDING_URL` | Both Vercel projects and Railway daemon/gateway/MCP; canonical HTTPS origins |

`GATEWAY_ALLOW_UNAUTHENTICATED=false`, `MCP_OAUTH_REQUIRED=true`, `BAGSEVEN_REQUIRE_GRANT=true`. Entitlement-only connections can use prepaid credits with a living grant, holder authorization and sufficient credits. New payments through `bagseven_fetch` require a registered policy agent, mandate capacity and a living grant. Use the existing agent registration flow. Never distribute daemon tokens or World credentials to agents.

Daemon refuses production startup without `DATABASE_URL`, `REDIS_URL`, `DAEMON_AUTH_TOKEN`, `AUTH_SECRET` and `RESEND_API_KEY`. Configure `PROVIDER_ADMIN_TOKEN` on policy for provider administration. Keep signing keys in Railway; console mandate scoping only needs `DAEMON_OWNER_ADDRESS` (the operator owner wallet's public address).

## 3. Configure both Vercel projects

Import the same repository twice:

| Project | Root Directory | Env template |
| --- | --- | --- |
| Landing | `apps/landing` | `apps/landing/.env.prod` (generated from `deploy/vercel/landing.env.example`) |
| Console | `apps/console` | `apps/console/.env.prod` (generated from `deploy/vercel/console.env.example`) |

Use Next.js detection and **Node.js 24.x**. Enable access to source files outside the Root Directory so workspace packages are included. The checked-in `vercel.json` in each app installs the frozen workspace lockfile and builds that app with its dependencies through Turbo. Public environment variables are included in the Turbo cache key, so changed chain/domain configuration triggers a fresh build. Output remains `.next`.

In console variables, set `DAEMON_URL=https://<daemon-domain>` and `GATEWAY_URL=https://<gateway-domain>`. Keep `DAEMON_AUTH_TOKEN`, `GATEWAY_AUTH_TOKEN`, `AUTH_SECRET` and `RESEND_API_KEY` server-only. Do not add `NEXT_PUBLIC_` to them. Browser calls stay on `/api/daemon/*`, `/api/policy/*` and `/api/public/*`; the BFF attaches credentials and actor scope. No browser access to private Railway networking is needed.

Set both canonical frontend URLs and `NEXT_PUBLIC_BAGSEVEN_API_URL=https://<console-domain>/api/public`. Redeploy after changing `NEXT_PUBLIC_*` values because Next embeds them at build time. Set the same stable worker UUID and public MCP base in console; its existing MCP settings screen returns an HTTPS connector config when hosted. Production does not generate a worker in Vercel's ephemeral filesystem.

Set variables separately for Production and Preview in Vercel. Use separate Railway environments and credentials for previews if they should not access production data. World redirect registration is separate from CORS: use a stable console domain for World login/mint and register it with World. An arbitrary Vercel preview URL is not automatically an approved World callback.

See [Vercel monorepo setup](https://vercel.com/docs/monorepos).

## 4. Keep all three integration tracks live

| Track | Railway daemon settings | Vercel console / external setup |
| --- | --- | --- |
| World (human) | `WORLD_MOCK_PROOFS=false`; `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `WORLD_SIGNER_ADDRESS`; distinct mint/login actions; `WORLD_IDKIT_ENVIRONMENT=production` | Matching `NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_RP_ID`, mint action and environment; register the hosted console domain in World |
| World Agent Pass (OIDC) | `WORLD_AGENT_PASS_ENABLED=true`, `WORLD_CLIENT_ID`, `WORLD_CLIENT_SECRET`, `WORLD_TOKEN_AUTH_METHOD=client_secret_basic`, `WORLD_REDIRECT_URI=https://<console>/app/mint` | Register that exact callback in the Agent Pass portal; OIDC credentials are separate from IDKit credentials |
| Whitechain (payment) | `WHITECHAIN_DEMO_SETTLE=false`, `WHITECHAIN_NETWORK=testnet`, `WHITECHAIN_CHAIN_ID=1874`, live RPC, USDT address and confirmations; matching `RPC_URL`, `CHAIN_ID`; operator/executor keys for mandate spending | Matching public chain ID, USDT/RPC/explorer settings and WalletConnect project ID. Checkout pays the plan's merchant wallet |
| Arkiv (access) | `ENTITLEMENT_STORE=arkiv`, `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY`, `ARKIV_RPC_URL`, `ARKIV_CHAIN_ID=7794095` | No Arkiv signing keys in the browser; grant state remains queryable on Arkiv |

The templates target **live Whitechain testnet**, not mainnet. For mainnet, change the network, chain ID (1875), RPC, explorer and token addresses consistently on Railway and Vercel; do not mix testnet and mainnet values. `USDC_ADDRESS` is the mandate payment token configuration; use the token actually deployed in the mandate. A separate optional `BAGSEVEN_X402_PAYER_KEY` on daemon is needed for x402-funded provider requests; it must differ from operator/enforcer keys. `WHITECHAIN_PRIVATE_KEY`/`WHITECHAIN_PAY_TO` are optional legacy utility settings, not the provider checkout recipient.

Keep the dual-gate intact for new payments through `bagseven_fetch`: these need both remaining mandate capacity and a living grant. `paid_run`, `consume_entitlement` and SDK usage consume already-paid credits with grant/holder checks and do not require a USDT mandate. A verified payment sets `paid_through`; canceling renewal does not revoke paid time. Hosting and CORS do not bypass these conditions. Policy can optionally use `MANDATE_DEPLOYER_KEY` for deployment gas; otherwise it uses the executor key.

## 5. CORS and domains

All Node services and MCP accept HTTPS origins ending in `.vercel.app` or `.railway.app` (including `.up.railway.app`). Matching uses parsed hostnames, so lookalikes such as `app.vercel.app.evil.com` are rejected. Custom canonical frontend URLs are also accepted. Set `CORS_ORIGIN=https://app.cesthq.com,https://cesthq.com` to add other custom origins. Local HTTP origins work automatically outside production. `BAGSEVEN_MCP_CORS_ORIGIN` can override MCP's additional origin list.

Per your hosting preference, any tenant's HTTPS Vercel/Railway deployment can make browser requests. Service authentication still applies; cross-origin cookies are not enabled. `CORS_ORIGIN=*` remains an explicit opt-in for arbitrary origins. Do not configure wildcard credentialed CORS on the Vercel BFF; its browser requests use same-origin secure session cookies.

Keep World callback validation and MCP OAuth callback validation independent of CORS. For ChatGPT, use `https://<mcp-domain>/mcp` as the connector URL; Railway provides HTTPS directly, so no tunnel is needed.

## 6. Verify after deploying

Before deployment, run `pnpm integrations:check --env-file .env.prod` for read-only checks of the production configuration and live Whitechain RPC/token. It reports unresolved variable names without printing credentials and exits nonzero until required settings are supplied. This does not replace human World consent, a verified checkout, Arkiv access checks or hosted acceptance testing.

1. Confirm daemon, gateway and MCP `https://<domain>/healthz` return `ok: true`; check policy `/healthz` from inside Railway.
2. Confirm an OPTIONS request with `Origin: https://<console>.vercel.app` returns `access-control-allow-origin` matching that origin. Repeat with the custom console domain if used.
3. Sign into the console with World, mint an entitlement, and confirm the Arkiv record is queryable. Verify payment on the configured Whitechain network and refresh the grant.
4. Verify checkout/credit mail reaches the signed-in actor; verify DKIM/SPF for `cesthq.com` in Resend. `AUTH_ALLOWLIST` empty allows any verified email for recovery; World remains the primary login.
5. Connect MCP over HTTPS, finish World-gated OAuth, call `bagseven_status` and `grant_status`. Test `paid_run` with `feature: "ocr"` using prepaid credits in entitlement-only mode. Register an agent with a funded mandate before testing new payments through `bagseven_fetch`, and verify both payment gates.
6. Redeploy daemon and confirm custom features persist on `/data` and grants persist on Arkiv. Redeploy MCP and reconnect/authorize the client.

Local setup stays `pnpm setup` then `pnpm start:local`; `deploy/docker-compose.yml` and `deploy/ecosystem.config.cjs` remain available for local/VM use. Do not copy local `.env` files into deployment images.
