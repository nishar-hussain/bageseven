# Hosting Bagseven: Vercel + Railway

Use **two Vercel projects** and **three Railway application services**, plus Railway Postgres and Redis. The default deployment shares daemon and MCP in one container so the backend fits a five-service Railway project. Keep the existing product paths.

```text
Vercel landing (apps/landing)
Vercel console (apps/console, including Next API/BFF routes)
  ├── HTTPS + service Bearer → Railway daemon
  └── HTTPS + service Bearer → Railway gateway
Railway gateway / daemon → private network → Railway policy
Railway MCP → local HTTP + Bearer → Railway daemon (shared container)
ChatGPT / Cursor → HTTPS OAuth → daemon's public URL /mcp
Railway services → Railway Postgres + Redis
Daemon → World, Whitechain and Arkiv
```

Vercel runs the console's Next API routes; all long-lived backend services run on Railway. No additional frontend or inspector is needed. Production uses external Whitechain RPC, not Anvil.

## 1. Create Railway services

### Recommended: configure the entire project together

The repository includes `.railway/railway.ts`, using Railway's project-wide Infrastructure as Code API. It declares daemon (including MCP), gateway, policy, managed Postgres and Redis, and a persistent daemon volume in **one project/environment in one account**. Workspace packages are installed and built inside each backend image; they are not separate hosted services. Whitechain, Arkiv, World and Resend remain external integrations configured through credentials/RPC URLs.

`.railway/deployment.json` selects `embeddedMcp: true` by default. In this mode daemon's Railway `PORT` and public domain target are **4009**; `node scripts/start-daemon.mjs` supervises daemon on internal 4001 and MCP on public 4009. MCP routes `/internal/*` and daemon `/v1/*` APIs locally while preserving caller authorization; it never adds a service token. `/mcp`, `/v1/mcp`, OAuth and discovery stay on MCP. `/healthz` is ready only when the local daemon is healthy. Either process exiting stops the container. Use the **same public HTTPS origin** for `DAEMON_URL` and `BAGSEVEN_MCP_PUBLIC_URL`. Gateway remains public on 4000 and policy private on 4003.

To use four separate application services, set `embeddedMcp: false`, regenerate import files, review/apply the IaC plan, and use separate daemon (4001) and MCP (4009) domains. Switching modes restarts MCP and invalidates its process-local OAuth sessions.

Selecting a GitHub repository alone does not create the other services or databases. To prepare the full graph:

1. Run `pnpm install --frozen-lockfile`, then `pnpm setup:prod`. Fill the root `.env.prod` and run `pnpm setup:prod` again.
2. Install the current Railway CLI, run `railway login`, and `railway link` to **your existing project and environment**. All resources must live in that same environment for private references to resolve.
3. In Railway's environment **Shared Variables**, import the ignored `.railway/.env.prod` generated above. It contains the matching secrets/configuration referenced by the services. Do not commit or publish it. Service variables receive only their declared subset.
4. Run `pnpm check:railway`, then `railway config plan`. Review the plan against your existing resources. If Railway reports legacy config ownership, follow its migration instructions and clear the service's legacy config file path before planning again. For an existing deployment with different database names or volumes, preserve those resources by importing with `railway config pull` and adapting the graph; do not apply a plan that replaces your data services.
5. Run `railway config apply` to apply the reviewed plan. The GitHub source is `nishar-hussain/bageseven`, branch `main`, root `/`. Grant Railway access to that repository. Generate public domains for daemon/MCP (4009) and gateway (4000). Keep policy private.
6. Fill the resulting public URLs in root `.env.prod`, rerun `pnpm setup:prod`, reimport `.railway/.env.prod` into Shared Variables and import the generated app files into Vercel. Run `pnpm check:prod`, then redeploy affected services and frontends. Daemon's pre-deploy command applies migrations; verify it succeeds before using the other services.

The CLI evaluates this file and applies project configuration; a GitHub push by itself does not apply infrastructure changes. Subsequent application deployments use each configured GitHub source. Public domains and external integration credentials still need to be configured before login, billing and MCP can work end to end. New projects may initially show failed deployments until these variables are supplied.

Railway's current documentation recommends IaC for new services and deprecates `railway.json`/`railway.toml`; see [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code) and its [API reference](https://docs.railway.com/infrastructure-as-code/reference). The service-specific JSON files below are retained for existing legacy deployments, not the new-project provisioning path.

### Existing legacy config-as-code deployments

The following four-service table describes separate MCP mode (`embeddedMcp: false`). For the default shared mode, omit the MCP service, use daemon port 4009, and import the generated daemon variables with `BAGSEVEN_MCP_EMBEDDED=true`.

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

### Verify the repository image locally

```bash
pnpm check:railway
docker build -f deploy/Dockerfile.backend -t bagseven-backend:railway-check .
pnpm test:railway-image
```

The image smoke test creates disposable Postgres 17 and Valkey 8 containers on an isolated Docker network, migrates a clean database and starts separate and shared-container production modes. It checks gateway-to-policy database access, health endpoints, daemon authentication, MCP OAuth discovery/gating and authenticated database-backed API access through the combined public port, then removes its containers/network. It uses no production credentials or host ports and cannot make external blockchain calls. Hosted World consent, provider gas funding, customer checkout and actual Railway resource health require separate live verification.

### Prepare the production environment files

If daemon logs `refusing to start — missing env: DATABASE_URL, REDIS_URL`, open **daemon → Variables** in the same Railway environment as your databases and add references to the databases there. For services named `Postgres` and `Redis`:

```dotenv
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Use the actual database service names, including their capitalization. Repeat for policy and gateway. Adding databases to the project canvas or importing Shared Variables alone does not attach variables to an application service. If using shared variables instead, attach them through Railway's Share control, or add `DATABASE_URL=${{shared.DATABASE_URL}}` and `REDIS_URL=${{shared.REDIS_URL}}` in each application service. `setup:prod` includes the database references in both shared and service import files. Deploy the staged variable changes and rerun failed deployments/migrations. See [Railway variables](https://docs.railway.com/variables).

Do not copy database credentials to Vercel. The console import file has public backend URLs and server-held service tokens; it connects through the backend. Import it into Vercel Production variables and redeploy: the ignored `.env.prod` file is not loaded by hosting automatically.

From the repository root:

```bash
pnpm setup:prod
# Edit .env.prod: replace hosted domain and provider credential placeholders.
pnpm setup:prod
pnpm check:prod
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
| `PROVIDER_GAS_ENCRYPTION_KEY` | Vercel console + Railway daemon + Railway policy; one stable 64-character hex key, generated by `setup:prod`. Back it up before providers deposit funds; reruns preserve it. |
| `DAEMON_AUTH_TOKEN` | Vercel console + Railway daemon + Railway MCP |
| `POLICY_INTERNAL_TOKEN` | Railway daemon + Railway policy + Railway gateway |
| `GATEWAY_AUTH_TOKEN` | Railway gateway + Vercel console; use the **same value as policy token**, since gateway forwards it to policy |
| `BAGSEVEN_MCP_WORKER` | Railway MCP + Vercel console; one stable UUID |
| `BAGSEVEN_MCP_PUBLIC_URL` | Railway MCP + Vercel console; MCP's HTTPS base URL without `/mcp` |
| `RESEND_API_KEY`, `RESEND_FROM` | Railway daemon + Vercel console |
| `NEXT_PUBLIC_CONSOLE_URL`, `NEXT_PUBLIC_LANDING_URL` | Both Vercel projects and Railway daemon/gateway/MCP; canonical HTTPS origins |

`GATEWAY_ALLOW_UNAUTHENTICATED=false`, `MCP_OAUTH_REQUIRED=true`, `BAGSEVEN_REQUIRE_GRANT=true`. Entitlement-only connections can use prepaid credits with a living grant, holder authorization and sufficient credits. New payments through `bagseven_fetch` require a registered policy agent, mandate capacity and a living grant. Use the existing agent registration flow. Never distribute daemon tokens or World credentials to agents.

Daemon refuses production startup without `DATABASE_URL`, `REDIS_URL`, `DAEMON_AUTH_TOKEN`, `AUTH_SECRET` and `RESEND_API_KEY`. Configure `PROVIDER_ADMIN_TOKEN` on policy for provider administration. Keep signing keys in Railway; console mandate scoping only needs `DAEMON_OWNER_ADDRESS` (the operator owner wallet's public address).

`pnpm check:prod` validates the private source, public origins, live-mode flags, chain settings and matching imported secrets without printing values or making transactions. It exits unsuccessfully while required setup is missing. `pnpm integrations:check --env-file .env.prod` additionally reads the World/Whitechain configuration and live Whitechain RPC. Neither command replaces hosted login and customer checkout verification.

`pnpm check:hosted` verifies the configured public backend and dashboard endpoints, live Arkiv reads, authenticated database routing and World challenge signing. It creates short-lived verification nonces, but no payments, grants or emails. The console's World readiness endpoint asks the daemon which owns the RP key; do not copy `WORLD_RP_SIGNING_KEY` into Vercel to make the login button appear.

If the official Railway plugin reports `invalid_redirect_uri`, its requested callback differs from its OAuth client's registered callback. Repository `.env.prod` and World callbacks do not control that plugin registration. Start a fresh plugin authorization; if it persists, report it to the integration maintainer. The supported alternative is `npx --yes @railway/cli login --browserless`, then `npx --yes @railway/cli link` to your existing project/environment. Complete the CLI's device authorization yourself; never paste account tokens into chat.

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
| Arkiv (access) | `ENTITLEMENT_STORE=arkiv`, `ARKIV_ACCESS_KEY`, `ARKIV_RPC_URL`, `ARKIV_CHAIN_ID=7794095`, `PROVIDER_GAS_ENCRYPTION_KEY` | No Arkiv signing keys in the browser; grant state remains queryable on Arkiv |

The templates target **live Whitechain testnet**, not mainnet. For mainnet, change the network, chain ID (1875), RPC, explorer and token addresses consistently on Railway and Vercel; do not mix testnet and mainnet values. `USDC_ADDRESS` is the mandate payment token configuration; use the token actually deployed in the mandate. Provider-funded x402 currently requires a separate payer integration; platform BAGSEVEN_X402_PAYER_KEY fallback is disabled in provider-funded mode. `WHITECHAIN_PRIVATE_KEY`/`WHITECHAIN_PAY_TO` are optional legacy utility settings, not the provider checkout recipient.

Keep the dual-gate intact for new payments through `bagseven_fetch`: these need both remaining mandate capacity and a living grant. `paid_run`, `consume_entitlement` and SDK usage consume already-paid credits with grant/holder checks and do not require a USDT mandate. A verified payment sets `paid_through`; canceling renewal does not revoke paid time. Hosting and CORS do not bypass these conditions. Provider-funded mode uses dedicated provider accounts for transaction fees, with no platform-key fallback. Run database migration 0008, set the same PROVIDER_GAS_ENCRYPTION_KEY on console/daemon/policy, and authorize/fund each provider account from the dashboard. Back up the encryption key before accepting deposits.

## 5. CORS and domains

All Node services and MCP accept HTTPS origins ending in `.vercel.app` or `.railway.app` (including `.up.railway.app`). Matching uses parsed hostnames, so lookalikes such as `app.vercel.app.evil.com` are rejected. Custom canonical frontend URLs are also accepted. Set `CORS_ORIGIN=https://app.cesthq.com,https://cesthq.com` to add other custom origins. Local HTTP origins work automatically outside production. `BAGSEVEN_MCP_CORS_ORIGIN` can override MCP's additional origin list.

Per your hosting preference, any tenant's HTTPS Vercel/Railway deployment can make browser requests. Service authentication still applies; cross-origin cookies are not enabled. `CORS_ORIGIN=*` remains an explicit opt-in for arbitrary origins. Do not configure wildcard credentialed CORS on the Vercel BFF; its browser requests use same-origin secure session cookies.

Keep World callback validation and MCP OAuth callback validation independent of CORS. For ChatGPT, use `https://<mcp-domain>/mcp` as the connector URL; Railway provides HTTPS directly, so no tunnel is needed.

## 6. Verify after deploying

Before deployment, run `pnpm integrations:check --env-file .env.prod` for read-only checks of the production configuration and live Whitechain RPC/token. It reports unresolved variable names without printing credentials and exits nonzero until required settings are supplied. This does not replace human World consent, a verified checkout, Arkiv access checks or hosted acceptance testing.

1. Confirm daemon, gateway and MCP `https://<domain>/healthz` return `ok: true`; check policy `/healthz` from inside Railway.
2. Confirm an OPTIONS request with `Origin: https://<console>.vercel.app` returns `access-control-allow-origin` matching that origin. Repeat with the custom console domain if used.
3. Sign into the console with World. In Tracks, connect the provider owner wallet, review and sign the provider gas limits, and fund the dedicated address with WBT and tGLM on their respective networks. Create a plan with the provider's merchant wallet, then complete a customer checkout with a wallet-approved USDT transfer. Confirm the payment on Whitechain and query the issued Arkiv grant. An unfunded provider must be blocked before the customer pays.
4. Verify checkout/credit mail reaches the signed-in actor; verify DKIM/SPF for `cesthq.com` in Resend. `AUTH_ALLOWLIST` empty allows any verified email for recovery; World remains the primary login.
5. Connect MCP over HTTPS, finish World-gated OAuth, call `bagseven_status` and `grant_status`. Test `paid_run` with `feature: "ocr"` using prepaid credits in entitlement-only mode. Register an agent with a funded mandate before testing new payments through `bagseven_fetch`, and verify both payment gates.
6. Redeploy daemon and confirm custom features persist on `/data` and grants persist on Arkiv. Redeploy MCP and reconnect/authorize the client.

Local setup stays `pnpm run setup` then `pnpm start:local`; `deploy/docker-compose.yml` and `deploy/ecosystem.config.cjs` remain available for local/VM use. Do not copy local `.env` files into deployment images.
