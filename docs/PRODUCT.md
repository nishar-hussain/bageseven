# Bagseven — what this product is

One sentence: **humans mint access (World + Hedera + Arkiv); agents spend only through MCP under a dual-gate.**

If the UI feels “empty,” you are looking at an **operator console**, not a consumer app. The product is the gate + the MCP tools.

## Surfaces (what to open)

| URL | Role |
| --- | --- |
| http://localhost:3001 | Marketing landing |
| http://localhost:3000/app | Operator dashboard (magic-link) |
| daemon `:4001` | Policy + entitlements API (not browsed) |
| MCP (`pnpm mcp:local`) | What Cursor / Claude / external agents attach to |

## Features that ship (and why)

1. **Magic-link auth** — any email; Resend from `bags@cesthq.com`. Session cookie for dashboard only.
2. **Overview / Attention / Tracks** — live track badges: World / Hedera / Arkiv / dual-gate.
3. **Mint** — World Agent Pass gate → write living **Arkiv** grant (`feature=ocr`, TTL, remaining credits).
4. **Credits** — Hedera settle stamp (`payment_tx` on HashScan) → extend / mint grant clock.
5. **Entitlements** — list living grants; paid_run; cancel renewal; explain denial.
6. **Mandate** — spend ceiling story (policy / BagMandate). Access clock is Arkiv, not the mandate alone.
7. **MCP** — worker-bound tools for agents: status, mint, buy_credits, paid_run, fetch, explain_denial.

## Dual-gate (the win thesis)

Every paid agent action must pass **both**:

- **Mandate** — money / spend ceiling still remaining  
- **Living grant** — Arkiv object with `remaining` and `paid_through` still in the future  

No private “/check” flag. Access is a queryable entitlement. Cancel renewal does not kill the period already paid.

## Auth: World vs MCP (this confuses everyone)

```
Human (dashboard)
  magic link → mint / buy_credits
                 └─ World verifies uniqueness (id_token live, or world:ok:* locally)
                 └─ Hedera stamps payment_tx
                 └─ Arkiv stores living grant

Agent (Cursor / Claude / ChatGPT plugin)
  MCP process with BAGSEVEN_MCP_WORKER
                 └─ NEVER holds World ID credentials
                 └─ Local: daemon Bearer; ChatGPT: World-gated OAuth → Bagseven Bearer
                 └─ Calls paid_run / bagseven_fetch
                 └─ Daemon enforces dual-gate against the human-minted grant
```

**World authenticates the human** (mint and ChatGPT authorize page).  
**MCP authenticates the agent** to your daemon.  
Those are different doors on purpose.

## Demo script (5 minutes)

1. `pnpm start:local` — wait for `tracks world=… hedera_demo=… arkiv=…`
2. Landing → Start free → email → Overview  
3. Mint → grant appears on Entitlements (Arkiv live entity if keys set)  
4. Credits → HashScan `payment_tx`  
5. MCP → Create worker → copy Cursor JSON → `pnpm mcp:local`  
6. From agent: `grant_status` → `paid_run` → credits burn; deny path via `explain_denial`

## Live tracks (already wired in `.env` when keys present)

| Track | Env | Meaning |
| --- | --- | --- |
| World | `WORLD_CLIENT_ID` (+ optional `id_token`) | Live OIDC audience; `WORLD_MOCK_PROOFS=true` allows local mint without World App |
| Hedera | account + key + facilitator URL | Operator stamp / facilitator settle → real HashScan tx |
| Arkiv | `ARKIV_ACCESS_KEY` + `ARKIV_PRIVATE_KEY` | Grants stored on Rabdi, not memory |

## What is intentionally not a “feature page”

- Charts on Overview are illustrative until usage telemetry ships  
- Mandate page is the spend-ceiling narrative; heavy on-chain mandate UX is policy/worker driven  
- Agents do not see the Fianto dashboard — they only see MCP tools  

## Win angle (judge story)

> “We don’t give agents wallets. Humans approve mint once under World. Settlement is Hedera. Access lives on Arkiv until TTL. MCP is the only spend path — and it dual-gates every call.”
