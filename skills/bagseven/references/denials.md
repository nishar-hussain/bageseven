# Denials and recovery

Use returned codes and `explain_denial`; do not assume every failure needs money.

| Observation | Next step |
| --- | --- |
| `entitlements_only` | Prepaid `paid_run` remains available. Only new payments need a registered policy agent |
| Expired, disabled or exhausted grant | Explain missing access; discover an appropriate checkout if the user wants to buy access |
| Holder/worker mismatch | Use the authorized holder/worker. Catalog visibility is not write authority |
| No plan matches | Return available features/plans; do not create an unpaid grant |
| Insufficient mandate capacity | Explain which cap/balance applies; owner approval is needed to change permission or funding |
| Revoked/unknown/unavailable onchain mandate | Stop new payments until the actual chain/contract is verified; do not treat unavailable reads as a zero-cost allow |
| Payment result pending/uncertain | Retain the original operation/key; inspect/reconcile before any repeat attempt |
| Duplicate idempotency key with different inputs | Restore the original inputs or use a new key only for genuinely new authorized work |
| OAuth 401 | Reconnect/authorize the Bagseven MCP session; World credentials stay with the human |
| Unknown MCP session after restart | Re-initialize, then reauthorize if tokens were lost |
| World consent pending/denied | Return the actual human consent step; do not paste or synthesize proofs |

Whitechain `payment_tx` proves a verified payment, `renewal_enabled=false` means no future renewal, and Arkiv `remaining` plus `paid_through` determine current access. Cancellation alone does not revoke paid access. A credit consumption does not imply a new transfer.
