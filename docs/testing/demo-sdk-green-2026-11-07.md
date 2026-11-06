# Demo dapp + SDK green signal — 2026-11-07

## Root causes fixed

1. **SDK embed stacked multiple bodies** — `showPricing` / `showCheckout` / `showPortal` / `showCustomer` also OR’d the seed `component` view, so navigating pricing → checkout left both sections mounted and only the last looked “full”. Now each body keys only off live `view`.
2. **Demo mounted two embeds** — replaced with **one** `BagsevenEmbed` (full by default) + component switcher.
3. **React flags stuck off** — `identify()` + immediate `refresh()` raced (`holder` still null). `BagsevenProvider` now accepts `holder`; demo passes it from bootstrap. `useFlag` no longer forces `false` while `pending`.
4. **Vite IPv6-only bind** — demo web listens on `127.0.0.1:5177` so IPv4 clients/tools work.

## Live verification

| Surface | Result |
| --- | --- |
| `pnpm --filter @bagseven/demo-dapp check` | PASSED (daemon, boolean/numeric, identify, consume, list) |
| Demo UI `http://127.0.0.1:5177` | `useFlag('pro_notes') → true`, Pro unlocked, OCR credits, **1** pricing table |
| Component switcher | Single-component mode (no Plan/Pricing tabs); Full embed restores tabs |
| Console `/app`, builder, arkiv, plans, developers | HTTP 200 / Overview·Builder·Arkiv studio render |
| API matrix | plans, access-tokens, entitlements, check, consume burn, checkout PENDING, features, live grants, WHITECHAIN_PAY_TO |

**Score:** 36/36 GREEN when `/healthz` is called with daemon auth (unauthenticated `/healthz` correctly returns 401).

## URLs

- Demo: http://127.0.0.1:5177/
- Demo API: http://127.0.0.1:5178/
- Console: http://127.0.0.1:3000/app
- Daemon: http://127.0.0.1:4001
