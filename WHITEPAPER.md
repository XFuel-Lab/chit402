# XFuel Protocol — Whitepaper v2.4

**AI Pumping Station: A Modular, ZK-Secured DePIN Hub for Cross-Ecosystem Intelligence**

*Version 2.4 — Hybrid Theta-Centric Architecture*
*March 2026*

---

## Abstract

XFuel Protocol is a **modular, zero-knowledge-secured DePIN hub** that pumps intelligence, compute, liquidity, and value across AI ecosystems. Built around a **hybrid Theta-centric architecture** — with Theta EdgeCloud as the primary GPU backbone — XFuel's **Core Layer** handles ZK proof verification, task routing, fee distribution, governance, and treasury operations. Independent **circuits** (specialized modules) plug into the Core Layer to serve specific use cases, while the orchestration layer routes workloads across Theta, Bittensor, Akash, Solana, and other DePIN networks based on cost, latency, and availability.

This whitepaper describes the Core Layer architecture, its components, and how they interact to enable trustless, verifiable pumping of AI workloads across heterogeneous blockchain environments. The design prioritizes:

1. **Full modularity** — Independent circuits plug in via event-driven interfaces; no shared state between modules.
2. **Theta-hybrid integration** — Theta EdgeCloud as the primary GPU and inference backbone, with ecosystem-agnostic circuits for Bittensor, Akash, Solana, and beyond.
3. **Circuit integrity** — Isolation for security and scalability, including subchain-ready architecture.
4. **2030-forward resilience** — Designed for multi-network AI economies at scale.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Core Layer Architecture](#2-core-layer-architecture)
3. [ZK Verification](#3-zk-verification)
4. [Task Routing & Inference Pipeline](#4-task-routing--inference-pipeline)
5. [Revenue & Fee Distribution](#5-revenue--fee-distribution)
6. [Governance (veXF)](#6-governance-vexf)
7. [SP1 Proof Hooks](#7-sp1-proof-hooks)
8. [Cross-Chain Integration](#8-cross-chain-integration)
9. [Use Cases](#9-use-cases)
10. [Tokenomics](#10-tokenomics)
11. [Security Model](#11-security-model)
12. [Roadmap](#12-roadmap)
13. [Technical Specifications](#13-technical-specifications) *(→ [`docs/Technical-Specifications.md`](docs/Technical-Specifications.md))*
14. [Circuit Implementations](#14-circuit-implementations--expansion-history) *(→ [`docs/Circuit-Design-and-Expansion.md`](docs/Circuit-Design-and-Expansion.md))*

---

## 1. Introduction

The proliferation of decentralized AI networks — compute marketplaces, inference providers, data attestation layers, and incentive protocols — creates a fragmented landscape. Each operates in isolation, with its own proof formats, fee structures, and settlement mechanisms.

### The AI DePIN Gap — Why XFuel Exists

AI DePIN projects promise to decentralize compute, storage, and data for AI workloads, but five critical layers remain underdeveloped across the industry, creating trust deficits, fragmentation, and scalability barriers.

**1. Verification and Proof Layer**
Most networks still rely on centralized oracles or honest-majority assumptions for task execution and payouts. XFuel solves this natively with SP1 zkVM proofs and hybrid Groth16 verification across EVM, CosmWasm, and Solana backends. Every inference, compute bid, or agent action is cryptographically proven on-chain with nullifier protection and circuit breakers — no trusted intermediaries required.

**2. Interoperability and Orchestration Layer**
DePIN silos (Theta GPUs, Akash compute, Bittensor subnets, Filecoin storage) force developers to build custom bridges. XFuel's Core Layer + modular circuits act as a unified orchestration hub: intents are routed intelligently (e.g., Bittensor task → Theta GPU when cheaper) via Hyperlane, with outcome-driven solving and cross-chain settlement in one flow.

**3. Security and Privacy Layer**
Data leaks and unverifiable inference remain widespread. XFuel delivers zkML circuits that keep model weights and inputs private while proving outputs on-chain. Combined with non-custodial escrow, agent webhooks, and optional sovereign-ID hooks, we enable privacy-preserving AI at scale without sacrificing auditability.

**4. Intelligence and Coordination Layer**
Raw DePIN infrastructure lacks embedded intelligence for autonomous coordination and failure prediction. XFuel's agent-first design (webhooks, MCP-compatible endpoints, preset workflows) turns passive pipes into adaptive systems. Agents can submit intents, receive real-time callbacks, and coordinate across Theta EdgeCloud, Bittensor, and beyond — all ZK-verified.

**5. Economic and Reward Architecture Layer**
Token models often ignore real hardware costs, leading to idle nodes and diluted incentives. XFuel's 30/30/25/15 revenue split, GPU-tier multipliers, and veXF governance create sustainable economics. Live ROI calculators and Fee-to-Stake routing align operator incentives with actual usage, while our hybrid Theta focus leverages EdgeCloud's real-world GPU network for competitive yields.

By addressing these layers head-on, XFuel is not just another DePIN protocol — it is the pumping station that makes decentralized AI economically viable and operationally simple at scale.

### How It Works

Concretely, XFuel provides a **Core Layer** — a minimal settlement and routing hub — into which any AI project integrates by deploying a **circuit** (a self-contained module). Circuits interact with the Core Layer exclusively through events: they submit task intents, receive ZK-verified settlement confirmations, and participate in protocol-wide fee sharing. The Core Layer verifies proofs, routes intents, distributes fees, and governs parameters — all domain-specific logic lives in circuits.

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Modularity** | Circuits plug into Core via events; no shared state between modules |
| **Theta-hybrid** | Theta EdgeCloud as primary GPU backbone; ecosystem-agnostic circuit layer for Bittensor, Akash, Solana, and beyond |
| **Low-gas settlement** | Target <100K gas per proof verification on EVM chains |
| **Trustless** | SP1 zkVM proofs replace trusted intermediaries |
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
| **CoreRevenueSplitter** | Collect and distribute protocol fees | `CoreRevenueSplitter.sol` | `xfuel-revenue-splitter` |
| **veXFGovernance** | Vote-escrowed governance for parameter updates | `veXFGovernance.sol` | — (EVM-only) |
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

## 3. ZK Verification

### 3.1 SP1 zkVM — How XFuel Proves Everything

Every settlement in XFuel — whether an AI inference, a compute bid, or an agent action — is cryptographically proven using **SP1 zkVM v6.0.2** (Succinct). SP1 compiles arbitrary Rust programs to RISC-V and executes them inside a zero-knowledge proving environment, producing a **260-byte Groth16 proof** that any on-chain verifier can check for under 270K gas.

XFuel runs a **dedicated SP1 proof program** (`sp1-prover/`) that takes inference inputs, model hashes, and settlement parameters as private inputs — serialized via binary encoding for minimal overhead — and outputs a verifiable commitment. The prover supports five proof types: ForwardDeposit, ReverseBurn, FeeBurn, AITask, and A2AMessage. In production, proofs are generated on **Theta EdgeCloud A100/H100 SXM GPU nodes** — achieving sub-200ms proof latency per deposit after real inference completes. For high-throughput workloads, XFuel batches up to **10 proofs** per recursive rollup (default `SP1_BATCH_SIZE=10`), achieving an **11.6x speedup** and amortizing on-chain verification to under 100K gas per proof. Live API fallbacks (EdgeCloud + RapidAPI) ensure resilient execution even during peak load. See [Section 4](#4-task-routing--inference-pipeline) for the live inference flow and [Section 9.3](#93-theta-inference-circuit) for Theta Inference Circuit details.

### 3.2 Theta EdgeCloud as Primary Prover Backend

Theta EdgeCloud is XFuel's primary proving infrastructure, with automatic fallback for resilience:

| Backend | Hardware | Latency | Use Case |
|---------|----------|---------|----------|
| **Theta EdgeCloud** (primary) | CUDA on H100 SXM / RTX 4090 | Sub-200ms | Real-time inference proofs |
| **Succinct Network** (fallback) | Distributed provers | ~2-5s | High-volume batch rollups |
| **Local CPU** (dev) | Host machine | ~30s | Testing / mock mode |

This hybrid approach ensures XFuel's ZK verification scales with Theta's GPU network while maintaining ecosystem-agnostic circuits for Bittensor, Akash, Solana, and beyond.

### 3.3 Three Verifier Backends

XFuel deploys native verifiers on three VM families, ensuring proofs can settle wherever value lives:

| Backend | Contract | Verification Method | Gas Cost | Proof Size |
|---------|----------|-------------------|----------|------------|
| **EVM** (primary) | `ZKVerifierSP1.sol` | SP1 Verifier Gateway (Groth16) | ~270K gas | 260 bytes |
| **CosmWasm** | `xfuel-zk-verifier` | arkworks BN254 pairing | ~250K gas_eq | 260 bytes |
| **Solana SVM** | `xfuel-solana-prover` | `alt_bn128` syscalls | ~220K CU | 260 bytes |

All three share the same BN254 curve, Groth16 proof system, nullifier-based replay protection, circuit registry, and pause/unpause controls. Proofs generated once can settle on any backend.

**Primary deployment:** Theta Mainnet (chain 361, TFUEL gas) with live EdgeCloud inference. Secondary chains include Bittensor EVM (964) with dTAO stake-gated verification and Hyperlane cross-chain relay, Osmosis/Akash via CosmWasm IBC, and Solana via Wormhole VAA bridging.

### 3.4 Key Capabilities

- **Batch verification** — Up to 20 proofs per EVM transaction, with per-item `ProofVerified`/`ProofFailed` events
- **Circuit breaker** — Auto-pause if failure rate exceeds 5% over 100+ verifications (1-hour window)
- **SP1-CC composed calls** — Bind proofs to historical EVM state for read→compute→verify workflows
- **Recursive rollup** (Phase 4) — SP1 Hypercube recursion aggregates up to 100 inner proofs into a single on-chain verification
- **Cross-chain relay** — Verify locally on one chain, dispatch result via Hyperlane or Wormhole to another — no re-verification needed

Circuit registration is admin-gated, transitioning to veXF governance control (see [Section 6](#6-governance-vexf)).

> For full verifier architectures, gas benchmarks, WASM/Solana program sizes, and multi-prover security matrices, see [`docs/Technical-Specifications.md`](docs/Technical-Specifications.md).

---

## 4. Task Routing & Inference Pipeline

### 4.1 The Live Inference Pipeline

XFuel's task routing is an **intent-driven, Theta-first system**: users or agents submit structured intents via preset hooks or the smart GPU selector, which routes to the optimal provider based on cost, latency, and model availability. The pipeline calls real EdgeCloud APIs (with RapidAPI fallback), generates ZK proofs on the same GPU infrastructure, and settles on-chain — all with full monitoring, webhook callbacks, and ROI insights.

```
Intent Submission (UI or Agent API)
  │
  ├─ Preset Hook or submitIntent(serviceId, inputHash)
  │     └─ TFUEL payment + 0.5% fee → CoreRevenueSplitter
  │
  ▼
CoreListener (ai-listener.js) — Smart GPU Selector
  │
  ├─ Routes to Theta EdgeCloud API (primary) or RapidAPI (fallback)
  ├─ GPU Tier: RTX 4090 (1x) → A100 (2.5x) → H100 SXM (5x)
  │
  ▼
EdgeCloud executes inference (LLM, image gen, STT, voice clone, RAG, video, detection)
  │
  ├─ completeIntent(intentId, outputHash, modelHash, latencyMs)
  ├─ SP1 proof generated on EdgeCloud GPU (sub-200ms, batch=10)
  │
  ▼
settleIntent(intentId, proof, publicValues, nullifier)
  │
  ├─ ZK-verified on-chain → ProofVerified event → FULFILLED
  └─ Webhook callback + Monitoring update + ROI calc refresh
```

See [Section 3](#3-zk-verification) for how ZK proofs tie into this flow and [Section 9.3](#93-theta-inference-circuit) for the Theta Inference Circuit.

### 4.2 Preset Hooks & Smart GPU Selector

To make AI inference accessible in under 10 seconds, XFuel ships **15 one-click preset hooks** — pre-configured intent templates covering LLM inference, image generation, speech-to-text, voice cloning, RAG, video processing, and object detection. Each preset bundles a default model, GPU tier, and prompt, registered on-chain via `registerPreset()`. Presets range from `QUICK_LLAMA` (fast chat on RTX 4090) to `GPU_TRAINING_JOB` (full training runs on H100 SXM) — select a preset, confirm wallet, and get verifiable results in seconds.

The **Smart GPU Selector** provides three EdgeCloud GPU tiers with transparent, governance-adjustable pricing:

| GPU Tier | VRAM | Price Multiplier | Target Workloads |
|----------|------|-----------------|------------------|
| RTX 4090 | 24 GB | 1x (base) | Fast chat, prototyping, detection |
| A100 80GB | 80 GB | 2.5x | Enterprise RAG, medical transcription, voice |
| H100 SXM | 80 GB | 5x | Complex reasoning, training, production image gen |

Effective price is computed on-chain: `effectivePrice = basePrice × gpuMultiplier / 10000`.

### 4.3 Agent & M2M API

The agent-first design enables direct machine-to-machine interaction — no UI or polling required:

- **`POST /theta-ai/agent-intent`** — Submit inference intents with preset selection and GPU tier
- **`GET /theta-ai/presets`** — List all 15 preset hooks with live GPU pricing
- **`GET /theta-ai/gpu-tiers`** — Query available GPU tiers and current multipliers
- **`GET /theta-ai/catalog`** — Full service catalog with models, capabilities, and pricing
- **`GET /theta-ai/stats`** — Real-time protocol stats (intents, latency, uptime, RPC health)
- **`GET /theta-ai/webhook-status/:taskId`** — Check webhook delivery status for a given task
- **Webhook callbacks** — Optional `callbackUrl` delivers results the moment inference completes (3-attempt exponential backoff). Agents receive the full output, ZK proof data, and settlement transaction hash.
- **OpenAPI 3.0 spec** at `/theta-ai/openapi.json` for MCP-compatible and standard HTTP integrations

### 4.4 Cross-Network Routing

When Theta EdgeCloud is not optimal for a workload, the `ProofRouter` automatically routes across DePIN networks with Theta as the primary backbone:

- **Cost comparison** — TAOCircuit compares Bittensor subnet pricing against Theta EdgeCloud; if Theta is cheaper, `TaskRoutedToTheta` fires automatically
- **GPU-aware selection** — `selectDePINProvider()` picks the cheapest available GPU matching requirements across Akash, Render, and EdgeCloud
- **Multi-hop routing** — Up to 3 hops with gas budget constraints; outcome-driven solving tracks every intent to a terminal state (fulfilled, partial, failed, deferred, timeout, or no-path)

For the full cross-chain routing matrix and gas equivalents, see [Section 8](#8-cross-chain-integration) and [`docs/Technical-Specifications.md`](docs/Technical-Specifications.md).

### 4.5 Monitoring, ROI & Failure Prediction

XFuel provides real-time operational visibility and economic insights:

- **Monitoring dashboard** — Live contract health, gas profiles, circuit status, RPC health per chain, webhook delivery tracking, and believer round metrics via browser-based UI with **10-second auto-refresh**
- **Failure prediction** — Low/medium/high risk scoring based on RPC errors, webhook failures, and API key status — enabling operators to act before issues escalate
- **ROI calculator** — Operators estimate returns based on GPU tier, lock duration, and protocol volume. veXF multipliers and Fee-to-Stake routing are factored into projections
- **ThetaScan integration** — Post-deploy health checks and continuous contract verification via ThetaScan.io API

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

All collected fees flow through the CoreRevenueSplitter using a clean four-way split. The split is designed to maximize deflationary pressure, power a self-sustaining growth engine, reward long-term holders, and fund operations.

```
┌──────────────────────────────────────────────────────┐
│              CoreRevenueSplitter v2.4                 │
├──────────────────────────────────────────────────────┤
│  30%  →  Buyback-Burn (BBB)                          │
│          XF token deflationary pressure              │
│                                                      │
│  30%  →  Growth & Expansion Treasury (GET)           │
│          AI DePIN growth engine (see sub-breakdown)  │
│          ├─ 50% Machine & Agent Incentives           │
│          ├─ 30% LP Boost                             │
│          └─ 20% Agent-Driven Grant Proposals         │
│                                                      │
│  25%  →  veXF Stake Rewards                          │
│          Distributed to governance lockers           │
│                                                      │
│  15%  →  Ops Treasury                                │
│          Operations, development, audits             │
│          ├─ 15-25% → Fee-to-Stake pool               │
│          └─ Validator incentives                     │
└──────────────────────────────────────────────────────┘
```

### 5.3 Growth & Expansion Treasury (GET) — The AI DePIN Growth Engine

The **GET** bucket replaces the legacy Liquidity Provision allocation with a purpose-built growth engine for the AI DePIN era. Thirty percent of all distributed fees flow here and are sub-allocated as follows:

| GET Sub-Bucket | Share | Purpose |
|----------------|-------|---------|
| **Machine & Agent Incentives** | 50% | Compute subsidies, inference routing rewards, and volume-triggered AI boosts that scale automatically as network utilization grows |
| **LP Boost** | 30% | Deepens AMM pools with concentrated liquidity strategies, ensuring tight spreads and low slippage for XF trading pairs |
| **Agent-Driven Grant Proposals** | 20% | Community-governed micro-grants proposed and voted on by autonomous agents and veXF holders. Unused funds auto-burn after 6 months to prevent treasury bloat |

> See [`docs/Growth-Expansion-Treasury.md`](docs/Growth-Expansion-Treasury.md) for full mechanics, governance, safeguards, and innovative features like volume-triggered boosts and agent-driven grants.

### 5.4 Future Staker Incentives

Additional staker incentive programs (e.g., periodic reward distributions, community prizes) are reserved for future governance-approved expansions. Treasury reserves may be allocated via veXF governance vote.

### 5.5 Fee-to-Stake Mechanism (Phase 3)

A configurable portion (15-25%) of the Ops Treasury allocation is routed to **chain-specific validator staking pools** via the multi-chain stake routing registry:

| Chain | Chain ID | Stake Pool | Weight | Mechanism |
|-------|----------|-----------|--------|-----------|
| Theta Mainnet | 361 | wTHETA/TFUEL Validator | 50% | Direct EVM transfer to staking contract |
| Bittensor EVM | 964 | dTAO Subnet Staking | 30% | StakingV2 precompile relay (0x0805) |
| Osmosis | osmosis-1 | OSMO Native Staking | 20% | IBC relay → BankMsg::Delegate |

This creates a virtuous cycle: protocol fees → multi-chain validator incentives → stronger network security → more protocol activity.

### 5.6 Governance Integration (Phase 3)

The `setSplit()` function is callable by veXFGovernance via FeeStructure proposals. When a FeeStructure proposal passes quorum and is executed, the governance contract calls `CoreRevenueSplitter.setSplit()` directly via the execution hook, updating the fee distribution ratios on-chain without admin intervention.

### 5.7 Implementation

| Platform | Contract | Key Functions |
|----------|----------|--------------|
| EVM | `CoreRevenueSplitter.sol` | `receive()`, `depositFee()`, `distribute()`, `setSplit()`, `setFeeToStake()`, `addStakeRoute()` |
| Cosmos | `xfuel-revenue-splitter` | `ExecuteMsg::Distribute`, `ExecuteMsg::DepositFee`, `ExecuteMsg::UpdateSplit` |

---

## 6. Governance (veXF)

### 6.1 Vote-Escrowed Model (Phase 3 — Active)

XFuel governance follows the **Curve-style vote-escrowed (ve) model** with a 3x maximum multiplier:

- Users **lock XF tokens** for a duration between 26 weeks (minimum) and 3 years (maximum)
- Voting power formula: `VP = amount × MAX_MULTIPLIER × timeRemaining / MAX_LOCK`
- Power **decays linearly** as the lock approaches expiry, incentivizing longer commitments
- Maximum multiplier: **3x** (at full 3-year lock)
- Locks are **non-transferable** (veXF is soul-bound to the locking address)

### 6.2 Governance Scope

veXF holders vote on protocol parameters with **per-type quorum requirements**:

| Proposal Type | Description | Quorum | Execution Hook |
|--------------|-------------|--------|----------------|
| **CircuitPriority** | Which circuits receive priority routing/resources | 10% | Event-only (off-chain) |
| **LPAllocation** | How LP funds are allocated across pools | 15% | Event-only (off-chain) |
| **FeeStructure** | Adjust fee BPS ranges and split ratios | 20% | `CoreRevenueSplitter.setSplit()` |
| **TreasurySpend** | Approve treasury expenditures (>$50K) | 25% | Event-only (off-chain) |
| **EmergencyPause** | Activate circuit breakers | 5% (67% supermajority) | `CoreRevenueSplitter.pause()` |

**Proposal lifecycle:**
1. **Create** — Any veXF holder with voting power > 0 can create a proposal with execution data
2. **Vote** — 3-day voting period; votes weighted by current voting power with ZK nullifiers
3. **Execute** — After voting period, EXECUTOR_ROLE triggers execution if quorum met and majority achieved

### 6.3 Multiplier Schedule

| Lock Duration | Multiplier | Voting Power (100 XF locked) |
|--------------|------------|------------------------------|
| 26 weeks | ~0.50x | 50 veXF |
| 1 year | ~1.00x | 100 veXF |
| 2 years | ~2.00x | 200 veXF |
| 3 years | 3.00x | 300 veXF |

### 6.4 ZK Vote Nullifiers

Each vote generates a **ZK nullifier** to prevent double-counting:
```
nullifier = keccak256(proposalId, voterAddress, votingPower)
```

### 6.5 Execution Hooks (Phase 3)

When a FeeStructure or EmergencyPause proposal passes, the governance contract directly calls the target contract:

- **FeeStructure** → `CoreRevenueSplitter.setSplit(bbb, lp, staker, treasury)` with ABI-decoded execution data
- **EmergencyPause** → `CoreRevenueSplitter.pause()` and optionally `ZKVerifierSP1.pause()`
- **Other types** → Emit `ProposalExecuted` event for off-chain execution

---

## 7. SP1 Proof Hooks

The `SP1ProofHooks` library (`SP1ProofHooks.sol` / `xfuel-sp1-hooks` crate) provides cross-platform utilities shared by all verifier backends and circuit contracts.

### 7.1 API Reference

| Function | Solidity | Rust | Purpose |
|----------|----------|------|---------|
| `computeNullifier(proofHash, chainId, nonce)` | `SP1ProofHooks.computeNullifier()` | `xfuel_sp1_hooks::compute_nullifier()` | Replay-safe nullifier generation |
| `computeFeeCommitment(collector, feeBps, amount)` | `SP1ProofHooks.computeFeeCommitment()` | `xfuel_sp1_hooks::compute_fee_commitment()` | Fee binding for settlement proofs |
| `encodeAITaskPublicValues(...)` | `SP1ProofHooks.encodeAITaskPublicValues()` | (native in SP1 program) | Public input encoding for AI tasks |
| `computeComposedCallNullifier()` | `SP1ProofHooks.computeComposedCallNullifier()` | — | State-root-bound nullifiers for SP1-CC |
| `encodeCrossChainPayload()` | `SP1ProofHooks.encodeCrossChainPayload()` | — | Hyperlane proof relay message formatting |

### 7.2 Proof Lifecycle

```
1. Request  → CoreListener receives intent, creates ProofRequest
2. Generate → SP1 prover compiles Rust circuit to RISC-V, generates STARK proof
3. Wrap     → STARK wrapped as Groth16 (~260 bytes) for on-chain verification
4. Submit   → Proof submitted to verifier (EVM / CosmWasm / Solana)
5. Verify   → Verifier checks proof, stores nullifier, emits ProofVerified
6. Settle   → Circuit receives event, completes settlement via RevenueSplitter
```

Nullifier computation, replay protection, and cross-chain nullifier tracking are detailed in [Section 3](#3-zk-verification).

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

**Theta Metachain (primary)** — Theta (chain 361) is XFuel's primary deployment chain, with live EdgeCloud inference, GPU tiers, and SP1 CUDA proving on A100/H200 hardware. This Theta-hybrid focus leverages EdgeCloud's real-world GPU network for competitive yields, while ecosystem-agnostic circuits extend to Bittensor, Akash, Solana, and beyond. Interconnected "chain of chains" architecture with EVM compatibility, subchain isolation, and TFUEL gas. All 23 testnet contracts are deployed on Theta Testnet (chain 365).

**Bittensor EVM** — Chain ID 964, TAO as native currency, EVM precompiles for staking and subnet management, Hyperlane bridge for cross-chain messaging.

**CosmWasm / Cosmos** — Rust-compiled WASM smart contracts with IBC for cross-chain communication and `cw-plus` standard library.

**Solana (SVM)** — Native sBPF program with SP1 Groth16 verification using `alt_bn128` syscalls, PDA-based circuit registry, and Wormhole bridge events.

### 8.3 Cross-Chain Proof Flow (Solana ↔ EVM ↔ Cosmos)

```
Solana SVM                           Theta EVM                          Cosmos/IBC
┌─────────────────────┐    Wormhole   ┌──────────────────────┐   Hyperlane  ┌──────────────────┐
│ xfuel-solana-prover │───── VAA ────→│ ZKVerifierSP1.sol    │───dispatch──→│ xfuel-zk-verifier│
│                     │               │                      │              │  (CosmWasm)      │
│ • SP1 Groth16 proof │               │ • handle() receives  │              │ • IBC relay      │
│ • Nullifier PDA     │               │   proof result        │              │ • Nullifier check│
│ • sol_log_data emit │               │ • ProofRelayed event  │              │ • Event emit     │
└─────────────────────┘               └──────────────────────┘              └──────────────────┘
```

### 8.4 Unified Routing Matrix

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

## 9. Use Cases

The Core Layer is designed to support any AI/DePIN use case through its circuit architecture. XFuel currently operates **16+ production circuits**:

### 9.1 Compute Marketplace Circuit
Routes GPU/compute bids to the cheapest provider across networks. Verifies task completion via SP1 proofs and settles payments through the CoreRevenueSplitter.

### 9.2 AI Inference Router Circuit
Accepts ML inference requests, routes them to the optimal provider (based on latency, cost, model availability), and attests results on-chain.

### 9.3 Theta Inference Circuit
Purpose-built for **Theta EdgeCloud** — provides structured intent submission across seven service categories (LLM, image gen, STT, voice cloning, RAG, video, object detection). Includes preset hooks, smart GPU selector, and agent webhook API. See [Section 4](#4-task-routing--inference-pipeline) for the full inference pipeline.

### 9.4 Data Attestation Circuit
Certifies dataset provenance, quality scores, and lineage on-chain with ZK proofs. Useful for AI training data marketplaces.

### 9.5 Yield Aggregation Circuit
Routes liquidity to highest-yielding pools across DeFi protocols, with ZK-verified rebalancing and settlement.

### 9.6 Agent Communication Circuit
Enables ZK-verified agent-to-agent (A2A) messaging across heterogeneous networks with escrowed payments and TTL-based expiry. Agents interact via the structured API (`POST /theta-ai/agent-intent`) with optional webhook callbacks for real-time result delivery — no polling required. See [Section 4](#4-task-routing--inference-pipeline) for the full agent pipeline.

### 9.7 Autonomous Agent Swarm Economy
Multi-agent swarms coordinate via the A2ACircuit with Almanak-style lifecycle management — swarm formation, ZK micro-settlements at <50K gas, x402 claim integration, and coordinator-managed dissolution.

### 9.8 Privacy-Preserving Data Markets
zkML selective disclosure (Poseidon commitments for field-level privacy) and DataHubs provenance attestation (ZK proofs of source identity and processing chain) enable privacy-preserving AI data markets.

### 9.9 DePIN Infrastructure Circuits
XFuel extends into physical infrastructure with circuits for decentralized energy (EnergyGrid), geospatial mapping (MappingSensor), wireless coverage (WirelessDePIN), and WiFi bandwidth sharing (UplinkCircuit) — forming a complete DePIN connectivity stack with cross-circuit synergy incentives.

### 9.10 Custom / Private Circuits
Any project can build a custom circuit by implementing the circuit interface (event listeners + proof submission). The Core Layer provides ZK settlement, fee collection, and governance — the circuit provides domain-specific logic.

> For full circuit implementations, gas profiles, isolation matrices, and expansion history, see [`docs/Circuit-Design-and-Expansion.md`](docs/Circuit-Design-and-Expansion.md).

---

## 10. Tokenomics

### XF Token Utility

| Utility | Split | Mechanism |
|---------|-------|-----------|
| **Deflationary (BBB)** | 30% | Buyback-and-burn creates relentless sell-side absorption |
| **Growth & Expansion Treasury (GET)** | 30% | AI DePIN growth engine — Machine & Agent Incentives (50%), LP Boost (30%), Agent-Driven Grant Proposals (20%) |
| **veXF Stake Rewards** | 25% | Real yield distributed to governance lockers every epoch |
| **Ops Treasury** | 15% | Operations, audits, grants, Fee-to-Stake validator incentives |

### Fee Flow

All protocol fees (0.1–1% per transaction) flow through the CoreRevenueSplitter at the **30/30/25/15** split. The GET allocation (30%) is sub-divided into Machine & Agent Incentives, LP Boost, and Agent-Driven Grant Proposals — see [`docs/Growth-Expansion-Treasury.md`](docs/Growth-Expansion-Treasury.md) for the full breakdown. A portion (15–25%) of the Ops Treasury allocation is further routed to multi-chain validator staking pools via the Fee-to-Stake mechanism. See [Section 5](#5-revenue--fee-distribution) for the full breakdown.

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

### 11.4 Privacy Enhancements (Phase 5)

- **Poseidon commitments** — Field-level privacy for selective disclosure
- **Source identity privacy** — DataHubs provenance attests lineage without revealing contributor identity
- **Nullifier isolation** — Circuit-local nullifier tracking prevents cross-operation replay
- **Failover nullifier sync** — Cross-chain nullifier replication ensures replay protection survives chain failover events

### 11.5 Audit Plan

| Phase | Scope | Timeline |
|-------|-------|----------|
| Phase 1 | Core Layer contracts (ZKVerifier, RevenueSplitter, veXF) | Q2 2026 |
| Phase 2 | SP1 circuits + proof hooks | Q3 2026 |
| Phase 3 | CosmWasm contracts + IBC integration | Q4 2026 |
| Bug Bounty | $500K via Immunefi | Ongoing post-Phase 1 |

---

## 12. Roadmap

All six development phases are code-complete. The protocol is now in audit preparation and grant submission stage.

### Phase 1: Core Layer Skeleton ✅ (Completed Jan 2026)
- [x] ZKVerifierSP1 (EVM + WASM), CoreRevenueSplitter, veXFGovernance
- [x] SP1 Proof Hooks (Solidity + Rust), CoreListener (ai-listener.js)
- [x] 520+ total tests across all suites

### Phase 2: Circuit PoCs ✅ (Completed Jan 2026)
- [x] Compute Marketplace, Inference Router, Bridge circuits
- [x] 69/69 priority circuit tests, multi-prover integration (85 tests)
- [x] 6 PoC circuits with prover assignments validated

### Phase 3: Governance & Revenue ✅ (Completed Feb 2026)
- [x] veXF governance implementation (Curve-style lock + vote, 3x max multiplier)
- [x] Fee-to-Stake routing (Theta 50%, Bittensor 30%, Osmosis 20%)
- [x] CertiK Phase 1 scope prepared, $500K Immunefi bug bounty defined
- [x] 550+ total tests

### Phase 4: Scale & Rollup ✅ (Completed Feb 2026)
- [x] Theta subchains per circuit (6 subchains, <2s finality)
- [x] ZK rollup layer (SP1 Hypercube recursion, <100K gas/proof for batch ≥10)
- [x] Cross-DePIN compute routing (Akash + Render), intent-based architecture
- [x] x402 v3 micropayment integration, $100M+ TVL simulation tests
- [x] 620+ total tests

### Phase 5: Multi-Network AI ✅ (Completed Feb 2026)
- [x] Autonomous agent economy (Almanak-style swarms, ZK micro-settlements)
- [x] Privacy-preserving data markets (zkML selective disclosure, DataHubs provenance)
- [x] 5-VM coverage: EVM, CosmWasm, Solana SVM, Aptos Move, Sui Move
- [x] 700+ total tests

### Phase 6: Ecosystem Expansion ✅ (Completed Mar 2026)
- [x] 19+ circuits deployed across 5 networks
- [x] Partner integrations (Almanak, Succinct, Chainlink)
- [x] Grant execution pipeline, marketing automation
- [x] xfuel.app website launched (Vite + React + Wagmi)
- [x] Theta Testnet full deployment — 22 contracts (Core Layer + 16 circuits + BelieverRound + mocks) with resumable deploy script
- [x] 755+ total tests

### Next: Audit & Mainnet (Q2–Q3 2026)
- [ ] CertiK Phase 1 audit — Core Layer + ThetaInferenceCircuit (5 contracts, ~2,068 lines)
- [ ] Mainnet deployment — Theta 361, Bittensor 964, Osmosis osmosis-1
- [ ] CertiK Phase 2 audit — InferenceRouter, TAOCircuit, BridgeCircuit
- [ ] Immunefi bug bounty launch — $500K max payout
- [ ] CertiK Phase 3 audit — ComputeMarketplace, ZKML, DataHubs, A2A

> For detailed phase milestones and circuit expansion history (Steps 2–16), see [`docs/Circuit-Design-and-Expansion.md`](docs/Circuit-Design-and-Expansion.md).

---

## 13. Technical Specifications

Full multi-prover gas benchmarks, verifier architectures, SP1 proving performance, WASM/Solana program sizes, security comparison matrices, CoreListener test coverage, and file structure are documented in [`docs/Technical-Specifications.md`](docs/Technical-Specifications.md).

---

## 14. Circuit Implementations & Expansion History

XFuel's modularity is validated by **16+ production circuits** spanning AI inference, compute marketplaces, agent communication, DeFi vaults, robotics verification, data ownership, energy grids, wireless coverage, and geospatial mapping. Each circuit is fully isolated with its own state, events, pause mechanism, and off-chain handler.

Full circuit architectures, gas profiles, isolation matrices, test coverage tables, deployment infrastructure, grant templates, and community tools are documented in [`docs/Circuit-Design-and-Expansion.md`](docs/Circuit-Design-and-Expansion.md).

---

*XFuel Protocol — Pumping intelligence across AI ecosystems.*

*For the latest updates, visit [xfuel.app](https://xfuel.app) or [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol).*
