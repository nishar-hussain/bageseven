# Provider-funded gas verification — 2026-11-07

## Implemented behavior

Providers authorize an encrypted dedicated EOA with separate native-fee budgets and per-transaction ceilings for Whitechain and Arkiv, expiring within 30 days. Signing checks chain, zero native value, permitted targets/methods, expiry, and revocation. PostgreSQL atomically reserves maximum fees before a signature is produced. Provider-funded mode is the default; production cannot opt into platform-funded mode.

Entitlement writes resolve the grant's issuing provider. Existing entity ownership must match its provider signer before a paid update. New mandates bind their provider and use that provider account as enforcer. Customer purchase payments remain wallet-approved transfers to each plan's merchant wallet. The existing separate 0.1% provider fee accrual is unchanged.

The console derives provider identity from the signed-in session and signs a short-lived service scope. The service bearer alone cannot forge another provider's gas-account scope. Owner signatures are required for authorization and recovery; recovery is restricted to the recorded owner after revocation. No delegated key is returned to the browser.

## Verification results

- Onchain unit tests: 7 passed, covering provider signatures, native-transfer/call restrictions, deployment owner/enforcer checks, fee budgets, expiry, revocation, owner recovery, and authorization replay.
- Optional real PostgreSQL integration: 1 passed. Three concurrent signatures with a two-transaction budget allowed exactly two. Test data was removed.
- Entitlement tests: 8 passed, including provider-specific signer routing and refusal of unbound legacy writes.
- Daemon tests: 75 passed; policy tests: 20 passed; console tests: 33 passed; shared server tests: 3 passed. Total: 147.
- Local HTTP regression: 13 checks passed using an isolated, unfunded provider. It covered signed scope, invalid owner signatures, replay, account visibility, checkout blocking before customer payment, revocation, and gateway forwarding without platform deployment fallback. All test rows were removed.
- Console production build passed with webpack. Relevant backend builds, landing build, typechecks, lint, and frozen/offline lockfile validation passed.
- Database migration 0008 applied locally. Daemon, policy, and gateway health endpoints returned 200. The provider-gas BFF returned 401 without sign-in.
- The provider-gas guide, introduction, and icon returned 200 after a production build. Landing development output now uses `.next-dev` so builds cannot overwrite its running development chunks.

## Limits and activation

No blockchain transaction was broadcast by these tests. A funded, human-approved wallet cycle still requires the provider's authorization and deposits on each network. No provider deposits or approvals were fabricated.

These are server-enforced EOA limits, not on-chain smart-account restrictions. Encrypted keys remain server-held. Back up the deployment encryption key and use the same value on console, daemon, and policy. Fee reservations are conservative maximum bounds and are not automatically refunded after uncertain submissions. Nonce coordination is process-local; this is not a distributed signing queue. Previously signed transactions can settle after revocation.

Legacy platform-owned Arkiv grants require explicit migration or reissuance; old mandates without provider binding cannot fall back to a platform-funded executor. Provider-funded x402 currently fails closed pending separate payer authorization. Automated collection of the provider's platform-fee liability is not implemented here. This work is not an independent multi-tenant custody/security audit.

Activation: open `/app/settings`, find **Provider-funded gas**, connect the provider owner wallet, sign the reviewed limits, fund the dedicated address with WBT and tGLM on their respective networks, and refresh after confirmation.

Repeat the no-broadcast HTTP regression with:

```bash
node --env-file=.env scripts/test-provider-gas.mjs
```
