# Arkiv friction log — Bagseven Mumbai

Build-track notes for judges. What slowed us down and how we worked around it.

## Friction

1. **Offline / CI without credentials**  
   Rabdi + wallet writes need `ARKIV_ACCESS_KEY` and a funded private key. Unit tests must not depend on live RPC.  
   **Mitigation:** `MemoryGrantStore` remains the default when `ARKIV_ACCESS_KEY` is unset; `ArkivGrantStore` is selected only when credentials exist (`createGrantStore()`).

2. **App UUID vs entity key**  
   Our product id is a UUID (`grant_id`); Arkiv’s native id is `$key` (bytes32).  
   **Mitigation:** Index `grant_id` as `str` and resolve with `select().where(eq("grant_id", id))`. Keep an in-process `grant_id → entityKey` cache after create.

3. **Holds / concurrent consume**  
   Arkiv patches are owner-signed; there is no first-class “hold” primitive in the SDK surface we used.  
   **Mitigation:** Optimistic `remaining` decrement via `patchEntity`, plus process-local hold maps for commit/release semantics in the daemon. Document that multi-replica race needs a stronger lease later.

4. **`paid_through` vs `$expiresAt`**  
   Product clock is wall-time ISO; Arkiv eviction is block/`ExpirationTime`.  
   **Mitigation:** Write both — set `ExpirationTime.fromSeconds(ttl)` at create, store `paid_through` for Inspector countdown and dual-gate checks.

5. **Boolean columns**  
   SDK bool exists, but cross-language demos often stringify.  
   **Mitigation:** Store `enabled` / `renewal_enabled` as `"true"` / `"false"` strings for simple SQL-style demos.

## What worked well

- Schema-first `defineSchema` + typed `createEntity` / `patchEntity` matched our entitlement mental model.
- Medium-enforced TTL made the “tools die live” demo possible without a private `/check` API.
- Indexing `feature`, `holder`, `worker_id`, `remaining` made judge queries one-liners.

## Criterion mapping (Build track)

| Criterion | Where |
| --- | --- |
| Real write + read | `packages/entitlements/src/arkiv-store.ts` |
| Schema documented | `arkiv/schema.md` |
| Friction documented | this file |
| Judge-runnable query | `arkiv/schema.md` + Inspector “live grants” |
