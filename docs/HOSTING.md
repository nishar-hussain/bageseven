# Hosting

Deploy the existing landing and console applications separately. Deploy daemon, policy, gateway and MCP using the existing Railway definitions. Use Node 24, PostgreSQL and Redis. Account profiles, custom feature definitions, OAuth credentials and consent challenges use PostgreSQL. For Vercel, configure CONSOLE_DATABASE_URL with a public pooled PostgreSQL endpoint; a Railway private reference is not reachable from Vercel. Before upgrading an existing installation, explicitly import its feature catalog with node --env-file=.env scripts/import-feature-catalog.mjs <features.json>. Do not accept traffic until migrations and import complete.

Required server configuration includes `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `DAEMON_AUTH_TOKEN`, `POLICY_INTERNAL_TOKEN`, `RESEND_API_KEY`, and `PROVIDER_GAS_ENCRYPTION_KEY`. Share the provider encryption key across console, daemon and policy; back it up. Never place it or a private key in `NEXT_PUBLIC_*` variables.

Use Fuji chain 43113 with `AVALANCHE_NETWORK=fuji`, `AVALANCHE_CHAIN_ID=43113`, `AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc`, matching `CHAIN_ID`/`RPC_URL`, and an explicitly chosen six-decimal token in `AVALANCHE_USDC`. Existing contract addresses from another network cannot be reused. Set `AVALANCHE_DEMO_SETTLE=false`.

Deploy `BagEntitlementRegistry` and configure `AVALANCHE_ENTITLEMENT_REGISTRY`. Set `ENTITLEMENT_STORE=avalanche`, generate `ENTITLEMENT_SUBJECT_SECRET` once for a fresh installation and preserve the existing value on every restart or upgrade, and run database migrations through 0024. Provider gas permissions must be newly signed for the configured chain and provider; native funding is AVAX. Do not import authorization blobs from another deployment.

Console uses `NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL` and `NEXT_PUBLIC_AVALANCHE_EXPLORER` for wallet display. It also needs its daemon/gateway URLs, shared session/provider secrets, Resend configuration and WalletConnect project ID. Production and local public-Fuji email delivery failures are surfaced as unavailable sign-in. Preview codes/links require explicit DEV_MODE=true outside production. Configure the public CONSOLE_URL for notification links.

For remote MCP, configure `MCP_OAUTH_REQUIRED=true`, the bound worker and `BAGSEVEN_MCP_PUBLIC_URL=https://your-host`. Forward HTTPS to port 4009 and register `/mcp` in the client. MCP email consent requires working Resend delivery. Authorization codes, access and refresh credentials, email-consent attempts and rate claims persist in PostgreSQL. Bearer and code values are hashed for database keys. HTTP MCP uses a fresh transport per request, so requests do not require replica affinity. Initialize clients again when upgrading from the previous stateful transport.

Before publishing, verify a real wallet sign-in, provider gas authorization/funding, plan checkout, subscription creation/renewal/cancellation, SDK consumption with an immediate balance update, and an MCP consume. Local tests alone do not establish live readiness. Never send a wallet transaction draft automatically.

## Upgrade and acceptance sequence

1. Back up PostgreSQL and the existing subject, session, scope, gas-custody and payment-custody secrets. Keep their values stable; a database backup alone cannot recover encrypted signer keys.
2. Use Node 24.x. Install the locked dependencies, apply migrations through 0024 and build the workspace. Rebuild paired contract ABI/bytecode artifacts only when their sources change; do not mix old daemon/policy artifacts with a new console.
3. Configure the canonical console, landing, service and HTTPS MCP origins. Browser traffic stays on authenticated console BFF routes. Use a public pooled database endpoint for the console on Vercel, not an internal Railway hostname.
4. Check email delivery in live mode, new-account OTP plus ownership signing, returning-wallet reconnect and explicit wallet replacement. No preview code or magic link should be returned when DEV_MODE=false. A replacement does not migrate existing financial permissions.
5. Verify provider authorization and native AVAX funding separately. A customer also needs the configured payment token, such as Fuji USDC; funding AVAX alone does not fund checkout. New monthly checkout needs subscription gas authority with at least 31 days remaining.
6. Exercise one-time and recurring checkout with wallet-approved payments, reconcile receipts and grants, then check Customers and Invoices under both provider and buyer identities. Check paid-receipt email delivery and its expiring document link. Tax assessment is not part of this release.
7. Verify SDK credit consumption and remote OAuth MCP against the deployed origins. For new agent or x402 payments, separately activate and verify the mandate and payment authority. Prepaid consumption needs no funded mandate.

`pnpm check:prod` validates prepared configuration; it does not perform a funded public payment. `pnpm check:hosted` checks hosted endpoints after deployment. Keep smoke scripts that can mint, spend or email separate from read-only health checks, and inspect their entry points before running them.

PROVIDER_SCOPE_SIGNING_KEY signs short-lived service scope claims and is shared with console, daemon, policy and MCP. It must be separate from PROVIDER_GAS_ENCRYPTION_KEY; the MCP service does not need the gas-key encryption secret. Existing signed session wallets must be verified once to populate the new durable profile; do not import cookie assertions as wallet authority.

Isolated x402 payments require a separate persisted `X402_PAYMENT_ENCRYPTION_KEY` on the daemon and an HTTPS `X402_FACILITATOR_URL` (default PayAI). Back up both payment and gas custody keys with the database; changing either strands its corresponding delegated accounts. Do not distribute payment custody to the browser, console or MCP. Apply all migrations through 0024 before starting the paired services; 0019 introduced the x402 journals. Existing reservations without a recorded recipient cannot be automatically settled by the new proof endpoint; reconcile their original chain transaction explicitly. A reservation cannot reuse another settlement transaction.

Prepaid service operation requires provider gas funding and signed authority, but no agent mandate. New agent/x402 payment activation additionally requires an owner-funded on-chain mandate, explicit separate x402 owner approval, a supported configured token, an approved resource origin/host and a funded public settlement/recovery verification. Anvil tests and capability probes are not public-deployment readiness evidence.

Capacity reads use a read-only mandate client and require no platform executor key. Production writes require each provider's signed gas delegation; the agent operator key signs only mandate intents. Keep local Anvil provider keys, databases, signing journals and token/registry addresses separate from public Fuji deployment state, even though both may report chain ID 43113. Registry studio checks the public genesis before requesting a wallet transaction. Public registry deployment confirmation alone does not establish a funded public checkout, provider gas authorization or x402 settlement.

## Secure public Fuji registry deployment

Run `pnpm fuji:prepare` to prepare the private production configuration for public Fuji. It backs up an existing `.env.prod`, removes retired-chain settings from generated imports, disables development modes and selects Fuji USDC at `0x5425890298aed601595a70AB815c96711a31Bc65`. It preserves existing custody keys and the entitlement subject secret. A missing or known Anvil operator key is replaced with a new intent-signing key; this key does not fund provider gas. The existing local `.env` and Anvil database are untouched. No hosting deployment or financial transaction is sent.

Run preparation again after registry deployment: it verifies the saved public deployment manifest before selecting the registry. Supply the actual Railway public endpoints, Vercel project origins and public pooled database URL in `.env.prod`, regenerate with `pnpm setup:prod`, and require `pnpm check:prod` to pass before importing variables into hosting. Use a separate public-deployment database and fresh provider approvals; do not import Anvil gas journals or mandate fixtures. `pnpm check:hosted` validates the deployed services once their real URLs and credentials are configured.

Keep private keys and keystore passwords out of chat, environment files and command arguments. Install Foundry, then run these commands in your own terminal from the repository root:

```bash
pnpm fuji:registry import
pnpm fuji:registry plan
pnpm fuji:registry deploy
```

Import prompts locally for the private key and an encryption password. The encrypted V3 keystore is stored with private permissions in ignored `.data/keystores/bagseven-fuji`. Deploy displays the public account, network, nonce, bytecode hash and maximum fee; it requires typed approval before Foundry prompts for the password. Neither the application nor this CLI decrypts the key: Foundry signs the exact deployment and the CLI verifies the recovered signer and every transaction field before broadcasting. Use a dedicated testnet deployment account. Back up the encrypted keystore and password separately.

Foundry may omit the optional public address from its V3 file. This is supported: import records the public address returned by Foundry in a separate file bound to the encrypted keystore's fingerprint. For an already imported file without that metadata, `pnpm fuji:registry account` asks Foundry to unlock locally once and record only the public address. It sends no transaction. Re-running import preserves the existing keystore.

The command pins the official public Fuji RPC and genesis, rejecting local Anvil even when it also uses chain ID 43113. Signed bytes and hash are durably journaled before broadcast. If interrupted, run `pnpm fuji:registry resume` to recover the same transaction; `pnpm fuji:registry status` verifies two confirmations, creation bytecode and deployed runtime. Do not delete the deployment journal to retry. A stale lock after a process crash may be removed only after confirming no deployment command remains running.

Alternatively, approve deployment in the existing Registry studio with your browser wallet, then run `pnpm fuji:registry verify <public-transaction-hash> <public-owner-address>`. This read-only chain verification requires no keystore and saves the same public manifest for `pnpm fuji:prepare`; it refuses to replace a different previously verified deployment.

Verified public details appear in `.data/fuji/registry.json`; share only the public transaction hash and registry address. This operation deploys the registry only and preserves the existing Anvil configuration. Activating public Fuji still requires an explicit configuration change, provider gas approval/funding and separately approved customer transactions; local fixtures and balances do not migrate to Fuji.

## Local Anvil snapshot permissions

The Foundry image runs as UID 1000. Docker initially owns named volume directories as root; the `anvil-state-init` service prepares `/data` before Anvil starts. Anvil writes `/data/state.json` every second and reloads it on restart. Confirm that the snapshot exists and is writable before relying on local fixtures. PostgreSQL discovery metadata cannot restore missing contract state.

If Anvil is empty while PostgreSQL still references contracts, back up both stores before recovery. Restore a matching chain/database snapshot or explicitly reset chain-dependent test data; do not silently turn database balances into on-chain grants. Preserve account profiles, feature/catalog definitions, embed designs and the subject secret when refreshing local fixtures. Reconnect MCP clients whose worker credentials belonged to the retired test chain. `LOCAL_PROVIDER_EMAIL` selects an Anvil-only provider fixture: the known development owner approves its gas permission, the delegated provider signer deploys/enforces its spending mandate, and monthly plan contracts are prepared without enrolling a customer.

## Activate public Fuji on the existing local product ports

The current verified registry is `0x52698af55f4396b3f31ff4940e5060140c3df03f`, deployed by `0x59f9F231d579D2780898Ec9B6de7a1e6CD40F62F` in transaction `0x255747ec4f05f66dfd78fb76968e65b5dfef2f891ade355e5d1ba7f48d4e619a`. Its creation transaction and deployed runtime were verified against the paired registry artifact on public Fuji. Deployment credentials remain in the encrypted Foundry keystore, not in application environment files.

After `pnpm fuji:prepare`, `pnpm fuji:activate` runs a read-only preflight. `pnpm fuji:activate --apply` verifies the deployment manifest and selected token on-chain, creates/migrates a separate local `bagseven_fuji` database, backs up the old private environment, stops the old service owners and selects the public runtime. Existing product ports and local web origins remain unchanged; this does not publish the web apps to an internet host. The old Anvil database is not deleted or imported. No grants, mandates, gas permissions, billing plans or subscription consent are synthesized.

Start with `pnpm start:local` and `pnpm mcp:local`. Startup requires public HTTPS RPCs when development mode is off and verifies Fuji genesis before serving the stack. Known development signing keys, static MCP tokens and legacy chain aliases are absent from the active runtime. Re-sign in, link your wallet and explicitly authorize/fund provider gas before preparing paid plans. A customer must separately approve payment and recurring permissions. Preserve the subject secret and both custody encryption keys.

Anvil is now an opt-in Docker profile (`local-anvil`) for isolated tests. Default Compose startup does not launch it; platform setup starts it only for an explicitly selected development fixture. `pnpm setup -- --force` cannot overwrite a public runtime with development keys. Brand-new Anvil fixture generation requires explicit `--anvil` in a separate test checkout. Automated tests can continue to use isolated temporary EVMs without changing the active public network.

If a free ngrok hostname changes, update `BAGSEVEN_MCP_PUBLIC_URL`, restart MCP and reconnect the custom client to its HTTPS `/mcp` URL. The hostname is a development access tunnel, not permanent production hosting. OAuth email/wallet consent remains required, and the public-chain database deliberately has none of the old Anvil authorizations.

### Fund a provider gas account from the encrypted deployment wallet

After signing the limited provider gas permission in Network & gas, `pnpm fuji:gas plan` reads the active public-Fuji permission and prepares a 0.05 AVAX deposit from the deployment keystore. The provider wallet that authorized the delegated signer can differ from the wallet funding its native gas. The deposit grants no stablecoin allowance or vault authority.

Run `pnpm fuji:gas fund` in your own terminal. Review the destination, public network and maximum additional fee, type `FUND FUJI GAS`, then unlock the Foundry keystore locally. The command validates the exact signed recipient, native value, chain, nonce and fee fields; rejects calldata or another signer; journals signed bytes and hash before broadcast; and waits for two confirmations. If interrupted use `pnpm fuji:gas resume` to recover the same transaction, or `status` to verify it. An existing journal blocks a duplicate deposit. Additional routine funding can use the dashboard wallet flow after explicit review. Neither this utility nor the application sees the keystore password or raw deployment private key.

`pnpm fuji:gas status` also reports the dedicated account's current public-Fuji balance when no funding journal exists. External transfers can fund that account without creating a local journal; its balance alone does not verify a particular payment. A wallet's pending-request error does not establish whether a deposit was sent. Review or dismiss the pending request in the wallet, then check the dedicated account balance or transaction receipt before retrying. After an external deposit confirms, use **Refresh account** in Network & gas.

## Customer invoice delivery rollout

Apply migration 0023 before starting the paired daemon and console. Configure real `RESEND_API_KEY`/verified `RESEND_FROM`, customer-reachable `CONSOLE_URL`, and the existing preserved `ENTITLEMENT_SUBJECT_SECRET`. The daemon processes the durable paid-receipt outbox; no new service or port is needed. Inspect delivery status on the private billing document. Uncertain jobs past the safe provider-idempotency window require provider-side reconciliation, never a blind resend. Old paid records are not bulk-emailed by the migration.

Integrations must supply an authenticated customer billing email when issuing customer tokens. Verify that separate customer/provider wallets can buy one-time and recurring access, that self-payment fails before approval, and that the customer receives the correct scoped invoice link. Existing subscription contracts are immutable; rebuild ABI/bytecode for new deployments, preserve confirmed existing deployments and reconcile pending older artifacts explicitly. Never silently enroll, move or re-charge an existing payer during an upgrade.

Verify actual mailbox placement as well as provider acceptance before launch. During the local Fuji rehearsal, both paid receipt emails were accepted once and reached Gmail’s spam folder. Use a verified sender with aligned SPF/DKIM/DMARC, a public HTTPS console origin instead of localhost, and monitor delivery/bounce events and sender reputation. `SENT` records email-provider acceptance; it does not assert inbox placement.

API-key rollout: apply migration 0024 before the new console and daemon. Remove the old Developers endpoint from every replica before relying on one-time display. Rotate the former shared API secret if that endpoint was reachable; update SDK backends, daemon callers and MCP server configuration together, then verify old credentials fail. Keep `AUTH_SECRET`, `ENTITLEMENT_SUBJECT_SECRET`, `PROVIDER_GAS_ENCRYPTION_KEY`, `PROVIDER_SCOPE_SIGNING_KEY` and `X402_PAYMENT_ENCRYPTION_KEY` stable. New provider keys are database-backed and revoked independently; changing the deployment key does not replace the provider key lifecycle. Never store API secrets in frontend variables, embed URLs, logs or saved designs.

MCP session reuse requires `CONSOLE_URL` to identify the existing HTTPS console and `BAGSEVEN_MCP_PUBLIC_URL` to identify the HTTPS OAuth issuer. The console and MCP must use the same PostgreSQL credential store and account profiles. Console consent validates the configured issuer; the MCP callback validates the initiating browser and current wallet binding. No shared parent-domain cookies are required. On a local workstation, localhost console URLs work only on that same workstation. Production must use public HTTPS. A temporary ngrok hostname change requires reconnecting the ChatGPT app; keep one current Bagseven connection rather than accumulating duplicates.
