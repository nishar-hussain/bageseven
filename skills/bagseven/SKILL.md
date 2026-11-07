---
name: bagseven
description: Use Bagseven MCP tools to inspect living entitlements, consume prepaid credits, open provider checkouts, and manage authorized agent spending permissions. Use for Bagseven access, grants, plans, mandates, renewal, or payment denials.
---

# Bagseven

Bagseven separates three facts: Whitechain records payment, Arkiv grants determine current access, and `renewal_enabled` determines future renewal. World verifies the human; Bagseven OAuth authenticates the agent.

## Connect and discover

Use the user's connected Bagseven MCP server. For a remote connection, obtain the operator's HTTPS `/mcp` URL and complete the available OAuth flow. A skill supplies instructions; it does not install an MCP connection, create an account, or grant credentials. If disconnected, provide the missing connection step and continue any independent explanation; do not invent a deployment URL.

Start with `bagseven_status` and `list_features`; discover the installed tool schemas before calling a tool. The server hides the bound worker ID. Prefer discovery tools to asking a human to paste grant, worker or mandate IDs. Read [the tool reference](references/tools.md) for specific flows and [denials and recovery](references/denials.md) when a request is refused.

## Choose the correct operation

| User intent | Path | Required authority |
| --- | --- | --- |
| Inspect access | `grant_status`, `check_entitlement` | Read access; no payment |
| Use already-paid credits | `paid_run` or `consume_entitlement` | Living authorized grant, enough credits and applicable worker binding |
| Buy or extend access | Discover plan → create checkout → human wallet payment | Actual plan price, intended holder and successful payment confirmation |
| Make a new payment or fetch a paid resource | `bagseven_fetch` | Active registered agent, remaining mandate capacity **and** living grant |
| Delegate or create a spending permission | Prepare terms → owner signature → submit | Owner-signed terms; funding is a separate wallet approval |
| Cancel future renewal | `cancel_renewal` | Authorized grant; existing paid access remains until expiry/exhaustion |

`entitlements_only` mode allows prepaid usage without a deployed USDT mandate. Do not create a mandate, deposit funds or retry a payment merely to fix a prepaid-credit request. Credit units are feature usage, not USDT amounts.

## Use prepaid access

1. Discover the feature and intended grant. `grant_status` is an operator-wide catalog; `list_agent_entitlements` filters to the bound worker. A grant visible in the catalog is not automatically authorized for consumption by that worker.
2. Read `enabled`, `remaining`, `paid_through` and holder/worker scope. Use server results as truth; a local cache or paid receipt alone does not establish current access.
3. For an authorized request, call `paid_run` with a feature and credit amount, or the chosen `grant_id` when necessary. Example arguments: `{"feature":"ocr","amount":"1","idempotency_key":"ocr-document-42"}`. Reuse the same key and identical inputs when retrying the same consumption; use a new key for new work.
4. Report the actual result and updated remaining credits. `paid_run` records entitlement usage/work metadata; it does not by itself upload a document or run an OCR model. Execute the underlying application work only through an available authorized capability.

## Buy access

Discover active provider plans and confirm the user's intended plan, feature, price, holder and worker. Use `create_checkout_session` to return the hosted wallet checkout. `mint_with_world` and `buy_credits` also route to plan checkout; they do not bypass payment or accept pasted World proofs.

A returned checkout URL is pending, not a purchase receipt. Poll `get_checkout_session` only as needed and confirm a living grant after the actual payment is verified. The human approves wallet transactions and World consent. Agents never ask for World credentials or wallet private keys.

## Make a new payment

Inspect the current mandate and agent capacity before an authorized payment. Preserve the user's recipient, amount, budget and purpose. For a paid resource, pass its URL to `bagseven_fetch`; the daemon derives payment terms from the provider challenge. Do not fabricate or override challenge recipients/amounts. For a direct payment, use an explicit decimal amount and recipient. Supply a stable `idempotency_key` and reuse it for retries of the same operation.

A refusal is not permission to raise caps, switch identities, change recipients, disable grants or use a different payment rail. If an attempted payment has an uncertain result, inspect returned status and reconcile before retrying; do not generate a fresh key to bypass a hold.

## Manage permissions

Read current terms through `get_mandate` / `get_agent`. Use `prepare_mandate` to present exact terms for the owner's wallet signature, then `create_mandate` with that signature. `prepare_mandate_funding` returns an unsigned transaction; return it to the owner for approval rather than auto-sending it. `bagseven_spawn` delegates within the existing mandate and requires the applicable owner/operator authority.

Only perform the mutation the user has requested or already authorized. A request to inspect access or explain a denial does not authorize a purchase, delegation, withdrawal, revocation or renewal change.

## Complete the task

Distinguish observed access state, consumed credits, pending checkout, verified payment and unsigned wallet draft. Include relevant public IDs or transaction hashes when available, never credentials. State any remaining human checkout/consent step explicitly. Do not claim the skill has connected a server or moved funds when it has only prepared instructions.
