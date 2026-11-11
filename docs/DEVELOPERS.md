# Developer integration

Use the existing `@bagseven/sdk` workspace package for entitlement checks, consumption, checkout and embedded billing. Browser traffic goes through the console BFF; secret API keys and daemon tokens remain on the backend. Publishable keys support permitted reads, and customer tokens are holder-scoped.

Configure `AVALANCHE_NETWORK=fuji`, `AVALANCHE_CHAIN_ID=43113`, and `AVALANCHE_RPC_URL`. Set the exact six-decimal stablecoin contract as `AVALANCHE_USDC`. Network, receipt token, payer, recipient, amount and confirmation depth must match before access is issued. No token address or successful payment is synthesized.

Browser helpers exported from `@bagseven/sdk/wallet` are `connectAvalancheWallet`, `authorizeAvalanchePayment`, `payStablecoinOnAvalanche`, `subscribeOnAvalanche`, `cancelAvalancheSubscription`, and `renewSubscriptionAllowance`. Checkout supplies its configured token address. Funding, allowances, subscription creation and cancellation require wallet approval.

The registry store implements all GrantStore methods. Decimal credits use 18-decimal atomic units and are bounded by uint128. Private metadata is scoped by chain, contract and grant key. Contract consumption IDs prevent duplicate decrements; reservation finalization cannot both commit and release. Registry writes use the provider's authorized signer and a durable signed-transaction journal.

Discovery filters run in PostgreSQL against indexed holder, feature, worker and expiry fields before bounded parallel contract reads. Renewal workers select at most 100 due subscriptions per cycle, honor retry delays and use database advisory locks to coordinate collectors. Payment and entitlement writes remain independently journaled before broadcast.

For Anvil development, run `pnpm setup`, `pnpm start:local`, then `pnpm mcp:local`. To populate one explicitly selected local workspace, set `LOCAL_PROVIDER_EMAIL=your-email` when running `pnpm seed:local`. This creates three receipt plans, provider gas authorization funded with local test AVAX, and three contract-backed grants. It does not create a customer subscription or allowance. Local wallet payments must use the configured Anvil RPC at `http://localhost:58545` with chain ID 43113; public Fuji RPCs cannot see Anvil contracts. Use public Anvil development accounts only. Keep the Anvil database and addresses separate from Fuji deployment configuration.

For local offline unit tests only, explicitly select `ENTITLEMENT_STORE=memory`. Production requires `ENTITLEMENT_STORE=avalanche`, a deployed registry, `DATABASE_URL`, and `ENTITLEMENT_SUBJECT_SECRET`. Apply migrations through 0014. Do not rotate the subject secret without an explicit identity migration.

MCP tools include status, entitlement checking/consumption, `buy_access`, checkout creation, `paid_run`, renewal cancellation, denial explanations, and bounded `bagseven_fetch` payments. Remote clients use HTTPS streamable HTTP at `/mcp`, OAuth PKCE, and email-code plus wallet-signature consent. Agents receive Bagseven tokens and never receive inbox credentials or wallet private keys.

OAuth sessions are bound to the verified email, signed wallet and client. Holder-scoped grants and subscriptions cannot be accessed through another account's login; new spending requires the signed wallet to own the bound worker's mandate. An explicitly configured static operator credential retains service-level access and must stay private. MCP HTTP sessions and OAuth credentials currently require a single MCP replica and reconnect after restart; shared durable OAuth/session storage is required before horizontal MCP scaling.

Verify with `pnpm test`, `pnpm typecheck`, and `node scripts/test-entitlement-registry.mjs`. Rebuild contract artifacts with `node scripts/compile-entitlement-registry.mjs` and `node scripts/compile-subscription.mjs` after contract changes.
