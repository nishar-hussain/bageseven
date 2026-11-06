# @bagseven/contracts — Bagseven mandate + vault (on-chain)

The deployable on-chain half of the hybrid mandate architecture:

- **`BagMandate.sol`** — immutable signed bounds (budget/window, lifetime cap,
  per-purchase, per-seller bps, max depth, operator). `check()` is a view used
  off-chain for the decision; `attemptAndCommit()` re-validates every bound
  on-chain and charges the vault to the payee atomically.
- **`BagVault.sol`** — holds the tree's USDC. `deposit` (anyone), `reserve`/
  `release` (enforcer = platform treasury signer), `charge` (enforcer, called by
  the mandate), `withdraw` (operator, available only).

The running services enforce the same semantics **off-chain** via
`@bagseven/mandate` (the mirror engine) until a mandate contract is deployed and
its address set on the mandate row (`mandates.contract_address`) plus the
enforcer key configured. Then settlement can move through the contract.

## Build & test

```bash
cd packages/contracts
forge build
forge test -vvv
```
