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

## D15. Avalanche hackathon direction (proposal on `Avalanche`)

The complete pre-migration implementation is preserved on local branch `chain` at `dcb8fb55c8fddc2cfcea9055e9d966411668f2d2`. `Avalanche` starts from that snapshot; `main` remains at its earlier commit. This section proposes the migration; the running product still uses the D14 integrations until the implementation slices below replace them. The target is [Team1 India Speedrun: Build Anything on Avalanche](https://build.avax.network/events/3f8d455d-1eb5-425b-b859-4261a0ff8ad6). Existing projects are explicitly eligible when the submission identifies the work added during the event. The existing snapshot above is the source baseline for that disclosure; it is not a claim that every later addition falls inside an independently verified event window.

**Event scope checked on 11 November 2026:** the submission panel lists **15 November 2026, 04:29 Asia/Kolkata**. The header ends on 14 November and the older prose timeline says 21 October; record the discrepancy, target a completed submission by 14 November, and have the team confirm the cutoff with organizers. Do not infer an exact UTC cutoff from inconsistent page copy. Judging weights are working prototype 30%, originality 25%, technical depth 20%, Avalanche fit 15%, and demo/communication 10%. Fuji is sufficient; a live link, source, pitch slides and a demo video no longer than three minutes are submission deliverables. AI assistance is permitted and must be disclosed. There is no mandatory advanced primitive; meaningful ICM usage is listed among bonus opportunities.

**Deadline-sized commitment:** use the current Bagseven product and existing ReceiptBox example. Prove wallet sign-in plus retained unique-human verification, two plans, one OCR entitlement, verified Fuji payment, truthful remaining credits and one MCP consume path as the first implementation slice; D16 requires full existing feature parity before calling the migration complete. Aim for the Fuji vertical slice by 12 November; spend 13 November on one authenticated, public-network ICM allocation/delivery/consume flow, and reserve 14 November for browser QA, deployment, slides and recording. Verify public test-L1 and relayer availability before selecting Dispatch. Do not provision a custom validator set, add eERC, build a marketplace, or add another UI as part of this scope. A full multi-provider/multi-L1 migration is follow-up work. If the public ICM flow or existing feature parity cannot be proven in time, report the incomplete scope explicitly and revisit submission timing with the team; never claim a partial migration is feature complete or substitute mocked delivery for an Avalanche-native claim. Preserve existing renewal behavior through the chain migration; the public demo can show cancellation preserving paid time, while a clearly labelled local integration test with simulated time supplies renewal evidence. Do not imply a month elapsed on Fuji or silently shorten a purchased monthly period. Include the existing chain baseline, newly added Avalanche code and actual deployment transactions in the submission's contribution disclosure.

**Recommended product:** Bagseven gives providers paid, metered service access across Avalanche L1s. A customer purchases a plan on Fuji C-Chain; Avalanche Interchain Messaging (ICM) delivers a bounded entitlement allocation to a provider L1, where the SDK and MCP enforce and consume it. Receipt scanning is the concrete judge-facing service. An agent can use prepaid scans without a new payment; a separate signed spending permission controls new purchases. The distinctive Avalanche dependency is ICM's validator-authenticated inter-L1 delivery, rather than ordinary ERC-20 payments or subscriptions, which are portable EVM features.

Alternatives considered: a C-Chain-only x402 agent marketplace is a smaller fallback if the deadline excludes cross-chain work, but has less Avalanche-specific differentiation. Operating a custom production L1 introduces validator/relayer operations beyond the smallest useful demo; first prove the application with Fuji and a documented public test L1 such as Dispatch, after checking live contracts, RPCs, relayer coverage and funding. A local two-L1 integration test is a test environment, not proof of public-network delivery.

| Current concern | Proposed Avalanche implementation |
| --- | --- |
| Whitechain settlement | Fuji C-Chain first; explicit test payment-token address/decimals and merchant receipt verification. Verify a supported stablecoin before calling it USDC; an isolated mock token must be labelled as such. |
| Arkiv grant truth | Provider-L1 entitlement contract: holder, provider, feature, allocation ID, remaining units and paid-through. Contract reads enforce expiry; expired storage need not disappear. Postgres indexes status and recovery, rather than deciding paid access. |
| World identity | Wallet sign-in using nonce-bound, domain-bound, expiring SIWE messages and server sessions. Wallet ownership is not proof of unique humanity. D16 supersedes the removal proposal: keep verified human-credential checks wherever the current feature requires them, with World as the initial compatible issuer until a replacement passes an assurance review. |
| Provider gas | Provider funds C-Chain AVAX, destination-L1 native fees and delivery costs. Keep signed, expiring gas authorization, budgets and nonce journals; obtain new authorization for new chain IDs. |
| Recurring payments | Retain customer allowance/subscribe/cancel and confirmed-payment-before-access semantics. A successful collection sends a new period allocation through ICM; delivery retries never collect payment again. Cancellation stops future collection and preserves paid time. |
| Agent access | Existing SDK and MCP contracts remain recognizable. Prepaid consumption requires holder/worker authority; new agent payments retain signed budget gates. MCP OAuth proves the authorized agent, wallet consent and any required human-credential policy; agents never hold human identity credentials. |

Cross-chain credit safety is a first-slice requirement. Allocate each credit lot to one destination L1; do not mirror a fully spendable balance on multiple chains. The origin must reserve/deduct that lot before sending it. Validate the trusted messenger, source Avalanche blockchain ID and origin contract on receive; an EVM numeric chain ID is not an Avalanche blockchain ID. Bind allocations to provider, holder, feature and paid period. Enforce allocation replay protection and explicit ordering/version rules so delayed messages cannot refill consumed credits or resurrect revoked authority. Remote access begins after destination execution; source payment confirmation alone is insufficient. A source administrative revocation must be shown as pending until delivered; it cannot be presented as instantaneous global cancellation.

Implementation sequence and acceptance:

1. **Isolated foundation:** inventory chain-specific imports and env; create a separate Avalanche database/config and fresh provider signing permissions. Keep ignored `.env`, local data and funding out of commits. Git branches preserve code, not databases, secrets or deployed contracts. Runtime watchers share the working directory: stop or isolate them before changing chain wiring.
2. **One-chain vertical slice:** wallet login → provider plan → verified Fuji payment → metered EVM grant → SDK/MCP consume → immediately updated balance. Verify unauthorized holder/worker denial, overspend, expiry, retry idempotency and cancellation preserving paid time.
3. **Avalanche-native slice:** payment/renewal on Fuji → persisted message → authenticated ICM delivery → provider-L1 allocation → receipt scan consumes one unit. Show both transaction links and message state in the existing console. Test invalid origin, duplicate and reordered delivery, relayer downtime and daemon restart. Access stays unavailable while delivery is pending; recovery neither charges nor mints twice.
4. **Public demo:** two small plans, a fresh customer and an agent run. Judge sees payment on one Avalanche chain, activation and a real receipt scan on another, balance decrement, denied extra use and cancelled renewal with paid access intact. Capture proof on both public chains. Merge to `main` only after the user chooses to merge the validated result.

Primary references checked for this proposal: [ICM protocol](https://build.avax.network/docs/cross-chain/avalanche-warp-messaging/overview), [ICM contracts / Teleporter](https://build.avax.network/docs/cross-chain/icm-contracts/overview), [chain configuration](https://build.avax.network/docs/tooling/avalanche-sdk/interchain/chains), [receiving messages](https://build.avax.network/academy/avalanche-l1/interchain-messaging/03-icm-protocol/04-receiving-a-message), [Fuji network configuration](https://build.avax.network/docs/primary-network), and [SIWE](https://eips.ethereum.org/EIPS/eip-4361). Deployment details must be verified again when implementing; SDK configuration listings alone do not demonstrate network or relayer availability.


## D16. Avalanche migration must preserve product guarantees (revised proposal)

The user's clarified requirement is full existing feature parity. This supersedes D15's proposed World removal and any interpretation of the first vertical slice as the complete scope. Migrating payment RPCs alone is insufficient, and wallet login must never be labelled proof of a unique human. A shorter deadline changes the delivery sequence and what can honestly be submitted, not the definition of feature complete. The current runtime remains the preserved baseline; this is an architecture and acceptance plan, not a claim that the replacement contracts are deployed.

### Three responsibilities and their Avalanche destination

1. **Settlement:** replace Whitechain with Fuji, eventually C-Chain mainnet. Retain exact token/decimals/merchant/payer/chain verification, payment replay protection, owner-approved bounded allowances, recurring collection, cancellation preserving paid time, retry limits, durable transaction/nonce journals, and distinct agent mandates. Payment tokens and credit units remain separate. Redeploy rather than reuse Whitechain contract addresses or signatures. Provider permissions must name the new chains and require explicit new authorization.
2. **Living access:** build `EntitlementRegistry` on Avalanche rather than assume an existing native Arkiv equivalent. Store provider, pseudonymous holder key, feature, numeric/boolean type, remaining credits, paid-through, renewal flag, worker binding and payment/allocation provenance. Add authorized, atomic mint/consume/hold/commit/release, and enforce operation idempotency on-chain. Expose direct public RPC reads and bounded pagination for holder/feature/worker discovery; an event-backed searchable index serves lists and history but cannot grant authority. Every authoritative read/spend checks current contract state and expiry; stale indexes fail closed. EVM records remain after expiry, so reproduce the application's living-query semantics with explicit view filters; do not claim native data evaporation or Arkiv's indexed query engine. Rebuild the index from chain events and exercise corruption/lag recovery before cutover.
3. **Human identity:** separate wallet authentication, unique-human evidence and agent delegation. Add a `CredentialRegistry` on Avalanche with trusted issuer, assurance type, subject binding, expiry and revocation. Retain World verification as the first issuer for actions requiring unique-human assurance; validate its real proof/token off-chain using the supported verifier and attest the bound result to Avalanche. This is an issuer/attester trust boundary, not native Avalanche verification of an Orb proof. Preserve denied/expired/cancelled/invalid outcomes and action/nonce replay protection. Wallet login, KYC, liveness, social-account ownership and delegated-agent identity are distinct assurance types, not equivalent unique-human proofs. Do not infer worldwide uniqueness across multiple issuers; anti-Sybil trial/claim policies need a single verified uniqueness domain or a separately validated deduplication policy. Never publish raw World proofs, JWTs, emails or biometric data to the chain. Revalidate the resulting privacy properties rather than assume attestation is privacy-equivalent to World ZK verification.

Avalanche can be the authoritative payment, entitlement and credential-status layer while an external identity issuer supplies evidence. If the product must have zero World dependency, replacing its unique-person guarantee is a separate feasibility gate; do not remove World or weaken a uniqueness-required policy before an alternative demonstrates equivalent assurance, usable SDK/API, public-network support, issuance, expiry, revocation and privacy behavior. [Avalanche's integration directory](https://docs.avax.network/integrations) lists idOS, Keyring and other identity/KYC options; they are candidates for issuer adapters, not verified drop-in World replacements. [Human Passport's supported-chain matrix](https://docs.passport.human.tech/building-with-passport/individual-verifications/supported-chains) currently lists Avalanche for payment, not proof delivery. [Civic Pass was sunset](https://www.civic.com/news/an-update-on-civic-pass), so historical Avalanche integrations are insufficient evidence of a viable current replacement. [Kite Passport](https://docs.avax.network/blog/kite-passport-technical-deep-dive) is relevant prior art for delegated human/agent identities; its existence alone does not establish Orb-equivalent uniqueness or validate a current Bagseven integration.

### Feature-parity gates

| Existing capability | Required migration evidence |
| --- | --- |
| Human identity, optional verified email/recovery, wallet binding | Required human assurance survives login/mint/consent; a second wallet cannot bypass an action's uniqueness policy; recovery does not silently rebind credentials. |
| Provider plans, feature catalog, boolean and numeric grants | Existing feature types, decimal credit precision, plan CRUD behavior, paid-through and provider isolation round-trip through the same SDK interfaces. |
| Holder/worker checks and prepaid usage | Invalid holder/worker denied; concurrent consumption cannot overspend; retrying one request decrements once; prepaid usage never checks a USDT/USDC mandate. |
| Hold, commit and release | Reserved credits cannot also be spent; repeated finalization is idempotent; release/hold expiry cannot resurrect expired access. |
| Checkout and recurring subscriptions | Exact payment produces one period's grant; uncertain broadcasts recover original bytes; failed collections do not mint; cancellation prevents future collection and preserves paid access. |
| Agent spending permissions | Owner creation/delegation/funding/revoke/withdraw remain explicit and scoped; new payments require both mandate capacity and a living grant. |
| Provider-funded operations | Per-network native funding, signed expiry/scope, encrypted delegated keys, atomic fee budgets and shared nonce ownership; no platform-key fallback. Label server-enforced EOA limits accurately. |
| SDK, embeds and ReceiptBox | Existing Node/React APIs, pricing/checkout/customer portals, real OCR, receipt history/export gates and immediate balance updates work against Avalanche. Version chain/provenance DTO changes and preserve documented compatibility. |
| MCP and ChatGPT | Existing tools plus subscription management retain semantics; OAuth PKCE/DCR/access/refresh/scope/reconnect behavior survives; identity evidence stays outside the agent. |
| Dashboard, notifications and queryability | Provider-scoped plans/subscriptions/grants, receipts/email hooks, attention/error states, indexed lists and direct contract checks agree after writes, restarts and expiry. |
| Migration and accounting | Existing paid balances have an explicit authorized migration/reissue path; never duplicate spendable balances across old/new stores. Separate database/env and fresh deployed addresses keep the chain baseline isolated. |

### Avalanche-native product extension and implementation order

The proposed public positioning is **verified service access for humans and agents across Avalanche L1s**. First preserve the full product on Fuji with wallet sessions, retained human evidence, credential status, payment/subscription/mandate contracts and the entitlement store adapter. `GrantStore` is the existing seam: implement all of `mint`, `get`, `findLive`, `consume`, `cancelRenewal`, `hold`, `commit`, `release` and `describe`; migrate callers with contract-backed parity tests. Add a verifier interface for identity assurance and keep existing World tests as compatibility tests. Reuse the console, gateway, daemon, policy and MCP instead of creating another dashboard or daemon. SQL remains the durable journal/index, with contract state authoritative for paid access.

Then extend the proven model through ICM: a paid allocation reserved on the source is activated on exactly one provider L1. The destination validates messenger, source blockchain ID, origin contract, issuer/policy version and allocation sequence. Duplicate or reordered delivery cannot refill credits. Identity and permission changes require their own explicit delivery/status semantics; never claim instantaneous global revocation. Keep narrowly scoped, expiring permissions on the destination, show pending deliveries in the existing console, and verify destination state before granting access. A useful demo is one verified customer granting an agent a small budget, buying a plan on Fuji, receiving an allocation on another L1 and scanning a receipt there, with replay/overspend denial and cancellation that preserves paid time. The submission must distinguish shipped behavior from roadmap and explain the old baseline versus new Avalanche work.

References for capability boundaries: [Arkiv fundamentals](https://docs.arkiv.network/start-here/fundamentals/), [Arkiv expiry](https://docs.arkiv.network/writing/expiration/), [World proof types](https://world.org/proofs), [Avalanche event indexing example](https://build.avax.network/integrations/envio), and [ICM contract semantics](https://build.avax.network/docs/cross-chain/icm-contracts/overview). No ecosystem endorsement or launch engagement is assumed; those depend on the working product and demonstration.
