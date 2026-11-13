# Agent instructions (Bagseven on Avalanche)

Use the current product paths: landing :3001, console :3000/app, gateway :4000, daemon :4001, policy :4003, MCP :4009. Do not add another dashboard, web app or inspector port. Design tokens live in docs/design.md. Browser calls authenticated console BFF routes and never holds daemon/private keys.

The Avalanche registry is authoritative for grants, credits, paid-through and reservations. PostgreSQL stores private discovery/recovery metadata. Prepaid usage requires a living holder-authorized grant, worker binding when present, and enough credits; it does not require a payment mandate. New agent payments require active agent/mandate capacity and a living grant. Credit units are not token amounts.

Authentication is verified email plus expiring, nonce/domain-bound wallet signatures. Neither proves unique humanity. Require explicit wallet approval for financial transactions. Keep raw billing email off-chain. Preserve ENTITLEMENT_SUBJECT_SECRET across restarts and deployments.

Provider-funded gas is mandatory in production. Never fall back to a platform private-key wallet. Provider permissions must be signed, expiring and bound to the current Avalanche chain. Encrypt delegated keys using PROVIDER_GAS_ENCRYPTION_KEY shared by console/daemon/policy. Atomically reserve worst-case fees before signing. Describe EOA limits as server-enforced. Journal signed bytes/hash before broadcast and recover the same transaction after restart.

Monthly billing uses BagSubscriptionPlan, explicit payer allowance/subscribe/cancel transactions, and durable collection/fulfillment journals. Never synthesize payer signatures, silently enroll existing grants, or mark an on-chain permission cancelled from a server flag. Uncertain fulfillment requires reconciliation before another charge or mint. Cancel renewal preserves already-paid time. Provider gas authorization must explicitly cover subscriptions and have at least 31 days remaining for checkout.

Live configuration: AVALANCHE_NETWORK, AVALANCHE_CHAIN_ID, AVALANCHE_RPC_URL, explicitly chosen AVALANCHE_USDC, AVALANCHE_ENTITLEMENT_REGISTRY, ENTITLEMENT_STORE=avalanche. Fuji is 43113. Only explicitly configured non-production tests may use memory grants. Apply migrations through 0022 and rebuild paired artifacts before deployment.

MCP uses HTTPS /mcp, OAuth PKCE and email-code plus wallet consent. Agents receive scoped Bagseven credentials. OAuth codes, tokens and consent challenges persist in PostgreSQL; HTTP MCP uses stateless per-request transports. Prepaid MCP clients need no deployed mandate; new spending retains the dual gate. Never expose private keys or auto-send wallet transaction drafts.

Run pnpm test and pnpm typecheck. Test registry accounting with node scripts/test-entitlement-registry.mjs. Local tests do not prove public deployment readiness. Keep durable documentation in README.md, llms.txt, docs/PRODUCT.md, docs/DEVELOPERS.md, docs/HOSTING.md, docs/DECISIONS.md and docs/design.md. Do not add root audit/report markdown.
