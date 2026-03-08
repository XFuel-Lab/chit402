# XFuel Protocol — Technical Specifications

*Companion document to [WHITEPAPER.md](../WHITEPAPER.md) — contains full verifier architectures, gas benchmarks, prover matrices, and implementation details.*

---

## 1. EVM Verifier (ZKVerifierSP1.sol)

The Solidity verifier wraps the SP1 Verifier Gateway deployed on EVM chains. It includes:

- SP1 Verifier Gateway (ISP1Verifier) with verifyProof and verifyProofWithHash
- Circuit Registry with registerCircuit/removeCircuit and circuitCount tracking
- Nullifier Tracking via usedNullifiers mapping (bytes32 → bool) for replay prevention
- Batch Verification: verifyProofBatch up to 20 proofs per tx, ProofVerified/ProofFailed events
- Circuit Breaker: per-item failure rate monitoring (1-hour window), auto-pause at >5% failure rate over 100+ verifications
- SP1-CC Composed Call Verification: verifyComposedCall binding proofs to historical EVM state, ~500K total gas
- Hyperlane Cross-Chain Proof Relay: relayProofCrossChain with handle() receiver, ~400K gas
- dTAO Stake-Gated Verification: verifyWithStakeCheck querying Bittensor precompile at 0x805, ~143K gas
- SP1 Recursive Rollup Layer (Phase 4): settleRollupBatch up to 100 inner proofs, verifyRecursiveProof depth 1-8, <100K amortized gas per proof for batch ≥10

Gas Summary (Mock Mode — gateway adds ~270K for Groth16):
- verifyProof: ~108K wrapper
- verifyComposedCall: ~220K wrapper (4 SSTORE for struct)
- verifyWithStakeCheck: ~143K wrapper (with precompile query)
- relayProofCrossChain: ~400K total (verify + dispatch)
- verifyProofBatch: ~176K / 3 proofs (~59K each)
- settleRollupBatch: <100K amortized per proof (10+ batch)
- verifyRecursiveProof: ~50K wrapper overhead
- Mock Mode: gateway == address(0) → skip ZK verification

**Supported EVM Chains:**

| Chain | Chain ID | Gas Token | Notes |
|-------|----------|-----------|-------|
| Theta Mainnet | 361 | TFUEL | Primary deployment, 4000 Gwei min gas |
| Theta Testnet | 365 | TFUEL | Testing environment |
| Bittensor EVM | 964 | TAO | dTAO staking, SP1-CC, Hyperlane bridging |
| Hardhat Local | 1337 | ETH | Development |

---

## 2. CosmWasm Verifier (xfuel-zk-verifier)

The CosmWasm verifier performs full BN254 Groth16 pairing checks using the arkworks library suite compiled to wasm32-unknown-unknown:

- ark-bn254 for BN254 curve operations (G1, G2, pairing)
- ark-groth16 for Groth16 proof verification (verify_with_processed_vk)
- ark-serialize for canonical deserialization

Verification flow:
1. Deserialize proof_bytes into Proof\<Bn254\> (A ∈ G1, B ∈ G2, C ∈ G1)
2. Load VerifyingKey from stored CIRCUIT_VKEYS
3. Parse public_values as BN254 scalar field elements (Fr)
4. Compute PreparedVerifyingKey and execute pairing check: e(A, B) == e(α, β) · e(vk_x, γ) · e(C, δ)

All arkworks crates use default-features = false for no_std/WASM compatibility. Mock mode accepts all proofs for testnet development.

Features:
- Contract upgradeability via migrate() entry point
- IBC cross-chain events with ibc_source and total_verified attributes
- 16 unit tests covering all verification paths
- Deployment via deploy-testnet.sh (Osmosis osmo-test-5, Akash sandbox-01)

**Supported Cosmos Chains:**

| Chain | Chain ID | Token | Notes |
|-------|----------|-------|-------|
| Osmosis | osmosis-1 | OSMO | Primary DeFi hub, AI yield pools |
| Osmosis Testnet | osmo-test-5 | OSMO | Testing |
| Akash | akashnet-2 | AKT | GPU compute marketplace |
| Akash Testnet | sandbox-01 | AKT | Testing |
| Persistence | core-1 | XPRT | LST staking |

---

## 3. Solana SVM Verifier (xfuel-solana-prover)

Native sBPF program performing SP1 Groth16 verification using Solana's alt_bn128 precompile syscalls:

- BN254 Groth16 verification via sol_alt_bn128_group_op (ADD, MUL, PAIRING)
- PDA-based circuit registry: seeds [b"circuit", circuit_id_bytes], max 64 circuits
- PDA-per-nullifier tracking: seeds [b"nullifier", nullifier_hash]
- Wormhole bridge event emission via sol_log_data for VAA generation

CU Benchmarks:
- verifyProof: ~200K CU (alt_bn128 pairing)
- registerCircuit: ~10K CU
- emitBridgeEvent: ~8K CU

**Supported Solana Networks:**

| Network | RPC Endpoint | Notes |
|---------|-------------|-------|
| Devnet | api.devnet.solana.com | Development + CI |
| Mainnet-Beta | api.mainnet-beta.solana.com | Production |

---

## 4. Multi-Prover Matrix

All three verifier backends target <270K gas equivalents for single Groth16 verification:

| Prover | Backend | Verification Method | Gas/CU | Proof Size | Unit |
|--------|---------|-------------------|--------|------------|------|
| EVM Groth16 | ZKVerifierSP1.sol | SP1 Verifier Gateway | ~270K | 260 bytes | gas |
| CosmWasm ark-bn254 | xfuel-zk-verifier | arkworks BN254 pairing | ~250K | 260 bytes | gas_equivalent |
| Solana alt_bn128 | xfuel-solana-prover | alt_bn128 syscalls | ~220K | 260 bytes | compute_units |

**Security properties shared across all provers:**
- BN254 curve (same as Ethereum precompile 0x08)
- Groth16 proof system (128-byte proof: A ∈ G1, B ∈ G2, C ∈ G1)
- Nullifier-based replay protection
- Circuit registry with admin-controlled registration/removal
- Pause/unpause emergency controls
- Mock mode for testnet development

**Batch verification cost comparison:**

| Operation | EVM | CosmWasm | Solana |
|-----------|-----|---------|--------|
| Single verify | ~270K gas | ~250K gas_eq | ~220K CU |
| Batch (3 proofs) | ~830K gas | ~720K gas_eq | ~640K CU |
| Cross-chain relay | ~403K gas | ~250K gas_eq (IBC) | ~10K CU (emit) |

---

## 5. SP1 Proof Hooks API Reference

The SP1ProofHooks library (SP1ProofHooks.sol / xfuel-sp1-hooks crate):

| Function | Solidity | Rust | Purpose |
|----------|----------|------|---------|
| computeNullifier(proofHash, chainId, nonce) | SP1ProofHooks.computeNullifier() | xfuel_sp1_hooks::compute_nullifier() | Replay-safe nullifier generation |
| computeFeeCommitment(collector, feeBps, amount) | SP1ProofHooks.computeFeeCommitment() | xfuel_sp1_hooks::compute_fee_commitment() | Fee binding for settlement proofs |
| encodeAITaskPublicValues(...) | SP1ProofHooks.encodeAITaskPublicValues() | (native in SP1 program) | Public input encoding for AI tasks |
| computeComposedCallNullifier() | SP1ProofHooks.computeComposedCallNullifier() | — | State-root-bound nullifiers for SP1-CC |
| encodeCrossChainPayload() | SP1ProofHooks.encodeCrossChainPayload() | — | Hyperlane proof relay message formatting |

---

## 6. Cross-Chain Routing Matrix

| Source → Dest | Bridge | Method | Est. Time | Gas Equivalent |
|--------------|--------|--------|-----------|---------------|
| EVM → EVM | Hyperlane | dispatch | ~12s | ~403K |
| EVM → Cosmos | Hyperlane | dispatch | ~20s | ~403K |
| EVM → Solana | Wormhole | VAA | ~15s | ~350K |
| EVM → DePIN | Hyperlane+DePIN | dispatch→provider | ~25s | ~420K |
| Solana → EVM | Wormhole | VAA | ~15s | ~403K |
| Solana → Cosmos | Wormhole+IBC | VAA→IBC | ~30s | ~450K |
| Cosmos → EVM | IBC+Hyperlane | IBC→dispatch | ~25s | ~450K |
| Cosmos → Cosmos | IBC | channel | ~15s | ~250K |
| DePIN → EVM | DePIN+Hyperlane | result→dispatch | ~25s | ~420K |
| DePIN → DePIN | direct | p2p | ~10s | ~300K |

---

## 7. Gas Benchmarks (All Provers)

### 7.1 EVM (ZKVerifierSP1.sol)

| Operation | Target Gas | Actual (Mock) | Notes |
|-----------|-----------|---------------|-------|
| SP1 Groth16 verify | ~270K | ~270K | Via SP1 Verifier Gateway |
| Nullifier check + store | ~25K | ~22K | SSTORE + mapping lookup |
| Revenue distribution | ~80K | ~75K | 4 transfers + accounting |
| veXF lock | ~60K | ~55K | ERC20 transfer + struct update |
| Batch verify (3 proofs) | ~840K | ~830K | Amortized per-proof overhead |
| Composed call (SP1-CC) | ~500K | ~500K | 4 SSTORE for struct + gateway |
| Stake-gated verify | ~143K | ~143K | With precompile query at 0x805 |
| Cross-chain relay | ~403K | ~403K | Verify + Hyperlane dispatch |

### 7.2 CosmWasm (xfuel-zk-verifier)

| Operation | Gas Equivalent | Notes |
|-----------|---------------|-------|
| ark-bn254 Groth16 verify | ~250K | Full pairing check |
| Nullifier check + store | ~20K | cw-storage-plus lookup |
| Batch verify (3 proofs) | ~720K | Sequential pairing |
| IBC relay emit | ~5K | Event attribute emission |

### 7.3 Solana SVM (xfuel-solana-prover)

| Operation | Compute Units | Gas Equivalent | Notes |
|-----------|--------------|---------------|-------|
| alt_bn128 Groth16 verify | ~200K CU | ~220K | Syscall pairing check |
| Circuit register (PDA) | ~10K CU | ~10K | create_account + serialize |
| Nullifier check (PDA) | ~5K CU | ~5K | Owner check on PDA |
| Bridge event emit | ~8K CU | ~10K | sol_log_data structured event |
| Batch verify (3 proofs) | ~580K CU | ~640K | Sequential alt_bn128 pairing |

### 7.4 Cross-Prover Comparison

| Metric | EVM | CosmWasm | Solana | Target |
|--------|-----|---------|--------|--------|
| Single verify | 270K gas | 250K gas_eq | 220K CU | <270K ✓ |
| Batch (3) | 830K gas | 720K gas_eq | 640K CU | — |
| Proof size | 260 bytes | 260 bytes | 260 bytes | — |
| Nullifier cost | 22K gas | 20K gas_eq | 5K CU | — |
| Cross-chain relay | 403K gas | 250K gas_eq | 10K CU | — |
| Finality | ~12s | ~6s (IBC) | ~0.4s | — |
| Proving time | ~9s | ~9s | ~9s | <10s |

---

## 8. SP1 Proving Performance

| Circuit | Proving Time | Proof Size | EVM Gas | Solana CU | CosmWasm Gas |
|---------|-------------|------------|---------|-----------|-------------|
| AI Task | ~9s | 260 bytes | ~270K | ~220K | ~250K |
| A2A Message | ~7s | 260 bytes | ~270K | ~220K | ~250K |
| Fee Burn | ~5s | 260 bytes | ~270K | ~220K | ~250K |
| DePIN Compute | ~8s | 260 bytes | ~270K | ~220K | ~250K |
| Batch (3 proofs) | ~15s | 780 bytes | ~830K | ~640K | ~720K |

---

## 9. Multi-Prover Security Notes

| Property | EVM | CosmWasm | Solana |
|----------|-----|---------|--------|
| Curve | BN254 (precompile 0x08) | BN254 (arkworks) | BN254 (alt_bn128 syscall) |
| Proof system | Groth16 | Groth16 | Groth16 |
| Replay protection | usedNullifiers mapping | cw-storage Map | PDA existence check |
| Circuit registry | mapping + struct | cw-storage Map | PDA-per-circuit |
| Pause mechanism | paused state var | IS_PAUSED Item | is_paused in VerifierState |
| Upgrade mechanism | Proxy pattern (TBD) | CosmWasm migrate() | BPFLoaderUpgradeab1e |
| Access control | OpenZeppelin roles | Admin address | Admin pubkey |
| Mock mode | gateway == address(0) | mock_mode flag | cfg(not(target_os)) |

---

## 10. WASM Contract Sizes

| Contract | Size (optimized) | Notes |
|----------|-----------------|-------|
| xfuel-zk-verifier | ~120 KB | With mock verifier |
| xfuel-revenue-splitter | ~80 KB | Standard BankMsg |
| xfuel-sp1-hooks | ~15 KB | Library crate |

---

## 11. Solana Program Size

| Program | Size (sBPF) | Notes |
|---------|------------|-------|
| xfuel-solana-prover | ~45 KB | With alt_bn128 syscalls |

---

## 12. CoreListener Test Coverage

| Test Suite | Count | Coverage |
|-----------|-------|---------|
| Circuit Registration | 6 | Register, unregister, chain/intent filters, SVM |
| Status Reporting | 7 | Prover info, gas benchmarks, routes, metrics |
| Intent Dispatch | 6 | Prover context, route getters, chain filtering |
| Proof Generation | 2 | Mock proof with retry, proof size |
| Proof Result Tracking | 3 | Per-prover metrics, cache eviction |
| Solana Event Parsing | 5 | ProofVerified, Program log, malformed, null |
| ProverNormalizer | 11 | Solana/Cosmos/EVM normalization, gas targets |
| ProofRouter | 11 | All route combinations, allRoutes |
| Gas Benchmarks | 4 | All provers <270K, units, batch |
| DEFAULT_CHAINS | 6 | All chain types, prover/gasTarget |
| End-to-End Multi-Prover | 6 | Full pipeline: event→normalize→route→dispatch |
| Enums | 4 | Frozen, correct values |
| Queue & Backpressure | 5 | Overflow, concurrency, backpressure, 500-event sim, stats |
| **Total** | **90** | — |

---

## 13. Scalability (Queue & Backpressure)

The CoreListener uses a bounded intent queue ([p-queue](https://github.com/sindresorhus/p-queue)) to maintain throughput under peak load without dropping events or exhausting memory.

### 13.1 Queue Mechanics

| Parameter | Default | Env Variable | Description |
|-----------|---------|-------------|-------------|
| Concurrency | 50 | `MAX_CONCURRENCY` | Max intents processed in parallel |
| Max Pending | 1000 | `MAX_PENDING` | Max intents waiting in queue before rejection |
| Backpressure Threshold | 800 (80%) | — | Queue size that triggers `console.warn` |

**Flow:**

1. Event arrives from chain poller (`_pollEVM`, `_pollSolana`, `_pollCosmos`)
2. `_dispatchIntent()` checks queue capacity:
   - If `queue.size >= maxPending` → reject with `IntentOutcomeType.FAILED` + `"Queue overflow"` reason
   - If `queue.size > backpressureThreshold` → emit `console.warn` with queue depth
   - Otherwise → `queue.add(() => _processIntent(intent, chainKey))`
3. `_processIntent()` runs the original circuit-dispatch logic within the concurrency window

**Additive design:** Existing callers of `_dispatchIntent()` are unaffected — the method signature and return semantics are preserved. The queue adds ~0.1ms overhead per intent under normal load.

### 13.2 Benchmark Instructions

Run the SP1 Prover benchmark with high concurrency:

```bash
# Standard benchmark (local prover)
SP1_PROVER_URL=http://localhost:3000 node backend/theta-bridge/scripts/benchmark-prover.js \
  --sequential 50 --concurrent 10

# High-concurrency stress test (500 parallel, EdgeCloud)
SP1_PROVER_URL=https://prover.edgecloud.theta.network \
THETA_EDGECLOUD_API_KEY=<key> \
node backend/theta-bridge/scripts/benchmark-prover.js \
  --sequential 10 --concurrent 500

# Output: benchmark-results.csv
```

The `--concurrent 500` mode runs proofs in waves of 50, tracking uptime and GPU utilization:
- **Target uptime:** 99% (successful proofs / total attempted)
- **Target GPU utilization:** >50% (aggregate GPU time / wall-clock time)
- **Runtime auto-detection:** Uses EdgeCloud when `THETA_EDGECLOUD_API_KEY` is set, falls back to local prover

### 13.3 Queue Throughput

| Metric | Value | Notes |
|--------|-------|-------|
| Concurrency (default) | 50 | Configurable via `MAX_CONCURRENCY` |
| Max queue depth | 1000 | Configurable via `MAX_PENDING` |
| Backpressure threshold | 800 | 80% of max pending |
| Overhead per intent | ~0.1ms | p-queue async scheduling |
| Queue overflow behavior | Reject + FAILED outcome | Graceful degradation |
| Backpressure signal | `console.warn` | Ops-visible warning |

### 13.4 Gas & Throughput Under Load

| Scenario | Events/sec | Avg Latency | Gas/Proof | Queue Depth |
|----------|-----------|-------------|-----------|-------------|
| Idle (1 chain) | 0-1 | <1ms | — | 0 |
| Normal (5 chains) | 5-20 | 2-9s (proving) | ~270K | 0-10 |
| Peak (burst) | 50-100 | 2-9s (proving) | ~270K | 50-200 |
| Stress (500 concurrent) | 500 | 5-15s (proving) | ~270K | 200-800 |
| Overload (>1000) | 500 (capped) | — | — | 1000 (rejects) |

### 13.5 Queue Tests

| Test | Description |
|------|-------------|
| Queue overflow reject | Verifies intents are rejected with FAILED outcome when queue exceeds `maxPending` |
| Concurrency limit | Confirms peak parallel execution never exceeds configured concurrency |
| Backpressure emit | Validates `console.warn` fires and metric increments when queue > threshold |
| High-volume sim (500) | Dispatches 500 intents, asserts all 500 handled with zero overflows |
| Queue stats in status | Checks `getStatus()` includes queue depth, concurrency, overflow count |

---

## 14. File Structure

```
core-layer/
├── ai-listener.js                    # Multi-prover event poller + intent solver
├── package.json                      # Node.js dependencies
├── contracts/
│   ├── interfaces/
│   │   ├── ISP1Verifier.sol          # SP1 Gateway interface
│   │   ├── IBittensorStaking.sol     # Bittensor staking precompile
│   │   └── ICrossChainMailbox.sol    # Hyperlane mailbox interface
│   ├── ZKVerifierSP1.sol             # EVM proof verifier (Phase 2)
│   ├── CoreRevenueSplitter.sol       # Fee distribution (30/30/25/15)
│   ├── veXFGovernance.sol            # Governance stubs
│   └── SP1ProofHooks.sol             # Proof utility library
├── wasm/
│   ├── zk-verifier/                  # CosmWasm ZK verifier
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── contract.rs
│   │       ├── msg.rs
│   │       ├── state.rs
│   │       └── error.rs
│   └── revenue-splitter/             # CosmWasm revenue splitter
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── contract.rs
│           ├── msg.rs
│           ├── state.rs
│           └── error.rs
├── sp1-hooks/                        # Rust SP1 proof utilities
│   ├── Cargo.toml
│   └── src/
│       └── lib.rs
└── test/
    ├── ai-listener.test.js           # Multi-prover tests (85 tests)
    ├── ZKVerifierSP1.test.cjs        # Hardhat Solidity tests
    ├── SP1ProofHooks.test.cjs        # Proof hooks library tests
    ├── SP1ProofHooksHarness.sol      # Test harness for library
    └── MockERC20.sol                 # Mock token for tests

solana-prover/
├── Cargo.toml                        # Rust deps (solana-program, borsh)
├── src/
│   ├── lib.rs                        # Core verifier logic + BN254 module
│   ├── entry.rs                      # Solana BPF entrypoint
│   └── tests.rs                      # 35 unit + integration tests
└── deploy/
    └── deploy-devnet.sh              # Devnet deployment script

sp1-prover/
├── Cargo.toml                        # SP1 zkVM prover workspace
└── program/
    ├── Cargo.toml
    └── src/
        └── main.rs                   # SP1 circuit program (RISC-V)
```
