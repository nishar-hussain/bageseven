# Product semantics

Bagseven connects paid service plans, living entitlements, and bounded agent spending on Avalanche. The existing ReceiptBox example demonstrates receipt scanning with metered access.

There are three independent clocks: confirmed Avalanche payment evidence, permission to collect future subscription payments, and paid access through the grant's `paid_through`. Cancelling renewal preserves already-paid access. Numeric features consume credits; boolean features check access without consuming units.

Customers sign in with verified email and link an Avalanche wallet by signature. Providers use their email for account communication and their wallet for payout and gas authorization. Email and wallet ownership are separate proofs; neither establishes person uniqueness. Raw email addresses and signatures are not stored in the entitlement contract.

`BagEntitlementRegistry` is authoritative for credits, expiry, renewal preference, and reservations. PostgreSQL contains private discovery metadata and recovery records; it cannot increase a contract balance. Contract reads fail closed if the RPC is unavailable or connected to another chain. Expiry is enforced when checking or spending; EVM storage is retained after expiry.

Prepaid OCR and SDK consumption require holder authorization, worker binding when present, live time, and enough credits. They do not require a payment mandate. New purchases by agents require both a living entitlement and an active bounded mandate. Never equate credit quantities with token payment amounts.

Recurring plans use explicit customer token allowance and subscription transactions. Durable workers recover signed transactions and fulfill each confirmed paid period once. Cancellation must be confirmed on-chain before the platform calls a recurring permission cancelled. An uncertain fulfillment outcome must be reconciled before charging or minting again.

Providers fund AVAX for their dedicated delegated signer. Settlement and registry fee budgets are separate accounting categories on the same configured C-Chain; the native balance is shared. Keys are encrypted with AES-GCM and budgets are reserved before signing. These are server-enforced EOA restrictions. No hidden platform-wallet fee subsidy is allowed.

## Registry design and production limits

PostgreSQL locates a holder's grants using indexed chain, registry, holder, feature, worker and expiry metadata. The adapter then reads balances and access flags from the contract, with at most eight concurrent reads per discovery request. The contract uses mappings for direct grant lookup and atomically enforces credit deductions, expiry and duplicate operation IDs. Discovery therefore requires both PostgreSQL and a working chain RPC; it is not a fully decentralized login or indexing system.

The contract records provider-issued access; it does not itself prove a stablecoin payment occurred. The daemon verifies receipts before checkout fulfillment, and the provider signer remains trusted to issue and operate its grants. Holder and worker authorization are enforced by the service, while the contract enforces provider/operator authority and credit accounting. Public auditability must not be described as trustless payment-to-entitlement issuance.

Every consumption currently sends a provider-paid transaction and waits for confirmation. This gives shared, independently readable credit accounting, but introduces gas cost, confirmation latency and contention on each provider's signing account. Indexed SQL and bounded concurrency reduce discovery load; they do not establish a production transaction-throughput guarantee. Load tests must measure concurrent holders, provider nonce contention, RPC throttling and fee cost per operation before setting service limits. A high-frequency OCR service may need a separately designed reservation/batching protocol; silently moving balances into a cache would break the current authority model.

One-time checkout fulfillment uses a deterministic grant identity per checkout. After receipt and payer verification, a retry can recover that grant and finish the checkout database update without issuing another grant. Conflicting payment evidence is rejected. Unknown broadcasts without a confirmed grant retain their payment hold for reconciliation. Older unresolved checkouts created before deterministic fulfillment need explicit reconciliation rather than blind reissue.

The implementation is not yet a blanket production-readiness certification. MCP OAuth credentials and consent now persist in PostgreSQL with atomic exchange, and HTTP transports are stateless. Custom feature semantics and account wallet/onboarding profiles use PostgreSQL; signed sessions hydrate the current profile, and wallet updates use compare-and-set. Pending subscription-plan recovery uses indexed, bounded keyset pages. Provider-funded x402 has no separately authorized payer integration and deliberately fails closed. Public Fuji deployment, load testing, backup recovery and real client authorization must be verified separately from Anvil tests.

Isolated x402 payments keep payment authority separate from provider gas. The provider and mandate owner approve the payer, merchant, resource origin, token, chain, amount ceiling and expiry. The existing vault enforces funding limits on-chain; server signing enforces downstream recipient policy. Payments remain pending until confirmed token/nonce evidence proves settlement. Unused allocations return only to their source vault after signature expiry, without resetting spent quota. The dashboard exposes approval, revocation, payment status, reconciliation and recovery drafts; MCP can check payment status without obtaining wallet keys.

## Unified customer billing embed

Builder configures one customer experience: plans, wallet connection, checkout, prepaid access and subscription management. New designs use the complete `cmp_customer` embed, with persistent navigation between Plans, My access and Checkout. Standalone components remain compatible for existing integrations.

Designs belong to the signed-in provider and persist in PostgreSQL. Save draft changes only the private draft; Publish embed creates or updates the public hosted snapshot. Concurrent edits require the current revision and fail visibly rather than overwriting another tab. Unpublishing or deleting a design removes the hosted page without changing plans, customer grants or subscriptions. Designs saved in the old browser-only library can be explicitly imported into the current account as private drafts.
