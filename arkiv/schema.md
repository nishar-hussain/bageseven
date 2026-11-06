# Arkiv schema — Bagseven grants

Schema name: `bagseven_grants`

Access truth for Mumbai: if an entity is not returned by a live query, the agent does not have the feature.

## Columns

| Attribute | Type | Indexed | Meaning |
| --- | --- | --- | --- |
| `grant_id` | str | yes | Bagseven UUID (stable app id) |
| `feature` | str | yes | SKU key (`ocr`, `research_fetch`, …) |
| `holder` | str | yes | Subscriber wallet / holder id |
| `human_id` | str | yes | World continuity / nullifier-ish id (optional empty) |
| `merchant` | str | no | Merchant wallet |
| `enabled` | str | yes | `"true"` / `"false"` |
| `remaining` | dec | yes | Metered credits left |
| `renewal_enabled` | str | yes | `"true"` / `"false"` (renewal clock) |
| `paid_through` | str | no | ISO timestamp (display); Arkiv `$expiresAt` enforces eviction |
| `payment_tx` | str | yes | Hedera HashScan / settlement id |
| `settlement_network` | str | yes | `hedera` |
| `world_proof_id` | str | no | World Agent Pass proof / session id |
| `mandate_id` | str | yes | Linked Bagseven mandate |
| `worker_id` | str | yes | Bound MCP worker |

## Ownership / expiry

- Owner: Arkiv wallet that mints (`ARKIV_PRIVATE_KEY`).
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
