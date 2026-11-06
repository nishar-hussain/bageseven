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
| USDT.e | `0xaa7962d073935D387e8d442DA1D7149C81388f46` |

The RPC was checked directly: chain 1874; that token contract reports `USDT.e` and 6 decimals. The shorter address ending in `88f4` is invalid. The [official network reference](https://docs.whitechain.io/learn/network/reference) identifies the current Sepolia RPC and chain ID; legacy Whitechain testnet 2625 is a different network.

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

1. Open `/app/login`, continue with World ID, and approve the request in World App. The public login challenge works without an existing console session. World verification is performed on the backend through the [official RP verification API](https://docs.world.org/api-reference/developer-portal/verify).
2. Open Plans, enter or connect the provider payout wallet, and create a plan. Open Checkouts and create a session for the customer. Share that checkout URL; the customer signs the actual USDT transfer to the plan’s provider wallet and a confirmation binding that transaction to the purchase. The UI waits for confirmations. No global payment recipient is required.
3. Checkouts carry the server-selected network and token to the SDK. The backend verifies that exact transaction's successful receipt, token address, payer, merchant, amount, and confirmations before creating access.
4. Check Entitlements, then use the SDK or MCP. Paid work checks the on-chain worker state and allocation, as well as the living grant. Cancellation preserves the existing paid-through period; expiry removes access.
5. MCP OAuth requires a fresh World proof; knowing a holder's email or finding a grant is not authentication.

Plans and checkout sessions are stored in PostgreSQL. Console lists and creation are scoped to the signed-in provider; the server-side SDK secret remains an administrative credential and must never be shared with providers. Legacy records without a provider owner remain administrative-only.

The provider receives the full checkout amount. Each new checkout snapshots a **0.1% (10 basis point) fee**, owed by the provider only when status becomes PAID. Fees are shown in Checkouts and persisted on the checkout record, so retries cannot accrue another fee. Fractional micro-USDT is preserved at nine decimal places for later invoice aggregation; for example, 100 USDT creates a 0.10 USDT fee. Historical records are not charged retroactively. This implements fee accrual for separate provider billing; invoice issuance, payment collection, and marking invoices settled are not automated. A platform collection wallet is not used for customer checkout.

 All paid mint paths share a Redis receipt ledger. Redis AOF persistence is enabled in Compose, and checkout payment hashes also have a database uniqueness constraint. A payment followed by an Arkiv or database failure is held for reconciliation rather than silently minted again. Check the existing receipt and grant before retrying a purchase; never send a second payment just to retry verification.

The billing migration is registered in the migration journal; `db:migrate` applies it. Recreating Redis uses the named `valkey-data` volume. Do not remove that volume to clear a pending payment.

## Tests versus live completion

Local test fixtures may explicitly opt into mock proofs and demo settlement. Those flags are never accepted in production, and a failed live proof or payment never falls back to a fixture. Existing mock sessions are rejected after mock mode is turned off.

A real World App approval needs the matching RP signing key. A real paid end-to-end run also needs a provider plan with its payout wallet, funded buyer and executor wallets, a Whitechain mandate, and working Arkiv credentials. Unit tests or a local Anvil payment do not prove those external steps succeeded.
