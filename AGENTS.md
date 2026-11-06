# Agent instructions (Bagseven)

You are working in the **Bagseven** monorepo. Prefer the live product path over leftover demos.

## Product path

- Landing: `apps/landing` → http://localhost:3001
- Dashboard: `apps/console` → http://localhost:3000/app
- Backend: `services/gateway` `:4000`, `services/daemon` `:4001`, `services/policy` `:4003`
- Start: `pnpm run setup` then `pnpm start:local`
- Design tokens: `docs/design.md` (Fianto: `--blue #0002f8`, landing dark, dashboard `#f2f2f2`)

Do **not** add another UI, port, or marketing chrome inside the dashboard. Do **not** revive `bag-dashboard` or an inspector on `:3010`.

There is no research-demo app. Do not add one.

## Dual-gate

Paid work (`paid_run`, `bagseven_fetch`) needs mandate remaining **and** a living Arkiv grant. Access evaporates at `paid_through`. `cancel_renewal` does not kill current access.

Browser never holds `DAEMON_*` keys. Dashboard uses `/api/daemon/*` BFF.

## Auth + email

Magic link in `apps/console/lib/auth.ts` is a signed token (any email unless `AUTH_ALLOWLIST`). Set cookies on the **redirect response** (`attachSessionCookie`). Resend: `packages/notify` from `bags@cesthq.com`. Grant mails go to the signed-in actor (`x-bagseven-actor`) plus optional `OPERATOR_NOTIFY_EMAIL`.

Production: `AUTH_SECRET`, `DAEMON_AUTH_TOKEN`, `RESEND_API_KEY`. Hosting: `docs/HOSTING.md`. Developer map: `docs/DEVELOPERS.md`.

## Docs for models

- `llms.txt` — compact context
- `docs/README.md` — index
- `docs/hackathon/` — Mumbai notes, not the product README

## Commands

```bash
pnpm start:local
pnpm smoke
pnpm --filter @bagseven/console typecheck
pnpm --filter @bagseven/daemon typecheck
```
