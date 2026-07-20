# Archived Hardhat tests (pre–Base settlement)

Retired suites kept for historical reference / later deletion. **Not run by default CI.**

Money + proof home = Base (USDC/x402, `ZKVerifierSP1`). Theta = optional GPU provider only. Believer/Angel, CoreRevenueSplitter fee path, Cosmos yield, and VaultFactory/ZKBridge settlement identity are out of the go-forward narrative.

## Exclusion

| Runner | Behavior |
|--------|----------|
| `npm run test:contracts` / `test:contracts:all` | `scripts/hardhat-test-all.cjs` skips `_archive/` |
| `npm run test:contracts:core` | `scripts/hardhat-test-core.cjs` only `phase3` + `security` (active) + `core-layer/test` |
| `npx hardhat test` | Hardhat `TASK_TEST_GET_TEST_FILES` filter drops `/_archive/` |
| `npm run test:coverage` | `test/coverage-runner.js` lists go-forward files only |

To run an archived suite explicitly:

```bash
npx hardhat test test/_archive/phase3/CoreRevenueSplitter.test.cjs
```

Believer/Angel round tests live under `docs/_archive/legacy-believer/test/` (`npm run test:believer`).

## Inventory (why archived)

| Path | Reason |
|------|--------|
| `Ownable`, `RevSplitterHybridV2`, `VaultFactory*`, `ZKBridge*` | Contracts under `contracts/legacy/` |
| `ai-depin/` | Cosmos/Osmosis/Persistence + legacy RevenueSplitter |
| `core/`, `phase3/CoreRevenueSplitter*`, `security/Splitter*` | Retired CoreRevenueSplitter fee / GET / boost path |
| `phase3/E2E.governance` | Fee-to-stake via splitter (not Base USDC ADR 0001) |
| `phase4/x402Escrow`, `TVLSimulation` | Splitter escrow / TVL projections |
| `phase4/SubchainDeploy`, `phase1/HyperlaneE2E` | Theta-settlement identity |
| `phase5/CrossChainExpansion`, `phase6/` | Phase fluff / Cosmos routes / marketing |
| `track2/DynamicBoost`, `track4/TDROP` | Splitter boost + TDROP payment rail |
| `integration/`, `hardening/` | Multi-circuit fee accounting via splitter |
| `tokenomics/` | Dead `backend/theta-bridge` fee-analytics import |
