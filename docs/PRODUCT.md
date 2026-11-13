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

Monthly checkout can begin while its provider-funded plan contract is confirming. Checkout polling verifies the existing deployment receipt, runtime and plan terms, then persists its ready status. This refresh does not sign or broadcast a transaction. Customer allowance and the first subscription payment still require explicit wallet approval.

The implementation is not yet a blanket production-readiness certification. MCP OAuth credentials and consent now persist in PostgreSQL with atomic exchange, and HTTP transports are stateless. Custom feature semantics and account wallet/onboarding profiles use PostgreSQL; signed sessions hydrate the current profile, and wallet updates use compare-and-set. Pending subscription-plan recovery uses indexed, bounded keyset pages. Isolated x402 payment authority is implemented separately from gas authority and fails closed until its mandate, approval, token and facilitator are configured. Public Fuji deployment, load testing, backup recovery and real client authorization must be verified separately from Anvil tests.

Isolated x402 payments keep payment authority separate from provider gas. The provider and mandate owner approve the payer, merchant, resource origin, token, chain, amount ceiling and expiry. The existing vault enforces funding limits on-chain; server signing enforces downstream recipient policy. Payments remain pending until confirmed token/nonce evidence proves settlement. Unused allocations return only to their source vault after signature expiry, without resetting spent quota. The dashboard exposes approval, revocation, payment status, reconciliation and recovery drafts; MCP can check payment status without obtaining wallet keys.

## Account and wallet onboarding

Account sign-in starts with an email code. Users can connect their wallet while retrieving the code, verify the inbox in the same window, then sign wallet ownership during first-time onboarding. Returning sign-ins hydrate the existing durable wallet binding. Disconnecting the browser wallet never removes that binding: account-aware controls show Reconnect wallet. A matching connected wallet is already verified; a different wallet requires an explicit replacement flow with a fresh inbox code and a new ownership signature. Replacing an account wallet does not migrate payouts, existing subscription payers or spending permissions.

## Unified customer billing embed

Builder configures one customer experience: plans, wallet connection, checkout, prepaid access and subscription management. New designs use the complete `cmp_customer` embed, with persistent navigation between Plans, My access and Checkout. Standalone components remain compatible for existing integrations.

Designs belong to the signed-in provider and persist in PostgreSQL. Save draft changes only the private draft; Publish embed creates or updates the public hosted snapshot. Concurrent edits require the current revision and fail visibly rather than overwriting another tab. Unpublishing or deleting a design removes the hosted page without changing plans, customer grants or subscriptions. Designs saved in the old browser-only library can be explicitly imported into the current account as private drafts.

## Provider overview and reporting semantics

Customers at /app/customers is the provider's searchable directory of paid customers. Unpaid checkout drafts are excluded; it shows paid invoice counts and active recurring permissions, and opens a customer's filtered billing history. Arbitrary application holder IDs are displayed as account IDs, not represented as verified email addresses.

Invoices at /app/invoices separates issued documents from the signed-in account's purchases. Each new checkout atomically saves an immutable invoice snapshot with its original price, recipient, token and chain. Each renewal journal creates one separate invoice; verified collection marks it paid even when entitlement fulfillment still needs reconciliation. Signed or submitted transactions never become receipts. First-period subscription payments update the checkout invoice instead of duplicating it. Providers and the billed account can view, print or save their documents as PDFs; other identities receive not found.

These are payment invoices and receipts, not tax assessments. Verified payments queue a branded invoice/receipt email to the customer contact supplied by the authenticated SaaS backend. Email attempts persist independently of entitlement fulfillment and use provider idempotency; uncertain deliveries older than the safe retry window require reconciliation. Existing records are backfilled from persisted billing terms; historical token addresses and payment-recorded timestamps that were never saved remain unknown. On Fuji, documents explicitly identify test assets. A receipt confirms a verified payment, not successful entitlement fulfillment.

The provider overview answers which checkouts were started and paid, how many distinct holders paid, which recurring permissions need attention, and which catalog plans/embeds are available. It does not show the provider’s own prepaid credit balance as a business metric. The authenticated console derives provider identity from the server session; client-supplied holder/provider filters cannot widen reporting scope.

The 7/30/90-day filter selects checkout creation-date cohorts, from midnight UTC on the first day through the report snapshot. Daily opened/now-paid counts, recent sessions and plan checkout counts use the same window. A checkout’s PAID status means its current billing record; there is no historical payment-time chart or revenue/MRR estimate. Initial subscription checkout payments and later recurring collections are different events. Paying customers counts distinct holders of paid checkouts in the selected cohort. Active subscription permissions, past-due/reconciliation states, active catalog plans and published embed snapshots are current, independent of the cohort window. An expired PENDING checkout is presented as expired even if no background task rewrote its status. Directly issued grants do not become sales.

Billing metrics come from a consistent read-only PostgreSQL snapshot. They do not replace Avalanche as the authority for access validity, balances or reservations. Only a bounded recent/issue/plan list is sent to the overview; checkout browsing is server-paginated and provider scoped. Unknown/unavailable reporting stays unavailable instead of becoming example data.

The public landing walkthrough is an explicitly labeled local simulation of checkout, credit use and cancellation. It sends no wallet requests, payments or registry consumption. Actual checkout and wallet actions belong to the authenticated embedded product.

Providers manage named, expiring API keys in Developers. Secret keys are shown once, can be replaced with overlapping rotation, and can be revoked. Revocation stops new API requests and customer tokens issued by that key while retaining audit metadata. Public keys expose plan listings; customer access and billing history require scoped authentication. Shared deployment credentials never appear in the dashboard.

When connecting ChatGPT, a signed-in customer with verified email and linked wallet reviews one authorization button. Signed-out customers authenticate first. The assistant receives scoped Bagseven credentials; the user’s dashboard session and wallet keys are not shared. A new connection or scope requires explicit consent.
