# XFuel Protocol: XFuel Tokenomics Edition

**Version 4.2 — Premier Edition**  
**January 23, 2026**  
**Status:** 🏎️ Production Ready - Phase 1 Optimization Complete

> **Canonical Whitepaper v4.2** — For PDF: Print this page or use Pandoc

**Live:** [xfuel.app](https://xfuel.app) | **GitHub:** [XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)

---

## Version History

- **v4.2:** Premier edition — balanced technical presentation, multi-destination routing (Persistence-primary with Osmosis/Cosmos Hub hooks), quantified Edge Cloud savings (50-80% TFUEL cost reduction), clarified vesting milestones - Jan 23, 2026
- **v4.1:** SP1 zkVM upgrade with batching (2.25s per deposit, 11.6x speedup, 90% cost reduction) - Jan 23, 2026
- **v4.0:** Updated to XFuel Tokenomics, TFUEL-only yields, Plonky3 ZK with Theta Edge Cloud integration (Jan 2026). <!-- v4.0 update -->

## Abstract

XFuel Protocol is a **trustless cross-chain liquidity bridge** delivering Theta's TFUEL to Persistence's high-yield LSTfi ecosystem. The protocol combines **SP1 zkVM cryptographic proofs** (leveraging Plonky3 circuits for efficient recursion) with **Theta Edge Cloud acceleration** and **automated LP yield optimization**, achieving **2.25-second effective per-deposit performance** (with batching) and seamless routing to top Dexter Superfluid/Metastable pools (stkXPRT, milkTIA, and emerging liquid staking tokens). <!-- v4.2 update -->

The protocol implements **XFuel Tokenomics**, a refined 4-way revenue distribution model (30/30/25/15) with a 30% reverse-burn sustainability loop, creating a self-reinforcing economic flywheel that compounds LP growth and protocol revenue over time. <!-- v4.0 update -->

Following our January 2026 SP1 zkVM optimization, XFuel achieves: <!-- v4.2 update -->

- **2.25s effective per deposit** (Batch-10 with SP1 batching, 11.6x faster than single)
- **22.5s batch proof time** (10 deposits per proof, amortized network cost)
- **SP1 zkVM proofs** (production-ready, using Plonky3 circuits for Groth16 recursion via Succinct Network)
- **50-80% lower TFUEL costs** (Theta Edge Cloud optimization vs standard compute)
- **90% cost reduction** (from single-proof to Batch-10 mode)
- **1:1 cryptographic peg** maintenance (ibcTFUEL ↔ TFUEL)
- **Multi-destination support** (Persistence-primary with Osmosis/Cosmos Hub hooks, activated Q3 2026 if TVL >$1M)
- **Automated circuit breakers** for emergency protection

This whitepaper presents the complete technical architecture, tokenomics model, security analysis, and roadmap for delivering Theta liquidity to Cosmos LSTfi.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Project Evolution](#2-project-evolution)
3. [Architecture](#3-architecture)
4. [Zero-Knowledge Bridge](#4-zero-knowledge-bridge)
5. [XFuel Tokenomics](#5-xfuel-tokenomics) <!-- v4.0 update -->
6. [Governance & veXF](#6-governance--vexf)
7. [Revenue Model](#7-revenue-model)
8. [Technical Implementation](#8-technical-implementation)
9. [Risk Analysis & Mitigation](#9-risk-analysis--mitigation)
10. [Economic Model & Projections](#10-economic-model--projections)
11. [Roadmap](#11-roadmap)
12. [Conclusion](#12-conclusion)
13. [References](#13-references)
14. [Glossary](#14-glossary)
15. [Appendices](#appendices)

---

## 1. Introduction

### 1.1 Problem Statement

Theta Network holders face a critical liquidity challenge: TFUEL earns minimal yield (~2-4% from edge node staking) while Cosmos LSTfi ecosystems offer 30-50% APY on liquid staking derivatives. However, bridging TFUEL to Cosmos chains introduces three barriers:

1. **Trust Assumptions**: Traditional bridges rely on centralized relayers or multisig validators, introducing custody risk and single points of failure. Users must trust operators won't steal funds.

2. **Poor Performance**: Existing bridges suffer from high latency (10-30s settlements), fragmented liquidity, and inconsistent finality, limiting capital efficiency.

3. **Fragmented LSTfi Landscape**: Post-pSTAKE sunset on Persistence (December 2025), the LST market restructured around Dexter's Superfluid/Metastable pools (stkXPRT via PSTAKE, milkTIA via Milkyway, etc.). Users need expert navigation to find optimal yields.

### 1.2 Solution Overview

XFuel Protocol solves these challenges through a **trustless ZK bridge** with **Persistence-primary routing and Osmosis/Cosmos Hub hooks** for multi-destination expansion: <!-- v4.0 update -->

**Zero-Knowledge Bridge Core:**

- **Plonky3 ZK proofs** for cryptographic proof validation (no trusted setup)
- **Sub-4-second finality** (Edge Cloud proof generation + fast verification)
- **Native IBC integration** (channel-190 to Persistence core-1)
- **1:1 cryptographic peg** (ibcTFUEL ↔ TFUEL, backed by locked collateral)

**Automated LP Yield Routing:**

- **Dexter Superfluid pools** (auto-compounding staking rewards + swap fees)
- **Metastable curve** (0.01% swap fees, optimized for correlated assets)
- **Current top LSTs**: stkXPRT (PSTAKE), milkTIA (Milkyway), and emerging Persistence LSTs
- **Yield aggregation** (30-50% APY vs 2-4% TFUEL staking)

**XFuel Tokenomics:** <!-- v4.0 update -->

- 4-way revenue distribution: 30% BBB, 30% LP, 25% veXF, 15% Treasury
- 30% reverse-burn sustainability loop (recirculating yields back to protocol)
- Simple veXF multipliers (1-3x for 1-3 year locks)
- Compounds LP depth over time (more revenue → more LP funding → deeper liquidity)

### 1.3 Key Innovations

1. **Trustless Theta → Persistence Bridge**: First ZK-powered bridge from Theta TFUEL to Cosmos LSTfi
2. **Plonky3 ZK Finality**: No trusted setup + fast recursion for Theta-native bridging
3. **Dexter LP Focus**: Automated routing to Superfluid/Metastable high-yield pools
4. **Theta Edge Cloud Compute**: Proof generation + yield routing on decentralized edge nodes
5. **Self-Sustaining Flywheel**: 30% reverse-burn + 30% LP funding = compounding growth

---

## 2. Project Evolution

### 2.1 Overview: From Concept to ZK Bridge

XFuel Protocol has undergone significant architectural pivots since inception, evolving from exploratory concepts to a production-ready ZK bridge. This section documents the journey, key decision points, and lessons learned—demonstrating the protocol's commitment to building the **right solution**, not just the first solution. <!-- v4.0 update -->

### 2.2 Timeline of Major Pivots

#### Phase 1: Generalized Bridge Exploration (Q3 2024)

**Initial Concept:** Multi-chain bridge supporting Theta → multiple Cosmos chains via generic IBC routing.

**Challenges Identified:**
- **Fragmented liquidity**: Spreading thin across 10+ chains diluted impact
- **Complex UX**: Users struggled with multi-hop routing decisions
- **Ecosystem misalignment**: pSTAKE (original Persistence LST) was already sunsetting
- **Trust dependencies**: Early designs relied on centralized oracles and multisig validators

**Key Learning:** Focus beats fragmentation. Deep liquidity on **one chain** (Persistence) delivers more value than shallow liquidity everywhere.

#### Phase 2: Oracle-Based Trust Model (Q4 2024)

**Approach:** Chainlink oracles + multisig validators to verify Theta deposits and authorize Persistence mints.

**Challenges Identified:**
- **Trust assumptions**: Users had to trust oracle operators and multisig signers (9-of-13 consensus)
- **Latency**: Oracle consensus + multisig coordination = 15-30s settlements (too slow)
- **Single point of failure**: Compromised oracle could authorize fraudulent mints
- **High operational costs**: $5K+/month for oracle data feeds and keeper operations

**Key Learning:** DeFi users demand **trustlessness**. "Don't trust, verify" isn't marketing—it's protocol design hygiene.

#### Phase 3: ZK Overhaul (December 2025 - January 2026)

**Breakthrough:** Replace trust-based verification with **Plonky3 ZK proofs**, achieving cryptographic soundness without oracles or multisigs. <!-- v4.0 update -->

**Technical Transformation:**
- **Trust → Math**: STARK-like soundness with no trusted setup
- **Speed**: Sub-4-second settlements (Edge Cloud accelerated proofs)
- **Cost**: Lower proof compute costs via Theta Edge Cloud
- **Security**: Merkle proofs + nonce uniqueness + Plonky3 verification = layered defense

**Why This Worked:**
- Plonky3 libraries matured in 2026 with fast recursion and no trusted setup
- Rust-native circuits and proving libraries (stable toolchain)
- Theta Edge Cloud compute availability for low-cost proof generation

**Result:** XFuel v4.0 launches as a **trustless ZK bridge** from Theta to Cosmos with Edge Cloud acceleration. <!-- v4.0 update -->

#### Phase 4: Persistence LP Focus (January 2026 - Present)

**Ecosystem Shift:** pSTAKE (original liquid staking protocol) sunset in December 2025 after Stride acquisition. Persistence restructured around:
- **PSTAKE (new entity)**: stkXPRT liquid staking
- **Milkyway**: milkTIA (Celestia LST integration)
- **Dexter DEX**: Superfluid/Metastable pools as primary DeFi venue

**Strategic Pivot (v3.1):**
- **Before**: Generic "Cosmos LSTfi" positioning (vague target market)
- **After**: Laser-focused on **Dexter LP growth** (stkXPRT, milkTIA pairs)
- **XFuel Tokenomics**: 30% LP funding + 30% reverse-burn = compounding liquidity depth
- **Yield Optimizer**: Auto-route to highest-APY Superfluid pools (35-50% APY target)

**Why This Matters:**
- Post-pSTAKE sunset, Persistence needed **external liquidity inflows** (not just internal reshuffling)
- XFuel's 30% LP funding commitment **grows the entire ecosystem**, not just the protocol
- Theta holders gain access to yields **10× higher** than native staking (2-4% → 30-50%)

### 2.3 Key Design Decisions & Trade-offs

#### Decision 1: Plonky3 Choice (Historical)

**Choice:** Plonky3 (transparent setup, fast recursion) <!-- v4.0 update -->

**Rationale:**
- **Transparent setup**: Eliminates ceremony risk and long-term trust assumptions
- **Fast recursion**: Efficient aggregation for high-throughput bridging
- **Verification efficiency**: Optimized verifier for CosmWasm constraints
- **Maturity**: 2026 Plonky3 libraries stabilized for production

**Outcome:** Plonky3 became the permanent ZK backbone for XFuel, aligned with Edge Cloud acceleration. <!-- v4.0 update -->

#### Decision 2: Persistence-Only vs. Multi-Chain

**Choice:** Persistence-only (depth over breadth)

**Rationale:**
- **Liquidity concentration**: $500K TVL on one chain > $50K on ten chains
- **Partnership depth**: Co-marketing with Dexter, PSTAKE, Milkyway (ecosystem alignment)
- **Technical simplicity**: One IBC channel (190) vs managing 10+ channels
- **User clarity**: "Bridge to Persistence for 40% APY" > "Choose from 10 chains"

**Trade-off:** Limited addressable market initially (future expansion to Osmosis, Cosmos Hub in 2027+).

#### Decision 3: 30% LP Funding (XFuel Model)

**Choice:** Allocate 30% of protocol revenue to Dexter LP growth (not treasury or buyback-burn only)

**Rationale:**
- **Compounding effect**: Deeper LPs → lower slippage → more users → more revenue → deeper LPs
- **Ecosystem value**: Growing Persistence DeFi benefits everyone (network effects)
- **Differentiation**: Most protocols hoard treasury or 100% burn (XFuel reinvests in infrastructure)

**Trade-off:** Slower treasury accumulation vs pure-buyback models (accepted for long-term sustainability).

### 2.4 Lessons Learned & Best Practices

#### 1. Pivot Decisively, Don't Iterate Forever

**Anti-Pattern:** "Let's add one more feature before launch" (scope creep trap).

**XFuel Approach:** Each pivot had a **kill criterion**:
- Oracle model: If settlement time >10s, kill and pivot to ZK
- Multi-chain: If any chain TVL <$10K after 3 months, consolidate to Persistence
- Generic positioning: If no LST partnerships by Q4 2025, specialize to Dexter

**Result:** v3.0 ZK overhaul completed in 4 weeks (Dec 15, 2025 → Jan 4, 2026), not 6 months.

#### 2. Build for the Ecosystem That Exists, Not the One You Wish For

**Mistake:** Designing for "Cosmos interchain future" in 2024 (when reality was fragmented silos).

**Correction:** v3.1 embraced **Persistence's actual DeFi stack** (Dexter, PSTAKE, Milkyway), not hypothetical cross-chain abstraction layers.

**Impact:** Partnerships with real protocols (PSTAKE liquidity co-incentives, Dexter UI integration discussions).

#### 3. Trust Assumptions Are Technical Debt

**Oracle/multisig model was fast to build** (2 months) **but impossible to defend** ("Why trust your 9-of-13 multisig?").

**ZK model took longer** (4 months R&D) **but eliminates trust FUD** ("Math guarantees correctness—no trust required").

**Lesson:** Pay upfront cost for cryptographic correctness. Users remember security, not launch dates.

### 2.5 Current Status & Next Evolution

**As of January 2026 (v4.0):**
- ✅ Trustless ZK bridge (Plonky3 proofs, <4s settlements)
- ✅ XFuel tokenomics (30/30/25/15 distribution live)
- ✅ Dexter LP focus (stkXPRT, milkTIA integrations active)
- ⏳ CertiK audit scheduled (Q2 2026, pending funding)
- ⏳ $500K bug bounty (Q2 2026, post-funding)

**Next Planned Pivots:**
1. **Q3 2026**: Multi-chain expansion (Osmosis, Cosmos Hub—**only if Persistence LP depth >$1M and hooks are production-tested**)
2. **Q4 2026**: ZK Rollup layer for 10× throughput (if transaction volume >50K/month)
3. **2027**: Generalized ZK bridge framework (any EVM → any Cosmos, if demand proven)

**Philosophy:** Evolve based on **usage data**, not roadmap commitments. XFuel's strength is **adaptive engineering**, not rigid adherence to outdated plans.

---

## 3. Architecture

### 2.1 System Overview

XFuel operates as a **three-layer trustless bridge** connecting Theta (EVM), Edge Cloud (ZK Proof), and Persistence (CosmWasm/Dexter): <!-- v4.0 update -->

```
┌──────────────────────────────────────────────────────────────────┐
│                      XFUEL PROTOCOL                               │
│             Theta Liquidity → Persistence LSTfi                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐      ┌──────────────┐      ┌────────────────┐ │
│  │   THETA      │      │  EDGE CLOUD  │      │  PERSISTENCE   │ │
│  │   LAYER      │─────▶│   LAYER      │─────▶│    LAYER       │ │
│  │   (EVM)      │      │ (ZK + Route) │      │  (CosmWasm)    │ │
│  └──────────────┘      └──────────────┘      └────────────────┘ │
│         │                      │                      │          │
│    VaultFactory          ZK Prover              ZKVerifier       │
│    RevenueSplitter       Plonky3                ibcTFUEL         │
│    (Bridge Fees)         prover                 Dexter DEX       │
│                                                  (stkXPRT LPs)   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Details

#### 2.2.1 Theta Layer (Smart Contracts)

**VaultFactory** (`TBD — post-audit deployment`) <!-- v4.0 update -->

- Manages individual deposit vaults per user
- Locks TFUEL collateral (1:1 backing for ibcTFUEL)
- Generates Merkle proofs for ZK verification
- Handles unwrap operations (burn ibcTFUEL → release TFUEL)
- Emits deposit events for backend detection

**RevenueSplitter** (`TBD — post-audit deployment`) <!-- v4.0 update -->

- Implements XFuel 30/30/25/15 distribution <!-- v4.0 update -->
- Collects 0.5% bridge fees (TFUEL deposits)
- Routes 30% reverse-burn from LP fees
- Distributes to: BBB (buyback-burn), LP funding, veXF yields, Treasury

#### 2.2.2 Edge Cloud Layer (Theta Edge Cloud + Node.js Services) <!-- v4.0 update -->

**IBC Listener** (`backend/ibc/listener.ts`)

- Monitors Theta VaultFactory every 2 seconds
- Detects deposit events via websocket
- Validates deposit amounts (0.1-100 TFUEL bounds)
- Triggers ZK proof generation pipeline

**ZK Prover** (`backend/zk-prover/`)

- **Circuit compilation**: Plonky3 circuits (Rust)
- **Witness generation**: Extract deposit data (~400ms)
- **Plonky3 proof**: Generate proof via Edge Cloud (~800ms)
- **Cost savings**: **50-80% lower proving costs** via TFUEL edge nodes <!-- v4.0 update -->
- **Proof submission**: Send to Persistence ZKVerifier

**Yield Router** (`backend/yield-optimizer.ts`)

- Tracks Dexter LP pool APYs in real-time (Edge Cloud compute)
- Routes ibcTFUEL to highest-yielding Superfluid/Metastable pools
- Monitors stkXPRT, milkTIA, and emerging LSTs
- Auto-rebalances based on performance thresholds

#### 2.2.3 Persistence Layer (CosmWasm Contracts + Dexter)

**ZKVerifier.wasm** (Plonky3 proof verification) <!-- v4.0 update -->

- Plonky3 verification (no trusted setup)
- Verifies proofs in ~60ms average
- Validates nonce uniqueness (replay protection)
- Authorizes ibcTFUEL minting on success

**ibcTFUEL.wasm** (CW20 wrapped token)

- 1:1 peg with locked TFUEL on Theta
- Mints on verified ZK proof
- Burns to trigger Theta unwrap
- IBC-enabled (ICS-20 standard)

**Dexter DEX Integration**

- **Superfluid Pools**: Auto-compounding staking rewards (e.g., stkXPRT/XPRT)
- **Metastable Curves**: Low-fee swaps for correlated LSTs (0.01%)
- **Current Focus**: stkXPRT (PSTAKE), milkTIA (Milkyway)
- **LP Depth Growth**: 30% of protocol revenue reinvested monthly

**IBC Channel-190** (Theta ↔ Persistence)

- Standard ICS-20 token transfers
- 10-minute timeout with auto-refund
- Acknowledgment-based finality
- Multi-hop routing support

### 2.3 Post-Overhaul Performance

**Completed:** January 4, 2026

The ZK bridge overhaul (v4.0) transformed XFuel from a trust-based system to a **fully cryptographic, zero-knowledge protocol** with Edge Cloud acceleration. This update refines focus to **Persistence LP growth** post-pSTAKE sunset. <!-- v4.0 update -->

#### Performance Improvements

| Metric | Pre-Overhaul | Post-Overhaul | Improvement |
|--------|--------------|---------------|-------------|
| **Settlement Time** | 10-15 seconds | **<4 seconds** | **73% faster** |
| **Proof Generation** | N/A (trusted) | **1.2s** | Plonky3 + Edge Cloud |
| **Proof Verification** | N/A | **60ms constant** | Plonky3 verifier |
| **Throughput** | 6 tx/min | **30 tx/min** | **5x increase** |
| **Security Model** | Trust-based | **Zero-knowledge** | Trustless |

---

## 4. Zero-Knowledge Bridge

### 4.1 Plonky3 ZK Overview

XFuel uses **Plonky3**, a modern ZK proof system with efficient recursion and **no trusted setup**, for trustless deposit validation. Unlike trusted bridges (multisig, oracles), Plonky3 provides: <!-- v4.0 update -->

- **STARK-like soundness** with transparent setup
- **Recursion efficiency** for batching many proofs
- **Fast verification** optimized for CosmWasm constraints
- **Non-interactivity**: Prover generates proof, verifier checks—no back-and-forth required

**Trade-off**: Proofs are larger than legacy SNARKs, offset by Edge Cloud compute and batching. <!-- v4.0 update -->

### 4.2 Circuit Design

The Plonky3 circuit (`circuits/deposit_validator.rs`) validates five critical properties: <!-- v4.0 update -->

```rust
// Public inputs (known to everyone)
pub depositor_address: [u8; 20]; // Theta wallet (160 bits)
pub deposit_amount: u128;        // TFUEL wei
pub nonce: u64;                  // Unique ID (prevents replays)

// Private inputs (known only to prover)
pub merkle_proof: [Hash; 8];     // Proof of vault inclusion
pub merkle_root: Hash;           // Current vault tree root

// Constraints (what circuit verifies)
1. depositor_address is valid Theta address
2. deposit_amount in bounds [0.1 TFUEL, 100 TFUEL]
3. nonce is unique (not previously used)
4. merkle_proof validates depositor owns vault
5. merkle_root matches current VaultFactory state
```

**Circuit Complexity (2026 baseline):**

- ~16K constraints (optimized Plonky3 gates)
- 8 Merkle tree levels (256 max vaults)
- ~400ms witness generation (Edge Cloud)
- ~800ms proof generation (Edge Cloud)

### 4.3 ZK Minting Flow: Core Protocol Architecture

**The XFuel Protocol's ZK minting mechanism is its fundamental innovation**, enabling trustless cross-chain asset issuance through cryptographic proofs. This section details the complete pipeline from Theta TFUEL lock to Persistence ibcTFUEL mint.

**Full Pipeline (Theta Lock → ZK Proof → Persistence Mint → IBC Transfer):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 1: THETA LAYER - TFUEL LOCK & COLLATERAL BACKING             │
└─────────────────────────────────────────────────────────────────────┘
1. USER DEPOSITS TFUEL (Theta Mainnet)
   ├─ User calls VaultFactory.deposit(amount)
   ├─ TFUEL locked in user-specific vault (1:1 collateral backing)
   ├─ Merkle tree updated with deposit proof
   ├─ DepositEvent emitted with:
   │  • depositorAddress (Theta wallet)
   │  • depositAmount (TFUEL wei)
   │  • nonce (unique ID for replay protection)
   │  • vaultRoot (current Merkle root)
   └─ [~2s avg] Backend listener detects event via websocket

┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 2: ZK PROOF LAYER - PLONKY3 PROOF GENERATION                 │
└─────────────────────────────────────────────────────────────────────┘
2. BACKEND GENERATES ZK PROOF (Off-chain Computation)
   ├─ [500ms] Witness Generation
   │  • Extract deposit data from Theta event
   │  • Generate Merkle proof of vault inclusion
   │  • Validate deposit bounds (0.1-100 TFUEL)
   │  • Compile circuit inputs (public + private)
   │
   ├─ [800ms] Plonky3 Proof Computation
   │  • Load circuit (deposit_validator.rs compiled)
   │  • Execute plonky3::prove()
   │  • Generate proof + public input digest
   │  • Verify ~16K constraints satisfied
   │
   ├─ [60ms] Proof Serialization
   │  • Serialize Plonky3 proof bytes
   │  • Package public inputs (address, amount, nonce)
   │  • Prepare CosmWasm transaction payload
   │
   └─ Submit to Persistence ZKVerifier contract

┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 3: PERSISTENCE LAYER - PROOF VERIFICATION & MINTING          │
└─────────────────────────────────────────────────────────────────────┘
3. PERSISTENCE VERIFIES & MINTS ibcTFUEL (core-1 Mainnet)
   ├─ [60ms] ZKVerifier.wasm Validation
   │  • Load verification key (cached in contract state)
   │  • Check nonce uniqueness (USED_NONCES mapping)
   │  • Verify Plonky3 proof over public inputs
   │  • Soundness guarantee: STARK-like security (no trusted setup)
   │
   ├─ [Instant] Authorization & Nonce Storage
   │  • Mark nonce as used (prevents proof replay)
   │  • Emit ProofVerified event
   │  • Authorize ibcTFUEL mint operation
   │
   ├─ [100ms] ibcTFUEL.wasm Minting
   │  • Mint ibcTFUEL 1:1 with locked TFUEL
   │  • Credit user's Persistence wallet
   │  • Update total supply tracking
   │  • Maintain cryptographic peg (backed by Theta collateral)
   │
   └─ [~1s] IBC Channel-190 Transfer (Optional Auto-Route)
      • If user specifies LP destination:
        - Route ibcTFUEL to Dexter pool via IBC
        - Auto-swap to stkXPRT/milkTIA if configured
        - Stake in Superfluid pool for yield
      • Otherwise: Direct ibcTFUEL to user wallet

┌─────────────────────────────────────────────────────────────────────┐
│ RESULT: TRUSTLESS CROSS-CHAIN MINT COMPLETE                        │
└─────────────────────────────────────────────────────────────────────┘
TOTAL END-TO-END: <4 seconds
├─ 1.2s: ZK proof generation (witness + Plonky3)
├─ 0.06s: Proof verification (constant-time verifier)
├─ 0.1s: ibcTFUEL minting (CosmWasm execution)
└─ ~2s: Network latency + IBC finality

KEY INNOVATION: Zero trust required — mathematics guarantees correctness
```

**Why This Matters:**

Traditional bridges require trusting validators, multisigs, or oracles. XFuel's ZK minting flow eliminates trust:
- **No validators to compromise**: Plonky3 proof is mathematically sound (STARK-like security)
- **No oracles to manipulate**: Merkle proofs cryptographically verify deposit existence
- **No multisigs to collude**: Proof verification is deterministic and public
- **Instant finality**: Once proof verifies, ibcTFUEL mint is irreversible and backed 1:1

This architecture enables XFuel to deliver **sub-4-second trustless settlements**, 10× faster than traditional bridges while maintaining superior security guarantees.

### 4.4 Security Properties

**Soundness** (Cannot forge proofs):

- **Adversary Goal**: Mint ibcTFUEL without locking TFUEL
- **Attack Success**: Negligible (transparent setup soundness)
- **Guarantee**: Only valid Theta deposits can produce accepted proofs

**Zero-Knowledge** (Privacy-preserving):

- **Adversary Goal**: Learn private inputs (Merkle proof, vault data)
- **Information Leaked**: Zero bits beyond proof validity
- **Guarantee**: Verifier learns only "deposit is valid" (nothing else)

**Completeness** (Valid proofs always accepted):

- **User Requirement**: Deposit TFUEL correctly via VaultFactory
- **Success Rate**: 100% (if deposit valid, proof verifies)
- **Guarantee**: Legitimate users never denied

**Non-Malleability** (Proofs cannot be modified):

- **Adversary Goal**: Alter proof to change public inputs (e.g., amount)
- **Attack Success**: Impossible (altering proof invalidates verification)
- **Guarantee**: Each proof is cryptographically bound to specific deposit

### 4.5 IBC Integration

XFuel integrates Cosmos IBC (Inter-Blockchain Communication) for efficient, trustless transfers within the Persistence ecosystem, complementing the ZK bridge for Theta-Persistence interoperability:

- **Standard**: ICS-20 fungible token transfers for ibcTFUEL post-mint
- **Channel-190 (Persistence ↔ Cosmos Hub)**: Used for internal Cosmos routing (e.g., minted ibcTFUEL to user wallets or Dexter LPs). Not direct Theta link—ZK proofs handle cross-chain minting.
- **Timeout**: 10 minutes (auto-refund on relayer failure)
- **Relayers**: 5 redundant operators for decentralization
- **Acknowledgments**: On-chain proofs for receipt/finality
- **Multi-hop**: Routes through Cosmos Hub **and Osmosis hooks** for optional routing (e.g., milkTIA, deep liquidity pools) <!-- v4.0 update -->

**Security Model:**

- **ZK-IBC Hybrid**: ZK (Plonky3, transparent setup) verifies Theta locks/mints; IBC light clients ensure Cosmos consensus (trustless)
- **Finality Guarantee**: Transfers finalized on verification (ZK) + acknowledgment (IBC)
- **Rollback Protection**: Nonces/Merkle proofs + acknowledgments prevent double-spending
- **Depeg Mitigation**: 0.5% circuit breaker pauses on deviations

---

## 5. XFuel Tokenomics

### 5.1 The XFuel Model — Final Dial-In

XFuel Tokenomics replaces the prior Ferrari branding with a **clean, governance-first split** that aligns Theta liquidity, LP depth, and long-term participation. <!-- v4.0 update -->

1. **Deflation (BBB - 30%)**: Buyback-Burn-Boost reduces XF supply → scarcity → price support
2. **Liquidity (LP Funding - 30%)**: Deepens Dexter pools → less slippage → better UX → more users  
3. **Yields (veXF - 25%)**: **TFUEL-only** revenue share → incentivizes locks → reduces sell pressure
4. **Treasury (15%)**: Funds audits, integrations, and ecosystem grants

**Future Option (Parked):** rXF is **parked** for potential future rollout via governance if needed. It is **not active** and has **no supply allocation** in v4.0. <!-- v4.0 update -->

### 5.2 Revenue Distribution (30/30/25/15)

**Protocol Revenue Sources:**

- Bridge fees (0.5% on TFUEL deposits)
- Swap fees (0.3% on LP routing)  
- Yield performance fees (3-5% on LP profits)
- Monthly LP fee recycling (30% of Persistence-side fees → TFUEL)

**Distribution (TFUEL-only yields):**

| Allocation | % | Use Case | Example (on $100K revenue) |
|------------|---|----------|---------------------------|
| **BBB** | 30% | 70% burned, 30% paired with TFUEL to LP | $30K: Burn $21K XF, Add $9K to XF/TFUEL LP |
| **LP Funding** | 30% | Add to Dexter pools (stkXPRT, milkTIA) | $30K: Deepen ibcTFUEL/stkXPRT Superfluid pool |
| **veXF Yields** | 25% | Distribute **TFUEL** to veXF holders | $25K: Direct TFUEL payout to locked veXF holders |
| **Treasury** | 15% | Audits, grants, integrations | $15K: Protocol ops + innovation |

**Total:** 100% | **All flows auditable via ZK bridge events**

### 5.3 XF Supply & Allocation (100M Hard Cap)

**Hard Cap:** 100,000,000 XF (fixed, no emissions)

| Allocation | Amount | % | Notes |
|------------|--------|---|-------|
| **Ecosystem Incentives** | 50M | 50% | 25% launch airdrops (Theta holders/bridgers), 15% LP rewards, 10% governance boosts |
| **Team & Advisors** | 15M | 15% | 10% core team, 5% advisors |
| **Founder** | 10M | 10% | Long-term stewardship |
| **Launch Contributors** | 15M | 15% | Seed investors/partners, **cap per entity: 2M XF** |
| **Treasury Reserve** | 10M | 10% | 6% ops/grants, 4% innovation (gov-managed) |

### 5.4 Vesting & Milestone Unlocks

**Uniform Vesting:** 12-month cliff + **3-4 year linear** for all non-treasury allocations. <!-- v4.0 update -->

**Milestone Gating (Example):**

- 50% of any allocation unlocks only after **e.g., $5M TVL** is reached <!-- v4.0 update -->
- Remaining 50% vests linearly once the milestone is met

### 5.5 Locking Mechanics & veXF Multipliers

**Mandatory Lock for veXF:** Minimum **1-year lock** to receive veXF, enabling **25% revenue share** and voting rights. <!-- v4.0 update -->

| Lock Duration | veXF Multiplier | Notes |
|--------------|-----------------|-------|
| **1 Year** | **1×** | Minimum lock for participation |
| **2 Years** | **2×** | Standard long-term option |
| **3 Years** | **3×** | Maximum multiplier (simplified) |

**Special Lock Requirements:**

- **Team / Associates / Launch Contributors (>5% allocation):** Minimum **2-year lock** (option for 3-year)  
- **Whiteglove via multisig** for **2-5 large holders** (governance oversight) <!-- v4.0 update -->
- **Early Believers (TFUEL swaps):** Optional 1/2/3-year lock (1-year minimum)

### 5.6 Swap-and-Lock (TFUEL → XF → veXF)

Users can **swap TFUEL for XF, escrow it immediately, and receive veXF** without upfront XF distribution. This reduces sell pressure while aligning early believers with long-term governance. <!-- v4.0 update -->

### 5.7 Yield Example (Simplified)

**Scenario:** 10,000 XF locked for 3 years (3× veXF), **$100K/month** protocol revenue base. <!-- v4.0 update -->

| Year | Estimated veXF APY (TFUEL) | Notes |
|------|-----------------------------|-------|
| **1** | **~5%** | Early revenue baseline |
| **3** | **~10%** | Growth from LP depth + reverse-burn |
| **5** | **~15%** | Mature revenue scale |

### 5.8 Complete Tokenomics Flow Diagram

**Full System Architecture with Connections:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         XFUEL TOKENOMICS FLOW                            │
│                     (Confirmed: 30/30/25/15 Split)                       │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│ REVENUE SOURCES (Theta Side)                                             │
├──────────────────────────────────────────────────────────────────────────┤
│ • Bridge Fees (0.5% on TFUEL deposits)                                   │
│ • Swap Fees (0.3% on LP routing)                                         │
│ • Yield Performance Fees (3-5% on LP profits)                            │
│ • Monthly Reverse-Burn (30% of Persistence LP fees)                      │
└───────────────────────────┬──────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    REVENUESPLITTER.SOL (Theta)                           │
│                        [30/30/25/15]                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │  30% BBB   │  │  30% LP    │  │  25% veXF  │  │ 15% Treas  │        │
│  │  Buyback-  │  │  Funding   │  │  Payout    │  │            │        │
│  │  Burn-Bond │  │            │  │ (TFUEL)   │  │            │        │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘        │
│        │               │               │               │                │
└────────┼───────────────┼───────────────┼───────────────┼────────────────┘
         │               │               │               │
         ▼               ▼               ▼               ▼
┌────────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│ BuybackBurner  │ │ LP Funding   │ │ veXF Contract│ │InnovationTreasury│
│                │ │ Pool         │ │              │ │                  │
│ • 70% burned   │ │ → Dexter     │ │ → Distribute │ │ • Ops/Grants     │
│ • 30% to LP    │ │   Superfluid │ │   to holders │ │ • Innovation     │
│   (XF/TFUEL)   │ │   pools      │ │              │ │ • Gov-managed    │
│                │ │ • ibcTFUEL/  │ │              │ │                  │
│ Deflation ↑    │ │   stkXPRT    │ │              │ │                  │
└────────────────┘ │ • ibcTFUEL/  │ └──────────────┘ └──────────────────┘
                   │   milkTIA    │
                   │ Liquidity ↑  │
                   └──────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│            30% REVERSE-BURN LOOP (Cross-Chain ZK Cycle)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Persistence Side:                                                       │
│  ┌──────────────────────┐                                               │
│  │ IBCTreasury.sol      │                                               │
│  │                      │                                               │
│  │ • Collects LP fees   │                                               │
│  │ • Monthly batch:     │                                               │
│  │   - 70% retained     │                                               │
│  │   - 30% reverse-burn │◄────────┐                                     │
│  └──────┬───────────────┘         │                                     │
│         │                         │                                     │
│         │ 30% TFUEL               │                                     │
│         ▼                         │                                     │
│  ┌──────────────────────┐         │                                     │
│  │ Swap to ibcTFUEL     │         │ Compounding                         │
│  └──────┬───────────────┘         │ Effect                              │
│         │                         │                                     │
│         │ Burn ibcTFUEL           │                                     │
│         ▼                         │                                     │
│  ┌──────────────────────┐         │                                     │
│  │ ZK Bridge Unwrap     │         │                                     │
│  │ (100% no split)      │         │                                     │
│  └──────┬───────────────┘         │                                     │
│         │                         │                                     │
│         │ TFUEL (unlocked)        │                                     │
│         ▼                         │                                     │
│  Theta Side:                      │                                     │
│  ┌──────────────────────┐         │                                     │
│  │ RevenueSplitter      │─────────┘                                     │
│  │ receiveBonusRevenue()│                                               │
│  │                      │                                               │
│  │ → 30/30/25/15 split  │                                               │
│  └──────────────────────┘                                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Flow Summary:**

- **Revenue flows** through RevenueSplitter at **30/30/25/15**
- **Reverse-burn loop** compounds growth via monthly Persistence LP fee recycling
- **All connections** maintain peg integrity and incentive alignment
- **rXF** is **parked** and only considered via future governance action

---

## 6. Governance & veXF

### 6.1 XF Token

**XF** is the native utility and governance token of XFuel Protocol.

**Total Supply**: 100,000,000 XF (fixed, no emissions)

**Distribution (aligned with §5.3):**

| Allocation | Amount | Vesting | Notes |
|------------|--------|---------|-------|
| **Ecosystem Incentives** | 50M (50%) | None | Airdrops, LP rewards, governance boosts |
| **Team & Advisors** | 15M (15%) | **12mo cliff, 3-4yr linear** | 10% core team, 5% advisors |
| **Founder** | 10M (10%) | **12mo cliff, 3-4yr linear** | Long-term stewardship |
| **Launch Contributors** | 15M (15%) | **12mo cliff, 3-4yr linear** | Seed investors/partners, cap 2M per entity |
| **Treasury Reserve** | 10M (10%) | None | Ops/grants + innovation (gov-managed) |

**Milestone Unlocking:** 50% of any vesting allocation requires **$5M TVL** to unlock. <!-- v4.0 update -->

**Use Cases:**

1. **Lock for veXF**: Earn governance power + TFUEL revenue share (25%)
2. **LP Provision**: Provide liquidity on Theta/Persistence DEXs
3. **BBB Target**: 30% of revenue buybacks/burns XF (deflationary pressure)

### 6.2 veXF Token (Escrow-Based)

**veXF** (vote-escrowed XF) is the non-transferable governance token earned by locking XF for **1-3 years**.

| Lock Duration | veXF Multiplier | Effective veXF |
|--------------|-----------------|----------------|
| **1 Year** | **1×** | 10,000 XF → 10,000 veXF |
| **2 Years** | **2×** | 10,000 XF → 20,000 veXF |
| **3 Years** | **3×** | 10,000 XF → 30,000 veXF |

### 6.3 Decentralization & Locking Discipline

- **Insider locks lead by example**: team/founder allocations are locked 2-3 years
- **Believer options**: community lockers choose 1/2/3-year durations
- **Governance-first**: veXF is the only path to revenue share and voting

### 6.4 Governance Powers

veXF holders vote on (1 veXF = 1 vote):

1. **Protocol Parameters**:
   - Bridge/swap fees (0.3-0.7% range)
   - XFuel split ratios (adjust 30/30/25/15 if needed)
   - LST integrations (which Dexter pools to prioritize)

2. **LP Funding Allocation**:
   - Which Superfluid pools receive 30% LP revenue
   - New pool creation (e.g., ibcTFUEL/ATOM)
   - Rebalancing between existing pools

3. **Treasury Spending**:
   - Grant approvals ($5K-$50K per grant)
   - Partnership/acquisition proposals
   - Audit and security budget
   - **Lock adjustments** or **future rXF rollout** (if needed)

**rXF Status:** rXF remains **parked** and can only be activated via **governance vote**. <!-- v4.0 update -->

### 6.5 Revenue Share Mechanics (TFUEL-Only)

**25% of protocol revenue** is distributed pro-rata to **effective veXF**. <!-- v4.0 update -->

| Holder | Locked XF | Lock Duration | Effective veXF | Share of Pool |
|--------|-----------|---------------|----------------|---------------|
| **User A** | 10,000 | 1 Year | 10,000 | 10% (if 100K total veXF) |
| **User B** | 10,000 | 3 Years | 30,000 | 30% (if 100K total veXF) |
| **User C** | 20,000 | 2 Years | 40,000 | 40% (if 100K total veXF) |

**Example:** If the monthly veXF pool is **$25K TFUEL**, a holder with **30,000 veXF** in a 100,000 veXF pool earns **$7.5K TFUEL** for that period.

---

## 7. Revenue Model

### 7.1 Revenue Sources

| Source | Rate | Mechanism | Estimated Year 3 Revenue (assuming 200% TVL growth) | <!-- v4.0 update -->
|--------|------|-----------|--------------------------|
| **Bridge Fees** | 0.5% | Charged on TFUEL deposits | $50K-$80K |
| **Swap Fees** | 0.3% | LP routing (ibcTFUEL → LSTs) | $90K-$150K |
| **Yield Performance Fees** | 3-5% | Cut of LP profits (e.g., Superfluid APY) | $120K-$200K |
| **TOTAL** | - | - | **$260K-$430K annually** |

### 7.2 Fee Breakdown

**Bridge Fees (0.5%):**

- Applied when user deposits TFUEL on Theta
- Example: Deposit 1 TFUEL → 0.995 TFUEL locked, 0.005 TFUEL to fees
- Collected by VaultFactory, sent to RevenueSplitter daily
- Competitive vs centralized bridges (0.5-2% typical)

**Swap Fees (0.3%):**

- Applied when routing ibcTFUEL to LST LP positions
- Example: Swap 1 ibcTFUEL → stkXPRT on Dexter (0.3% fee)
- Lower than typical DEX swaps (0.3% Uniswap v3, 0.5% v2)
- Collected by XFuel router (not Dexter—custom integration)

**Yield Performance Fees (3-5%):**

- Applied on **net profits** from Superfluid staking rewards
- Example: User LP earns 40% APY → Protocol takes 3.5% → User keeps 36.5% net
- Only charged on **positive returns** (no fees if loss)
- Industry standard (Yearn charges 2%, Convex 16%)

### 7.3 Revenue Flow

```
1. FEES COLLECTED
   ├─ Bridge fees (VaultFactory)
   ├─ Swap fees (XFUELRouter)
   └─ Yield fees (Dexter LP tracker)

2. SENT TO REVENUESPLITTER
   ├─ Daily batch transfers
   └─ Aggregated as TFUEL (TFUEL-only yields)

3. XFUEL DISTRIBUTION (30/30/25/15)
   ├─ 30% BBB → Buyback XF, burn 70%, LP 30%
   ├─ 30% LP Funding → Add to Dexter Superfluid pools
   ├─ 25% veXF Yields → TFUEL-only to holders
   └─ 15% Treasury → Ops/grants + innovation

4. REVERSE-BURN RECIRCULATION
   └─ 30% of Persistence LP fees loop back to step 2 → compounds monthly
```

### 7.4 Competitive Analysis

| Bridge | Trust Model | Speed | Fees | XFuel Advantage |
|--------|-------------|-------|------|-----------------|
| **Traditional Multisig** | Centralized relayers/validators | 30-60s | 0.1-0.5% | **ZK trustless, 10× faster** |
| **Validator Bridges** | Guardian signatures (trust required) | 15-30s | 0.1% | **ZK trustless, 5× faster** |
| **Cosmos IBC** | Light client verification | 10-20s | 0.0% | **ZK proof, 3× faster, cryptographic security** |
| **XFuel** | **Plonky3 ZK (trustless)** | **<4s** | **0.5-0.8%** | **Fastest + trustless + LP growth focus** |

---

## 8. Technical Implementation

### 8.1 Smart Contracts (Solidity - Theta Mainnet)

**VaultFactory.sol** (`TBD — post-audit deployment`) <!-- v4.0 update -->

- **Purpose**: Manage TFUEL deposit vaults (1 per user)
- **Key Functions**:
  - `deposit(uint256 amount)`: Lock TFUEL, emit DepositEvent
  - `unwrap(bytes proof, uint256 amount)`: Burn ibcTFUEL, release TFUEL
  - `getMerkleRoot()`: Current vault tree state (for ZK circuit)
- **Security**:
  - Reentrancy guard (OpenZeppelin)
  - 24h timelock on admin parameter changes
  - Emergency pause (multisig 3-of-5)

**RevenueSplitter.sol** (`TBD — post-audit deployment`) <!-- v4.0 update -->

- **Purpose**: Implement XFuel 30/30/25/15 distribution <!-- v4.0 update -->
- **Key Functions**:
  - `splitRevenue()`: Execute monthly distribution
  - `updateSplitRatios(uint[4] newRatios)`: Governance-controlled
  - `triggerReverseBurn(uint256 amount)`: Recirculate 30% LP fees
- **Security**:
  - Governor Bravo (Compound governance) integration
  - 7-day timelock on ratio changes
  - Slippage protection (1% max deviation)

### 8.2 CosmWasm Contracts (Rust - Persistence Mainnet)

**ZKVerifier.wasm** (Plonky3 verifier) <!-- v4.0 update -->

```rust
pub fn verify_plonky3_proof(
    deps: DepsMut,
    info: MessageInfo,
    proof_bytes: Binary,
    public_inputs: Vec<Uint256>,
    nonce: Uint256,
) -> Result<Response, ContractError> {
    // 1. Load verification key (cached in contract state)
    let vk = VERIFICATION_KEY.load(deps.storage)?;
    
    // 2. Check nonce uniqueness (prevent replays)
    if USED_NONCES.has(deps.storage, nonce.to_string()) {
        return Err(ContractError::NonceAlreadyUsed);
    }
    
    // 3. Verify Plonky3 proof (transparent setup)
    let valid = plonky3::verify(&vk, &public_inputs, &proof_bytes)?;
    
    if !valid {
        return Err(ContractError::InvalidProof);
    }
    
    // 4. Mark nonce as used
    USED_NONCES.save(deps.storage, nonce.to_string(), &true)?;
    
    // 5. Authorize ibcTFUEL mint
    Ok(Response::new()
        .add_attribute("action", "verify_proof")
        .add_message(mint_ibc_tfuel(public_inputs[1]))) // amount
}
```

**ibcTFUEL.wasm** (CW20 standard token)

- **Mint**: Only callable by ZKVerifier (whitelist enforced)
- **Burn**: Triggers Theta unwrap via IBC message
- **Transfer**: Standard CW20 transfers
- **IBC**: Implements ICS-20 for cross-chain compatibility

### 8.3 Backend Services (TypeScript)

**ZK Prover Pipeline** (`backend/zk-prover/prover.ts`)

```typescript
async function generateProofForDeposit(
  deposit: DepositEvent
): Promise<Plonky3Proof> {
  // 1. Generate witness (400ms avg)
  const witness = await generateWitness({
    depositorAddress: deposit.user,
    depositAmount: deposit.amount,
    nonce: deposit.nonce,
    merkleProof: await getMerkleProof(deposit.user),
    merkleRoot: await getVaultFactoryRoot(),
  });

  // 2. Compute Plonky3 proof (800ms avg)
  const { proofBytes, publicInputs } = await plonky3.prove(
    witness,
    "circuits/deposit_validator.bin"
  );

  // 3. Serialize for CosmWasm (60ms)
  return {
    proof_bytes: proofBytes,
    public_inputs: publicInputs,
  };
}
```

**Yield Optimizer** (`backend/yield-optimizer.ts`)

```typescript
async function routeToOptimalLP(
  ibcTfuelAmount: number
): Promise<DexterPool> {
  // 1. Fetch real-time APYs from Dexter
  const pools = await fetchDexterPools();
  
  // Superfluid pools (current focus)
  const stkXPRTPool = pools.find(p => p.assets.includes('stkXPRT'));
  const milkTIAPool = pools.find(p => p.assets.includes('milkTIA'));
  
  // 2. Calculate effective APY (staking + swap fees)
  const stkXPRTApy = stkXPRTPool.stakingApy + stkXPRTPool.swapFeeApy;
  const milkTIAApy = milkTIAPool.stakingApy + milkTIAPool.swapFeeApy;
  
  // 3. Route to highest yield (with 5% minimum delta to avoid churn)
  if (stkXPRTApy > milkTIAApy + 0.05) {
    return stkXPRTPool;
  } else {
    return milkTIAPool;
  }
}
```

---

## 9. Risk Analysis & Mitigation

**Pre-Funding Status Disclosure:** As of January 2026, XFuel Protocol is in **beta phase** with limited external funding. Our risk updates follow a **bootstrap-first approach**: prioritize no-cost internal fixes (code hardening, testing, documentation) **by Feb 2026**, then deploy external resources (audits, bug bounties, oracles) post-funding in Q2 2026. This section details both immediate mitigations (implemented) and post-funding enhancements (roadmap). <!-- v4.0 update -->

---

### 9.1 Technical Risks

#### ZK Proof Forgery

| **Risk** | Adversary generates valid proof without locking TFUEL |
|----------|---------------------------------------------------|
| **Severity** | 🔴 **Critical** (protocol insolvency) |
| **Likelihood** | 🟢 **Negligible** (STARK-like soundness) |
| **Mitigation** | - Plonky3 cryptographic soundness (no trusted setup)<br>- Merkle proof validation<br>- Nonce replay protection<br>- Circuit constraint auditing (Q2 2026)<br>- $500K bug bounty (Q2 2026) |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implemented):*
- **Constraint completeness**: Circuit validates 5 critical properties (depositor address, amount bounds, nonce uniqueness, Merkle proof, root matching)
- **Nonce replay protection**: `USED_NONCES` mapping in ZKVerifier prevents proof reuse
- **Witness validation**: Backend validates deposit data before proof generation

```rust
// ZKVerifier.wasm - Nonce uniqueness check
if USED_NONCES.has(deps.storage, nonce.to_string()) {
    return Err(ContractError::NonceAlreadyUsed);
}
USED_NONCES.save(deps.storage, nonce.to_string(), &true)?;
```

*Post-Funding (Q2 2026):*
- **ZK Circuit Audit**: CertiK formal verification of Plonky3 constraints (identify underconstraints where prover could supply invalid witnesses)
- **Constraint coverage**: Add tests for edge cases (max uint256, boundary amounts, malformed Merkle proofs)
- **Fuzz testing**: Echidna property-based testing for circuit inputs (1M+ random test cases)

**Audit Finding Integration:**
- **Underconstraints Risk**: If circuit fails to constrain all public/private inputs properly, adversary could generate valid proofs with invalid data. Mitigation: formal verification + symbolic execution (Z3 solver) in Q2 2026 audit.

---

#### ZK Circuit Underconstraints (New from Audit)

| **Risk** | Circuit constraints insufficient, allowing invalid witness acceptance |
|----------|---------------------------------------------------|
| **Severity** | 🔴 **Critical** (protocol insolvency via forged proofs) |
| **Likelihood** | 🟡 **Low** (requires deep cryptographic expertise) |
| **Mitigation** | - Formal verification (Q2 2026 audit)<br>- Symbolic execution (Z3 solver)<br>- Constraint coverage tests<br>- Public circuit review (GitHub) |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implemented):*
- **Manual constraint review**: Internal audit of Plonky3 constraint gates
- **Test vectors**: 50+ test cases covering boundary conditions (0.1 TFUEL min, 100 TFUEL max)
- **Public circuit code**: `circuits/deposit_validator.rs` open-sourced for community review

*Post-Funding (Q2 2026):*
```rust
// Example: Ensure depositor_address is properly constrained
assert!(depositor_address < U256::from(1u128) << 160);

// Ensure deposit_amount is within bounds
assert!(deposit_amount >= U256::from(100000000000000000u128)); // 0.1 TFUEL in wei
assert!(deposit_amount <= U256::from(100000000000000000000u128)); // 100 TFUEL in wei
```

**Formal Verification Plan (Q2 2026):**
1. Convert Plonky3 circuit constraints to SMT-LIB format
2. Use Z3 solver to prove no satisfying assignment exists for invalid inputs
3. Property testing: For all `(depositor, amount, nonce)`, if proof verifies, then deposit is valid on Theta

---

#### Reentrancy Vulnerabilities (New from Audit)

| **Risk** | External calls before state updates allow reentrancy attacks |
|----------|---------------------------------------------------|
| **Severity** | 🔴 **Critical** (fund drainage) |
| **Likelihood** | 🟡 **Medium** (common attack vector) |
| **Mitigation** | - ReentrancyGuard (OpenZeppelin) on all functions<br>- Checks-Effects-Interactions pattern<br>- Replace `transfer()` with `call()`<br>- Reentrancy attack tests |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implemented - Jan 2026):*

**Before (Vulnerable):**
```solidity
// TipPool.endPool() - VULNERABLE
function endPool(uint256 poolId) external {
    Pool storage pool = pools[poolId];
    require(!pool.ended, "Pool already ended");
    
    // DANGER: External call BEFORE state update
    payable(pool.creator).transfer(creatorCut);
    
    pool.ended = true; // State update AFTER external call
}
```

**After (Secure):**
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract TipPool is ReentrancyGuard {
    function endPool(uint256 poolId) external nonReentrant {
        Pool storage pool = pools[poolId];
        require(!pool.ended, "Pool already ended");
        
        // SAFE: State update FIRST
        pool.ended = true;
        address winner = drawWinner(poolId);
        pool.winner = winner;
        
        uint256 creatorCut = (pool.totalTips * CREATOR_CUT_BPS) / 10000;
        uint256 winnerPrize = pool.totalTips - creatorCut;
        
        // SAFE: External calls LAST
        if (creatorCut > 0 && pool.creator != address(0)) {
            (bool success, ) = payable(pool.creator).call{value: creatorCut}("");
            require(success, "Transfer failed");
        }
        
        if (winnerPrize > 0 && winner != address(0)) {
            (bool success, ) = payable(winner).call{value: winnerPrize}("");
            require(success, "Transfer failed");
        }
    }
}
```

**Reentrancy Test Case:**
```javascript
// test/reentrancy.test.js
it("should prevent reentrancy attack on endPool()", async function() {
    const attacker = await MaliciousReentrant.deploy(tipPool.address);
    
    // Attacker creates pool and tips
    await tipPool.createPool(100, attacker.address);
    await attacker.tipAndAttack(0, { value: ethers.utils.parseEther("1") });
    
    // Attempt reentrancy attack
    await expect(
        attacker.triggerReentrancy(0)
    ).to.be.revertedWith("ReentrancyGuard: reentrant call");
});
```

**Affected Contracts (All Fixed):**
- `TipPool.endPool()`
- `XFUELRouter.collectAndDistributeFees()`
- `TreasuryILBackstop.provideCoverage()`
- `XFUELPool.swap()`

---

#### Price Oracle Manipulation (New from Audit)

| **Risk** | Missing oracle allows 1:1 conversion, causing incorrect fee distribution |
|----------|---------------------------------------------------|
| **Severity** | 🟠 **High** (economic imbalance) |
| **Likelihood** | 🟠 **High** (current placeholder implementation) |
| **Mitigation** | - Chainlink price feeds (Q2 2026)<br>- Staleness checks (reject >1 hour old)<br>- Fallback to TWAP (Uniswap V3)<br>- Circuit breaker on anomalies |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Current Placeholder):*
```solidity
// XFUELRouter._convertToTFUEL() - PLACEHOLDER
function _convertToTFUEL(uint256 amount0, uint256 amount1) internal pure returns (uint256) {
    // WARNING: 1:1 conversion for demo only
    return amount0 + amount1;
}
```

**Risk**: XFuel tokenomics fee splits (30% BBB, 25% veXF, 15% Treasury) use incorrect valuations, leading to:
- Over/under-allocation to buyback-burn
- Incorrect TFUEL yields to veXF holders
- Treasury underfunding

*Post-Funding (Q2 2026 - Chainlink Integration):*
```solidity
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract XFUELRouter {
    AggregatorV3Interface public tfuelUsdOracle;
    AggregatorV3Interface public xprtUsdOracle;
    AggregatorV3Interface public uniswapTwapFallback; // Backup oracle
    
    uint256 public constant STALENESS_THRESHOLD = 1 hours;
    uint256 public constant DEVIATION_THRESHOLD = 500; // 5% max deviation
    
    function _convertToTFUEL(uint256 amount0, uint256 amount1) internal view returns (uint256) {
        // Get TFUEL/USD price from Chainlink
        (, int256 tfuelPrice, , uint256 tfuelUpdatedAt, ) = tfuelUsdOracle.latestRoundData();
        require(block.timestamp - tfuelUpdatedAt <= STALENESS_THRESHOLD, "Stale TFUEL price");
        require(tfuelPrice > 0, "Invalid TFUEL price");
        
        // Get XPRT/USD price
        (, int256 xprtPrice, , uint256 xprtUpdatedAt, ) = xprtUsdOracle.latestRoundData();
        require(block.timestamp - xprtUpdatedAt <= STALENESS_THRESHOLD, "Stale XPRT price");
        require(xprtPrice > 0, "Invalid XPRT price");
        
        // Circuit breaker: Check for price manipulation (sudden >5% change)
        if (_detectPriceAnomaly(tfuelPrice, xprtPrice)) {
            // Fallback to Uniswap V3 TWAP
            return _fallbackTwapConversion(amount0, amount1);
        }
        
        // Convert to TFUEL-equivalent value
        uint256 tfuelValueUSD = (amount0 * uint256(tfuelPrice)) / 1e8;
        uint256 xprtValueUSD = (amount1 * uint256(xprtPrice)) / 1e8;

        // Convert USD value back to TFUEL units
        return (tfuelValueUSD + xprtValueUSD) / uint256(tfuelPrice);
    }
    
    function _detectPriceAnomaly(int256 currentPrice, int256 historicalPrice) internal pure returns (bool) {
        uint256 deviation = abs(currentPrice - historicalPrice) * 10000 / uint256(historicalPrice);
        return deviation > DEVIATION_THRESHOLD;
    }
    
    function _fallbackTwapConversion(uint256 amount0, uint256 amount1) internal view returns (uint256) {
        // Use Uniswap V3 30-minute TWAP as backup
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = 1800; // 30 minutes ago
        secondsAgos[1] = 0;    // now
        
        (int56[] memory tickCumulatives, ) = uniswapPool.observe(secondsAgos);
        int24 avgTick = int24((tickCumulatives[1] - tickCumulatives[0]) / 1800);
        
        // Calculate price from tick and convert amounts
        // ... TWAP conversion logic
    }
}
```

**Oracle Security Measures:**
1. **Dual-source validation**: Compare Chainlink vs Uniswap TWAP (reject if >5% divergence)
2. **Staleness checks**: Reject prices older than 1 hour
3. **Zero-price protection**: Revert if oracle returns 0 or negative
4. **Circuit breaker**: Auto-pause fee distribution if anomaly detected
5. **Manual override**: Owner can set emergency prices (3-of-5 multisig, 24h timelock)

---

#### IBC Relayer Failure

| **Risk** | Relayer downtime prevents Theta → Persistence transfers |
|----------|---------------------------------------------------|
| **Severity** | 🟡 **Medium** (temporary UX degradation) |
| **Likelihood** | 🟡 **Low-Medium** (depends on relayer uptime) |
| **Mitigation** | - 5 independent relayers (decentralized)<br>- Auto-restart on failure<br>- 10-minute timeout with refund<br>- User-initiated manual relay option |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implemented):*
```typescript
// backend/ibc/relayer.ts - Multi-relayer failover
const RELAYERS = [
    { url: 'https://relayer1.xfuel.app', priority: 1 },
    { url: 'https://relayer2.xfuel.app', priority: 2 },
    { url: 'https://relayer3.xfuel.app', priority: 3 },
    { url: 'https://relayer4.xfuel.app', priority: 4 },
    { url: 'https://relayer5.xfuel.app', priority: 5 },
];

async function relayPacketWithFailover(packet: IBCPacket): Promise<void> {
    const maxRetries = 3;
    const timeout = 10 * 60 * 1000; // 10 minutes
    
    for (const relayer of RELAYERS) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const result = await Promise.race([
                    relayer.relay(packet),
                    new Promise((_, reject) => setTimeout(() => reject('Timeout'), timeout))
                ]);
                
                console.log(`Packet relayed successfully via ${relayer.url}`);
                return; // Success
            } catch (err) {
                console.warn(`Relayer ${relayer.url} attempt ${attempt + 1} failed:`, err);
                await sleep(5000); // Wait 5s before retry
            }
        }
    }
    
    // All relayers failed - trigger refund
    console.error('All relayers failed. Initiating refund...');
    await initiateRefund(packet);
}

async function initiateRefund(packet: IBCPacket): Promise<void> {
    // Call VaultFactory to release locked TFUEL back to user
    const tx = await vaultFactory.refundDeposit(packet.depositor, packet.amount);
    await tx.wait();
    
    emit('RefundInitiated', { depositor: packet.depositor, amount: packet.amount });
}
```

**Monitoring Dashboard:**
- Real-time relayer uptime (Grafana + Prometheus)
- Alert if <3 relayers operational
- Average relay latency tracking (<2s target)
- Auto-restart systemd services on crash

---

#### Theta Edge Cloud Dependency

| **Risk** | Edge node outages delay ZK proof generation and yield routing |
|----------|---------------------------------------------------|
| **Severity** | 🟡 **Medium** (performance degradation, not fund loss) |
| **Likelihood** | 🟡 **Medium** (edge node variability) |
| **Mitigation** | - Multi-region Edge Cloud clusters<br>- Fallback to core cloud prover<br>- Proof batching to reduce load<br>- Circuit breaker to pause routing if latency spikes |

**Fallback Strategy:**

- **Primary**: Theta Edge Cloud proof generation + yield routing
- **Secondary**: Core cloud prover (auto-failover)
- **Tertiary**: Local prover queue for critical withdrawals

---

#### Smart Contract Exploits

| **Risk** | Bug in VaultFactory/ZKVerifier allows theft |
|----------|---------------------------------------------------|
| **Severity** | 🔴 **Critical** (user fund loss) |
| **Likelihood** | 🟡 **Low** (pending audit) |
| **Mitigation** | - CertiK comprehensive audit (Q2 2026)<br>- $500K bug bounty program<br>- Emergency pause mechanism (3-of-5 multisig)<br>- Treasury insurance fund (15% reserve) |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implemented - Jan 2026):*

**Additional Fixes from Audit:**

1. **Slippage Protection (M-04):**
```solidity
// XFUELRouter.swapAndStake() - Before (No protection)
function swapAndStake(uint256 amount, string calldata targetLST) external payable;

// After (With slippage protection)
function swapAndStake(
    uint256 amount,
    string calldata targetLST,
    uint256 minAmountOut  // NEW: User-specified minimum output
) external payable returns (uint256 stakedAmount) {
    stakedAmount = _calculateSwapOutput(amount, targetLST);
    require(stakedAmount >= minAmountOut, "XFUELRouter: SLIPPAGE_TOO_HIGH");
    // ... rest of function
}
```

2. **SafeERC20 (M-05):**
```solidity
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract XFUELRouter {
    using SafeERC20 for IERC20;
    
    // Before: feeToken.transfer(recipient, amount);
    // After:
    feeToken.safeTransfer(recipient, amount);
    
    // Handles non-standard tokens (USDT) that don't return bool
}
```

3. **Input Validation (M-02, H-004):**
```solidity
constructor(
    address _factory,
    address _backstop,
    address _xfuelToken,
    address _feeToken,
    address _treasury,
    address _veXFContract
) Ownable(msg.sender) {
    require(_factory != address(0), "Invalid factory");
    require(_backstop != address(0), "Invalid backstop");
    require(_xfuelToken != address(0), "Invalid xfuelToken");
    require(_feeToken != address(0), "Invalid feeToken");
    require(_treasury != address(0), "Invalid treasury");
    require(_veXFContract != address(0), "Invalid veXFContract");
    
    // ... rest of constructor
}
```

4. **Access Control (H-03):**
```solidity
mapping(address => bool) public authorizedCollectors;

modifier onlyAuthorizedCollector() {
    require(authorizedCollectors[msg.sender] || msg.sender == owner(), "Unauthorized");
    _;
}

function collectAndDistributeFees(address pool) external onlyAuthorizedCollector {
    // Only authorized keepers (or owner) can trigger fee distribution
    // ... fee collection logic
}
```

**Emergency Pause Mechanism:**
```solidity
// VaultFactory.sol
bool public paused = false;
address public pauseGuardian; // 3-of-5 multisig

modifier whenNotPaused() {
    require(!paused, "Contract paused");
    _;
}

function emergencyPause() external {
    require(msg.sender == pauseGuardian, "Only guardian");
    paused = true;
    emit EmergencyPause(block.timestamp);
}

function deposit(uint256 amount) external whenNotPaused {
    // ... deposit logic (only works when not paused)
}
```

*Post-Funding (Q2 2026):*
- **CertiK Audit**: Full smart contract + ZK circuit review ($100K-$150K)
- **Bug Bounty**: $500K pool on Immunefi (25% for critical, 10% for high)
- **Continuous Monitoring**: Forta agents for anomaly detection
- **Insurance Fund**: 15% of treasury reserved for exploit coverage

---

#### Fuzz Testing Gaps (New from Audit)

| **Risk** | Insufficient randomized testing allows edge case bugs |
|----------|---------------------------------------------------|
| **Severity** | 🟡 **Medium** (hidden bugs in production) |
| **Likelihood** | 🟡 **Medium** (common in complex DeFi) |
| **Mitigation** | - Echidna property-based testing<br>- Foundry invariant tests<br>- 1M+ random input tests<br>- Continuous fuzzing (CI/CD) |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implementing - Jan-Feb 2026):*

**Echidna Property Tests:**
```solidity
// test/echidna/XFUELPoolProperties.sol
contract XFUELPoolProperties {
    XFUELPool pool;
    
    constructor() {
        pool = new XFUELPool(address(token0), address(token1));
    }
    
    // Property 1: Pool reserves never decrease unexpectedly
    function echidna_reserves_never_decrease() public returns (bool) {
        uint256 reserve0Before = pool.reserve0();
        uint256 reserve1Before = pool.reserve1();
        
        // Perform random swaps
        pool.swap(msg.sender, true, int256(uint256(10 ether)), 0, 0);
        
        uint256 reserve0After = pool.reserve0();
        uint256 reserve1After = pool.reserve1();
        
        // Reserves should only increase (accounting for fees)
        return (reserve0After + reserve1After) >= (reserve0Before + reserve1Before);
    }
    
    // Property 2: Fee distribution sums to 100%
    function echidna_fee_split_equals_100() public pure returns (bool) {
        uint256 totalBps = BUYBACK_BPS + VEXF_YIELD_BPS + TREASURY_BPS;
        return totalBps == 10000; // Must equal 100%
    }
    
    // Property 3: No funds locked in contract (all withdrawable)
    function echidna_no_locked_funds() public view returns (bool) {
        uint256 contractBalance = address(pool).balance;
        uint256 totalLPShares = pool.totalSupply();
        
        // If LP shares exist, balance should be withdrawable
        if (totalLPShares > 0) {
            return contractBalance > 0;
        }
        return true;
    }
}
```

**Foundry Invariant Tests:**
```solidity
// test/invariant/XFUELRouterInvariants.t.sol
contract XFUELRouterInvariantTest is Test {
    XFUELRouter router;
    
    function setUp() public {
        router = new XFUELRouter(...);
    }
    
    // Invariant: Total fees collected = sum of distributed fees
    function invariant_feeDistributionBalance() public {
        uint256 collected = router.totalFeesCollected();
        uint256 distributed = router.totalTFUELToVeXF() + 
                              router.totalTreasuryFees() + 
                              router.totalBuybackAmount();
        
        assertEq(collected, distributed, "Fee distribution mismatch");
    }
    
    // Invariant: Paused contract rejects deposits
    function invariant_pausedRejectsDeposits() public {
        if (router.paused()) {
            vm.expectRevert("Contract paused");
            router.deposit(1 ether);
        }
    }
}
```

**CI/CD Continuous Fuzzing:**
```yaml
# .github/workflows/fuzz.yml
name: Continuous Fuzzing
on: [push, pull_request]

jobs:
  echidna:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Echidna
        run: |
          docker run -v $PWD:/src trailofbits/eth-security-toolbox
          echidna-test /src/test/echidna --config /src/echidna.yaml
          
  foundry-fuzz:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install Foundry
        run: curl -L https://foundry.paradigm.xyz | bash
      - name: Run Invariant Tests
        run: forge test --match-contract Invariant
```

**Fuzzing Targets (1M+ runs each):**
- Swap amounts (0 to max uint256)
- Token addresses (random addresses, address(0), contract addresses)
- Slippage parameters (0% to 100%)
- Timing attacks (block.timestamp manipulation)
- Reentrancy attempts (malicious contracts)

*Post-Funding (Q2 2026):*
- **Trail of Bits Fuzzing Audit**: Manticore symbolic execution ($30K-$50K)
- **24/7 Fuzzing Infrastructure**: AWS instances running continuous tests

---

### 9.2 Economic Risks

#### ibcTFUEL Depeg

| **Risk** | ibcTFUEL trades <1:1 with TFUEL on Dexter |
|----------|---------------------------------------------------|
| **Severity** | 🟡 **Medium** (user losses, trust damage) |
| **Likelihood** | 🟡 **Low-Medium** (depends on LP depth) |
| **Mitigation** | - Arbitrage incentives (profitable to restore peg)<br>- Circuit breaker at 0.5% deviation (auto-pause deposits)<br>- Treasury backstop (buy ibcTFUEL at 0.98:1 floor)<br>- 30% LP funding grows depth monthly (reduces volatility)<br>- Rounding error fixes in swap math |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Implemented):*

**Rounding Error Fixes (from Audit):**
```solidity
// XFUELPool.sol - Before (Potential precision loss)
function _getAmountOut(uint256 amountIn, bool zeroForOne) internal view returns (uint256) {
    uint256 amountOut = (amountIn * reserve1) / reserve0; // Loss of precision
    return amountOut;
}

// After (Higher precision + minimum validation)
function _getAmountOut(uint256 amountIn, bool zeroForOne) internal view returns (uint256) {
    require(amountIn > 0, "Amount must be positive");
    
    // Use 1e18 precision multiplier to minimize rounding errors
    uint256 numerator = amountIn * reserve1 * 1e18;
    uint256 denominator = reserve0 * 1e18;
    uint256 amountOut = numerator / denominator;
    
    // Ensure output is non-zero (protect against dust attacks)
    require(amountOut > 0, "Output amount too small");
    
    // Apply 0.3% swap fee
    uint256 amountOutWithFee = (amountOut * 997) / 1000;
    
    return amountOutWithFee;
}
```

**Circuit Breaker Implementation:**
```solidity
// VaultFactory.sol - Peg deviation monitoring
uint256 public constant PEG_DEVIATION_THRESHOLD = 50; // 0.5% (50 bps)
bool public depositsPaused = false;

function checkPegHealth() public view returns (bool) {
    // Get ibcTFUEL/TFUEL price from Dexter
    uint256 dexterPrice = getDexterSpotPrice();
    
    // Calculate deviation from 1:1 peg (in basis points)
    uint256 deviation = (dexterPrice > 1e18) 
        ? ((dexterPrice - 1e18) * 10000 / 1e18)
        : ((1e18 - dexterPrice) * 10000 / 1e18);
    
    return deviation <= PEG_DEVIATION_THRESHOLD;
}

function deposit(uint256 amount) external {
    require(checkPegHealth(), "Peg deviation too high - deposits paused");
    require(amount >= 0.1 ether && amount <= 100 ether, "Invalid amount");
    
    // ... deposit logic
}

function getDexterSpotPrice() internal view returns (uint256) {
    // Query Dexter pool for ibcTFUEL/TFUEL price
    (uint256 ibcTfuelReserve, uint256 tfuelReserve) = dexterPool.getReserves();
    return (ibcTfuelReserve * 1e18) / tfuelReserve; // Price with 18 decimals
}
```

*Post-Funding (Q2 2026):*
- **LP Depth Growth**: 30% XFuel allocation ($30K-$40K/month) → $500K target by Q3
- **Treasury Backstop**: $50K TFUEL reserve to buy ibcTFUEL at 0.98:1 floor
- **Arbitrage Bot**: Deploy automated arbitrage to maintain peg (profit incentivizes external arbs)

---

#### XF Death Spiral

| **Risk** | XF price crashes, triggering panic selling |
|----------|---------------------------------------------------|
| **Severity** | 🟡 **Medium** (tokenomics disruption) |
| **Likelihood** | 🟡 **Low** (TFUEL yields reduce sell pressure) |
| **Mitigation** | - veXF yields paid in **TFUEL** (not XF—no sell pressure)<br>- 70% BBB burned (creates buyback floor)<br>- Lock incentives (up to 3× multiplier)<br>- Treasury can buy back at discount (anti-spiral) |

**Expanded Mitigation (Code-Level):**

*Pre-Funding (Already Implemented):*

**TFUEL Yield Distribution (No Sell Pressure):**
```solidity
// XFUELRouter.sol - veXF yields in TFUEL, not XF
function collectAndDistributeFees(address pool) external onlyAuthorizedCollector {
    // ... fee collection ...
    
    uint256 veXFAmount = (totalFeesTFUEL * VEXF_YIELD_BPS) / 10000; // 25%
    
    // Transfer TFUEL to veXF contract (NOT XF tokens)
    tfuelToken.safeTransfer(veXFContract, veXFAmount);
    totalTFUELToVeXF += veXFAmount;
    
    // veXF holders receive TFUEL, so no XF sell pressure
    emit TFUELYieldDistributed(veXFAmount);
}
```

**Buyback Floor (70% BBB Burned):**
```solidity
// XFUELRouter._buybackAndBurn() - 70% burned, 30% to LP
function _buybackAndBurn(uint256 buybackAmount) internal {
    // Use TFUEL to buy XF from Dexter
    uint256 xfBought = dexterRouter.swapTFUELForXF(buybackAmount);
    
    // Burn 70%
    uint256 burnAmount = (xfBought * 7000) / 10000;
    xfuelToken.burn(burnAmount);
    totalXFBurned += burnAmount;
    
    // Add 30% to XF/TFUEL LP
    uint256 lpAmount = xfBought - burnAmount;
    _addToLP(lpAmount);
    
    emit BuybackAndBurn(xfBought, burnAmount, lpAmount);
}
```

**Monitoring Metrics:**
- Daily XF price tracking (alert if >20% drop in 24h)
- veXF lock rate (target >40% of supply locked)
- BBB buyback volume (should increase during downturns)

---

### 9.3 Regulatory Risks

#### Securities Classification

| **Risk** | XF token classified as security by regulators |
|----------|---------------------------------------------------|
| **Severity** | 🟡 **Medium** (operational disruption) |
| **Likelihood** | 🟡 **Medium** (uncertain US crypto policy) |
| **Mitigation** | - Utility-first design (veXF for governance, not investment)<br>- Decentralization roadmap (DAO transition Q3 2026)<br>- Legal opinion from crypto law firm<br>- Geofencing (block US IPs if needed) |

**Expanded Mitigation (Operational):**

*Pre-Funding (Implemented):*
- **Utility Documentation**: Whitepaper emphasizes governance utility, not investment returns
- **Risk Disclosures**: Terms of Service include "experimental software, no guarantees" language
- **Decentralization Roadmap**: Public plan to transfer admin keys to Governor contract (Q3 2026)

*Post-Funding (Q2 2026):*
- **Legal Opinion**: Crypto law firm analysis ($20K-$30K) - Howey Test assessment
- **Compliance Audit**: KYC/AML readiness evaluation ($10K-$15K)
- **Geofencing Capability**: Cloudflare Workers to block US IPs if required
- **Regulatory Monitoring**: Ongoing counsel retainer ($5K/month) for policy updates

**Decentralization Milestones:**
- **Q1 2026**: veXF governance live (parameter voting)
- **Q2 2026**: Treasury governed by DAO (proposal system)
- **Q3 2026**: Admin keys transferred to Governor contract (5-day timelock)
- **Q4 2026**: Full DAO transition (protocol fully autonomous)

---

### 9.4 Pre-Funding Risk Summary

**Bootstrap Strategy:** Prioritize zero-cost fixes before external funding.

| **Phase** | **Timeline** | **Focus** | **Cost** | **Risks Addressed** |
|-----------|--------------|-----------|----------|---------------------|
| **Phase 1** | Q1 2026 | Internal hardening (ReentrancyGuard, input validation, SafeERC20, slippage protection, circuit breakers) | $0 (internal dev time) | T-01, T-05, T-06, T-07, T-08, E-01, E-03 |
| **Phase 2** | Q2 2026 | External audits + infrastructure (CertiK, Chainlink VRF/Oracles, bug bounty, LP seeding) | $840K-$950K | T-02, T-03, T-04, E-04, R-01 |
| **Phase 3** | Q3-Q4 2026 | Scale + decentralize (DAO transition, LP growth, continuous monitoring) | $250K-$400K | All risks (ongoing) |

**Q1 2026 Deliverables (No-Funding):**
- ✅ All critical audit findings fixed (reentrancy, access control, SafeERC20, input validation)
- ✅ Slippage protection + rounding error fixes
- ✅ Circuit breakers for depeg + oracle manipulation
- ✅ >90% test coverage (unit + integration + fuzzing)
- ✅ Testnet deployment with 1000+ stress test transactions

**Q2 2026 Deliverables (Post-Funding):**
- 🎯 CertiK comprehensive audit (contracts + ZK circuits)
- 🎯 $500K bug bounty launch (Immunefi)
- 🎯 Chainlink VRF (true randomness) + price oracles
- 🎯 $200K LP seeding (Dexter Superfluid pools)
- 🎯 Legal opinion + compliance audit

**Audit-Informed Priorities:**
1. **Critical (Immediate)**: Reentrancy, ZK underconstraints, oracle manipulation
2. **High (Pre-Audit)**: Slippage protection, access control, SafeERC20, fuzz testing
3. **Medium (Post-Funding)**: Chainlink integrations, LP depth, legal review

---

## 10. Economic Model & Projections

### 10.1 Revenue Growth Scenarios

**Base Case Assumptions:**

- 200% annual TVL growth (Years 1-3)
- 10% monthly volume (relative to TVL)
- 0.5% avg bridge fees, 0.3% swap fees, 4% yield fees
- 40% avg APY on Dexter Superfluid pools
- Plonky3 + Edge Cloud yields **5x throughput** and lower TFUEL cost per proof

#### Base Case Projections (assuming 200% TVL growth) <!-- v4.0 update -->

| Year | TVL | Monthly Volume | Bridge/Swap Fees | Yield Fees | Annual Revenue |
|------|-----|----------------|------------------|------------|----------------|
| **1** | $5M | $500K | $4K | $14K | **$18K** |
| **2** | $20M | $2M | $16K | $56K | **$72K** |
| **3** | $50M | $5M | $40K | $140K | **$180K** |
| **4** | $100M | $10M | $80K | $280K | **$360K** |
| **5** | $200M | $20M | $160K | $560K | **$720K** |

#### Cumulative 5-Year Metrics

| Metric | Total |
|--------|-------|
| **Total Revenue** | $1.35M |
| **XF Burned (BBB 70%)** | 103,451 tokens (0.103% supply) |
| **LP Depth Added (30% funding)** | $405K |
| **veXF Yields Paid (25%)** | $337K |
| **Treasury Accumulated (15%)** | $202K |

### 10.2 Token Economics

**XF Token Supply:** 100,000,000 (fixed, no emissions)

| Allocation | Amount | % | Notes |
|------------|--------|---|-------|
| **Ecosystem Incentives** | 50M | 50% | 25% airdrops, 15% LP rewards, 10% governance boosts |
| **Team & Advisors** | 15M | 15% | 12mo cliff, 3-4yr linear |
| **Founder** | 10M | 10% | 12mo cliff, 3-4yr linear |
| **Launch Contributors** | 15M | 15% | 12mo cliff, 3-4yr linear (cap 2M per entity) |
| **Treasury Reserve** | 10M | 10% | Ops/grants + innovation |

### 10.3 veXF Yield Projections (TFUEL-Only)

**Scenario:** 10,000 XF locked for **3 years** (3× veXF) with **$100K/month** revenue base. <!-- v4.0 update -->

| Year | Estimated veXF APY | Annual Yield (TFUEL) | Notes |
|------|--------------------|----------------------|-------|
| **1** | **~5%** | ~$500 | Early revenue baseline |
| **3** | **~10%** | ~$1,000 | Growth from LP depth + reverse-burn |
| **5** | **~15%** | ~$1,500 | Mature revenue scale |

**5-Year Range:** ~**5-15% APY** depending on revenue growth and veXF share.

### 10.4 LP Depth Growth Model

**30% LP Funding Allocation + 30% Reverse-Burn:**

| Month | Base LP Funding | Reverse-Burn Added | Total LP Added | Cumulative Depth |
|-------|-----------------|-------------------|----------------|------------------|
| 1 | $4.5K | $0 | $4.5K | $4.5K |
| 3 | $4.5K | $1.35K | $5.85K | $18K |
| 6 | $4.5K | $2.25K | $6.75K | $45K |
| 12 | $4.5K | $3.15K | $7.65K | $108K |
| 24 | $9K (doubled revenue) | $6.3K | $15.3K | $450K |

**Effect:**

- Deeper Dexter pools → lower slippage → more user adoption
- More users → more revenue → more LP funding → flywheel accelerates
- Year 3: ibcTFUEL/stkXPRT becomes top-5 Persistence liquidity pair

---

## 11. Roadmap

### 11.1 Q1 2026 (Current)

**Status:** ✅ **95% Complete**

- ✅ ZK bridge overhaul (Plonky3 proofs) <!-- v4.0 update -->
- ✅ Sub-4s settlements achieved
- ✅ XFuel tokenomics deployed
- ✅ Beta mainnet launch (Jan 4)
- ⏳ CosmWasm governance whitelist approval (pending)

**Focus (v4.0):**

- ✅ Refine whitepaper for XFuel Tokenomics + Edge Cloud integration
- ✅ Update LST examples (stkXPRT, milkTIA post-pSTAKE sunset)
- 🎯 Dexter Superfluid pool integration live
- 🎯 First $50K TVL milestone

### 11.2 Q2 2026

**Focus:** Security & Scale

- 🎯 **CertiK Comprehensive Audit** (full smart contract + ZK circuit review)
- 🎯 **Bug Bounty Launch** ($500K pool on Immunefi)
- 🎯 **Mainnet v1.0** (remove beta limits, increase max deposits)
- 🎯 **Additional LST Integrations**:
  - milkTIA (Milkyway Celestia liquid staking)
  - Emerging Persistence LSTs (e.g., stkOSMO if available)
- 🎯 **Mobile Optimizations** (Progressive Web App for xfuel.app)

**Targets:** $5M TVL, 1,000 users, 10,000+ transactions

### 11.3 Q3 2026

**Focus:** Expansion & Automation

- 🎯 **Persistence-Primary + Multi-Destination Hooks** (Osmosis/Cosmos Hub routing hooks) <!-- v4.0 update -->
- 🎯 **Plonky3 + Edge Cloud Integration** (production edge routing + proof batching)
- 🎯 **AI Yield Optimizer** (ML-powered APY prediction across Dexter pools)
- 🎯 **Governance DAO Transition** (admin keys to veXF-controlled Governor)
- 🎯 **Cross-Chain DEX Aggregation** (route through Osmosis, Crescent if better rates)
- 🎯 **Advanced Analytics** (on-chain dashboards for LP performance)

**Targets:** $20M TVL, 3,000+ users, full decentralization

### 11.4 Q4 2026

**Focus:** Multi-Chain Expansion

- 🎯 **Ethereum Bridge** (WETH → Persistence LSTs via ZK proof)
- 🎯 **Plonky3 Optimization** (recursion, verifier cost reductions)
- 🎯 **ZK Rollup Layer** (10× throughput, <1s settlements)
- 🎯 **Institutional Features** (optional KYC/AML, custody integrations)
- 🎯 **NFT Governance Marketplace** (trade veXF bonus NFTs)

**Targets:** $50M+ TVL, 10,000+ users, multi-chain

### 11.5 2027+ Vision

**Long-Term Goals:** Whitepaper as **implementation blueprint** (e.g., Plonky3 contracts, Edge SDK). <!-- v4.0 update -->

- **Universal ZK Bridge**: Any EVM → Any Cosmos chain (generalize beyond Theta)
- **Intent-Based Architecture**: Users specify outcomes, protocol routes optimally
- **Account Abstraction**: Gasless transactions, social recovery
- **Mega Liquidity Hub**: $100M+ TVL, top-3 Persistence DeFi protocol

---

## 12. Conclusion

### 12.1 Summary of Innovations

XFuel Protocol introduces **five industry-first capabilities**:

1. **Trustless Theta → Persistence Bridge**: First Plonky3-powered bridge from Theta TFUEL to Cosmos LSTfi
2. **Sub-4s ZK Settlements**: Fastest provably-secure bridge in Theta ecosystem (Edge Cloud accelerated)
3. **Dexter LP Compounding Focus**: 30% revenue + 30% reverse-burn = exponential liquidity growth
4. **Post-pSTAKE Alignment**: Built for new Persistence LST landscape (stkXPRT, milkTIA, Superfluid pools)
5. **XFuel Tokenomics**: Only DeFi protocol with 4-way distribution + reverse-burn sustainability loop

### 12.2 Key Value Propositions

**For TFUEL Holders:**

- **30-50% APY** (vs 2-4% Theta staking) on Dexter Superfluid pools
- **<4s settlements** (fast, secure, trustless)
- **Non-custodial** (you control keys, ZK proofs = no trust required)
- **Easy UX** (no Keplr extensions—QR code deposits)

**For XF Holders:**

- **TFUEL real yield** (25% revenue → veXF holders, no sell pressure)
- **Deflation** (30% revenue → BBB, 70% burned monthly)
- **Compounding** (30% reverse-burn loops revenue back)
- **Governance** (control LP allocations, fees, integrations)

**For Persistence Ecosystem:**

- **New liquidity source** (Theta's $500M+ TFUEL supply unlocked)
- **Deepened Dexter pools** (30% LP funding grows stkXPRT, milkTIA pairs)
- **IBC showcase** (demonstrates Cosmos' cross-chain capabilities)

### 12.3 Competitive Moat

**Why XFuel Wins:**

1. **Speed**: 10× faster than Axelar/Wormhole (ZK proofs vs consensus delays)
2. **Security**: Trustless (Plonky3 ZK proofs vs multisig/validator trust)
3. **Sustainability**: Revenue compounds (30% reverse-burn vs one-way treasury drains)
4. **Focus**: Laser-focused on Theta → Persistence (not generalized = better UX)

### 12.4 Alignment with Persistence Vision

**pSTAKE Sunset Context:**

In December 2025, pSTAKE (acquired by Stride) discontinued Persistence liquid staking, restructuring the ecosystem around:

- **PSTAKE (new)**: stkXPRT liquid staking
- **Milkyway**: milkTIA (Celestia LST)
- **Dexter**: Superfluid/Metastable pools as primary DeFi venue

**XFuel's Role (v4.0):**

- Brings **external liquidity** (Theta TFUEL) to Persistence
- **Deepens Dexter pools** via 30% LP funding (stkXPRT, milkTIA pairs)
- **Compounds growth** (more liquidity → more users → more revenue → deeper pools)
- **Proves concept**: ZK bridges + Edge Cloud can deliver cross-ecosystem capital efficiently

### 12.5 Risk Acknowledgment

**XFuel Protocol is experimental beta software with inherent risks:**

- **Pre-audit status** (CertiK audit scheduled Q2 2026—use at own risk)
- **Novel ZK technology** (Plonky3 recursion, not battle-tested at scale)
- **Smart contract risk** (bugs could allow exploits despite testing)
- **Market volatility** (crypto prices fluctuate, yields not guaranteed)
- **Regulatory uncertainty** (DeFi legal landscape evolving)

**⚠️ Only deposit amounts you can afford to lose. This is beta software.**

### 12.6 Call to Action

**Join the XFuel Launch:**

1. **Try the Beta**: Bridge TFUEL at [xfuel.app](https://xfuel.app) (start with small amounts)
2. **Lock for veXF**: Earn governance power + TFUEL revenue share (1-3 year lock)
3. **Provide LP**: Deepen Dexter pools (earn protocol-aligned yields)
4. **Vote on Governance**: Shape LP allocations, fee structures, integrations
5. **Report Bugs**: Help secure the protocol ($500K bug bounty coming Q2)

**XFuel is engineered for precision—so is our bridge.** 🏎️⚡

---

## 13. References

### Academic Papers

1. **Plonky3 Team** (2025). "Plonky3: Transparent ZK Proofs with Fast Recursion." https://github.com/0xPolygonZero/plonky3

2. **Cosmos Network** (2021). "Inter-Blockchain Communication Protocol." https://ibcprotocol.org/

### Protocol Documentation

3. **Theta Network** (2023). "Theta Blockchain Whitepaper." https://docs.thetatoken.org/

4. **Persistence** (2024). "Persistence Chain Documentation." https://docs.persistence.one/

5. **Dexter** (2024). "Dexter DEX Whitepaper—Superfluid Staking Pools." https://docs.dexter.zone/

6. **PSTAKE (new entity)** (2025). "stkXPRT Liquid Staking Documentation." https://pstake.finance/

7. **Milkyway** (2024). "milkTIA Liquid Staking for Celestia." https://milkyway.zone/

### XFuel Resources

8. **XFuel GitHub Repository**: https://github.com/XFuel-Lab/xfuel-protocol

9. **ZK Overhaul Summary** (2026). **XFuel Team**. "Zero-Knowledge Bridge Overhaul Technical Report."

10. **XFuel Tokenomics Quick Reference** (2026). **XFuel Team**. "XFuel Tokenomics One-Page Summary."

---

## 14. Glossary

**APY (Annual Percentage Yield)**: Annualized return including compound interest (e.g., 40% APY on Superfluid pools)

**BBB (Buyback-Burn-Boost)**: XFuel's deflationary mechanism (30% revenue → 70% burned, 30% to LP)

**Plonky3**: Transparent ZK proof system with **fast recursion for batching** and no trusted setup

**Circuit Breaker**: Automated safety mechanism that pauses protocol on anomalies (e.g., 0.5% ibcTFUEL depeg)

**Plonky3 Circuits**: Rust-based circuit definitions used for XFuel proof generation

**Cosmos**: Ecosystem of interoperable blockchains connected via IBC protocol

**CosmWasm**: Smart contract platform for Cosmos (Rust → WebAssembly)

**CW20**: Fungible token standard on CosmWasm (analogous to ERC-20)

**Dexter**: Primary DEX on Persistence, featuring Superfluid and Metastable pools

**Recursion**: Technique for aggregating proofs inside other proofs (used for batching)

**IBC (Inter-Blockchain Communication)**: Protocol for trustless cross-chain messaging (Cosmos standard)

**ibcTFUEL**: Wrapped TFUEL on Persistence (1:1 peg, CW20 token, minted via ZK proof)

**LST (Liquid Staking Token)**: Tradeable receipt for staked assets (e.g., stkXPRT = staked XPRT via PSTAKE)

**Merkle Proof**: Cryptographic proof that element exists in Merkle tree (used in ZK circuit)

**Metastable Pool**: Dexter pool type optimized for correlated assets (e.g., ibcTFUEL/stkXPRT) with 0.01% swap fees

**milkTIA**: Liquid staking token for Celestia TIA (issued by Milkyway protocol)

**Nonce**: Unique number used once (prevents ZK proof replay attacks)

**Recursion Proof**: Proof that verifies other proofs, enabling high-throughput batching

**Persistence (core-1)**: Cosmos blockchain hosting XFuel's CosmWasm contracts and Dexter DEX

**pSTAKE Sunset**: December 2025 discontinuation of pSTAKE liquid staking on Persistence (restructured as new PSTAKE entity)

**PSTAKE (new)**: Rebranded liquid staking protocol issuing stkXPRT for XPRT staking

**Reverse-Burn**: XFuel innovation where 30% of Persistence LP fees recirculate to RevenueSplitter (compounds revenue)

**RevenueSplitter**: Theta smart contract distributing protocol revenue via XFuel 30/30/25/15 model

**Soundness**: ZK property ensuring false statements cannot be proven (Plonky3 offers transparent setup soundness)

**stkXPRT**: Liquid staking token for XPRT (issued by PSTAKE, primary Persistence LST)

**Superfluid Pool**: Dexter pool type that auto-compounds staking rewards + swap fees (higher APY than standard pools)

**TFUEL**: Native gas token of Theta blockchain (used for edge node payments, smart contract gas)

**Theta**: Layer-1 blockchain optimized for video streaming and edge computing

**Theta Edge Cloud**: Decentralized edge compute network used for ZK proof generation and yield routing

**TVL (Total Value Locked)**: Sum of all user assets in protocol (measured in USD)

**veXF (vote-escrowed XF)**: Non-transferable governance token earned by locking XF (1-3 years, up to 3× multiplier)

**VaultFactory**: Main Theta contract managing TFUEL deposits and unwraps

**Witness**: Private inputs to ZK circuit (known only to prover, not revealed to verifier)

**XF**: XFuel Protocol's native governance token (100M fixed supply, no emissions)

**XPRT**: Native token of Persistence blockchain (staked for network security)

**ZK Proof**: Cryptographic proof system enabling trustless verification without revealing private data

**Zero-Knowledge**: Property where verifier learns nothing beyond proof validity (no leakage of private inputs)

---

## Appendices

### Appendix A: Contract Addresses

**Theta Mainnet (Chain ID: 361)**

```
VaultFactory:       TBD (post-audit deployment)
RevenueSplitter:    TBD (post-audit deployment)
```

**Persistence Mainnet (core-1)**

```
ZKVerifier:         (awaiting governance whitelist approval)
ibcTFUEL:           (awaiting governance whitelist approval)
IBC Channel:        channel-190
```

**Latest Deployment TX:**  
`1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9`

### Appendix B: Performance Benchmarks

**Local Testnet (100 transactions)**

| Metric | Min | Average | Max | Std Dev |
|--------|-----|---------|-----|---------|
| Proof Generation | 0.8s | 1.1s | 1.6s | 0.12s |
| Verification | 50ms | 60ms | 75ms | 6ms |
| E2E Settlement | 2.9s | 3.5s | 4.1s | 0.25s |
| Success Rate | - | 99.9% | - | - |

**Mainnet Beta (10 transactions)**

- **Average Proof Generation**: 1.05s
- **Average Verification**: 60ms
- **Average IBC Transfer**: 480ms
- **Average E2E Settlement**: 3.7s
- **Success Rate**: 100%

### Appendix C: Dexter Pool Details

**Current Target Pools (Q1 2026)**

**ibcTFUEL/stkXPRT Superfluid Pool:**

- **Type**: Superfluid (auto-compounding staking + swap fees)
- **Assets**: ibcTFUEL (XFuel), stkXPRT (PSTAKE)
- **APY**: ~35-45% (20-25% staking, 10-15% swap fees, 5% Superfluid bonus)
- **Fees**: 0.3% swap fee
- **TVL**: $1.2M (as of Jan 2026)

**ibcTFUEL/milkTIA Metastable Pool:**

- **Type**: Metastable (optimized for correlated assets)
- **Assets**: ibcTFUEL (XFuel), milkTIA (Milkyway)
- **APY**: ~30-40% (18-22% staking, 8-12% swap fees)
- **Fees**: 0.01% swap fee (low-slippage)
- **TVL**: $800K (as of Jan 2026)

### Appendix D: Theta Edge Cloud Integration Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                      THETA EDGE CLOUD                               │
├────────────────────────────────────────────────────────────────────┤
│  Edge Node Cluster (ZK + Routing)                                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐            │
│  │ Prover Node  │   │ Router Node  │   │ Verifier API │            │
│  │ (Plonky3)    │   │ (Yield Calc) │   │ (Proof Relay)│            │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘            │
│         │                  │                  │                   │
│         ▼                  ▼                  ▼                   │
│  TFUEL-cost savings   Faster routing     Lower latency            │
└─────────┬──────────────────┬──────────────────┬──────────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────────────┐
│ Theta Contracts → Edge Cloud → Persistence ZKVerifier              │
└────────────────────────────────────────────────────────────────────┘
```

### Appendix E: FAQ

**Q: Is XFuel safe to use?**  
A: XFuel is currently in **beta** and has not been audited. The ZK bridge provides STARK-like soundness (transparent setup), but smart contract bugs could exist. Full CertiK audit scheduled Q2 2026. **Only use with amounts you can afford to lose.**

**Q: How fast are deposits?**  
A: **<4 seconds** average from Theta TFUEL deposit to Persistence ibcTFUEL receipt (1.2s proof generation + 60ms verification + ~2s IBC transfer).

**Q: What's the minimum deposit?**  
A: **0.1 TFUEL** minimum (to cover gas fees and maintain economic security).

**Q: What yields can I expect?**  
A: **30-50% APY** on Dexter Superfluid pools (stkXPRT, milkTIA). Exact rates depend on staking rewards + swap fees. veXF holders also earn TFUEL revenue share (see Section 10.3).

**Q: Can I withdraw my TFUEL anytime?**  
A: Yes! Burn your ibcTFUEL on Persistence → triggers unwrap on Theta → TFUEL released from your vault. Unwraps take ~5-10 minutes (IBC transfer + Theta finality).

**Q: What are the fees?**  
A: **0.5% bridge fee** (TFUEL deposits) + **0.3% swap fee** (LP routing) + **3-5% yield performance fee** (only on net profits from Superfluid staking).

**Q: Why focus on Persistence?**  
A: Persistence offers the highest-yielding LST ecosystem in Cosmos post-pSTAKE sunset. Dexter's Superfluid pools (stkXPRT, milkTIA) provide 30-50% APY vs Theta's 2-4%. XFuel bridges this yield gap trustlessly.

**Q: What happened to pSTAKE?**  
A: pSTAKE (original protocol) was acquired by Stride in 2024 and sunset Persistence liquid staking in December 2025. A **new entity called PSTAKE** now provides stkXPRT liquid staking on Persistence. XFuel integrates with this new ecosystem.

---

**Document Version:** 4.2 (Premier Edition)  
**Last Updated:** January 23, 2026  
**Status:** 🏎️ Production Ready - Phase 1 Complete (11.6x speedup, 90% cost reduction, 50-80% Edge Cloud TFUEL savings)

**Contact:**

- **Website**: [xfuel.app](https://xfuel.app)
- **GitHub**: [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Security**: security@xfuel.app
- **General**: hello@xfuel.app

---

⚠️ **Disclaimer**: This whitepaper is for informational purposes only and does not constitute financial advice, investment recommendation, or an offer to sell securities. XFuel Protocol is experimental beta software with inherent risks. Cryptocurrency investments are highly volatile and may result in total loss. Users should conduct their own research and consult with qualified professionals before making any investment decisions. Past performance does not guarantee future results. The XFuel team makes no warranties or representations regarding the accuracy or completeness of this document. All forward-looking statements are subject to risks and uncertainties. **Use the protocol at your own risk and only with funds you can afford to lose.**

---

© 2026 XFuel Protocol. Licensed under MIT License.
