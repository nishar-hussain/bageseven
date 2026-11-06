# World ID / Whitechain integration verification

The configured public network was checked directly: RPC chain ID **1874** and USDT.e contract `0xaa7962d073935D387e8d442DA1D7149C81388f46`, **6 decimals**. World app/RP/signer IDs are set in the ignored local `.env`; World mocks and Whitechain demo settlement are disabled.

## Automated verification

The saved [integration results](world-whitechain-integration.json) contain ten passing checks using an isolated Anvil chain with Whitechain's chain ID, real local ERC-20 transfers and EIP-191 payer signatures, a migrated PostgreSQL database, and actual daemon route handlers:

- Plans and checkout records survive fresh store instances.
- A confirmed, correctly valued token transfer mints exactly one living entitlement.
- Reconfirming the checkout returns the existing result.
- A second checkout cannot redeem the same transaction.
- The provider receives the full price; an exact 0.1% fee persists once across retries and store restarts.
- The SDK check sees the paid entitlement.
- Paid run uses the bound worker and on-chain capacity.
- Insufficient child allocation and owner revocation refuse paid work without burning credits.
- A mandate signed for another chain is rejected before deployment.

The local token fixture emits ERC-20 Transfer events; the receipt verifier was not bypassed. Local transactions are not public-network payment evidence. No World proof was fabricated for this checkout test: checkout is a buyer-wallet flow, while real World identity verification is tested separately at the request/verification boundaries.

The World and console tests cover public pre-login configuration and challenges, signer mismatch, missing, mismatched, or reused proof nonces, repeated human login with fresh proofs, denied verification, and no mock fallback. Payment tests cover exact receipt logs, token, amount, sender, recipient, confirmations, RPC failure, purchase-bound wallet signatures, and receipt reuse. SDK tests cover wallet switching, exact token encoding, confirmation, and refusal to invent a payer address. Provider tests cover account isolation, rejected ownership overrides, exact fee arithmetic including fractional micro-USDT, and fee accrual only for paid checkouts.

Run the isolated checkout scenario with a migrated local test database and Anvil on `127.0.0.1:58545` with chain ID 1874:

```sh
BAGSEVEN_CHECKOUT_TEST_DATABASE_URL=postgres://bagseven:bagseven@localhost:55432/bagseven_checkout_test pnpm test:checkout
```

It requires `_test` in the local database name, checks that the RPC is Anvil, and never reads the live `.env`. Set `BAGSEVEN_CHECKOUT_REPORT` to save JSON evidence.

## Initial live setup (resolved by the public-network follow-up below)

The read-only `pnpm integrations:check` currently identifies:

1. The RP signing key is now configured, matches `WORLD_SIGNER_ADDRESS`, and the live challenge endpoint returns 200. The user confirmed real World App sign-in works.
2. B2B checkout uses each plan’s provider wallet; `WHITECHAIN_PAY_TO` is optional for legacy direct utilities. The provider receives the full price and owes a separately billed 0.1% fee.
3. The mandate executor needs WBT for gas; the buyer and mandate vault need test USDT.e. Existing Fuji mandate data must not be treated as a Whitechain deployment.

**At the initial run**, live World App sign-in was user-confirmed, while a public Whitechain payment, live Arkiv mint, and mandate deployment were pending. Those steps passed in the 7 November follow-up below. Source/unit tests, PostgreSQL persistence checks, and local chain verification cannot substitute for those external steps. See [the live setup guide](../LIVE.md) for the exact configuration and operator flow.

Final validation: 92 unit tests passed across World, wallet SDK, console, daemon, entitlements, and money packages. Backend and webpack console production builds, typechecks, lint on the changed TypeScript, and the isolated ten-check integration scenario passed. The restarted gateway, policy, daemon, and login page returned 200; live-config mock login returned 403 without setting a session cookie. Redis append-only persistence was verified enabled.

## Public-network follow-up — 7 November 2026

The previously pending public paid flow has now passed with the funded test USDT contract `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7` (symbol USDT, 6 decimals), live Arkiv, and a real Whitechain mandate. See [the public payment evidence](whitechain-public-payment-2026-11-07.json). The provider received 0.10 USDT, the platform fee accrued once at 0.0001 USDT, and paid run consumed 0.01 credits. The active vault holds 0.10 USDT, for total net USDT usage of 0.20. Legacy token selection and an unkeyed Arkiv transport were corrected during this run; the mismatched vault’s tokens were recovered in full and its old mandate revoked.
