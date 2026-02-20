# XFuel Protocol — Whitepaper v2.0

**AI Pumping Station: A Modular, ZK-Secured DePIN Hub for Cross-Ecosystem Intelligence**

*Version 2.0 — Consolidated Architecture*
*February 2026*

---

## Abstract

XFuel Protocol is a **modular, zero-knowledge-secured DePIN hub** that pumps intelligence, compute, liquidity, and value across AI ecosystems. Rather than coupling to any single blockchain or AI marketplace, XFuel implements an **ecosystem-agnostic Core Layer** — a central hub responsible for ZK proof verification, task routing, fee distribution, governance, and treasury operations — into which independent **circuits** plug to serve specific use cases.

Initial priority circuits bridge Theta to **Bittensor EVM for TAO inference routing**, **Osmosis for concentrated-liquidity yields**, and **Akash for GPU compute leasing via IBC** — establishing the first cross-ecosystem AI compute-to-yield pipeline secured by SP1 zero-knowledge proofs.

This whitepaper describes the Core Layer architecture, the five consolidated circuit categories, tokenomics, security model, and the cross-circuit synergy framework that enables end-to-end AI workflows across heterogeneous blockchain environments (EVM chains, Cosmos/IBC networks, and Solana).

**Design Principles:**

| Principle | Implementation |
|-----------|---------------|
| **Modularity** | Circuits plug into Core via events/exports; zero shared state between modules |
| **Chain-agnostic** | Hybrid verifier (Solidity for EVM, WASM for Cosmos); standardized proof format |
| **Low-gas settlement** | Target <100K gas per proof verification on EVM chains |
| **Trustless** | SP1 zkVM proofs replace trusted intermediaries |
| **Subchain-ready** | Each circuit can run on its own Theta subchain or Cosmos appchain |
| **Progressive decentralization** | Admin roles → veXF governance → fully on-chain DAO |

---

## Table of Contents

1. [Core Layer Architecture](#1-core-layer-architecture)
2. [Tokenomics & Governance](#2-tokenomics--governance)
3. [Consolidated Circuits](#3-consolidated-circuits)
4. [Use Cases & Cross-Circuit Synergies](#4-use-cases--cross-circuit-synergies)
5. [Security, Roadmap & Specifications](#5-security-roadmap--specifications)
6. [Appendices](#appendices)

---

## 1. Core Layer Architecture

The Core Layer is the minimal, trust-anchored hub. It verifies proofs, routes intents, splits fees, and governs parameters. All domain-specific logic lives in circuits.

### 1.1 Component Overview

```
                        ┌──────────────────────────────────────┐
                        │          CORE LAYER (Hub)            │
                        ├──────────────────────────────────────┤
                        │  ZKVerifierSP1 (EVM/WASM)            │ ← Proof verification
                        │  CoreRevenueSplitter                 │ ← Fee distribution
                        │  veXFGovernance                      │ ← Parameter voting
                        │  SP1ProofHooks                       │ ← Proof utilities
                        │  CoreListener (ai-listener)          │ ← Event polling/routing
                        └──────────────┬───────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │              │             │             │              │
   ┌──────▼──────┐ ┌────▼─────┐ ┌────▼─────┐ ┌────▼─────┐ ┌──────▼──────┐
   │ Compute     │ │  Agent   │ │  Yield   │ │  DePIN   │ │ Expansion   │
   │ Router      │ │  Data    │ │  Aggr.   │ │  Stack   │ │ (Frontier)  │
   └─────────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────────┘
```

| Component | Role | EVM Contract | WASM Contract |
|-----------|------|-------------|---------------|
| **ZKVerifierSP1** | Verify SP1 Groth16/PLONK proofs, track nullifiers, manage circuit registry | `ZKVerifierSP1.sol` | `xfuel-zk-verifier` |
| **CoreRevenueSplitter** | Collect and distribute fees (30/30/25/15 split) | `CoreRevenueSplitter.sol` | `xfuel-revenue-splitter` |
| **veXFGovernance** | Vote-escrowed governance for parameter updates | `veXFGovernance.sol` | (planned) |
| **SP1ProofHooks** | Nullifier computation, fee commitments, public value encoding | `SP1ProofHooks.sol` (library) | `xfuel-sp1-hooks` (crate) |
| **CoreListener** | Off-chain multi-RPC event poller, intent solver, proof coordinator | `ai-listener.js` | — |

### 1.2 Event-Driven Circuit Interface

Circuits interact with the Core Layer exclusively through events — ensuring zero shared state, independent upgradability, and subchain isolation:

```
Core emits:
  → TaskRouted(circuitId, taskHash, sender, chain, amount)
  → ProofVerified(circuitId, nullifier, publicValues)
  → FeeDistributed(totalAmount, bbbShare, lpShare, stakerShare, treasuryShare)

Circuits emit:
  → IntentSubmitted(circuitId, intentType, data)
  → TaskCompleted(circuitId, taskHash, outputHash, proof)
  → SettlementRequested(circuitId, amount, recipient, chain)
```

### 1.3 ZK Verification (Hybrid)

All proofs are generated using **SP1 zkVM** (Succinct), a RISC-V-based zero-knowledge virtual machine producing:

- **STARK proofs** (initial, ~1-5MB) → **Groth16 wrapper** (~260 bytes, ~270K gas on EVM) or **PLONK** (~868 bytes, ~300K gas)
- RISC-V precompiles for SHA-256, Keccak-256, secp256k1, ed25519, BN254
- Recursion and aggregation for batching; Succinct Prover Network for outsourced generation
- Typical proving time: 5-15s for standard circuits

**EVM Verifier** (`ZKVerifierSP1.sol`) wraps the SP1 Verifier Gateway with circuit registry, nullifier tracking, and a configurable circuit breaker (auto-pause at failure threshold). Mock mode (`gateway == address(0)`) enables testing without live ZK infrastructure.

**WASM Verifier** (`xfuel-zk-verifier`) mirrors EVM functionality for Cosmos/IBC chains. Currently implements mock verification with a `verify_sp1_proof_wasm()` skeleton pending native BN254 CosmWasm precompiles.

**Supported Chains:**

| Chain | Type | Chain ID | Token | Notes |
|-------|------|----------|-------|-------|
| Theta Mainnet | EVM | 361 | TFUEL | Primary deployment, 4000 Gwei min gas |
| Theta Testnet | EVM | 365 | TFUEL | Testing |
| Bittensor EVM | EVM | 964 | TAO | dTAO staking, Hyperlane bridging |
| Osmosis | Cosmos | osmosis-1 | OSMO | Primary DeFi hub, AI yield pools |
| Akash | Cosmos | akashnet-2 | AKT | GPU compute marketplace |

### 1.4 Task Routing & Intent Solving

The CoreListener polls multiple RPCs (EVM via ethers.js, Cosmos via @cosmjs/stargate) and classifies on-chain events into intent types: `COMPUTE_BID`, `COMPUTE_RESULT`, `INFERENCE_REQUEST`, `CAPABILITY_QUERY`, `DATA_ATTESTATION`, `SETTLEMENT`. Each registered circuit receives intents matching its filter criteria.

```
Event Detected (EVM/Cosmos)
  → IntentSolver.parse(event)
    → Filter by circuit subscriptions
      → Dispatch to matching circuits
        → Circuit processes (domain-specific logic)
          → Settlement → SP1 proof generation
            ├─ Success: ProofVerified event, nullifier stored
            └─ Regenerable: Retry with fresh nonce (latency > threshold)
```

### 1.5 SP1 Proof Hooks & Replay Protection

Cross-platform utilities ensure consistency between Solidity, CosmWasm, and SP1:

| Function | Purpose |
|----------|---------|
| `computeNullifier(proofHash, chainId, nonce)` | Per-sender, per-chain monotonic nonce; prevents cross-chain replay |
| `computeFeeCommitment(collector, feeBps, amount)` | Binding fee commitment for proof integrity |
| `encodeAITaskPublicValues(...)` | Standardized public input encoding |

Proof lifecycle: Request → Generate (SP1 STARK) → Wrap (Groth16/PLONK) → Submit (on-chain) → Verify (gateway + nullifier) → Settle (circuit completes).

### 1.6 Cross-Chain Integration Tiers

| Tier | Integration | Example |
|------|------------|---------|
| **Tier 1: Native** | Direct contract deployment (EVM + WASM) | Theta, Osmosis |
| **Tier 2: Bridge** | IBC or Hyperlane message passing | Akash, Bittensor |
| **Tier 3: Listener** | Off-chain event monitoring + proof submission | Any chain with RPC |

**Key integrations:**
- **Theta Metachain**: EVM-compatible "chain of chains"; 1,000 wTHETA + 20,000 TFUEL per subchain validator; Theta Edge Cloud for inference
- **Bittensor EVM**: Chain ID 964; precompiles for staking (0x0800), subnet management (0x0801), balances (0x0802); Hyperlane bridge; dTAO for dynamic subnet allocation
- **Cosmos/IBC**: CosmWasm contracts; IBC channel-based cross-chain communication; `cw-plus` standard library

---

## 2. Tokenomics & Governance

### 2.1 XF Token Utility

| Utility | Mechanism |
|---------|-----------|
| **Governance** | Lock XF → veXF for voting on circuit priorities, fee parameters, treasury spend |
| **Staking Rewards** | 25% of all protocol fees distributed to veXF lockers |
| **Deflationary** | 30% of all fees used for buyback-and-burn (BBB) |
| **Liquidity Mining** | 30% of fees reinvested into ecosystem pools |

### 2.2 Revenue & Fee Distribution

All protocol interactions incur a configurable fee (0.1%–1%) through the CoreRevenueSplitter:

```
Protocol Activity (AI tasks, bridges, attestations)
  → Fee Collection (0.1-1% per transaction)
    → CoreRevenueSplitter
      ├── 30% → BBB (Buyback-Burn XF)
      ├── 30% → LP (Liquidity Provision)
      ├── 25% → veXF (Staker Rewards)
      └── 15% → Treasury
           └── 15-25% → Fee-to-Stake (Validator Incentives)
```

**Fee-to-Stake** creates a virtuous cycle: protocol fees → validator incentives (Theta wTHETA/TFUEL staking, Bittensor dTAO, Cosmos native staking) → stronger network security → more protocol activity.

### 2.3 Economic Implications

| Dynamic | Effect | Edge Case |
|---------|--------|-----------|
| **BBB deflationary pressure** | 30% burn rate reduces circulating supply, supporting XF price appreciation | Low-volume periods reduce burn volume; insufficient deflationary pressure if monthly fees < $10K |
| **LP reinvestment** | 30% deepens ecosystem pools, reducing slippage for XF trades | Over-provisioned LPs in low-activity pools may earn sub-optimal yields |
| **veXF staking yield** | 25% to lockers incentivizes long-term alignment | Yield dilution if total locked supply exceeds 60% of circulating |
| **Fee-to-Stake** | Validator incentives strengthen security of underlying networks | Cross-chain fee routing adds latency; bridging costs may exceed small-amount staking rewards |

**Revenue Projections (Steady-State):**

| TVL | Monthly Volume | Monthly Fees (0.5% avg) | Annual Revenue |
|-----|---------------|------------------------|----------------|
| $5M | $2M | $10K | $120K |
| $20M | $10M | $50K | $600K |
| $100M | $50M | $250K | $3M |

Volume composition target: 60% AI tasks, 25% data/communications, 15% financial settlements.

### 2.4 Governance (veXF)

XFuel governance follows the Curve-style vote-escrowed model:

- Lock XF for **26 weeks to 3 years**; voting power = amount × remaining duration
- Power **decays linearly** to zero at expiry; maximum multiplier **3x** (max-duration locks)

| Lock Duration | Multiplier | Voting Power (100 XF) |
|--------------|------------|------|
| 26 weeks | ~0.17x | 17 veXF |
| 1 year | ~1x | 100 veXF |
| 2 years | ~2x | 200 veXF |
| 3 years | 3x | 300 veXF |

**Governance Scope:**

| Proposal Type | Description | Quorum |
|--------------|-------------|--------|
| Circuit Priority | Resource allocation across circuit categories | 10% |
| LP Allocation | Pool-level liquidity distribution | 15% |
| Fee Structure | Adjust fee BPS ranges and split ratios | 20% |
| Treasury Spend | Approve expenditures >$50K | 25% |
| Emergency Pause | Circuit breaker activation | 5% (67% supermajority) |

---

## 3. Consolidated Circuits

The Core Layer's modularity supports any AI/DePIN use case through self-contained circuits. The 16 implemented circuits are consolidated into **five thematic categories** that emphasize stack synergies while maintaining full isolation.

### 3.1 ComputeRouterCircuit — AI Compute & Inference

*Merges: TAOCircuit, ThetaGPUCircuit, ZKMLCircuit, AkashCircuit*

**Purpose:** Unified GPU/inference routing across Bittensor subnets, Theta Edge Cloud, and Akash GPU marketplace with private model inference via ZK.

**Priority integration:** User submits inference intent on Theta → routes to cheapest GPU provider (Akash via IBC or Bittensor subnet) → settles with SP1 proof → optional private inference where model weights stay confidential (zkML).

| Sub-Circuit | Function | Key Integration | Fee |
|-------------|----------|----------------|-----|
| **TAOCircuit** | Cross-chain AI task routing with AMM fee capture and Chainlink oracle pricing | Bittensor EVM (964), Hyperlane bridging | 0.5% |
| **ThetaGPUCircuit** | GPU inference routing via Theta EdgeCloud with provider staking and model registry | Theta Edge Cloud SDK, subchain-ready | 0.5% |
| **ZKMLCircuit** | Private model inference — weights stay confidential, only correctness proven on-chain | SP1 private inputs, authorized provers, weight rotation | 0.75% |
| **AkashCircuit** | Decentralized GPU leasing via reverse-auction with per-block payments and delivery attestation | Akash SDL specs, IBC for AKT/USDC | 0.5% |

**Task lifecycle (TAOCircuit example):**
```
User → TAOCircuit.submitTask()
  ├── Fee → CoreRevenueSplitter.depositFee(CIRCUIT_ID)
  ├── Event → TaskRouted (ai-listener detects)
  └── Bridge → Hyperlane.dispatch() (if cross-chain)
                 └── Remote chain processes → SP1 proof → settlement
```

**AkashCircuit deployment flow:**
```
Tenant → createDeployment(specId, sdlHash, maxPricePerBlock, duration) {escrow}
Provider → placeBid(deploymentId, pricePerBlock) {deposit}  [reverse auction]
Tenant → acceptBid(bidId) → lease created, losing deposits returned
Provider → claimLeasePayment(leaseId, blocksServed)  [periodic]
Relayer → completeLease(leaseId, proof, nullifier)  [SP1 delivery attestation]
```

**Scalability:** Handles 100+ tasks/min in load testing. **Edge cases:** Proof latency >15s triggers retry with fresh nonce; high EVM gas could deter low-value inference tasks (mitigated by batched verification at ~830K gas for 3 proofs). Oracle failures trigger admin price fallback.

### 3.2 AgentDataCircuit — Agent Communication & Data

*Merges: A2ACircuit, DataHubs, AgentRobotics, NearAgents*

**Purpose:** ZK-secured agent-to-agent communication, verified data ownership, autonomous agent marketplace, and robotic sim-to-real certification — all linked through Bittensor subnet mining incentives.

| Sub-Circuit | Function | Key Integration | Fee |
|-------------|----------|----------------|-----|
| **A2ACircuit** | Service discovery, escrow-based bidding, x402-style micropayment channels | SP1 identity commitments, TTL-based expiry | 0.1% relay + 0.5% task |
| **DataHubs** | DataDAO creation, ZK-verified provenance, quality-weighted contributor rewards | Vana-style data sovereignty, Grass provenance model | 0.5% |
| **AgentRobotics** | Sim-to-real trajectory verification, soulbound safety certificates, certified task marketplace | Digital twins at 60Hz, NRN composable verification | 1% cert + 0.5% task |
| **NearAgents** | Intent-based autonomous agent marketplace with TEE attestation and competitive bidding | NEAR chain signatures, outcome-based intents | 0.5% |

**Agent lifecycle (NearAgents example):**
```
Agent → registerAgent(capabilityHash, teeAttestation)
User  → submitIntent(outcome, constraints, budget)
Agents → placeBid(intentId, price, approachHash)  [competitive]
Solver → assignIntent(intentId, bidId)
Solver → settleIntent(intentId, proof, nullifier)
  → Agent paid, excess refunded, reputation += qualityScore
```

**Privacy:** ZK hides model weights (ZKMLCircuit) and agent strategies (NearAgents). **Edge cases:** TTL expiry prevents stale escrows but disputes could overload governance — mitigated by automated dispute resolution with SP1 re-verification proofs. Data contribution quality scoring uses 0-10000 scale to prevent low-quality flooding.

### 3.3 YieldAggregatorCircuit — Yield & Financials

*Merges: YieldCircuit, AutonomousVaults*

**Purpose:** Multi-pool yield optimization and AI-driven vault management with ZK-verified rebalancing, routing liquidity to Osmosis concentrated-liquidity pools (200-300x capital efficiency) and across DeFi protocols.

| Sub-Circuit | Function | Key Integration | Fee |
|-------------|----------|----------------|-----|
| **YieldCircuit** | Multi-protocol yield optimization with CL-aware allocation and cross-chain routing | Osmosis supercharged pools, Uniswap V3, Curve, Aave | 0.5% deposit + 1% harvest |
| **AutonomousVaults** | AI swarm-managed tokenized vaults with private strategy logic and Monte Carlo optimization | Almanak-style agent swarms, ERC-7540, HWM performance fees | 0.5% deposit + up to 20% perf |

**Yield flow:**
```
User → openPosition(poolId) {deposit}
  → 0.5% fee → CoreRevenueSplitter
  → Position tracks allocation across registered pools

Keeper → rebalancePosition(positionId, allocationHash, newNav, proof, nullifier)
  → SP1 proof: "Rebalance maximizes yield across registered pools"
  → yield_captured accrued to position

User → harvestYield() → 1% harvest fee → CoreRevenueSplitter
User → closePosition() → remaining value + pending yield returned
```

**Economics:** Boosts protocol TVL through yield-bearing positions. Osmosis CL pools offer 30-50% APYs on strategic pairs. **Edge cases:** Oracle failures (e.g., Chainlink downtime) could pause rebalancing, risking opportunity cost — mitigated by admin price fallbacks and keeper retry logic. Monte Carlo backtesting (10K+ scenarios) reduces tail risk but cannot eliminate it.

### 3.4 DePINStackCircuit — Physical Infrastructure

*Merges: EnergyGrid, MappingSensor, WirelessDePIN, UplinkCircuit, FilecoinStorage*

**Purpose:** Complete decentralized physical infrastructure stack — energy, mapping, wireless coverage, WiFi bandwidth, and storage — with cross-circuit synergy incentives rewarding multi-layer operators.

| Sub-Circuit | Function | Key Integration | Fee |
|-------------|----------|----------------|-----|
| **EnergyGrid** | ZK-verified energy attestation, P2P trading, tokenized carbon credits (1 credit = 1 MWh) | Daylight solar DePIN, Glow PoPhysicalWork, dClimate oracles | 0.5% |
| **MappingSensor** | Geospatial data attestation with quality EMA, coverage tracking, data marketplace | Hivemapper dashcams, DIMO vehicle data, WeatherXM | 0.5% |
| **WirelessDePIN** | LoRaWAN/5G coverage proofs, data credit settlement, H3 hex coverage mapping | Helium Proof-of-Coverage, XNET 5G, CBRS spectrum | 0.5% |
| **UplinkCircuit** | WiFi bandwidth sharing, session lifecycle, throughput quality EMA | Uplink 5M+ routers, Althea mesh, Wicrypt hotspots | 0.5% |
| **FilecoinStorage** | ZK-verified storage deals with WindowPoSt/SnapDeal attestation, provider reputation | Filecoin 3,800+ providers/20 EiB, Lighthouse, Storacha | 0.5% |

**DePIN Synergy Model:**

XFuel introduces protocol-level incentives rewarding operators contributing to multiple DePIN layers in the same geographic region:

| Tier | Active Layers | Reward Multiplier | Rationale |
|------|--------------|-------------------|-----------|
| FULL | 3/3 (coverage + mapping + connectivity) | 1.0x (base) | Complete DePIN stack |
| PARTIAL | 2/3 | 1.5x | Incentivize missing layer |
| FRONTIER | 1/3 | 3.0x | Pioneer bonus for underserved areas |
| DEAD | 0/3 | 5.0x | First-mover advantage for new regions |

Cross-circuit bonuses: MappingSensor data from wireless-covered regions gets +10% quality boost; UplinkCircuit sessions in mapped regions get +5% quality EMA boost; WirelessDePIN proofs with router density get +15% reward boost.

**Adoption:** Rewards multi-layer operators with compounding incentives. **Edge cases:** Regional dead zones (0/3 tiers) get 5x bonuses, but low device density could delay network effects until critical mass (~50 devices/region). Synergy scoring initially runs off-chain, transitioning to an on-chain SynergyOracle in Phase 3.

### 3.5 Expansion / Frontier Circuits

*Retained as pluggable stubs: SolanaAIBridge*

**SolanaAIBridge** connects Solana AI compute infrastructure (Render Network 5,600 RTX 5090 nodes, io.net 1M+ GPUs, Grass 8.5M MAU, SendAI agents) to any EVM chain via Wormhole Guardian-attested VAAs with SP1 settlement proofs. Deferred to detailed specification upon implementation maturity.

Any project can build additional circuits by implementing the circuit interface (event listeners + proof submission). The Core Layer provides ZK settlement, fee collection, and governance — the circuit provides domain-specific logic. Community-built circuits must be whitelisted via veXF governance to prevent ungoverned security risks.

### 3.6 Unified Circuit Isolation Matrix

All circuits maintain full isolation with independent state, pause mechanisms, and access control:

| Circuit Category | Circuit ID(s) | State | Fee Route | ZK Verification | Default Chains |
|-----------------|---------------|-------|-----------|----------------|----------------|
| **ComputeRouter** | `TAO_EVM_CIRCUIT`, `THETA_GPU_CIRCUIT`, `ZKML_CIRCUIT`, `AKASH_DEPIN_CIRCUIT` | Own tasks/models/deployments/bids per sub-circuit | → CoreRevenueSplitter | → ZKVerifierSP1 (+ weight commitment for zkML) | Bittensor, Theta, All EVM |
| **AgentData** | `A2A_CIRCUIT`, `DATA_HUBS_CIRCUIT`, `AGENT_ROBOTICS_CIRCUIT`, `NEAR_AGENTS_CIRCUIT` | Own agents/bids/channels/hubs/certs per sub-circuit | → CoreRevenueSplitter | → ZKVerifierSP1 (+ identity commitments, trajectory proofs) | All chains |
| **YieldAggregator** | `YIELD_CIRCUIT`, `AUTONOMOUS_VAULTS_CIRCUIT` | Own positions/pools/vaults/strategies | → CoreRevenueSplitter | → ZKVerifierSP1 (rebalance + optimality proofs) | All EVM |
| **DePINStack** | `ENERGY_GRID`, `MAPPING_SENSOR`, `WIRELESS_DEPIN`, `UPLINK_CIRCUIT`, `FILECOIN_STORAGE` | Own nodes/devices/hotspots/routers/deals per sub-circuit | → CoreRevenueSplitter | → ZKVerifierSP1 (energy/coverage/bandwidth/storage proofs) | All chains |
| **Expansion** | `SOLANA_AI_BRIDGE` | Own providers/tasks | → CoreRevenueSplitter | → ZKVerifierSP1 (cross-chain computation) | EVM ↔ Solana |

**Isolation guarantees:**
- Zero shared state between any circuits (verified in integration tests)
- Same nullifier valid across different circuits (independent nullifier spaces)
- Pausing one circuit does not affect any others
- Roles on one circuit do not grant access to others

### 3.7 Test Coverage (Aggregate)

| Category | Tests |
|----------|-------|
| ComputeRouter sub-circuits (TAO, GPU, zkML, Akash) | 60 |
| AgentData sub-circuits (A2A, DataHubs, Robotics, NEAR) | 60 |
| YieldAggregator sub-circuits (Yield, Vaults) | 30 |
| DePINStack sub-circuits (Energy, Mapping, Wireless, Uplink, Filecoin) | 75 |
| Expansion (SolanaAIBridge) | 14 |
| Multi-circuit integration (E2E) | 20 |
| Load/chaos hardening | 20 |
| Gas profiling | 10 |
| Deployment validation | 10 |
| BelieverRound | 16 |
| **Total** | **315+** |

Key validations: circuit state isolation, nullifier independence, cross-circuit fee aggregation, concurrent multi-user stress (50+ ops across 5+ circuits), pause isolation, access control isolation.

---

## 4. Use Cases & Cross-Circuit Synergies

### 4.1 End-to-End AI Workflow

The consolidated circuit architecture enables complete AI workflows spanning compute, data, and finance:

```
┌──────────────────────────────────────────────────────────────────┐
│                    AI Workflow Pipeline                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Data Acquisition (AgentDataCircuit)                         │
│     DataHubs: ZK-verified training data from Vana/Grass         │
│         │                                                        │
│  2. Model Training (ComputeRouterCircuit)                       │
│     AkashCircuit: Lease H100 GPUs via IBC reverse auction       │
│         │                                                        │
│  3. Private Inference (ComputeRouterCircuit)                    │
│     ZKMLCircuit: Model weights private, correctness proven      │
│     TAOCircuit: Route inference to Bittensor subnet             │
│         │                                                        │
│  4. Agent Orchestration (AgentDataCircuit)                      │
│     NearAgents: Intent-based execution with TEE attestation     │
│     A2ACircuit: Agent-to-agent messaging with micropayments     │
│         │                                                        │
│  5. Revenue Optimization (YieldAggregatorCircuit)               │
│     YieldCircuit: Route fees to Osmosis CL pools (30-50% APY)  │
│     AutonomousVaults: AI swarm auto-rebalances across pools     │
│                                                                  │
│  All settlements → SP1 proof → CoreRevenueSplitter              │
│  30% BBB → 30% LP → 25% veXF → 15% Treasury                   │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Priority Integration Flows

**Flow 1: Bittensor Inference → Akash GPU → Osmosis Yield**

A user submits an inference request on Theta. TAOCircuit routes it to a Bittensor subnet (Chain ID 964) via Hyperlane. If the subnet is overloaded, AkashCircuit dynamically leases an H100 GPU on Akash via IBC for overflow compute. Settlement fees are auto-routed by YieldCircuit into Osmosis concentrated-liquidity pools, compounding protocol revenue at 30-50% APY.

**Flow 2: DePIN Data → AI Training → Agent Deployment**

MappingSensor collects ZK-verified geospatial data from Hivemapper dashcams. DataHubs packages it as a training dataset with provenance proofs. AkashCircuit leases GPUs for model training. The trained model is registered on ZKMLCircuit for private inference. NearAgents deploys autonomous agents using the model, earning per-task payments.

**Flow 3: Wireless Coverage → Energy Attestation → Carbon Credits**

WirelessDePIN operators prove LoRaWAN/5G coverage via SP1. In the same region, EnergyGrid operators attest solar production, earning carbon credits. UplinkCircuit provides WiFi bandwidth for data uploads. Synergy bonuses (+10-15%) reward multi-layer operators, bootstrapping DePIN coverage in underserved areas.

### 4.3 Cross-Circuit Economic Loops

| Loop | Flow | Economic Effect |
|------|------|----------------|
| **Compute-to-Yield** | Inference fees → YieldCircuit → Osmosis pools → compounded returns | Increases protocol TVL, deepens liquidity |
| **Data-to-Compute** | DataHubs contributions → AkashCircuit training → ZKMLCircuit inference | Creates data flywheel: more data → better models → more inference → more fees |
| **DePIN-to-DePIN** | Multi-layer operators earn synergy bonuses → reinvest in more devices | Network effects: coverage begets mapping begets connectivity |
| **Agent-to-Agent** | NearAgents orchestrate → A2ACircuit relay → micropayment channels | Autonomous agent economy with self-sustaining fee generation |

---

## 5. Security, Roadmap & Specifications

### 5.1 Security Model

**Cryptographic:**
- SP1 zkVM proofs — all settlements cryptographically verified; no trust assumptions
- Transparent setup — no trusted ceremony (SP1 uses FRI-based STARKs)
- Nonce-based replay protection — per-sender, per-chain monotonic nonces
- Nullifier tracking — on-chain mapping prevents proof reuse (100+ nullifiers validated under load)

**Contract:**
- Role-based access (ADMIN, OPERATOR, CIRCUIT_MANAGER) via OpenZeppelin
- Pausability and circuit breaker (auto-pause at configurable failure threshold, default 10%)
- Reentrancy guards on all external-calling functions
- Mock mode for testing without live ZK infrastructure

**Operational:**
- Multi-RPC redundancy in CoreListener
- Event deduplication cache prevents double-processing
- Proof retry with fresh nonces for regenerable proofs
- Graceful degradation — circuits operate independently if one fails

**Audit Plan:**

| Phase | Scope | Timeline |
|-------|-------|----------|
| Phase 1 | Core Layer (ZKVerifier, RevenueSplitter, veXF) | Q2 2026 |
| Phase 2 | SP1 circuits + proof hooks | Q3 2026 |
| Phase 3 | CosmWasm contracts + IBC integration | Q4 2026 |
| Bug Bounty | $500K via Immunefi | Ongoing post-Phase 1 |

### 5.2 Roadmap

**Phase 1 — Core Layer Skeleton (Q1 2026)** ✓
- ZKVerifierSP1 (EVM + WASM), CoreRevenueSplitter, veXF stubs, SP1ProofHooks, CoreListener
- 16 circuit contracts deployed and tested (315+ tests passing)
- Testnet and mainnet deployment infrastructure with health monitoring

**Phase 2 — Priority Circuit PoCs (Q2 2026)**
- ComputeRouterCircuit: Akash GPU leasing + Bittensor subnet routing live on testnet
- YieldAggregatorCircuit: Osmosis CL pool integration
- Cross-circuit synergy scoring (off-chain Phase 1)
- CertiK audit Phase 1

**Phase 3 — Mainnet + Governance (Q3 2026)**
- Mainnet deployment (Theta + Osmosis primary)
- veXF governance activation (lock + vote); first proposals (XFP-001 through XFP-004)
- Fee-to-Stake activation (Theta validators, Bittensor dTAO)
- On-chain SynergyOracle for DePIN cross-circuit rewards

**Phase 4 — Scale (Q4 2026 — 2027)**
- Theta subchain per circuit category; ZK rollup layer (10x throughput)
- Intent-based architecture with NEAR chain signatures
- Automated reward multiplier in CoreRevenueSplitter
- $100M+ TVL target

**2028-2030 — Multi-Network AI**
- Autonomous agent economy with ZK-verified settlements
- Privacy-preserving AI data markets; generalized cross-chain protocol
- Full DePIN synergy stack with automated regional incentive balancing

### 5.3 Technical Specifications

**Gas Benchmarks (EVM, Hardhat, optimizer 200 runs, viaIR):**

| Operation | Target Gas | Measured | Category |
|-----------|-----------|----------|----------|
| SP1 Groth16 verify | ~270K | ~270K | Core |
| Nullifier check + store | ~25K | ~22K | Core |
| Revenue distribution | ~80K | ~75K | Core |
| veXF lock | ~60K | ~55K | Core |
| TAO settleTask | <100K | ~68K | ComputeRouter |
| TAO submitTask | <350K | ~303K | ComputeRouter |
| Akash completeLease | <400K | ~327K | ComputeRouter |
| Yield rebalancePosition | <300K | ~226K | YieldAggregator |
| Vault rebalance | <350K | ~292K | YieldAggregator |
| DataHubs purchaseAccess | <300K | ~297K | AgentData |
| Solana settleTask | <400K | ~327K | Expansion |
| Batch verify (3 proofs) | ~840K | ~830K | Core |

Gas ratio across 10 consecutive settlements: <1.15x (linear scaling confirmed).

**SP1 Proving Performance:**

| Circuit | Proving Time | Proof Size (Groth16) | Verification Gas |
|---------|-------------|---------------------|-----------------|
| AI Task | ~9s | 260 bytes | ~270K |
| A2A Message | ~7s | 260 bytes | ~270K |
| Fee Burn | ~5s | 260 bytes | ~270K |
| Batch (3 proofs) | ~15s | 780 bytes | ~830K |

**Deployment Costs:**

| Category | Contracts | Total Gas | Avg per Contract |
|----------|-----------|-----------|-----------------|
| Core Layer | 3 | ~5.1M | ~1.7M |
| ComputeRouter | 4 | ~10.0M | ~2.5M |
| AgentData | 4 | ~10.1M | ~2.5M |
| YieldAggregator | 2 | ~4.6M | ~2.3M |
| DePINStack | 5 | ~11.0M | ~2.2M |
| Expansion | 1 | ~2.1M | ~2.1M |
| BelieverRound | 1 | ~2.0M | ~2.0M |
| **Total** | **20** | **~44.9M** | — |

**File Structure:**

```
core-layer/
├── ai-listener.js                     # Multi-RPC event poller + intent solver
├── contracts/
│   ├── ZKVerifierSP1.sol              # EVM proof verifier
│   ├── CoreRevenueSplitter.sol        # Fee distribution (30/30/25/15)
│   ├── veXFGovernance.sol             # Vote-escrowed governance
│   └── SP1ProofHooks.sol             # Proof utility library
├── wasm/
│   ├── zk-verifier/                   # CosmWasm ZK verifier
│   └── revenue-splitter/             # CosmWasm revenue splitter
└── sp1-hooks/                         # Rust SP1 proof utilities

circuits/
├── tao-circuit/                       # Bittensor AI marketplace
├── a2a-circuit/                       # Agent communication
├── theta-gpu/                         # Theta Edge Cloud inference
├── zkml/                              # Private ML inference
├── akash-compute/                     # Decentralized GPU leasing
├── autonomous-vaults/                 # AI-driven yield vaults
├── agent-robotics/                    # Sim-to-real verification
├── data-hubs/                         # Data ownership DAOs
├── yield-optimization/                # Multi-pool yield routing
├── near-agents/                       # Intent-based agent marketplace
├── solana-bridge/                     # Solana AI infrastructure bridge
├── filecoin-storage/                  # Decentralized storage
├── energy-grid/                       # Energy DePIN + carbon credits
├── mapping-sensor/                    # Geospatial data DePIN
├── wireless-depin/                    # LoRaWAN/5G coverage
└── uplink/                            # WiFi bandwidth sharing
```

---

## Appendices

### Appendix A: Research References

| Source | Key Finding | Applied In |
|--------|------------|------------|
| **SP1 Docs** (succinct.xyz) | Groth16 ~270K gas; RISC-V precompiles; private inputs only known to prover | ZKVerifierSP1, SP1ProofHooks, ZKMLCircuit |
| **Theta Metachain** | 1,000 wTHETA + 20,000 TFUEL per validator; subchain isolation | Fee-to-Stake, CoreListener |
| **Bittensor EVM** | Chain ID 964; precompiles 0x0800-0x0802; dTAO staking | TAOCircuit, CoreListener |
| **CosmWasm** | cw-storage-plus patterns; BankMsg::Send for transfers | WASM contracts |
| **Curve veModel** | Linear decay voting power; lock multiplier | veXFGovernance |
| **Akash Network** | SDL specs, reverse auction, per-block lease, 4% AKT / 20% USDC take | AkashCircuit |
| **Osmosis CL** | 200-300x capital efficiency; geometric tick spacing; L + √P tracking | YieldCircuit |
| **Almanak** | 18 AI agents, Monte Carlo 10K+ scenarios, ERC-7540 vaults | AutonomousVaults |
| **NRN Agents** | Sim-to-real gap; digital twins at 60Hz; composable verification | AgentRobotics |
| **Vana / Grass** | Data sovereignty DAOs; 8.5M MAU; ZK provenance rollup | DataHubs |
| **NEAR AI** | TEE agents, intent marketplace, chain signatures for MPC signing | NearAgents |
| **Render / io.net** | 5,600 RTX 5090 nodes; 1M+ pooled GPUs; Solana-based | SolanaAIBridge |
| **Wormhole / CCIP** | Guardian-attested VAAs; SVM2AnyMessage for cross-chain | SolanaAIBridge |
| **Filecoin** | 3,800+ providers; 20 EiB; PoRep + PoST | FilecoinStorage |
| **Helium / XNET** | 900K+ hotspots; Proof-of-Coverage; data credits | WirelessDePIN |
| **Hivemapper / DIMO** | 4K dashcams; 100K+ vehicles; geospatial attestation | MappingSensor |
| **Daylight / Glow** | Solar DePIN; Proof-of-Physical-Work; carbon credits | EnergyGrid |
| **Uplink / Althea** | 5M+ routers; mesh networking; bandwidth micropayments | UplinkCircuit |

### Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Circuit** | Self-contained module plugging into Core Layer for specific use cases |
| **Core Layer** | Central hub for ZK verification, routing, fees, and governance |
| **Nullifier** | Unique identifier preventing proof reuse (replay protection) |
| **veXF** | Vote-escrowed XF — locked tokens conferring governance power |
| **SP1 zkVM** | Succinct's RISC-V zero-knowledge virtual machine |
| **Groth16** | SNARK proof system: ~260 byte proofs, ~270K gas verification |
| **Program VKey** | Verification key identifying a specific SP1 program |
| **DePIN** | Decentralized Physical Infrastructure Network |
| **Intent** | User-defined outcome with constraints and budget; agents compete to execute |
| **NAV / HWM** | Net Asset Value / High Water Mark for vault performance fees |
| **Digital Twin** | Virtual replica of physical entity synchronized at high frequency |
| **DataDAO** | Community-governed pool aggregating user-contributed data |
| **Concentrated Liquidity** | AMM design focusing liquidity within specific price tick ranges |
| **Wormhole VAA** | Verified Action Approval — Guardian-attested cross-chain message |
| **Coverage Proof** | ZK attestation of wireless coverage at a specific hex with RSSI/SNR |
| **Synergy Tier** | Regional classification: FULL/PARTIAL/FRONTIER/DEAD based on active DePIN layers |
| **Fee-to-Stake** | Treasury fees routed to validator staking for network security |
| **Circuit Breaker** | Auto-pause mechanism triggered when failure rate exceeds threshold |
| **BelieverRound** | Community micro-commitment funding with cliff + linear vesting |
| **TGE** | Token Generation Event — XF tokens minted/deposited for vesting |

---

*XFuel Protocol — Pumping intelligence across AI ecosystems.*

*For the latest updates, visit [xfuel.app](https://xfuel.app) or [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol).*
