# Arkiv schema — Bagseven grants

Schema name: `bagseven_grants`

Access truth for Mumbai: if an entity is not returned by a live query, the agent does not have the feature.

## Columns

| Attribute | Type | Indexed | Meaning |
| --- | --- | --- | --- |
| `grant_id` | str | yes | Bagseven UUID (stable app id) |
| `feature` | str | yes | SKU key (`ocr`, `research_fetch`, …) |
| `holder` | str | yes | Subscriber identity; values over 128 UTF-8 bytes use `sha256:<hex>` |
| `human_id` | str | yes | World continuity identity; same long-value indexing rule |
| `merchant` | str | no | Issuing provider identity; same long-value indexing rule |
| `identity_data` | bytes, optional | no | JSON preserving full long holder, human, merchant and proof identities; older short-value records omit it |
| `enabled` | str | yes | `"true"` / `"false"` |
| `remaining` | dec | yes | Metered credits left |
| `renewal_enabled` | str | yes | `"true"` / `"false"` (renewal clock) |
| `paid_through` | str | no | ISO timestamp (display); Arkiv `$expiresAt` enforces eviction |
| `payment_tx` | str | yes | Whitechain explorer / settlement id |
| `settlement_network` | str | yes | `whitechain` |
| `world_proof_id` | str | no | World Agent Pass proof / session id |
| `mandate_id` | str | yes | Linked Bagseven mandate |
| `worker_id` | str | yes | Bound MCP worker |

## Ownership / expiry

- Owner: the authorized dedicated provider signer in provider-funded mode. Platform-owned legacy entities require explicit migration/reissue.
- Expiry: `ExpirationTime.fromSeconds(ttl_seconds)` at create — **medium-enforced evaporation**.
- Only the owner wallet may `patchEntity` (consume / cancel renewal).

## Judge query (example)

```ts
await publicClient
  .select({ $key: true, grant_id: true, feature: true, holder: true, remaining: true })
  .from(BagsevenGrants)
  .where(eq("feature", "ocr"))
  .fetch()
```

After TTL, the same query returns no row for that grant.

For direct equality queries on long identities, use `identityIndex(value)` from `@bagseven/entitlements`. The store restores complete values from `identity_data` and validates them against their index before holder/provider authorization. No identities are truncated; existing short-identity records remain readable.
