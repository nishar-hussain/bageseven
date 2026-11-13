# Deployment

Use the current checkout's `docs/HOSTING.md`, `deploy/railway/*.json` and templates as the exact setup contract.

| Surface | Hosting | Root/config |
| --- | --- | --- |
| Landing | Separate Vercel project | `apps/landing`, app `vercel.json` |
| Console and its Next API/BFF routes | Separate Vercel project | `apps/console`, app `vercel.json` |
| Daemon | Railway | Repository root `/`; root `railway.json` defaults to daemon |
| Gateway | Railway | Repository root `/`; `/deploy/railway/gateway.json` |
| Policy | Railway, private only | Repository root `/`; `/deploy/railway/policy.json` |
| MCP | Railway, public HTTPS `/mcp` | Repository root `/`; `/deploy/railway/mcp.json` |
| Postgres and Redis | Railway | Managed persistent data services |

Selecting the root does not create all four Railway application services. The shared backend Dockerfile builds workspace dependencies on Node 24. Service `PORT` takes precedence over local defaults; `HOST=::` accepts IPv4/IPv6. Private service URLs must use the selected target service's port.

Vercel cannot resolve Railway private DNS. Console `DAEMON_URL` and `GATEWAY_URL` use public HTTPS, with credentials held by Next API routes. Internal Railway calls use private service references. Browser requests stay on the existing BFF paths.

## Private environment files

`pnpm setup:prod` creates a root `.env.prod` source if missing and regenerates the six per-service import files. It preserves existing root values, derives shared public settings and matches service tokens. Edit the root source, then rerun. It does not automatically copy local `.env` credentials.

Import files are `services/{daemon,gateway,policy}/.env.prod`, `scripts/.env.prod` for MCP, and `apps/{console,landing}/.env.prod`. They are ignored by Git and excluded from Docker. Railway and Next do not automatically load the `.env.prod` filename; import values into hosting variables. Railway `${{...}}` references are platform substitutions, not shell variables.

Use the same daemon token in daemon/MCP/console, the same auth secret in daemon/console, and the same policy token for policy/gateway/daemon; gateway forwards its service Bearer to policy. Keep signing keys only where needed. Public frontend values must agree with the backend's selected email and wallet/Avalanche network.

Never assume local `.env` wallets are production credentials. Known Anvil keys, local database/RPC URLs, mock flags and demo settlement must not become live deployment defaults. Preserve valid user-provided credentials without printing them.

## Live tracks and persistence

- email and wallet: valid IDKit app/RP/signing configuration; separate OIDC client/secret when Agent Pass is enabled; exact hosted callback and allowed domain registration. CORS permission does not approve a email and wallet callback.
- Avalanche: matching network, chain ID, RPC, token and confirmations across frontend/backend. Current defaults use live testnet 43113; mainnet uses 43114 and separately configured token/RPC addresses. A local Anvil chain with ID 43113 is still local.
- Avalanche registry: `ENTITLEMENT_STORE=avalanche` plus actual access/signing keys; no silent memory fallback for live access.
- Daemon: persistent volume `/data` with `BAGSEVEN_DATA_DIR=/data` for custom features; one replica unless shared state is redesigned.
- MCP: keep one long-lived replica with sleep disabled; restart loses session/OAuth maps, so clients reinitialize and reauthorize.
- Database: daemon pre-deploy runs migrations; avoid concurrent migration jobs on every service.

Hosted CORS accepts HTTPS Vercel/Railway deployment origins plus configured custom origins. CORS does not authorize server calls or bypass cookies/Bearer checks. Avoid credentialed wildcard CORS on the console BFF.

Verify `/healthz` for process health, then database-backed reads and the actual live integrations. Do not claim full readiness from a health endpoint alone or turn off auth just to get a green probe.
