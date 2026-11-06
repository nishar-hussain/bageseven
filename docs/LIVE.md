# Go live checklist (no mock)

Bagseven has three tracks. Flip each when the credentials below are present, then **restart** `pnpm start:local`.

## Already in your `.env` (from this machine)

| Track | Status | Notes |
| --- | --- | --- |
| World IDKit | **Ready** — `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` set | Set `WORLD_MOCK_PROOFS=false` (done). Login + mint use real World App QR. |
| Arkiv | **Ready** — access + private key, `ENTITLEMENT_STORE=arkiv` | Grants are live entities. |
| Resend | **Ready** — `RESEND_API_KEY` | Email OTP + recovery links. |
| SDK keys | **Generated** — `BAGSEVEN_SECRET_KEY` / `BAGSEVEN_PUBLISHABLE_KEY` | Use `pk_` in React, `sk_` on server. |

## You still need to supply

### 1. Whitechain money (buyer pay + operator stamp)

For **real** USDT checkout confirm (not demo tx):

```bash
WHITECHAIN_DEMO_SETTLE=false
WHITECHAIN_NETWORK=testnet
WHITECHAIN_RPC_URL=https://rpc.testnet.whitechain.io
WHITECHAIN_USDT=0xaa7962d073935D387e8d442DA1D7149C81388f46
WHITECHAIN_PAY_TO=0xYourMerchantTreasury
WHITECHAIN_PRIVATE_KEY=0x…   # only for operator Credits stamp; buyers sign in wallet
```

Also put test WBT (gas) + USDT in the buyer wallet on Whitechain Testnet (1874). Portal bridge: https://bridge.testnet.whitechain.io

Optional (WalletConnect modal polish):

```bash
NEXT_PUBLIC_REOWN_PROJECT_ID=…   # from https://dashboard.reown.com
```

### 2. World Agent Pass (optional second door)

IDKit is enough for login + uniqueness. Agent Pass OIDC is only if you want Google/World IdP authorize:

```bash
WORLD_CLIENT_ID=…
WORLD_CLIENT_SECRET=…
WORLD_REDIRECT_URI=http://127.0.0.1:3000/app/mint
```

### 3. Production hosting

```bash
NODE_ENV=production
AUTH_SECRET=…          # already set locally
DAEMON_AUTH_TOKEN=…
RESEND_API_KEY=…
WORLD_MOCK_PROOFS=false
WHITECHAIN_DEMO_SETTLE=false
```

## How to verify

1. Login → **Continue with World ID** (scan with World App) — mock button should be gone when `WORLD_MOCK_PROOFS=false`.
2. Tracks page → World IDKit · Arkiv Live · Whitechain shows Demo until you set `WHITECHAIN_DEMO_SETTLE=false` + keys.
3. Plans → Checkouts → pay with wallet (or Builder preview) → grant appears on Entitlements.
4. `pnpm sdk:demo` against a running daemon.

## Intentionally not mock forever

| Surface | Live behavior |
| --- | --- |
| Dashboard login | World IDKit |
| Email | OTP verify-later (Resend) |
| Checkout pay | Buyer wallet USDT on 1874 |
| Access | Arkiv living grant |
| Agent spend | MCP dual-gate |
