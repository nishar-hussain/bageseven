# World ID + Whitechain Sepolia

The product uses World ID for the operator identity, Whitechain USDT.e for payment, Arkiv for living entitlements, and an on-chain mandate for agent spending. A successful login is not a payment, and a submitted transaction is not a confirmed payment.

## This app

The local `.env` is configured with:

| Setting | Value |
| --- | --- |
| World App ID | `app_2fbcce39ee3d84e3be6f2f6bbaaac9da` |
| World RP ID | `rp_3075b0deaed3dcd9` |
| Registered RP signer | `0x3b0F94f633d0c7958FE13041958A42872dFbA3aB` |
| World action | `bagseven-mint` |
| World environment | `production` |
| Whitechain network | Sepolia, chain `1874` |
| RPC | `https://rpc.testnet.whitechain.io` |
| Configured test USDT | `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` |

The RPC was checked directly: chain 1874. The funded token currently configured in `.env` reports `USDT` and 6 decimals at `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`. The earlier bridged USDT.e contract (`0xaa7962d073935D387e8d442DA1D7149C81388f46`) is a different token. Set `WHITECHAIN_USDT`, the legacy `USDC_ADDRESS`, and `NEXT_PUBLIC_WHITECHAIN_USDT` consistently; mandate creation and checkout now use the shared server configuration. The shorter address ending in `88f4` is invalid. The [official network reference](https://docs.whitechain.io/learn/network/reference) identifies the current Sepolia RPC and chain ID; legacy Whitechain testnet 2625 is a different network.

## Finish the local configuration

Fill these existing placeholders in `.env` locally:

```dotenv
# Required: the private RP key whose public address is WORLD_SIGNER_ADDRESS.
WORLD_RP_SIGNING_KEY=
# Optional: legacy direct Mint / Buy credits utilities only.
# Normal B2B checkout uses each plan merchant_wallet.
WHITECHAIN_PAY_TO=
# Optional: a dedicated operator-funded settlement key. Normal buyers use their wallet.
WHITECHAIN_PRIVATE_KEY=
```

The World signing key is not a payment wallet key. It stays server-side and is checked against the registered signer before issuing a challenge. Do not put it in a `NEXT_PUBLIC_*` variable. The World action must match the intended Developer Portal action. World OIDC `WORLD_CLIENT_ID` / `WORLD_CLIENT_SECRET` are separate credentials; the App ID is not an OIDC client secret.

These are already set for the live path:

```dotenv
WORLD_MOCK_PROOFS=false
WORLD_SKIP_JWKS=false
WHITECHAIN_DEMO_SETTLE=false
WHITECHAIN_CONFIRMATIONS=2
CHAIN_ID=1874
WHITECHAIN_CHAIN_ID=1874
RPC_URL=https://rpc.testnet.whitechain.io
WHITECHAIN_RPC_URL=https://rpc.testnet.whitechain.io
```

Fund the buyer wallet with test WBT for gas and USDT.e for the purchase. The mandate executor also needs test WBT, and the mandate vault must hold the configured token. A Fuji mandate or a worker UUID without a deployed Whitechain mandate cannot authorize spending. Never substitute a 1-wei native transfer for a USDT payment.

Use the [Whitechain faucet](https://faucet.testnet.whitechain.io/) and [testnet bridge](https://bridge.testnet.whitechain.io/) as appropriate. The existing executor had zero gas and zero USDT.e at the read-only check in this integration run.

## Start and verify

```sh
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm build
pnpm start:local
pnpm integrations:check
```

`integrations:check` reads configuration, checks that the RP key matches the public signer, verifies the RPC chain and token metadata, and checks executor gas. It does not sign a proof, transfer funds, deploy a contract, or mint a grant. It exits nonzero for missing setup instead of reporting mock success.

1. Open `/app/login`, continue with World ID, and approve the request in World App. The public login challenge works without an existing console session. World verification uses the [official RP verify API](https://docs.world.org/api-reference/developer-portal/verify) (`POST https://developer.world.org/api/v4/verify/{rp_id}`) and forwards the IDKit result as-is ([integrate](https://docs.world.org/world-id/idkit/integrate)).
2. Platform auth: console session is required for `/app/*`, `/api/daemon/*`, `/api/billing/*`, and `/api/policy/*`. Gateway `:4000` requires `Authorization: Bearer` (`GATEWAY_AUTH_TOKEN` or `POLICY_INTERNAL_TOKEN`). Mock World login only when `WORLD_MOCK_PROOFS=true` outside production.
3. Open Plans, enter or connect the provider payout wallet, and create a plan. Customers buy via Builder/Embed (sessions minted by your backend) — not a payment-link catalog.
4. Check Entitlements, then use the SDK or MCP. Paid work checks mandate capacity and the living grant (dual-gate).
5. MCP OAuth requires a fresh World proof; knowing a holder's email or finding a grant is not authentication.

Plans and checkout sessions are stored in PostgreSQL. Console lists and creation are scoped to the signed-in provider; the server-side SDK secret remains an administrative credential and must never be shared with providers. Legacy records without a provider owner remain administrative-only.

The provider receives the full checkout amount. Each new checkout snapshots a **0.1% (10 basis point) fee**, owed by the provider only when status becomes PAID. Fees are shown in Checkouts and persisted on the checkout record, so retries cannot accrue another fee. Fractional micro-USDT is preserved at nine decimal places for later invoice aggregation; for example, 100 USDT creates a 0.10 USDT fee. Historical records are not charged retroactively. This implements fee accrual for separate provider billing; invoice issuance, payment collection, and marking invoices settled are not automated. A platform collection wallet is not used for customer checkout.

 All paid mint paths share a Redis receipt ledger. Redis AOF persistence is enabled in Compose, and checkout payment hashes also have a database uniqueness constraint. A payment followed by an Arkiv or database failure is held for reconciliation rather than silently minted again. Check the existing receipt and grant before retrying a purchase; never send a second payment just to retry verification.

The billing migration is registered in the migration journal; `db:migrate` applies it. Recreating Redis uses the named `valkey-data` volume. Do not remove that volume to clear a pending payment.

## Tests versus live completion

Local test fixtures may explicitly opt into mock proofs and demo settlement. Those flags are never accepted in production, and a failed live proof or payment never falls back to a fixture. Existing mock sessions are rejected after mock mode is turned off.

A real World App approval needs the matching RP signing key. A real paid end-to-end run also needs a provider plan with its payout wallet, funded buyer and executor wallets, a Whitechain mandate, and working Arkiv credentials. Unit tests or a local Anvil payment do not prove those external steps succeeded.

## Public testnet result — 7 November 2026

The [real public-network run](testing/whitechain-public-payment-2026-11-07.json) passed checkout receipt verification, live Arkiv minting, idempotent reconfirmation, a separately accrued 0.1% fee, SDK access, and paid run with a real registered worker and funded mandate. The provider received 0.10 USDT and 0.10 USDT remains in the active mandate vault; total net USDT used was 0.20, below the authorized 1 USDT limit. The initial mismatched-token vault was fully recovered and revoked before its replacement was bound to the same worker. Arkiv transport now applies the configured access key to the Rabdi base RPC and uses bounded RPC timeouts. Missing credentials throw rather than creating in-memory placeholder grants.
