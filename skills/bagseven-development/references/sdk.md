# SDK integration

## Entry points and credentials

| Import | Use |
| --- | --- |
| `@bagseven/sdk` or `@bagseven/sdk/node` | `BagsevenClient`, `BagsevenApiError`, entitlement types |
| `@bagseven/sdk/react` | Provider, guards, read/consume hooks and embedded checkout/portal |
| `@bagseven/sdk/agent` | Programmatic `BagsevenAgent` wrapper for an already-authorized server process |
| `@bagseven/sdk/wallet` | Existing Whitechain wallet/payment helpers |
| `@bagseven/sdk/components` | Supported embed component IDs/views |

Read `packages/sdk/package.json` and source for exact exports. The repository package is currently `private: true`; local workspaces can use it directly. An external consumer needs a separately published package or an agreed distribution artifact; skill publication does not publish the SDK to npm.

`BagsevenAgent` wraps check/consume; it does not replace MCP policy-controlled new payments. Do not give an external conversational agent a server secret merely to avoid connecting MCP.

## Server-side checks and consume

Use the configured daemon HTTPS base URL, or an authenticated application proxy that deliberately exposes the supported `/v1` SDK routes. The BFF prefix and the SDK's appended `/v1` route must agree; do not append `/v1` twice.

```ts
import { BagsevenClient } from '@bagseven/sdk/node';

const client = new BagsevenClient({
  apiKey: process.env.BAGSEVEN_SECRET_KEY!,
  baseUrl: process.env.BAGSEVEN_API_URL!,
});
const access = await client.checkEntitlement('ocr', { holder });
if (!access.enabled) throw new Error('OCR access is unavailable');
await client.consumeEntitlement({
  feature: 'ocr',
  holder,
  amount: '1',
  idempotencyKey: operationId,
});
```

The consume endpoint remains authoritative if state changes between the read and write. Derive `holder` from authenticated application identity, not arbitrary client input. Keep `operationId` stable for a retry. This uses prepaid credits and does not request a new payment.

Useful result fields: `enabled`, `remaining`, `allocation`, `paid_through`, `grant_id`, optional `arkiv_entity_key`, `payment_tx`, `renewal_enabled`, `value_type`. Numeric and boolean features use the same access concept; do not treat strings such as `'0'` as truthy permission.

## React and embedded flows

```tsx
import { BagsevenProvider, FeatureFlagGuard } from '@bagseven/sdk/react';

<BagsevenProvider publishableKey={publishableKey} apiUrl={publicApiUrl} holder={holder}>
  <FeatureFlagGuard feature="ocr">
    <OcrButton />
  </FeatureFlagGuard>
</BagsevenProvider>
```

A publishable key does not authorize consume or mint. UI visibility does not authorize the protected backend operation. For embedded holder-scoped access, issue a short-lived token on your server with `client.identify({ holder })`, then pass that token to the supported embed/provider component. Never expose the secret key in `NEXT_PUBLIC_*`, React props or an embed URL.

## Plans and payment

Create a plan using the provider's actual merchant wallet and separate payment `amount` from feature `credits`. Then call `createCheckoutSession({ plan_id, holder })`. Render the existing hosted `/checkout?session=...` or `BagsevenEmbed` checkout. A created session is pending; payment verification must precede grant minting. Do not call demo settlement in production.

Checkout pays the plan merchant wallet; legacy `WHITECHAIN_PAY_TO` does not replace provider routing. Platform fees are recorded separately. World consent and wallet signatures remain human actions.
