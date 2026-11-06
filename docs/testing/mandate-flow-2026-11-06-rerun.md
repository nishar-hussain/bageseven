# Mandate flow rerun — 6 November 2026

**Worker binding is confirmed fixed over HTTP.** The expanded suite now passes **19 of 22 checks**, compared with 18 of 22 before the fix. The complete HTTP/MCP smoke suite also passed with `E2E_OK`.

The dashboard request check signs in through the magic-link callback, mints a grant through `/api/daemon/grants/mint` without supplying a worker, verifies that the grant contains the configured `BAGSEVEN_MCP_WORKER`, and calls `/api/daemon/grants/paid-run` without a worker or bypass flag. Paid run succeeds and changes the remaining grant credits from 3 to 2.

The smoke suite passed authentication boundaries, dashboard routes, World mint/denial, demo credit settlement, worker-bound MCP tools, paid work, mandate denial, renewal cancellation retaining access, a local-chain token payment, and expiry at `paid_through`.

The same three other lifecycle failures remain:

| Check | Observed result |
| --- | --- |
| paid_run after child allocation is exhausted | Returns HTTP 200 instead of refusing |
| paid_run after the owner revokes the mandate | Returns HTTP 200 instead of refusing |
| Mandate signed for chain 1 on a deployment configured for 43113 | Creates the mandate instead of rejecting it |

The payment path correctly refuses exhausted child allocations and revoked mandates; the first two failures concern paid_run's capacity check. These issues were outside the worker-binding fix and were not changed during this rerun.

Tests used rebuilt backend services, the actual dashboard BFF and MCP server, a separate PostgreSQL database, local Redis, new contracts and local tokens on Anvil chain 43113, memory grants, mock World proofs, demo Hedera settlement, and log-only notifications. No live payments, Arkiv writes, or email delivery were tested. Dashboard requests were checked over HTTP; browser clicks were not exercised.

A confirmed local payment was `0xa80f234fb7483e55b20eaaf851ddf0364fbcc103fbf5a60509ec650457e1a84c`: vault balance went from 20.00 to 19.00, recipient balance increased by 1.00, lifetime spend became 1.00, and grant credits went from 20 to 19.

[All 22 results are saved as JSON](mandate-flow-2026-11-06-rerun.json). The [original report](mandate-flow-2026-11-06.md) retains the pre-fix findings.

The normal development stack was restored after the tests. Its runtime Redis URL was set to `redis://localhost:56379`, matching the existing container; `.env` still specifies port 6379 and was left unchanged. Temporary test files and the isolated SQL database were removed. Local test contracts and receipts remain on Anvil.
