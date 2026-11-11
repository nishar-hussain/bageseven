# Hosting

Deploy the existing landing and console applications separately. Deploy daemon, policy, gateway and MCP using the existing Railway definitions. Use Node 24, PostgreSQL and Redis. Keep daemon feature data on its persistent volume.

Required server configuration includes `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `DAEMON_AUTH_TOKEN`, `POLICY_INTERNAL_TOKEN`, `RESEND_API_KEY`, and `PROVIDER_GAS_ENCRYPTION_KEY`. Share the provider encryption key across console, daemon and policy; back it up. Never place it or a private key in `NEXT_PUBLIC_*` variables.

Use Fuji chain 43113 with `AVALANCHE_NETWORK=fuji`, `AVALANCHE_CHAIN_ID=43113`, `AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc`, matching `CHAIN_ID`/`RPC_URL`, and an explicitly chosen six-decimal token in `AVALANCHE_USDC`. Existing contract addresses from another network cannot be reused. Set `AVALANCHE_DEMO_SETTLE=false`.

Deploy `BagEntitlementRegistry` and configure `AVALANCHE_ENTITLEMENT_REGISTRY`. Set `ENTITLEMENT_STORE=avalanche`, generate and persist a private `ENTITLEMENT_SUBJECT_SECRET`, and run database migrations through 0014. Provider gas permissions must be newly signed for the configured chain and provider; native funding is AVAX. Do not import authorization blobs from another deployment.

Console uses `NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL` and `NEXT_PUBLIC_AVALANCHE_EXPLORER` for wallet display. It also needs its daemon/gateway URLs, shared session/provider secrets, Resend configuration and WalletConnect project ID. Production email delivery failures are surfaced as unavailable sign-in rather than exposing development links.

For remote MCP, configure `MCP_OAUTH_REQUIRED=true`, the bound worker and `BAGSEVEN_MCP_PUBLIC_URL=https://your-host`. Forward HTTPS to port 4009 and register `/mcp` in the client. MCP email consent requires working Resend delivery. Authorization codes, refresh credentials and transport sessions currently live in process memory; use one replica and reconnect clients after restart.

Before publishing, verify a real wallet sign-in, provider gas authorization/funding, plan checkout, subscription creation/renewal/cancellation, SDK consumption with an immediate balance update, and an MCP consume. Local tests alone do not establish live readiness. Never send a wallet transaction draft automatically.
