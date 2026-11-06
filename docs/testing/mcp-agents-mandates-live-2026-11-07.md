# MCP, mandates, agents and entitlements — live verification

The MCP catalog lacked mandate/agent discovery, child creation used an unrelated owner signer, and agent payment signing assumed one operator key. Checkout assigned every purchase to the default worker, while USDT capacity and child allocations were rounded to cents. These failures made the separate product components look disconnected.

The server now exposes 24 MCP tools. New tools include `list_mandates`, `get_mandate`, `list_agents`, `get_agent`, `prepare_mandate`, `create_mandate`, `prepare_mandate_funding`, `list_agent_entitlements`, `list_features`, `list_plans`, `create_plan`, and `get_checkout_session`. Spawning defaults to the bound mandate/root; it cannot choose another mandate or a parent outside that agent subtree. Creation requires an owner signature. Funding returns a wallet transaction for explicit approval and refuses a mismatched token. No tool accepts a private key.

Checkout persists the selected worker before payment, so a child receives its own grant and later changes to server configuration cannot redirect a pending purchase. Live minting refuses unpaid local settlement. `check_entitlement` and `list_agent_entitlements` use the bound worker. The legacy `grant_status` remains the explicitly operator-wide catalog, consistent with existing unbound grants. Cross-worker grant consumption is refused. Root and child limits, revoked state and allocations are read from Whitechain with exact six-decimal USDT values; PostgreSQL's trailing decimal zeros are accepted without rounding away real precision.

Agent payment requests accept a stable idempotency key backed by persistent Redis. Successful retries return the original transaction. Uncertain attempted payments are held for reconciliation and are never automatically resent. Paid-run credit idempotency remains the grant store's existing behavior; this report does not establish restart-safe idempotency for every Arkiv credit operation.

## Real run

The [JSON evidence](mcp-agents-mandates-live-2026-11-07.json) records 13 passing checks through real MCP SDK clients, the running daemon/policy services, PostgreSQL, public Whitechain chain 1874, and live Arkiv. No World proof, receipt, USDT transfer, or mandate capacity was fabricated. The clients used trusted local stdio; public HTTPS OAuth discovery and unauthenticated rejection were checked separately. The user then reconnected Bagseven in ChatGPT and confirmed that the active mandate, root agent and child agent appear.

The run discovered the owned mandate and root, deployed an owner-signed isolated mandate, prepared and funded its wallet transaction, registered a 1% child with exactly 0.001 USDT allocation, and paid two 0.05 USDT provider checkouts for root/child research access. Each checkout accrued one separately billed 0.00005 USDT fee.

Root and child clients independently checked their grants, ran paid work, and transferred 0.01 and 0.0001 USDT to the supplied provider. Repeating the root payment returned the same transaction. Overspending, unrelated OCR access and cross-worker grant consumption were denied without additional token movement or credit consumption. Cancelling renewal preserved existing access. Independent Arkiv reads confirmed remaining credits. The isolated test mandate was revoked and its 0.01 USDT recovered; the original mandate stays active with 0.0899 USDT in its vault and its child remains registered.

Total net buyer USDT used by the recorded authorized tests is 0.30, including the earlier 0.20 test, below the user's 1 USDT limit. The current run snapshots a fresh wallet baseline because unrelated wallet activity must not be counted as test spending. Notifications were log-only during the live test and normal service configuration was restored afterward.

## Validation and operation

104 targeted tests passed: daemon 67, policy precision 3, World 16, console 18. Backend builds, console/daemon/policy typechecks and changed-source lint passed. The checkout-worker migration was applied locally. `node scripts/test-mcp-live.mjs` is checkpointed and reuses recorded transactions; it requires the configured funded test wallet and never permits a mainnet run.

Refresh/reconnect Bagseven in ChatGPT after the MCP restart to load the changed tool catalog. Ask it to list mandates and agents, then inspect live capacity before paid work. The existing test mandate intentionally has a small 0.10 USDT ceiling; work above its remaining capacity must be denied. Grant expiry and other denial cases also have automated coverage; this live run did not wait for a fresh 24-hour grant to expire. This verifies the configured operator-bound instance, not independent multi-tenant authorization or automated platform-fee collection for every payment rail.
