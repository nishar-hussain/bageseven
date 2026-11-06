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
