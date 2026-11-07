# MCP tool reference

Discover current MCP schemas first; installed server versions may differ. Tools can have a client-specific namespace prefix.

## Access and checkout

| Tool | Inputs to consider | Behavior |
| --- | --- | --- |
| `bagseven_status` | None | Bound worker status; falls back to entitlement-only mode for an unregistered policy worker |
| `list_features` | None | Feature IDs and boolean/numeric value types; do not assume OCR is the only SKU |
| `grant_status` | Optional `feature`, `holder` | Operator-wide living grant catalog; no automatic worker filter |
| `list_agent_entitlements` | Optional `feature` | Living grants filtered by the bound worker |
| `check_entitlement` | `feature`, optional `holder` | Current worker-filtered access check |
| `paid_run` | Optional `feature`/`grant_id`, `amount`, `work`, `idempotency_key` | Consume prepaid credits; no new payment or mandate check. Omit grant ID for automatic selection |
| `consume_entitlement` | `feature`, optional `holder`/`grant_id`, `amount`, `idempotency_key` | Same prepaid usage path; supply a stable key for retries |
| `list_plans` | None | Plan prices, credit allocations and payout wallets |
| `create_plan` | `name`, `feature`, `amount`, `credits`, `ttl_seconds`, `merchant_wallet`, optional `interval` | Create a provider plan when authorized; `amount` is payment, `credits` is allocation |
| `create_checkout_session` | `plan_id`, `holder`, optional `worker_id`, `success_url`, `expires_in` | Create pending checkout; worker defaults to bound MCP worker |
| `mint_with_world`, `buy_credits` | `feature`, optional `plan_id`, `holder` | Without plan, return choices. With plan, open provider checkout |
| `get_checkout_session` | `checkout_id` | Checkout payment/grant state; use returned session IDs |
| `cancel_renewal` | `grant_id` | Turn future renewal off without revoking paid time |
| `explain_denial` | Optional `feature`, `holder`, `grant_id`, `amount`; `operation` = `access` or `payment` | Diagnose access or also mandate capacity without spending |

For entitlement-only checkout, prefer `create_checkout_session` with the intended holder and a discovered plan. Some versions of `mint_with_world` / `buy_credits` resolve a mandate owner even when a holder was supplied. If that owner lookup fails, use the explicit checkout tool rather than inventing an agent or disabling authorization.

## Spending and delegation

| Tool | Purpose |
| --- | --- |
| `list_mandates` | Discover mandates owned by the bound worker's owner |
| `get_mandate` | Read live balance, terms, capacity, agent tree and refusals; optional `mandate_id` |
| `list_agents` | Discover the current/selected owned mandate's agents |
| `get_agent` | Read bound worker by default or a discovered `agent_id` |
| `prepare_mandate` | Prepare owner-signable terms without deploying or moving funds |
| `create_mandate` | Submit prepared terms and owner signature; deploy/register permission |
| `prepare_mandate_funding` | Prepare an unsigned funding transaction for an amount and optional mandate |
| `bagseven_spawn` | Delegate a share to an operator under an owned mandate; applicable signature required |
| `bagseven_fetch` | Paid URL request or direct payment; server enforces policy and living grant |

Mandate terms include `operator_address`, `budget_per_window`, `window_seconds`, `lifetime_cap`, `per_purchase_cap`, `per_seller_pct`, `max_depth`. Despite its name, `per_seller_pct` uses basis points in the current schema: 10000 means 100%. Child `share_percent` uses integer percent (1–100). Never silently interchange them.

There is no universal `bagseven_search` tool in the current server. Do not invent tools from stale documentation. Dashboard `/app/mandate` supports the owner's connected wallet for funding, withdrawal and revocation; use an available advertised capability or route the owner there.
