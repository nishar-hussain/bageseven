# Platform audit — 2026-11-07

Full three-track + product surface audit (API + BrowserOS neo). Not mock settlement.

## Three tracks

| Track | Mode | Evidence |
| --- | --- | --- |
| **World** | IDKit configured (`app_2fbc…`), `mock_proofs=true` for mint shortcuts; console login uses live World RP config | `/internal/mumbai/status` + `/api/auth/world` 200 |
| **Whitechain** | **Live testnet 1874**, `demo_settle=false`, real USDT transfer + EIP-191 auth | tx `0xcada9d10…4308e3` → [explorer](https://explorer.testnet.whitechain.io/tx/0xcada9d10ebbcfff0ee94d696fbe89ebedbde200f7ef5c6416cd95f99464308e3) |
| **Arkiv** | `store=arkiv` live (not memory) | grant mint returns `arkiv_entity_key=0x490eef2a…` |

## API matrix (`scripts/platform-audit.mjs`)

**18 green / 0 red** with `WHITECHAIN_DEMO_SETTLE=false`:

- daemon + track configs
- boolean + numeric features
- plans catalog / publishable key
- embed identify → checkout → **real USDT pay** → confirm (`verification=verified`) → living entitlement
- cancel renewal (access until `paid_through`)
- boolean check still enabled after cancel
- console BFFs `/api/auth/world`, `/api/public/plans`

## Browser (neo)

Walked `/app`, `/app/plans`, `/app/builder`, `/app/features`, `/app/grants`, `/app/developers`, `/app/sdk`, `/embed?component=cmp_pricing`.

- Builder shows plan table + `cmp_pricing` component picker
- Embed pricing table renders (Plans / Choose plan / Sign in to subscribe when no customer token)
- Sessioned console nav works end-to-end

## Fixes landed during audit

1. Restarted daemon so `POST /v1/entitlements/:id/cancel-renewal` is registered (was stale process → 401/404)
2. Console SDK subpath resolution via `apps/console/lib/bagseven-sdk-*.ts` re-exports (Turbopack + workspace exports)
3. Forced real payment path in audit; corrected EIP-191 message to `paymentAuthorizationMessage`

## Residual

- `WORLD_MOCK_PROOFS=true` still allows mock World proofs for mint — login/IDKit itself is configured live. Turn mock off for production mint gate.
- Embed public pricing needs `pk` (plans) + customer `accessToken` (subscribe). Expired preview tokens return 401 on entitlements (expected).
