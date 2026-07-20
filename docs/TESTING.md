# Testing

XFuel has 755+ tests across contracts, gateway, multi-prover listener, and the zkLLM prover.

## Quick start

```
npx hardhat compile
npx hardhat test
```

## npm scripts

```
npm run test:contracts:core          # listener + core Hardhat
npm run test:contracts:core:solidity # Hardhat only
npm run test:contracts:all           # full matrix (Windows-safe)
```

zkLLM:

```
cd services/zkllm-prover && cargo test
```

Gateway unit tests (from `services/gateway`):

```
node --test test/*.test.mjs
```

## Suites (summary)

| Area | How to run |
|------|------------|
| Core Solidity | `npx hardhat test core-layer/test/*.cjs` |
| Core listener | `cd core-layer && node --test test/ai-listener.test.js` |
| Circuits | under `packages/circuit-runtime/*/test/` |
| Phase / security | `test/phase3`, `test/phase4`, `test/security`, … |
| Solana prover | `cd solana-prover && cargo test` |
| CosmWasm verifier | `cd core-layer/wasm/zk-verifier && cargo test` |

CI: `.github/workflows/test.yml` (contracts + zkLLM).

## Notes

- Never run Hardhat fixtures against live Theta RPC (`evm_snapshot` unsupported).
- Prefer Hardhat local (chain 1337) for Solidity tests.
- Gas targets: [Technical-Specifications.md](./Technical-Specifications.md).
