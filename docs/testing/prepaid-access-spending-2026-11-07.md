# Prepaid access and agent spending — 2026-11-07

The dashboard now calls mandates **Agent spending permissions**. Prepaid credit usage (`paid_run`, MCP `consume_entitlement`, SDK `/v1/usage/consume`) checks living access, credits, and holder/worker scope without checking a USDT vault. New payments through `bagseven_fetch` retain mandate and entitlement checks.

## Verification

- Daemon: 73 tests passed, including a real MCP client/server connection over in-memory transport into the daemon grant routes. Prepaid access works without payment-worker capacity, retries do not double-consume in the tested sequence, cancellation retains current access, and exhausted access is refused.
- New-payment route tests reject unavailable mandates and missing payment entitlements. A signed spend intent is still sent to policy; a cap refusal preserves grant credits and prevents payment execution.
- Policy: 17 tests passed. Tests cover mixed missing/valid deployments, unknown revocation state, partial RPC failures, exact funding/withdrawal/revocation calldata, and rejection of unsafe drafts. Drafts do not send transactions.
- Console: 22 tests passed, including session checks, owner checks before forwarding management writes, and cross-origin write rejection. Console typecheck and lint of changed files passed.
- Policy and daemon lint/build passed. Console production build passed with `next build --webpack`. Default Turbopack build was blocked by the environment's CSS-worker socket permission.
- Live Whitechain reads: mandate `b855cb8f-a5e2-43fc-a417-65f2ef223e8e` remained available with `0.0899` USDT; root worker resolution agreed. A `0.01` USDT funding draft was generated, never submitted.
- Live stale-worker payment request returned `403 WORKER_INACTIVE` before sending a payment.
- Running daemon status reports `prepaid_access_requires_mandate=false` and `payment_requires_mandate=true`.
- Restarted MCP health and public OAuth discovery returned 200; unauthenticated public MCP initialization returned 401.

## Runtime and verification limits

The local dashboard's public `DAEMON_OWNER_ADDRESS` now matches the existing MCP agent owner, `0x59f9f231d579d2780898ec9b6de7a1e6cd40f62f`. Keys were unchanged. MCP remains bound to root worker `110c3d3f-a158-4b12-bf91-2da6666fc44a`. Restarting MCP resets its in-memory OAuth sessions; clients need to reconnect.

No new USDT transfer, contract deployment, withdrawal, delegation, or revocation was executed during these checks. No browser was connected, so the browser-wallet approval screens and a full human-driven management cycle remain unverified. Management actions require the matching owner wallet. Creating a new root does not automatically rebind the MCP connection. The deployment retains its existing operator wallet scope; this change does not implement independent multi-tenant wallet authorization.
