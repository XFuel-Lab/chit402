# Archived scripts (legacy)

Moved off the active `scripts/` surface during the Base-home / legacy sweep.

**Do not use for go-forward ops.** Settlement home is Base (USDC/x402); Theta is optional GPU provider only; Believer/Angel and CoreRevenueSplitter fee paths are retired.

## What lives here

| Cluster | Examples | Why archived |
|---------|----------|--------------|
| Theta vault / swap / fee splitter | `deploy-vault-factory.cjs`, `test-live.cjs`, `test-deposit.cjs`, `complete-upgrade.cjs`, `upgrade-*.cjs`, `remove-beta-limits.cjs` | TFUEL VaultFactory + RevenueSplitter era |
| Theta mainnet/testnet deploy packages | `deploy.cjs`, `deploy-mainnet-*`, `deploy-testnet-security.*`, `testnet-deploy-security.ts`, `emergency-pause.ts` | Theta settlement / router / multi-sig beta deploy |
| Rebalance / LST | `deploy-rebalancer.ts`, `monitor-rebalance.ts` | Auto-rebalance yield path |
| Cosmos / Persistence | `build-cosmwasm-contracts.sh`, `test-cosmwasm.sh`, `dev/check-tx-status.sh`, `dev/import-deployer-key.sh` | CosmWasm + Persistence LST tooling |
| Theta EdgeCloud MCP / subchain | `register-mcp-tool.cjs`, `theta-mcp-tool-descriptor.json`, `theta-subchain-init.cjs` | Pre–Base-home Theta integration experiments |
| Tokenomics sims / fluff docs | `tokenomics-simulator*.py`, `ARCHITECTURE.md`, `QUICK_REFERENCE.md`, `SUMMARY.md`, `TESTNET_DEPLOYMENT_GUIDE.md`, `README-TESTNET-SECURITY.md` | Phase / testnet-security packaging |
| Near-duplicates | `validate-skills.mjs` | Superseded by CI-used `scripts/validate-skills.cjs` (wrong `skills/` root) |
| Old Cypress runner | `dev/run-e2e-tests.ps1` | Points at retired suite; use `cypress/_archive` + `npm run test:e2e:legacy` |

## Active scripts (kept at `scripts/`)

CI / package.json / Base ops: `hardhat-test-all.cjs`, `hardhat-test-core.cjs`, `gas-snapshot.cjs`, `verify-deployment.cjs`, `validate-skills.cjs`, `patch-solcover.cjs`, `slither-count-high-core.py`, `parse-slither.py`, `build-sp1-prover.sh`, `compare-benchmarks.cjs`, `verify-rpc.cjs`, `hyperlane-init.cjs`, `dev/find-positioning.cjs`, `dev/find-stale.cjs`, plus local web helpers under `scripts/dev/`.

To run an archived script deliberately:

```bash
node scripts/_archive/<name>.cjs
# or
npx hardhat run scripts/_archive/<name>.cjs --network <network>
```
