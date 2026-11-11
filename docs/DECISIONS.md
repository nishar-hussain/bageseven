# Decisions

## D17. Avalanche product migration

The `Avalanche` branch implements Avalanche C-Chain settlement and an entitlement registry. The `chain` branch preserves the previous product implementation. Merge into `main` only after validation and the user's merge instruction.

Authentication is verified email plus signed wallet ownership. Email supports sign-in, receipts and recovery; wallet signatures authorize financial actions. The product does not claim proof of unique humanity. MCP consent uses an emailed code and a nonce-bound, expiring wallet signature bound to the OAuth request. Existing OAuth client, redirect, PKCE and refresh-token checks remain required.

The registry is the access authority. Private PostgreSQL records support discovery and recovery. Each authoritative read verifies the configured Avalanche network and reads contract state. Subject HMACs keep raw billing email off-chain; the secret must remain stable. Numeric credits use exact 18-decimal units; payment tokens use their explicitly verified six-decimal units.

Provider signing authority is scoped to recorded provider operations, encrypted at rest, fee-bounded and journaled before broadcast. Settlement and registry operations share one configured C-Chain native balance and nonce namespace while retaining separate maximum-fee accounting categories. A provider must reauthorize after a deployment or authorization-format change. Production has no platform-fee fallback.

Recurring payment contracts retain fixed terms, payer-approved allowances, customer subscription/cancellation transactions and durable renewal/fulfillment journals. Each period is fulfilled once. Cancellation stops future collection and preserves paid-through. Unknown outcomes require reconciliation of original transactions.

The registry supports minting, current reads, credit consumption, holds, commit/release, expiry and renewal cancellation. Duplicate operations must not decrement or release twice, conflicting retries must fail, and expired storage must not confer access. EVM state remains stored after expiry.

Cross-L1 allocation through Avalanche ICM remains follow-up work until source reservation, authenticated delivery, replay/order protection, destination execution and public-network recovery are implemented and verified. Do not describe the current one-chain implementation as cross-L1 delivery.
