# Product semantics

Bagseven connects paid service plans, living entitlements, and bounded agent spending on Avalanche. The existing ReceiptBox example demonstrates receipt scanning with metered access.

There are three independent clocks: confirmed Avalanche payment evidence, permission to collect future subscription payments, and paid access through the grant's `paid_through`. Cancelling renewal preserves already-paid access. Numeric features consume credits; boolean features check access without consuming units.

Customers sign in with verified email and link an Avalanche wallet by signature. Providers use their email for account communication and their wallet for payout and gas authorization. Email and wallet ownership are separate proofs; neither establishes person uniqueness. Raw email addresses and signatures are not stored in the entitlement contract.

`BagEntitlementRegistry` is authoritative for credits, expiry, renewal preference, and reservations. PostgreSQL contains private discovery metadata and recovery records; it cannot increase a contract balance. Contract reads fail closed if the RPC is unavailable or connected to another chain. Expiry is enforced when checking or spending; EVM storage is retained after expiry.

Prepaid OCR and SDK consumption require holder authorization, worker binding when present, live time, and enough credits. They do not require a payment mandate. New purchases by agents require both a living entitlement and an active bounded mandate. Never equate credit quantities with token payment amounts.

Recurring plans use explicit customer token allowance and subscription transactions. Durable workers recover signed transactions and fulfill each confirmed paid period once. Cancellation must be confirmed on-chain before the platform calls a recurring permission cancelled. An uncertain fulfillment outcome must be reconciled before charging or minting again.

Providers fund AVAX for their dedicated delegated signer. Settlement and registry fee budgets are separate accounting categories on the same configured C-Chain; the native balance is shared. Keys are encrypted with AES-GCM and budgets are reserved before signing. These are server-enforced EOA restrictions. No hidden platform-wallet fee subsidy is allowed.
