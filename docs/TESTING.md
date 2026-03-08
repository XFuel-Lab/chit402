# XFuel Protocol — Testing Guide

> Complete testing reference for the 755+ test suite covering unit, integration, system, hardening, vesting, governance, multi-prover, and phase expansion scenarios.

**Back to:** [README.md](../README.md)

---

## Quick Start

```bash
# Compile and run everything
npx hardhat compile
npx hardhat test
```

---

## Test Suite Summary

| Category | Tests | Description |
|----------|-------|-------------|
| Circuit unit tests (×16) | ~235 | 14–15 tests per circuit |
| BelieverRound vesting | 16 | Commitment, TGE, vesting, refund |
| Multi-circuit integration | 20 | E2E cross-circuit flows |
| Gas profiling (system) | 10 | Measurable gas budgets |
| Deployment validation (system) | 10 | Full-stack deploy checks |
| Load/chaos hardening | 20 | 500+ concurrent ops stress |
| Core Layer (Solidity) | ~10 | ZKVerifierSP1, SP1ProofHooks |
| Core Layer (JS) | ~5 | ai-listener unit tests |
| Priority Circuits | 69 | ComputeMarketplace, InferenceRouter, BridgeCircuit |
| Core Layer (JS multi-prover) | 85 | EVM/Cosmos/Solana polling, normalization, routing |
| Solana Prover (Rust) | 35 | BN254 verification, PDAs, serialization |
| CosmWasm Verifier (Rust) | 16 | arkworks pairing, circuit registry, IBC events |
| Phase 3 Governance | 54 | veXF lock/vote/execute, Fee-to-Stake, E2E flows |
| Phase 4 Scale | 71 | Rollup, x402, TVL sims, subchains |
| Phase 5 Multi-Network AI | 48 | Agent swarms, privacy markets, cross-chain |
| Phase 6 Ecosystem | 55 | Partners, caching, oracles, website |
| **Total** | **755+** | |

---

## Running Individual Suites

### Circuit Unit Tests (15 each)

```bash
npx hardhat test circuits/tao-evm/test/TAOCircuit.test.cjs
npx hardhat test circuits/a2a/test/A2ACircuit.test.cjs
npx hardhat test circuits/theta-gpu/test/ThetaGPUCircuit.test.cjs
npx hardhat test circuits/zkml/test/ZKMLCircuit.test.cjs
npx hardhat test circuits/akash/test/AkashCircuit.test.cjs
npx hardhat test circuits/autonomous-vaults/test/AutonomousVaults.test.cjs
npx hardhat test circuits/agent-robotics/test/AgentRobotics.test.cjs
npx hardhat test circuits/data-hubs/test/DataHubs.test.cjs
npx hardhat test circuits/yield-optimization/test/YieldCircuit.test.cjs
npx hardhat test circuits/near-agents/test/NearAgents.test.cjs
npx hardhat test circuits/solana-ai-bridge/test/SolanaAIBridge.test.cjs
npx hardhat test circuits/filecoin-storage/test/FilecoinStorage.test.cjs
npx hardhat test circuits/energy-grid/test/EnergyGrid.test.cjs
npx hardhat test circuits/mapping-sensor/test/MappingSensor.test.cjs
npx hardhat test circuits/wireless-depin/test/WirelessDePIN.test.cjs
npx hardhat test circuits/uplink/test/UplinkCircuit.test.cjs
```

### Multi-Circuit Integration (20 E2E)

```bash
npx hardhat test test/integration/MultiCircuit.integration.test.cjs
```

| # | Category | Tests | Description |
|---|----------|-------|-------------|
| 1-2 | Deployment verification | 2 | All circuits deploy with unique IDs; shared CoreRevenueSplitter |
| 3-5 | Fee aggregation | 3 | TAO+A2A, GPU+zkML+Akash, Vaults+Robotics fees reach splitter |
| 6-8 | Circuit isolation | 3 | State independence: task counts, agent counts, strategy counts |
| 9 | Nullifier independence | 1 | Same nullifier valid across different circuits |
| 10-13 | Cross-circuit pipelines | 4 | TAO→GPU, A2A→bid→GPU, Vault lifecycle, Robotics lifecycle |
| 14-15 | Concurrent stress | 2 | 5 users × 3 circuits; 10 deposits × 2 vaults |
| 16-17 | Pause isolation | 2 | Pausing one circuit does not affect others |
| 18 | Global accounting | 1 | Splitter balance = sum of all circuit fees |
| 19-20 | Access control isolation | 2 | Roles on one circuit don't grant access to others |

### System Tests (20)

```bash
npx hardhat test test/optimizations/GasProfile.system.test.cjs    # Gas profiling (10)
npx hardhat test test/optimizations/Deploy.system.test.cjs        # Deployment (10)
```

### Load/Chaos Hardening (20)

```bash
npx hardhat test test/hardening/LoadChaos.hardening.test.cjs
```

| # | Category | Tests | Description |
|---|----------|-------|-------------|
| 01-02 | TAO high-volume | 2 | 50 tasks rapid-fire; gas stability across 10 settlements |
| 03-04 | Yield load | 2 | 30 parallel positions; 20 rebalances with unique nullifiers |
| 05-06 | NEAR Agents load | 2 | 20 agents parallel; 15 intents submitted + cancelled |
| 07 | Solana pipeline | 1 | 20 tasks through full submit→bridge→settle pipeline |
| 08-09 | Cross-circuit concurrent | 2 | 10 ops each on TAO+Yield+NEAR; multi-circuit fee aggregation |
| 10-12 | Chaos: pause/unpause | 3 | Mid-stream pause blocks; unpause resumes; isolation verified |
| 13-14 | Nullifier collision | 2 | 100 unique nullifiers; duplicate rejection at scale |
| 15-16 | Fee accounting | 2 | 20-op fee totals match; 25 DataHubs contributions validated |
| 17-18 | Gas stability | 2 | TAO settleTask <100K; Solana settleTask <400K |
| 19-20 | Full stress pipeline | 2 | 5 users × 5 circuits × 2 ops = 50 ops; splitter consistency |

### BelieverRound Tests (16)

```bash
npx hardhat test believer/test/BelieverRound.test.cjs
```

### Core Layer Tests

```bash
npx hardhat test core-layer/test/ZKVerifierSP1.test.cjs
npx hardhat test core-layer/test/SP1ProofHooks.test.cjs
cd core-layer && npm test   # JS listener tests
```

---

## Unit Test Coverage Matrix

| Category | TAO | A2A | GPU | zkML | Akash | Vaults | Robotics | DataHubs | Yield | NEAR | Solana |
|----------|-----|-----|-----|------|-------|--------|----------|----------|-------|------|--------|
| Deployment/Identity | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 | 1 | 2 | 2 |
| Core Lifecycle | 4 | 4 | 6 | 4 | 3 | 4 | 4 | 5 | 5 | 4 | 3 |
| Settlement/Proof | 3 | 2 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 |
| Fee Math | 2 | 1 | 1 | 2 | 1 | 2 | 1 | 2 | 2 | 1 | 1 |
| Edge Cases | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Stress/Multi-user | 2 | 4 | 2 | 1 | 3 | 1 | 2 | 2 | 2 | 2 | 2 |
| **Total** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **14** |

---

## Gas Profiling

Key gas targets and measured results (Hardhat, optimizer 200 runs, viaIR):

| Operation | Circuit | Gas Target | Measured | Status |
|-----------|---------|-----------|----------|--------|
| `settleTask` | TAO | <100K | ~68K | Pass |
| `rebalance` | Vaults | <350K | ~292K | Pass |
| `rebalancePosition` | Yield | <300K | ~226K | Pass |
| `submitTask` | TAO | <350K | ~303K | Pass |
| `deposit` | Vaults | <350K | ~296K | Pass |
| `openPosition` | Yield | <350K | ~318K | Pass |
| `purchaseAccess` | DataHubs | <300K | ~297K | Pass |
| `settleTask` | Solana | <400K | ~327K | Pass |
| `bridgeTask` | Solana | <150K | ~128K | Pass |
| Deploy any circuit | All 16 | <3M | 2.1M–2.9M | Pass |

```bash
# Run gas profiling suite
npx hardhat test test/optimizations/GasProfile.system.test.cjs

# Method-level breakdown
REPORT_GAS=true npx hardhat test

# Gas optimizer script
npx hardhat run polish/gas-opts.cjs
```

**Optimization techniques:**
- Storage packing: `uint64` timestamps, `uint16` fee BPS, `bytes32` IDs
- Minimal storage writes on critical paths
- Single `call` to `revenueSplitter.depositFee()` with fallback
- Solidity optimizer at 200 runs with IR pipeline enabled

---

## Writing Tests for Custom Circuits

Tests follow a common pattern:

1. Deploy `CoreRevenueSplitter` as a shared fee sink
2. Deploy the circuit with `zkVerifier = address(0)` (mock mode)
3. Grant roles (CIRCUIT_ROLE, RELAYER_ROLE, etc.)
4. Test each lifecycle stage

See any existing test file (e.g., `circuits/tao-evm/test/TAOCircuit.test.cjs`) as a template.
