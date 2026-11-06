# Hosting Bagseven

Ship **two public sites** and **three Node services** plus Postgres + Redis.

```
cesthq.com (or bagseven.*)     → apps/landing   :3001
app.cesthq.com                 → apps/console   :3000
api / private network          → gateway :4000, daemon :4001, policy :4003
Postgres + Redis               → deploy/docker-compose.yml
```

Console `NEXT_PUBLIC_LANDING_URL` and landing `NEXT_PUBLIC_CONSOLE_URL` must be the public HTTPS URLs.

## Required env (production)

```
NODE_ENV=production
DATABASE_URL=
REDIS_URL=
AUTH_SECRET=                 # long random; shared by all console instances
DAEMON_AUTH_TOKEN=           # console BFF → daemon
DAEMON_URL=http://daemon:4001
POLICY_URL=http://policy:4003
RESEND_API_KEY=
RESEND_FROM="Bagseven <bags@cesthq.com>"
OPERATOR_NOTIFY_EMAIL=bags@cesthq.com   # ops copy of grant events; not a login allowlist
AUTH_ALLOWLIST=              # empty = any email (launch default)
NEXT_PUBLIC_CONSOLE_URL=https://app.cesthq.com
NEXT_PUBLIC_LANDING_URL=https://cesthq.com
```

Daemon **refuses boot** in production without `DAEMON_AUTH_TOKEN`, `AUTH_SECRET`, `RESEND_API_KEY`.

Tracks when you go live:

```
WORLD_MOCK_PROOFS=false
WORLD_CLIENT_ID=
WHITECHAIN_DEMO_SETTLE=false
WHITECHAIN_PRIVATE_KEY=
WHITECHAIN_PAY_TO=
BAGSEVEN_PUBLISHABLE_KEY=
BAGSEVEN_SECRET_KEY=
ARKIV_ACCESS_KEY=
ARKIV_PRIVATE_KEY=
```

Never put operator keys in the browser. Cookie `Secure` is on when `NODE_ENV=production`.

## Path A — one VM (pm2)

```bash
pnpm setup --skip-docker   # or with docker for Postgres/Redis
pnpm build
pnpm db:migrate
pnpm pm2:start
```

`deploy/ecosystem.config.cjs` runs gateway, daemon, policy, console `:3000`, landing `:3001`. Put Caddy/nginx in front:

- `cesthq.com` → `127.0.0.1:3001`
- `app.cesthq.com` → `127.0.0.1:3000`

TLS on the proxy. Copy `.env` onto the box; do not commit it.

## Path B — Docker data + process split

```bash
pnpm db:up          # Postgres 55432, Redis 56379
# run Node services on the host or in your own containers
```

Point `DATABASE_URL` / `REDIS_URL` at those ports (or internal Docker DNS).

## Path C — Vercel (frontends) + Fly/Render (API)

1. Landing: Vercel project root `apps/landing`, env `NEXT_PUBLIC_CONSOLE_URL`.
2. Console: Vercel project root `apps/console`, env `AUTH_SECRET`, `DAEMON_URL`, `DAEMON_AUTH_TOKEN`, `RESEND_*`, `REDIS_URL` unused for auth (magic links are signed).
3. Daemon / policy / gateway: Fly or Render, same `.env`, private networking. Console must reach `DAEMON_URL` over HTTPS or a private mesh.

Magic links are **HMAC**, not in-process memory, so multiple console instances are fine if they share `AUTH_SECRET`.

## Email domain

Sending domain **cesthq.com**, from `bags@cesthq.com`. Verify DKIM/SPF in Resend + Cloudflare. The API key in `.env` is sending-only; manage the domain in the Resend UI.

## Checklist before launch

- [ ] Landing and app URLs HTTPS, cookies on the app host
- [ ] `AUTH_ALLOWLIST` empty (open sign-in) or an invite list
- [ ] Resend test: sign in from a personal inbox, not only bags@
- [ ] Mint / credits emails arrive for that inbox
- [ ] Mock flags off if you are claiming live World / Whitechain / Arkiv
- [ ] `pnpm smoke` against the hosted daemon
