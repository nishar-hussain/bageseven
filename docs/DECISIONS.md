# Bagseven — Architecture Decisions

Status: **authoritative**. Every mechanism here is a hard invariant. Do not weaken without a new decision entry.

## D1. The spend_token (the core security mechanism)

Issued by the **Policy Service** at ALLOW (or on guardian approval completion). It is the only thing the Treasury Service will co-sign against. The LLM/agent runtime never authorizes; it can only present a token the Policy Service issued.

- **Signature**: Ed25519, Policy Service's signing key. Treasury verifies with the corresponding public key (via env, never fetched at co-sign time).
- **Claims** (canonical JSON, signed):
  ```
  { v: 1, decision_id, agent_id, amount, currency, chain, category, counterparty_id, iat, exp, jti }
  ```
- **exp**: 30s from issuance.
- **Single-use**: Treasury enforces via `SETNX spendtoken:used:{jti}` (TTL 5min). A replayed token is rejected.
- **Payee binding**: Treasury resolves `counterparty_id` → the **registered** payout address (provider/agent record). It **never** signs to an address supplied by the request. `counterparty_id === null` is only valid for platform-controlled sweeps.
- **Live status recheck**: at co-sign time Treasury re-checks the agent is `active` (and wallet not frozen) against identity data. A suspension inside the 30s window still blocks.
- **Budget accounting**: Policy increments spend counters at token issuance (reserved). A settlement failure/refund compensates the counter via an idempotent job keyed by `decision_id`.

## D2. Delegation accounting (child can never exceed parent's remaining)

`parent.remaining = parent.budget − parent.own_spent − parent.children_spent`.

- `children_spent` is an aggregated counter incremented whenever any descendant spends.
- A child's spend increments the child's own counter **and** `children_spent` on every ancestor **in one Redis Lua script** — atomic, no read-then-write. Two children racing the parent's remaining cannot jointly overshoot.
- The `min(child.remaining, parent.remaining)` rule from the PRD is evaluated on every check, not cached.

## D3. Category limits

`policy.category_limits: { [category]: { max_per_tx, daily_budget } }`. Counters keyed `(agent_id, period_key, period_type, category)`. A category limit applies on top of the flat daily budget; the effective cap is the min of both.

## D4. Fail-closed, always

The Policy Service's only ALLOW output is a signed token. Any error or timeout during evaluation is a **deny** (HTTP 503/403, never ALLOW). The gateway and every SDK treat non-`allow` as deny. Proved by the chaos suite (D9), not just unit tests.

## D5. Idempotency

Every mutating request carries `Idempotency-Key`. Redis `idempotency:{service}:{key}` → `{status: in_progress|completed, response}`. In-progress → 409 + `Retry-After`. Completed → stored response verbatim. TTL 24h. Stuck `in_progress` keys resolved by a sweeper after 60s. The spend-intent idempotency key binds token minting: one logical intent ⇒ one token.

## D6. Reservation lifecycle

`held → committed | released | expired`. Reserve is a single atomic statement: insert reservation + `UPDATE balances SET reserved_amount = reserved_amount + $amount WHERE wallet_id=$w AND token=$t AND (amount - reserved_amount) >= $amount`. Row count 0 ⇒ rollback (insufficient funds). Expiry (default 60s) **must exceed** provider timeout + settlement window; the sweeper skips reservations referenced by in-flight executions.

## D7. Async settlement, sync decision

`/spend-intents` answers "allowed?" in <50ms and issues a token. Chain settlement is asynchronous off the event bus. The synchronous path never waits on chain finality.

## D8. Double-entry ledger

Every settled tx writes exactly two `ledger_entries`: debit payer, credit payee. Invariant (per account/token/chain): Σ debits = Σ credits. Checked by a nightly reconciliation job; alert on any drift.

## D9. The correctness test suites

- **Concurrency**: 1,000 parallel spend-intents against one agent's daily budget ⇒ committed total never exceeds budget (asserts D2/D3/D5).
- **Chaos**: kill the Policy Service under load ⇒ zero false-ALLOW decisions; clients get clean retryable errors (asserts D4).
- **Fuzz**: spend_token verification with tampered claims/payee ⇒ all rejected pre-signature (asserts D1).

## D10. Money

Money is never a float. Canonical decimal strings (≤18 fractional digits) end-to-end; `NUMERIC(38,18)` in Postgres. `@bagseven/money` is the only arithmetic allowed.

## D11. Events

Domain events go to a transactional outbox in the same DB transaction as the state change, then drained to the bus. Correctness never depends on the bus being up. Topic registry in `@bagseven/events`.

## D12. Receipts

Append-only; `prev_hash` hash-chain makes post-hoc tampering detectable. On-chain merkle anchoring is a later phase.

## D13. Scope notes (accepted cuts for v1)

- Custody is an abstracted `Signer` interface; Phase 1 uses a **dev signer**. Real ERC-4337 smart-account custody is a dedicated later slice.
- One shared Postgres for all services (Drizzle); per-service DBs + event-sourced integration is Phase-6 work. All tables carry `agent_id`-shard-friendly keys.
- No Kubernetes/Temporal until evidence demands it (PRD §11.3).

## D14. Customer-authorized recurring payments

Recurring customer billing uses a fixed-price `BagSubscriptionPlan` on Whitechain. The payer approves a bounded USDT allowance and signs `subscribe(checkoutKey, deadline)`, atomically paying the first period. Funds remain in the payer wallet until a collection. The contract fixes token, recipient, collector, amount and 30-day period; there are no administrative term setters or upgrade path. Renewal calls bind the expected paid-through timestamp, preventing a delayed signed transaction from paying a later period. A customer's on-chain cancellation stops future collections and preserves paid time. Expired checkout signatures cannot move funds; timely payments may still be confirmed after checkout expiry.

The daemon owns scheduling, not payment permission. It attempts collection at period offsets 120, 3600, 21600 and 86400 seconds. Funding/allowance failures count toward four attempts; technical failures do not. The contract permits five additional minutes on the final collection window for scheduler/confirmation jitter, then refuses arrears. Provider-signed deployment and collection bytes are journaled before broadcast. PostgreSQL advisory locks exclude simultaneous workers; independently committed journals survive a worker-lock rollback. Confirmed payment, Arkiv fulfillment and subscription state are separately recoverable stages. A committed initial subscription without its initial period journal must reconstruct and verify that payment before renewal. All provider Whitechain signers reserve nonce ownership under the provider row lock in migration 0010; conflicting operations fail rather than replace each other. Stable deployment/collection intents preserve signed bytes even if the process dies before the subscription journal is saved, with no second fee reservation. A reverted collection releases only its intent after a verified receipt; the original nonce remains permanently owned. Unknown Arkiv broadcast outcomes enter reconciliation and never trigger another payment or blind remint.

Provider gas authorization must explicitly include subscription deployment/collection. Old authorizations gain no new authority. Subscription-enabled authorizations may last up to 365 days, remain revocable, and retain fee budgets and transaction caps. New monthly checkout requires at least 31 days of provider authorization remaining. Customer approval/cancellation transactions require their own wallet and native gas; renewal relay gas is provider-funded. Agent `bagseven_fetch` dual-gate requirements are unchanged; customer subscription permission is a distinct, payer-approved path.

Implementation sequence: contract and paired artifacts → durable journal/migration → scheduler and reconciliation → checkout/portal → SDK/MCP/provider visibility → isolated EVM, PostgreSQL and authorization verification. Local checks: `node scripts/compile-subscription.mjs`, `node --import tsx scripts/test-subscriptions-local.mjs`, `node --env-file=.env --import tsx scripts/test-subscription-persistence.mjs`, and root Vitest/typechecks. The persistence test creates and drops only its own local test database. No live wallet approvals are synthesized by these checks.
