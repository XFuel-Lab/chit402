# XFuel Protocol: XFuel Tokenomics Edition

**Version 5.1 — AI DePIN Yield Router Edition**  
**February 11, 2026**  
**Status:** Production-Ready — Cross-Chain AI Yield Aggregator | Osmosis/Akash Direct | Q4 2026 Mainnet Target

> **Canonical Whitepaper v5.1** — For PDF: Print this page or use Pandoc

**Live:** [xfuel.app](https://xfuel.app) | **GitHub:** [XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)

---

## Version History

- **v5.1:** Fully aligned AI tech-driven identity — reframed as AI tech-driven crypto solution solving GPU scarcity (Akash/TAO), privacy/security in comms/inference via SP1 zkVM/zkML, added Theta GPU synergies for Akash/TAO availability, revised Abstract/Introduction/Architecture/A2A/Conclusion for privacy-secure AI compute framing, higher yields (30-50%+ Osmosis), cheaper/faster ZK-secured inference - Feb 11, 2026
- **v5.0:** Production Mainnet Edition — finalized Osmosis-primary routing with full AI DePIN integration (AIVerifier.wasm, AIDePINRouter.sol, TAOWrapper.sol, ai-listener.js, server.js, fee-analytics.js all production-synced), added missing Sections 4/7/8/9/11, added production milestones (Q4 2026 mainnet, $5M TVL unlocks), expanded cross-references to fee-analytics.js in Revenue, consolidated all prior Cursor outputs into canonical document - Feb 11, 2026
- **v4.5:** Osmosis/Akash Direct Pivot — strategic destination change from Persistence-primary to Osmosis-primary for superior yields (30-50% APYs on LSTfi and AI pools) and AI compute integration via Akash IBC, added Phase E Extension: AI DePIN Bridge, maintained 30/30/25/15 fee model unchanged across all revenue streams - Feb 10, 2026
- **v4.4:** Bi-Directional ZK Bridge Edition — added reverse flow (withdrawals with 0.5% fee, FeeCollector, SP1 event attributes, nonce protection), updated tokenomics for reverse fees, clarified mock testing for governance prep - Feb 6, 2026
- **v4.3:** Architecture alignment — updated to reflect production SP1 zkVM implementation (RISC-V, CosmWasm ZKVerifier, ~9s proving), clarified IBC as post-mint routing only, added Groth16→SP1 evolution context - Feb 2, 2026
- **v4.2:** Premier edition — balanced technical presentation, multi-destination routing (Persistence-primary with Osmosis/Cosmos Hub hooks), quantified Edge Cloud savings (50-80% TFUEL cost reduction), clarified vesting milestones - Jan 23, 2026
- **v4.1:** SP1 zkVM upgrade with batching (2.25s per deposit, 11.6x speedup, 90% cost reduction) - Jan 23, 2026
- **v4.0:** Updated to XFuel Tokenomics, TFUEL-only yields, SP1 zkVM with Theta Edge Cloud integration (Jan 2026)

## Abstract

XFuel Protocol is a **trustless cross-chain AI DePIN Yield Router**, an AI tech-driven crypto solution connecting Theta's TFUEL to high-yield Cosmos DeFi and decentralized AI compute markets. Leveraging **SP1 zkVM for privacy-preserving proofs** (RISC-V-based zero-knowledge virtual machine with transparent setup) and **zkML for secure ML inference** (verifies computations without revealing inputs/outputs or model weights), the protocol solves AI communication privacy/security while enabling cheaper/faster compute. Combined with **Theta Edge Cloud acceleration** (50-80% lower costs), it routes Theta's GPU resources to networks like Akash (addressing GPU scarcity) and TAO (Bittensor, solving subnet resource constraints), achieving **~9-second proving time** with batching.

**Strategic Pivot (v5.1):** XFuel routes **directly to Osmosis** ($2B+ TVL) for 30-50%+ APYs on AI/DePIN pools (AKT/OSMO, FET/OSMO)—higher than Theta's 2-4% yields. This unlocks synergies with **Akash** (TFUEL → AKT for GPUs, alleviating supply crunches) and **TAO** (inference routing to subnets, addressing reliability/congestion). Persistence is legacy-compatible.

**AI DePIN Bridge (v5.0):** Phase E integrates Akash/TAO, with zkVM/ML ensuring private/secure A2A/M2M. XFuel isn't just a bridge—it's an AI solution offering higher yields, cheaper/faster ZK-secured compute, and privacy for AI workflows, solving GPU availability for Akash/TAO via Theta synergies. All contracts production-synced: `AIVerifier.wasm` (Osmosis), `AIDePINRouter.sol` + `TAOWrapper.sol` (Theta EVM), `ai-listener.js` + `server.js` + `fee-analytics.js` (backend).

**Retained from v4.4:** The protocol implements **bi-directional flow** (deposits + withdrawals), enabling users to:
- **Forward Flow (Theta → Osmosis/Cosmos)**: Deposit TFUEL, mint ibcTFUEL via ZK proofs, route to Osmosis AI yield pools (AKT, FET, OCEAN) or Persistence LSTs <!-- v5.0 -->
- **Reverse Flow (Cosmos → Theta)**: Burn ibcTFUEL via `burn_for_unwrap`, pay 0.5% fee to FeeCollector, trigger SP1 proof generation for Theta TFUEL unwrap

The protocol implements **XFuel Tokenomics**, a refined 4-way revenue distribution model (30/30/25/15) with a 30% reverse-burn sustainability loop and **0.5% reverse bridge fees**. **Fee model is unchanged** — the same 30/30/25/15 split applies to all revenue streams (bridge fees, compute routing fees, AI yield). <!-- v5.0 -->

Following our SP1 zkVM implementation and bidirectional bridge completion, XFuel achieves:

- **~9s proving time** (Phase B benchmarks: 8.997s average, production-validated)
- **~100ms verification time** (constant-time CosmWasm ZKVerifier)
- **SP1 zkVM proofs** (RISC-V-based, transparent setup, STARK-to-SNARK recursion via Succinct Network)
- **Bi-directional flow** (deposits + withdrawals with 0.5% reverse fee)
- **Osmosis-primary routing** (30-50%+ APY yield pools, $2B+ TVL) <!-- v5.0 -->
- **Akash AI DePIN integration** (TFUEL → AKT for decentralized GPU compute, Phase E) <!-- v5.0 -->
- **Multi-chain CosmWasm** (Osmosis-primary, Akash AI bridge, Persistence compatible) <!-- v5.0 -->
- **50-80% lower TFUEL costs** (Theta Edge Cloud optimization vs standard compute)
- **1:1 cryptographic peg** maintenance (ibcTFUEL ↔ TFUEL)
- **Automated circuit breakers** for emergency protection
- **Nonce-based replay protection** for reverse bridge operations

This whitepaper presents the complete technical architecture, tokenomics model, security analysis, and roadmap for delivering bidirectional Theta liquidity to Cosmos DeFi — with strategic focus on high-yield aggregation (30-50%+ APYs) and AI/DePIN compute markets. <!-- v5.0 -->

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Project Evolution](#2-project-evolution)
3. [Architecture](#3-architecture) — *includes 3.2.4 AIVerifier.wasm, 3.4 ZK Prover Extensions*
4. [Zero-Knowledge Bridge](#4-zero-knowledge-bridge) — *SP1 zkVM, proof types, IBC routing*
5. [Bi-Directional Bridge Flow](#5-bi-directional-bridge-flow) — *forward (Theta→Osmosis), reverse (Cosmos→Theta)*
6. [XFuel Tokenomics](#6-xfuel-tokenomics) — *includes 6.1 AI-Driven Fee Examples, 6.1.2 Fee Analytics*
7. [Governance & veXF](#7-governance--vexf) — *veXF locks, voting powers, DAO timeline*
8. [Revenue Model](#8-revenue-model) — *5 fee streams, fee-analytics.js integration*
9. [Technical Implementation](#9-technical-implementation) — *contracts, backend, enum sync matrix*
10. [Risk Analysis & Mitigation](#10-risk-analysis--mitigation)
11. [Economic Model & Projections](#11-economic-model--projections) — *TVL milestones, $5M unlocks*
12. [Roadmap](#12-roadmap) — *Phase D mainnet, Phase E AI DePIN, Q4 2026 targets*
13. [Conclusion](#13-conclusion)
14. [References](#14-references)
15. [Glossary](#15-glossary)
16. [Appendices](#appendices)

---

## 1. Introduction

### 1.1 Problem Statement

Theta Network holders not only face liquidity challenges—TFUEL earning minimal yields (~2-4% from staking)—but AI ecosystems like Akash and TAO (Bittensor) suffer from GPU availability shortages, resource congestion, and privacy/security gaps in communications/inference. Bridging TFUEL to Cosmos introduces four barriers, while missing AI solutions:

1. **Trust Assumptions**: Centralized bridges/relayers risk custody and expose AI data (inputs/models) in comms/inference.

2. **Poor Performance**: High latency/costs (10-30s settlements, GPU crunches) hinder real-time AI workflows; Akash faces provider exits/H100 scarcity (utilization >50-80%, prices skyrocketing), TAO subnets deal with gas spikes/congestion.

3. **One-Way Flow**: Lacks secure exits, trapping liquidity and limiting AI agent mobility across networks.

4. **Suboptimal Integration**: Legacy setups overlook synergies with Osmosis (high yields), Akash (GPU marketplaces needing more supply), and TAO (subnets requiring verifiable/reliable resources)—failing to solve privacy (data leakage in inference) and security (unproven compute). <!-- v5.1 -->

### 1.2 Solution Overview

XFuel solves these as an **AI tech-driven crypto solution**, not just a bridge—using zkVM/ML for privacy-secure AI compute/inference, higher yields, and Theta GPU synergies to boost availability for Akash/TAO: <!-- v5.1 -->

**Cryptographic Bridge Layer (zkVM/ML Focus):**

- **SP1 zkVM verification** for trustless validation, zkML proofs (secure inference without data leakage), and private A2A comms.
- **Bi-directional flow** with ZK proofs (~9s proving, ~100ms verification).
- **Theta Edge Cloud acceleration** (50-80% cheaper/faster), routing Theta GPUs to solve Akash/TAO scarcity (e.g., H100 crunches, subnet congestion).
- **Multi-chain IBC routing** (Osmosis-primary yields, Akash AI compute, TAO inference; Persistence legacy).
- **Nonce-based replay protection** and circuit breakers for security.

**Strategic Destination: Osmosis (Yield Synergy):** <!-- v5.1 -->

- 30-50%+ APYs on AI/DePIN pools—higher than Theta natives.
- Synergy: Settlement hub for Akash/TAO, converting yields to compute/inference.

**AI DePIN Bridge: Akash & TAO (Privacy/Security/GPU Synergy):** <!-- v5.1 -->

- TFUEL → AKT/TAO for GPUs/inference, zkVM/ML ensuring private/secure workflows (no exposure).
- Theta GPUs address Akash scarcity (provider incentives, utilization boosts) and TAO reliability (verifiable proofs, subnet routing).
- Unified dashboard for yields/compute/inference.

**XFuel Tokenomics (Unchanged):** <!-- v5.0 -->

- 4-way revenue distribution: 30% BBB, 30% LP, 25% veXF, 15% Treasury
- **0.5% bridge fee both directions** (forward + reverse)
- 30% reverse-burn sustainability loop (recirculating yields back to protocol)
- **No tokenomics changes** — same 30/30/25/15 split applies to all revenue (bridge fees, compute routing fees, AI yield) <!-- v5.0 -->
- Compounds LP depth over time (more revenue → more LP funding → deeper liquidity)

---

## 2. Project Evolution

### 2.1 Timeline

**Phase A (June 2025 - September 2025): Oracle-Based Bridge**

- Initial design used Chainlink oracles for deposit validation
- 9-of-13 multisig for minting authorization
- 10-15 second settlement times
- **Result:** Functional but centralized—trust assumptions unacceptable for mainnet

**Phase B (October 2025 - December 2025): ZK Bridge Transition**

- Pivoted to SP1 zkVM for trustless verification
- Eliminated oracle dependencies
- Reduced settlement to <4 seconds
- **Result:** Production-ready ZK architecture (8.997s proving, 52.89 tx/min)

**Phase C (January 2026 - February 2026): Bi-Directional Bridge** <!-- NEW v4.4 -->

- Added reverse flow: burn_for_unwrap with 0.5% fee
- Deployed FeeCollector.wasm for fee accumulation
- Implemented SP1 event attributes for proof generation
- Added nonce-based replay protection
- Completed comprehensive testing suite (unit, integration, E2E, security fuzzing, performance benchmarks, analytics validations)
- Generated governance mocks and demos (MOCK_MODE deployments, veXF vote sims, forum proposals)
- **Result:** Full bidirectional capability ready for governance approval; testing and prep finalized as of Feb 11, 2026, positioning for immediate mainnet transition.

**Phase D (February 2026+): Mainnet Launch**

- Governance whitelist approval (Osmosis focus)
- CertiK audit completion
- Mainnet deployment with monitoring
- Bug bounty program ($500K)

### 2.2 Key Architectural Pivots

#### Pivot 1: Oracle → Zero-Knowledge (v3.0, December 2025)

**Why:** Trust assumptions (9-of-13 multisig) were incompatible with DeFi composability. Users questioned security, auditors flagged custody risk.

**Result:** Full SP1 zkVM rewrite, eliminating trust while improving speed (10-15s → <4s settlements).

#### Pivot 2: Multi-Chain → Persistence-First (v3.1, December 2025)

**Why:** Fragmented liquidity across Osmosis, Cosmos Hub, and Persistence diluted LP depth. Post-pSTAKE sunset, Persistence's Dexter became the clear LST hub.

**Result:** Focused liquidity on stkXPRT, milkTIA, and Dexter Superfluid pools (30-50% APY vs generic 10-15%).

#### Pivot 3: One-Way → Bi-Directional (v4.4, February 2026)

**Why:** Users needed trustless exit strategy. One-way bridges trap liquidity, creating sell pressure on destination chain.

**Result:** Added reverse flow with 0.5% fee, SP1 proof generation for withdrawals, FeeCollector integration for sustainable revenue.

#### Pivot 4: Persistence-Primary → Osmosis/Akash Direct (v4.5, February 2026) <!-- NEW v4.5 -->

**Why:** Three converging factors drove the strategic pivot:

1. **Superior Yield Opportunities**: Osmosis offers 30-50%+ APYs on AI token pools (AKT/OSMO, FET/OSMO, OCEAN/OSMO), LSTfi positions, and superfluid staking — vs Persistence's ~$50M total DEX TVL and narrower pool selection. For yield-maximizing TFUEL routing, Osmosis is unmatched in Cosmos.

2. **AI/DePIN Token Hub**: Osmosis hosts the deepest liquidity for DePIN tokens (AKT, FET, OCEAN) in the Cosmos ecosystem. Routing TFUEL to Osmosis creates a **direct Theta ↔ AI DePIN yield corridor** that smaller chains cannot support.

3. **Akash Compute Access**: Akash Network ($500M+ in AI compute demand) operates as a Cosmos chain with native IBC. The Theta Edge Cloud ↔ Akash compute arbitrage opportunity is uniquely accessible via Osmosis routing — enabling AI agents to seamlessly convert yield earnings into GPU workloads.

**Result:** Osmosis becomes primary destination (Q2 2026), Akash IBC integration follows (Phase E, Q3-Q4 2026). Persistence maintained as compatible routing option for existing LST integrations. Revenue model (30/30/25/15) unchanged — same fee structure applies to all chains.

### 2.3 Design Philosophy: Minimal Viable Trust

XFuel prioritizes **cryptographic guarantees over operational trust**:

- ✅ ZK proofs > multisig validators
- ✅ Transparent setup > trusted ceremonies
- ✅ Nonce-based replay protection > centralized gatekeeping
- ✅ On-chain settlement > off-chain coordination
- ✅ Automated circuit breakers > manual intervention

**Trade-off:** Higher implementation complexity (4 months ZK R&D vs 2 months oracle build), but **eliminates existential trust risk** that kills DeFi protocols (see: wormhole, multichain collapses).

---

## 3. Architecture

### 3.1 System Overview

XFuel operates as a **multi-layer trustless bridge** connecting Theta (EVM), Edge Cloud (ZK Proof + Backend Services), Cosmos destinations (Osmosis-primary, Akash AI, Persistence compatible), and reverse flow coordination: <!-- v5.0 -->

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         XFUEL PROTOCOL v5.0                               │
│     Bi-Directional: Theta ↔ Osmosis/Akash/Persistence (ZK-secured)      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  FORWARD FLOW (Theta → Cosmos)                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌─────────────────────────┐    │
│  │   THETA      │    │  EDGE CLOUD  │    │   COSMOS DESTINATIONS   │    │
│  │   LAYER      │───▶│   LAYER      │───▶│  (Osmosis / Akash /     │    │
│  │   (EVM)      │    │ (ZK Prover)  │    │   Persistence)          │    │
│  └──────────────┘    └──────────────┘    └─────────────────────────┘    │
│         │                    │                       │                    │
│    VaultFactory        SP1 Prover             ZKVerifier.wasm            │
│    (TFUEL lock)       (~9s proving)           ibcTFUEL.wasm              │
│                                                      │                    │
│                                          ┌───────────┴──────────┐        │
│                                          │                      │        │
│                                     Osmosis DEX          Akash GPU       │
│                                     (AI yield pools,     (AKT leases,    │
│                                      30-50%+ APY)         AI compute)    │
│                                                                           │
│  REVERSE FLOW (Cosmos → Theta)                                           │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐             │
│  │  COSMOS      │    │  EDGE CLOUD  │    │     THETA      │             │
│  │  LAYER       │───▶│   LAYER      │───▶│     LAYER      │             │
│  │ (CosmWasm)   │    │ (SP1 Event)  │    │     (EVM)      │             │
│  └──────────────┘    └──────────────┘    └────────────────┘             │
│         │                    │                    │                       │
│  ibcTFUEL.wasm        SP1 Event Prover    unwrapFromBurn()               │
│  burn_for_unwrap     Backend listener     (TFUEL release)                │
│  FeeCollector.wasm   (trigger Theta tx)                                  │
│  (0.5% fee)                                                              │
│                                                                           │
│  AI DePIN BRIDGE (Phase E — Agent-to-Agent / Machine-to-Machine)         │
│  ┌──────────────┐    ┌──────────────┐    ┌────────────────┐             │
│  │ THETA EDGE   │    │   OSMOSIS    │    │  AKASH / TAO   │             │
│  │ (compute     │◄──▶│ (settlement  │◄──▶│ (AI inference, │             │
│  │  credits)    │    │  + yields)   │    │  GPU leases)   │             │
│  └──────────────┘    └──────────────┘    └────────────────┘             │
│         │                    │                    │                       │
│    ZK-verified A2A     0.5-1% fee          IBC compute bids              │
│    task routing        → 30/30/25/15       Substrate bridge              │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Details

#### 3.2.1 Theta Layer (Smart Contracts)

**VaultFactory** (`contracts/VaultFactory.sol`)

- Manages individual deposit vaults per user
- Locks TFUEL collateral (1:1 backing for ibcTFUEL)
- Generates Merkle proofs for ZK verification
- **NEW in v4.4:** `unwrapFromBurn(address recipient, uint256 amount, bytes calldata sp1Proof)` function
  - Validates SP1 proof of Persistence burn event
  - Verifies nonce + amount + recipient from proof
  - Releases TFUEL to recipient address
  - Emits UnwrapFromBurn event
- Handles burn-triggered unwrap operations
- Emits deposit events for backend detection

**RevenueSplitter** (`contracts/RevenueSplitter.sol`)

- Implements XFuel 30/30/25/15 distribution
- Collects 0.5% bridge fees (TFUEL deposits)
- Routes 30% reverse-burn from LP fees
- **NEW in v4.4:** Receives reverse bridge fees from backend (0.5% of withdrawal amounts)
- Distributes to: BBB (buyback-burn), LP funding, veXF yields, Treasury

#### 3.2.2 Edge Cloud Layer (Theta Edge Cloud + Node.js Services)

**Forward Flow Listener** (`backend/theta-bridge/src/listener.js`)

- Monitors Theta VaultFactory every 2 seconds
- Detects deposit events via websocket
- Validates deposit amounts (0.1-100 TFUEL bounds)
- Triggers ZK proof generation pipeline

**Reverse Flow Listener** (`backend/theta-bridge/src/osmosis-listener.js`) <!-- Updated from persistence-listener.js -->

- Monitors Osmosis chain for `burn_for_unwrap` events (primary; Akash/TAO via IBC hooks)
- Filters for `for_sp1_proof = "burn_for_unwrap"` attribute
- Extracts: user, amount_burned, fee_amount, theta_recipient, nonce, block_height, timestamp
- Generates mock SP1 proof attributes (Phase C: governance prep)
- Triggers Theta `unwrapFromBurn()` transaction
- Handles 0.5% fee routing to RevenueSplitter
- Note: General Cosmos compatibility maintained for legacy chains.

**ZK Prover** (`sp1-prover/program/src/main.rs`)

- **Circuit compilation**: SP1 circuits (Rust) for zkML (secure ML inference without revealing data) and A2A privacy (verify without exposure).
- **Witness generation**: Extract deposit/burn/AI task data (~400ms).
- **SP1 proof**: Generate via Succinct Network (~9s), solving AI comm privacy/security.
- **Cost savings**: 50-80% lower via Theta GPUs, synergizing with Akash/TAO to boost availability (address scarcity/congestion).
- **Proof submission**: To Osmosis ZKVerifier or Theta VaultFactory.

**Yield Router** (`backend/yield-optimizer.ts`) <!-- v5.0 -->

- Tracks **Osmosis + Dexter** LP pool APYs in real-time (Edge Cloud compute)
- **Primary routing**: Osmosis AI yield pools (AKT/OSMO, FET/OSMO, OCEAN/OSMO), LSTfi pools (stATOM/OSMO, stOSMO)
- **Secondary routing**: Dexter Superfluid pools (stkXPRT, milkTIA — Persistence compatibility)
- Auto-rebalances across chains based on APY thresholds (5% minimum delta)
- **Phase E**: Routes AI compute task fees to optimal yield destination

#### 3.2.3 Cosmos Destination Layer (Osmosis / Akash / Persistence) <!-- v5.0 -->

**ZKVerifier.wasm** (SP1 proof verification)

- SP1 verification (no trusted setup)
- Verifies proofs in ~100ms average
- Validates nonce uniqueness (replay protection)
- Authorizes ibcTFUEL minting on success

**ibcTFUEL.wasm** (CW20 wrapped token with reverse bridge) <!-- UPDATED v4.4 -->

- 1:1 peg with locked TFUEL on Theta
- Mints on verified ZK proof
- **NEW:** `burn_for_unwrap(amount: Uint128, theta_recipient: String)` execute message
  - Validates theta_recipient (0x + 40 hex chars)
  - Calculates 0.5% fee (50 bps)
  - Sends fee to FeeCollector via CW20 Send
  - Burns remaining 99.5% from user balance
  - Emits event with SP1-readable attributes:
    - `action = "burn_for_unwrap"`
    - `user = persistence1...`
    - `amount_burned = 995000000000000000` (99.5%)
    - `fee_amount = 5000000000000000` (0.5%)
    - `theta_recipient = 0x742d35...`
    - `nonce = 1` (per-user replay protection)
    - `for_sp1_proof = "burn_for_unwrap"` (critical flag)
  - Updates state tracking (total_reverse_burned, total_reverse_fees)
- IBC-enabled (ICS-20 standard)

**FeeCollector.wasm** (Reverse bridge fee accumulator) <!-- NEW v4.4 -->

- Receives ibcTFUEL fees via CW20 Receive hook (0.5% from burn_for_unwrap)
- Accumulates fees until threshold reached (e.g., 100 ibcTFUEL)
- Admin function: `trigger_fee_burn()` burns accumulated fees
- Emits fees_burned event for backend to route TFUEL to RevenueSplitter
- Tracks total_fees_collected, total_fees_burned

**Osmosis DEX Integration (Primary — v4.5)** <!-- v5.0 -->

- **AI/DePIN Token Pairs**: AKT/OSMO (Akash), FET/OSMO (Fetch.ai), OCEAN/OSMO (Ocean Protocol) — 40-80% APY
- **LSTfi Pairs**: stATOM/OSMO, stOSMO — 20-40% APY with superfluid staking
- **Superfluid Staking**: Earn OSMO staking rewards + LP fees simultaneously
- **LP Depth Growth**: 30% of protocol revenue reinvested across Osmosis + Dexter pools

**Akash Network Integration (Phase E — v4.5)** <!-- v5.0 -->

- **IBC-native**: Direct Osmosis ↔ Akash token routing via IBC
- **AI Compute Marketplace**: TFUEL → AKT conversion for GPU leases, inference tasks
- **A2A/M2M Settlement**: ZK-verifiable agent-to-agent and machine-to-machine compute payments
- **Cross-DePIN Arbitrage**: Route workloads to cheapest provider (Theta Edge vs Akash GPU)

#### 3.2.4 Osmosis Layer: AIVerifier.wasm (Phase E — v4.5) <!-- v5.0 -->

**AIVerifier.wasm** (`cosmwasm-contracts/ai-verifier/`) is the **on-chain AI DePIN settlement contract** deployed on Osmosis. It provides ZK-verified AI task routing, A2A/M2M message passing for Akash IBC, SP1 proof settlement, and 0.5-1% fee collection integrated with FeeCollector.wasm. The contract replaces the need for a separate "AI ZK verifier" by combining task routing, proof verification, and fee management in a single CosmWasm contract.

**Role in AI DePIN Architecture:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     AIVerifier.wasm on Osmosis                           │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────┐ │
│  │   Task Routing   │  │  SP1 Proof       │  │  A2A Message           │ │
│  │   (5 types)      │──│  Settlement      │──│  Verification          │ │
│  └──────┬──────────┘  └────────┬─────────┘  └───────────┬────────────┘ │
│         │                      │                         │               │
│  ┌──────▼──────────────────────▼─────────────────────────▼──────────┐   │
│  │   Fee Collection (0.5-1% AI tasks, 0.1% A2A relay)               │   │
│  │   → Auto-forward to FeeCollector.wasm → RevenueSplitter (30/30/25/15)│
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  Integrates with:                                                        │
│  ├── AIDePINRouter.sol (Theta EVM — mirrors enums/structs)              │
│  ├── main.rs (SP1 — validate_ai_task, validate_a2a_message)            │
│  ├── ai-listener.js (Backend — detects TaskRouted events)               │
│  └── FeeCollector.wasm (Osmosis — receives accumulated fees)            │
└──────────────────────────────────────────────────────────────────────────┘
```

**Contract Capabilities:**

| Feature | Description |
|---------|-------------|
| **AI Task Routing** | `RouteTask` — routes COMPUTE_BID, COMPUTE_RESULT, INFERENCE_REQUEST, CAPABILITY_QUERY, DATA_ATTESTATION tasks with destination chain selection |
| **SP1 Proof Settlement** | `SettleTask` / `SettleTaskBatch` — verifies SP1 ZK proofs, marks tasks settled, accumulates fees. Supports non-fatal `ProofOutcome::Regenerable` for ai-listener.js retries |
| **A2A Message Passing** | `SendA2AMessage` / `VerifyA2AMessage` — ZK-verifiable agent-to-agent communications with escrow validation per message type |
| **Agent Registry** | `RegisterAgent` — on-chain identity commitment (Poseidon hash) required for A2A messaging |
| **Fee Collection** | 0.5-1% on task settlements (variable per-task BPS), 0.1% relay fee on A2A escrow. Auto-forwards to FeeCollector.wasm at configurable threshold |
| **Nullifier Tracking** | Per-nullifier replay protection (mirrors SP1 nullifier generation from main.rs) |
| **Per-Agent Nonces** | Incrementing nonces per agent address for ordering and replay protection |
| **Mock Mode** | `mock_mode: true` skips SP1 proof verification for governance testing (matches persistence-minter pattern) |
| **Relayer ACL** | Only authorized relayers (AddRelayer/RemoveRelayer) can settle tasks and verify A2A messages |
| **IBC Compatibility** | Validates IBC channel requirements for Akash routing; stores configurable `akash_ibc_channel` |

**Fee Details (calculate_task_fee logic):**

```
Fee Calculation (mirrors main.rs calculate_task_fee):
  fee_amount = gross_amount × fee_bps / 10000
  net_amount = gross_amount - fee_amount

Fee Rates:
  ├── AI Task settlements: 0.5-1.0% (50-100 BPS, configurable per task)
  ├── A2A message relay:   0.1% (10 BPS) on escrow amounts
  └── Bridge fees:         0.5% (unchanged, handled by ibcTFUEL.wasm)

Fee Flow:
  RouteTask → fee_amount accumulated in pending_fees
  SettleTask (Valid proof) → pending_fees += fee_amount
  When pending_fees >= threshold → CW20 Send to FeeCollector.wasm
  FeeCollector.wasm → trigger_fee_burn() → RevenueSplitter (30/30/25/15)
```

**Example — COMPUTE_BID Flow (Theta → Akash via Osmosis):**

```
1. AI agent calls RouteTask on AIVerifier.wasm:
   { task_id: "bid-001", msg_type: ComputeBid,
     destination_chain: Akash, amount: 1_000_000,
     fee_bps: 50 }

2. AIVerifier validates:
   ✅ amount >= min_task_amount (10000)
   ✅ fee_bps in [50, 100]
   ✅ Akash IBC channel configured
   ✅ Task ID not duplicate

3. Fee calculated: 1_000_000 × 50 / 10000 = 5_000 (0.5%)
   Net amount: 995_000

4. TaskRouted event emitted with for_ai_listener=true
   → ai-listener.js detects event
   → Routes to Theta Edge Cloud / Akash provider

5. On completion, relayer calls SettleTask:
   { task_id: "bid-001", sp1_proof: <proof>,
     nullifier: "null_001", output_hash: "...",
     fee_commitment: "..." }

6. AIVerifier verifies SP1 proof (or mock in test mode)
   → Nullifier marked used (replay protection)
   → pending_fees += 5_000
   → If pending_fees >= threshold → forward to FeeCollector.wasm
```

**Example — INFERENCE_REQUEST Flow (Osmosis → Theta Edge):**

```
1. Osmosis user sends INFERENCE_REQUEST via IBC memo:
   { xfuel_ai_intent: { type: "inference_request",
     model_id: "llama-3", input_hash: "0xabc...",
     budget: "2000000" } }

2. ai-listener.js detects IBC event, calls RouteTask:
   { task_id: "inf-001", msg_type: InferenceRequest,
     destination_chain: Theta, amount: 2_000_000,
     model_id_hash: "sha256_llama3", input_hash: "0xabc..." }

3. AIVerifier validates InferenceRequest constraints:
   ✅ model_id_hash ≠ empty
   ✅ input_hash ≠ empty

4. Fee: 2_000_000 × 50 / 10000 = 10_000 → FeeCollector

5. ai-listener.js routes to Theta Edge inference API
   → Returns output_hash + execution time

6. SP1 proof generated → SettleTask called
   → 0.5% fee → FeeCollector → RevenueSplitter (30/30/25/15)
```

**A2A Message Escrow Rules (matches main.rs validate_a2a_message):**

| Message Type | Escrow Required | Rationale |
|-------------|----------------|-----------|
| `COMPUTE_BID` | Yes | Agent must lock funds before bidding |
| `INFERENCE_REQUEST` | Yes | Budget must be escrowed |
| `COMPUTE_RESULT` | No | Provider attests completion (payer already escrowed) |
| `CAPABILITY_QUERY` | No (must be zero) | Read-only discovery, no payment |
| `DATA_ATTESTATION` | No | Provenance certification only |

**IBC Compatibility (Osmosis ↔ Akash ↔ Persistence):**

- **Akash routing**: `akash_ibc_channel` stored in config (set at instantiation or via `SetAkashIbcChannel`). Required for COMPUTE_BID/INFERENCE_REQUEST tasks targeting Akash.
- **Osmosis local**: Tasks targeting Osmosis pools (settlement, yield routing) don't require IBC — same chain.
- **Persistence backward-compat**: Tasks can be routed to Persistence via IBC for existing LST integrations.
- **Bittensor (TAO)**: TAO routing handled by ai-listener.js via Substrate bridge; AIVerifier stores the task, ai-listener handles cross-ecosystem delivery.

**Dexter DEX Integration (Persistence — maintained)** <!-- v5.0 -->

- **Superfluid Pools**: Auto-compounding staking rewards (e.g., stkXPRT/XPRT)
- **Metastable Curves**: Low-fee swaps for correlated LSTs (0.01%)
- **Maintained for**: stkXPRT (PSTAKE), milkTIA (Milkyway) — backward-compatible routing
- **LP Depth Growth**: Shared 30% reinvestment pool with Osmosis destinations

### 3.3 Performance Metrics (Phase C)

| Metric | Forward Flow | Reverse Flow | Notes |
|--------|--------------|--------------|-------|
| **End-to-End Time** | ~10-11s | ~12-15s | Includes ZK proof generation |
| **Proof Generation** | ~9s (SP1) | ~9s (SP1 event) | Theta Edge Cloud optimized |
| **Verification** | ~100ms | ~100ms | CosmWasm/EVM constant-time |
| **Fee** | 0.5% bridge fee | 0.5% burn fee | Both routes to FeeCollector |
| **Security Model** | ZK proof | ZK proof + nonce | Trustless both directions |
| **Throughput** | 52.89 tx/min | ~50 tx/min | Phase B validated |

### 3.4 ZK Prover Extensions for AI <!-- v5.0 -->

**SP1 zkVM v5.0** extends the bidirectional bridge proof circuits with five new capabilities for the AI DePIN module. These extensions live in `sp1-prover/program/src/main.rs` and are consumed by the `ai-listener.js` backend via the existing SP1 prover HTTP API.

#### 3.4.1 New Proof Types

The `ProofType` enum now includes two Phase E variants alongside the original three:

| Proof Type | Phase | Description |
|------------|-------|-------------|
| `ForwardDeposit` | C | TFUEL → ibcTFUEL deposit proofs (unchanged) |
| `ReverseBurn` | C | ibcTFUEL → TFUEL withdrawal proofs (unchanged) |
| `FeeBurn` | C | FeeCollector batch burn proofs (unchanged) |
| **`AITask`** | **E.2** | **AI inference/compute/data task settlement proofs** |
| **`A2AMessage`** | **E.3** | **Agent-to-Agent/Machine-to-Machine message verification proofs** |

#### 3.4.2 zkML Inference Circuits (AITask)

The `AITask` proof circuit validates AI compute settlements across Theta Edge Cloud, Akash, and Bittensor:

**Public inputs** (committed on-chain):
- `task_type`: `ComputeBid` | `ComputeResult` | `InferenceRequest` | `CapabilityQuery` | `DataAttestation`
- `source_chain` / `destination_chain`: `Theta` | `Osmosis` | `Akash` | `Bittensor` | `Persistence`
- `task_id_hash`: SHA-256 of task ID (matches `ai-listener.js` task format)
- `output_hash`: Hash of compute/inference output — **critical for `COMPUTE_RESULT`** attestation
- `fee_amount` / `fee_bps`: Variable fee (50-100 BPS = 0.5-1.0%)
- `nonce`: Per-agent replay protection

**Private inputs** (hidden from chain):
- `gross_amount`, `source_tx_hash`, `model_id_hash`, `input_hash`, `provider_hash`
- `ibc_channel_hash`: IBC channel for Osmosis/Akash routing
- `tao_evm_target`: TAO EVM contract address for Bittensor calls

**Task-type-specific constraints:**

| Task Type | Constraint | Rationale |
|-----------|-----------|-----------|
| `COMPUTE_RESULT` | `output_hash ≠ 0`, `execution_duration > 0` | Proves job completed with verifiable output |
| `INFERENCE_REQUEST` | `model_id_hash ≠ 0`, `input_hash ≠ 0` | Binds inference to specific model + input |
| `COMPUTE_BID` | `provider_hash ≠ 0` | Proves bid targets a real compute provider |
| `DATA_ATTESTATION` | `input_hash ≠ 0` | Binds attestation to specific dataset |
| `CapabilityQuery` | (no additional) | Lightweight discovery, minimal constraints |

**Chain-specific routing validation:**
- **Osmosis / Akash / Persistence**: Requires valid `ibc_channel_hash` (IBC-routed)
- **Bittensor (TAO)**: Validates `tao_evm_target` if non-zero (EVM-compatible Substrate bridge)
- **Theta**: No IBC routing required (local compute)

**Example — `COMPUTE_BID` flow:**

```
1. AI agent on Theta emits COMPUTE_BID intent
   → ai-listener.js detects event, routes to Theta Edge Cloud
   
2. ai-listener.js generates proof request:
   { ai_task: true, task_type: "compute_bid",
     source_chain: "theta", destination_chain: "akash",
     fee_bps: 50, output_hash: null, ... }

3. SP1 prover validates:
   ✅ fee_bps in [50, 100]
   ✅ gross × fee_bps / 10000 = fee_amount
   ✅ net_amount = gross - fee
   ✅ provider_hash ≠ 0 (COMPUTE_BID constraint)
   ✅ ibc_channel_hash ≠ 0 (Akash destination)
   ✅ nonce is fresh → nullifier generated

4. Proof output:
   { nullifier, fee_commitment → FeeCollector.wasm,
     output_hash → Osmosis/Akash settlement }
```

**Example — `INFERENCE_REQUEST` flow:**

```
1. Osmosis agent sends INFERENCE_REQUEST via IBC memo:
   { xfuel_ai_intent: { type: "inference_request",
     model_id: "llama-3", input_hash: "0xabc...", budget: "1000000" } }

2. ai-listener.js routes to Theta Edge inference API
   → Theta Edge returns output_hash + execution time

3. SP1 prover generates settlement proof:
   ✅ model_id_hash ≠ 0, input_hash ≠ 0 (INFERENCE_REQUEST constraints)
   ✅ fee = 0.5% of budget
   ✅ output_hash bound to task context via poseidon(output_hash, task_id, source_tx)

4. Settlement: AKT/OSMO released to provider, 0.5% → FeeCollector → RevenueSplitter (30/30/25/15)
```

#### 3.4.3 A2A/M2M Message Verification Circuits

The `A2AMessage` proof circuit enables **trustless agent-to-agent communication** across Theta, Akash, and Bittensor:

**ZK proof validates:**
1. Message originated from a **registered agent** (on-chain identity commitment)
2. **Escrow locked** on source chain (if payment required — mandatory for `COMPUTE_BID` and `INFERENCE_REQUEST`)
3. **Nonce is fresh** (per-agent, per-nonce replay protection)
4. **TTL not expired** (1 second to 24 hours, enforced in-circuit)
5. **Payload hash matches** committed data (prevents tampering)
6. **IBC channel valid** for cross-chain delivery (Osmosis ↔ Akash routing)

**Escrow rules by message type:**

| Message Type | Escrow Required | Rationale |
|-------------|----------------|-----------|
| `COMPUTE_BID` | Yes | Agent must lock funds before bidding |
| `INFERENCE_REQUEST` | Yes | Budget must be escrowed |
| `COMPUTE_RESULT` | No | Provider attests completion (payer already escrowed) |
| `CAPABILITY_QUERY` | No (must be zero) | Read-only discovery, no payment |
| `DATA_ATTESTATION` | No | Provenance certification only |

**A2A relay fee**: 0.1% (10 BPS) on escrow amounts, accumulated in `aggregate_fee` → FeeCollector.

#### 3.4.4 Fee Integration with FeeCollector

All AI task fees flow through the existing **FeeCollector.wasm** contract via the same 30/30/25/15 revenue split:

```
AI Task / A2A Message Proof Generated
       │
       ├─► fee_collector_commitment(fee_amount, task_id_hash, source_chain)
       │     → Deterministic hash committing fee to task context
       │
       ├─► aggregate_fee accumulated across batch
       │     → Reported in UnifiedBatchOutput for backend reconciliation
       │
       └─► ai-listener.js submits CW20 Send to FeeCollector.wasm:
             { send: { contract: FeeCollector, amount: fee_amount,
               msg: { source: "ai_task", task_id, task_type, source_chain } } }
             → FeeCollector accumulates → batch burn → RevenueSplitter (30/30/25/15)
```

**Fee rates:**
- **AI Task settlements** (`AITask` proof): 0.5-1.0% (50-100 BPS, configurable per-task)
- **A2A message relay** (`A2AMessage` proof): 0.1% (10 BPS) on escrowed amounts
- **Bridge fees** (unchanged): 0.5% both directions

#### 3.4.5 Non-Fatal Proof Failures

SP1 v5.0 introduces `ProofOutcome` to handle **non-fatal proof failures** without halting the pipeline:

```rust
pub enum ProofOutcome {
    Valid,                                    // Proof validated successfully
    Regenerable { reason_hash: Hash256 },     // Soft failure — can retry
    Invalid { reason_hash: Hash256 },         // Hard failure — permanently invalid
}
```

**Behavior:**
- `Valid`: Proof accepted, settlement proceeds normally
- `Regenerable`: Proof failed due to transient issue (e.g., stale block height, network timeout). The `ai-listener.js` backend detects this and **retries proof generation** with fresh inputs. AI task remains `COMPLETED` — only the proof is regenerated.
- `Invalid`: Proof failed due to fundamental constraint violation (e.g., fee mismatch, invalid identity). Task is marked `FAILED`.

This matches the `ai-listener.js` pattern where proof generation failure is **non-fatal** for task completion:

```javascript
// In ai-listener.js _generateTaskProof():
// "Proof generation failure is non-fatal for AI tasks — log and continue"
// "The task is still completed; proof can be regenerated later"
```

#### 3.4.6 Osmosis/Akash IBC Compatibility

The `ChainId` enum and IBC channel validation ensure proofs are routable across the Cosmos ecosystem:

- **Osmosis**: `ibc_channel_hash` maps to Osmosis ↔ Theta relay channel. Settlement in OSMO/ibcTFUEL pools.
- **Akash**: `ibc_channel_hash` maps to Akash ↔ Osmosis relay. Compute bids settled in AKT.
- **Bittensor (TAO)**: `tao_evm_target` field enables direct EVM contract calls on TAO's EVM layer. For Substrate-only interactions, `tao_evm_target` is zero and routing occurs via Composable Finance IBC bridge.
- **Persistence**: Backward-compatible — existing `chain_id` hash field (e.g., "core-1") continues to work for LST routing.

---

## 4. Zero-Knowledge Bridge

### 4.1 SP1 zkVM Overview

XFuel uses **SP1 zkVM** (Succinct Labs), a RISC-V-based zero-knowledge virtual machine with **transparent setup** (no trusted ceremony). Unlike Groth16 (which requires MPC ceremonies), SP1 provides:

- **RISC-V execution**: Write proof logic in Rust, compiled to RISC-V — no custom circuit language needed
- **Transparent setup**: STARK-based internally, wrapped in Groth16 via Succinct Network for on-chain verification
- **~9s proving time**: Phase B benchmarks validated 8.997s average across 25 E2E tests
- **~100ms verification**: Constant-time CosmWasm and EVM verification
- **Batching**: 11.6× speedup via batch proof aggregation (2.25s per deposit amortized)

**Evolution from Groth16 (v3.x → v4.x):** The original Groth16/Circom architecture (Phase A) was replaced by SP1 zkVM in Phase B. SP1 eliminates trusted setup risk while providing comparable verification speed. The STARK-to-SNARK recursion (via Succinct Network) produces compact Groth16-compatible proofs for on-chain verification at ~100ms.

### 4.2 Proof Types

SP1 v5.0 supports five proof types spanning financial bridge operations and AI DePIN settlements:

| Proof Type | Phase | Description | Circuit Module |
|------------|-------|-------------|----------------|
| `ForwardDeposit` | C | TFUEL → ibcTFUEL deposit proofs | `sp1-prover/program/src/main.rs` |
| `ReverseBurn` | C | ibcTFUEL → TFUEL withdrawal proofs | `sp1-prover/program/src/main.rs` |
| `FeeBurn` | C | FeeCollector batch burn proofs | `sp1-prover/program/src/main.rs` |
| `AITask` | E | AI inference/compute/data task settlement | `sp1-prover/program/src/main.rs` — `validate_ai_task()` |
| `A2AMessage` | E | Agent-to-Agent message verification | `sp1-prover/program/src/main.rs` — `validate_a2a_message()` |

### 4.3 Forward Deposit Proof (Theta → Osmosis)

The core bridge proof validates five critical properties:

```
Public inputs (known to everyone):
  - depositorAddress: Theta wallet (160 bits)
  - depositAmount: TFUEL wei (256 bits)
  - nonce: Unique ID (replay protection)

Private inputs (known only to prover):
  - merkleProof[8]: Proof of vault inclusion in VaultFactory
  - merkleRoot: Current vault tree root

Constraints verified:
  1. depositorAddress is valid Theta address
  2. depositAmount in bounds [0.1 TFUEL, configurable max]
  3. nonce is unique (not previously used)
  4. merkleProof validates depositor owns vault
  5. merkleRoot matches current VaultFactory state
```

### 4.4 Security Properties

| Property | Guarantee | Strength |
|----------|-----------|----------|
| **Soundness** | Cannot forge proofs (invalid deposits rejected) | Cryptographic (STARK/SNARK) |
| **Zero-Knowledge** | Verifier learns only "deposit is valid" — no private data leaks | Information-theoretic |
| **Completeness** | All legitimate deposits produce valid proofs (100% success rate) | Deterministic |
| **Non-Malleability** | Proofs cryptographically bound to specific deposit data | Hash-binding |
| **Transparent Setup** | No trusted ceremony required (SP1 STARK-based) | Eliminates MPC risk |

### 4.5 IBC Post-Mint Routing

IBC is used for **post-mint routing** within the Cosmos ecosystem (not for the Theta → Cosmos bridge itself):

- **Osmosis ↔ Akash**: IBC token routing for TFUEL → AKT compute settlements
- **Osmosis ↔ Persistence**: IBC routing for backward-compatible LST access (stkXPRT, milkTIA)
- **Standard**: ICS-20 fungible token transfers
- **Timeout**: 10 minutes with auto-refund
- **Relayers**: Independent operators with auto-restart and failover

**Note:** Theta does not have native IBC support. The bridge uses VaultFactory (EVM) + SP1 ZK proofs + CosmWasm minter. IBC operates exclusively within Cosmos for inter-chain routing.

---

## 5. Bi-Directional Bridge Flow

### 5.1 Forward Flow (Theta → Osmosis/Cosmos)

**User Journey: Deposit TFUEL, Earn 30-80% APY in Osmosis AI/DePIN Yield Pools**

```
1. User deposits TFUEL to VaultFactory (Theta EVM)
   ↓
2. Backend detects deposit event (2s polling via listener.js)
   ↓
3. SP1 prover generates ZK proof (~9s via Theta Edge Cloud)
   ↓
4. ZKVerifier.wasm validates proof (~100ms, Osmosis CosmWasm)
   ↓
5. ibcTFUEL.wasm mints tokens to user (CW20 on Osmosis)
   ↓
6. User routes ibcTFUEL to destination:
   ├── Osmosis AI/DePIN pools (AKT/OSMO, FET/OSMO, OCEAN/OSMO) — 40-80% APY
   ├── Osmosis LSTfi pools (stATOM/OSMO, stOSMO) — 30-50% APY
   ├── Akash GPU leases (TFUEL → AKT via IBC) — compute revenue
   └── Persistence LSTs (stkXPRT, milkTIA via Dexter) — 30-50% APY
   ↓
7. User earns yield across multi-chain DeFi ecosystem
```

**Security Properties:**
- ✅ ZK proof validates TFUEL is locked 1:1
- ✅ Nonce prevents replay attacks
- ✅ 12-block finality confirmation
- ✅ Merkle proof validates vault ownership

### 5.2 Reverse Flow (Cosmos → Theta)

**User Journey: Withdraw ibcTFUEL, Receive TFUEL on Theta**

```
1. User calls burn_for_unwrap(amount, theta_recipient) on ibcTFUEL.wasm (Osmosis)
   ↓
2. Contract calculates 0.5% fee (50 bps)
   ↓
3. Fee sent to FeeCollector.wasm via CW20 Send hook
   ↓
4. Remaining 99.5% burned from user balance
   ↓
5. Event emitted with SP1-readable attributes:
      - action = "burn_for_unwrap"
      - user = osmo1... (or persistence1... for backward-compat)
      - amount_burned = 995000000000000000
      - fee_amount = 5000000000000000
      - theta_recipient = 0x742d35...
      - nonce = 1 (increments per user)
      - block_height, timestamp, chain_id
      - for_sp1_proof = "burn_for_unwrap" (critical flag)
   ↓
6. Backend osmosis-listener.js detects event (~2s polling)
   ↓
7. SP1 Event Prover generates ZK proof of burn event (~9s)
      - Validates: nonce, amount, recipient, block_height
      - Proves: burn event occurred on Osmosis/Persistence mainnet
   ↓
8. Backend calls unwrapFromBurn(recipient, amount, sp1Proof) on VaultFactory
   ↓
9. VaultFactory validates SP1 proof (~100ms)
   ↓
10. VaultFactory releases TFUEL to theta_recipient
   ↓
11. User receives TFUEL on Theta wallet (minus 0.5% fee)
```

**Security Properties:**
- ✅ 0.5% fee discourages spam attacks
- ✅ Nonce (per-user) prevents replay attacks
- ✅ SP1 proof validates burn actually occurred
- ✅ FeeCollector accumulates fees for protocol revenue
- ✅ Theta address validation (0x + 40 hex chars)

### 5.3 Fee Distribution (Reverse Bridge)

```
User burns 10 ibcTFUEL:

  10 ibcTFUEL
       │
       ├─► 0.05 ibcTFUEL (0.5%) → FeeCollector.wasm
       │                            ↓
       │                       Accumulates until 100 ibcTFUEL threshold
       │                            ↓
       │                       trigger_fee_burn() → burns fees
       │                            ↓
       │                       Backend routes TFUEL to RevenueSplitter
       │                            ↓
       │                       30% BBB, 30% LP, 25% veXF, 15% Treasury
       │
       └─► 9.95 ibcTFUEL (99.5%) → Burned (reduces total supply)
                                      ↓
                                 Backend generates SP1 proof
                                      ↓
                                 VaultFactory releases 9.95 TFUEL to user
```

### 5.4 Nonce-Based Replay Protection

**Problem:** Without nonces, malicious actor could replay burn event to withdraw multiple times.

**Solution:** Per-user nonce tracking in ibcTFUEL.wasm

```rust
// In state.rs
pub const REVERSE_BURN_NONCES: Map<&Addr, u64> = Map::new("reverse_burn_nonces");

// In execute_burn_for_unwrap()
let nonce = REVERSE_BURN_NONCES
    .may_load(deps.storage, &info.sender)?
    .unwrap_or(0);
let next_nonce = nonce + 1;
REVERSE_BURN_NONCES.save(deps.storage, &info.sender, &next_nonce)?;

// Emit nonce in event attributes
.add_attribute("nonce", next_nonce.to_string())
```

**SP1 Proof Validation:**
```rust
// In VaultFactory.sol unwrapFromBurn()
function unwrapFromBurn(
    address recipient,
    uint256 amount,
    bytes calldata sp1Proof
) external {
    // Decode SP1 proof public inputs
    (address user, uint256 burnedAmount, uint64 nonce, uint256 blockHeight) = 
        decodeSP1Proof(sp1Proof);
    
    // Check nonce hasn't been used
    require(!usedNonces[user][nonce], "Nonce already used");
    usedNonces[user][nonce] = true;
    
    // Validate SP1 proof
    require(sp1Verifier.verify(sp1Proof), "Invalid SP1 proof");
    
    // Release TFUEL
    payable(recipient).transfer(amount);
    emit UnwrapFromBurn(user, recipient, amount, nonce);
}
```

### 5.5 Edge Cases & Failure Modes

**Case 1: User burns but backend is offline**
- **Impact:** User waits for unwrap, no TFUEL released yet
- **Resolution:** Backend restarts, replays missed events from last checkpoint
- **Max delay:** 24h (before manual intervention)

**Case 2: SP1 proof generation fails**
- **Impact:** Unwrap transaction not submitted to Theta
- **Resolution:** Backend retries with exponential backoff (5 attempts)
- **Fallback:** Admin manually generates proof + submits

**Case 3: Theta unwrapFromBurn() transaction reverts**
- **Impact:** User's ibcTFUEL already burned, but TFUEL not released
- **Resolution:** Backend detects revert, logs to monitoring
- **Manual recovery:** Admin reviews logs, resubmits with correct gas/nonce
- **User protection:** Circuit breaker pauses reverse bridge if revert rate >5%

**Case 4: Invalid theta_recipient address**
- **Impact:** Burn transaction fails validation before execution
- **User error message:** "Invalid Theta address format (must be 0x + 40 hex chars)"
- **No loss:** User retains ibcTFUEL, can retry with correct address

**Case 5: FeeCollector accumulation never reaches threshold**
- **Impact:** Fees sit idle in FeeCollector, not burned
- **Resolution:** Admin calls `trigger_fee_burn()` manually (monthly)
- **Alternative:** Lower threshold to 10 ibcTFUEL if volume low

---

## 6. XFuel Tokenomics

### 6.1 Revenue Model (Updated for Multi-Chain + AI DePIN) <!-- v5.0 -->

XFuel Protocol generates revenue from four primary sources:

1. **Bridge Fees (Forward)**: 0.5% on TFUEL deposits → RevenueSplitter
2. **Bridge Fees (Reverse)**: 0.5% on ibcTFUEL burns → FeeCollector → RevenueSplitter
3. **AI DePIN Task Fees**: 0.5-1% on AI compute settlements (inference routing, GPU leases, A2A/M2M comms) → RevenueSplitter <!-- v5.0 -->
4. **LP Swap Fees**: 0.01% on Osmosis/Dexter pool trades (shared with LPs) <!-- v5.0 -->

**Distribution (30/30/25/15 Model):**

```
Total Protocol Revenue (Bridge Fees + LP Fees)
       │
       ├─► 30% Buyback & Burn (BBB)
       │     - Market buy XF token
       │     - Permanent burn → reduces supply
       │     - Creates deflationary pressure
       │
       ├─► 30% LP Reinvestment
       │     - Deepen Dexter pools (stkXPRT, milkTIA)
       │     - Lower slippage → attracts more volume
       │     - Compounds protocol TVL over time
       │
       ├─► 25% veXF Yield Distribution
       │     - Rewards XF token lockers (1-3 year locks)
       │     - Distributed pro-rata by lock weight
       │     - Incentivizes long-term alignment
       │
       └─► 15% Treasury
             - Team compensation (vested)
             - Audits, bug bounties, operations
             - Emergency reserve fund
```

**Impact of Multi-Chain + AI DePIN Revenue (v4.5):** <!-- v5.0 -->
- v4.4: 2× fee surface area (forward + reverse bridge fees)
- v4.5: **3× fee surface area** adds AI compute task fees (0.5-1% on settlements)
- **Projected volume mix (Phase E steady-state):** 60% AI tasks (inference routing, compute bids), 25% data/comms (A2A/M2M messaging), 15% financial settlements (bridge deposits/withdrawals) <!-- v5.0 -->
- Example: $2M monthly volume ($1.2M AI tasks, $500K comms, $300K settlements) = $17K fees/month
  - BBB: $5.1K (30%) → buy + burn XF
  - LP: $5.1K (30%) → deepen Osmosis + Dexter pools
  - veXF: $4.25K (25%) → distribute to lockers
  - Treasury: $2.55K (15%) → operations + AI infra

#### 6.1.1 AI-Driven Fee Examples <!-- v5.0 -->

**Example A — $100 INFERENCE_REQUEST task (Osmosis → Theta Edge via Akash):**

```
1. User submits INFERENCE_REQUEST via POST /task-request:
   { message_type: "inference_request", chain_id: "akash",
     amount: "10000000", model_id: "llama-3-70b", ... }

2. Fee calculated (calculate_task_fee from api.js / server.js):
   gross_amount = $100.00 (10,000,000 micro-units)
   fee_bps      = 50 (0.5%)
   fee_amount   = $0.50 (50,000 micro-units)
   net_amount   = $99.50 (9,950,000 micro-units)

3. Fee → FeeCollector.wasm → RevenueSplitter (30/30/25/15):
   ├── BBB:      $0.150 (30%) → market buy XF → permanent burn
   ├── LP:       $0.150 (30%) → deepen Osmosis ibcTFUEL/AKT pool
   ├── veXF:     $0.125 (25%) → distribute to 3-year lockers
   └── Treasury: $0.075 (15%) → Akash GPU infrastructure fund

4. Net $99.50 → Theta Edge Cloud inference → result returned to user
```

**Example B — $1,000 COMPUTE_BID task (Theta → Bittensor subnet 18):**

```
1. AI agent routes COMPUTE_BID via server.js:
   { message_type: "compute_bid", chain_id: "bittensor",
     amount: "100000000", subnet_id: 18, fee_bps: 75 }

2. Fee calculated at 0.75% (75 BPS — higher complexity task):
   gross_amount = $1,000.00
   fee_amount   = $7.50
   net_amount   = $992.50

3. 30/30/25/15 split on $7.50:
   ├── BBB:      $2.25 → XF buyback + burn
   ├── LP:       $2.25 → AKT/OSMO + FET/OSMO pool depth
   ├── veXF:     $1.875 → staker yield
   └── Treasury: $1.125 → subnet registration fees
```

**Example C — $250 A2A COMPUTE_BID escrow (Theta → Akash cross-chain):**

```
1. Agent sends A2A message via POST /a2a-message:
   { message_type: "compute_bid", escrow_amount: "25000000",
     sender_chain: "theta", recipient_chain: "akash", ... }

2. Relay fee calculated (0.1% on escrow):
   escrow_amount = $250.00
   relay_fee     = $0.25 (10 BPS)

3. 30/30/25/15 split on $0.25:
   ├── BBB:      $0.075
   ├── LP:       $0.075
   ├── veXF:     $0.0625
   └── Treasury: $0.0375
```

#### 6.1.2 Fee Analytics & Volume Mix Reports <!-- v5.0 -->

XFuel provides a dedicated **fee-analytics.js** script (`backend/theta-bridge/src/fee-analytics.js`) for real-time revenue monitoring and volume mix analysis. The script integrates with FeeCollector.wasm on-chain queries, server.js health endpoints, and the `calculate_task_fee()` function shared across api.js, server.js, and main.rs.

**Key analytics capabilities:**

| Feature | Description |
|---------|-------------|
| **Volume Mix Reports** | Tracks AI tasks (60% target) vs. data/comms (25%) vs. settlements (15%) — alerts when mix deviates from Phase E targets |
| **Fee Stream Breakdown** | Per-stream totals: AI task fees (0.5-1%), A2A relay (0.1%), data attestation (0.25%), bridge fees (0.5%) |
| **Revenue Split Tracking** | Real-time 30/30/25/15 allocation: BBB burns, LP reinvestment, veXF yield, Treasury operations |
| **FeeCollector State** | On-chain query of accumulated_fees, total_burned, ready_to_burn status via CW20 smart query |
| **TVL Milestone Tracking** | $5M TVL unlock (Phase D), $20M TVL (Phase E), $100M+ TVL (Phase F) progress |
| **Prometheus Export** | Prometheus-compatible `/metrics` endpoint for Grafana dashboards |
| **FeeVisualizer Data** | JSON chart data (Recharts-compatible) for the frontend FeeVisualizer component |

**Example analytics output (simulated $2M monthly volume):**

```
Volume Mix:
  ██████████████████ 60% AI Tasks ($1,200,000)
  ███████▌ 25% Data & Communications ($500,000)
  ████▌ 15% Financial Settlements ($300,000)

Fee Streams:
  AI Task Fees (avg 0.75%):   $9,000.00
  A2A Relay Fees (0.1%):      $200.00
  Data Attestation (0.5%):    $750.00
  Bridge Fees (0.5%):         $1,500.00

TOTAL FEES: $11,450.00/month

30/30/25/15 Split:
  30% BBB:      $3,435.00 → buy + burn XF
  30% LP:       $3,435.00 → deepen Osmosis pools
  25% veXF:     $2,862.50 → distribute to lockers
  15% Treasury: $1,717.50 → operations + AI infra
```

The analytics script feeds data directly into the **FeeVisualizer** frontend component (revenue split pie charts, scenario comparison bar charts, BPS rate tables) — see Section 12.6 for dashboard details.

### 6.2 Reverse-Burn Sustainability Loop

**Traditional Tokenomics Problem:** LP fees extracted → dumped on market → price decay

**XFuel Solution:** 30% of LP fees reverse-burned → buyback XF → permanent burn

```
User trades ibcTFUEL for stOSMO on Osmosis
       ↓
Osmosis LP fees collected (0.15-0.3% tiered)
       ↓
30% of fees → RevenueSplitter
       ↓
RevenueSplitter: 30% BBB (buyback-burn XF)
                 30% LP (reinvest in Osmosis pools)
                 25% veXF yields
                 15% Treasury (e.g., Akash GPU reservations)
```

This recirculates 30% of fees back into protocol sustainability, compounding LP depth and XF scarcity over time — no emissions required.

**Compounding Effect:**
- Year 1: 100M XF supply, $500K revenue → 10M XF burned (90M remaining)
- Year 2: 90M XF supply, $2M revenue → 40M XF burned (50M remaining)
- Year 3: 50M XF supply, $10M revenue → 150M XF burned... wait, supply is exhausted?

**Mitigation:** Mint cap (1B XF) with tapering burn rate after 50% supply reduction.

### 6.3 veXF Governance & Yield Boosting

**veXF = vote-escrowed XF** (lock XF for 1-3 years, receive governance power + yield boost)

| Lock Duration | veXF Multiplier | Yield Boost | Voting Power |
|---------------|-----------------|-------------|--------------|
| 1 year        | 1x              | 1x          | 1x           |
| 2 years       | 2x              | 1.5x        | 2x           |
| 3 years       | 3x              | 2x          | 3x           |

**Yield Boost Example:**
- User locks 10,000 XF for 3 years → receives 30,000 veXF
- Protocol distributes $10K to veXF holders this epoch
- Total veXF supply: 300,000
- User's share: 30,000 / 300,000 = 10%
- User receives: $1,000 (vs $333 if unlocked)

**Governance Powers:**
- ✅ Vote on LP allocation (which Dexter pools to deepen)
- ✅ Vote on fee structure (0.5% reverse fee adjustment)
- ✅ Vote on treasury expenditures (>$50K requires quorum)
- ✅ Emergency circuit breaker activation (requires 67% supermajority)

### 6.4 Tokenomics Summary <!-- v5.0 -->

| Metric | Value | Notes |
|--------|-------|-------|
| **Total Supply** | 1,000,000,000 XF | Fixed cap |
| **Circulating (Launch)** | 150,000,000 XF | 15% initial |
| **Team/Advisors** | 200,000,000 XF | 4-year vest, 1-year cliff |
| **Ecosystem Incentives** | 400,000,000 XF | Milestone-unlocked |
| **Treasury** | 150,000,000 XF | Operations, audits |
| **Liquidity Mining** | 100,000,000 XF | 2-year distribution |
| **Revenue Split** | 30/30/25/15 | BBB/LP/veXF/Treasury (**unchanged across all streams**) |
| **Forward Bridge Fee** | 0.5% | Standard |
| **Reverse Bridge Fee** | 0.5% | v4.4 |
| **AI DePIN Task Fee** | 0.5-1% | v4.5 — compute settlements, inference routing |
| **LP Swap Fees** | 0.01% | Osmosis + Dexter pools |

---

## 7. Governance & veXF

### 7.1 veXF Token

**veXF** (vote-escrowed XF) is the non-transferable governance token earned by locking XF for 1-3 years.

| Lock Duration | veXF Multiplier | Yield Boost | Voting Power |
|---------------|-----------------|-------------|--------------|
| 1 year        | 1×              | 1×          | 1×           |
| 2 years       | 2×              | 1.5×        | 2×           |
| 3 years       | 3×              | 2×          | 3×           |

### 7.2 Governance Powers

veXF holders vote on (1 veXF = 1 vote, quadratic weighting for whale resistance):

1. **LP Allocation**: Which Osmosis/Dexter pools receive 30% LP reinvestment
2. **Compute Routing**: Preferred AI compute providers (Theta Edge vs Akash vs Bittensor)
3. **Fee Structure**: Bridge fee (0.5%), AI task fee (0.5-1%), A2A relay fee (0.1%) adjustments
4. **Treasury Spending**: Grants, audits, AI infrastructure ($50K+ requires quorum)
5. **Emergency Actions**: Circuit breaker activation (67% supermajority required)

### 7.3 Governance Timeline

| Phase | Milestone | Target |
|-------|-----------|--------|
| Phase D | veXF governance live (parameter voting) | Q2 2026 |
| Phase D+ | Treasury governed by DAO proposal system | Q3 2026 |
| Phase E | Admin keys transferred to Governor contract (5-day timelock) | Q4 2026 |
| Phase F | Full DAO transition (protocol fully autonomous) | 2027 |

---

## 8. Revenue Model

### 8.1 Revenue Sources (v5.0 — All Streams)

XFuel generates revenue from five distinct fee streams, all flowing into the same **30/30/25/15 RevenueSplitter**:

| Source | Rate | Mechanism | Contract Reference |
|--------|------|-----------|--------------------|
| **Bridge Fee (Forward)** | 0.5% | TFUEL deposits → RevenueSplitter | `VaultFactory.sol` |
| **Bridge Fee (Reverse)** | 0.5% | ibcTFUEL burns → FeeCollector → RevenueSplitter | `ibcTFUEL.wasm` → `FeeCollector.wasm` |
| **AI Task Fee** | 0.5-1% | Compute settlements, inference routing → FeeCollector | `AIVerifier.wasm`, `AIDePINRouter.sol`, `TAOWrapper.sol` |
| **A2A Relay Fee** | 0.1% | Agent-to-agent message escrow → FeeCollector | `AIVerifier.wasm`, `AIDePINRouter.sol` |
| **LP Swap Fee** | 0.01% | Osmosis/Dexter pool trades (shared with LPs) | Osmosis DEX, Dexter DEX |

### 8.2 Fee Calculation (Shared Logic)

The `calculateTaskFee()` function is implemented identically across four codebases to ensure consistency:

```
fee_amount = (gross_amount × fee_bps) / 10000
net_amount = gross_amount - fee_amount

Fee BPS Range: 50-100 (0.5%-1.0%)
Minimum Task Amount: 10,000 units (dust protection)
```

**Implementation sync points:**
- `sp1-prover/program/src/main.rs` → `calculate_task_fee()` (Rust, in-circuit)
- `backend/theta-bridge/src/server.js` → `calculateTaskFee()` (JavaScript, API)
- `backend/theta-bridge/src/fee-analytics.js` → `calculateTaskFee()` (JavaScript, analytics)
- `cosmwasm-contracts/ai-verifier/src/contract.rs` → `calculate_task_fee()` (Rust, on-chain)

### 8.3 Fee Flow Architecture

```
All Fee Sources (Bridge + AI Task + A2A Relay + LP Swap)
       │
       ├─► Theta EVM fees → RevenueSplitter.sol (direct)
       │     ├── VaultFactory 0.5% bridge fee
       │     └── AIDePINRouter / TAOWrapper task fees
       │
       └─► Osmosis CosmWasm fees → FeeCollector.wasm → batch burn → RevenueSplitter
             ├── ibcTFUEL.wasm 0.5% burn fee
             ├── AIVerifier.wasm 0.5-1% task fee
             └── AIVerifier.wasm 0.1% A2A relay fee

RevenueSplitter distributes (unchanged across ALL streams):
       ├─► 30% Buyback & Burn (BBB) → market buy XF → permanent burn
       ├─► 30% LP Reinvestment → deepen Osmosis + Dexter pools
       ├─► 25% veXF Yield → distribute to locked token holders
       └─► 15% Treasury → operations, audits, AI infrastructure
```

### 8.4 Revenue Monitoring: fee-analytics.js

The `backend/theta-bridge/src/fee-analytics.js` script provides real-time revenue monitoring across all fee streams. It integrates with:

| Integration | How |
|-------------|-----|
| **FeeCollector.wasm** | On-chain query: `accumulated_fees`, `total_burned`, `ready_to_burn` via CW20 smart query |
| **server.js** | `/health` endpoint metrics (AI listener stats, task counts, fee config) |
| **calculateTaskFee()** | Shared fee math across api.js, server.js, main.rs, contract.rs |
| **FeeVisualizer** | `--charts` flag outputs Recharts-compatible JSON for frontend pie/bar/table |
| **Prometheus/Grafana** | `--format prometheus --watch` serves `/metrics` endpoint |

**CLI usage:**
```bash
# Simulated revenue analysis
node src/fee-analytics.js --simulate --volume 2000000

# Live monitoring with Prometheus export
node src/fee-analytics.js --format prometheus --watch --port 9100

# JSON chart data for FeeVisualizer frontend
node src/fee-analytics.js --charts --output fee-charts.json
```

See Section 6.1.2 for detailed analytics output examples and Section 12.6 for the FeeVisualizer frontend component.

---

## 9. Technical Implementation

### 9.1 Smart Contracts (Solidity — Theta EVM)

| Contract | Address | Purpose |
|----------|---------|---------|
| `VaultFactory.sol` | `0xB0a266...` | TFUEL deposit vaults, Merkle proofs, `unwrapFromBurn()` |
| `RevenueSplitter.sol` | `0x1C4CEB...` | 30/30/25/15 fee distribution |
| `AIDePINRouter.sol` | TBD (Phase E) | AI task routing, SP1 proof settlement, A2A messaging |
| `TAOWrapper.sol` | TBD (Phase E) | vTAO ERC-20 wrapper, Bittensor subnet inference, Substrate bridge |

**Key Security Patterns:**
- ReentrancyGuard (OpenZeppelin) on all state-changing functions
- Checks-Effects-Interactions pattern
- AccessControl with `RELAYER_ROLE` for backend settlement calls
- Emergency pause with multisig guardian
- Nonce-based replay protection for unwraps and A2A messages

### 9.2 CosmWasm Contracts (Rust — Osmosis/Persistence)

| Contract | Chain | Purpose |
|----------|-------|---------|
| `ZKVerifier.wasm` | Osmosis (primary) | SP1 proof verification (~100ms) |
| `ibcTFUEL.wasm` | Osmosis (primary) | CW20 token, `burn_for_unwrap()`, IBC-enabled |
| `FeeCollector.wasm` | Osmosis | Fee accumulation, batch burn, CW20 Receive hook |
| `AIVerifier.wasm` | Osmosis (Phase E) | AI task routing, A2A messaging, fee collection |
| `ZKVerifier.wasm` | Persistence (compat) | Backward-compatible proof verification |
| `ibcTFUEL.wasm` | Persistence (compat) | Backward-compatible CW20 token |

### 9.3 Backend Services (Node.js — Theta Edge Cloud)

| Service | File | Purpose |
|---------|------|---------|
| Forward Listener | `backend/theta-bridge/src/listener.js` | Monitor Theta deposits (2s polling) |
| Reverse Listener | `backend/theta-bridge/src/osmosis-listener.js` | Monitor Osmosis/Cosmos burns for `burn_for_unwrap` events |
| AI Listener | `backend/theta-bridge/src/ai-listener.js` | Monitor Osmosis/Akash IBC for AI intents (Phase E) |
| M2M API Server | `backend/theta-bridge/src/server.js` | REST API: `/task-request`, `/a2a-message`, `/prove-result`, `/task-status` |
| Fee Analytics | `backend/theta-bridge/src/fee-analytics.js` | Revenue monitoring, Prometheus export, FeeVisualizer data |
| SP1 Prover Client | `backend/theta-bridge/src/sp1-prover-client.js` | SP1 proof generation requests |

### 9.4 SP1 Prover (Rust — RISC-V)

| Component | Path | Purpose |
|-----------|------|---------|
| Circuit Program | `sp1-prover/program/src/main.rs` | ForwardDeposit, ReverseBurn, FeeBurn, AITask, A2AMessage proofs |
| Host Binary | `sp1-prover/host/` | Prover execution, proof submission |
| Benchmarks | `sp1-prover/BENCHMARKS.md` | Phase B results: 8.997s avg, 52.89 tx/min |

### 9.5 Enum/Struct Consistency Matrix

All contracts and services share identical enum values for cross-component interoperability:

| Enum | Values | Synced Across |
|------|--------|---------------|
| `ChainId` | Theta(0), Osmosis(1), Akash(2), Bittensor(3), Persistence(4) | main.rs, AIDePINRouter.sol, TAOWrapper.sol, AIVerifier.wasm, server.js, ai-listener.js |
| `MessageType` | ComputeBid(0), ComputeResult(1), InferenceRequest(2), CapabilityQuery(3), DataAttestation(4) | All above |
| `ProofOutcome` | Valid(0), Regenerable(1), Invalid(2) | All above |
| `ProofType` | ForwardDeposit, ReverseBurn, FeeBurn, AITask, A2AMessage | main.rs |

---

## 10. Risk Analysis & Mitigation

### 10.1 Smart Contract Risks

**Risk:** Bugs in CosmWasm contracts (ibcTFUEL.wasm, FeeCollector.wasm, ZKVerifier.wasm) or Solidity contracts (VaultFactory, RevenueSplitter)

**Mitigation:**
- ✅ CertiK audit (Q2 2026, $150K budget)
- ✅ Formal verification for critical functions (burn_for_unwrap, unwrapFromBurn)
- ✅ $500K bug bounty (Immunefi)
- ✅ Circuit breakers (pause reverse bridge if >5% tx revert rate)
- ✅ Phased rollout (1 TFUEL cap Phase C → 10 TFUEL Phase D → uncapped Phase E)

### 10.2 Reverse Bridge Risks (NEW v4.4)

**Risk 1: Nonce Desync**
- **Scenario:** Backend tracks wrong nonce, submits invalid proof to VaultFactory
- **Impact:** Unwrap transaction reverts, user's ibcTFUEL already burned
- **Mitigation:**
  - Backend queries on-chain nonce before each unwrap
  - Retry logic with fresh nonce fetch
  - Manual recovery process if <10 affected users
  - Insurance fund (treasury) for edge cases

**Risk 2: SP1 Event Proof Manipulation**
- **Scenario:** Attacker forges burn event proof to trigger unauthorized unwrap
- **Impact:** VaultFactory releases TFUEL without valid burn
- **Mitigation:**
  - SP1 proof validates block_height, timestamp, chain_id
  - ZKVerifier checks event hash against Persistence state root
  - Nonce prevents replay even if proof valid
  - Circuit breaker if suspicious unwrap volume detected

**Risk 3: FeeCollector Accumulation Lock**
- **Scenario:** FeeCollector accumulates fees but trigger_fee_burn() never called
- **Impact:** Revenue locked, not distributed to BBB/LP/veXF/Treasury
- **Mitigation:**
  - Automated trigger at 100 ibcTFUEL threshold (backend cron job)
  - Manual admin trigger if automation fails
  - Lower threshold to 10 ibcTFUEL if volume <$100K/month
  - Emergency withdrawal function (multisig 5-of-7)

**Risk 4: Backend Downtime During Burn**
- **Scenario:** User burns ibcTFUEL, backend offline, unwrap never triggered
- **Impact:** User waits indefinitely for TFUEL
- **Mitigation:**
  - Backend event replay from checkpoint (covers up to 24h downtime)
  - Monitoring alerts if osmosis-listener stops (PagerDuty)
  - Manual recovery: admin reviews burn events, submits unwrap txs
  - Max user wait time: 24h (SLA target: 99% <1 hour)

### 10.3 ZK Proof Risks

**Risk:** SP1 prover generates invalid proof, ZKVerifier accepts malicious mint/unwrap

**Mitigation:**
- ✅ SP1 transparent setup (no trusted ceremony risk)
- ✅ Formal verification of circuit constraints (RISC-V trace validation)
- ✅ Phase B testing: 25/25 E2E tests passed, 0 invalid proofs accepted
- ✅ Circuit breaker if >1% invalid proofs detected in production

### 10.4 Economic Risks

**Risk 1: Death Spiral (Reverse Bridge Bank Run)**
- **Scenario:** Mass withdrawals → TFUEL released from VaultFactory → ibcTFUEL supply crashes → Osmosis LP imbalance
- **Impact:** AKT/ibcTFUEL pool drained, remaining users cannot exit
- **Mitigation:**
  - Automated circuit breakers pause withdrawals at 20% TVL threshold (admin-governed reset)
  - Nonce protection prevents spam attacks
  - 30% reverse-burn recirculates fees to stabilize LPs
  - $500K emergency treasury for LP injections
  - Phase E utility volume (60% AI tasks) provides countercyclical buffer
  - Monitoring: fee-analytics.js tracks withdrawal velocity → early alerts

**Risk 2: veXF Governance Attack**
- **Scenario:** Whale accumulates 51% veXF, votes to drain treasury
- **Impact:** $2M treasury emptied, protocol cannot fund operations
- **Mitigation:**
  - Quadratic voting (sqrt of veXF balance)
  - Timelock on treasury withdrawals (7-day delay)
  - Multisig veto (5-of-7 can override malicious vote)
  - Governance participation rewards (reduces whale concentration)

### 10.5 Operational Risks

**Risk:** Backend services (listener.js, osmosis-listener.js) crash during high volume

**Mitigation:**
- ✅ Kubernetes deployment (auto-restart on failure)
- ✅ Redis persistence (event queue survives restarts)
- ✅ Load balancing (3 backend replicas, round-robin)
- ✅ Theta Edge Cloud redundancy (50+ edge nodes globally)
- ✅ 99.9% uptime SLA target

---

## 11. Economic Model & Projections

### 11.1 Revenue Growth Scenarios (v5.0 — Multi-Stream)

**Assumptions:**
- 200% annual TVL growth (Years 1-3)
- Phase E AI task volume begins Q4 2026
- Volume mix transitions: Year 1 (90% bridge / 10% AI) → Year 3 (40% bridge / 60% AI)
- Fee rates: 0.5% bridge, avg 0.75% AI tasks, 0.1% A2A relay

| Year | TVL | Monthly Volume | Bridge Fees | AI Task Fees | A2A Relay | Annual Revenue |
|------|-----|----------------|-------------|--------------|-----------|----------------|
| **1** | $5M | $500K | $2.5K | $0.5K | $0.1K | **$37K** |
| **2** | $20M | $2M | $6K | $9K | $0.5K | **$186K** |
| **3** | $50M | $5M | $10K | $27K | $1.5K | **$462K** |
| **4** | $100M | $10M | $15K | $55K | $3K | **$876K** |
| **5** | $200M | $20M | $20K | $110K | $6K | **$1.63M** |

### 11.2 AI Revenue Countercyclical Effect

AI task fees provide **countercyclical revenue** relative to DeFi bridge volume:

- **Bear market**: Bridge volume declines, but AI compute demand (inference, training) continues growing
- **Bull market**: Both bridge and AI volume increase
- **Net effect**: Revenue floor is higher than bridge-only models, reducing protocol death spiral risk

### 11.3 TVL Milestone Unlocks

| TVL Milestone | Unlock | Phase |
|---------------|--------|-------|
| **$5M** | Full bi-directional flow enabled, caps removed, bug bounty live | Phase D (Q2 2026) |
| **$20M** | AI DePIN Bridge live, 1,000+ AI agents, Akash IBC operational | Phase E (Q4 2026) |
| **$50M** | ZK Rollup layer evaluation, intent-based routing prototype | Phase F planning |
| **$100M+** | Top-3 Cosmos DeFi protocol, institutional custody integrations | Phase F (2027+) |

### 11.4 30/30/25/15 Split Projections (Year 3)

At $462K annual revenue:

| Bucket | % | Annual Amount | Use |
|--------|---|---------------|-----|
| **BBB** | 30% | $138.6K | Market buy XF → permanent burn → deflationary pressure |
| **LP** | 30% | $138.6K | Deepen Osmosis AI/DePIN yield pools + Dexter LST pools |
| **veXF** | 25% | $115.5K | Distribute to 3-year lockers (real yield, not emissions) |
| **Treasury** | 15% | $69.3K | Audits, Akash GPU reservations, TAO subnet fees |

---

## 12. Roadmap

### Phase C: Governance Prep (Complete — Feb 6, 2026) ✅

**Status:** Bi-directional bridge implementation complete, ready for governance vote

- ✅ Reverse bridge implementation (burn_for_unwrap + unwrapFromBurn)
- ✅ FeeCollector.wasm deployment
- ✅ SP1 event attribute integration
- ✅ Nonce-based replay protection
- ✅ Backend osmosis-listener implementation
- ✅ Mock testing framework (MOCK_MODE for governance demo)
- ✅ Whitepaper v4.4 (Bi-Directional ZK Bridge Edition)

### Phase D: Mainnet Launch + Osmosis Primary (Q2-Q3 2026)

**Prerequisites:**
- CertiK audit completion (ZKVerifier, ibcTFUEL, FeeCollector, VaultFactory — $150K budget)
- Bug bounty program launch ($500K via Immunefi)
- Osmosis CosmWasm contract deployment (ibcTFUEL.wasm, ZKVerifier.wasm)
- Persistence contracts maintained for backward-compatible routing

**Production Deployment Steps:**

| Step | Action | Chain | Audit Requirement |
|------|--------|-------|-------------------|
| D.1 | Deploy VaultFactory + RevenueSplitter | Theta mainnet | CertiK ✅ |
| D.2 | Deploy ZKVerifier.wasm + ibcTFUEL.wasm | **Osmosis mainnet** (primary) | CertiK ✅ |
| D.3 | Deploy FeeCollector.wasm | Osmosis | CertiK ✅ |
| D.4 | Maintain Persistence contracts | Persistence (core-1) | Existing audit |
| D.5 | Seed Osmosis liquidity | Osmosis DEX | N/A |
| D.6 | Initialize conservative caps | All chains | N/A |
| D.7 | 2-week monitoring + manual review | All chains | N/A |
| D.8 | Gradual cap increase (1→10→100→1000 TFUEL) | All chains | N/A |
| D.9 | Full bi-directional flow (caps removed) | All chains | N/A |

**$5M TVL Unlock (Phase D gate):**
- Full bi-directional flow enabled (no deposit/withdrawal caps)
- Bug bounty program fully operational
- Osmosis AI yield pool seeding complete (ibcTFUEL/AKT, ibcTFUEL/OSMO)
- Persistence backward-compatibility verified
- `fee-analytics.js` monitoring operational with Prometheus/Grafana dashboards

**Strategic Rationale (Yield + AI Focus):**

Osmosis provides superior yield opportunities (30-50%+ APYs on AI token and LSTfi pools), institutional-grade trading ($2B+ TVL), native superfluid staking, and gateway to Akash AI compute (direct IBC). XFuel positions itself as the **AI DePIN Yield Router** — the utility layer AI agents use to access yields and compute seamlessly. Persistence remains a supported destination for stkXPRT/milkTIA routing.

**Targets:** $5M TVL, 1,000 users, 10,000+ transactions

### Phase E Extension: AI DePIN Bridge (Q3-Q4 2026) <!-- v5.0 -->

**Vision:** Position XFuel as a **ZK-verifiable communication and settlement layer** for AI agent-to-agent (A2A) and machine-to-machine (M2M) interactions across decentralized compute networks. Volume is driven by **utility** — AI task routing, inference settlements, and data exchange — not passive yield farming.

#### E.1 Design Rationale: Utility-Driven Volume

Traditional DeFi bridges optimize for yield-seeking capital flows. The AI DePIN Bridge inverts this model: **protocol volume is a byproduct of real compute demand**, not speculative positioning.

**Projected Volume Composition (Phase E steady-state):**

| Source | Share | Description |
|--------|-------|-------------|
| **AI Task Routing** | 60% | Inference requests, model training jobs, GPU lease settlements between Theta Edge Cloud, Akash, and Bittensor (TAO) agents |
| **Data & Communications** | 25% | ZK-verified A2A message passing (agent capability negotiation, bid/ask for compute resources, result attestation) |
| **Financial Settlements** | 15% | Bridge deposits/withdrawals, LP rebalancing, fee distribution |

This composition means protocol revenue scales with **AI adoption** rather than TVL chasing — a fundamentally more defensible growth vector.

#### E.2 Integration Architecture

**Theta ↔ Osmosis (Yields Baseline)**

- ibcTFUEL liquidity on Osmosis AI/DePIN yield pools (established in Phase D)
- AI task revenue auto-routed to Osmosis LP positions
- Superfluid staking on AI token pairs (AKT/OSMO, FET/OSMO)
- Settlement layer for cross-chain AI agent payments

**Theta ↔ Akash/TAO (Synergies):** Theta GPUs solve Akash scarcity (IBC bids for more supply) and TAO congestion (EVM/Substrate inference with verifiable proofs), zkVM/ML ensuring privacy-secure workflows.

**Theta ↔ Akash (IBC for AI Compute Bids/Leases)**

- **Direct IBC channel**: Theta Edge Cloud credits ↔ AKT tokens for GPU marketplace
- **Compute bid relay**: AI agents on Theta submit GPU lease bids to Akash via ZK-verified IBC messages
- **Lease settlement**: SP1 proofs attest compute delivery (job hash, duration, output checksum)
- **A2A negotiation**: Agents discover each other's capabilities via on-chain registries, negotiate pricing through ZK-verified message passing
- **Fee capture**: 0.5-1% on each compute settlement → RevenueSplitter (30/30/25/15)

```
Theta Edge Cloud Agent                    Akash GPU Provider
       │                                         │
       ├─── ZK-verified capability query ────────▶│
       │◄── Signed bid (price, specs, SLA) ──────┤
       │                                         │
       ├─── SP1 proof: deposit locked ──────────▶│
       │         (TFUEL → AKT via Osmosis)       │
       │                                         │
       │         [GPU job executes]               │
       │                                         │
       │◄── SP1 proof: job complete ─────────────┤
       │         (output hash, duration)          │
       │                                         │
       ├─── Settlement: AKT released ───────────▶│
       │         (0.5-1% fee → RevenueSplitter)  │
       │                                         │
```

**Theta ↔ TAO (Substrate/EVM for AI Agents)**

- **Bittensor integration**: Bridge TFUEL ↔ TAO for decentralized AI model inference
- **Subnet routing**: XFuel routes inference requests to optimal Bittensor subnet (text, image, code)
- **EVM compatibility**: TAO's EVM layer enables direct VaultFactory-style proof verification
- **Substrate bridge**: For non-EVM TAO interactions, Substrate light-client IBC (via Composable Finance or similar)
- **A2A marketplace**: Theta compute agents register on Bittensor subnets, earning TAO rewards while XFuel captures routing fees

#### E.3 ZK-Verifiable A2A/M2M Communications

**Problem:** AI agents across Theta/Akash/TAO lack trustless comms; Akash/TAO face GPU scarcity/reliability.

**XFuel Solution:** SP1 zkVM for zkML proofs (trustless inference) and private A2A/M2M (verify bids/results without data leaks)—solving privacy/security. Theta GPUs provide cheaper/faster supply to Akash (marketplaces) and TAO (subnets), addressing availability issues.

Extend SP1 zkVM proofs beyond financial transactions to **verify AI agent communications**:

**Message Types:**

| Type | Description | ZK Proof Validates |
|------|-------------|-------------------|
| `COMPUTE_BID` | Agent requests GPU resources | Bid parameters, agent identity, escrow lock |
| `COMPUTE_RESULT` | Provider returns job output | Output hash, execution duration, SLA compliance |
| `CAPABILITY_QUERY` | Agent discovers peer capabilities | Query scope, requester authorization |
| `INFERENCE_REQUEST` | Route ML inference to subnet | Model ID, input hash, max latency, budget |
| `DATA_ATTESTATION` | Certify dataset provenance | Data hash, source chain, timestamp range |

**SP1 Circuit Extension:**

```rust
// sp1-prover/program/src/main.rs — Phase E A2A message verification
pub struct A2AMessage {
    pub msg_type: MessageType,        // COMPUTE_BID | COMPUTE_RESULT | etc.
    pub sender_chain: ChainId,        // theta | akash | bittensor
    pub recipient_chain: ChainId,
    pub payload_hash: [u8; 32],       // SHA-256 of message payload
    pub nonce: u64,                   // Per-agent replay protection
    pub escrow_amount: Option<u128>,  // TFUEL/AKT/TAO locked for task
    pub timestamp: u64,
    pub ttl: u64,                     // Message time-to-live (seconds)
}

// ZK proof validates:
// 1. Message originated from registered agent (on-chain identity)
// 2. Escrow locked on source chain (if payment required)
// 3. Nonce is fresh (no replay)
// 4. TTL not expired
// 5. Payload hash matches committed data
```

#### E.4 Fee Revenue: AI DePIN Tie-In

**Fee Structure (unchanged 30/30/25/15 split):**

| Fee Type | Rate | Trigger | Revenue Path |
|----------|------|---------|--------------|
| **Compute Settlement** | 0.5-1% | GPU lease finalized (Akash/Theta) | → RevenueSplitter → 30/30/25/15 |
| **Inference Routing** | 0.5% | ML job routed to Bittensor subnet | → RevenueSplitter → 30/30/25/15 |
| **A2A Message Relay** | 0.1% | ZK-verified agent message delivered | → FeeCollector → RevenueSplitter |
| **Data Attestation** | 0.25% | Dataset provenance certified on-chain | → FeeCollector → RevenueSplitter |
| **Bridge Fee (fwd/rev)** | 0.5% | TFUEL deposit or ibcTFUEL burn | → RevenueSplitter → 30/30/25/15 |

**Revenue Flow (unchanged):**

```
All AI DePIN Fees + Bridge Fees + LP Swap Fees
       │
       ├─► 30% Buyback & Burn (BBB)
       │     - Market buy XF token → permanent burn
       │     - AI task volume drives sustained burn pressure
       │
       ├─► 30% LP Reinvestment
       │     - Deepen Osmosis pools (AI/DePIN tokens, LSTfi pairs)
       │     - Deepen Dexter pools (stkXPRT, milkTIA)
       │
       ├─► 25% veXF Yield Distribution
       │     - Multi-source real yield (bridge + AI compute + data)
       │     - Utility-driven → less correlated to DeFi cycles
       │
       └─► 15% Treasury
             - AI infrastructure (Akash GPU reservations)
             - Bittensor subnet registration fees
             - CertiK audit for A2A circuit extensions
```

**Key insight:** AI task fees provide **countercyclical revenue** relative to DeFi bridge volume. During crypto bear markets, AI compute demand (inference, training) continues growing, maintaining protocol revenue and burn pressure when traditional bridge volume declines.

#### E.5 Phase E Production Milestones

| Milestone | Target | Metric | Deployment |
|-----------|--------|--------|------------|
| **E.1**: Akash IBC channel live | Q3 2026 | First TFUEL → AKT settlement | Osmosis IBC relay |
| **E.2**: A2A message circuit (SP1) | Q3 2026 | 5 message types verified | `main.rs` `validate_a2a_message()` |
| **E.3**: Osmosis AI pool seeding | Q3 2026 | $500K AKT/OSMO + FET/OSMO LP | Osmosis DEX pools |
| **E.4**: AIVerifier.wasm mainnet | Q3 2026 | On-chain AI task settlement | Osmosis CosmWasm |
| **E.5**: AIDePINRouter.sol mainnet | Q4 2026 | Theta EVM AI task routing | Theta mainnet |
| **E.6**: TAOWrapper.sol mainnet | Q4 2026 | vTAO wrapping + subnet inference | Theta mainnet |
| **E.7**: Bittensor subnet integration | Q4 2026 | Inference routing to 3+ subnets | TAO Substrate bridge |
| **E.8**: Unified DePIN dashboard | Q4 2026 | Theta + Akash + TAO in single UI | `frontend/` React app |
| **E.9**: 1,000+ AI agents registered | Q4 2026 | On-chain agent registry | AIVerifier.wasm |
| **E.10**: $1M/month AI task volume | Q1 2027 | Utility-driven, not yield-farmed | `fee-analytics.js` tracked |

**Q4 2026 Mainnet Target:** Full AI DePIN Bridge operational with:
- AIDePINRouter.sol + TAOWrapper.sol deployed on Theta mainnet (post-testnet validation)
- AIVerifier.wasm deployed on Osmosis mainnet (CertiK Phase E audit)
- `ai-listener.js` + `server.js` in production on Theta Edge Cloud (Kubernetes)
- `fee-analytics.js` monitoring with Prometheus/Grafana + FeeVisualizer frontend
- $5M TVL unlocked from Phase D → enables uncapped AI task settlements

**Targets:** $20M TVL, 3,000+ users, 1,000+ registered AI agents, 60%+ volume from AI tasks

### Phase F: Advanced Features (2027+)

**Conditional on Usage Data:**
- 🎯 **ZK Rollup Layer**: 10× throughput if >50K tx/month (bridge + AI tasks combined)
- 🎯 **Generalized ZK Bridge**: Any EVM → Any Cosmos chain (extend beyond Theta)
- 🎯 **Intent-Based Architecture**: Users/agents specify outcomes, protocol routes optimally
- 🎯 **Cross-DePIN Compute Router**: Theta Edge, Akash, Render, io.net — auto-route to cheapest provider
- 🎯 **Institutional Custody**: Fireblocks, Copper integration for institutional AI compute procurement
- 🎯 **Account Abstraction**: Gasless AI agent transactions, social recovery for agent keys
- 🎯 **$100M+ TVL Target**: Top-3 Cosmos DeFi protocol, premier DePIN liquidity hub

---

### 12.6 Tech Stack: Frontend Dashboard <!-- v5.0 -->

**AI DePIN Dashboard** (`frontend/`) — a standalone React 18 application for dev/testing the M2M API endpoints. Not for production A2A traffic; production agents consume the REST API directly via `X-API-Key` or ECDSA relayer authentication.

**Stack:**
- **Framework:** React 18 (CRA), Material-UI v6 (dark cyberpunk theme)
- **API Client:** Axios with configurable base URL and API key header
- **Charts:** Recharts (pie, bar, responsive)
- **State:** React Context API for global auth/key management

**Dashboard Components:**

| Component | Role | API Endpoint |
|-----------|------|-------------|
| **TaskSimulator** | Submit AI intents (INFERENCE_REQUEST to Akash, COMPUTE_BID to TAO, etc.) with chain/message type selectors, conditional fields, and real-time fee preview via `calculate_task_fee()` | `POST /task-request` |
| **A2ASender** | Send ZK-verifiable A2A messages with escrow validation per message type (required for COMPUTE_BID/INFERENCE_REQUEST, must-be-zero for CAPABILITY_QUERY), relay fee preview (0.1% on escrow) | `POST /a2a-message` |
| **StatusPoller** | Query task/A2A status with auto-polling toggle; displays ProofOutcome (Valid/Regenerable/Invalid), SP1 proof details, and settlement data | `GET /task-status`, `GET /prove-result` |
| **FeeVisualizer** | Interactive fee calculator (50-100 BPS slider), revenue split pie chart (30/30/25/15), scenario comparison bar chart (AI tasks vs A2A relay vs bridge fees), BPS comparison table with per-bucket breakdowns | Client-side calculation |
| **HealthMonitor** | Live server health with auto-refresh (10s), uptime display, fee config, supported chains/message types, AI listener status metrics | `GET /health` |

**Fee Visualization Examples:**

- **Revenue Split Pie Chart:** For a 1,000,000 unit task at 0.5% fee (5,000 fee units): 1,500 BBB (30%) / 1,500 LP (30%) / 1,250 veXF (25%) / 750 Treasury (15%)
- **Scenario Comparison Bar Chart:** Side-by-side comparison of AI inference (Akash, 0.5%), compute bid (TAO, 0.75%), A2A relay (0.1% on escrow), forward bridge (0.5%), reverse bridge (0.5%) — showing net-to-provider vs protocol-fee stacked bars
- **BPS Rate Table:** Tabular breakdown at 50/60/70/80/90/100 BPS with per-bucket amounts for BBB, LP, veXF, and Treasury

**Design Notes:**
- Modular component architecture for easy Phase E iteration
- Responsive layout (sidebar collapses to drawer on mobile)
- Dark cyberpunk theme matching the main Vite + React bridge UI
- Error handling for non-fatal proof failures (ProofOutcome.Regenerable)
- All chain and message type enums sync with `server.js`, `AIDePINRouter.sol`, and `main.rs`

---

## 13. Conclusion

XFuel Protocol v5.1 delivers the first **trustless cross-chain AI DePIN Yield Router**—an AI tech-driven crypto solution solving liquidity for Theta while addressing AI ecosystem pains like GPU scarcity (Akash/TAO), privacy/security in comms/inference via SP1 zkVM/zkML (proofs without data leaks).

1. **Trust:** SP1 zkVM eliminates reliance on oracles, multisigs, or centralized operators — both financial flows and AI agent communications secured by ZK proofs
2. **Performance:** ~9-second proving time with Theta Edge Cloud optimization (50-80% cost reduction)
3. **Destination Optimization:** Osmosis-primary routing provides 30-50%+ APY yield pools and deepest AI/DePIN token liquidity in Cosmos — dramatically outperforming Persistence
4. **AI Utility Volume:** ZK-verifiable A2A/M2M communications enable protocol revenue from AI compute demand (60% of projected volume), not just yield farming

**What v5.0 Finalizes:**
- **Complete production stack** — all contracts (AIDePINRouter.sol, TAOWrapper.sol, AIVerifier.wasm), backend (ai-listener.js, server.js, fee-analytics.js), and frontend (FeeVisualizer, TaskSimulator) production-synced
- **Osmosis direct routing** — 30-50%+ APY AI/DePIN yield pools ($2B+ TVL)
- **AI DePIN Bridge** — ZK-verified A2A/M2M compute settlements across Theta, Akash, and Bittensor
- **Utility-driven volume** — 60% AI tasks, 25% data/comms, 15% financial settlements
- **0.5-1% AI task fees + 0.1% A2A relay fees** — unchanged 30/30/25/15 revenue split
- **Countercyclical revenue** — AI compute demand grows independently of crypto market cycles
- **Production milestones** — Q2-Q3 2026 mainnet (Phase D), Q4 2026 AI DePIN mainnet (Phase E), $5M TVL unlocks
- **Fee monitoring** — `fee-analytics.js` with Prometheus/Grafana, FeeVisualizer frontend

The protocol's **XFuel Tokenomics** (30/30/25/15 distribution) applies identically to all revenue streams — bridge fees, AI compute settlements, inference routing, A2A relay fees, and LP swap fees. No tokenomics changes were required for the multi-chain pivot or AI DePIN extension. The flywheel accelerates: more AI utility → more fees → deeper LPs → better settlement rates → more AI agents onboarded.

With Phase C complete and the Osmosis/Akash pivot defined, Phase D (mainnet launch, Q2-Q3 2026) deploys Osmosis-primary contracts while maintaining Persistence compatibility. Phase E (Q3-Q4 2026) introduces the AI DePIN Bridge — transforming XFuel from a liquidity bridge into a **cross-chain settlement layer for decentralized AI**.

**For TFUEL holders:** Deposit TFUEL, access Osmosis AI/DePIN yield pools (30-80% APY), withdraw anytime (0.5% fee)  
**For AI agents:** ZK-verified compute settlements across Theta Edge, Akash GPU, Bittensor subnets  
**For XF holders:** Multi-source real yield (bridge fees + AI task fees), countercyclical to DeFi markets  
**For governance:** Vote on compute routing, AI pool allocations, fee structures via veXF

**Project Synergies:** Partnerships with Osmosis (yields), Akash (compute, solving GPU shortages), TAO (inference, addressing subnet resources)—unified by Theta GPUs for cheaper/faster, ZK-secure AI.

XFuel v5.1: Empowering decentralized AI with yields, security, privacy, and efficiency—beyond bridging.

---

## 14. References

1. **SP1 zkVM Documentation**: [Succinct Labs SP1 Docs](https://docs.succinct.xyz/)
2. **Osmosis Documentation**: [Osmosis Docs](https://docs.osmosis.zone/) <!-- v5.0 -->
3. **Akash Network Documentation**: [Akash Docs](https://docs.akash.network/) <!-- v5.0 -->
4. **Bittensor (TAO) Documentation**: [Bittensor Docs](https://docs.bittensor.com/) <!-- v5.0 -->
5. **Persistence Core Documentation**: [Persistence Docs](https://docs.persistence.one/)
6. **Dexter DEX**: [Dexter Protocol](https://dexter.zone/)
7. **Theta Network**: [Theta Labs](https://www.thetatoken.org/)
8. **CosmWasm**: [CosmWasm Docs](https://docs.cosmwasm.com/)
9. **Phase B Benchmarks**: `xfuel-protocol/sp1-prover/BENCHMARKS.md`
10. **Reverse Bridge Implementation**: `xfuel-protocol/cosmwasm-contracts/persistence-minter/src/contract.rs` (lines 316-406)
11. **IBC Protocol Specification**: [IBC Spec](https://ibc.cosmos.network/) <!-- v5.0 -->

---

## 15. Glossary

- **ibcTFUEL**: Wrapped TFUEL token on Cosmos chains (CW20 standard, IBC-enabled) — deployed on Osmosis (primary) and Persistence (compatible)
- **SP1 zkVM**: Zero-knowledge virtual machine (RISC-V-based, transparent setup)
- **veXF**: Vote-escrowed XF (governance + yield boost token)
- **Osmosis**: Primary destination DEX ($2B+ TVL, AI/DePIN token pairs, LSTfi, superfluid staking — 30-50%+ APYs) <!-- v5.0 -->
- **Akash Network (AKT)**: Decentralized GPU compute marketplace (Cosmos IBC-native) <!-- v5.0 -->
- **Bittensor (TAO)**: Decentralized AI model inference network (Substrate + EVM) <!-- v5.0 -->
- **A2A**: Agent-to-Agent — ZK-verified communication between AI agents across chains <!-- v5.0 -->
- **M2M**: Machine-to-Machine — automated inter-chain compute task settlement <!-- v5.0 -->
- **DePIN**: Decentralized Physical Infrastructure Network (compute, storage, AI) <!-- v5.0 -->
- **Dexter**: Native DEX on Persistence (Superfluid + Metastable pools)
- **stkXPRT**: Liquid staked XPRT via PSTAKE
- **milkTIA**: Liquid staked TIA via Milkyway
- **BBB**: Buyback & Burn (30% of revenue from all streams — bridge + AI + LP)
- **AIVerifier.wasm**: CosmWasm contract on Osmosis for AI DePIN task routing, SP1 proof settlement, A2A messaging, and fee collection (Phase E) <!-- v5.0 -->
- **FeeCollector**: CosmWasm contract accumulating bridge fees and AI task fees
- **Nonce**: Replay protection counter (per-user for burns, per-agent for A2A messages)
- **burn_for_unwrap**: Execute message triggering reverse bridge (Cosmos → Theta)
- **unwrapFromBurn**: VaultFactory function releasing TFUEL after SP1 proof validation
- **COMPUTE_BID**: A2A message type — agent requests GPU resources with ZK-verified escrow <!-- v5.0 -->
- **COMPUTE_RESULT**: A2A message type — provider attests job completion with output hash <!-- v5.0 -->

---

## Appendices

### Appendix A: Contract Addresses (Placeholder - Pending Deployment)

**Theta Mainnet:**
- VaultFactory: `TBD` (post-audit)
- RevenueSplitter: `TBD` (post-audit)

**Osmosis Mainnet (osmosis-1):** <!-- v5.0 -->
- AIVerifier.wasm: `TBD` (Phase E deployment — AI DePIN task routing + A2A messaging)
- ibcTFUEL.wasm: `TBD` (Osmosis-primary deployment, ICS-20 enabled)
- FeeCollector.wasm: `TBD` (receives AI task fees + bridge fees)

**Persistence Mainnet (core-1):**
- ZKVerifier.wasm: `TBD` (governance-approved — backward-compatible)
- ibcTFUEL.wasm: `TBD` (governance-approved)
- FeeCollector.wasm: `TBD` (governance-approved)

**Note:** Using dummy addresses in Phase C for mock testing (governance prep)

### Appendix B: Mock Testing Guide

XFuel v4.4 includes MOCK_MODE for governance validation without live ZK proving:

```rust
// In InstantiateMsg
pub struct InstantiateMsg {
    // ... existing fields ...
    pub mock_mode: Option<bool>, // Default: false (production)
}

// In execute_verify_and_mint
if config.mock_mode.unwrap_or(false) {
    // Skip verify_zk_proof, log "MOCK MINT"
    log("MOCK MODE: Skipping ZK verification");
} else {
    verify_zk_proof(&zk_proof, amount, &recipient)?;
}

// In execute_burn_for_unwrap
if config.mock_mode.unwrap_or(false) {
    // Emit mock SP1 attributes (no actual proof)
    response = response.add_attribute("mock_sp1_proof", "true");
}
```

**Usage:**
```bash
# Instantiate with MOCK_MODE for governance demo
persistenced tx wasm instantiate $CODE_ID \
  '{"name":"IBC Theta Fuel","symbol":"IBCTFUEL",...,"mock_mode":true}' \
  --from $ADMIN --chain-id core-1 --gas auto
```

### Appendix C: AWS Key Loading for Deployment

**SP1_PRIVATE_KEY** and **PERSISTENCE_DEPLOYER** mnemonics secured in AWS Secrets Manager:

```bash
# Retrieve SP1 private key
export SP1_PRIVATE_KEY=$(aws secretsmanager get-secret-value \
  --secret-id arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:SP1_PRIVATE_KEY \
  --query SecretString --output text)

# Retrieve Persistence deployer mnemonic
export PERSISTENCE_MNEMONIC=$(aws secretsmanager get-secret-value \
  --secret-id arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:PERSISTENCE_DEPLOYER \
  --query SecretString --output text)

# Import to persistenced keyring
echo "$PERSISTENCE_MNEMONIC" | persistenced keys add deployer --recover
```

**Rust AWS SDK Integration:**
```rust
use aws_sdk_secretsmanager::{Client, Config};

#[tokio::main]
async fn main() {
    let config = aws_config::load_from_env().await;
    let client = Client::new(&config);
    
    let sp1_key = client
        .get_secret_value()
        .secret_id("arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:SP1_PRIVATE_KEY")
        .send()
        .await
        .unwrap()
        .secret_string()
        .unwrap();
    
    std::env::set_var("SP1_PRIVATE_KEY", sp1_key);
}
```

### Appendix D: Phase C Deployment Values

```bash
# Persistence Core-1 (Mainnet)
CHAIN_ID=core-1
RPC_URL=https://rpc.persistence.one:443
ADMIN_ADDRESS=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e

# Theta Mainnet
THETA_RECIPIENT=0xD3EED5D4a61Beb3401E10D606f9957500AC9819a

# Dummy Addresses (Phase C Mock Testing)
VERIFIER_ADDRESS=persistence1000000000000000000000000000000000000
MINTER_ADDRESS=persistence1111111111111111111111111111111111111
FEE_COLLECTOR_ADDRESS=persistence1feecollector0000000000000000000000
```

---

**END OF WHITEPAPER v5.1**

For technical support: dev@xfuel.app  
For partnership inquiries: partnerships@xfuel.app  
For governance proposals: forum.osmosis.zone | forum.persistence.one  
For AI DePIN integration: depin@xfuel.app  
For fee analytics / monitoring: See `backend/theta-bridge/src/fee-analytics.js`

**License:** MIT  
**Last Updated:** February 11, 2026  
**Commit:** `v5.1.0`
