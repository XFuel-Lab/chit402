# Governance Mocks — Osmosis AIVerifier Deploy Demos

> **Purpose**: MOCK_MODE governance testing for Osmosis AIVerifier deployment.
> No Persistence chain involvement — Osmosis-native only.
>
> **Reference**: Whitepaper v5.1 Sections 11.2, 11.3

## Contents

| File | Description |
|------|-------------|
| `mock-ai-verifier-deploy.js` | MOCK_MODE AIVerifier deployment demo (no live ZK proving) |
| `forum-proposal-template.js` | Osmosis governance forum proposal generator |
| `governance-vote-sim.js` | veXF governance vote simulation (quorum, thresholds) |
| `osmosis-testnet-yield.js` | Osmosis testnet yield benchmark integration |

## Usage

```bash
# Deploy AIVerifier in MOCK_MODE on Osmosis testnet
node governance-mocks/mock-ai-verifier-deploy.js --network osmo-test-5

# Generate forum proposal markdown
node governance-mocks/forum-proposal-template.js --output proposal.md

# Simulate governance vote (veXF quorum)
node governance-mocks/governance-vote-sim.js --quorum 20 --threshold 67

# Run Osmosis testnet yield benchmarks
node governance-mocks/osmosis-testnet-yield.js --pool-id 1 --duration 7d
```

## MOCK_MODE

All scripts support `MOCK_MODE=true` (default) for demonstration without live
chain interaction. Set `MOCK_MODE=false` and configure RPC endpoints for
testnet deployment.

## Integration with E2E Tests

```powershell
# Run governance mocks as part of v5.1 test suite
.\run-e2e-tests.ps1 -Suite governance
```
