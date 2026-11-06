# Bagseven launch audit — 2026-11-07

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
