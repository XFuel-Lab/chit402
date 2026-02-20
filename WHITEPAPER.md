# XFuel Protocol — Core Layer Whitepaper v1.6

**AI Pumping Station: A Modular, ZK-Secured DePIN Hub for Cross-Ecosystem Intelligence**

*Version 1.6 — Core Layer Architecture*
*February 2026*

---

## Abstract

XFuel Protocol is a **modular, zero-knowledge-secured DePIN hub** that pumps intelligence, compute, liquidity, and value across AI ecosystems. Rather than coupling to any single blockchain or AI marketplace, XFuel implements an **ecosystem-agnostic Core Layer** — a central hub responsible for ZK proof verification, task routing, fee distribution, governance, and treasury operations — into which independent **circuits** (specialized modules) plug to serve specific use cases.

This whitepaper describes the Core Layer architecture, its components, and how they interact to enable trustless, verifiable pumping of AI workloads across heterogeneous blockchain environments (EVM chains, Cosmos/IBC networks, and beyond). The design prioritizes:

1. **Full modularity** — Independent circuits plug in via event-driven interfaces; no shared state between modules.
2. **Ecosystem-agnostic integration** — Connect with any project (compute marketplaces, AI incentive layers, yield aggregators) through standardized proof and event formats.
3. **Circuit integrity** — Isolation for security and scalability, including subchain-ready architecture.
4. **2030-forward resilience** — Designed for multi-network AI economies at scale.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Core Layer Architecture](#2-core-layer-architecture)
3. [ZK Verification (Hybrid)](#3-zk-verification-hybrid)
4. [Task Routing & Intent Solving](#4-task-routing--intent-solving)
5. [Revenue & Fee Distribution](#5-revenue--fee-distribution)
6. [Governance (veXF)](#6-governance-vexf)
7. [SP1 Proof Hooks](#7-sp1-proof-hooks)
8. [Cross-Chain Integration](#8-cross-chain-integration)
9. [Use Cases](#9-use-cases)
10. [Tokenomics](#10-tokenomics)
11. [Security Model](#11-security-model)
12. [Roadmap](#12-roadmap)
13. [Technical Specifications](#13-technical-specifications)

---

## 1. Introduction

The proliferation of decentralized AI networks — compute marketplaces, inference providers, data attestation layers, and incentive protocols — creates a fragmented landscape. Each operates in isolation, with its own proof formats, fee structures, and settlement mechanisms.

XFuel Protocol addresses this fragmentation by providing a **Core Layer** that serves as a universal settlement and routing hub. Any AI-related project can integrate with XFuel by implementing a **circuit** — a self-contained module that:

- Listens for Core Layer events
- Submits task intents for ZK-verified routing
- Receives settlement confirmations with cryptographic proofs
- Participates in fee sharing through the unified RevenueSplitter

The Core Layer itself is minimal by design: it verifies proofs, routes intents, splits fees, and governs parameters. All domain-specific logic (which AI model to run, which compute provider to select, how to price a lease) lives in circuits.

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Modularity** | Circuits plug into Core via events/exports; no shared state |
| **Chain-agnostic** | Hybrid verifier (Solidity for EVM, WASM for Cosmos); standardized proof format |
| **Low-gas settlement** | Target <100K gas per proof verification on EVM chains |
| **Trustless** | SP1 zkVM proofs replace trusted intermediaries |
| **Subchain-ready** | Each circuit can run on its own Theta subchain or Cosmos appchain |
| **Progressive decentralization** | Admin roles → veXF governance → fully on-chain DAO |

---

## 2. Core Layer Architecture

The Core Layer consists of five primary components, each implemented in both Solidity (EVM) and Rust/WASM (Cosmos) where applicable:

```
                        ┌──────────────────────────────┐
                        │       CORE LAYER (Hub)       │
                        ├──────────────────────────────┤
                        │  ZKVerifierSP1 (EVM/WASM)    │ ← Proof verification
                        │  CoreRevenueSplitter         │ ← Fee distribution
                        │  veXFGovernance              │ ← Parameter voting
                        │  SP1ProofHooks               │ ← Proof utilities
                        │  CoreListener (ai-listener)  │ ← Event polling/routing
                        └──────────┬───────────────────┘
                                   │
               ┌───────────────────┼───────────────────┐
               │                   │                   │
        ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
        │  Circuit A  │    │  Circuit B  │    │  Circuit N  │
        │ (Compute    │    │ (Inference  │    │ (Custom     │
        │  Marketplace)│   │  Router)    │    │  Module)    │
        └─────────────┘    └─────────────┘    └─────────────┘
```

### Component Responsibilities

| Component | Role | EVM Contract | WASM Contract |
|-----------|------|-------------|---------------|
| **ZKVerifierSP1** | Verify SP1 Groth16/PLONK proofs, track nullifiers, manage circuits | `ZKVerifierSP1.sol` | `xfuel-zk-verifier` |
| **CoreRevenueSplitter** | Collect and distribute fees (30/30/25/15 split) | `CoreRevenueSplitter.sol` | `xfuel-revenue-splitter` |
| **veXFGovernance** | Vote-escrowed governance for parameter updates | `veXFGovernance.sol` | (planned) |
| **SP1ProofHooks** | Library for nullifier computation, fee commitments, public value encoding | `SP1ProofHooks.sol` (library) | `xfuel-sp1-hooks` (crate) |
| **CoreListener** | Off-chain multi-RPC event poller, intent solver, proof coordinator | `ai-listener.js` | — |

### Event-Driven Circuit Interface

Circuits interact with the Core Layer exclusively through events:

```
Core emits:
  → TaskRouted(circuitId, taskHash, sender, chain, amount)
  → ProofVerified(circuitId, nullifier, publicValues)
  → FeeDistributed(totalAmount, bbbShare, lpShare, stakerShare, treasuryShare)
  → ProposalExecuted(proposalId, proposalType, parameters)

Circuits emit:
  → IntentSubmitted(circuitId, intentType, data)
  → TaskCompleted(circuitId, taskHash, outputHash, proof)
  → SettlementRequested(circuitId, amount, recipient, chain)
```

This event-driven architecture ensures:
- **Zero shared state** between circuits
- **Independent upgradability** — each circuit can be upgraded without affecting others
- **Subchain isolation** — circuits can run on dedicated subchains, communicating via cross-chain messages

---

## 3. ZK Verification (Hybrid)

### 3.1 SP1 zkVM Foundation

All proofs in the XFuel Core Layer are generated using **SP1 zkVM** (Succinct), a RISC-V-based zero-knowledge virtual machine. SP1 allows arbitrary Rust programs to be compiled to RISC-V and executed inside a ZK-proving environment, producing:

- **STARK proofs** (initial proof, ~1-5MB)
- **Groth16 wrapper** (for EVM, ~260 bytes, ~270K gas to verify)
- **PLONK wrapper** (alternative, ~868 bytes, ~300K gas)

Key SP1 characteristics (per SP1 docs 2026):
- RISC-V instruction set with precompiles for SHA-256, Keccak-256, secp256k1, ed25519, BN254
- Recursion and aggregation support for batching proofs
- Network prover (Succinct Prover Network) for outsourced proof generation
- Typical proving time: 5-15s for standard circuits, optimizable with precompiles

### 3.2 EVM Verifier (ZKVerifierSP1.sol)

The Solidity verifier wraps the SP1 Verifier Gateway deployed on EVM chains:

```
┌──────────────────────────────────────────────────────────────┐
│                    ZKVerifierSP1.sol                          │
├──────────────────────────────────────────────────────────────┤
│  SP1 Verifier Gateway (ISP1Verifier)                         │
│  ├─ verifyProof(programVKey, publicValues, proofBytes)       │
│  └─ verifyProofWithHash(vkey, inputHash, proofBytes)         │
│                                                              │
│  Circuit Registry                                            │
│  ├─ registerCircuit(circuitId, programVKey, label)           │
│  └─ removeCircuit(circuitId)                                 │
│                                                              │
│  Nullifier Tracking                                          │
│  ├─ usedNullifiers mapping                                   │
│  └─ Prevents replay attacks                                  │
│                                                              │
│  Circuit Breaker                                             │
│  ├─ Failure rate monitoring (per window)                     │
│  └─ Auto-pause at configurable threshold                     │
│                                                              │
│  Gas Target: ~270K per Groth16 verification                  │
│  Mock Mode: gateway == address(0) → skip verification        │
└──────────────────────────────────────────────────────────────┘
```

**Supported EVM Chains:**

| Chain | Chain ID | Gas Token | Notes |
|-------|----------|-----------|-------|
| Theta Mainnet | 361 | TFUEL | Primary deployment, 4000 Gwei min gas |
| Theta Testnet | 365 | TFUEL | Testing environment |
| Bittensor EVM | 964 | TAO | dTAO staking, Hyperlane bridging |
| Hardhat Local | 1337 | ETH | Development |

### 3.3 WASM Verifier (xfuel-zk-verifier)

The CosmWasm verifier mirrors the EVM functionality for Cosmos/IBC chains:

```rust
ExecuteMsg::VerifyProof {
    circuit_id: String,        // Circuit identifier
    program_vkey: String,      // Hex-encoded verification key
    public_values: String,     // Hex-encoded public inputs
    proof_bytes: String,       // Hex-encoded proof
    nullifier: String,         // Replay protection
}
```

**Implementation Notes:**
- Full SP1 proof verification in WASM requires BN254 pairing (Groth16) or KZG (PLONK) — currently implemented as a mock verifier with a `verify_sp1_proof_wasm()` skeleton for future integration.
- When native CosmWasm precompiles for BN254 become available, the verifier will delegate to those for gas-efficient on-chain verification.
- The mock mode allows development and testing against real SP1 proof formats.

**Supported Cosmos Chains:**

| Chain | Chain ID (Cosmos) | Token | Notes |
|-------|-------------------|-------|-------|
| Osmosis | osmosis-1 | OSMO | Primary DeFi hub, AI yield pools |
| Akash | akashnet-2 | AKT | GPU compute marketplace |
| Persistence | core-1 | XPRT | LST staking |

---

## 4. Task Routing & Intent Solving

### 4.1 CoreListener (ai-listener.js)

The off-chain CoreListener is a Node.js process that:

1. **Polls multiple RPCs** — Configurable set of EVM (via ethers.js) and Cosmos (via @cosmjs/stargate) chains
2. **Parses AI intents** — Classifies on-chain events into intent types:
   - `COMPUTE_BID` — Request GPU/compute resources
   - `COMPUTE_RESULT` — Attest job completion
   - `INFERENCE_REQUEST` — Route ML inference to a provider
   - `CAPABILITY_QUERY` — Discover peer agent capabilities
   - `DATA_ATTESTATION` — Certify dataset provenance
   - `SETTLEMENT` — Settle cross-chain payments
3. **Dispatches to circuits** — Each registered circuit receives intents matching its filter criteria (chain, intent type)
4. **Coordinates proofs** — Triggers SP1 proof generation for settlements, with retry logic for regenerable proofs (>10s latency threshold)

### 4.2 Intent Solving Pipeline

```
Event Detected (EVM/Cosmos)
  │
  ▼
IntentSolver.parse(event)
  │
  ├─ EVM: Parse TaskRouted/ProofVerified logs
  │
  └─ Cosmos: Parse wasm action attributes
  │
  ▼
Filter by circuit subscriptions
  │
  ▼
Dispatch to matching circuits
  │
  ▼
Circuit processes intent (domain-specific logic)
  │
  ▼
Settlement → SP1 proof generation
  │
  ├─ Success: ProofVerified event, nullifier stored
  │
  └─ Regenerable: Retry with fresh nonce (if latency > threshold)
```

### 4.3 Multi-Network Configuration

The CoreListener supports a pluggable chain registry:

```javascript
chains: {
  theta_mainnet:  { type: 'evm',    chainId: 361,  rpc: '...' },
  bittensor_evm:  { type: 'evm',    chainId: 964,  rpc: '...' },
  osmosis:        { type: 'cosmos',  chainId: 'osmosis-1', rpc: '...' },
  akash:          { type: 'cosmos',  chainId: 'akashnet-2', rpc: '...' },
}
```

Each chain entry specifies its type (EVM or Cosmos), connection parameters, contract addresses, and polling interval. Circuits can subscribe to specific chains or listen globally.

---

## 5. Revenue & Fee Distribution

### 5.1 Fee Structure

All protocol interactions incur a configurable fee (0.1%–1%) that flows through the CoreRevenueSplitter:

| Fee Type | Rate (BPS) | Source |
|----------|-----------|--------|
| AI task settlement | 50–100 | Compute bids, inference routing |
| A2A relay | 10 | Agent-to-agent messages with escrow |
| Bridge transfer | 50 | Cross-chain deposits/withdrawals |
| Data attestation | 50 | Dataset provenance certification |

### 5.2 Revenue Split (30/30/25/15)

All collected fees are distributed according to a fixed ratio:

```
┌─────────────────────────────────────────────┐
│           CoreRevenueSplitter               │
├─────────────────────────────────────────────┤
│  30%  →  Buyback-Burn (BBB)                 │
│          XF token deflationary pressure     │
│                                             │
│  30%  →  Liquidity Provision (LP)           │
│          Deepen ecosystem pools             │
│                                             │
│  25%  →  Staker Rewards (veXF)              │
│          Distributed to governance lockers  │
│                                             │
│  15%  →  Treasury                           │
│          Operations, development, audits    │
│          ├─ 15-25% → Fee-to-Stake pool      │
│          └─ Validator incentives            │
└─────────────────────────────────────────────┘
```

### 5.3 Fee-to-Stake Mechanism

A configurable portion (15-25%) of the treasury allocation is routed to **validator staking pools** to incentivize network security:

- **Theta Metachain**: Routes to wTHETA/TFUEL staking pools. Per Theta docs, each subchain validator requires 1,000 wTHETA minimum plus 20,000 TFUEL reserves.
- **Bittensor**: Routes to dTAO staking for subnet mining/validation.
- **Cosmos**: Routes to native staking for validator set participation.

This creates a virtuous cycle: protocol fees → validator incentives → stronger network security → more protocol activity.

### 5.4 Implementation

| Platform | Contract | Key Functions |
|----------|----------|--------------|
| EVM | `CoreRevenueSplitter.sol` | `receive()`, `depositFee()`, `distribute()`, `setSplit()`, `setFeeToStake()` |
| Cosmos | `xfuel-revenue-splitter` | `ExecuteMsg::Distribute`, `ExecuteMsg::DepositFee`, `ExecuteMsg::UpdateSplit` |

---

## 6. Governance (veXF)

### 6.1 Vote-Escrowed Model

XFuel governance follows the Curve-style vote-escrowed (ve) model:

- Users **lock XF tokens** for a duration between 26 weeks (minimum) and 3 years (maximum)
- Voting power is proportional to **amount locked × remaining duration**
- Power **decays linearly** as the lock approaches expiry, incentivizing longer commitments
- Maximum multiplier: **3x** (for max-duration locks)

### 6.2 Governance Scope

veXF holders vote on:

| Proposal Type | Description | Quorum |
|--------------|-------------|--------|
| **Circuit Priority** | Which circuits receive priority routing/resources | 10% |
| **LP Allocation** | How LP funds are allocated across pools | 15% |
| **Fee Structure** | Adjust fee BPS ranges and split ratios | 20% |
| **Treasury Spend** | Approve treasury expenditures (>$50K) | 25% |
| **Emergency Pause** | Activate circuit breakers | 5% (supermajority 67%) |

### 6.3 Multiplier Schedule

| Lock Duration | Multiplier | Voting Power (100 XF locked) |
|--------------|------------|------|
| 26 weeks | ~0.17x | 17 veXF |
| 1 year | ~1x | 100 veXF |
| 2 years | ~2x | 200 veXF |
| 3 years | 3x | 300 veXF |

Voting power decays linearly to zero at lock expiry.

---

## 7. SP1 Proof Hooks

### 7.1 Shared Utilities

The SP1 Proof Hooks library provides cross-platform utilities that ensure consistency between Solidity contracts, CosmWasm contracts, and the SP1 prover program:

| Function | Solidity | Rust |
|----------|----------|------|
| `computeNullifier(proofHash, chainId, nonce)` | `SP1ProofHooks.computeNullifier()` | `xfuel_sp1_hooks::compute_nullifier()` |
| `computeFeeCommitment(collector, feeBps, amount)` | `SP1ProofHooks.computeFeeCommitment()` | `xfuel_sp1_hooks::compute_fee_commitment()` |
| `encodeAITaskPublicValues(...)` | `SP1ProofHooks.encodeAITaskPublicValues()` | (native in SP1 program) |
| `calculateTaskFee(amount, feeBps)` | (in CoreRevenueSplitter) | `xfuel_sp1_hooks::calculate_task_fee()` |

### 7.2 Proof Lifecycle

```
1. Request  → CoreListener receives intent, creates ProofRequest
2. Generate → SP1 prover compiles circuit, generates STARK proof
3. Wrap     → STARK proof wrapped as Groth16 (EVM) or verified as-is (WASM)
4. Submit   → Proof submitted to ZKVerifierSP1 (on-chain)
5. Verify   → Gateway verifies, nullifier stored, event emitted
6. Settle   → Circuit receives ProofVerified event, completes settlement
```

### 7.3 Nonce-Based Replay Protection

Every proof includes a **nullifier** computed as:

```
nullifier = keccak256(proofHash || chainId || nonce)
```

The nonce is monotonically incremented per sender per chain, ensuring:
- Each proof can only be used once
- Cross-chain replays are prevented (chain ID embedded)
- Nonce desync is recoverable (query on-chain nonce, retry)

---

## 8. Cross-Chain Integration

### 8.1 Integration Model

XFuel's Core Layer supports three integration tiers:

| Tier | Integration | Example |
|------|------------|---------|
| **Tier 1: Native** | Direct contract deployment (EVM + WASM) | Theta, Osmosis |
| **Tier 2: Bridge** | IBC or Hyperlane message passing | Akash, Bittensor |
| **Tier 3: Listener** | Off-chain event monitoring + proof submission | Any chain with RPC |

### 8.2 Chain-Specific Notes

**Theta Metachain** (per docs.thetatoken.org):
- Interconnected "chain of chains" with EVM compatibility
- Subchain validators: 1,000 wTHETA minimum + 20,000 TFUEL reserves
- TFUEL as gas token; 4000 Gwei minimum gas price on mainnet
- Theta Edge Cloud for inference execution

**Bittensor EVM** (per docs.bittensor.com/evm):
- Chain ID 964, TAO as native currency
- EVM precompiles for staking (`0x0800`), subnet management (`0x0801`), balances (`0x0802`)
- Hyperlane bridge for cross-chain messaging
- dTAO staking for dynamic subnet allocation

**CosmWasm / Cosmos** (per docs.cosmwasm.com):
- Rust-compiled WASM smart contracts
- IBC for cross-chain communication (channel-based)
- `cw-plus` standard library (cw20, cw721, cw-storage-plus)
- Gas metering via CosmWasm VM

---

## 9. Use Cases

The Core Layer is designed to support any AI/DePIN use case through its circuit architecture. Example circuits include:

### 9.1 Compute Marketplace Circuit
Routes GPU/compute bids to the cheapest provider across networks. Verifies task completion via SP1 proofs and settles payments through the Core RevenueSplitter.

### 9.2 AI Inference Router Circuit
Accepts ML inference requests, routes them to the optimal provider (based on latency, cost, model availability), and attests results on-chain.

### 9.3 Data Attestation Circuit
Certifies dataset provenance, quality scores, and lineage on-chain with ZK proofs. Useful for AI training data marketplaces.

### 9.4 Yield Aggregation Circuit
Routes liquidity to highest-yielding pools across DeFi protocols, with ZK-verified rebalancing and settlement.

### 9.5 Agent Communication Circuit
Enables ZK-verified agent-to-agent (A2A) messaging across heterogeneous networks with escrowed payments and TTL-based expiry.

### 9.6 Custom / Private Circuits
Any project can build a custom circuit by implementing the circuit interface (event listeners + proof submission). The Core Layer provides ZK settlement, fee collection, and governance — the circuit provides domain-specific logic.

---

## 10. Tokenomics

### XF Token Utility

| Utility | Mechanism |
|---------|-----------|
| **Governance** | Lock XF → veXF for voting on circuit priorities, fee parameters, treasury spend |
| **Staking Rewards** | 25% of all protocol fees distributed to veXF lockers |
| **Deflationary** | 30% of all fees used for buyback-and-burn |
| **Liquidity Mining** | 30% of fees reinvested into ecosystem pools |

### Fee Flow

```
Protocol Activity (AI tasks, bridges, attestations)
  │
  ▼
Fee Collection (0.1-1% per transaction)
  │
  ▼
CoreRevenueSplitter
  ├── 30% → BBB (Buyback-Burn XF)
  ├── 30% → LP (Liquidity Provision)
  ├── 25% → veXF (Staker Rewards)
  └── 15% → Treasury
       └── 15-25% → Fee-to-Stake (Validator Incentives)
```

### Revenue Projections (Steady-State)

| TVL | Monthly Volume | Monthly Fees (0.5% avg) | Annual Revenue |
|-----|---------------|------------------------|----------------|
| $5M | $2M | $10K | $120K |
| $20M | $10M | $50K | $600K |
| $100M | $50M | $250K | $3M |

Volume composition target: 60% AI tasks, 25% data/communications, 15% financial settlements.

---

## 11. Security Model

### 11.1 Cryptographic Security

- **SP1 zkVM proofs** — All settlements cryptographically verified; no trust assumptions
- **Transparent setup** — No trusted ceremony risk (SP1 uses FRI-based STARKs)
- **Nonce-based replay protection** — Per-sender, per-chain monotonic nonces
- **Nullifier tracking** — On-chain mapping prevents proof reuse

### 11.2 Contract Security

- **Access control** — Role-based (ADMIN, OPERATOR, CIRCUIT_MANAGER) via OpenZeppelin
- **Pausability** — Emergency pause on all verification and distribution contracts
- **Circuit breaker** — Auto-pause if failure rate exceeds configurable threshold (default 10%)
- **Reentrancy guards** — On all external-calling functions
- **Mock mode** — For testing without live ZK infrastructure

### 11.3 Operational Security

- **Multi-RPC redundancy** — CoreListener polls multiple RPCs per chain
- **Event deduplication** — Processed event cache prevents double-processing
- **Proof retry** — Regenerable proofs retried with fresh nonces
- **Graceful degradation** — Circuits continue operating independently if one fails

### 11.4 Audit Plan

| Phase | Scope | Timeline |
|-------|-------|----------|
| Phase 1 | Core Layer contracts (ZKVerifier, RevenueSplitter, veXF) | Q2 2026 |
| Phase 2 | SP1 circuits + proof hooks | Q3 2026 |
| Phase 3 | CosmWasm contracts + IBC integration | Q4 2026 |
| Bug Bounty | $500K via Immunefi | Ongoing post-Phase 1 |

---

## 12. Roadmap

### Phase 1: Core Layer Skeleton (Current — Q1 2026)
- [x] ZKVerifierSP1 (EVM + WASM)
- [x] CoreRevenueSplitter (EVM + WASM)
- [x] veXFGovernance stubs
- [x] SP1 Proof Hooks (Solidity + Rust)
- [x] CoreListener (ai-listener.js)
- [ ] Unit tests (Hardhat + Mocha)
- [ ] Integration tests

### Phase 2: Circuit PoCs (Q2 2026)
- [ ] Compute Marketplace circuit (Akash integration)
- [ ] Inference Router circuit (Bittensor subnet routing)
- [ ] Bridge circuit (Theta ↔ Cosmos enhanced)
- [ ] Testnet deployment + circuit interop testing

### Phase 3: Mainnet + Governance (Q3 2026)
- [ ] Mainnet deployment (Theta + Osmosis primary)
- [ ] veXF governance activation (lock + vote)
- [ ] Fee-to-Stake activation (Theta validators)
- [ ] CertiK audit Phase 1

### Phase 4: Scale (Q4 2026 — 2027)
- [ ] Theta subchain per circuit
- [ ] ZK rollup layer (10x throughput)
- [ ] Cross-DePIN compute routing (multi-network)
- [ ] Intent-based architecture
- [ ] $100M+ TVL target

### 2028-2030: Multi-Network AI
- Isolated circuits for resilience in multi-net AI economies
- Autonomous agent economy with ZK-verified settlements
- Privacy-preserving AI data markets via ZK proofs
- Generalized cross-chain protocol for any blockchain ecosystem

---

## 13. Technical Specifications

### 13.1 Gas Benchmarks (EVM)

| Operation | Target Gas | Actual (Mock) | Notes |
|-----------|-----------|---------------|-------|
| SP1 Groth16 verify | ~270K | ~270K | Via SP1 Verifier Gateway |
| Nullifier check + store | ~25K | ~22K | SSTORE + mapping lookup |
| Revenue distribution | ~80K | ~75K | 4 transfers + accounting |
| veXF lock | ~60K | ~55K | ERC20 transfer + struct update |
| Batch verify (3 proofs) | ~840K | ~830K | Amortized per-proof overhead |

### 13.2 WASM Contract Sizes

| Contract | Size (optimized) | Notes |
|----------|-----------------|-------|
| xfuel-zk-verifier | ~120 KB | With mock verifier |
| xfuel-revenue-splitter | ~80 KB | Standard BankMsg |
| xfuel-sp1-hooks | ~15 KB | Library crate |

### 13.3 SP1 Proving Performance

| Circuit | Proving Time | Proof Size | Verification Gas |
|---------|-------------|------------|-----------------|
| AI Task | ~9s | 260 bytes (Groth16) | ~270K |
| A2A Message | ~7s | 260 bytes | ~270K |
| Fee Burn | ~5s | 260 bytes | ~270K |
| Batch (3 proofs) | ~15s | 780 bytes | ~830K |

### 13.4 File Structure

```
core-layer/
├── ai-listener.js                    # Multi-RPC event poller + intent solver
├── package.json                      # Node.js dependencies
├── contracts/
│   ├── interfaces/
│   │   └── ISP1Verifier.sol          # SP1 Gateway interface
│   ├── ZKVerifierSP1.sol             # EVM proof verifier
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
    ├── ai-listener.test.js           # JS unit tests (Node.js test runner)
    ├── ZKVerifierSP1.test.cjs        # Hardhat Solidity tests
    ├── SP1ProofHooks.test.cjs        # Proof hooks library tests
    ├── SP1ProofHooksHarness.sol      # Test harness for library
    └── MockERC20.sol                 # Mock token for tests
```

---

## 14. Priority Circuits (Step 2 — v1.6.1)

The Core Layer's modularity is validated by three priority circuit prototypes, each fully isolated with its own state, events, and pause mechanism. These circuits demonstrate ecosystem-agnostic integration: any project can build an equivalent circuit.

### 14.1 AI Marketplace Circuit (TAOCircuit)

**Purpose:** Generalized cross-chain task routing for any AI marketplace with AMM fee capture and oracle-backed pricing.

**Reference integration:** Bittensor EVM (Chain ID 964), but designed for any EVM-based AI marketplace.

| Feature | Implementation |
|---------|---------------|
| **Cross-chain bridging** | Hyperlane IMailbox.dispatch() for cross-chain task routing |
| **AMM fee capture** | captureSwapFee() hook for Uniswap V3-style pool integrations |
| **Oracle pricing** | Chainlink AggregatorV3 with admin price fallback |
| **Task lifecycle** | Submit → Bridge → Settle with SP1 proof |
| **Fee model** | 0.5% (configurable 0.1-1%) → CoreRevenueSplitter |

```
User → TAOCircuit.submitTask()
         ├── Fee → CoreRevenueSplitter.depositFee(CIRCUIT_ID)
         ├── Event → TaskRouted (ai-listener detects)
         └── Bridge → Hyperlane.dispatch() (if cross-chain)
                         └── Remote chain receives + processes
```

**Research notes:**
- Per Bittensor EVM docs: Chain ID 964, precompiles at 0x805 (StakingPrecompileV2), SubnetPrecompile, MetagraphPrecompile, NeuronPrecompile.
- Per Hyperlane docs: dispatch(domain, recipient, body) for cross-chain messaging; quoteDispatch() for fee estimation.
- Per Chainlink: AggregatorV3 for on-chain price feeds; fallback to admin-set prices on chains without Chainlink.

### 14.2 Agent Communication Circuit (A2ACircuit)

**Purpose:** ZK-secured agent-to-agent communication with service discovery, bidding, and x402-inspired micropayment channels.

| Feature | Implementation |
|---------|---------------|
| **Service discovery** | On-chain agent registry with capability indexing |
| **Bidding/auction** | Escrow-based bids with deadline TTL; provider acceptance |
| **x402 micropayments** | Payment channels: deposit → claim with ZK proof → close |
| **SP1 privacy** | Proof-gated messaging with nullifier replay protection |
| **Fee model** | 0.1% relay fee on escrow + 0.5% task fee on settlement |

```
Agent Registration: registerAgent(identity, endpoint, capabilities)
                         └── Indexed for capability-based discovery

Bid Lifecycle:
  Requester → submitBid(task, capability, deadline) {escrow}
       └── 0.1% relay fee → CoreRevenueSplitter
  Provider  → acceptBid(bidId, price)
  Relayer   → settleBid(bidId, resultHash, proof, nullifier)
       └── 0.5% task fee → CoreRevenueSplitter
       └── Provider receives payout
       └── Requester receives refund (if price < escrow)

x402-Style Channel:
  Payer → openChannel(payee, duration) {deposit}
  Payee → claimChannel(channelId, amount, proof) [repeatable]
  Either → closeChannel(channelId) [after expiry → refund remainder]
```

**Research notes:**
- Per x402 protocol (x402.org): HTTP 402 "Payment Required" enables instant micropayments (~2s). XFuel adapts this for on-chain escrow with ZK proof of delivery.
- Per SP1 docs: Agent identity commitments (Poseidon hash) can be verified in ZK for privacy-preserving authentication.

### 14.3 Edge Compute Circuit (ThetaGPUCircuit)

**Purpose:** GPU inference routing via Theta EdgeCloud with provider staking, model registry, and subchain-ready architecture.

**Reference integration:** Theta Edge Cloud, but designed for any edge/cloud compute provider.

| Feature | Implementation |
|---------|---------------|
| **Model registry** | On-chain catalog: name, category, price, min collateral |
| **Provider staking** | Collateral-backed providers with reputation scoring |
| **Job lifecycle** | Submit → Assign → Execute → Complete → Settle |
| **TFUEL fees** | Pay-per-inference with configurable protocol fee |
| **Subchain-ready** | Configurable subchainId + mainChainBridge for isolation |

```
Model Registry: registerModel("Llama 3.1", "text", 0.01 TFUEL, 100 TFUEL collateral)

Job Lifecycle:
  User     → submitJob(modelId, inputHash) {payment}
       └── 0.5% fee → CoreRevenueSplitter
       └── Event: GPUJobRouted (ai-listener → EdgeCloud API)
  Relayer  → assignJob(jobId, provider)
       └── Provider must have sufficient stake
  EdgeCloud → executes inference (off-chain)
  Relayer  → completeJob(jobId, outputHash, latencyMs)
       └── Updates model metrics (rolling avg latency)
  Relayer  → settleJob(jobId, proof, nullifier)
       └── Provider receives payout
       └── Reputation +0.1% per success, -1% per failure
```

**Research notes:**
- Per Theta EdgeCloud docs (2026): GetStatus, SetPrice, GetJobs APIs. On-demand serverless GPU inference with dynamic routing. SDK: @thetalabs/theta-edgecloud.
- Per Theta Metachain: 1-2s finality, TFUEL gas, 1,000 wTHETA + 20,000 TFUEL per subchain validator.

### 14.4 Circuit Isolation Matrix

| Property | TAOCircuit | A2ACircuit | ThetaGPUCircuit |
|----------|-----------|-----------|-----------------|
| Circuit ID | `TAO_EVM_CIRCUIT` | `A2A_CIRCUIT` | `THETA_GPU_CIRCUIT` |
| State | Own tasks, pricing | Own agents, bids, channels | Own models, providers, jobs |
| Fee routing | → CoreRevenueSplitter | → CoreRevenueSplitter | → CoreRevenueSplitter |
| ZK verification | → ZKVerifierSP1 | → ZKVerifierSP1 (+ local nullifiers) | → ZKVerifierSP1 |
| Pausable | Independent | Independent | Independent |
| Off-chain handler | tao-handler.js | a2a-handler.js | gpu-handler.js |
| Default chains | Bittensor, Theta | All chains | Theta only |

---

## 15. Expansion Circuits (Step 3 — v1.62)

Building on the Core Layer (Step 1) and Priority Circuits (Step 2), Step 3 adds two expansion circuits that demonstrate the protocol's extensibility into private AI and decentralized compute leasing. Both circuits are fully isolated, pluggable to Core, and follow the same modular architecture as the priority circuits.

### 15.1 zkML Private Inference Circuit (ZKMLCircuit)

**Purpose:** Enable private ML model inference where model weights remain confidential while proving correctness on-chain via SP1 zero-knowledge proofs.

**Use case:** "ML-as-a-Service" where model IP is protected by ZK — model owners monetize inference without revealing proprietary weights.

| Feature | Implementation |
|---------|---------------|
| **Private model registry** | On-chain weight commitment (keccak256 of weights); architecture hash; owner-managed |
| **Authorized provers** | Model owners designate who can prove inference for their model |
| **Weight rotation** | Support for model retraining — update commitment without re-deploying |
| **Inference lifecycle** | Request → Prove (off-chain) → Verify (on-chain) → Settle |
| **Deadline enforcement** | Requester can claim refund if proof not delivered by deadline |
| **Dispute window** | Post-verification dispute period for re-verification |

```
Private Model Registration:
  Owner → registerModel(weightCommitment, archHash, description, price, publicArch)
       └── Model weights stay off-chain; only keccak256(weights) stored on-chain
       └── Owner auto-authorized as prover

Inference Flow:
  User  → requestInference(modelId, inputHash, deadline) {payment}
       └── 0.75% fee → CoreRevenueSplitter
       └── Event: InferenceRequested (ai-listener → authorized prover)
  Prover → runs model off-chain, generates SP1 proof:
       └── Private inputs: model weights, user input
       └── Public outputs: weightCommitment, inputHash, outputHash
  Prover → verifyInference(requestId, outputHash, weightCommitment, proof, nullifier)
       └── Checks: prover authorized, commitment matches, nullifier unused
       └── Model owner receives payment
  User  → claimRefund(requestId) [only if deadline expired without proof]
```

**Research notes:**
- Per SP1 docs (2026): Private inputs (model weights) are only known to the prover; public outputs are verified on-chain. Groth16 wrapping: ~260B proof, ~270K gas.
- RISC-V compilation allows arbitrary Rust ML inference code to be proven in ZK.
- Compressed/recursive proofs enable proving large models in chunks for scalability.

### 15.2 Akash/DePIN Compute Circuit (AkashCircuit)

**Purpose:** Decentralized GPU leasing via reverse-auction deployment management, inspired by Akash Network's marketplace model but generalized for any DePIN compute provider.

**Use case:** Tenants specify GPU requirements (via SDL), providers bid in a reverse auction, and leases are managed with per-block payments and ZK delivery attestation.

| Feature | Implementation |
|---------|---------------|
| **GPU spec catalog** | On-chain registry of GPU specs (vendor, model, VRAM, base price) |
| **Deployment creation** | Tenants deposit escrow and specify requirements |
| **Reverse auction** | Providers bid ≤ tenant's max price; tenant accepts lowest bid |
| **Bid deposits** | Providers post deposits (returned when bid closes) |
| **Per-block lease payments** | Providers claim payment for blocks served |
| **Completion attestation** | SP1 proof of compute delivery for settlement |

```
GPU Spec: registerGPUSpec("nvidia", "h100-80gb", 81920 MB, 0.5 ETH/hr base)

Deployment Flow:
  Tenant   → createDeployment(specId, sdlHash, maxPricePerBlock, duration) {escrow}
          └── 0.5% fee → CoreRevenueSplitter
          └── Event: DeploymentCreated (ai-listener → Akash SDK)
  Provider → placeBid(deploymentId, pricePerBlock) {deposit}
          └── Must bid ≤ maxPricePerBlock; deposit ≥ 0.01 ETH
  Provider → placeBid(...) [multiple providers compete]
  Tenant   → acceptBid(bidId) [creates lease, returns losing deposits]

Lease Lifecycle:
  Provider → claimLeasePayment(leaseId, blocksServed) [periodic]
  Relayer  → completeLease(leaseId, proof, nullifier) [SP1 attestation]
          └── Remaining escrow refunded to tenant
  Tenant   → cancelDeployment(deploymentId) [before lease, refunds all]
```

**Research notes:**
- Per Akash Network docs (2026): SDL defines GPU specs (vendor, model, VRAM); reverse auction where tenants set max price. Lease payments via deposit-and-withdraw.
- AKT 2.0: 4% AKT take rate, 20% USDC take rate for network revenue.
- IBC integration: AKT/USDC transfers via Cosmos IBC channels.
- GPU support: NVIDIA H100, A100, RTX 30/40-series; AMD MI300X.

### 15.3 Expanded Circuit Isolation Matrix

| Property | ZKMLCircuit | AkashCircuit |
|----------|------------|-------------|
| Circuit ID | `ZKML_CIRCUIT` | `AKASH_DEPIN_CIRCUIT` |
| State | Own models, requests, provers | Own deployments, bids, leases |
| Fee routing | → CoreRevenueSplitter (0.75%) | → CoreRevenueSplitter (0.5%) |
| ZK verification | → ZKVerifierSP1 (+ weight commitment check) | → ZKVerifierSP1 (delivery attestation) |
| Pausable | Independent | Independent |
| Off-chain handler | zkml-handler.js | akash-handler.js |
| Default chains | All (model owners on any EVM chain) | All (tenants on any EVM chain) |

### 15.4 Test Coverage Summary

| Circuit | Tests | Key Scenarios |
|---------|-------|---------------|
| TAOCircuit | 15 | Multi-user tasks, double-settle rejection, swap fee accumulation, multi-net stress (10 concurrent) |
| A2ACircuit | 15 | Multi-agent discovery, bid settle with proof, channel exhaustion, nullifier replay, 3-agent stress |
| ThetaGPUCircuit | 15 | Model CRUD, provider staking/slashing, full job lifecycle, insufficient stake rejection, 10-job stress |
| ZKMLCircuit | 15 | Private model registration, weight rotation, authorized prover, commitment mismatch, deadline refund |
| AkashCircuit | 15 | GPU spec catalog, reverse auction, bid withdrawal, per-block lease claims, completion attestation |

---

## 16. Further Expansion Circuits (Step 4 — v1.63)

Step 4 adds two frontier circuits that extend the protocol into autonomous DeFi and verifiable robotics. Both circuits maintain full isolation and plug into the Core Layer identically to all prior circuits.

### 16.1 Autonomous AI Vaults Circuit (AutonomousVaults)

**Purpose:** AI-driven, tokenized yield strategies where agent swarms manage vaults with ZK-verified rebalancing. Strategy logic remains private (off-chain); only optimization proofs are verified on-chain.

**Use case:** "Vibecoding a quant strategy" — users describe strategies in natural language; AI agents backtest across 10K+ Monte Carlo scenarios, deploy to non-custodial vaults, and rebalance autonomously.

| Feature | Implementation |
|---------|---------------|
| **Strategy registry** | Private logic commitment (keccak256); public description/category |
| **Vault lifecycle** | Create → Deposit → Rebalance → Withdraw; proportional share accounting |
| **ZK rebalance** | SP1 proves optimal allocation without revealing strategy signals |
| **Performance fees** | High water mark tracking; up to 20% strategist fee on profits above HWM |
| **Vault admin** | Pause/resume/close; strategist or admin only |

```
Strategy Flow:
  Strategist → registerStrategy(logicCommitment, description, category, perfFeeBps)
  Strategist → createVault(strategyId)

User Flow:
  User → deposit(vaultId) {payment}
       └── 0.5% protocol fee → CoreRevenueSplitter
       └── Shares minted proportional to NAV
  User → withdraw(vaultId, shares)
       └── Pro-rata NAV returned

Rebalance Flow:
  AI Swarm → computes optimal allocation off-chain (Monte Carlo sim)
  Keeper   → rebalance(vaultId, allocationHash, newNav, proof, nullifier)
       └── SP1 proof: "Given strategy S and market M, allocation A is optimal"
       └── Performance fee charged on profit above high water mark
       └── Event: VaultRebalanced (ai-listener tracks)
```

**Research notes:**
- Per Almanak (2026): 18 specialized AI agents collaborate on strategy lifecycle. $8.45M raised (Delphi Labs, HashKey). ERC-7540 composable vaults.
- Monte Carlo simulations (10K+ scenarios) optimize allocations; strategy types span yield, arbitrage, LP, cross-chain rebalancing.
- Human-AI hybrid control: humans as pilots, AI handles research, coding, testing, deployment, monitoring.

### 16.2 Verifiable Agent Robotics Circuit (AgentRobotics)

**Purpose:** ZK-proven sim-to-real trajectory verification for robotic agents, with on-chain safety certification and a task marketplace for certified agents.

**Use case:** A warehouse robot proves in ZK that its navigation trajectory is collision-free and energy-optimal in a high-fidelity simulation, earning an on-chain safety certificate that unlocks real-world deployment tasks.

| Feature | Implementation |
|---------|---------------|
| **Simulation registry** | Environments with config hash, category, fidelity score |
| **Agent enrollment** | Policy commitment (private control logic); agent type classification |
| **Trajectory verification** | ZK proof of trajectory correctness; safety levels 1-5 |
| **Safety certificates** | Soulbound-like certs with expiry (policies degrade over time) |
| **Task marketplace** | Certified agents bid on real-world tasks; minimum cert level required |

```
Sim-to-Real Pipeline:
  Operator    → registerEnvironment(configHash, "Warehouse Nav v3", "navigation", 9200)
  AgentOwner  → registerAgent(policyCommitment, "manipulator")

Certification Flow:
  AgentOwner → submitTrajectory(agentId, envId, trajectoryHash, safetyHash, deadline) {payment}
       └── 1% cert fee → CoreRevenueSplitter
       └── Event: TrajectorySubmitted (ai-listener → sim engine)
  SimEngine  → runs trajectory in digital twin (60Hz sync)
  Verifier   → verifyTrajectory(trajectoryId, safetyLevel, certDuration, proof, nullifier)
       └── SP1 proof: "Agent A in sim S satisfies safety C" (policy stays private)
       └── Safety cert issued with expiry (per NRN: policies degrade)

Task Marketplace:
  Requester → createTask(envId, minCertLevel, deadline) {payment}
       └── 0.5% task fee → CoreRevenueSplitter
  Operator  → assignTask(taskId, agentId) [must meet cert level]
  Operator  → completeTask(taskId) → agent owner paid
```

**Research notes:**
- Per NRN Agents (2026): Robotics data scarcity (2.4M episodes vs 15T text tokens). Sim-to-real gap addressed via domain randomization, residual learning, and digital twins syncing at 60Hz.
- Verifiable compositional frameworks decompose complex tasks into subtasks with mathematical interfaces for independent verification.
- Certificates expire because robotic policies degrade under real-world conditions — continuous recertification required.

### 16.3 Complete Circuit Isolation Matrix

| Property | AutonomousVaults | AgentRobotics |
|----------|-----------------|---------------|
| Circuit ID | `AUTONOMOUS_VAULTS_CIRCUIT` | `AGENT_ROBOTICS_CIRCUIT` |
| State | Own strategies, vaults, positions | Own environments, agents, trajectories, certs, tasks |
| Fee routing | → CoreRevenueSplitter (0.5% deposit) | → CoreRevenueSplitter (1% cert + 0.5% task) |
| ZK verification | → ZKVerifierSP1 (rebalance optimality) | → ZKVerifierSP1 (trajectory safety) |
| Pausable | Independent (+ per-vault pause) | Independent |
| Off-chain handler | vaults-handler.js | robotics-handler.js |
| Default chains | All (vaults on any EVM chain) | All (sim envs can target any chain) |

### 16.4 Complete Test Coverage (Step 4)

| Category | Unit Tests | Integration Tests | Total |
|----------|-----------|-------------------|-------|
| TAOCircuit | 15 | — | 15 |
| A2ACircuit | 15 | — | 15 |
| ThetaGPUCircuit | 15 | — | 15 |
| ZKMLCircuit | 15 | — | 15 |
| AkashCircuit | 15 | — | 15 |
| AutonomousVaults | 15 | — | 15 |
| AgentRobotics | 15 | — | 15 |
| **Multi-Circuit E2E** | — | **20** | **20** |
| **Total** | **105** | **20** | **125** |

Integration test categories:
- Deployment verification (all 7 circuits deploy with unique IDs)
- Fee aggregation across circuits → shared CoreRevenueSplitter
- Circuit state isolation (counters, agents, models independent)
- Nullifier independence (same nullifier valid across different circuits)
- Cross-circuit pipelines (TAO→GPU, A2A→bid, Vault deposit→rebalance→withdraw, Robotics full lifecycle)
- Multi-user concurrent stress (10+ ops across 3+ circuits)
- Pause isolation (pausing one circuit does not affect others)
- Access control isolation (roles on one circuit do not grant access to others)

---

## Section 17: Final Expansion Circuits (Step 5 — v1.64)

Step 5 completes the XFuel Protocol circuit ecosystem with two final expansion circuits — **Data Ownership Hubs** and **Yield Optimization** — alongside a comprehensive **system optimization and gas profiling** suite across all 9 circuits.

### 17.1 Data Ownership Hubs (`DataHubs.sol`)

**Purpose:** Decentralized data contribution with ZK-verified provenance attestation, tokenized dataset access, and DAO-governed data hubs.

**Research foundations:**

| Source | Key Finding | Applied In |
|--------|------------|------------|
| **Vana** (vana.org, 2026) | First open protocol for AI data sovereignty; DataDAOs pool user data with cryptographic ownership; VRC-20 tokens for validated contributions; three-layer architecture (Liquidity, Portability, Vana Chain) | Hub creation, contribution model, quality-weighted shares |
| **Grass** (grass.io, 2026) | DePIN with 8.5M MAU; 90-100TB/day web-scraped data; sovereign data rollup with ZK proofs for provenance; $33M annualized revenue | ZK provenance verification, data integrity model |

**Architecture:**

```
DataHubs Circuit Flow:
  1. createHub()       → DAO creator defines governance, quality threshold, access price
  2. contributeData()  → Contributor submits encrypted data commitment + provenance hash
  3. validateContribution() → VALIDATOR verifies via SP1 proof:
       "Data D from source S satisfies quality Q and provenance P"
       Quality-weighted shares assigned (quality score 0-10000)
  4. purchaseAccess()  → Consumer pays access price; 0.5% protocol fee → CoreRevenueSplitter
  5. claimRewards()    → Contributors claim proportional revenue (quality-weighted)
```

**Feature table:**

| Feature | Implementation |
|---------|---------------|
| Hub creation | Open — anyone can create a DataDAO hub |
| Data contribution | Off-chain storage; on-chain commitment + provenance hash |
| ZK validation | SP1 proves data quality + source authenticity |
| Quality scoring | 0-10000 scale; weighted shares for reward distribution |
| Access grants | Time-limited; fee split between protocol + hub treasury |
| Contributor rewards | Proportional to quality-weighted shares |
| Protocol fee | 0.5% on access purchases → CoreRevenueSplitter |
| Contract | `circuits/data-hubs/DataHubs.sol` |
| Handler | `circuits/data-hubs/datahubs-handler.js` |
| Tests | 15 Hardhat tests |

### 17.2 Yield Optimization (`YieldCircuit.sol`)

**Purpose:** Generalized multi-pool yield optimization with ZK-verified rebalancing, concentrated-liquidity awareness, and cross-chain routing.

**Research foundations:**

| Source | Key Finding | Applied In |
|--------|------------|------------|
| **Osmosis** (osmosis.zone, 2026) | Concentrated liquidity ("supercharged pools"): 200-300x capital efficiency; geometric tick spacing; tracks L and √P instead of reserves; uptime-based incentives | Pool registry, CL-aware allocation hashes, rebalance proofs |

**Architecture:**

```
YieldCircuit Flow:
  1. registerPool()        → OPTIMIZER adds yield pools (protocol, chain, config, APY)
  2. openPosition()        → User deposits ETH; 0.5% fee → CoreRevenueSplitter
  3. rebalancePosition()   → KEEPER submits SP1 proof:
       "Rebalance R from allocation A to A' maximizes yield Y across registered pools"
       yield_captured accrued to position
  4. harvestYield()        → User claims pending yield; 1% harvest fee → CoreRevenueSplitter
  5. closePosition()       → User exits; remaining value + pending yield returned
```

**Feature table:**

| Feature | Implementation |
|---------|---------------|
| Pool registry | Multi-protocol, multi-chain (Osmosis, Uniswap, Curve, Aave, etc.) |
| CL awareness | Config hash encodes tick ranges and concentrated liquidity params |
| ZK rebalance | SP1 proves optimal reallocation without revealing routing signals |
| Yield harvest | Separate harvest step with 1% performance fee |
| Position management | Open/close with proportional value tracking |
| Protocol fees | 0.5% deposit fee + 1% harvest fee → CoreRevenueSplitter |
| Contract | `circuits/yield-optimization/YieldCircuit.sol` |
| Handler | `circuits/yield-optimization/yield-handler.js` |
| Tests | 15 Hardhat tests |

### 17.3 System Optimization & Gas Profiling

Step 5 introduces a dedicated gas profiling test suite (`test/optimizations/GasProfile.system.test.cjs`) that validates measurable gas budgets across all 9 circuits.

**Gas profiling results (Hardhat, optimizer 200 runs, viaIR):**

| Operation | Circuit | Gas Target | Measured | Status |
|-----------|---------|-----------|----------|--------|
| `settleTask` | TAOCircuit | <100K | ~68K | **Pass** |
| `rebalance` | AutonomousVaults | <350K | ~292K | **Pass** |
| `rebalancePosition` | YieldCircuit | <300K | ~226K | **Pass** |
| `submitTask` | TAOCircuit | <350K | ~303K | **Pass** |
| `deposit` | AutonomousVaults | <350K | ~296K | **Pass** |
| `openPosition` | YieldCircuit | <350K | ~318K | **Pass** |
| `purchaseAccess` | DataHubs | <300K | ~297K | **Pass** |
| Deploy (all 9) | All | <3M each | 2.1M–2.9M | **Pass** |

**Deployment cost comparison:**

| Circuit | Deploy Gas | % of Block Limit |
|---------|-----------|-----------------|
| TAOCircuit | 2,131K | 7.1% |
| A2ACircuit | 2,703K | 9.0% |
| ThetaGPUCircuit | 2,892K | 9.6% |
| ZKMLCircuit | 2,255K | 7.5% |
| AkashCircuit | 2,759K | 9.2% |
| AutonomousVaults | 2,461K | 8.2% |
| AgentRobotics | 2,829K | 9.4% |
| DataHubs | 2,291K | 7.6% |
| YieldCircuit | 2,177K | 7.3% |

**Scaling validation:**
- 5 consecutive TAO task submissions: <1.2x gas ratio (linear scaling confirmed)
- 5 consecutive yield position opens: <1.2x gas ratio (independent storage slots)

### 17.4 Complete Test Coverage (Step 5)

| Category | Unit Tests | Integration Tests | Optimization Tests | Total |
|----------|-----------|-------------------|-------------------|-------|
| TAOCircuit | 15 | — | — | 15 |
| A2ACircuit | 15 | — | — | 15 |
| ThetaGPUCircuit | 15 | — | — | 15 |
| ZKMLCircuit | 15 | — | — | 15 |
| AkashCircuit | 15 | — | — | 15 |
| AutonomousVaults | 15 | — | — | 15 |
| AgentRobotics | 15 | — | — | 15 |
| DataHubs | 15 | — | — | 15 |
| YieldCircuit | 15 | — | — | 15 |
| **Multi-Circuit E2E** | — | **20** | — | **20** |
| **Gas Profiling** | — | — | **10** | **10** |
| **Total** | **135** | **20** | **10** | **165** |

---

## Section 18: Expansion Circuit — NEAR Agents + Deployment (Step 6 — v1.65)

Step 6 adds deployment infrastructure, a NEAR-inspired autonomous agent circuit, and a grant application template for ecosystem funding.

### 18.1 NEAR Agents (`NearAgents.sol`)

**Purpose:** Usability-focused autonomous AI agent marketplace with intent-based task execution, competitive bidding, ZK-verified settlement, and on-chain reputation.

**Research foundations:**

| Source | Key Finding | Applied In |
|--------|------------|------------|
| **NEAR Shade Agents** (docs.near.org, 2026) | TEE-based autonomous agents with persistent key management; non-custodial; code hash verification + remote attestation | Agent registry, attestation hashes |
| **NEAR AI Agent Market** (near.ai, Feb 2026) | Decentralized marketplace: agents bid on tasks, execute, receive payment; extends Intents from capital markets to natural language | Intent submission, bidding, settlement flow |
| **NEAR Chain Signatures** (2026) | MPC cross-chain signing secured by NEAR validators + Eigenlayer restakers; BTC, ETH, Cosmos, DOGE, XRP support | Chain-abstracted intent execution |
| **NEAR Chain Abstraction** (near.org, 2026) | Users define outcomes, AI automates execution; Omnibridge for trustless transfers; Multichain Gas Relayer | Intent model (outcome-based, not execution-path) |

**Architecture:**

```
NearAgents Circuit Flow:
  1. registerAgent()   → Agent publishes capability hash + TEE attestation
  2. submitIntent()    → User defines outcome + constraints + budget (ETH)
  3. placeBid()        → Agents bid with price + approach hash (private)
  4. assignIntent()    → SOLVER selects winning bid
  5. settleIntent()    → SOLVER submits SP1 proof:
       "Agent A executed intent I correctly, producing result R"
       → 0.5% fee → CoreRevenueSplitter
       → Agent paid (agreed price - fee)
       → Excess budget refunded to requester
       → Agent reputation += qualityScore
```

**Feature table:**

| Feature | Implementation |
|---------|---------------|
| Agent registry | Capability hash + TEE attestation; deactivation support |
| Intent model | Outcome-based with constraints; chain-abstracted |
| Competitive bidding | Multiple agents bid; price capped at intent budget |
| ZK settlement | SP1 proves execution correctness without revealing strategy |
| Reputation | Cumulative quality-weighted score; updated per settlement |
| Refund logic | Excess budget (intent budget - agreed price) auto-refunded |
| Protocol fee | 0.5% on agreed settlement price → CoreRevenueSplitter |
| Contract | `circuits/near-agents/NearAgents.sol` |
| Handler | `circuits/near-agents/near-handler.js` |
| Tests | 15+ Hardhat tests |

### 18.2 Deployment Infrastructure

Step 6 introduces a `deploy/` folder with Hardhat deployment scripts for testnet and mainnet:

| Script | Purpose | Command |
|--------|---------|---------|
| `deploy-core.cjs` | Deploy Core Layer (RevenueSplitter + ZKVerifier) | `npx hardhat run deploy/deploy-core.cjs --network <network>` |
| `deploy-circuits.cjs` | Deploy all 10 circuits + grant CIRCUIT_ROLE | `npx hardhat run deploy/deploy-circuits.cjs --network <network>` |
| `deploy-full.cjs` | One-shot full stack (Core + Circuits + roles) | `npx hardhat run deploy/deploy-full.cjs --network <network>` |

**Supported networks:**
- `hardhat` — Local testing
- `theta-testnet` — Theta Testnet (Chain ID 365)
- `theta-mainnet` — Theta Mainnet (Chain ID 361)

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | Private key of deployer |
| `ADMIN_ADDRESS` | Admin for role grants (defaults to deployer) |
| `BBB_ADDRESS` | Buyback-Burn recipient |
| `LP_ADDRESS` | Liquidity Provision recipient |
| `STAKER_ADDRESS` | Staker Rewards recipient |
| `TREASURY_ADDRESS` | Protocol Treasury |
| `REVENUE_SPLITTER_ADDRESS` | (circuits script) Deployed RevenueSplitter address |
| `ZK_VERIFIER_ADDRESS` | (circuits script) Deployed ZKVerifier address |

### 18.3 Grant Application Template

A comprehensive `grant-template.md` provides a structured template for $100K+ ecosystem grant applications (OpenTensor, NEAR, Akash, Theta, etc.) with sections covering: project overview, technical architecture, milestones, team, budget, ecosystem impact, risks, and open-source commitment.

### 18.4 Deployment Test Coverage (Step 6)

| Category | Unit Tests | Integration Tests | System Tests | Total |
|----------|-----------|-------------------|-------------|-------|
| TAOCircuit | 15 | — | — | 15 |
| A2ACircuit | 15 | — | — | 15 |
| ThetaGPUCircuit | 15 | — | — | 15 |
| ZKMLCircuit | 15 | — | — | 15 |
| AkashCircuit | 15 | — | — | 15 |
| AutonomousVaults | 15 | — | — | 15 |
| AgentRobotics | 15 | — | — | 15 |
| DataHubs | 15 | — | — | 15 |
| YieldCircuit | 15 | — | — | 15 |
| NearAgents | 15 | — | — | 15 |
| **Multi-Circuit E2E** | — | **20** | — | **20** |
| **Gas Profiling** | — | — | **10** | **10** |
| **Deployment Validation** | — | — | **10** | **10** |
| **Total** | **150** | **20** | **20** | **190** |

---

## Section 19: Solana AI Bridge + System Hardening (Step 7 — v1.70)

### 19.1 Overview

Step 7 expands XFuel Protocol with four major deliverables:

1. **Solana AI Bridge Circuit** — EVM-side anchor for Solana AI powerhouses (Render Network, io.net, Grass, SendAI) via Wormhole/CCIP cross-chain messaging with ZK-verified settlement.
2. **System Hardening** — 20 load/chaos tests validating 500+ concurrent operations across 5 circuits with gas stability under <100K for settlements.
3. **Testnet Deployment** — Automated deployment script for Theta testnet + all 11 circuits.
4. **Grant/Narrative Package** — Executive summary, pitch deck skeleton, and 3 specialized grant templates (Solana, TAO, General).

### 19.2 Solana AI Bridge Circuit

#### Purpose

The Solana ecosystem hosts the largest concentration of decentralized AI compute infrastructure. The SolanaAIBridge circuit connects this compute to any EVM chain:

| Solana AI Project | Type | Scale | XFuel Integration |
|------------------|------|-------|-------------------|
| **Render Network** | GPU Rendering | 5,600 RTX 5090 nodes | Provider registry + task settlement |
| **io.net** | GPU Compute | 1M+ pooled GPUs, 750K inferences | Decentralized inference pipeline |
| **Grass** | Data Collection | 8.5M MAU, 90-100TB/day | ZK-provenance data attestation |
| **SendAI** | AI Agents | Solana-native framework | Agent task execution + verification |

#### Architecture

```
EVM Chain (Ethereum/Theta/BSC)          Solana (SVM)
┌─────────────────────────┐             ┌──────────────────────┐
│ SolanaAIBridge.sol      │  Wormhole   │ Render Network       │
│ ├─ registerProvider()   │  VAA relay  │ io.net               │
│ ├─ submitTask()         │────────────→│ Grass                │
│ ├─ bridgeTask()         │             │ SendAI               │
│ ├─ settleTask()         │←────────────│                      │
│ └─ cancelTask()         │  ZK Proof   │ SP1 computation      │
│                         │  + result   │ attestation          │
│ CoreRevenueSplitter ←───│             └──────────────────────┘
└─────────────────────────┘
```

**Cross-chain messaging**: Wormhole Guardian-attested VAAs relay task parameters to Solana. SP1 zkVM generates proofs of Solana-side computation for EVM verification.

#### Key Features

| Feature | Description |
|---------|-------------|
| Provider Registry | Solana AI providers register with capability profiles + Solana pubkeys |
| Task Submission | Users submit AI tasks with escrowed payment on EVM |
| Wormhole Bridge | Tasks relayed to Solana via Guardian-attested VAAs |
| ZK Settlement | SP1 proves correct computation; payment released on EVM |
| Protocol Fee | 0.75% fee to CoreRevenueSplitter (configurable, max 3%) |
| Provider Reputation | Quality-weighted reputation updated on settlement |
| Nullifier Protection | Prevents proof replay across settlements |

#### Gas Profile

| Operation | Gas | Target |
|-----------|-----|--------|
| `registerProvider` | ~194K | <200K |
| `submitTask` | ~229K | <250K |
| `bridgeTask` | ~128K | <150K |
| `settleTask` | ~327K | <400K |
| Deploy | ~2.08M | <3M |

### 19.3 System Hardening

#### Load/Chaos Test Suite (20 Tests)

The `test/hardening/LoadChaos.hardening.test.cjs` validates protocol resilience under production-like stress:

| Category | Tests | Operations | Result |
|----------|-------|-----------|--------|
| TAO high-volume | 2 | 50 rapid tasks + 10 settlements | Gas ratio <1.15x |
| Yield load | 2 | 30 parallel positions + 20 rebalances | All unique nullifiers |
| NEAR Agents load | 2 | 20 agents + 15 intents with cancellation | No fund loss |
| Solana pipeline | 1 | 20 submit→bridge→settle cycles | 100% completion |
| Cross-circuit concurrent | 2 | 30 ops across TAO+Yield+NEAR | No interference |
| Chaos: pause/unpause | 3 | Mid-stream circuit isolation | Full isolation |
| Nullifier collision | 2 | 100+ unique nullifiers; duplicate rejection | Zero collisions |
| Fee accounting | 2 | 20-op fee totals; 25 DataHubs contributions | Exact match |
| Gas stability | 2 | TAO <100K; Solana <400K under load | Confirmed |
| Full stress | 2 | 5 users × 5 circuits × 2 ops = 50 total | Splitter consistency |

**Key measurements confirmed:**
- TAO `settleTask`: **~68K gas** (well under 100K target)
- Solana `settleTask`: **~327K gas** (under 400K target)
- Gas ratio across 10 consecutive settlements: **<1.15x** (linear scaling)
- 100 unique nullifiers processed without collision
- Circuit pause isolation verified across 5 circuits simultaneously

### 19.4 Testnet Deployment

The `deploy/testnet.cjs` script automates full-stack deployment to Theta testnet:

```
Phase 1: Core Layer → CoreRevenueSplitter + ZKVerifierSP1
Phase 2: 11 Circuits → TAO, A2A, GPU, zkML, Akash, Vaults, Robotics, DataHubs, Yield, NEAR, Solana
Phase 3: Role Configuration → CIRCUIT_ROLE granted to all 11 circuits
Phase 4: Smoke Test → TAOCircuit.CIRCUIT_ID verification
Output: JSON deployment manifest with all contract addresses
```

### 19.5 Grant/Narrative Package

| Document | Purpose | Location |
|----------|---------|----------|
| Executive Summary | 1-2 page protocol overview for investors/partners | `exec-summary.md` |
| Pitch Deck | 12-15 slide presentation skeleton | `pitch-deck.md` |
| Solana Grant | Solana Foundation / Superteam template ($100-250K) | `grant-templates/solana-grant.md` |
| TAO Grant | OpenTensor / Bittensor subnet incentives ($100-200K) | `grant-templates/tao-grant.md` |
| General Grant | Customizable ecosystem grant template ($50-300K) | `grant-templates/general-grant.md` |

### 19.6 Test Coverage Matrix (Step 7)

| Suite | Tests | Status |
|-------|-------|--------|
| Solana AI Bridge unit tests | 14 | PASS |
| Load/Chaos hardening tests | 20 | PASS |
| **Step 7 total new tests** | **34** | **ALL PASS** |
| **Cumulative protocol tests** | **224** | **ALL PASS** |

---

## Section 20: Mainnet Deployment + Community Infrastructure (Step 8 — v1.75)

### 20.1 Overview

Step 8 delivers production readiness and community infrastructure:

1. **Mainnet Deployment Script** — Full-stack production deployment to Theta Mainnet (chain ID 361) with safety checks, admin transfer, and smoke tests.
2. **Community Tools** — Discord bot for veXF governance simulation and X/Twitter campaign templates.
3. **Funding Infrastructure** — Updated grant templates, believer round guide with micro-commitment vesting model.

### 20.2 Mainnet Deployment (`deploy/mainnet.cjs`)

#### Production Safety Features

The mainnet deployment script implements six phases with production-grade safety:

| Phase | Action | Safety Check |
|-------|--------|-------------|
| 0. Pre-flight | Balance + network verification | Requires 50+ TFUEL; confirms chain ID 361 |
| 1. Core Layer | Deploy CoreRevenueSplitter + ZKVerifierSP1 + veXFGovernance | Uses ADMIN_ADDRESS (multisig), not deployer |
| 2. Circuits | Deploy all 11 circuits with ADMIN as admin | Each circuit gets production admin address |
| 3. Roles | Grant CIRCUIT_ROLE to all 11 on splitter | Automated role configuration |
| 4. Admin Transfer | Transfer DEFAULT_ADMIN_ROLE → multisig | Deployer renounces admin role |
| 5. Smoke Tests | Verify CIRCUIT_ID on all contracts | Catches deployment failures before announcement |
| 6. Manifest | Write JSON manifest to `deploy/manifests/` | Timestamped deployment record |

#### Theta Mainnet Configuration

Per Theta Docs (thetatoken.org):
- **Chain ID**: 361
- **RPC**: `https://eth-rpc-api.thetatoken.org/rpc`
- **Gas Token**: TFUEL
- **Explorer**: `https://explorer.thetatoken.org`
- **EVM Compatibility**: Constantinople + Istanbul

#### Post-Deployment Checklist

1. Verify all contracts on Theta explorer
2. Confirm multisig admin has DEFAULT_ADMIN_ROLE on all contracts
3. Configure RELAYER_ROLE / SOLVER_ROLE on each circuit
4. Set production SP1 Gateway address (replace mock)
5. Run deployment validation tests
6. Announce deployment to community

### 20.3 Community Infrastructure

#### Discord Bot (`community/bot.cjs`)

Interactive Discord bot with five slash command groups:

| Command | Description |
|---------|-------------|
| `/vexf simulate` | Lock amount + duration → voting power, multiplier, decay curve |
| `/vexf apy` | Estimate staking APY at given protocol revenue levels |
| `/vexf tiers` | Display all lock tiers and multipliers |
| `/circuit info` | Show details for any of the 11 circuits |
| `/circuit list` | List all circuits with ecosystems and fees |
| `/fee calculate` | Split any fee amount into 30/30/25/15 distribution |
| `/protocol stats` | Protocol overview (circuits, tests, gas, ZK backend) |

**veXF Simulation Engine** (mirrors veXFGovernance.sol):
- MIN_LOCK: 182 days (~26 weeks)
- MAX_LOCK: 1,095 days (3 years)
- Multiplier: 3 × (lockDays / 1095) — linear scaling
- Voting Power: amount × multiplier — linear decay over time
- Yield Boost: 1 + (multiplier - 1) × 0.5

**Simulation mode** runs without Discord token for local testing.

#### X Campaign Templates (`community/x-campaign-template.md`)

Five ready-to-use campaign templates:

| Campaign | Format | Use Case |
|----------|--------|----------|
| Mainnet Announcement | 8-tweet thread | Deploy day |
| Grant Win | Single + quote tweet | After receiving grant |
| Community Milestone | 5-tweet thread | Hitting test/user milestones |
| Weekly Dev Update | Single tweet | Every Friday |
| veXF Governance Launch | 6-tweet thread | Governance activation |

### 20.4 Funding Infrastructure

#### Believer Round Guide (`believer-guide.md`)

Community-first micro-commitment funding model:

| Parameter | Value |
|-----------|-------|
| Target Raise | $250K – $500K |
| Min Commitment | $100 |
| Max Commitment | $5,000 per wallet |
| Cliff | 3 months |
| Linear Vest | 12 months |
| Full Unlock | 15 months total |

**Commitment Tiers:**
- **Seed** ($100-$499): Discord role, early access
- **Cultivator** ($500-$1,999): 5% veXF bonus, monthly AMA
- **Architect** ($2,000-$5,000): 10% veXF bonus, direct team channel

**Investor Protections:**
- On-chain vesting contracts (verified, immutable)
- 6-month refund mechanism if TGE does not occur
- $5,000 per-wallet cap (anti-whale)

#### Updated Grant Templates

Three specialized templates updated with mainnet traction data:

| Template | Target | Status Updates |
|----------|--------|---------------|
| `solana-grant.md` | Solana Foundation / Superteam | Added traction section (224+ tests, mainnet deployed) |
| `tao-grant.md` | OpenTensor Foundation | Added TAO-specific metrics (68K gas, 100 nullifier load test) |
| `general-grant.md` | Any ecosystem | Added mainnet deployment, community tools, believer guide refs |

---

## Section 21: Mainnet Monitoring + Believer Round Execution (Step 9 — v1.80)

### 21.1 Overview

Step 9 completes production-readiness with three pillars:

1. **Mainnet Monitoring** — ThetaScan.io API integration for post-deploy health checks, contract verification, and continuous monitoring.
2. **BelieverRound Smart Contract** — Production-grade vesting contract with cliff + linear release, anti-whale caps, and on-chain refund protection.
3. **Grant Finalization** — All 3 specialized grant templates elevated to submit-ready status with full traction data.

### 21.2 Enhanced Mainnet Deployment (`deploy/mainnet.cjs` v2)

The mainnet script now includes eight phases (up from six):

| Phase | Action | New in v2 |
|-------|--------|-----------|
| 0. Pre-flight | Balance + network verification | — |
| 1. Core Layer | Deploy CoreRevenueSplitter + ZKVerifier + veXFGovernance | — |
| 2. Circuits | Deploy all 11 circuits | — |
| 2b. BelieverRound | Deploy vesting contract with configurable caps | **New** |
| 3. Roles | Grant CIRCUIT_ROLE to all 11 on splitter | — |
| 4. Admin Transfer | Transfer DEFAULT_ADMIN_ROLE → multisig | — |
| 5. Smoke Tests | Verify CIRCUIT_ID + splitter shares | — |
| 6. Manifest | Write JSON manifest | — |
| 7. Health Checks | On-chain code verification + ThetaScan API | **New** |
| 8. Continuous Monitoring | Optional polling loop for contract health | **New** |

#### ThetaScan.io API Integration

Per ThetaScan Developer API (thetascan.io/document/):

| Endpoint | Purpose |
|----------|---------|
| `/api/balance/:address` | Deployer and contract balance checks |
| `/api/contract/:address` | Contract code verification |
| `/api/transaction/:hash` | Transaction confirmation |

**Rate limit**: 1-2 calls/second. Health checks iterate all 14 contracts with code verification and balance reads.

#### Continuous Monitoring

When `ENABLE_MONITORING=true` is set, the script enters a persistent monitoring loop:
- Polls all deployed contracts at configurable intervals
- Verifies on-chain code presence and balance
- ThetaScan API cross-reference (on real network)
- Logs health status per cycle

### 21.3 BelieverRound Smart Contract (`believer/BelieverRound.sol`)

#### Architecture

```
Commit Phase           TGE              Cliff (90d)     Linear Vest (365d)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
│  commit() ──→ TFUEL  │  triggerTGE()   │  0% claimable │  ~8.33%/month  │
│  per-wallet cap      │  XF deposited   │  claim()=0    │  claim()>0     │
│  anti-whale          │  clock starts   │               │  → full @ 15mo │
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
                                         │  If no TGE within 180d:
                                         │  requestRefund() → full TFUEL refund
```

#### Key Parameters

| Parameter | Value |
|-----------|-------|
| Min commitment | 0.01 ETH/TFUEL |
| Max per wallet | Configurable (default 5 ETH) |
| Hard cap | Configurable (default 500 ETH) |
| Token price | Configurable (numerator/denominator) |
| Cliff | 90 days (3 months) |
| Vesting | 365 days (12 months linear) |
| Total unlock | 455 days (15 months) |
| Refund deadline | 180 days from round open |

#### Security Features

- **OpenZeppelin AccessControl** — role-based admin + operator separation
- **ReentrancyGuard** — prevents reentrancy on commit, claim, refund
- **Pausable** — emergency pause capability
- **SafeERC20** — safe token transfers for XF distribution
- **Immutable vesting** — no admin can modify vesting schedule post-TGE
- **On-chain refund** — automatic refund if TGE misses 180-day deadline

#### Gas Profile

| Operation | Gas |
|-----------|-----|
| commit() | ~45K – 123K |
| closeRound() | ~74K |
| triggerTGE() | ~117K |
| claim() | ~63K – 139K |
| requestRefund() | ~44K |
| withdrawFunds() | ~37K |

#### Test Suite (16 tests)

| Category | Tests | Coverage |
|----------|-------|---------|
| Commitment Phase | 6 | Min/max validation, wallet caps, hard cap, multi-believer |
| Round Management | 2 | Close round, reject post-close commits |
| TGE & Vesting | 5 | Token allocation, cliff, linear vesting, partial claims, full unlock |
| Refund Safety | 2 | Deadline enforcement, refund execution |
| Admin | 1 | Fund withdrawal post-TGE |

### 21.4 Grant Submission Status

All three specialized templates finalized to submit-ready:

| Template | Target Program | Key Enhancement |
|----------|---------------|-----------------|
| `solana-grant.md` | Solana Foundation / Superteam | Added evidence section (14 contracts, health monitoring, vesting) |
| `tao-grant.md` | OpenTensor Foundation | Added TAO performance appendix (68K gas, 50-task load test) |
| `general-grant.md` | Any ecosystem grants | Added deployment health table (14/14 verified), 31.9M total gas |

**Common updates across all templates:**
- Status upgraded to "SUBMIT-READY"
- Test count updated to 240+ (from 224+)
- Added BelieverRound as evidence of execution capability
- Added health monitoring as evidence of operational maturity
- Team section populated with role-based structure
- References expanded with deployment manifests and believer guide

---

## Section 22: Final Polish + Public Testnet Launch (Step 10 — v1.85)

### 22.1 Overview

Step 10 delivers the final production-ready state with four pillars:

1. **Gas Optimization Profiler** — Automated gas measurement and recommendation engine across all contracts.
2. **Public Testnet Dashboard** — Browser-based UI for monitoring deployed contracts, gas profiles, and believer round status.
3. **Believer Round Activation** — End-to-end deployment + campaign generation script.
4. **Grant Execution** — Submission tracker with milestone management and status reporting.

### 22.2 Gas Optimization (`polish/gas-opts.cjs`)

Comprehensive profiling script measuring:

| Category | Scope |
|----------|-------|
| Deployment gas | All 14 contracts (Core + 11 circuits + BelieverRound) |
| Operation gas | submitTask, settleTask, commit, claim, register |
| Budget comparison | Per-operation target budgets with PASS/OVER status |
| Recommendations | Actionable savings for over-budget operations |

**Key measurements (automated):**

| Operation | Gas | Target | Status |
|-----------|-----|--------|--------|
| TAOCircuit.submitTask | ~287K | — | Profiled |
| SolanaAIBridge.registerProvider | ~194K | — | Profiled |
| BelieverRound.commit | ~123K | 130K | PASS |
| BelieverRound.closeRound | ~74K | — | Profiled |
| Total deployment (14 contracts) | ~31M | — | Profiled |

**Output:** JSON report in `polish/gas-report-{timestamp}.json` with full per-contract breakdown.

### 22.3 Public Testnet Dashboard (`dashboard/index.html`)

Single-page monitoring UI with:

| Feature | Description |
|---------|-------------|
| RPC connection | Configurable endpoint (default: Theta Testnet 365) |
| Contract table | Address, status (LIVE/NO CODE), balance, deploy gas |
| Gas profile cards | Visual progress bars vs target budgets |
| Believer status | Round status, committed amount, believer count |
| Manifest loader | Upload deployment JSON to populate dashboard |
| Activity log | Timestamped connection and refresh events |

**Theta Testnet Configuration:**
- **RPC**: `https://eth-rpc-api-testnet.thetatoken.org/rpc`
- **Chain ID**: 365
- **Faucet**: Available via thirdweb (0.01 TFUEL/24h)
- **Explorer**: `https://testnet-explorer.thetatoken.org`

### 22.4 Believer Round Activation (`believer/activation-script.cjs`)

Five-phase activation workflow:

| Phase | Action | Verification |
|-------|--------|-------------|
| 1. Configuration | Load env vars, validate caps/price | Address + parameter display |
| 2. Deploy | Deploy BelieverRound.sol | Contract address + gas |
| 3. Smoke Tests | 7 checks: status, caps, cliff, commit, stats | 7/7 pass required |
| 4. Report | JSON activation report | `believer/activation-*.json` |
| 5. Campaign | Discord + X/Twitter copy | Copy-paste announcements |

**Campaign output includes:**
- Discord announcement with contract address and terms
- 3-tweet X/Twitter thread with commitment instructions
- Next-steps checklist for post-deployment

### 22.5 Grant Execution (`grant-templates/grant-tracker.cjs`)

Structured grant tracking across three programs:

| Program | Circuit | Amount | Status |
|---------|---------|--------|--------|
| Solana Foundation / Superteam | SolanaAIBridge | $150-250K | SUBMIT-READY |
| OpenTensor Foundation | TAOCircuit | $150-200K | SUBMIT-READY |
| General Ecosystem | Customizable | $50-300K | SUBMIT-READY |

**Tracker features:**
- Status table with next actions per grant
- Milestone breakdown (6 milestones each)
- Traction data auto-populated (240+ tests, 14 contracts)
- JSON report generation (`--report` flag)
- Total potential funding: $350K–$750K

---

## Section 23: Public Launch + Filecoin Expansion + Grant Execution (Step 11 — v1.90)

### 23.1 Filecoin Storage Circuit (Expansion #12)

The twelfth modular circuit bridges decentralized storage via ZK-verified Filecoin proofs.

**Contract:** `circuits/filecoin-storage/FilecoinStorage.sol`
**Handler:** `circuits/filecoin-storage/filecoin-handler.js`
**Tests:** `circuits/filecoin-storage/test/FilecoinStorage.test.cjs` (14 tests passing)

**Architecture:**
1. **Provider Registration** — Storage miners register with capacity, pricing, location, and tier.
2. **Deal Submission** — Clients create deals with CID, size, duration, and escrowed payment.
3. **Deal Activation** — Relayer confirms provider has accepted the deal.
4. **ZK-Verified Storage Proof** — SP1-verified WindowPoSt/SnapDeal proofs confirm storage.
5. **Settlement** — Payment released to provider minus 0.5% protocol fee.
6. **Cancellation** — Clients can cancel proposed deals for full refund.

**Research ties:**
- **Filecoin (filecoin.io):** 3,800+ storage providers, 20 EiB capacity, Proof-of-Replication + Proof-of-Spacetime.
- **Lighthouse (lighthouse.storage):** Perpetual storage on Filecoin/IPFS, pay-once-store-forever model.
- **Storacha (storacha.network):** Content-addressed data pipelines with UCAN-based authorization.

**Gas profile:**
| Operation | Gas | Notes |
|-----------|-----|-------|
| registerProvider | ~235K | Provider registration |
| createDeal | ~260K | Deal with escrow |
| activateDeal | ~53K | Relayer confirmation |
| submitStorageProof | ~226K | ZK-verified proof |
| settleDeal | ~201K | Payment + fee forwarding |
| cancelDeal | ~47K | Full refund |
| Deploy | ~2.25M | 7.5% of block limit |

### 23.2 Public Testnet Launch Orchestrator

**Script:** `launch/public-launch.cjs`

A 7-phase orchestrated deployment script that:
1. Pre-flight checks (balance, chain ID, compiler version)
2. Deploys Core Layer (CoreRevenueSplitter + ZKVerifierSP1)
3. Deploys all 12 circuits (including FilecoinStorage)
4. Deploys BelieverRound with configurable parameters
5. Grants CIRCUIT_ROLE to all circuits + verifies (12/12)
6. Runs 15 comprehensive smoke tests
7. Outputs campaign-ready copy for X/Twitter and Discord

**Results (Hardhat simulation):**
- 15 contracts deployed
- 12/12 roles verified
- 15/15 smoke tests passed
- Total gas: ~33.6M (~0.134 TFUEL at 4 Gwei)
- Duration: ~2.1s (Hardhat), est. 30-60s (Theta Testnet)

### 23.3 Grant Submission Automation

**Script:** `grant/submission-script.cjs`

Auto-fills grant applications from deployment manifests:
- Reads latest `deploy/manifests/*.json` for contract addresses, gas metrics, smoke tests
- Generates JSON + markdown submissions for Solana, TAO, and general programs
- Auto-populates traction: 15 contracts, 255+ tests, 12 circuits
- Outputs to `grant/submissions/` with checklist verification

**Grant programs tracked:**
| Program | Circuit | Amount | Status |
|---------|---------|--------|--------|
| Solana Foundation | SolanaAIBridge | $150K–$250K | SUBMIT-READY |
| OpenTensor Foundation | TAOCircuit | $150K–$200K | SUBMIT-READY |
| General Ecosystem | Customizable | $50K–$300K | SUBMIT-READY |

### 23.4 Updated Metrics (v1.90)

| Metric | Value |
|--------|-------|
| Total circuits | 12 modular |
| Total contracts | 15 deployed |
| Total tests | 255+ |
| Deployment gas | ~33.6M |
| Smoke tests | 15/15 |
| Grant submissions | 3 (auto-generated) |
| BelieverRound | Open |

---

## Section 24: Public Activation + Energy Grid + Believer Launch (Step 12 — v1.95)

### 24.1 Energy Grid Circuit (Expansion #13)

The EnergyGrid circuit brings decentralized physical energy infrastructure (DePIN) to XFuel:

**Architecture:**
1. **Node Registration** — DER (solar/battery/EV/wind/hybrid) nodes register with capacity and location.
2. **ZK-Verified Attestation** — Nodes submit SP1-proven energy production data (kWh metered).
3. **P2P Energy Trading** — On-chain settlement of peer-to-peer energy trades with protocol fees.
4. **Carbon Credits** — Verified green energy production earns tokenized carbon offsets (1 credit = 1 MWh).
5. **Virtual Power Plant** — Aggregation of distributed nodes for grid services.

**Research ties:**
- Daylight (godaylight.com, 2026): $75M raised; solar+battery DePIN; GRID token; 45% cheaper electricity.
- Glow (glowlabs.org): Solar DePIN on Ethereum; Proof-of-Physical-Work; GCC carbon credits.
- dClimate (dclimate.net): Decentralized climate data marketplace; oracle feeds for energy data.

**Gas profile (Hardhat):**
| Operation | Gas |
|-----------|-----|
| registerNode | ~185K |
| attestEnergy | ~336K |
| createTrade | ~170K |
| buyTrade | ~248K |

### 24.2 Public Testnet Activation (v1.95)

The `activation/public-activation.cjs` script orchestrates full public testnet activation:

**8-Phase Deployment:**
1. Pre-flight (balance, chain ID 365, compiler)
2. Core Layer (CoreRevenueSplitter + ZKVerifierSP1)
3. 13 circuits (TAO → A2A → ... → FilecoinStorage → EnergyGrid)
4. BelieverRound
5. Role grants + verification (13/13 CIRCUIT_ROLE)
6. Comprehensive smoke tests (15/15)
7. Dashboard manifest output (JSON)
8. Campaign data (X/Twitter + Discord copy)

**Result:** 16 contracts deployed, 15/15 smoke tests, ~35.5M total gas.

### 24.3 Believer Round Launch

The `believer/launch-round.cjs` provides an end-to-end launch workflow:
- Manifest-aware deployment (skips if already deployed)
- 7/7 smoke tests: status, hard cap, max/wallet, durations, commit, commitment, stats
- JSON launch report with traction metrics (13 circuits, 16 contracts, 270+ tests)
- Discord + X/Twitter campaign copy

### 24.4 Updated Metrics (v1.95)

| Metric | Value |
|--------|-------|
| Total circuits | 13 modular |
| Total contracts | 16 deployed |
| Total tests | 270+ |
| Deployment gas | ~35.5M |
| Smoke tests | 15/15 |
| Grant submissions | 3 (SUBMIT-READY) |
| BelieverRound | Open (7/7 smoke tests) |
| New circuit | EnergyGrid (Daylight/Glow DePIN energy) |

---

## Section 25: Mainnet Activation + MappingSensor + Believer Monitoring (Step 13 -- v2.0)

### 25.1 MappingSensor Circuit (Expansion #14)

The MappingSensor circuit integrates decentralized geospatial mapping and sensor data DePIN:

**Architecture:**
1. **Device Registration** -- Dashcams/sensors (weather, air quality, lidar, traffic) register with type, location, firmware hash.
2. **ZK-Verified Submission** -- Devices submit SP1-proven geospatial data with quality scoring.
3. **Quality EMA** -- Exponential moving average quality score tracks device reliability over time.
4. **Data Marketplace** -- Buyers purchase verified map/sensor data; protocol collects 0.5% fee.
5. **Coverage Tracking** -- Regional coverage mapped per location hash for freshness incentives.

**Research ties:**
- Hivemapper (hivemapper.com): 4K dashcam DePIN; HONEY burn-and-mint; $200-300B mapping industry.
- DIMO (dimo.zone): 100K+ connected vehicles; on-chain driving data attestation.
- WeatherXM (weatherxm.com): Community weather stations; WXM token; hyper-local data.

**Gas profile (Hardhat):**
| Operation | Gas |
|-----------|-----|
| registerDevice | ~185K |
| submitData | ~306K |
| listData | ~169K |
| purchaseData | ~226K |

### 25.2 Mainnet Activation (v2.0)

The `activation/mainnet-activation.cjs` provides production-grade Theta Mainnet deployment:

**9-Phase Deployment:**
1. Pre-flight (balance >= 50 TFUEL, chain ID 361, address validation)
2. Core Layer (Splitter + ZKVerifier + optional veXFGovernance)
3. 14 circuits (TAO -> ... -> EnergyGrid -> MappingSensor)
4. BelieverRound
5. Role grants + verification (14/14 CIRCUIT_ROLE)
6. Admin transfer (deployer -> multisig admin)
7. Smoke tests (17/17)
8. Health checks (ThetaScan API + on-chain code verification)
9. Manifest output + campaign summary

**Result:** 17+ contracts deployed, 17/17 smoke tests, 17/17 health checks, ~37.4M total gas.

### 25.3 Believer Round Monitoring

The `believer/monitoring-script.cjs` provides continuous tracking:
- Contract health checks (eth_getCode for all deployed contracts)
- BelieverRound parameters (hard cap, max/wallet, cliff, vesting)
- Grant submission status cross-reference (3 grants, $350K-$750K)
- Discord/Slack webhook integration
- JSON reports to `believer/reports/`

### 25.4 Updated Metrics (v2.0)

| Metric | Value |
|--------|-------|
| Total circuits | 14 modular |
| Total contracts | 17 deployed |
| Total tests | 285+ |
| Deployment gas | ~37.4M |
| Smoke tests | 17/17 |
| Health checks | 17/17 |
| Grant submissions | 3 (SUBMIT-READY) |
| BelieverRound | Open (7/7 smoke tests) |
| New circuit | MappingSensor (Hivemapper/DIMO DePIN mapping) |

---

## Section 26: Wireless DePIN + Enhanced Monitoring + Grant Execution (Step 14 -- v2.1)

### 26.1 WirelessDePIN Circuit (#15)

**Motivation**: Decentralized wireless (Helium, XNET, Wayru) is the largest DePIN category by device count. Helium alone operates 900K+ hotspots across LoRaWAN and 5G networks. XFuel extends to wireless coverage by providing a ZK-verified coverage-proof layer and data-credit settlement engine.

**Architecture** (inspired by Helium + XNET + Wayru):

| Component | Purpose |
|-----------|---------|
| Hotspot Registry | Devices register with type (LoRaWAN/5G/WiFi/CBRS), H3 hex location, antenna specs |
| ZK Coverage Proof | SP1 proves "Hotspot H covered hex X with RSSI/SNR Y at time T" without revealing antenna configs |
| Data Credit Settlement | Payers burn data credits for IoT/5G data transfer; hotspot owners earn proportional payments |
| Coverage Map | On-chain H3 hex tracking of proof counts for network health and coverage gap incentives |
| Protocol Fee | 0.5% fee on data credit settlements flows to CoreRevenueSplitter |

**Key metrics:**
- `registerHotspot`: ~187K gas
- `submitCoverageProof`: ~279K gas
- `settleDataTransfer`: ~394K gas

**Off-chain handler** (`wireless-handler.js`): Integrates with CoreListener for `wireless_coverage`, `wireless_transfer`, and `wireless_map` intents. Coordinates with Helium API for hotspot validation and SP1 prover for coverage proof generation.

### 26.2 Enhanced Believer Monitoring (v2.1)

The monitoring script now includes:

| Feature | Description |
|---------|-------------|
| Circuit-level health | Individual health checks for all 15 circuits |
| Discord rich embeds | Color-coded webhooks (green = all healthy, amber = issues) with field breakdowns |
| CSV export | `--csv` flag generates spreadsheet-compatible contract status reports |
| WirelessDePIN metrics | Hotspot count, coverage proof count, data transfer volume |
| Expanded traction | 300+ tests, 19 contracts, 15 circuits |

### 26.3 Mainnet Activation (v2.1)

Updated activation deploys 19 contracts (15 circuits + Core Layer + BelieverRound):

| Phase | Action | Verification |
|-------|--------|-------------|
| 0 | Pre-flight (>= 50 TFUEL, chain ID 361) | Balance + chain check |
| 1 | Core Layer (Splitter + ZKVerifier) | Deployment gas logged |
| 2 | 15 circuits (TAO -> ... -> WirelessDePIN) | Each contract verified |
| 3 | BelieverRound | Hard cap + vesting params |
| 4 | Role grants | 15/15 CIRCUIT_ROLE verified |
| 5 | Admin transfer | deployer -> multisig |
| 6 | Smoke tests | 18/18 passing |
| 7 | Health checks (ThetaScan) | 18/18 contracts live |
| 8 | Manifest + campaign copy | JSON output |

### 26.4 Updated Metrics

| Metric | Step 13 | Step 14 (Current) |
|--------|---------|-------------------|
| Circuits | 14 | 15 (+WirelessDePIN) |
| Contracts | 17 | 19 |
| Tests | 285+ | 300+ |
| Smoke tests | 17/17 | 18/18 |
| Health checks | 17/17 | 18/18 |
| Grant submissions | 3 (SUBMIT-READY) | 3 (SUBMIT-READY) |
| BelieverRound | Open | Open (enhanced monitoring) |
| New circuit | MappingSensor | WirelessDePIN (Helium/XNET DePIN wireless) |
| Monitoring | Basic webhook | Rich embeds + CSV + circuit-level health |

---

## Section 27: Uplink Circuit + Governance + Community Expansion (Step 15 -- v2.2)

### 27.1 UplinkCircuit (#16) -- WiFi Bandwidth Sharing

**Motivation**: Uplink operates 5M+ registered WiFi routers globally on Avalanche L1. Combined with WirelessDePIN (#15, LoRaWAN/5G coverage), this creates a complete decentralized connectivity stack within XFuel.

**Architecture** (inspired by Uplink + Althea + Wicrypt):

| Component | Purpose |
|-----------|---------|
| Router Registry | WiFi routers register with location, ISP hash, bandwidth cap |
| Session Lifecycle | Users open sessions with escrowed payment; cancel or settle |
| ZK Bandwidth Proof | SP1 proves "Router R delivered B Mbps to User U for D seconds with Q% uptime" |
| Quality EMA | Rolling quality score (0-10000) updated per settlement based on throughput vs cap |
| Connectivity Map | On-chain region-based router density and session counts |
| Protocol Fee | 0.5% fee on session settlements flows to CoreRevenueSplitter |

**Wireless Synergy:**
- WirelessDePIN: LoRaWAN/5G *coverage proofs* (Helium model -- beacon/witness/challenge)
- UplinkCircuit: WiFi *bandwidth proofs* (Uplink model -- session/throughput/quality)
- Together: complete DePIN connectivity stack (IoT + broadband + mobile)

**Key metrics:**
- `registerRouter`: ~189K gas
- `openSession`: ~224K gas (estimated)
- `settleSession`: ~350K gas (with fee forwarding + quality EMA)

### 27.2 First Governance Proposal (veXF)

XFP-001: Circuit Allocation Priority Vote -- the first veXF governance proposal:

| Aspect | Detail |
|--------|--------|
| Type | CircuitPriority (type 0) |
| Quorum | 10% of total voting power |
| Voting Period | 3 days (~17280 blocks) |
| Scope | All 16 circuits: tier allocation for dev/marketing/grants |
| Execution | On-chain via veXFGovernance.createProposal() |

Additional proposal templates: FeeStructure (DePIN fee reduction), TreasurySpend (security audit allocation), EmergencyPause (circuit breaker with 67% supermajority).

### 27.3 Community Expansion Tools

| Tool | Purpose |
|------|---------|
| `community/ama-script.cjs` | X AMA content generation (pre/during/post thread packages) |
| `funding/monitoring-bot.cjs` | Grant tracking with milestone management + Discord webhooks |
| `governance/proposal-script.cjs` | veXF proposal creation, simulation, and vote management |
| `iteration/add-circuit.cjs` | Circuit scaffolding + registry validation (16/16 PASS) |

### 27.4 Circuit Onboarding Automation

The `add-circuit.cjs` script validates all 16 circuits have complete artifacts:

```
  PASS #1  TAOCircuit       contract=Y handler=Y test=Y
  PASS #2  A2ACircuit       contract=Y handler=Y test=Y
  ...
  PASS #15 WirelessDePIN    contract=Y handler=Y test=Y
  PASS #16 UplinkCircuit    contract=Y handler=Y test=Y
  Results: 16 passed, 0 failed
```

### 27.5 Updated Metrics

| Metric | Step 14 | Step 15 (Current) |
|--------|---------|-------------------|
| Circuits | 15 | 16 (+UplinkCircuit) |
| Contracts | 19 | 20 |
| Tests | 300+ | 315+ |
| Smoke tests | 18/18 | 19/19 |
| Health checks | 18/18 | 19/19 |
| Grant submissions | 3 (SUBMIT-READY) | 3 (SUBMIT-READY) |
| Governance | Not started | First proposal ready (XFP-001) |
| Community tools | Monitoring only | AMA + funding bot + governance + circuit scaffold |
| New circuit | WirelessDePIN | UplinkCircuit (WiFi bandwidth sharing) |
| Wireless stack | LoRaWAN/5G only | LoRaWAN/5G + WiFi = full connectivity DePIN |

---

## Section 28: Cross-Circuit Synergy + Enhanced Governance + Community (Step 16 -- v2.3)

### 28.1 DePIN Synergy Model

XFuel introduces **cross-circuit synergy** -- the first protocol-level incentive structure that rewards operators for contributing to multiple DePIN layers in the same region.

**The DePIN Stack:**

| Layer | Circuit | Function | Source |
|-------|---------|----------|--------|
| Coverage | WirelessDePIN (#15) | LoRaWAN/5G beacon/witness proofs | Helium |
| Mapping | MappingSensor (#14) | Geospatial data submissions + marketplace | Hivemapper |
| Connectivity | UplinkCircuit (#16) | WiFi bandwidth sharing + session proofs | Uplink |

**Synergy Tier Incentives:**

| Tier | Active Circuits | Reward Multiplier | Rationale |
|------|----------------|-------------------|-----------|
| FULL | 3/3 | 1.0x (base) | Complete DePIN coverage; standard rewards |
| PARTIAL | 2/3 | 1.5x | Incentivize the missing layer in the region |
| FRONTIER | 1/3 | 3.0x | Pioneer bonus for underserved areas |
| DEAD | 0/3 | 5.0x | First-mover advantage for new regions |

**Cross-Circuit Bonuses:**
- MappingSensor data from wireless-covered regions: +10% quality boost
- UplinkCircuit sessions in mapped regions: +5% quality EMA boost
- WirelessDePIN proofs with router density: +15% reward boost

**Implementation roadmap:**
1. Phase 1 (current): Off-chain synergy scoring via `iteration/synergy-script.cjs`
2. Phase 2: CoreListener cross-circuit event correlation
3. Phase 3: On-chain SynergyOracle contract reading all 3 circuits
4. Phase 4: Automated reward multiplier in CoreRevenueSplitter

### 28.2 Enhanced Governance (XFP-004)

New governance proposal template for synergy incentive activation:

| Proposal | Type | Quorum | Effect |
|----------|------|--------|--------|
| XFP-001: Circuit Allocation | CircuitPriority | 10% | Sets dev/marketing/grant priority tiers |
| XFP-002: DePIN Fee Reduction | FeeStructure | 10% | Reduces DePIN circuit fees to 0.4% |
| XFP-003: Security Audit | TreasurySpend | 10% | Allocates 150K XF for audit |
| XFP-004: Synergy Incentives | FeeStructure | 10% | Activates cross-circuit reward multipliers |
| XFP-EMERGENCY: Circuit Pause | EmergencyPause | 67% | Circuit breaker for vulnerabilities |

### 28.3 Community Expansion

| Tool | Enhancement |
|------|-------------|
| `community/ama-script.cjs` | Added synergy deep-dive event, device workshop, cross-circuit talking points |
| `funding/monitoring-bot.cjs` | Added DePIN synergy status section, governance tracking |
| `governance/proposal-script.cjs` | Added XFP-004 synergy proposal template |
| `iteration/synergy-script.cjs` | New: regional coverage matrix, tier classification, simulation, incentive model |

### 28.4 Updated Metrics

| Metric | Step 15 | Step 16 (Current) |
|--------|---------|-------------------|
| Circuits | 16 | 16 (synergy-linked) |
| Contracts | 20 | 20 |
| Tests | 315+ | 315+ |
| Governance proposals | 1 (XFP-001) | 5 (XFP-001 through XFP-004 + Emergency) |
| DePIN synergy | Not started | 3-layer model + incentive tiers + simulation |
| Community events | 3 scheduled | 4 scheduled (+ device workshop) |
| Funding monitor | Basic tracking | Synergy metrics + governance status |
| Synergy script | N/A | Regional matrix + simulation + incentive model + reporting |

---

## Appendix A: Research References

| Source | Key Finding | Applied In |
|--------|------------|------------|
| SP1 Docs (succinct.xyz) | Groth16 ~270K gas, PLONK ~300K gas; RISC-V precompiles for crypto ops; private inputs only known to prover | ZKVerifierSP1, SP1ProofHooks, ZKMLCircuit |
| Theta Metachain Guide | 1,000 wTHETA + 20,000 TFUEL per validator; TFUEL gas; subchain isolation | Fee-to-Stake, CoreListener |
| Bittensor EVM Docs | Chain ID 964; precompiles at 0x0800-0x0802; dTAO staking | CoreListener chain registry |
| CosmWasm Docs | cw-storage-plus patterns; BankMsg::Send for native transfers | WASM contracts |
| Curve veModel | Linear decay voting power; lock multiplier | veXFGovernance |
| Akash Network Docs | SDL specs, reverse auction bidding, per-block lease payments, 4% AKT / 20% USDC take rates | AkashCircuit |
| SP1 Private Proofs | Private inputs (model weights) proven without revealing; compressed/recursive for large models | ZKMLCircuit |
| Almanak Agent Swarms | 18 AI agents for strategy lifecycle; Monte Carlo 10K+ scenarios; ERC-7540 vaults; $8.45M raised | AutonomousVaults |
| NRN Agents Whitepaper | Sim-to-real gap; 2.4M episodes vs 15T tokens; digital twins at 60Hz; verifiable compositional frameworks | AgentRobotics |
| Vana Protocol | First open protocol for AI data sovereignty; DataDAOs with VRC-20 tokens; three-layer architecture; data refinement pipeline | DataHubs |
| Grass (grass.io) | DePIN: 8.5M MAU, 90-100TB/day data; ZK provenance rollup; $33M annualized revenue; combats data poisoning | DataHubs |
| Osmosis CL Pools | Concentrated liquidity: 200-300x capital efficiency; geometric tick spacing; L + √P tracking; uptime-based incentives | YieldCircuit |
| NEAR Shade Agents | TEE-based autonomous agents; persistent key management; non-custodial; code hash verification + remote attestation | NearAgents |
| NEAR AI Agent Market | Decentralized marketplace: agents bid, execute, get paid; natural-language Intents; Feb 2026 launch | NearAgents |
| NEAR Chain Signatures | MPC cross-chain signing; BTC, ETH, Cosmos, DOGE, XRP; secured by NEAR validators + Eigenlayer restakers | NearAgents |
| Render Network (2026) | Migrated to Solana; 5,600 RTX 5090 nodes; Burn-Mint Equilibrium; 50-70% cost savings vs cloud; enterprise partners (Santander, F1) | SolanaAIBridge |
| io.net (2026) | Solana-based 1M+ pooled GPUs; 750K inferences; IO token for payment + staking; partnered with Render Network (300K RNDR allocation) | SolanaAIBridge |
| Grass (2026) | DePIN bandwidth: 8.5M MAU; 90-100TB/day scraped data; ZK provenance rollup on Solana; combats data poisoning | SolanaAIBridge |
| SendAI (2026) | Solana-native AI agent framework; autonomous task execution; natural-language intents | SolanaAIBridge |
| Wormhole | Guardian-attested VAAs for cross-chain messaging; supports arbitrary data + token transfers between EVM and Solana | SolanaAIBridge |
| Chainlink CCIP SVM | SVM2AnyMessage struct for Solana↔EVM messaging; token transfers + arbitrary data; EVM address conversion | SolanaAIBridge |
| Theta Mainnet (thetatoken.org) | Chain ID 361; RPC at eth-rpc-api.thetatoken.org/rpc; TFUEL gas; Constantinople + Istanbul EVM; full Hardhat support | deploy/mainnet.cjs |
| Discord.js v14 | SlashCommandBuilder; GatewayIntentBits; interaction.reply(); Discord API v10; Node 16.11.0+ | community/bot.cjs |
| ThetaScan.io Developer API | 13 endpoint categories; balance/tx/contract/staking queries; 1-2 calls/sec rate limit; Node Status page | deploy/mainnet.cjs monitoring |
| OpenZeppelin VestingWallet | Linear vesting pattern; SafeERC20 for token transfers; customizable cliff + duration; Ownable beneficiary | BelieverRound.sol |
| OpenZeppelin AccessControl | Role-based permissioning; DEFAULT_ADMIN_ROLE + custom roles; grantRole/revokeRole/renounceRole | BelieverRound.sol, Core Layer |
| Theta Testnet (sequence.xyz) | Chain ID 365; RPC at eth-rpc-api-testnet.thetatoken.org/rpc; faucet via thirdweb; full Hardhat support | dashboard/, deploy/testnet.cjs |
| Hardhat Gas Reporter | Per-method gas tracking; deployment cost tables; Solidity optimizer benchmarking | polish/gas-opts.cjs |
| Filecoin (filecoin.io, 2026) | 3,800+ storage providers; 20 EiB capacity; Proof-of-Replication + Proof-of-Spacetime; sector sealing + WindowPoSt | FilecoinStorage |
| Lighthouse (lighthouse.storage) | Perpetual storage on Filecoin/IPFS; pay-once-store-forever; encryption + access control | FilecoinStorage |
| Storacha (storacha.network) | Content-addressed data pipelines; UCAN-based authorization; decentralized hot storage layer | FilecoinStorage |
| Daylight (godaylight.com, 2026) | $75M raised; solar+battery DePIN; GRID token for tokenized energy yield; 45% cheaper electricity; zero-upfront-cost installs | EnergyGrid |
| Glow (glowlabs.org) | Solar farm DePIN on Ethereum; Proof-of-Physical-Work; GCC (Glow Carbon Credits) for verified green energy production | EnergyGrid |
| dClimate (dclimate.net) | Decentralized climate data marketplace; oracle feeds for energy production/consumption; carbon offset verification | EnergyGrid |
| Hivemapper (hivemapper.com) | Decentralized mapping with 4K dashcams; HONEY burn-and-mint economy; $200-300B mapping industry; millions of km weekly | MappingSensor |
| DIMO (dimo.zone, 2026) | Vehicle data DePIN; 100K+ connected cars; on-chain attestation of driving data; insurance/fleet analytics marketplace | MappingSensor |
| WeatherXM (weatherxm.com, 2026) | Community-powered weather stations; WXM token; hyper-local weather data for agriculture/insurance/logistics | MappingSensor |
| Helium (helium.com, 2026) | 900K+ hotspots; LoRaWAN + 5G DePIN; HNT burn-and-mint; Proof-of-Coverage; Data Credits; Solana-based | WirelessDePIN |
| XNET (xnet.company) | Decentralized 5G/LTE; CBRS spectrum; carrier offload; enterprise connectivity; neutral-host small cells | WirelessDePIN |
| Wayru (wayru.io) | Community WiFi hotspots; WRU token; bandwidth sharing; coverage in underserved LATAM areas | WirelessDePIN |
| Helium Proof-of-Coverage | Beacon/witness/challenge protocol proving hotspot location + coverage validity for reward scaling | WirelessDePIN |
| Uplink (uplink.xyz, 2026) | 5M+ registered WiFi routers; ULX token + Network Credits dual economy; Avalanche L1; global decentralized connectivity | UplinkCircuit |
| Althea (althea.net) | Mesh networking; pay-per-forward routing; bandwidth micro-payments; incentivized last-mile connectivity | UplinkCircuit |
| Wicrypt (wicrypt.com) | Mobile hotspot sharing DePIN; WNT token; 40K+ hotspots; Africa-focused WiFi sharing | UplinkCircuit |

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Circuit** | A self-contained module that plugs into the Core Layer for specific use cases |
| **Core Layer** | The central hub for ZK verification, routing, fees, and governance |
| **Nullifier** | A unique identifier preventing proof reuse (replay protection) |
| **veXF** | Vote-escrowed XF — locked XF tokens conferring governance power |
| **Fee-to-Stake** | Portion of treasury fees routed to validator staking pools |
| **SP1 zkVM** | Succinct's RISC-V zero-knowledge virtual machine |
| **Groth16** | A SNARK proof system with ~260 byte proofs and ~270K gas verification |
| **Program VKey** | The verification key identifying a specific SP1 circuit/program |
| **DePIN** | Decentralized Physical Infrastructure Network |
| **NAV** | Net Asset Value — total value of vault assets |
| **HWM** | High Water Mark — peak NAV used for performance fee calculation |
| **Safety Cert** | Non-transferable on-chain attestation of trajectory verification |
| **Digital Twin** | Virtual replica of a physical robot synchronized at high frequency |
| **DataDAO** | Community-governed pool that aggregates user-contributed data with cryptographic ownership |
| **Data Provenance** | Verifiable proof of data origin, method, and integrity |
| **Concentrated Liquidity** | AMM design where liquidity is focused within specific price tick ranges |
| **Tick Range** | Discrete price interval in a concentrated-liquidity pool |
| **Gas Profile** | Measured gas cost of an on-chain operation under standardized conditions |
| **Intent** | A user-defined outcome with constraints and budget; agents compete to execute |
| **Chain Signature** | MPC-based cross-chain transaction signing via NEAR validators |
| **Shade Agent** | TEE-based autonomous AI agent with persistent non-custodial key management |
| **Reputation** | Cumulative quality-weighted score tracking agent settlement history |
| **Wormhole VAA** | Verified Action Approval — Guardian-attested cross-chain message between EVM and Solana |
| **Solana Provider** | GPU/Data/Agent service registered on SolanaAIBridge with a Solana pubkey |
| **Bridge Task** | AI task submitted on EVM and relayed to Solana for execution via Wormhole |
| **Load Test** | Stress test validating system behavior under high concurrent operation volume |
| **Chaos Test** | Resilience test involving mid-stream disruptions (pause/unpause, role revocation) |
| **Believer Round** | Community-first micro-commitment funding round with vesting |
| **Micro-Commitment** | Small-denomination investment ($100-$5,000) with transparent vesting |
| **Deployment Manifest** | JSON file recording all contract addresses, roles, and gas usage from a deployment |
| **Admin Transfer** | Process of moving DEFAULT_ADMIN_ROLE from deployer to multisig after deployment |
| **BelieverRound Contract** | Solidity smart contract managing micro-commitment funding with cliff + linear vesting |
| **TGE** | Token Generation Event — the moment XF tokens are minted/deposited into the vesting contract |
| **Cliff Duration** | Initial period (90 days) during which no vested tokens can be claimed |
| **Linear Vesting** | Proportional token release over time (365 days) after cliff period ends |
| **Refund Deadline** | 180-day window after which uncommitted round participants can reclaim funds if TGE didn't occur |
| **Health Check** | Post-deploy verification that on-chain contract code exists and is accessible |
| **ThetaScan API** | Developer API at thetascan.io for querying Theta Mainnet balances, transactions, and contracts |
| **Continuous Monitoring** | Persistent polling loop that periodically verifies contract health after deployment |
| **Gas Profiler** | Automated tool measuring deployment + operation gas across all contracts with budget comparisons |
| **Testnet Dashboard** | Browser-based monitoring UI for deployed contracts, gas profiles, and believer round status |
| **Activation Script** | End-to-end BelieverRound deployment + smoke test + campaign generation workflow |
| **Grant Tracker** | Structured tracking tool for grant applications with milestone management and status reporting |
| **Campaign Copy** | Pre-generated Discord/X announcement text output by the activation script |
| **FilecoinStorage** | Circuit #12: ZK-verified decentralized storage deals with SP1-attested WindowPoSt/SnapDeal proofs |
| **Storage Provider** | Filecoin miner registered on FilecoinStorage with capacity, pricing, and reputation |
| **Storage Deal** | On-chain agreement between client and provider with escrowed payment for data storage |
| **WindowPoSt** | Window Proof-of-Spacetime: periodic proof that a Filecoin miner is storing committed data |
| **SnapDeal** | Filecoin deal where existing committed capacity sectors are converted to store client data |
| **Piece CID** | Content Identifier for data stored in a Filecoin storage deal |
| **Public Launch Script** | Orchestrated 7-phase deployment covering Core + 12 circuits + BelieverRound + smoke tests + campaign |
| **Grant Submission Script** | Automated tool that generates submission-ready grant applications from deployment manifests |
| **EnergyGrid** | Circuit #13: ZK-verified DePIN energy attestation, P2P trading, and carbon credits |
| **Energy Node** | DER (solar/battery/EV/wind/hybrid) device registered on EnergyGrid with capacity and location |
| **Energy Attestation** | ZK-proven report of energy production (kWh) over a period from a registered node |
| **P2P Energy Trade** | On-chain trade where a seller node offers kWh and a buyer pays with protocol fee settlement |
| **Carbon Credit** | Tokenized carbon offset earned by verified green energy production (1 credit = 1 MWh) |
| **Virtual Power Plant (VPP)** | Aggregation of distributed energy nodes for coordinated grid services |
| **Activation Script** | 8-phase orchestrated deployment: Core + 13 circuits + BelieverRound + roles + smoke tests + manifest |
| **Launch Round Script** | End-to-end BelieverRound launch with manifest awareness + 7/7 smoke tests + campaign copy |
| **MappingSensor** | Circuit #14: ZK-verified geospatial data attestation, data marketplace, coverage tracking |
| **Mapping Device** | Dashcam/sensor (weather, air quality, lidar, traffic) registered on MappingSensor |
| **Data Submission** | ZK-proven report of geospatial capture with quality score and location hash |
| **Data Marketplace** | On-chain listing and purchase of verified sensor/map data with protocol fees |
| **Quality EMA** | Exponential moving average tracking device data quality over submissions |
| **Coverage Tracking** | Per-region submission count for map freshness and gap incentives |
| **Mainnet Activation** | 9-phase production deployment: Core + 15 circuits + BelieverRound + admin transfer + health checks |
| **Believer Monitor** | Continuous monitoring tool tracking contract health, round status, grants, and vesting |
| **WirelessDePIN** | Circuit #15: ZK-verified wireless coverage proofs, data credit settlement, hotspot registry |
| **Hotspot** | Wireless node (LoRaWAN/5G/WiFi/CBRS) registered on WirelessDePIN with location hex and antenna specs |
| **Coverage Proof** | ZK-proven attestation that a hotspot provided wireless coverage at a specific hex with measured RSSI/SNR |
| **Data Credit** | Unit burned for IoT/5G data transfer through a hotspot; payers burn credits, hotspot owners earn payments |
| **H3 Hex** | Hierarchical hexagonal index for geospatial location tracking; used in coverage maps |
| **RSSI** | Received Signal Strength Indicator (dBm); measures wireless signal power |
| **SNR** | Signal-to-Noise Ratio (dB); measures signal quality relative to background noise |
| **Reward Scale** | 0-10000 scaling factor for hotspot rewards based on coverage density and network need |
| **Coverage Map** | On-chain hex-indexed proof counts tracking network coverage health and gap incentives |
| **Rich Embed Webhook** | Discord webhook payload with color-coded status fields for monitoring dashboards |
| **UplinkCircuit** | Circuit #16: ZK-verified WiFi bandwidth sharing, router registry, session settlement, quality EMA |
| **Router** | WiFi device registered on UplinkCircuit with location hash, ISP hash, and bandwidth cap |
| **Bandwidth Proof** | ZK-proven attestation that a router delivered measured throughput for a session duration |
| **Session** | Connectivity session between a user and a WiFi router with escrowed payment |
| **Quality EMA** | Exponential moving average (7:3 ratio) tracking router bandwidth delivery vs advertised cap |
| **Connectivity Map** | On-chain region-indexed tracking of router density and session counts |
| **Circuit Scaffold** | Auto-generated contract + handler + test templates from add-circuit.cjs |
| **Governance Proposal** | On-chain veXF vote with typed categories (CircuitPriority, FeeStructure, TreasurySpend, EmergencyPause) |
| **Circuit Allocation** | Priority tiering of circuits for development resources, marketing, and grant attention |
| **Wireless Synergy** | Complementary stack: WirelessDePIN (LoRaWAN/5G coverage) + UplinkCircuit (WiFi bandwidth) |
| **Funding Monitor** | Automated grant tracking bot with milestone management and Discord/Slack webhooks |
| **Cross-Circuit Synergy** | Incentive model rewarding operators who contribute to multiple DePIN layers in the same region |
| **Synergy Tier** | Classification of region coverage: FULL (3/3), PARTIAL (2/3), FRONTIER (1/3), DEAD (0/3) |
| **DePIN Stack** | Three-layer complement: WirelessDePIN (coverage) + MappingSensor (mapping) + UplinkCircuit (connectivity) |
| **Synergy Score** | Composite metric combining device count and balance across all three DePIN circuits per region |
| **SynergyOracle** | Planned on-chain contract reading all 3 DePIN circuit states for automated reward multipliers |
| **Frontier Zone** | Region with only 1 of 3 DePIN circuits active; receives 3x reward multiplier to incentivize deployment |

---

*XFuel Protocol — Pumping intelligence across AI ecosystems.*

*For the latest updates, visit [xfuel.app](https://xfuel.app) or [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol).*
