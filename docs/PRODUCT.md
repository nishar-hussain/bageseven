# Bagseven — what this product is

One sentence: **humans mint entitlements (World + Whitechain + Arkiv); humans and agents both `checkEntitlement`; agents spend only under a dual-gate.**

**Entitlement (Schematic-style):** the right to use a **feature** with a limit (credits) and expiry — not the feature name itself.

Canonical catalog (`packages/entitlements/src/features.ts`):

| Feature | Meters |
| --- | --- |
| `ocr` | `paid_run` (demo) |
| `research_fetch` | `bagseven_fetch` + `paid_run` |

OCR is a **demo SKU**, not the product. The product is the SDK + the living Arkiv grant.

## Surfaces (what to open)

| URL | Role |
| --- | --- |
| http://localhost:3001 | Marketing landing |
| http://localhost:3000/app | Operator dashboard (magic-link) |
| http://localhost:3000/app/sdk | Human SDK playground + embed snippet |
| http://localhost:3000/embed?token= | Token-gated entitlement portal (iframe) |
| daemon `:4001` | Policy + entitlements API |
| MCP (`pnpm mcp:local`) | What Cursor / Claude / external agents attach to |

## SDK (the core)

```
npm install @bagseven/sdk
```

- `@bagseven/sdk/react` — `BagsevenProvider`, `useFlag`, `useEntitlement`, `useConsumeEntitlement`, `FeatureFlagGuard`, `BagsevenEmbed`
- `@bagseven/sdk/node` — `BagsevenClient.checkFlag / checkEntitlement / consumeEntitlement / identify`
- `@bagseven/sdk/agent` — same verbs for programmatic agents

React is UI gating. Authoritative checks always go through Node / daemon. Agents never hold World credentials.

## Dual-gate (the win thesis)

Every paid **agent** action must pass **both**:

- **Mandate** — money / spend ceiling still remaining
- **Living grant** — Arkiv object with `remaining` and `paid_through` still in the future

Human embed consume is grant-only (UI). Secret-key consume dual-gates.

## Auth: World vs MCP vs SDK (three doors)

```
Human (dashboard)
  magic link → mint / buy_credits
                 └─ World verifies uniqueness
                 └─ Whitechain stamps payment_tx
                 └─ Arkiv stores living grant

Human (your app)
  pk_ + embed token → useFlag / BagsevenEmbed

Agent (Cursor / Claude)
  MCP process with BAGSEVEN_MCP_WORKER
                 └─ NEVER holds World ID credentials
                 └─ check_entitlement / consume_entitlement / paid_run
                 └─ Daemon enforces dual-gate against the human-minted grant
```

## Live tracks

| Track | Env | Meaning |
| --- | --- | --- |
| World | `WORLD_CLIENT_ID` (+ optional `id_token`) | Unique human at mint |
| Whitechain | `WHITECHAIN_PRIVATE_KEY` + `WHITECHAIN_PAY_TO` | USDT / native stamp → explorer `payment_tx` |
| Arkiv | `ARKIV_ACCESS_KEY` + `ARKIV_PRIVATE_KEY` | Grants stored on Rabdi, not memory |

## Thin billing (Plans + Checkout Sessions)

Merchants define a **Plan** (feature + USDT + credits). `createCheckoutSession` opens a session; Embed/`/checkout` collects a Whitechain payment (WhiteWallet-ready); confirm mints the living grant. Same `checkEntitlement` surface.

## Intentionally not a feature

- Payment-link product line, products catalog, invoices
- Charts on Overview are illustrative until usage telemetry ships
- Agents do not see the Fianto dashboard — they only see MCP tools

## Win angle

> “We don’t give agents wallets. Humans approve mint once under World. Settlement is Whitechain. Access lives on Arkiv until TTL. Humans check via SDK. Agents consume via MCP — and paid calls dual-gate.”

Demo (daemon running): `pnpm sdk:demo` — human `checkEntitlement` → agent consume → living grant evaporates.
