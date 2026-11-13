# Decisions

## D17. Avalanche product migration

The `Avalanche` branch implements Avalanche C-Chain settlement and an entitlement registry. The `chain` branch preserves the previous product implementation. Merge into `main` only after validation and the user's merge instruction.

Authentication is verified email plus signed wallet ownership. Email supports sign-in, receipts and recovery; wallet signatures authorize financial actions. The product does not claim proof of unique humanity. MCP consent uses an emailed code and a nonce-bound, expiring wallet signature bound to the OAuth request. Existing OAuth client, redirect, PKCE and refresh-token checks remain required.

The registry is the access authority. Private PostgreSQL records support discovery and recovery. Each authoritative read verifies the configured Avalanche network and reads contract state. Subject HMACs keep raw billing email off-chain; the secret must remain stable. Numeric credits use exact 18-decimal units; payment tokens use their explicitly verified six-decimal units.

Provider signing authority is scoped to recorded provider operations, encrypted at rest, fee-bounded and journaled before broadcast. Settlement and registry operations share one configured C-Chain native balance and nonce namespace while retaining separate maximum-fee accounting categories. A provider must reauthorize after a deployment or authorization-format change. Production has no platform-fee fallback.

Recurring payment contracts retain fixed terms, payer-approved allowances, customer subscription/cancellation transactions and durable renewal/fulfillment journals. Each period is fulfilled once. Cancellation stops future collection and preserves paid-through. Unknown outcomes require reconciliation of original transactions.

The registry supports minting, current reads, credit consumption, holds, commit/release, expiry and renewal cancellation. Duplicate operations must not decrement or release twice, conflicting retries must fail, and expired storage must not confer access. EVM state remains stored after expiry.

Cross-L1 allocation through Avalanche ICM remains follow-up work until source reservation, authenticated delivery, replay/order protection, destination execution and public-network recovery are implemented and verified. Do not describe the current one-chain implementation as cross-L1 delivery.

## D18 — Separate authority for isolated x402 payments

The provider approves a separate EIP-3009 payment signer bound to one on-chain mandate, worker, chain, token, merchant recipient and provider origin. Gas-signing authorization does not grant payment-signing authority. The isolated signer receives only transfers executed through the existing mandate contract; it never receives owner or enforcer access to that vault. Unknown incoming tokens cannot increase a job's authorized funding amount.

Each mandate/worker/merchant binding retains a stable payer address across authorization renewal. The unchanged mandate enforces worker allocation, revocation, per-purchase, rolling-window, lifetime and direct-recipient limits on funding that address. Its direct recipient is the isolated payer. The downstream merchant restriction is enforced by the separately approved signer and settlement evidence; it is not an on-chain merchant whitelist in the unchanged vault. Never describe the off-chain signer policy as a smart-account restriction.

Signed payment authorizations and funding transaction bytes must be journaled before use. One unresolved job per payer prevents concurrent use of the same allocated funds. A job's idempotency key binds its complete payment inputs. HTTP success alone does not establish settlement: verify the token transfer and EIP-3009 nonce on-chain. An ambiguous authorization remains pending until reconciled; never refund while it can still settle. Recovery can return only the job's unused authorized funding to its original mandate. Returning tokens does not reset the mandate's on-chain spend counters. Revocation stops new signing; signatures already issued can remain executable until their expiry.

Facilitator operations sit behind a versioned adapter. On 2026-11-12, PayAI's live `/supported` advertised x402 v2 `exact` on `eip155:43113`, and its `/verify` accepted the standard envelope and returned `invalid_exact_evm_signature` for an intentionally invalid non-paying probe. Fuji USDC at `0x5425890298aed601595a70AB815c96711a31Bc65` returned name `USD Coin`, version `2`, a domain separator and `authorizationState`. This establishes interface compatibility, not a completed live payment. Funded settlement, recovery and provider activation need separate verification. Sources: https://facilitator.payai.network/supported and https://payai.network/developers.

## Billing documents are payment evidence, not access authority

Invoice terms are private PostgreSQL snapshots, committed atomically with checkout creation or a renewal journal. Payment verification can precede entitlement fulfillment; a receipt must preserve that distinction. Deterministic source keys deduplicate initial subscription and renewal retries. A conflicting transaction or payer is an error, not an overwrite. Historic missing token/payment-time data stays unknown. Invoice access is restricted to the issuing provider and exact billed holder. This changes neither Avalanche entitlement authority nor wallet payment approval.

## Email-first account binding and explicit wallet actions

Email OTP proves inbox control. A nonce/domain-bound, expiring signature establishes a first wallet binding. Returning sessions hydrate the durable profile; browser disconnect preserves it. Reconnecting the same address does not create a replacement or require a new account-linking signature. Another address is an explicit replacement: fresh inbox proof is checked before preparing the challenge and again at signed submission, with a compare-and-set database update. Financial permissions and payouts retain their original owners and recipients until changed through their own approved flows.

The browser coordinates whole wallet actions with shared state and same-origin Web Locks. Competing actions fail immediately rather than queue. No timer releases a live approval, no transaction is automatically retried, and the app cannot cancel an extension-owned pending request. Acknowledging the reminder changes UI state only. Existing registry connectivity is separate from optional deployment of another registry.

## Customer billing and delivery lifecycle

Provider payout and customer paying accounts are distinct roles. An explicit authorized account selection is retained through transfer and receipt-ownership signing; a first account in an injected provider list is not automatically the intended payer. SDK and backend reject self-payment; newly built subscription contracts add the same invariant on-chain.

Checkout is a temporary payment intent with an immutable deadline, not a customer or an issued paid invoice. Reuse open unpaid intents under a database lock, durably expire them, and retain a bounded reconciliation window before purging unreferenced unpaid metadata. Preserve paid evidence and subscription journals. Chain payment time, not HTTP confirmation time, determines whether a timely payment can be reconciled.

Paid receipts use a transactional outbox tied to the verified payment record, trusted off-chain customer contact, stable provider idempotency and fenced workers. Expiring document capabilities let a customer view and print one invoice without exposing provider administration or other customers. Unknown email acceptance is reconciled before retrying beyond the provider's idempotency window. No ordinary billing-portal action consumes product credits.

## Provider-owned API credentials

The Developers page must never reveal deployment service credentials. Provider secret keys use cryptographically random 256-bit material, hash-only persistence, one-time creation responses, explicit expiry and soft revocation with audit metadata. Public keys can be retained as public values. Short-lived customer tokens carry their provider and issuing key ID, and check that key on each request. Provider scope is enforced on resources even when customer holder IDs match across merchants. Rotation allows overlap, then explicit revocation; it never rotates wallet/delegated signing keys or entitlement subject secrets.

## Reuse verified account sessions for MCP consent

MCP uses the existing console identity instead of repeating email and wallet authentication for every ChatGPT connection. Explicit authorization remains required. A durable, short-lived browser-bound bridge transfers only an opaque single-use proof between the console and MCP origins, preserving the original PKCE/client/resource/state request. Session cookies stay on the console origin. The callback rejects changed wallet bindings. OAuth alone cannot revive a connection pointing at a retired tunnel hostname.
