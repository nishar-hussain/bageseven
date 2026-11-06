# Mandate flow test — 6 November 2026

The local HTTP/MCP smoke suite passed, but the broader mandate lifecycle has four reproducible failures: **18 checks passed, 4 failed**. Product code was not changed.

**Worker-binding follow-up:** Issue 3 below has since been fixed in source. Dashboard mint and credit purchases save the daemon's configured MCP worker; paid_run also uses that default for older unbound grants. All 47 daemon tests, including the binding regressions, console/daemon typechecks, and backend lint passed. The results below remain the original pre-fix snapshot; a subsequent HTTP/MCP rerun confirms the dashboard flow passes, with 19/22 lifecycle checks passing. See the [rerun report](mandate-flow-2026-11-06-rerun.md).

## Scope and environment

Tested the working tree, including its existing uncommitted changes, through the actual console, gateway, policy, daemon, PostgreSQL, Redis, MCP server, and deployed BagMandate contracts. Used the standard product ports (3000, 3001, 4000, 4001, 4003).

Used an isolated PostgreSQL database, Redis database 15, fresh local Anvil contracts and tokens, memory grants, World mock proofs, Hedera demo settlement, and `NOTIFY_MODE=log`. The root `.env` was verified unchanged by SHA-256. No live Arkiv writes, Hedera settlement, public testnet payments, or email delivery were exercised.

No browser was connected. Dashboard routes and form request payloads were tested over HTTP; rendering and actual clicks remain unverified. The Mandate page currently provides navigation links, with no mandate creation or funding form. Mandate creation and funding were tested through the gateway API.

## Reproduced failures

### 1. High: paid_run allows a revoked mandate

Create and fund a mandate, bind a living grant to its root worker, and revoke the contract using the owner signer. `bagseven_fetch` correctly refuses with `MandateInactive`. However, `POST /internal/grants/paid-run` returns HTTP 200, burns a grant credit, and reports both gates as `ok`.

The capacity resolver checks database status and aggregate balances, but does not check the contract's revoked state. Database status remains active after the on-chain owner action. See [daemon capacity resolver](../../services/daemon/src/index.ts#L379) and [worker resolution](../../services/policy/src/routes.ts#L512).

Expected: paid_run refuses and preserves grant credits after revocation.

### 2. High: paid_run ignores the child worker's remaining allocation

Create a mandate with lifetime cap 10.00 and a child with a 10% allocation (1.00). Execute a 0.75 payment from that child. A further 0.50 payment correctly refuses with `WorkerAllocationExceeded`. A paid_run costing 1.00 nevertheless returns HTTP 200 and burns a grant credit, even though the child has only 0.25 remaining.

The same capacity resolver considers global mandate balances and per-purchase cap, without checking worker allocation or ancestor allocation. See [daemon capacity resolver](../../services/daemon/src/index.ts#L379).

Expected: paid_run applies the worker's on-chain capacity and preserves credits on refusal.

### 3. High: dashboard Mint → Paid run fails with MANDATE_REQUIRED

Sign in through the magic-link callback, mint using the dashboard's request payload, then submit its Paid run payload through `/api/daemon/*`.

Mint succeeds without `worker_id`. Paid run also supplies no worker; it sends `skip_mandate_gate: true`, which the backend correctly ignores. The response is HTTP 403: `MANDATE_REQUIRED: paid work requires a worker with mandate capacity`.

See [Mint request](../../apps/console/app/app/mint/page.tsx#L19), [Paid run request](../../apps/console/app/app/grants/page.tsx#L18), and its stale bypass description on the same page.

Expected: the dashboard selects and binds a valid worker before invoking paid work.

### 4. Medium: mandate creation accepts a signature for a different chain

Sign the canonical mandate with `chain_id: 1` and submit it to the local deployment configured for chain 43113. `POST /v1/mandates` returns HTTP 200 and deploys a contract on chain 43113.

Signature recovery uses the request's chain ID, while deployment uses the configured chain. There is no equality check. See [creation route](../../services/policy/src/routes.ts#L156).

Expected: reject a signed chain ID that differs from the deployment chain before deployment or database writes.

## Checks that passed

The existing `scripts/smoke-e2e.mjs`, run against the isolated environment, completed with `E2E_OK`. It covered authentication boundaries, signed magic-link redirect cookies, all dashboard routes, World mint/denial, demo credit settlement, worker-bound MCP tools, paid_run and mandate denial, renewal cancellation, local token payment, and paid_through expiry.

The additional lifecycle checks passed for:

- Owner signature rejection, gateway mandate creation, contract deployment, funding, and idempotent creation retries.
- Requiring a living grant; successful token payment with receipt, recipient balance, vault debit, lifetime accounting, and grant debit verified.
- Per-purchase limits (including equality), window budget, lifetime budget, seller concentration, and vault insufficiency. Refusals preserved tokens and grant credits.
- Owner-signed withdrawal and rejection of a different signer.
- Operator signatures, stale spend intents, nonce replay, and internal settlement authorization.
- Child allocation and maximum depth on the payment path.
- Grant exhaustion, cancellation retaining paid_through and current access, and repeated paid_run idempotency keys consuming only once.

Example confirmed local payment: `0x9518aade74edb82407d779de1353362428be481e9e2f894e6454171257f9b16b`. Vault moved from 20.00 to 19.00, recipient gained 1.00 token, lifetime spend became 1.00, and grant credits moved from 20 to 19.

## Other validation

- Daemon: **40 unit tests passed**.
- Entitlements: **3 unit tests passed**.
- Money: **2 unit tests passed**.
- Console and daemon typechecks passed.
- Console production build passed with `next build --webpack`. The default Turbopack build encountered an environment process/port permission error.
- Solidity suite: **15 passed, 2 failed**, including 256 fuzz runs in the passing fuzz test. Missing forge-std was fetched into `/tmp` and supplied using a remapping, without changing repository dependencies.

The two Solidity failures concern test setup/error expectations:

1. `testRevokeBlocksExecute` passes worker ID `0`, which is unregistered, and receives `WorkerInactive` before its expected `MandateInactive`.
2. `testWorkerAllocationAndAncestorAccounting` attempts 51.00 against a mandate with a 1.00 per-purchase cap, receiving `PerTxCapExceeded` before its expected `WorkerAllocationExceeded`. Its following 50.00 spend would also exceed that fixture's cap and other limits.

The HTTP lifecycle tests independently confirmed that revocation and child allocations block payments with registered workers and suitable limits.

## Reuse

[Machine-readable results](mandate-flow-2026-11-06.json) contain every expanded check. [scripts/test-mandate-flow.mjs](../../scripts/test-mandate-flow.mjs) retains the regression scenarios and exits nonzero while failures remain.

Only run it against a local development configuration with memory grants, mock World, demo Hedera, local Anvil chain 43113, a funded local executor/token, and log-only notifications. The script checks these conditions before creating mandates. Start the stack with the same configuration and `NOTIFY_MODE=log`.

```sh
NOTIFY_MODE=log node --env-file=.env scripts/test-mandate-flow.mjs
```

For a separate configuration, set `BAGSEVEN_E2E_ENV_FILE` to that file. Set `BAGSEVEN_E2E_REPORT` to an output JSON path to save results. The existing live-oriented `.env` intentionally fails the script's preflight checks.

After capture, another process restarted the standard service ports. Those replacement services were left untouched.

The isolated SQL test database and temporary test configuration were removed after capture. Local test contracts and their receipts remain on Anvil. No replacement service processes were stopped.
