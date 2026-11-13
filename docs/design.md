# Bagseven design system

Two **separate** surfaces — do not mash them into one chrome.

| Surface | URL | Feel |
| --- | --- | --- |
| **Landing** | http://localhost:3001 | Cobalt, serif-led editorial marketing site |
| **Dashboard** | http://localhost:3000 | Provider workspace with cobalt accents and ivory surfaces |

## Shared product palette

```css
--blue: #112d94;
--blue-d: #0a1f72;
--hero: #0c0a0b;
--ink: #1d2433;
--ink2: #414b61;
--gray: #667086;
--faint: #707b91;
--soft: #f4f5f9;      /* landing soft bands + dashboard page bg */
--dash-bg: #f5f4f0;   /* ivory workspace canvas */
--line: #e1e3e9;
--good: #1a7a45;
--warn: #a8480f;
--warn-t: #fff1e4;
--paper: #ffffff;
--r-s: 10px;
--r-m: 16px;
--r-l: 28px;
--text: Switzer, system-ui, sans-serif;
--brand: "Space Grotesk", Switzer, system-ui, sans-serif;
--mono: "Chivo Mono", ui-monospace, monospace;
```

## Landing rhythm

The landing page follows the supplied Alpine editorial reference: a full-bleed cobalt hero, oversized Georgia serif typography, fine horizontal rules, a centered translucent navigation plaque and photographic mountain imagery. The original Bagseven bag mark stays in the wordmark. Do not apply this marketing chrome to the console.

Landing-specific tokens are scoped in `apps/landing/components/home/landing.module.css`: cobalt `#112d94`, deep blue `#0a1f72`, warm paper `#f4f2eb`, charcoal ink `#1d2433`. Use Georgia for display headings, Arial/Helvetica for readable body copy, and Chivo Mono with a local monospace fallback for section labels. Square edges and fine borders define the composition; avoid pill-heavy card grids and decorative gradients.

1. Cobalt landscape hero: access proposition, original brand and working app CTA.
2. Warm paper product explanation: what payments unlock and three product principles.
3. Cobalt product walkthrough: selectable plan, sample payment confirmation, visible credit use and sample cancellation that preserves paid access. Label the simulation explicitly; no real payment or credit consumption occurs.
4. Warm paper journey: define features, connect checkout, use entitlements.
5. Deep navy agent section: prepaid access and new spending are separate permissions.
6. Warm paper developer section: real workspace SDK example, copy action and documentation links.
7. Native accessible FAQ disclosures.
8. Cobalt closing statement and functional footer navigation.

All marketing routes link to the existing console or documentation. The illustration is not a live checkout: preview actions lead to the app, and example balances are labeled. Customer secrets never appear in marketing code. Reduced-motion preferences, keyboard focus, narrow layouts and readable image overlays must be preserved.

Hero image: `apps/landing/public/images/access-landscape.webp`, generated with the built-in image tool. Art direction: a photographic Alpine stone path and gateway, small moon and a large uninterrupted cobalt sky; no baked-in text or interface. All typography and layout are real HTML/CSS.

## Dashboard rhythm

Sign-in uses email → code confirmation → wallet ownership, with a wallet connection control available while retrieving the email code. Saved account binding and browser connection are different UI states. Show Reconnect wallet after disconnect, Ownership verified for a matching bound wallet, and a distinct mismatch panel for another wallet. Do not present ordinary verification as an implicit wallet replacement. The replacement panel explains its target, confirms the existing inbox with a code and requests an explicit new ownership signature.

Wallet approval state is shared across console and embedded billing. Show one readable status panel, prevent competing approval actions, and never queue or silently retry financial requests. A pending request inside the wallet requires a human to review or dismiss it; acknowledging the reminder changes only application UI state. On a live registry, put separate-registry deployment behind an advanced disclosure rather than suggesting every provider must deploy again.

Wallet controls use the shared wallet.module.css address/network buttons and the supported RainbowKit theme in components/wallet/theme.ts. Keep account addresses visible, avoid novelty avatars, and use explicit user clicks for network changes. Account ownership is hydrated from the authenticated profile; never prompt for a new signature just because a page reloads. Connection, ownership verification and payment approval remain distinct actions.

Transactional email uses packages/notify/src/email.ts: ivory background, original serif wordmark, white content panel, cobalt rule and action, readable fallback fonts and a plain-text alternative. Verification codes have a dedicated six-digit block and no unrelated dashboard button. Use inline email-safe styles and table layout; escape all dynamic copy, labels and metadata. MCP consent follows the same visual system and surfaces server verification errors in an accessible alert.

The public network strip is absent from dashboard chrome. Network details belong in Network & gas and transaction review. Customers uses a searchable relationship directory with first-payment and recurring-permission states. Invoices uses provider/purchases tabs, status filters and restrained tables; individual documents use a white print-ready page with issuer, billed account, original terms and payment evidence. Hide workspace chrome and document controls when printing. Disabled receipts must remain unavailable until verified payment.

Builder uses a compact page toolbar, two clear steps (Design your embed / Add to your app), and a dedicated inspector beside a large live canvas. Content and Appearance have separate tabs. Desktop/mobile previews render the actual unified SDK component. Keep installation instructions in the install step, show provider-scoped saving/publication state, and do not mix customer tokens into the editor or copied iframe URLs. The primary accent remains Bagseven blue; preview styling belongs to the provider's design.

- Ivory canvas (`#f5f4f0`), warm white sidebar and white working surfaces.
- Original bag logo and serif wordmark; restrained Georgia page titles and compact sans-serif controls.
- Cobalt selected navigation, primary actions and feature balances. Green is reserved for semantic success states, never a large decorative section.
- Sidebar around 238px with grouped Catalog, Agents & integration and Workspace navigation. Mobile uses a dismissible drawer with Escape handling, focus wrapping and scroll locking.
- Header shows the current page, documentation, entitlement creation and account access. Do not display a disabled search field as if it were a working feature.
- Provider overview shows provider-scoped checkout cohorts, unique paying checkout holders, current subscription permission status, active catalog plans, subscription issues, recent checkout sessions and per-plan checkout counts. Keep holder credits in entitlement management rather than making them the provider’s headline metric. Never add distinct feature units, invent revenue or growth, or label an expiry projection as historical usage.
- Overview activity uses 7/30/90 UTC-day cohorts based on checkout creation time. The paid series means current PAID status for that cohort, not payment-time revenue or recurring collections. Date filters do not alter the clearly labeled current subscription/catalog metrics. Checkouts has a working provider-scoped, server-paginated destination.
- Landing has no outer border, gutter or inset frame. Motion is restrained: viewport reveals and reading progress respect reduced-motion preferences. The product walkthrough must support keyboard input and never imply that simulated wallet actions send transactions.
- Shared page headers, cards and buttons live in `components/app/ui.tsx` and `dashboard.module.css`; provider-configured embed themes remain independent.
- Sign-in and onboarding use a navy editorial panel alongside a focused form. Explain email verification, wallet ownership and payment approvals separately. The original sign-in tab observes the same-origin session, and authenticated login reloads return to the intended app page.

## Anti-patterns

- Dark marketing header inside the dashboard  
- Flat gray shadcn “admin” look without blue wordmark / rounded cards  
- Running inspector `:3010` or folding landing into `/app`
