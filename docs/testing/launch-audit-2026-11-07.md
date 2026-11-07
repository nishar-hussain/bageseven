# Bagseven launch audit — 2026-11-07

## Latest main verification (27d85f0)

The provider-funded update supersedes the historical operator-wallet notes below. Deployment templates now distribute one stable provider encryption key to console, daemon and policy. `pnpm setup:prod` preserves existing keys and upgrades earlier sources; `pnpm check:prod` reports deployment requirements without printing credentials.

- Frozen dependency install, 186 tests, lint, all workspace typechecks, and full production build passed. The optional PostgreSQL provider-gas concurrency test also passed separately.
- Railway's Node 24 backend Docker image built successfully.
- Migration 0008 applied to the local database. The isolated HTTP provider regression passed all 13 checks, including owner authorization/replay protection, provider-scope enforcement, no private keys in status, denial before customer payment when provider gas is empty, and revocation without platform fallback. Test records were removed; no blockchain transactions were broadcast.
- All five core local services responded successfully. The authenticated console provider-gas BFF returned 200.
- Desktop and 375px mobile browser checks passed. Synthetic 258-character World IDs stayed within the viewport, both compact and expanded; full values remain available to copy. Connected wallet controls also fit mobile.
- Live read-only Whitechain checks confirmed chain 1874 and the configured six-decimal USDT token. World RP key matched its configured signer.

The supplied `https://bagseven-app.vercel.app` is configured as the intended console origin, including derived API and World callback URLs. It returned Vercel `DEPLOYMENT_NOT_FOUND` during verification. Production remains gated on deploying that console, supplying the landing and three backend origins, World Agent Pass client secret, and operator/executor/owner settings. Provider owner consent and native gas deposits are required before a funded customer checkout. Hosted World login, customer payment, Arkiv issuance and MCP OAuth have not been accepted against deployed Railway/Vercel URLs in this pass. Provider-funded x402 remains explicitly unavailable until its separate payer integration is supplied; it fails closed.

## Earlier verification (before provider-funded gas)

## Wallet (RainbowKit)
- Console wraps app in Wagmi + RainbowKit + React Query
- Whitechain Testnet (1874) + Mainnet (1875)
- Connect in header, Account, Onboarding, Mint (when no operator), Embed checkout (`walletSlot`)
- Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` from https://cloud.walletconnect.com for production WalletConnect

## Builder
- Seeded default components (editable + deletable)
- Custom components (create / edit / duplicate / delete)
- Restore starters if defaults wiped
- Live themed iframe preview + drop-in React/iframe code

## Tracks verified (API)
| Check | Result |
| --- | --- |
| Whitechain pay_to + operator | pass |
| Plans list | pass (13) |
| Operator mint → Arkiv | pass |
| Checkout session create | pass |
| Console login / embed pages | pass (200) |
| RainbowKit Connect wallet UI | pass (Account + header) |

## Notes
- Injected wallets (MetaMask) work without WalletConnect project id; WC modal needs a real project id.
- Operator mint settles from `WHITECHAIN_PRIVATE_KEY`; customer checkout still uses RainbowKit + USDT pay.
