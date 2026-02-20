# XFUEL Protocol

**AI DePIN Yield Router — trustless TFUEL ↔ Cosmos DeFi with Osmosis AI yield pools (30-50%+ APY), Akash AI compute, and automated multi-chain routing.**

Live: **[xfuel.app](https://xfuel.app)** (Theta Mainnet Beta)

[![Audit Status](https://img.shields.io/badge/audit-pending-yellow.svg)](docs/ZK_BRIDGE_IMPLEMENTATION.md)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/XFuel-Lab/xfuel-protocol)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-v5.0-red.svg)](WHITEPAPER_v4.4.md)
[![ZK Bridge](https://img.shields.io/badge/ZK--VM-SP1-purple.svg)](sp1-prover/README.md)
[![DePIN](https://img.shields.io/badge/DePIN-AI%20Bridge-orange.svg)](WHITEPAPER_v4.4.md#phase-e-extension-ai-depin-bridge-q3-q4-2026----v45-new-section-)

---

## 📄 Whitepaper v5.0 — Production Mainnet + AI DePIN Bridge Edition

**XFuel Protocol: SP1 zkVM Bridge for TFUEL → Osmosis/Akash/Persistence DeFi**

Read the complete technical whitepaper: **[WHITEPAPER_v4.4.md](WHITEPAPER_v4.4.md)** (contains v5.0 content)

**What's New in v5.0:**
- **Production-ready**: All contracts, backend services, and frontend components synced and documented
- **Complete whitepaper sections**: Added Sections 4 (ZK Bridge), 7 (Governance), 8 (Revenue), 9 (Technical), 11 (Economic)
- **Production milestones**: Q2-Q3 2026 mainnet (Phase D), Q4 2026 AI DePIN (Phase E), $5M TVL unlocks
- **Fee monitoring**: `fee-analytics.js` integration with Prometheus/Grafana and FeeVisualizer
- **Production Guides**: Mainnet deploy steps, integration checklists, audit warnings

**Carried from v4.5:**
- **Osmosis-primary routing**: Strategic pivot from Persistence to Osmosis ($2B+ TVL, 30-50%+ APY AI yield pools)
- **AI DePIN Bridge (Phase E)**: ZK-verifiable A2A/M2M communications for AI agent interoperability
- **Akash IBC integration**: TFUEL → AKT for decentralized GPU compute bids/leases
- **Bittensor (TAO) routing**: ML inference to optimal subnets via Substrate/EVM bridge
- **0.5-1% AI task fees**: Compute settlements feed into unchanged 30/30/25/15 revenue split
- **Utility-driven volume**: 60% AI tasks, 25% data/comms, 15% financial settlements

**Retained from v4.4:**
- Bi-directional bridge flow (deposits + withdrawals, 0.5% fee each direction)
- `burn_for_unwrap` + SP1 event proofs + `unwrapFromBurn`
- FeeCollector.wasm, nonce-based replay protection, MOCK_MODE testing

**Whitepaper Highlights:**
- SP1 zkVM zero-knowledge bridge architecture (RISC-V → STARK → Groth16 wrapper)
- Multi-chain CosmWasm deployment (Osmosis-primary, Akash AI, Persistence compatible)
- Phase E: AI DePIN Bridge with ZK-verified agent-to-agent compute settlements
- Phase B benchmarks (8.997s avg proving, 52.89 tx/min throughput)
- XFuel Tokenomics (30/30/25/15 revenue split — unchanged across all streams)
- Complete technical specifications & deployment roadmap

---

## 🚀 What is XFUEL?

XFUEL is a **cross-chain AI DePIN Yield Router** that enables trustless TFUEL ↔ Cosmos DeFi swaps with multi-chain routing to Osmosis (30-50%+ APY AI/DePIN yield pools), Akash (AI compute), and Persistence (LST staking).

By leveraging SP1 zkVM proofs for cryptographic transaction validation and CosmWasm contracts across Cosmos chains, XFUEL achieves secure cross-chain bridging (deposits, withdrawals, and AI compute settlements) while maintaining non-custodial security guarantees.

### Core Features

**Forward Bridge (Theta → Persistence):**
- 🔐 **Zero-Knowledge Deposits**: SP1 zkVM proofs validate deposits without trusting centralized relayers
- ⚡ **~11-12s Settlement**: ZK proof generation + verification + minting in ~11-12 seconds
- 📱 **Manual Send Flow**: Send TFUEL via QR code or copy/paste address — no browser extensions needed
- 💰 **Auto-Yield Optimization**: Automated routing to highest-yielding LSTs (planned Phase D)

**Reverse Bridge (Persistence → Theta):**
- 🔄 **Secure Withdrawals**: Burn ibcTFUEL with ZK proof-verified unwrap on Theta
- 🛡️ **Nonce Protection**: Per-user nonce tracking prevents replay attacks
- 💸 **0.5% Reverse Fee**: Sustainable revenue model, discourages spam attacks
- 📊 **FeeCollector Integration**: Accumulates fees for protocol revenue distribution (30/30/25/15 split)

**Universal:**
- 🔒 **Non-Custodial**: Users retain full control; smart contracts enforce security
- 🌐 **1:1 Cryptographic Peg**: ibcTFUEL ↔ TFUEL backed by locked collateral

---

## 📱 How It Works (ZK Bridge Flow)

### Forward Flow (Deposit TFUEL, Earn 30-50% APY)

1. **Select Your LST**: Choose your target Liquid Staking Token (stkTIA, stkATOM, etc.)
2. **Get Deposit Address**: Click "Show Deposit Address" to see QR code + vault address
3. **Send TFUEL**: Open your Theta Wallet, scan QR or paste address, send TFUEL to vault
4. **ZK Proof Generation**: Backend detects deposit, generates SP1 zkVM proof (~9s)
5. **Proof Verification**: Persistence ZKVerifier.wasm verifies proof (~100ms)
6. **ibcTFUEL Mint**: CW20 token minted 1:1 with locked TFUEL (awaiting governance whitelist)
7. **IBC Transfer**: ibcTFUEL routed via IBC channel-190 (post-mint Cosmos-internal, planned)
8. **Auto-Swap & Stake**: Automated swap to target LST + staking (planned Phase D)

### Reverse Flow (Withdraw TFUEL)

1. **Burn ibcTFUEL**: Call `burn_for_unwrap(amount, theta_recipient)` on Persistence
2. **Fee Deduction**: 0.5% fee sent to FeeCollector, remaining 99.5% burned
3. **Event Emission**: Contract emits burn event with SP1-readable attributes (nonce, amount, recipient)
4. **Backend Detection**: Persistence listener detects burn event (~2s)
5. **ZK Proof Generation**: SP1 Event Prover generates ZK proof of burn (~9s)
6. **Unwrap Execution**: Backend calls `unwrapFromBurn(recipient, amount, sp1Proof)` on VaultFactory
7. **TFUEL Release**: VaultFactory validates proof, releases TFUEL to recipient wallet (~12-15s total)

**Current Status:** Phase C Complete — Bi-directional ready, awaiting governance whitelist  
**Total time (when live):** ~11-12 seconds (forward), ~12-15 seconds (reverse)  
**No wallet connect, no extensions, no browser dependencies** — just send and receive.

### Technical Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    XFUEL BI-DIRECTIONAL BRIDGE v4.4                     │
└────────────────────────────────────────────────────────────────────────┘

FORWARD FLOW (Theta → Persistence):
  Theta VaultFactory → SP1 zkVM Proof → CosmWasm Verify → ibcTFUEL Mint
     (Create2 vault)       (~9s)            (~100ms)        (1:1 peg)

REVERSE FLOW (Persistence → Theta):
  ibcTFUEL Burn → FeeCollector (0.5%) → SP1 Event Proof → VaultFactory Unwrap
   (burn_for_unwrap)   (fee routing)        (~9s)            (TFUEL release)
```

---

## 🔐 ZK Bridge Architecture

XFUEL's Zero-Knowledge bridge achieves trustless cross-chain transfers using SP1 zkVM cryptographic proofs instead of trusted intermediaries.

### Core Components

#### 1. **Theta Layer** (EVM Smart Contracts)
- **VaultFactory**: `0xB0a266...` - Create2 deterministic vaults for deposits (0.5% bridge fee)
- **VaultFactory.unwrapFromBurn()**: Validates SP1 proof of Persistence burn, releases TFUEL
- **RevenueSplitterHybridV2**: Revenue distribution (30/30/25/15 split to BBB/LP/veXF/Treasury)

#### 2. **ZK Proof Layer** (Off-Chain Backend)
- **Forward Listener**: Monitors Theta deposits every 2 seconds (`backend/theta-bridge/src/listener.js`)
- **Reverse Listener**: Monitors Persistence burns for `burn_for_unwrap` events (`backend/theta-bridge/src/persistence-listener.js`)
- **SP1 zkVM Prover**: Generates RISC-V-based ZK proofs (~9s, Phase B: 8.997s avg)
- **Relayer Service**: Submits proofs to Persistence chain + triggers Theta unwraps
- **Production Stack**: Rust RISC-V program → STARK → Groth16 wrapper (transparent setup)

#### 3. **Persistence Layer** (CosmWasm Contracts)
- **ZKVerifier.wasm**: `persistence1...` - Verifies SP1 proofs in ~100ms constant time
- **ibcTFUEL.wasm**: CW20 token minted 1:1 with locked TFUEL (awaiting governance whitelist)
  - Forward: Mints on ZK proof verification
  - Reverse: `burn_for_unwrap(amount, theta_recipient)` with 0.5% fee + nonce protection
- **FeeCollector.wasm**: Accumulates 0.5% reverse bridge fees for protocol revenue
- **IBC Channel-190**: Post-mint Cosmos-internal routing (planned Phase D)

### Settlement Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              XFUEL BI-DIRECTIONAL ZK BRIDGE FLOW                │
└─────────────────────────────────────────────────────────────────┘

FORWARD FLOW:
  Step 1: DEPOSIT
    ↓ User sends TFUEL to VaultFactory vault (Create2 deterministic address)
  Step 2: SP1 zkVM PROOF GENERATION (~9s)
    ↓ Backend detects deposit → Generates SP1 proof (RISC-V → STARK → Groth16)
  Step 3: PROOF VERIFICATION (~100ms)
    ↓ Persistence ZKVerifier.wasm validates proof cryptographically
  Step 4: MINT (awaiting governance whitelist)
    ↓ ibcTFUEL minted 1:1 on Persistence
  Step 5: POST-MINT ROUTING (planned Phase D)
    ↓ IBC channel-190 → Automated swap to target LST → Auto-stake

REVERSE FLOW:
  Step 1: BURN FOR UNWRAP
    ↓ User calls burn_for_unwrap(amount, theta_recipient) on ibcTFUEL.wasm
  Step 2: FEE COLLECTION (0.5%)
    ↓ Fee sent to FeeCollector.wasm, 99.5% burned from user balance
  Step 3: EVENT EMISSION
    ↓ Contract emits burn event with SP1 attributes (nonce, amount, recipient)
  Step 4: SP1 EVENT PROOF GENERATION (~9s)
    ↓ Backend detects event → Generates ZK proof of burn
  Step 5: UNWRAP EXECUTION (~100ms verify)
    ↓ VaultFactory validates SP1 proof + nonce, releases TFUEL to recipient

Total: ~11-12 seconds (forward), ~12-15 seconds (reverse) when fully deployed
```

### Deployment Status

**Current Phase:** 🟢 **Phase C Complete - Bi-Directional Ready for Mainnet**

| Component | Status | Notes |
|-----------|--------|-------|
| Theta Contracts | ✅ Deployed | VaultFactory, RevenueSplitter live |
| SP1 zkVM Prover | ✅ Operational | ~9s proving (Phase B: 8.997s avg) |
| Backend Services | ✅ Running | SP1 batching enabled (11.6x speedup) |
| Forward Flow | ✅ Tested | Phase B: 52.89 tx/min throughput |
| Reverse Flow | ✅ Implemented | burn_for_unwrap + unwrapFromBurn ready |
| FeeCollector | ✅ Built | Accumulates 0.5% reverse fees |
| CosmWasm Contracts | ⏳ Pending | Awaiting governance approval |
| Full E2E Flow | ⏳ Phase D | Mainnet launch Q2 2026 |

**Latest Deployment Transaction:**  
[TX: 1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9](https://explorer.thetatoken.org/tx/0x1640372708F6E57D9FEB1006368B106BF7C18BDB056A471F5A98CB6878A6E1D9)

### Live Contract Addresses

#### Theta Mainnet (Chain ID: 361)
```
VaultFactory:       0xB0a26600074dADC69186632a1B8dFd7c3146Ce56  (Main deposit + unwrap contract)
RevenueSplitter:    0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6  (30/30/25/15 splits)
```

#### Persistence Mainnet (core-1)
```
ZKVerifier:         persistence1...  (Proof verification - awaiting whitelist)
ibcTFUEL:           persistence1...  (CW20 token - awaiting whitelist)
FeeCollector:       persistence1...  (0.5% reverse fee accumulator - awaiting whitelist)
IBC Channel:        channel-190      (Post-mint Cosmos-internal routing)
```

**Note:** IBC Channel-190 is for post-mint transfers within the Cosmos ecosystem. Theta blockchain does not have native IBC support; the bridge uses VaultFactory + ZK proofs + CosmWasm minter.

---

## 🗺️ Roadmap

### Phase C: Governance Prep ✅ Complete (Feb 6, 2026)

**Status:** Bi-directional bridge implementation complete, ready for governance vote

- ✅ Reverse bridge implementation (burn_for_unwrap + unwrapFromBurn)
- ✅ FeeCollector.wasm deployment
- ✅ SP1 event attribute integration
- ✅ Nonce-based replay protection
- ✅ Backend persistence-listener implementation
- ✅ Mock testing framework (MOCK_MODE for governance demo)
- ✅ Whitepaper v5.0 (Production Mainnet + AI DePIN Bridge Edition)

### Phase D: Mainnet Launch + Osmosis Primary 🎯 Q2 2026

**Prerequisites:**
- CertiK audit completion (ZKVerifier, ibcTFUEL, FeeCollector, VaultFactory)
- Bug bounty program launch ($500K via Immunefi)

**Milestones:**
- Deploy mainnet contracts (Theta + **Osmosis primary** + Persistence compatible)
- Osmosis AI yield pool seeding (ibcTFUEL/AKT, ibcTFUEL/OSMO)
- Initialize with conservative caps (1 TFUEL forward, 0.1 TFUEL reverse)
- 2-week monitoring period → gradual cap increase → full bi-directional flow

**Targets:** $5M TVL, 1,000 users

### Phase E: AI DePIN Bridge 🤖 Q3-Q4 2026

**ZK-verifiable agent-to-agent (A2A) and machine-to-machine (M2M) compute settlements:**

- Akash IBC integration (TFUEL → AKT for GPU leases, AI inference)
- Bittensor (TAO) routing for ML model inference subnets
- ZK-verified A2A message types: `COMPUTE_BID`, `COMPUTE_RESULT`, `INFERENCE_REQUEST`
- 0.5-1% AI task fees → unchanged 30/30/25/15 revenue split
- Utility-driven volume: 60% AI tasks, 25% data/comms, 15% settlements
- Unified DePIN dashboard (Theta + Akash + TAO in single UI)

**Targets:** $20M TVL, 1,000+ AI agents, 60%+ volume from AI tasks

See [Whitepaper Section 12 — Phase E](WHITEPAPER_v4.4.md#phase-e-extension-ai-depin-bridge-q3-q4-2026----v45-new-section-) for full technical specification.

### Phase F: Advanced Features 🚀 2027+

- ZK Rollup layer (10× throughput), generalized EVM → Cosmos bridge
- Cross-DePIN compute router (Theta Edge, Akash, Render, io.net)
- Intent-based architecture, account abstraction
- $100M+ TVL target

---

## 🤖 AI DePIN Bridge Overview (Phase E)

XFuel's Phase E extends the ZK bridge beyond financial transactions into **AI agent interoperability** — enabling trustless compute settlements across Theta Edge Cloud, Akash GPU marketplace, and Bittensor inference subnets.

### What It Does

| Capability | Description |
|-----------|-------------|
| **A2A Messaging** | ZK-verified agent-to-agent communication (compute bids, capability queries, result attestation) |
| **M2M Settlements** | Automated machine-to-machine payment for GPU leases, inference jobs, data transfers |
| **Cross-DePIN Routing** | Route AI workloads to cheapest provider (Theta Edge vs Akash vs Bittensor) |
| **Fee Capture** | 0.5-1% on compute settlements → existing 30/30/25/15 split (no tokenomics changes) |

### Integration Targets

- **Theta ↔ Osmosis**: Settlement layer + AI/DePIN token yields (established in Phase D)
- **Theta ↔ Akash**: IBC channel for GPU lease bids, compute delivery attestation via SP1 proofs
- **Theta ↔ TAO (Bittensor)**: ML inference routing to subnets via Substrate/EVM bridge

### SP1 Circuit Extension

Phase E extends the SP1 prover (`sp1-prover/program/src/main.rs`) with new message types:

```
COMPUTE_BID       → Agent requests GPU resources with ZK-verified escrow
COMPUTE_RESULT    → Provider attests job completion with output hash
INFERENCE_REQUEST → Route ML inference to optimal Bittensor subnet
CAPABILITY_QUERY  → Discover peer agent capabilities across chains
DATA_ATTESTATION  → Certify dataset provenance on-chain
```

### Volume Composition (Steady-State)

- **60%** AI tasks (inference routing, compute settlements)
- **25%** Data & communications (A2A negotiation, result attestation)
- **15%** Financial settlements (bridge deposits/withdrawals)

For full technical specification: **[WHITEPAPER_v4.4.md — Phase E](WHITEPAPER_v4.4.md#phase-e-extension-ai-depin-bridge-q3-q4-2026----v45-new-section-)**

---

## 📋 Governance

XFuel Protocol is designed for progressive decentralization with community-driven governance:

**Current Governance Requirements:**
- Osmosis + Persistence governance approvals for CosmWasm contracts (ZKVerifier, ibcTFUEL, FeeCollector)
- Detailed proposal template: **[docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md](docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md)**

**Future Governance (veXF):**
- Vote on LP allocation (which Osmosis/Dexter pools to deepen)
- Vote on compute routing preferences (Theta Edge vs Akash vs Bittensor)
- Vote on fee structure (0.5% bridge fee, 0.5-1% AI task fee adjustment)
- Vote on treasury expenditures (>$50K requires quorum)
- Emergency circuit breaker activation (requires 67% supermajority)

**veXF Multipliers:**
| Lock Duration | veXF Multiplier | Yield Boost | Voting Power |
|---------------|-----------------|-------------|--------------|
| 1 year        | 1x              | 1x          | 1x           |
| 2 years       | 2x              | 1.5x        | 2x           |
| 3 years       | 3x              | 2x          | 3x           |

---

## 🔐 Security & Risks

### Security Measures in Place

**Cryptographic Security:**
- ✅ SP1 zkVM cryptographic proofs (no trust assumptions)
- ✅ Transparent setup (no trusted ceremony risk)
- ✅ Nonce-based replay protection for reverse bridge
- ✅ Phase B E2E testing complete (8.997s avg proving, 52.89 tx/min)

**Contract Security:**
- ✅ Non-custodial architecture (users control keys)
- ✅ Smart contract access controls
- ✅ Circuit breakers (pause reverse bridge if >5% tx revert rate)
- ⏳ CertiK audit scheduled (Q2 2026, $150K budget)
- ⏳ $500K bug bounty program (Immunefi, launching Phase D)

**Operational Security:**
- ✅ Automated circuit breakers for emergency protection
- ✅ 1:1 cryptographic peg maintenance (ibcTFUEL ↔ TFUEL)
- ✅ Kubernetes deployment (auto-restart on failure)
- ✅ Redis persistence (event queue survives restarts)
- ✅ 50-80% lower TFUEL costs via Theta Edge Cloud

### Risk Mitigations

**Reverse Bridge Risks:**
- **Nonce desync**: Backend queries on-chain nonce before each unwrap + retry logic
- **Backend downtime**: Event replay from checkpoint (24h coverage) + PagerDuty monitoring
- **FeeCollector accumulation**: Automated trigger at 100 ibcTFUEL + manual fallback
- **Bank run scenario**: 0.5% reverse fee discourages panic withdrawals + circuit breaker at >20% TVL/24h

**Smart Contract Risks:**
- **Bugs in contracts**: CertiK audit + formal verification + $500K bug bounty
- **Phased rollout**: 1 TFUEL cap Phase C → 10 TFUEL Phase D → uncapped Phase E

**ZK Proof Risks:**
- **Invalid proof acceptance**: Phase B testing (25/25 E2E tests passed, 0 invalid proofs)
- **Circuit breaker**: Auto-pause if >1% invalid proofs detected

### Pre-Audit Status

⚠️ **IMPORTANT**: This is a **beta launch** for traction validation.

- Contracts deployed for testing purposes
- Use at your own risk in beta phase
- **Full security audit planned post-traction** (CertiK, Q2 2026)
- Community testing feedback welcomed

---

## 🏗️ Tech Stack

### Frontend (Vite + React)
- **Framework**: Vite + React 18 + TypeScript
- **Styling**: TailwindCSS (cyberpunk neon theme)
- **Blockchain**: ethers.js v6, Theta Mainnet RPC
- **QR Codes**: `qrcode` package for deposit addresses
- **State**: Zustand (oracle/price data)

### Smart Contracts
- **Language**: Solidity 0.8.22 (Theta), Rust (CosmWasm for Persistence)
- **Network**: Theta Mainnet (Chain ID: 361) + Persistence (core-1)
- **Core Contracts**:
  - `VaultFactory.sol` - Create2 deterministic vaults, deposit + unwrap management (Theta)
  - `RevenueSplitterHybridV2.sol` - Fee distribution (30/30/25/15) (Theta)
  - `AIDePINRouter.sol` - AI DePIN task router, SP1 proof verification, A2A messaging (Theta — Phase E)
  - `TAOWrapper.sol` - Bittensor vTAO ERC-20 wrapper, subnet inference routing, Substrate bridge (Theta — Phase E)
  - `ZKVerifier.wasm` - SP1 proof verification (Persistence)
  - `ibcTFUEL.wasm` - CW20 token contract with burn_for_unwrap (Persistence)
  - `FeeCollector.wasm` - 0.5% reverse fee accumulator (Persistence)

### Backend Services
- **Theta Listener**: Monitors Theta blockchain for deposits (`backend/theta-bridge/src/listener.js`)
- **Persistence Listener**: Monitors Persistence for `burn_for_unwrap` events (`backend/theta-bridge/src/persistence-listener.js`)
- **AI Listener**: Monitors Osmosis/Akash IBC events for AI intents (compute bids, inference requests, capability queries) and routes to Theta Edge for execution with 0.5% fee collection (`backend/theta-bridge/src/ai-listener.js`)
- **M2M API Server**: REST API for programmatic AI task submission, ZK proof retrieval, A2A messaging, and task status queries with auth + rate limiting (`backend/theta-bridge/src/server.js`)
- **SP1 zkVM Prover**: Generates ZK proofs using SP1 RISC-V (`sp1-prover/program/`, hosted prover at port 8080)
- **Persistence Relayer**: Submits proofs to ZKVerifier.wasm on Persistence
- **Reverse-Burn Handler**: Triggers Theta unwrap transactions after burn detection

---

## 📦 Repo Structure

```
xfuel-protocol/
├── src/                          # Frontend (Vite + React — Bridge UI)
│   ├── components/               # React components
│   │   ├── ManualDepositCard.tsx   # QR code + address display
│   │   ├── SimpleSwapCard.tsx      # Manual deposit UI
│   │   └── ...
│   ├── config/                   # Chain config, ABIs
│   ├── utils/                    # Helpers
│   │   └── reverseBridgeClient.ts  # Reverse bridge interaction
│   └── App.tsx                   # Main app (manual deposit flow)
├── frontend/                     # AI DePIN Dashboard (React 18 + MUI)
│   ├── src/
│   │   ├── components/           # Dashboard components
│   │   │   ├── TaskSimulator.js    # POST /task-request form
│   │   │   ├── A2ASender.js        # POST /a2a-message with escrow
│   │   │   ├── StatusPoller.js     # GET /task-status auto-polling
│   │   │   ├── FeeVisualizer.js    # Recharts fee breakdown charts
│   │   │   ├── HealthMonitor.js    # GET /health live metrics
│   │   │   └── DashboardLayout.js  # Sidebar + nav layout
│   │   ├── context/
│   │   │   └── ApiContext.js       # Global API key / auth context
│   │   ├── hooks/
│   │   │   └── usePoller.js        # Generic polling hook
│   │   ├── utils/
│   │   │   └── api.js              # Axios client, constants, fee calc
│   │   ├── App.js                  # Main dashboard app
│   │   ├── index.js                # Entry point
│   │   └── theme.js                # MUI dark cyberpunk theme
│   ├── public/index.html
│   ├── package.json
│   └── .env.example
├── contracts/                    # Solidity contracts
│   ├── VaultFactory.sol         # Create2 vaults + deposits + unwrap
│   ├── SubVault.sol             # Individual vault logic
│   ├── RevenueSplitterHybridV2.sol  # Revenue distribution
│   ├── AIDePINRouter.sol        # AI DePIN task router (Phase E — inference, compute, A2A)
│   ├── TAOWrapper.sol           # Bittensor vTAO ERC-20 wrapper + subnet routing (Phase E)
│   └── ...
├── cosmwasm-contracts/           # CosmWasm contracts (Persistence)
│   ├── zk-verifier/             # SP1 proof verification
│   ├── persistence-minter/       # ibcTFUEL CW20 token + burn_for_unwrap
│   └── fee-collector/            # 0.5% reverse fee accumulator
├── sp1-prover/                   # SP1 prover deployment
│   ├── program/                 # Rust RISC-V circuit (src/main.rs)
│   └── host/                    # Prover host binary
├── backend/theta-bridge/         # Backend service
│   ├── src/
│   │   ├── listener.js          # Theta deposit monitoring (forward)
│   │   ├── persistence-listener.js  # Persistence burn monitoring (reverse)
│   │   ├── ai-listener.js       # Osmosis/Akash AI intent monitoring (Phase E)
│   │   ├── server.js            # M2M API server for AI DePIN (Phase E — REST endpoints)
│   │   ├── fee-analytics.js     # Fee analytics & revenue monitoring script (CLI + Prometheus)
│   │   ├── sp1-prover-client.js # SP1 proof generation client
│   │   └── ...
│   └── ...
├── scripts/                      # Deployment scripts
├── test/                         # Contract tests
│   ├── VaultFactory.test.cjs    # VaultFactory unit tests
│   ├── ReverseBridge.Integration.test.cjs  # Reverse bridge E2E
│   └── ...
├── legacy-archive/               # Pre-v4.4 legacy code (cleaned up Feb 2026)
├── docs/                         # Documentation
│   ├── governance/              # Governance proposals
│   │   └── PERSISTENCE_WHITELIST_PROPOSAL.md
│   └── ...
├── WHITEPAPER_v4.4.md           # Canonical whitepaper
└── README.md                    # This file
```

**Note:** The `legacy-archive/` folder contains pre-v4.4 code that was refactored during the bi-directional bridge implementation (Feb 2026). See [cleanup/legacy-code-removal](https://github.com/XFuel-Lab/xfuel-protocol/tree/cleanup/legacy-code-removal) branch for details.

---

## Core Layer Setup

The **Core Layer** is the modular, ecosystem-agnostic hub for ZK settlements, task routing, fee distribution, and governance. It lives in the `core-layer/` directory and is designed for independent circuits to plug in via events.

**Whitepaper:** [WHITEPAPER_v1.6_CORE.md](WHITEPAPER_v1.6_CORE.md) — Full Core Layer architecture and design rationale.

### Quick Start

```bash
# 1. Install Node.js dependencies (ai-listener, tests)
cd core-layer
npm install

# 2. Compile Solidity contracts (from project root)
npx hardhat compile

# 3. Run Solidity tests
npx hardhat test core-layer/test/ZKVerifierSP1.test.cjs
npx hardhat test core-layer/test/SP1ProofHooks.test.cjs

# 4. Run JS tests (ai-listener)
cd core-layer
node --test test/ai-listener.test.js

# 5. Build CosmWasm contracts
cd core-layer/wasm/zk-verifier
cargo build --release --target wasm32-unknown-unknown
cd ../revenue-splitter
cargo build --release --target wasm32-unknown-unknown

# 6. Build SP1 hooks library
cd core-layer/sp1-hooks
cargo build --release
cargo test
```

### Core Layer Components

| Component | Path | Description |
|-----------|------|-------------|
| **ai-listener.js** | `core-layer/ai-listener.js` | Multi-RPC event poller for EVM + Cosmos chains; intent solver; proof coordinator |
| **ZKVerifierSP1.sol** | `core-layer/contracts/ZKVerifierSP1.sol` | EVM SP1 proof verifier with circuit registry + nullifier tracking |
| **CoreRevenueSplitter.sol** | `core-layer/contracts/CoreRevenueSplitter.sol` | Fee collection + 30/30/25/15 distribution (BBB/LP/Stakers/Treasury) |
| **veXFGovernance.sol** | `core-layer/contracts/veXFGovernance.sol` | Vote-escrowed governance stubs for circuit priorities / LP params |
| **SP1ProofHooks.sol** | `core-layer/contracts/SP1ProofHooks.sol` | Solidity library for nullifier computation, fee commitments |
| **ISP1Verifier.sol** | `core-layer/contracts/interfaces/ISP1Verifier.sol` | SP1 Verifier Gateway interface |
| **xfuel-zk-verifier** | `core-layer/wasm/zk-verifier/` | CosmWasm ZK verifier for Cosmos chains |
| **xfuel-revenue-splitter** | `core-layer/wasm/revenue-splitter/` | CosmWasm revenue splitter for Cosmos chains |
| **xfuel-sp1-hooks** | `core-layer/sp1-hooks/` | Rust library: shared types + proof helpers |

### Running the AI Listener

```bash
cd core-layer

# Start with default configuration (Theta + Bittensor + Osmosis + Akash)
node ai-listener.js

# Or import as a module in your circuit:
import { CoreListener, AI_INTENT_TYPES, ChainType } from './ai-listener.js';

const listener = new CoreListener({
  chains: {
    theta_mainnet: {
      type: ChainType.EVM,
      name: 'Theta Mainnet',
      chainId: 361,
      rpc: 'https://eth-rpc-api.thetatoken.org/rpc',
    },
  },
});

// Register your circuit
listener.registerCircuit('my-circuit', {
  onIntent: async (intent) => {
    console.log('Received intent:', intent.type, intent.chain);
  },
  onProofReady: async (proof) => {
    console.log('Proof verified:', proof.nullifier);
  },
});

await listener.start();
```

### Integrating a Custom Circuit

Circuits plug into the Core Layer via the event-driven interface:

1. **Register** your circuit with the CoreListener (JS) or listen for `ProofVerified` events (on-chain)
2. **Filter** by chain and/or intent type
3. **Process** intents with your domain-specific logic
4. **Submit** settlement requests back through the Core Layer
5. **Receive** ZK-verified confirmations

```javascript
// Example: Compute marketplace circuit
listener.registerCircuit(
  'compute-marketplace',
  {
    onIntent: async (intent) => {
      if (intent.type === AI_INTENT_TYPES.COMPUTE_BID) {
        // Route to cheapest provider
        const result = await routeToProvider(intent);
        return result;
      }
    },
  },
  ['theta_mainnet', 'bittensor_evm'],     // Chains to listen on
  [AI_INTENT_TYPES.COMPUTE_BID]           // Intent types to receive
);
```

### Configuration

Core Layer contracts support both **live mode** (with SP1 Verifier Gateway) and **mock mode** (gateway = `address(0)` or `mock_mode: true` for WASM):

```bash
# EVM: Deploy with mock mode (SP1 verifier = zero address)
npx hardhat run scripts/deploy-core-layer.js --network hardhat

# WASM: Instantiate with mock mode
osmosisd tx wasm instantiate $CODE_ID \
  '{"admin":"osmo1...","mock_mode":true}' \
  --from deployer --gas auto
```

### Multi-Network RPCs

Configure chains in the CoreListener or via environment variables:

| Chain | Type | Chain ID | Default RPC |
|-------|------|----------|-------------|
| Theta Mainnet | EVM | 361 | `https://eth-rpc-api.thetatoken.org/rpc` |
| Theta Testnet | EVM | 365 | `https://eth-rpc-api-testnet.thetatoken.org/rpc` |
| Bittensor EVM | EVM | 964 | `https://lite.chain.opentensor.ai/evm` |
| Osmosis | Cosmos | osmosis-1 | `https://rpc.osmosis.zone` |
| Akash | Cosmos | akashnet-2 | `https://rpc.akash.forbole.com` |

---

## Circuit Prototypes

Ten circuits demonstrate the Core Layer's modular, ecosystem-agnostic architecture. Each is fully isolated (own state, events, pause) and plugs into Core via standard interfaces.

**Full spec:** [WHITEPAPER_v1.6_CORE.md — Sections 14-16](WHITEPAPER_v1.6_CORE.md#14-priority-circuits-step-2--v161)

### Quick Start

```bash
# Compile all circuits (from project root)
npx hardhat compile

# Run all circuit tests (priority + expansion)
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

# Run multi-circuit integration tests (20 E2E tests)
npx hardhat test test/integration/MultiCircuit.integration.test.cjs

# Run system tests (20 tests: gas profiling + deployment validation)
npx hardhat test test/optimizations/GasProfile.system.test.cjs
npx hardhat test test/optimizations/Deploy.system.test.cjs
```

### Circuit Overview

| Circuit | Contract | Purpose | Default Chains | Fee |
|---------|----------|---------|---------------|-----|
| **AI Marketplace** | `circuits/tao-evm/TAOCircuit.sol` | Cross-chain task routing, AMM fees, oracle pricing | Bittensor, Theta | 0.5% |
| **Agent Comms** | `circuits/a2a/A2ACircuit.sol` | ZK agent discovery, bidding, x402 micropayments | All chains | 0.1% relay + 0.5% task |
| **Edge Compute** | `circuits/theta-gpu/ThetaGPUCircuit.sol` | GPU inference routing, provider staking, model registry | Theta | 0.5% |
| **zkML Inference** | `circuits/zkml/ZKMLCircuit.sol` | Private model inference, SP1 proofs, weight commitments | All chains | 0.75% |
| **DePIN Compute** | `circuits/akash/AkashCircuit.sol` | GPU leasing, reverse auction, per-block lease payments | All chains | 0.5% |
| **Autonomous Vaults** | `circuits/autonomous-vaults/AutonomousVaults.sol` | AI-driven yield strategies, ZK-verified rebalancing, tokenized vaults | All chains | 0.5% |
| **Agent Robotics** | `circuits/agent-robotics/AgentRobotics.sol` | Sim-to-real trajectory verification, safety certs, task marketplace | All chains | 1% cert + 0.5% task |
| **Data Hubs** | `circuits/data-hubs/DataHubs.sol` | Decentralized data contribution, ZK provenance, tokenized access | All chains | 0.5% |
| **Yield Optimization** | `circuits/yield-optimization/YieldCircuit.sol` | Multi-pool ZK-verified yield rebalancing, concentrated-liquidity aware | All chains | 0.5% deposit + 1% harvest |
| **NEAR Agents** | `circuits/near-agents/NearAgents.sol` | Autonomous AI agent marketplace with intent bidding and ZK settlement | All chains | 0.5% |
| **Solana AI Bridge** | `circuits/solana-ai-bridge/SolanaAIBridge.sol` | EVM↔Solana bridge for Render/io.net/Grass/SendAI AI compute | All chains | 0.75% |
| **Filecoin Storage** | `circuits/filecoin-storage/FilecoinStorage.sol` | ZK-verified decentralized storage deals, WindowPoSt proofs, provider registry | All chains | 0.5% |
| **Energy Grid** | `circuits/energy-grid/EnergyGrid.sol` | DePIN energy attestation, P2P trading, carbon credits (Daylight/Glow) | All chains | 0.5% |
| **Mapping Sensor** | `circuits/mapping-sensor/MappingSensor.sol` | DePIN geospatial mapping, sensor data marketplace, coverage tracking (Hivemapper/DIMO) | All chains | 0.5% |
| **Wireless DePIN** | `circuits/wireless-depin/WirelessDePIN.sol` | DePIN wireless coverage (LoRaWAN/5G/WiFi), ZK coverage proofs, data credit settlement (Helium/XNET) | All chains | 0.5% |
| **Uplink** | `circuits/uplink/UplinkCircuit.sol` | WiFi bandwidth sharing, ZK session proofs, router quality EMA, connectivity map (Uplink/Althea) | All chains | 0.5% |

### Registering Circuits with CoreListener

```javascript
import { CoreListener } from './core-layer/ai-listener.js';
import { registerAllCircuits } from './circuits/index.js';

const listener = new CoreListener({
  chains: {
    theta_mainnet: { type: 'evm', chainId: 361, rpc: '...' },
    bittensor:     { type: 'evm', chainId: 964, rpc: '...' },
  },
});

// Register all 11 circuits (3 priority + 8 expansion)
const {
  taoHandler, a2aHandler, gpuHandler, zkmlHandler, akashHandler,
  vaultsHandler, roboticsHandler, dataHubsHandler, yieldHandler, nearHandler, solanaHandler,
} = registerAllCircuits(listener, {
    tao: { contractAddress: '0x...' },
    a2a: { contractAddress: '0x...' },
    gpu: { contractAddress: '0x...', edgeCloudEndpoint: 'http://localhost:8090' },
    zkml: { proverEndpoint: 'http://localhost:9090/prove' },
    akash: { akashRpc: 'https://rpc.akash.network:443' },
    vaults: { rebalanceInterval: 300000 },
    robotics: { simEngineEndpoint: 'http://localhost:9100/simulate' },
    dataHubs: {},
    yield: { rebalanceInterval: 600000 },
    near: {},
    solana: { wormholeEndpoint: 'https://wormhole-v2-mainnet-api.certus.one' },
  });

await listener.start();
```

### Building a Custom Circuit

Any project can build a circuit that plugs into XFuel's Core Layer:

```javascript
import { registerCustomCircuit } from './circuits/index.js';

// 1. Define your handler
const myHandler = {
  async onIntent(intent, ctx) {
    console.log('My circuit received:', intent.type);
    // Your domain-specific logic here
    // Call ctx.generateProof() when ready to settle
  },
  async onProofReady(proof, request) {
    console.log('Settlement proof ready:', proof.nullifier);
  },
};

// 2. Register with CoreListener
registerCustomCircuit(listener, 'my-custom-circuit', myHandler,
  ['theta_mainnet'],           // chains to listen on
  ['inference_request']        // intent types to receive
);
```

### File Structure

```
circuits/
├── index.js                          # Central registry — registerAllCircuits()
├── tao-evm/                          # Priority: AI Marketplace Circuit
│   ├── TAOCircuit.sol                # Solidity: Hyperlane bridge, AMM, oracle
│   ├── tao-handler.js                # Off-chain handler for ai-listener
│   ├── interfaces/
│   │   ├── IHyperlaneMailbox.sol      # Hyperlane messaging interface
│   │   └── IChainlinkOracle.sol       # Chainlink price feed interface
│   └── test/
│       └── TAOCircuit.test.cjs        # 15 Hardhat tests
├── a2a/                              # Priority: Agent Communication Circuit
│   ├── A2ACircuit.sol                # Solidity: ZK agents, bids, channels
│   ├── a2a-handler.js                # Off-chain handler for ai-listener
│   └── test/
│       └── A2ACircuit.test.cjs        # 15 Hardhat tests
├── theta-gpu/                        # Priority: Edge Compute Circuit
│   ├── ThetaGPUCircuit.sol           # Solidity: EdgeCloud, models, providers
│   ├── gpu-handler.js                # Off-chain handler for ai-listener
│   └── test/
│       └── ThetaGPUCircuit.test.cjs   # 15 Hardhat tests
├── zkml/                             # Expansion: Private ML Inference
│   ├── ZKMLCircuit.sol               # Solidity: private models, SP1 proofs
│   ├── zkml-handler.js               # Off-chain handler for ai-listener
│   └── test/
│       └── ZKMLCircuit.test.cjs       # 15 Hardhat tests
├── akash/                            # Expansion: DePIN GPU Leasing
│   ├── AkashCircuit.sol              # Solidity: reverse auction, leases
│   ├── akash-handler.js              # Off-chain handler for ai-listener
│   └── test/
│       └── AkashCircuit.test.cjs      # 15 Hardhat tests
├── autonomous-vaults/                # Further Expansion: AI Vaults
│   ├── AutonomousVaults.sol          # Solidity: tokenized yield, ZK rebalance
│   ├── vaults-handler.js             # Off-chain handler for ai-listener
│   └── test/
│       └── AutonomousVaults.test.cjs  # 15 Hardhat tests
├── agent-robotics/                   # Further Expansion: Sim-to-Real Robotics
│   ├── AgentRobotics.sol             # Solidity: trajectories, safety certs
│   ├── robotics-handler.js           # Off-chain handler for ai-listener
│   └── test/
│       └── AgentRobotics.test.cjs     # 15 Hardhat tests
├── data-hubs/                        # Final Expansion: Decentralized Data Ownership
│   ├── DataHubs.sol                  # Solidity: data DAOs, ZK provenance, access grants
│   ├── datahubs-handler.js           # Off-chain handler for ai-listener
│   └── test/
│       └── DataHubs.test.cjs          # 15 Hardhat tests
├── yield-optimization/               # Final Expansion: Generalized Yield
│   ├── YieldCircuit.sol              # Solidity: multi-pool rebalancing, CL-aware
│   ├── yield-handler.js              # Off-chain handler for ai-listener
│   └── test/
│       └── YieldCircuit.test.cjs      # 15 Hardhat tests
├── near-agents/                      # Expansion: Autonomous AI Agents (NEAR)
│   ├── NearAgents.sol                # Solidity: intents, bidding, ZK settlement
│   ├── near-handler.js               # Off-chain handler for ai-listener
│   └── test/
│       └── NearAgents.test.cjs        # 15+ Hardhat tests
├── solana-ai-bridge/                 # Expansion: Solana AI Powerhouses Bridge
│   ├── SolanaAIBridge.sol            # Solidity: Wormhole bridge, provider registry, ZK settlement
│   ├── solana-handler.js             # Off-chain handler for ai-listener
│   └── test/
│       └── SolanaAIBridge.test.cjs    # 14 Hardhat tests
├── filecoin-storage/                 # Expansion #12: Decentralized Storage
│   ├── FilecoinStorage.sol           # Solidity: storage deals, ZK proofs, provider registry
│   ├── filecoin-handler.js           # Off-chain handler for ai-listener
│   └── test/
│       └── FilecoinStorage.test.cjs   # 14 Hardhat tests
├── energy-grid/                      # Expansion #13: DePIN Energy
│   ├── EnergyGrid.sol                # Solidity: energy nodes, attestation, P2P trading, carbon credits
│   ├── energy-handler.js             # Off-chain handler for ai-listener
│   └── test/
│       └── EnergyGrid.test.cjs        # 14 Hardhat tests
├── mapping-sensor/                   # Expansion #14: DePIN Mapping
│   ├── MappingSensor.sol             # Solidity: devices, data submission, marketplace, coverage
│   ├── mapping-handler.js            # Off-chain handler for ai-listener
│   └── test/
│       └── MappingSensor.test.cjs     # 15 Hardhat tests
├── wireless-depin/                   # Expansion #15: DePIN Wireless
│   ├── WirelessDePIN.sol             # Solidity: hotspots, coverage proofs, data credits
│   ├── wireless-handler.js           # Off-chain handler for ai-listener
│   └── test/
│       └── WirelessDePIN.test.cjs    # 14 Hardhat tests
└── uplink/                           # Expansion #16: WiFi Bandwidth Sharing
    ├── UplinkCircuit.sol             # Solidity: routers, sessions, bandwidth proofs, quality EMA
    ├── uplink-handler.js             # Off-chain handler for ai-listener
    └── test/
        └── UplinkCircuit.test.cjs    # 15 Hardhat tests

believer/
├── BelieverRound.sol                 # Vesting contract: cliff + linear vest + refund
├── activation-script.cjs             # End-to-end deploy + smoke test + campaign generator
├── launch-round.cjs                  # Believer Round launch (manifest-aware + campaign copy)
├── monitoring-script.cjs             # Believer Round monitor (contract health + grants + webhook)
└── test/
    └── BelieverRound.test.cjs        # 16 Hardhat tests (commitment, TGE, vesting, refund)

deploy/
├── deploy-core.cjs                   # Deploy Core Layer (RevenueSplitter + ZKVerifier)
├── deploy-circuits.cjs               # Deploy all circuits + grant roles
├── deploy-full.cjs                   # One-shot full stack deployment
├── testnet.cjs                       # Testnet deployment v2 (12 circuits + BelieverRound + role verification)
├── mainnet.cjs                       # Mainnet deployment v2 (15 contracts + monitoring)
└── manifests/                        # Timestamped JSON deployment manifests

launch/
└── public-launch.cjs                 # Legacy orchestrated launch (7 phases, 15 contracts)

activation/
├── public-activation.cjs             # Public testnet activation (16 circuits)
└── mainnet-activation.cjs            # Mainnet activation (9 phases, 20 contracts, 16 circuits)

grant/
├── submission-script.cjs             # Auto-fill grant apps from deployment manifests
└── submissions/                      # Generated JSON + markdown per program

polish/
└── gas-opts.cjs                      # Gas optimization profiler (all 15 contracts)

dashboard/
└── index.html                        # Live dashboard: contracts, events, listener, gas profiles

test/
├── integration/
│   └── MultiCircuit.integration.test.cjs  # 20 E2E integration tests
├── optimizations/
│   ├── GasProfile.system.test.cjs    # 10 gas profiling tests
│   └── Deploy.system.test.cjs        # 10 deployment validation tests
└── hardening/
    └── LoadChaos.hardening.test.cjs  # 20 load/chaos stress tests

community/
├── bot.cjs                           # Discord bot: veXF simulator, circuit info, fee calc
├── ama-script.cjs                    # X AMA + Discord event content generator
├── x-campaign-template.md            # X/Twitter campaign templates (5 campaigns)
└── testnet-live-announcement.md      # Testnet launch announcement copy

iteration/
├── add-circuit.cjs                   # Circuit onboarding + scaffold + validation (16/16)
└── synergy-script.cjs                # Cross-circuit DePIN synergy analyzer + simulation

funding/
└── monitoring-bot.cjs                # Grant tracking + milestone management + webhooks

governance/
├── proposal-script.cjs               # veXF proposal creation + simulation + vote
└── proposals/                        # Generated proposal JSON files

grant-templates/
├── solana-grant.md                   # Solana Foundation grant template ($150-250K)
├── tao-grant.md                      # OpenTensor/Bittensor grant template ($150-200K)
├── general-grant.md                  # General ecosystem grant template
└── grant-tracker.cjs                 # Submission tracker + milestone reporting
```

### Testing Suite Guide

XFuel Protocol has **315+ total tests** — 235 unit tests across 16 circuits (including 14 FilecoinStorage + 14 EnergyGrid + 15 MappingSensor + 14 WirelessDePIN + 14 UplinkCircuit tests) plus 16 BelieverRound vesting tests plus 20 multi-circuit end-to-end integration tests plus 20 system tests (10 gas profiling + 10 deployment validation) plus 20 load/chaos hardening tests. Tests cover deployment, lifecycle flows, edge cases, fee math, multi-user stress, cross-circuit isolation, access control, gas optimization, full-stack deployment, system hardening under 500+ concurrent operations, on-chain vesting with cliff/linear release/refund protection, decentralized storage deal lifecycle, DePIN energy attestation/trading/carbon credits, geospatial mapping/sensor data marketplace, wireless coverage proof/data credit settlement, and WiFi bandwidth session proofs with quality EMA.

**Run all tests:**

```bash
# Compile everything first
npx hardhat compile

# ─── Individual Circuit Tests (15 each) ────────────────────────────
npx hardhat test circuits/tao-evm/test/TAOCircuit.test.cjs              # AI Marketplace
npx hardhat test circuits/a2a/test/A2ACircuit.test.cjs                   # Agent Comms
npx hardhat test circuits/theta-gpu/test/ThetaGPUCircuit.test.cjs       # Edge Compute
npx hardhat test circuits/zkml/test/ZKMLCircuit.test.cjs                 # zkML Inference
npx hardhat test circuits/akash/test/AkashCircuit.test.cjs               # DePIN Compute
npx hardhat test circuits/autonomous-vaults/test/AutonomousVaults.test.cjs  # AI Vaults
npx hardhat test circuits/agent-robotics/test/AgentRobotics.test.cjs     # Agent Robotics
npx hardhat test circuits/data-hubs/test/DataHubs.test.cjs               # Data Hubs
npx hardhat test circuits/yield-optimization/test/YieldCircuit.test.cjs  # Yield Optimization
npx hardhat test circuits/near-agents/test/NearAgents.test.cjs           # NEAR Agents
npx hardhat test circuits/solana-ai-bridge/test/SolanaAIBridge.test.cjs # Solana AI Bridge
npx hardhat test circuits/filecoin-storage/test/FilecoinStorage.test.cjs # Filecoin Storage (14 tests)
npx hardhat test circuits/energy-grid/test/EnergyGrid.test.cjs         # Energy Grid (14 tests)
npx hardhat test circuits/mapping-sensor/test/MappingSensor.test.cjs   # Mapping Sensor (15 tests)
npx hardhat test circuits/wireless-depin/test/WirelessDePIN.test.cjs   # Wireless DePIN (14 tests)
npx hardhat test circuits/uplink/test/UplinkCircuit.test.cjs           # Uplink (15 tests)

# ─── Multi-Circuit Integration Tests (20 E2E) ──────────────────────
npx hardhat test test/integration/MultiCircuit.integration.test.cjs

# ─── System Tests (20 total) ────────────────────────────────────────
npx hardhat test test/optimizations/GasProfile.system.test.cjs    # Gas profiling (10)
npx hardhat test test/optimizations/Deploy.system.test.cjs        # Deployment (10)

# ─── Hardening Tests (20 load/chaos) ────────────────────────────────
npx hardhat test test/hardening/LoadChaos.hardening.test.cjs      # Load/chaos (20)

# ─── Believer Round Tests (16) ─────────────────────────────────────
npx hardhat test believer/test/BelieverRound.test.cjs             # Vesting + refund

# ─── Core Layer Tests ───────────────────────────────────────────────
npx hardhat test core-layer/test/ZKVerifierSP1.test.cjs
npx hardhat test core-layer/test/SP1ProofHooks.test.cjs

# ─── JS Listener Tests ─────────────────────────────────────────────
cd core-layer && npm test

# ─── Run ALL Hardhat tests at once ─────────────────────────────────
npx hardhat test
```

**Unit test coverage matrix (11 circuits):**

| Category | TAO | A2A | GPU | zkML | Akash | Vaults | Robotics | DataHubs | Yield | NEAR | Solana |
|----------|-----|-----|-----|------|-------|--------|----------|----------|-------|------|--------|
| Deployment/Identity | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 1 | 1 | 2 | 2 |
| Core Lifecycle | 4 | 4 | 6 | 4 | 3 | 4 | 4 | 5 | 5 | 4 | 3 |
| Settlement/Proof | 3 | 2 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 | 4 |
| Fee Math | 2 | 1 | 1 | 2 | 1 | 2 | 1 | 2 | 2 | 1 | 1 |
| Edge Cases | 2 | 2 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Stress/Multi-user | 2 | 4 | 2 | 1 | 3 | 1 | 2 | 2 | 2 | 2 | 2 |
| **Total** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **15** | **14** |

**Integration test coverage (20 E2E tests across all 11 circuits):**

| # | Category | Tests | Description |
|---|----------|-------|-------------|
| 1-2 | Deployment verification | 2 | All 7 circuits deploy with unique IDs; all share CoreRevenueSplitter |
| 3-5 | Fee aggregation | 3 | TAO+A2A, GPU+zkML+Akash, Vaults+Robotics fees all reach splitter |
| 6-8 | Circuit isolation | 3 | State independence: task counts, agent counts, strategy counts |
| 9 | Nullifier independence | 1 | Same nullifier valid across different circuits |
| 10-13 | Cross-circuit pipelines | 4 | TAO→GPU, A2A→bid→GPU, Vault full lifecycle, Robotics full lifecycle |
| 14-15 | Concurrent stress | 2 | 5 users across 3 circuits; 10 deposits across 2 vaults |
| 16-17 | Pause isolation | 2 | Pausing one circuit does not affect others |
| 18 | Global accounting | 1 | Splitter balance matches sum of all circuit fees |
| 19-20 | Access control isolation | 2 | Roles on one circuit don't grant access to others |

**System Optimization / Gas Profiling (10 tests):**

| # | Category | Tests | Target | Description |
|---|----------|-------|--------|-------------|
| 01 | Settlement gas | 1 | <100K | TAO settleTask verified at ~68K gas |
| 02-03 | Rebalance gas | 2 | <350K / <300K | Vault rebalance ~292K; Yield rebalance ~226K |
| 04-06 | Deposit/submit gas | 3 | <350K each | TAO submit, Vault deposit, Yield openPosition |
| 07 | Fee forwarding overhead | 1 | <300K total | Access + fee forwarding combined |
| 08-09 | Linear scaling | 2 | <1.2x ratio | 5 consecutive ops scale linearly |
| 10 | Deployment costs | 1 | <3M each | All 11 circuits deploy under 3M gas |

**Load/Chaos Hardening Tests (20 tests):**

| # | Category | Tests | Description |
|---|----------|-------|-------------|
| 01-02 | TAO high-volume | 2 | 50 tasks in rapid succession; gas stability across 10 settlements |
| 03-04 | Yield load | 2 | 30 parallel positions; 20 rebalances with unique nullifiers |
| 05-06 | NEAR Agents load | 2 | 20 agents in parallel; 15 intents submitted + cancelled |
| 07 | Solana pipeline | 1 | 20 tasks through full submit→bridge→settle pipeline |
| 08-09 | Cross-circuit concurrent | 2 | 10 ops each on TAO+Yield+NEAR; multi-circuit fee aggregation |
| 10-12 | Chaos: pause/unpause | 3 | Mid-stream pause blocks; unpause resumes; isolation verified |
| 13-14 | Nullifier collision | 2 | 100 unique nullifiers; duplicate rejection at scale |
| 15-16 | Fee accounting | 2 | 20-op fee totals match; 25 DataHubs contributions validated |
| 17-18 | Gas stability | 2 | TAO settleTask stays <100K; Solana settleTask <400K |
| 19-20 | Full stress pipeline | 2 | 5 users × 5 circuits × 2 ops = 50 ops; splitter consistency |

**Writing tests for custom circuits:**

Tests follow a common pattern: deploy `CoreRevenueSplitter` as a shared fee sink, deploy the circuit with `zkVerifier = address(0)` (mock mode), grant roles, then test each lifecycle stage. See any existing test file for the template.

---

### Optimization Guide

XFuel Protocol targets gas-efficient operations across all 11 circuits. The `test/optimizations/GasProfile.system.test.cjs` and `test/hardening/LoadChaos.hardening.test.cjs` test suites enforce measurable gas budgets.

**Key gas targets and measured results (Hardhat, optimizer 200 runs, viaIR):**

| Operation | Circuit | Gas Target | Measured Gas | Status |
|-----------|---------|-----------|-------------|--------|
| `settleTask` | TAO | <100K | ~68K | Pass |
| `rebalance` | Vaults | <350K | ~292K | Pass |
| `rebalancePosition` | Yield | <300K | ~226K | Pass |
| `submitTask` | TAO | <350K | ~303K | Pass |
| `deposit` | Vaults | <350K | ~296K | Pass |
| `openPosition` | Yield | <350K | ~318K | Pass |
| `purchaseAccess` | DataHubs | <300K | ~297K | Pass |
| `settleTask` | Solana | <400K | ~327K | Pass |
| `bridgeTask` | Solana | <150K | ~128K | Pass |
| `registerProvider` | Solana | <200K | ~194K | Pass |
| Deploy any circuit | All 11 | <3M | 2.1M–2.9M | Pass |

**Optimization techniques applied:**
- **Storage packing**: Structs use `uint64` for timestamps, `uint16` for fee BPS, `bytes32` for IDs
- **Minimal storage writes**: Critical path operations minimize SSTORE count
- **Fee forwarding**: Single `call` to `revenueSplitter.depositFee()` with fallback
- **Optimizer + viaIR**: Solidity optimizer at 200 runs with IR pipeline enabled
- **Independent storage**: Each circuit uses isolated mappings — no cross-circuit reads

**Running gas profiling:**

```bash
# Run the full gas profiling suite
npx hardhat test test/optimizations/GasProfile.system.test.cjs

# Enable gas reporter for detailed method-level breakdown
REPORT_GAS=true npx hardhat test
```

---

### Deployment Guide

XFuel Protocol includes Hardhat deployment scripts for testnet and mainnet deployments.

**Prerequisites:**
1. Configure `.env.local` with deployer keys and recipient addresses
2. Ensure sufficient balance on target network

**Quick deploy commands:**

```bash
# ─── Local test deployment ───────────────────────────────────────────
npx hardhat run deploy/deploy-full.cjs --network hardhat

# ─── Theta Testnet ───────────────────────────────────────────────────
npx hardhat run deploy/deploy-core.cjs --network theta-testnet
npx hardhat run deploy/deploy-circuits.cjs --network theta-testnet

# ─── Testnet deployment (Theta + all 11 circuits) ───────────────────
npx hardhat run deploy/testnet.cjs --network theta-testnet

# ─── Theta Mainnet (PRODUCTION — full safety checks) ────────────────
npx hardhat run deploy/mainnet.cjs --network theta-mainnet

# ─── Theta Mainnet (simple — no admin transfer) ─────────────────────
npx hardhat run deploy/deploy-full.cjs --network theta-mainnet
```

**Deployment scripts:**

| Script | Description |
|--------|------------|
| `deploy/deploy-core.cjs` | Deploy Core Layer: CoreRevenueSplitter + ZKVerifierSP1 |
| `deploy/deploy-circuits.cjs` | Deploy all 11 circuits + auto-grant CIRCUIT_ROLE |
| `deploy/deploy-full.cjs` | One-shot: Core + all circuits + role configuration + manifest |
| `deploy/testnet.cjs` | Testnet deployment: Core + 11 circuits + roles + smoke test |
| `deploy/mainnet.cjs` | **Production mainnet**: Core + 11 circuits + admin transfer + smoke tests + manifest |

**Required `.env.local` variables:**

```bash
DEPLOYER_PRIVATE_KEY=0x...
ADMIN_ADDRESS=0x...
BBB_ADDRESS=0x...
LP_ADDRESS=0x...
STAKER_ADDRESS=0x...
TREASURY_ADDRESS=0x...
STAKE_POOL_ADDRESS=0x...
SP1_GATEWAY_ADDRESS=0x...    # Optional: SP1 Verifier Gateway
XF_TOKEN_ADDRESS=0x...       # Optional: XF token for veXFGovernance
```

**Post-deployment verification:**

```bash
# Run deployment validation tests
npx hardhat test test/optimizations/Deploy.system.test.cjs
```

**Mainnet deployment features:**
- Pre-flight checks (50+ TFUEL balance, chain ID 361 verification)
- veXFGovernance deployment alongside Core Layer
- Admin transfer: deployer → multisig (DEFAULT_ADMIN_ROLE)
- Automated smoke tests on all 11 circuits
- JSON manifest saved to `deploy/manifests/mainnet-{timestamp}.json`

**Post-deployment checklist:**
1. Verify all contracts on [Theta Explorer](https://explorer.thetatoken.org)
2. Confirm multisig admin has DEFAULT_ADMIN_ROLE
3. Configure RELAYER_ROLE / SOLVER_ROLE on each circuit
4. Set production SP1 Gateway address
5. Announce deployment to community

---

### Community Tools

XFuel Protocol includes community engagement tools in the `community/` folder.

**Discord Bot (`community/bot.cjs`):**

Interactive bot with veXF governance simulation, circuit info, and fee calculators:

```bash
# Run in simulation mode (no Discord token needed)
node community/bot.cjs

# Run live Discord bot
DISCORD_TOKEN=your_token DISCORD_CLIENT_ID=your_id node community/bot.cjs
```

| Command | Description |
|---------|-------------|
| `/vexf simulate amount:10000 days:1095` | Lock simulation → 30,000 veXF, 3x multiplier |
| `/vexf apy amount:50000 days:730 revenue:25000` | Estimated APY at $25K/day protocol revenue |
| `/vexf tiers` | All lock tiers: 6mo (1x), 1yr (1x), 2yr (2x), 3yr (3x) |
| `/circuit info name:solana-ai-bridge` | Circuit details, gas, fees |
| `/circuit list` | All 11 circuits with ecosystems |
| `/fee calculate amount:100000` | Fee split: $30K BBB, $30K LP, $25K stakers, $15K treasury |
| `/protocol stats` | Protocol overview |

**X Campaign Templates (`community/x-campaign-template.md`):**

5 ready-to-use campaign templates: Mainnet Announcement (8-tweet thread), Grant Win, Community Milestone, Weekly Dev Update, veXF Governance Launch.

---

### Believer Round (On-Chain Vesting)

The Believer Round is a community-first micro-commitment funding mechanism powered by `BelieverRound.sol` — a Solidity smart contract with cliff + linear vesting, anti-whale caps, and on-chain refund protection.

**Key Features:**
- **Commitment phase**: TFUEL/ETH micro-commitments with per-wallet caps
- **TGE trigger**: Admin deposits XF tokens, vesting clock starts
- **Cliff**: 90 days — no tokens claimable
- **Linear vesting**: 365 days — ~8.33% unlocked per month
- **Refund safety**: If TGE misses 180-day deadline, full refund guaranteed

```bash
# Run BelieverRound tests (16 tests)
npx hardhat test believer/test/BelieverRound.test.cjs

# Deploy (included in mainnet deploy script)
npx hardhat run deploy/mainnet.cjs --network theta-mainnet
```

| Operation | Gas |
|-----------|-----|
| commit() | ~45K – 123K |
| triggerTGE() | ~117K |
| claim() | ~63K – 139K |
| requestRefund() | ~44K |

See full details: **[believer-guide.md](believer-guide.md)** (execution checklist, smart contract flow, tier structure)

---

### Mainnet Monitoring

The enhanced mainnet script (`deploy/mainnet.cjs` v2) includes post-deploy health checks and optional continuous monitoring via ThetaScan.io API integration.

```bash
# Standard deployment (includes health checks)
npx hardhat run deploy/mainnet.cjs --network theta-mainnet

# Deployment with continuous monitoring
ENABLE_MONITORING=true MONITOR_INTERVAL_MS=30000 npx hardhat run deploy/mainnet.cjs --network theta-mainnet
```

**Health check features:**
- On-chain code verification for all 14 contracts
- Balance reads for deployer and contract addresses
- ThetaScan API cross-reference (contract + balance endpoints)
- JSON manifest updated with health check results
- Optional continuous monitoring loop at configurable intervals

---

### Public Activation Guide

Deploy and monitor XFuel Protocol on Theta Testnet (chain ID 365).

**Quick Start (3 commands):**

```bash
# 1. Full orchestrated activation (Core + 13 circuits + BelieverRound + smoke tests + campaign)
#    Pre-flight: checks deployer balance, chain ID 365, compiler version
#    Outputs: manifest JSON to deploy/manifests/activation-<timestamp>.json
npx hardhat run activation/public-activation.cjs --network theta-testnet

# Alternative: deploy-only (no campaign output)
npx hardhat run deploy/testnet.cjs --network theta-testnet

# 2. Open the live dashboard — load the manifest and start the event listener
#    Dashboard URL: file:///path/to/xfuel-protocol/dashboard/index.html
#    Or serve it: npx serve dashboard -l 3000
start dashboard/index.html          # Windows
# open dashboard/index.html         # macOS
# xdg-open dashboard/index.html     # Linux

# 3. Launch Believer Round on testnet
npx hardhat run believer/launch-round.cjs --network theta-testnet
```

**Local simulation (no TFUEL required):**

```bash
# Deploy to Hardhat local network (instant, 10K ETH balance)
npx hardhat run activation/public-activation.cjs
# → Manifest saved to deploy/manifests/activation-*.json
# → Load manifest into dashboard to verify all 16 contracts
```

**Theta Testnet config:**
- **RPC**: `https://eth-rpc-api-testnet.thetatoken.org/rpc`
- **Chain ID**: 365
- **Faucet**: thirdweb (0.01 TFUEL / 24h)
- **Explorer**: `https://testnet-explorer.thetatoken.org`
- **Min Balance**: 0.5 TFUEL (checked by pre-flight)

**Activation phases (public-activation.cjs):**
1. **Pre-flight** — balance check, chain ID verification
2. **Core Layer** — CoreRevenueSplitter + ZKVerifierSP1
3. **Circuits (15)** — all circuits incl. EnergyGrid + MappingSensor + WirelessDePIN, with gas tracking
4. **BelieverRound** — on-chain vesting contract
5. **Role Grants** — CIRCUIT_ROLE assigned + verified (14/14)
6. **Smoke Tests** — 17 tests: CIRCUIT_ID reads + splitter shares + BelieverRound + ZKVerifier
7. **Dashboard Manifest** — JSON output for dashboard loading
8. **Campaign Output** — ready-to-post X/Twitter + Discord announcement copy

---

### Mainnet Activation Guide (v2.1)

Deploy XFuel Protocol to Theta Mainnet (chain ID 361) with production-grade safety.

**Quick Start:**

```bash
# Full mainnet activation (9 phases, 20 contracts, admin transfer, health checks)
npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet

# With continuous monitoring
ENABLE_MONITORING=true npx hardhat run activation/mainnet-activation.cjs --network theta-mainnet

# Local simulation
npx hardhat run activation/mainnet-activation.cjs
```

**Required environment variables (.env.local):**
- `DEPLOYER_PRIVATE_KEY` — funded with >= 50 TFUEL
- `ADMIN_ADDRESS` — multisig admin (receives DEFAULT_ADMIN_ROLE)
- `BBB_ADDRESS`, `LP_ADDRESS`, `STAKER_ADDRESS`, `TREASURY_ADDRESS` — fee recipients
- `SP1_GATEWAY_ADDRESS` — SP1 Verifier Gateway (optional, address(0) for mock)
- `XF_TOKEN_ADDRESS` — XF ERC-20 (optional, address(0) to skip veXFGovernance)

**Mainnet activation phases:**
1. **Pre-flight** — balance >= 50 TFUEL, chain ID 361, address validation
2. **Core Layer** — Splitter + ZKVerifier + optional veXFGovernance
3. **Circuits (16)** — all 16 modular circuits incl. UplinkCircuit with gas tracking
4. **BelieverRound** — on-chain vesting contract
5. **Role Grants** — 16/16 CIRCUIT_ROLE verified
6. **Admin Transfer** — deployer -> multisig (renounces deployer admin)
7. **Smoke Tests** — 19/19 (CIRCUIT_ID + splitter + BelieverRound + ZKVerifier)
8. **Health Checks** — on-chain code verification + ThetaScan API (19/19)
9. **Manifest** — JSON output + campaign summary

**Believer Round Monitoring (v2.1):**

```bash
# One-shot status check
node believer/monitoring-script.cjs

# Continuous polling with rich Discord embeds
node believer/monitoring-script.cjs --watch --webhook https://discord.com/api/webhooks/...

# Export CSV for spreadsheet analysis
node believer/monitoring-script.cjs --csv

# From specific manifest
node believer/monitoring-script.cjs --manifest deploy/manifests/mainnet-*.json
```

**New monitoring features:**
- Circuit-level health breakdown (16 circuits individually checked)
- Discord rich embed webhooks (color-coded: green = all healthy, amber = issues)
- CSV export for external reporting
- WirelessDePIN (Helium/XNET) coverage metrics
- UplinkCircuit (Uplink/Althea) bandwidth session metrics

---

### Governance (veXF)

Create and manage governance proposals:

```bash
# List all proposal templates
node governance/proposal-script.cjs --list

# Create circuit allocation vote (first proposal)
node governance/proposal-script.cjs --create allocation

# Create fee structure change
node governance/proposal-script.cjs --create fee

# Create treasury spend (audit)
node governance/proposal-script.cjs --create treasury

# Simulate full governance flow
node governance/proposal-script.cjs --simulate
```

**Proposal types:** CircuitPriority (10% quorum), LPAllocation, FeeStructure, TreasurySpend, EmergencyPause (67% supermajority).

**New:** `--create synergy` generates XFP-004: DePIN Synergy Incentive Activation (cross-circuit reward multipliers).

---

### Community Expansion

```bash
# Generate X AMA content package
node community/ama-script.cjs --generate ama

# Generate mainnet launch event content
node community/ama-script.cjs --generate launch

# Show community stats
node community/ama-script.cjs --stats
```

---

### Funding Monitor

```bash
# One-shot funding status
node funding/monitoring-bot.cjs

# Continuous polling with Discord webhook
node funding/monitoring-bot.cjs --watch --webhook https://discord.com/api/webhooks/...

# Show milestone tracker
node funding/monitoring-bot.cjs --milestones

# Generate JSON report
node funding/monitoring-bot.cjs --report
```

---

### Circuit Onboarding

```bash
# List all 16 registered circuits
node iteration/add-circuit.cjs --list

# Validate all circuits (contract + handler + test = 16/16 PASS)
node iteration/add-circuit.cjs --validate

# Generate scaffold for a new circuit
node iteration/add-circuit.cjs --name NewCircuit --id new-circuit
```

---

### DePIN Synergy

Cross-circuit synergy analyzer for WirelessDePIN + MappingSensor + UplinkCircuit:

```bash
# Show regional coverage matrix (8 sample regions)
node iteration/synergy-script.cjs

# Simulate 100 cross-circuit events
node iteration/synergy-script.cjs --simulate

# Show incentive tier model (FULL/PARTIAL/FRONTIER/DEAD)
node iteration/synergy-script.cjs --incentives

# Generate JSON synergy report
node iteration/synergy-script.cjs --report
```

**Synergy tiers:** FULL (3/3 circuits, 1.0x), PARTIAL (2/3, 1.5x), FRONTIER (1/3, 3.0x), DEAD (0/3, 5.0x).

**Governance:** XFP-004 activates cross-circuit reward multipliers via veXF vote.

---

### Gas Optimization

Run the gas profiler to measure and validate gas budgets:

```bash
# Run profiler (outputs JSON report)
npx hardhat run polish/gas-opts.cjs

# View latest report
ls polish/gas-report-*.json
```

**Measured gas budgets:**

| Operation | Gas | Target | Status |
|-----------|-----|--------|--------|
| TAO submitTask | ~287K | — | Profiled |
| Solana registerProvider | ~194K | — | Profiled |
| BelieverRound.commit | ~123K | 130K | PASS |
| BelieverRound.closeRound | ~74K | — | Profiled |
| Total deployment (14 contracts) | ~31M | — | Profiled |

---

### Testnet Dashboard

A browser-based monitoring UI at `dashboard/index.html`.

**URL:** `file:///path/to/xfuel-protocol/dashboard/index.html`
or serve via `npx serve dashboard -l 3000` then visit `http://localhost:3000`.

**Features:**
- Load deployment manifests (JSON) to see all contract addresses and LIVE/NO CODE status
- RPC connection with configurable endpoint (defaults to Theta Testnet)
- **Live Activity feed** — polls `eth_getLogs` every 4s for TaskRouted, ProofVerified, FeeSent events
- **Event Listener controls** — Start / Stop / one-click Restart button
- Gas profile visualization with budget bars (deployment + operation)
- Believer Round status tracking (Open / Closed / TGE)
- Smoke test pass/fail summary from the deployment manifest
- System log with timestamped entries (max 200 lines)

**Dashboard workflow:**
1. Open `dashboard/index.html` in any browser
2. Set the RPC endpoint (or keep Theta Testnet default)
3. Click "Manifest" file input and load `deploy/manifests/testnet-*.json`
4. Click **Start Listener** to begin polling for live events
5. Use **Restart** to reset the listener if the RPC endpoint changes

---

### Funding & Grant Materials

All 3 grant templates are **submit-ready** with full traction data (315+ tests, 20 contracts, 16 circuits):

| Document | Purpose | Location | Status |
|----------|---------|----------|--------|
| Exec Summary | 1-2 page investor overview | `exec-summary.md` | Ready |
| Pitch Deck | 12-15 slide skeleton | `pitch-deck.md` | Ready |
| Believer Guide | On-chain vesting + activation + grants | `believer-guide.md` | **Updated** |
| Solana Grant | Solana Foundation template ($150-250K) | `grant-templates/solana-grant.md` | **Submit-ready** |
| TAO Grant | OpenTensor template ($150-200K) | `grant-templates/tao-grant.md` | **Submit-ready** |
| General Grant | Customizable ecosystem template ($50-300K) | `grant-templates/general-grant.md` | **Submit-ready** |
| Grant Tracker | Submission status + next actions | `grant-templates/grant-tracker.cjs` | **Active** |
| **Submission Script** | Auto-fill from deployment manifests | `grant/submission-script.cjs` | **NEW** |

```bash
# Track grant submission status
node grant-templates/grant-tracker.cjs

# Generate all grant submission packages (JSON + markdown)
node grant/submission-script.cjs --all

# Generate specific program submission
node grant/submission-script.cjs --program solana
node grant/submission-script.cjs --program tao
node grant/submission-script.cjs --program general

# Show submission status
node grant/submission-script.cjs --status
```

---

## Development Setup

### Prerequisites
- Node.js 20+ and npm 10+
- For CosmWasm: Rust toolchain + wasm32 target
- For contracts: Hardhat

### Frontend (Main Bridge UI — Vite + React)

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

### Frontend (AI DePIN Dashboard — React 18 + MUI)

A separate React 18 dashboard for dev/testing the AI DePIN M2M API (Phase E).  
**Not for production A2A traffic** — production agents use the REST API directly.

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (default: http://localhost:3000)
npm start

# Build for production
npm run build
```

**Environment Variables** (create `frontend/.env` from `frontend/.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_API_URL` | `http://localhost:3002` | M2M API server base URL |
| `REACT_APP_API_KEY` | (none) | API key for `X-API-Key` auth header |
| `REACT_APP_POLL_INTERVAL` | `5000` | Status polling interval (ms) |
| `REACT_APP_WS_URL` | (none) | WebSocket URL (optional, falls back to polling) |

**Dashboard Components:**

| Component | Description |
|-----------|-------------|
| **TaskSimulator** | Submit AI intents (INFERENCE_REQUEST, COMPUTE_BID, etc.) to Akash/TAO/Osmosis with fee preview |
| **A2ASender** | Send ZK-verifiable A2A messages with escrow rules per message type |
| **StatusPoller** | Query task/message status with real-time auto-polling for ProofOutcome updates |
| **FeeVisualizer** | Charts/tables for fee breakdowns, revenue split (30/30/25/15), AI vs bridge comparisons |
| **HealthMonitor** | Live server health, uptime, fee config, chains, message types, AI listener metrics |

**Deployment Notes:**
- Run the M2M API backend first: `cd backend/theta-bridge && npm run m2m-server`
- Dashboard is maintenance-mode UI; modular for easy Phase E upgrades
- Pivoted from Persistence to Osmosis/Akash direct — chain selector includes all 5 chains
- All fee calculations mirror `server.js` / `main.rs` / `AIDePINRouter.sol`

> **Warning:** This dashboard is for development and testing only. Do NOT expose to end users for production A2A traffic. Production M2M integrations should use the REST API (`POST /task-request`, `POST /a2a-message`, etc.) with proper API key or ECDSA relayer authentication.

**More Setup Guides:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Complete development environment
- [Backend Setup](backend/theta-bridge/README.md) - Backend service configuration

### Smart Contracts (Theta)

```bash
# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to Theta Mainnet
./scripts/deploy-mainnet.sh
```

### CosmWasm Contracts (Persistence)

```bash
# Build ibcTFUEL minter (with burn_for_unwrap)
cd cosmwasm-contracts/persistence-minter
cargo build --release --target wasm32-unknown-unknown

# Build FeeCollector
cd cosmwasm-contracts/fee-collector
cargo build --release --target wasm32-unknown-unknown

# Optimize WASM (production)
docker run --rm -v "$(pwd)":/code \
  --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
  cosmwasm/optimizer:0.15.0
```

### Backend Service

```bash
cd backend/theta-bridge

# Install dependencies
npm install

# Start in development mode
npm run dev

# Start with AI Listener enabled (Osmosis/Akash IBC monitoring)
npm run ai-listener

# Start the M2M API server (AI DePIN REST endpoints on port 3002)
npm run m2m-server

# Start with PM2 (production)
pm2 start ecosystem.config.cjs
```

#### AI Listener (`npm run ai-listener`)

Starts the backend with the **AI DePIN Bridge** listener enabled (Phase E). This module monitors Osmosis and Akash chains via IBC WebSocket connections for AI-related intent events:

- **Osmosis**: Pool swaps involving ibcTFUEL, AI intent IBC messages (`COMPUTE_BID`, `INFERENCE_REQUEST`)
- **Akash**: GPU bid acceptance, lease creation, compute delivery attestation via IBC
- **Fee Collection**: 0.5% of AI task settlement value collected on completion, routed to `FeeCollector.wasm`
- **SP1 Proofs**: Generates ZK proofs for each completed AI task settlement for cross-chain verification
- **Theta Edge Routing**: Routes inference requests and compute bids to Theta Edge Cloud for execution

Configure via environment variables (see `backend/theta-bridge/env.example`):
```bash
AI_LISTENER_ENABLED=true
OSMOSIS_WS_URL=wss://rpc.osmosis.zone/websocket
AKASH_WS_URL=wss://rpc.akash.forbole.com/websocket
THETA_EDGE_URL=http://localhost:8090       # Theta Edge Cloud inference endpoint
OSMOSIS_FEE_COLLECTOR_CONTRACT=osmo1...    # FeeCollector.wasm address on Osmosis
```

### Fee Analytics Script

A standalone Node.js script for monitoring protocol revenue across all fee streams (AI tasks, A2A relay, bridge fees, LP swaps). Simulates the 30/30/25/15 revenue split, tracks volume mix (60% AI / 25% data / 15% settlements), and exports metrics for Prometheus or the FeeVisualizer frontend component.

```bash
cd backend/theta-bridge

# Basic usage — console output with simulated revenue
node src/fee-analytics.js --simulate --volume 2000000

# Filter by chain and period
node src/fee-analytics.js --chain osmosis --period 24h

# JSON output (pipe to FeeVisualizer or save to file)
node src/fee-analytics.js --format json --output analytics.json

# Prometheus metrics server (Grafana-compatible)
node src/fee-analytics.js --format prometheus --watch --port 9100

# Generate FeeVisualizer chart data
node src/fee-analytics.js --charts --output fee-charts.json

# Watch mode (auto-refresh every 60s)
node src/fee-analytics.js --watch --interval 60
```

#### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--chain <name>` | `all` | Filter: `osmosis`, `akash`, `theta`, `bittensor`, `persistence`, `all` |
| `--period <span>` | `24h` | Time period: `1h`, `6h`, `24h`, `7d`, `30d` |
| `--format <fmt>` | `console` | Output format: `console`, `json`, `prometheus` |
| `--port <n>` | `9100` | Prometheus metrics server port |
| `--simulate` | off | Run revenue simulation (no live backend needed) |
| `--volume <n>` | `2000000` | Simulated monthly volume in USD |
| `--ai-share <0-1>` | `0.6` | AI task share of total volume (default 60%) |
| `--charts` | off | Output Recharts-compatible data for FeeVisualizer |
| `--output <file>` | (stdout) | Write output to file |
| `--watch` | off | Continuously poll and update metrics |
| `--interval <s>` | `60` | Watch poll interval in seconds |

#### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `M2M_API_URL` | `http://localhost:3002` | Backend M2M API URL (server.js) |
| `M2M_API_KEY` | (none) | API key for authenticated endpoints |
| `OSMOSIS_LCD_URL` | `https://lcd.osmosis.zone` | Osmosis LCD endpoint for FeeCollector queries |
| `FEE_COLLECTOR_ADDR` | (none) | FeeCollector.wasm contract address on Osmosis |
| `PROM_PORT` | `9100` | Prometheus metrics server port |

#### Integration Points

| Integration | How |
|-------------|-----|
| **FeeCollector.wasm** | Queries on-chain `accumulated_fees`, `total_burned`, `ready_to_burn` via CW20 smart query |
| **server.js** | Fetches `/health` metrics (AI listener stats, task counts, fee config) |
| **api.js / utils** | Uses `calculateTaskFee()` (shared with frontend, server.js, main.rs) |
| **FeeVisualizer** | `--charts` flag outputs Recharts-compatible JSON for revenue split pie, scenario bar, BPS table |
| **Prometheus/Grafana** | `--format prometheus --watch` serves `/metrics` endpoint on configurable port |

#### Example Output (Simulated $2M/month)

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

---

### Mock Testing (Governance Prep)

For governance validation without live ZK proving, use MOCK_MODE:

```bash
# Clone and build WASM contracts
cd cosmwasm-contracts/persistence-minter
cargo build --release --target wasm32-unknown-unknown

# Instantiate with MOCK_MODE
persistenced tx wasm instantiate $CODE_ID \
  '{"name":"IBC Theta Fuel","symbol":"IBCTFUEL",...,"mock_mode":true}' \
  --from $ADMIN --chain-id core-1 --gas auto

# Run mock tests (skips ZK verification, logs "MOCK MINT")
npm run test:mock

# Backend mock mode (emits mock SP1 attributes)
export MOCK_MODE=true
npm run dev
```

**Mock Testing Documentation:**
- [Mock Testing Plan](MOCK_TESTING_PLAN.md) - Complete mock testing strategy
- [Mock Testing Complete](MOCK_TESTING_COMPLETE.md) - Results and findings

---

## 🚢 Deployment

### Frontend (Vercel)
```bash
npm run build
vercel --prod
```

### Contracts (Theta Mainnet)
```bash
# Set THETA_MAINNET_PRIVATE_KEY in .env.local
./scripts/deploy-mainnet.sh
```

### Backend (AWS/VPS)
```bash
cd backend/theta-bridge
pm2 start ecosystem.config.cjs
```

**Detailed Deployment Guides:**
- [Mainnet Deployment Script](MAINNET_DEPLOYMENT_SCRIPT.md) - Step-by-step mainnet deployment
- [Reverse Bridge Deployment Guide](REVERSE_BRIDGE_DEPLOYMENT_GUIDE.md) - Reverse bridge setup

---

## 📋 Production Guides (v5.0)

### Mainnet Deployment Steps

#### Phase D: Bridge Contracts (Q2-Q3 2026)

| Step | Contract | Chain | Command | Audit |
|------|----------|-------|---------|-------|
| 1 | VaultFactory.sol | Theta mainnet | `./scripts/deploy-mainnet.sh` | CertiK ✅ required |
| 2 | RevenueSplitter.sol | Theta mainnet | (included in deploy script) | CertiK ✅ required |
| 3 | ZKVerifier.wasm | **Osmosis mainnet** | `scripts/deploy-persistence.sh` (adapted for osmo-) | CertiK ✅ required |
| 4 | ibcTFUEL.wasm | **Osmosis mainnet** | `persistenced tx wasm store ...` (adapted for osmosisd) | CertiK ✅ required |
| 5 | FeeCollector.wasm | **Osmosis mainnet** | `osmosisd tx wasm store ...` | CertiK ✅ required |
| 6 | ZKVerifier.wasm | Persistence (compat) | `scripts/deploy-persistence.sh` | Existing audit |
| 7 | ibcTFUEL.wasm | Persistence (compat) | `persistenced tx wasm instantiate ...` | Existing audit |

#### Phase E: AI DePIN Contracts (Q3-Q4 2026)

**Theta Testnet → Mainnet for AIDePINRouter.sol:**
```bash
# 1. Deploy to testnet first (mock SP1 verifier)
npx hardhat run scripts/deploy-aidepin-router.js --network theta_testnet

# 2. Run full test suite against testnet
npx hardhat test --network theta_testnet

# 3. After testnet validation + CertiK Phase E audit:
npx hardhat run scripts/deploy-aidepin-router.js --network theta_mainnet

# 4. Grant RELAYER_ROLE to ai-listener.js production wallet
# (see AIDePINRouter Deployment Guide below for details)
```

**Theta Testnet → Mainnet for TAOWrapper.sol:**
```bash
# 1. Deploy to testnet (mock SP1 verifier, mock Substrate bridge)
npx hardhat run scripts/deploy-tao-wrapper.js --network theta_testnet

# 2. Validate wrap/unwrap, routeInference, A2A messaging
npx hardhat console --network theta_testnet

# 3. After testnet validation + CertiK Phase E audit:
npx hardhat run scripts/deploy-tao-wrapper.js --network theta_mainnet

# 4. Grant RELAYER_ROLE + BRIDGE_ROLE to backend wallets
```

**Osmosis Mainnet for AIVerifier.wasm:**
```bash
# 1. Build optimized WASM
cd cosmwasm-contracts/ai-verifier
docker run --rm -v "$(pwd)":/code cosmwasm/optimizer:0.15.0

# 2. Store code on Osmosis
osmosisd tx wasm store artifacts/ai_verifier.wasm \
  --from deployer --gas auto --gas-adjustment 1.3

# 3. Instantiate with production config
osmosisd tx wasm instantiate $CODE_ID \
  '{"admin":"osmo1...","fee_collector":"osmo1...","min_fee_bps":50,
    "max_fee_bps":100,"default_fee_bps":50,"a2a_relay_fee_bps":10,
    "min_task_amount":"10000","akash_ibc_channel":"channel-1",
    "mock_mode":false}' \
  --label "AIVerifier-v1" --from deployer --admin osmo1... --gas auto
```

> **AUDIT WARNING:** Do NOT deploy Phase E contracts to mainnet without CertiK Phase E audit completion. Use `mock_mode: true` and `SP1_VERIFIER_ADDRESS = 0x0` for all testnet deployments. Production SP1 verifier address required for mainnet.

### Integration Checklists

#### Backend Integration

| Check | File | Verification |
|-------|------|-------------|
| ✅ Forward listener operational | `listener.js` | Detects Theta deposits within 2s |
| ✅ Reverse listener operational | `persistence-listener.js` | Detects `burn_for_unwrap` events |
| ✅ AI listener operational | `ai-listener.js` | Detects Osmosis/Akash IBC AI intents |
| ✅ M2M API responding | `server.js` | `GET /health` returns 200 with metrics |
| ✅ SP1 prover reachable | `sp1-prover-client.js` | Proof generation in <15s |
| ✅ Fee analytics running | `fee-analytics.js` | `--watch` mode streaming metrics |
| ✅ Redis connected | ecosystem.config.cjs | Event queue persists across restarts |
| ✅ Kubernetes healthy | deployment.yaml | 3 replicas, auto-restart on failure |

#### API Integration

| Endpoint | Auth | Test Command |
|----------|------|-------------|
| `GET /health` | None | `curl http://localhost:3002/health` |
| `POST /task-request` | API Key | `curl -X POST -H "X-API-Key: $KEY" -d '{"message_type":"inference_request",...}'` |
| `POST /a2a-message` | API Key | `curl -X POST -H "X-API-Key: $KEY" -d '{"message_type":"compute_bid",...}'` |
| `GET /task-status` | API Key | `curl -H "X-API-Key: $KEY" "/task-status?task_id=..."` |
| `GET /prove-result` | API Key | `curl -H "X-API-Key: $KEY" "/prove-result?task_id=..."` |

#### Frontend Integration

| Check | Component | Verification |
|-------|-----------|-------------|
| ✅ Bridge UI connected | `src/App.tsx` | Deposits show QR code + vault address |
| ✅ AI Dashboard connected | `frontend/src/App.js` | TaskSimulator submits to M2M API |
| ✅ Fee charts rendering | `frontend/src/components/FeeVisualizer.js` | Pie/bar/table render with live data |
| ✅ Status polling active | `frontend/src/components/StatusPoller.js` | Auto-refresh shows ProofOutcome |
| ✅ Health monitor green | `frontend/src/components/HealthMonitor.js` | Server uptime + fee config visible |

#### Analytics Integration

| Check | Tool | Verification |
|-------|------|-------------|
| ✅ Prometheus metrics | `fee-analytics.js --format prometheus` | `/metrics` endpoint serving on port 9100 |
| ✅ Grafana dashboards | Grafana + Prometheus | Revenue split, volume mix, TVL milestone charts |
| ✅ FeeCollector state | `fee-analytics.js --chain osmosis` | On-chain `accumulated_fees` query working |
| ✅ Volume mix tracking | `fee-analytics.js --simulate` | 60/25/15 AI/data/settlements ratio tracked |
| ✅ FeeVisualizer data | `fee-analytics.js --charts` | JSON output compatible with Recharts |

### Fee Monitoring with fee-analytics.js

The `backend/theta-bridge/src/fee-analytics.js` script is the primary revenue monitoring tool. It tracks all five fee streams and exports data for Prometheus/Grafana and the FeeVisualizer frontend.

**Quick start (production monitoring):**
```bash
cd backend/theta-bridge

# Live monitoring with Prometheus export
M2M_API_URL=http://localhost:3002 \
OSMOSIS_LCD_URL=https://lcd.osmosis.zone \
FEE_COLLECTOR_ADDR=osmo1... \
node src/fee-analytics.js --format prometheus --watch --port 9100

# One-shot revenue report
node src/fee-analytics.js --chain all --period 24h --format json --output daily-report.json

# Generate FeeVisualizer chart data
node src/fee-analytics.js --charts --output fee-charts.json
```

**Key metrics tracked:**
- Volume mix: AI tasks (60% target) vs data/comms (25%) vs settlements (15%)
- Per-stream fees: AI task (0.5-1%), A2A relay (0.1%), bridge (0.5%)
- 30/30/25/15 split allocation: BBB burns, LP reinvestment, veXF yield, Treasury
- FeeCollector.wasm on-chain state: accumulated, burned, ready-to-burn
- TVL milestone progress: $5M (Phase D) → $20M (Phase E) → $100M+ (Phase F)

See [Whitepaper v5.0 Section 8.4](WHITEPAPER_v4.4.md#84-revenue-monitoring-fee-analyticsjs) for detailed integration documentation.

---

## 🤖 AIDePINRouter Deployment Guide (Theta Testnet)

Deploy the `AIDePINRouter.sol` contract on Theta testnet for Phase E AI DePIN Bridge testing. This contract routes AI task intents (inference, compute bids, A2A messaging) across Osmosis, Akash, and Bittensor, verifies SP1 ZK proofs, and collects 0.5-1% fees to the RevenueSplitter (30/30/25/15 split).

### Prerequisites

- Node.js 20+ and npm 10+
- Hardhat installed (`npx hardhat --version`)
- OpenZeppelin Contracts (`npm install @openzeppelin/contracts`)
- A funded Theta testnet wallet (get test TFUEL from [Theta Faucet](https://faucet.thetatoken.org/))

### Step 1: Environment Variables

Create or update `.env.local` in the project root with the following:

```bash
# ── Theta Testnet Configuration ──────────────────────────────────────
THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc
THETA_TESTNET_CHAIN_ID=365
THETA_TESTNET_PRIVATE_KEY=<your-deployer-private-key>

# ── Deployed Contract Addresses (update after each deploy) ───────────
REVENUE_SPLITTER_ADDRESS=<RevenueSplitter-address-on-testnet>
SP1_VERIFIER_ADDRESS=0x0000000000000000000000000000000000000000  # Set to zero for mock mode

# ── Osmosis / Akash / TAO Endpoints (for ai-listener.js) ─────────────
OSMOSIS_RPC_URL=https://rpc.testnet.osmosis.zone
OSMOSIS_WS_URL=wss://rpc.testnet.osmosis.zone/websocket
AKASH_RPC_URL=https://rpc.testnet.akash.network
AKASH_WS_URL=wss://rpc.testnet.akash.network/websocket
TAO_EVM_RPC_URL=https://lite.chain.opentensor.ai/evm     # Bittensor EVM endpoint
THETA_EDGE_URL=http://localhost:8090                       # Theta Edge Cloud inference

# ── AI Listener Configuration ────────────────────────────────────────
AI_LISTENER_ENABLED=true
AI_TASK_FEE_BPS=50                          # Default 0.5% fee
OSMOSIS_FEE_COLLECTOR_CONTRACT=osmo1...     # FeeCollector.wasm on Osmosis (when deployed)
```

### Step 2: Compile the Contract

```bash
npx hardhat compile
```

Verify that `contracts/AIDePINRouter.sol` compiles without errors alongside the existing contracts.

### Step 3: Deploy to Theta Testnet

Create a deployment script or use Hardhat's deploy task:

```bash
npx hardhat run scripts/deploy-aidepin-router.js --network theta_testnet
```

Example deployment script (`scripts/deploy-aidepin-router.js`):

```javascript
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying AIDePINRouter with:", deployer.address);

  const revenueSplitter = process.env.REVENUE_SPLITTER_ADDRESS;
  const sp1Verifier = process.env.SP1_VERIFIER_ADDRESS || ethers.ZeroAddress;

  const Router = await ethers.getContractFactory("AIDePINRouter");
  const router = await Router.deploy(deployer.address, revenueSplitter, sp1Verifier);
  await router.waitForDeployment();

  const address = await router.getAddress();
  console.log("AIDePINRouter deployed to:", address);

  // Grant RELAYER_ROLE to the AI listener backend wallet
  // const relayerAddress = process.env.AI_LISTENER_RELAYER_ADDRESS;
  // if (relayerAddress) {
  //   const RELAYER_ROLE = await router.RELAYER_ROLE();
  //   await router.grantRole(RELAYER_ROLE, relayerAddress);
  //   console.log("RELAYER_ROLE granted to:", relayerAddress);
  // }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

### Step 4: Verify Deployment

```bash
# Check contract is responsive
npx hardhat console --network theta_testnet

# In the console:
const router = await ethers.getContractAt("AIDePINRouter", "<deployed-address>");
const stats = await router.getStats();
console.log("Stats:", stats);
```

### Step 5: Configure ai-listener.js

Update `backend/theta-bridge/.env` with the deployed contract address:

```bash
AIDEPIN_ROUTER_ADDRESS=<deployed-address>
AI_LISTENER_ENABLED=true
```

The ai-listener.js backend monitors `TaskRouted` events from the AIDePINRouter, routes tasks to Theta Edge Cloud / Akash / TAO, and calls `settleTask()` with SP1 proof artifacts after completion.

### Step 6: Post-Deployment Checklist

| Step | Action | Status |
|------|--------|--------|
| 1 | Deploy AIDePINRouter to Theta testnet | ⬜ |
| 2 | Set `SP1_VERIFIER_ADDRESS` to `0x0` (mock mode) or real verifier | ⬜ |
| 3 | Grant `RELAYER_ROLE` to ai-listener.js backend wallet | ⬜ |
| 4 | Deploy RevenueSplitter on testnet (if not already deployed) | ⬜ |
| 5 | Configure environment vars for Osmosis/Akash/TAO endpoints | ⬜ |
| 6 | Start ai-listener.js with `AI_LISTENER_ENABLED=true` | ⬜ |
| 7 | Test `routeInference()` with small TFUEL amount | ⬜ |
| 8 | Verify `TaskRouted` event emitted and detected by backend | ⬜ |
| 9 | Test `settleTask()` with mock SP1 proof (verifier = 0x0) | ⬜ |
| 10 | Verify fees forwarded to RevenueSplitter | ⬜ |
| 11 | Test A2A messaging: `registerAgent()` → `sendA2AMessage()` | ⬜ |
| 12 | Deploy SP1 verifier and switch from mock mode | ⬜ |

### Network Configuration (hardhat.config.js)

Add the Theta testnet network if not already present:

```javascript
// In hardhat.config.js
module.exports = {
  networks: {
    theta_testnet: {
      url: process.env.THETA_TESTNET_RPC || "https://eth-rpc-api-testnet.thetatoken.org/rpc",
      chainId: 365,
      accounts: process.env.THETA_TESTNET_PRIVATE_KEY
        ? [process.env.THETA_TESTNET_PRIVATE_KEY]
        : [],
    },
    theta_mainnet: {
      url: "https://eth-rpc-api.thetatoken.org/rpc",
      chainId: 361,
      accounts: process.env.THETA_MAINNET_PRIVATE_KEY
        ? [process.env.THETA_MAINNET_PRIVATE_KEY]
        : [],
    },
  },
};
```

---

## 🔗 TAO Integration (Bittensor EVM Wrapper)

XFuel's **TAOWrapper.sol** provides a vTAO ERC-20 wrapper for Bittensor TAO, enabling EVM-based liquidity and Substrate-EVM bridge calls for AI subnet inference, staking, and delegation — all with ZK-verified settlement and protocol fee capture.

### Overview

| Feature | Description |
|---------|-------------|
| **vTAO Token** | 1:1 ERC-20 wrapper for native TAO — wrap/unwrap with no fee |
| **Subnet Inference** | Route ML inference to specific Bittensor subnets (e.g., subnet 1=text, 3=scraping, 18=cortex) |
| **Compute Bids** | Submit GPU compute requests to TAO subnets with ZK-verified escrow |
| **0.5-1% Task Fees** | Configurable fee on AI task routing (50-100 BPS) → RevenueSplitter (30/30/25/15) |
| **Substrate Bridge** | Submit EVM→Substrate calls: stake, unstake, delegate, register on subnets |
| **A2A Messaging** | Agent-to-agent ZK-verifiable messaging across Theta, Osmosis, Akash, and TAO |
| **SP1 ZK Proofs** | All settlements verified by SP1 prover with `ChainId::Bittensor` + `tao_evm_target` |

### Architecture

```
┌──────────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────────────┐
│  BITTENSOR   │    │  TAOWrapper  │    │  AIDePINRouter │    │  OSMOSIS /   │
│  SUBSTRATE   │◄──▶│  (vTAO)      │◄──▶│  (Theta EVM)   │◄──▶│  AKASH IBC   │
│  (subnets)   │    │  ERC-20      │    │  0.5-1% fees   │    │  (settlement)│
└──────────────┘    └──────────────┘    └────────────────┘    └──────────────┘
       │                    │                    │                    │
  subnet inference     wrap/unwrap TAO     ZK SP1 proofs        Osmosis yields
  staking/delegation   EVM liquidity       A2A messaging        AI yield pools
```

### Fee Structure

All AI task routing (inference, compute bids, result attestation) through the TAO wrapper collects a **0.5-1% protocol fee** that feeds into the unchanged **30/30/25/15 RevenueSplitter**:

| Split | Recipient | Percentage |
|-------|-----------|------------|
| BBB | Buyback-Burn | 30% |
| LP | Liquidity Provision | 30% |
| veXF | Staker Rewards | 25% |
| Treasury | Protocol Treasury | 15% |

- **Wrapping/unwrapping** TAO ↔ vTAO has **no fee** (pure 1:1 peg)
- **A2A relay fee**: 0.1% on escrowed amounts
- Fee forwarding threshold: 0.1 TAO (auto-forwards to RevenueSplitter when reached)

### Setup & Deployment (Theta Testnet)

#### Prerequisites

- Node.js 20+ and npm 10+
- Hardhat installed (`npx hardhat --version`)
- OpenZeppelin Contracts (`npm install @openzeppelin/contracts`)
- A funded Theta testnet wallet ([Theta Faucet](https://faucet.thetatoken.org/))

#### Step 1: Environment Variables

Add to `.env.local`:

```bash
# ── TAO Wrapper Configuration ────────────────────────────────────────
THETA_TESTNET_RPC=https://eth-rpc-api-testnet.thetatoken.org/rpc
THETA_TESTNET_CHAIN_ID=365
THETA_TESTNET_PRIVATE_KEY=<your-deployer-private-key>

# ── Deployed Addresses (update after deploy) ─────────────────────────
REVENUE_SPLITTER_ADDRESS=<RevenueSplitter-address-on-testnet>
AIDEPIN_ROUTER_ADDRESS=<AIDePINRouter-address-on-testnet>
SP1_VERIFIER_ADDRESS=0x0000000000000000000000000000000000000000  # Mock mode

# ── Bittensor / TAO Endpoints ────────────────────────────────────────
TAO_EVM_RPC_URL=https://lite.chain.opentensor.ai/evm
TAO_SUBSTRATE_WS=wss://entrypoint-finney.opentensor.ai:443
```

#### Step 2: Compile

```bash
npx hardhat compile
```

#### Step 3: Deploy

```bash
npx hardhat run scripts/deploy-tao-wrapper.js --network theta_testnet
```

Example deployment script (`scripts/deploy-tao-wrapper.js`):

```javascript
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying TAOWrapper with:", deployer.address);

  const revenueSplitter = process.env.REVENUE_SPLITTER_ADDRESS;
  const aidepinRouter = process.env.AIDEPIN_ROUTER_ADDRESS || ethers.ZeroAddress;
  const sp1Verifier = process.env.SP1_VERIFIER_ADDRESS || ethers.ZeroAddress;

  const TAOWrapper = await ethers.getContractFactory("TAOWrapper");
  const wrapper = await TAOWrapper.deploy(
    deployer.address,
    aidepinRouter,
    revenueSplitter,
    sp1Verifier
  );
  await wrapper.waitForDeployment();

  const address = await wrapper.getAddress();
  console.log("TAOWrapper deployed to:", address);
  console.log("vTAO token name:", await wrapper.name());
  console.log("vTAO token symbol:", await wrapper.symbol());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

#### Step 4: Verify & Test

```bash
# In Hardhat console
npx hardhat console --network theta_testnet

const wrapper = await ethers.getContractAt("TAOWrapper", "<deployed-address>");

# Wrap TAO → vTAO
await wrapper.wrap({ value: ethers.parseEther("0.1") });

# Check balance
const balance = await wrapper.balanceOf(deployer.address);
console.log("vTAO balance:", ethers.formatEther(balance));

# Route inference to subnet 1
const taskId = ethers.keccak256(ethers.toUtf8Bytes("test-task-1"));
const modelId = ethers.keccak256(ethers.toUtf8Bytes("llama-3"));
const inputHash = ethers.keccak256(ethers.toUtf8Bytes("test-input"));
await wrapper.routeInference(taskId, 1, modelId, inputHash, { value: 100000 });

# Check stats
const stats = await wrapper.getStats();
console.log("Stats:", stats);

# Check peg health
const peg = await wrapper.getPegAudit();
console.log("Peg healthy:", peg.isPegHealthy);
```

#### Step 5: Post-Deployment Checklist

| Step | Action | Status |
|------|--------|--------|
| 1 | Deploy TAOWrapper to Theta testnet | ⬜ |
| 2 | Set `SP1_VERIFIER_ADDRESS` to `0x0` (mock mode) or real verifier | ⬜ |
| 3 | Grant `RELAYER_ROLE` to ai-listener.js backend wallet | ⬜ |
| 4 | Grant `BRIDGE_ROLE` to Substrate bridge operator wallet | ⬜ |
| 5 | Deploy RevenueSplitter on testnet (if not already) | ⬜ |
| 6 | Deploy AIDePINRouter and link via `setAIDePINRouter()` | ⬜ |
| 7 | Test `wrap()` / `unwrap()` with small TAO amounts | ⬜ |
| 8 | Test `routeInference()` with subnet 1 (text inference) | ⬜ |
| 9 | Verify `SubnetInferenceRouted` event emitted and detected by backend | ⬜ |
| 10 | Test `settleTask()` with mock SP1 proof (verifier = 0x0) | ⬜ |
| 11 | Verify fees forwarded to RevenueSplitter (30/30/25/15) | ⬜ |
| 12 | Test A2A messaging: `registerAgent()` → `sendA2AMessage()` | ⬜ |
| 13 | Test Substrate bridge: `submitSubstrateBridgeCall()` → `confirmSubstrateBridgeCall()` | ⬜ |
| 14 | Check peg audit: `getPegAudit()` returns healthy | ⬜ |

### Compatibility Matrix

| Component | TAOWrapper Sync Point | Status |
|-----------|----------------------|--------|
| `AIDePINRouter.sol` | `routeInference()` with `ChainId.Bittensor`, `MessageType` / `ProofOutcome` enums | ✅ Synced |
| `sp1-prover/main.rs` | `validate_ai_task()` with `ChainId::Bittensor`, `tao_evm_target`, `calculate_task_fee()` | ✅ Synced |
| `AIVerifier.wasm` | `RouteTask` with `ChainId::Bittensor`, fee collection via `SettleTask` | ✅ Synced |
| `ai-listener.js` | Monitors `SubnetInferenceRouted` events, routes to TAO subnets, calls `settleTask()` | ✅ Synced |
| `RevenueSplitter.sol` | Receives forwarded fees for 30/30/25/15 distribution | ✅ Synced |

---

## 📡 API Docs — M2M AI DePIN Server

XFuel exposes a standalone **M2M (Machine-to-Machine) REST API** for programmatic access to the AI DePIN module. Agents, bots, and orchestrators use these endpoints to submit AI tasks, retrieve ZK settlement proofs, send A2A messages, and query task status — all with integrated 0.5-1% fee capture flowing to the RevenueSplitter (30/30/25/15).

### Quick Start

```bash
cd backend/theta-bridge

# Install dependencies
npm install

# Start the M2M API server (port 3002 by default)
npm run m2m-server

# Or with explicit port / auth keys
M2M_API_PORT=3002 M2M_API_KEYS=my-secret-key npm run m2m-server
```

### Authentication

All endpoints (except `GET /health`) require authentication via **one** of:

| Method | Header | Description |
|--------|--------|-------------|
| API Key | `X-API-Key: <key>` | Static key from `M2M_API_KEYS` env var (comma-separated list) |
| Relayer ECDSA | `X-Signature: <0x-sig>` + `X-Sig-Timestamp: <epoch>` | ECDSA over `method+path+sha256(body)+timestamp`; signer must be in `M2M_RELAYER_ADDRESSES` |

If neither `M2M_API_KEYS` nor `M2M_RELAYER_ADDRESSES` is set, the server runs in **open mode** (dev only — a warning is logged).

### Rate Limiting

Sliding-window rate limiter keyed by API key (or IP). Defaults: **120 requests / 60 s**. Configure with `M2M_RATE_WINDOW_MS` and `M2M_RATE_MAX_HITS`. A `429` response includes a `Retry-After` header.

---

### Endpoints

#### `POST /task-request` — Submit an AI Intent

Submit an AI task (compute bid, inference request, data attestation, etc.) for routing to Akash, Bittensor (TAO), Osmosis, or Theta Edge Cloud.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message_type` | string | Yes | One of: `compute_bid`, `compute_result`, `inference_request`, `capability_query`, `data_attestation` |
| `chain_id` | string | Yes | Destination: `theta`, `osmosis`, `akash`, `bittensor`, `persistence` |
| `amount` | string | Yes | Gross task value (must be ≥ 10000, dust protection) |
| `sender` | string | Yes | Sender address / agent identifier |
| `fee_bps` | number | No | Fee override (50–100 BPS). Default: 50 (0.5%) |
| `model_id` | string | Cond. | Required for `inference_request` — ML model hash |
| `input_hash` | string | Cond. | Required for `inference_request`, `data_attestation` |
| `output_hash` | string | Cond. | Required for `compute_result` |
| `subnet_id` | number | Cond. | Required for `bittensor` routing (TAO subnet UID) |
| `theta_recipient` | string | No | Theta EVM settlement address |
| `max_gpu_hours` | string | No | Akash GPU lease duration |
| `ibc_channel` | string | No | Explicit IBC channel override |
| `memo` | string | No | Free-form memo |

**Example — Route inference to Akash:**

```bash
curl -X POST http://localhost:3002/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-secret-key" \
  -d '{
    "message_type": "inference_request",
    "chain_id": "akash",
    "amount": "1000000",
    "sender": "0xYourAgentAddress",
    "model_id": "llama-3-70b",
    "input_hash": "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }'
```

**Example — Submit compute bid to Bittensor subnet 18 (Cortex):**

```bash
curl -X POST http://localhost:3002/task-request \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-secret-key" \
  -d '{
    "message_type": "compute_bid",
    "chain_id": "bittensor",
    "amount": "500000",
    "sender": "0xYourAgentAddress",
    "subnet_id": 18,
    "input_hash": "0x1111111111111111111111111111111111111111111111111111111111111111",
    "max_gpu_hours": "2"
  }'
```

**Response (202 Accepted):**

```json
{
  "task_id": "m2m-task-1-1739299200000",
  "status": "accepted",
  "message_type": "inference_request",
  "chain_id": "akash",
  "gross_amount": "1000000",
  "fee_amount": "5000",
  "net_amount": "995000",
  "fee_bps": 50,
  "fee_info": {
    "description": "0.5% protocol fee → RevenueSplitter (30% BBB / 30% LP / 25% veXF / 15% Treasury)",
    "collector": "FeeCollector.wasm → CW20 Send → RevenueSplitter"
  },
  "_links": {
    "status": "/task-status?task_id=m2m-task-1-1739299200000",
    "proof": "/prove-result?task_id=m2m-task-1-1739299200000"
  }
}
```

---

#### `GET /prove-result` — Retrieve ZK Settlement Proof

Fetch the SP1 ZK proof and fee breakdown for a completed task. Used by on-chain contracts (`AIDePINRouter.settleTask()`, `AIVerifier.wasm SettleTask`) to verify settlements.

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `task_id` | Yes | Task ID from `/task-request` response |

**Example:**

```bash
curl "http://localhost:3002/prove-result?task_id=m2m-task-1-1739299200000" \
  -H "X-API-Key: my-secret-key"
```

**Response (200 OK):**

```json
{
  "task_id": "m2m-task-1-1739299200000",
  "status": "fee_collected",
  "proof_outcome": "valid",
  "sp1_proof": {
    "proof": "0x...",
    "publicInputs": "0x...",
    "nullifier": "0xabc123...",
    "provingTimeMs": 9200,
    "timestamp": 1739299209200
  },
  "fee": {
    "gross_amount": "1000000",
    "fee_amount": "5000",
    "net_amount": "995000",
    "fee_bps": 50,
    "fee_collector": "osmo1...",
    "revenue_split": {
      "bbb_buyback_burn": "30%",
      "lp_provision": "30%",
      "vexf_stakers": "25%",
      "treasury": "15%"
    }
  },
  "result": { "provider": "theta-edge", "outputHash": "0x...", "inferenceTime": 1500 },
  "meta": {
    "source_chain": "akash",
    "source_tx": "api-abc-123",
    "block_height": 0,
    "completed_at": 1739299209000
  }
}
```

If the task is not yet settled, returns **409 Conflict** with the current status.

---

#### `POST /a2a-message` — Send an A2A (Agent-to-Agent) Message

Submit a ZK-verifiable A2A message with optional escrow. Integrates with `AIDePINRouter.sendA2AMessage()` on-chain and `validate_a2a_message()` in the SP1 prover.

**Request body (JSON):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message_type` | string | Yes | One of the five message types |
| `sender_chain` | string | Yes | Origin chain |
| `recipient_chain` | string | Yes | Destination chain |
| `payload_hash` | string | Yes | SHA-256 hex of message payload |
| `escrow_amount` | string | Cond. | Required non-zero for `compute_bid` and `inference_request`; must be zero for `capability_query` |
| `ttl` | number | Yes | Time-to-live in seconds (1–86400) |
| `sender_address` | string | Yes | Sender agent address |
| `sender_identity` | string | Yes | Agent identity commitment (Poseidon hash hex) |
| `recipient_address` | string | No | Recipient agent address |
| `ibc_channel` | string | Cond. | Required for cross-chain messages |

**Example — Cross-chain compute bid (Theta → Akash):**

```bash
curl -X POST http://localhost:3002/a2a-message \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-secret-key" \
  -d '{
    "message_type": "compute_bid",
    "sender_chain": "theta",
    "recipient_chain": "akash",
    "payload_hash": "0xdeadbeef12345678deadbeef12345678deadbeef12345678deadbeef12345678",
    "escrow_amount": "250000",
    "ttl": 3600,
    "sender_address": "0xYourAgentAddress",
    "sender_identity": "0xPoseidonCommitmentHash",
    "ibc_channel": "channel-42"
  }'
```

**Response (202 Accepted):**

```json
{
  "message_id": "a2a-550e8400-e29b-41d4-a716-446655440000",
  "status": "accepted",
  "message_type": "compute_bid",
  "sender_chain": "theta",
  "recipient_chain": "akash",
  "payload_hash": "0xdeadbeef...",
  "escrow_amount": "250000",
  "relay_fee": "25",
  "relay_fee_info": "0.1% on escrowed amount → RevenueSplitter (30/30/25/15)",
  "nonce": 1,
  "ttl": 3600,
  "timestamp": 1739299200,
  "_links": { "status": "/task-status?message_id=a2a-550e8400-..." }
}
```

---

#### `GET /task-status` — Query Task or A2A Message Status

Query status and `ProofOutcome` (Valid / Regenerable / Invalid) for tasks or A2A messages.

**Query parameters (one required):**

| Param | Description |
|-------|-------------|
| `task_id` | Query an AI task |
| `message_id` | Query an A2A message |

**Example:**

```bash
# Task status
curl "http://localhost:3002/task-status?task_id=m2m-task-1-1739299200000" \
  -H "X-API-Key: my-secret-key"

# A2A message status
curl "http://localhost:3002/task-status?message_id=a2a-550e8400-e29b-41d4-a716-446655440000" \
  -H "X-API-Key: my-secret-key"
```

**Response (task):**

```json
{
  "task_id": "m2m-task-1-1739299200000",
  "status": "completed",
  "proof_outcome": "valid",
  "message_type": "inference_request",
  "chain_id": "akash",
  "gross_amount": "1000000",
  "fee_amount": "5000",
  "net_amount": "995000",
  "fee_bps": 50,
  "result": { "provider": "theta-edge", "outputHash": "0x..." },
  "sp1_proof": { "has_proof": true, "nullifier": "0x...", "proving_time_ms": 9200 },
  "created_at": 1739299200000,
  "updated_at": 1739299209000
}
```

---

#### `GET /health` — Server Health

Returns server health, configuration, and aggregate AI listener metrics. **No authentication required.**

```bash
curl http://localhost:3002/health
```

---

### Fee Integration Notes

| Fee Type | Rate | Collected By | Flow |
|----------|------|-------------|------|
| AI task fee | 0.5–1% (50–100 BPS) | `FeeCollector.wasm` | CW20 Send → FeeCollector → Burn → SP1 FeeBurn proof → RevenueSplitter |
| A2A relay fee | 0.1% (10 BPS) on escrow | `AIDePINRouter.sol` | Pending fees → `forwardFees()` → RevenueSplitter |
| Bridge fee | 0.5% (50 BPS) | Existing flow | Forward/reverse bridge — unchanged |

**RevenueSplitter distribution (unchanged across all streams):**

| Split | Recipient | % |
|-------|-----------|---|
| BBB | Buyback-Burn | 30% |
| LP | Liquidity Provision | 30% |
| veXF | Staker Rewards | 25% |
| Treasury | Protocol Treasury | 15% |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `M2M_API_PORT` | `3002` | M2M API server port |
| `M2M_API_KEYS` | (none) | Comma-separated authorised API keys |
| `M2M_RELAYER_ADDRESSES` | (none) | Comma-separated relayer EVM addresses (checksummed) |
| `M2M_RATE_WINDOW_MS` | `60000` | Rate limit sliding window (ms) |
| `M2M_RATE_MAX_HITS` | `120` | Max requests per window |
| `AI_TASK_FEE_BPS` | `50` | Default task fee in basis points |
| `AI_LISTENER_ENABLED` | `true` | Required for task routing |

### Contract Sync Points

The M2M API maintains sync with on-chain and ZK contracts:

| Contract | Sync Point |
|----------|-----------|
| `AIDePINRouter.sol` | `MessageType` / `ChainId` / `ProofOutcome` enums, `routeInference()`, `settleTask()`, `sendA2AMessage()`, `calculateTaskFee()` |
| `TAOWrapper.sol` | `routeInference()` with `subnetId`, `ChainId.Bittensor` routing, A2A messaging via vTAO escrow |
| `AIVerifier.wasm` | `RouteTask` / `SettleTask` execute messages, CW20 fee sends to FeeCollector |
| `FeeCollector.wasm` | CW20 `Receive` hook for fee accumulation, `TriggerFeeBurn` for burn-to-RevenueSplitter flow |
| `sp1-prover/main.rs` | `validate_ai_task()` circuit (fee math, output hash, chain routing), `validate_a2a_message()` circuit (escrow, identity, TTL) |
| `RevenueSplitter.sol` | Receives forwarded fees for 30/30/25/15 distribution |

---

## 🎨 Design Philosophy

**Cyberpunk Neon Aesthetic** — Purple/cyan gradients, glassmorphism cards, neon glows, and a retro-futuristic vibe.

**Manual-First UX** — No wallet connect modals, no extension popups. Just QR codes and addresses for a universal, mobile-friendly experience.

**Trustless by Design** — ZK proofs > multisigs, transparent setup > trusted ceremonies, on-chain settlement > off-chain coordination.

---

## 📝 Contributing

We welcome contributions from the community! XFuel Protocol is open-source and thrives on developer collaboration.

**Focus Areas:**
- Frontend UI polish (cyberpunk neon theme enhancements)
- CosmWasm contract optimization (gas efficiency)
- SP1 proof optimization (faster proving times)
- Documentation improvements (tutorials, guides)
- Testing (unit tests, integration tests, E2E tests)

**Before Contributing:**
1. Read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines
2. Check [GitHub Issues](https://github.com/XFuel-Lab/xfuel-protocol/issues) for open tasks
3. Join our community discussions
4. Review the [Whitepaper v5.0](WHITEPAPER_v4.4.md) for technical context

**Development Workflow:**
```bash
# Fork the repo
git clone https://github.com/YOUR_USERNAME/xfuel-protocol.git

# Create feature branch
git checkout -b feature/your-feature-name

# Make changes, test locally
npm run test

# Commit with descriptive message
git commit -m "feat: add reverse bridge UI component"

# Push and create PR
git push origin feature/your-feature-name
```

**Contribution Recognition:**
- Contributors listed in project credits
- Active contributors invited to governance discussions
- Top contributors eligible for XF token rewards (post-mainnet)

---

## 📞 Community & Support

- **Website**: [xfuel.app](https://xfuel.app)
- **GitHub**: [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Documentation**: [docs/README.md](docs/README.md)
- **Whitepaper**: [WHITEPAPER_v4.4.md](WHITEPAPER_v4.4.md)
- **Security**: Report vulnerabilities to security@xfuel.app
- **Partnerships**: partnerships@xfuel.app
- **Governance**: [Persistence Forum](https://forum.persistence.one)

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

## 🔗 Quick Links

**📖 Documentation:**
- [Documentation Hub](docs/README.md) - All guides and docs
- [ZK Bridge Implementation](docs/ZK_BRIDGE_IMPLEMENTATION.md) - Technical details
- [Whitepaper v5.0](WHITEPAPER_v4.4.md) - Complete architecture + AI DePIN Bridge

**🔧 For Developers:**
- [Local Dev Setup](docs/guides/LOCAL_DEV_SETUP.md) - Development environment
- [Contributing Guide](CONTRIBUTING.md) - Contribution guidelines
- [Mock Testing Plan](MOCK_TESTING_PLAN.md) - Testing strategy

**🚀 For Operators:**
- [Production Guides](#-production-guides-v50) - Mainnet deploy steps, integration checklists, fee monitoring
- [Backend Deployment](backend/theta-bridge/README.md) - Backend service setup
- [SP1 Prover Deployment](sp1-prover/DEPLOY_ON_EDGECLOUD.md) - Prover infrastructure
- [Mainnet Deployment Script](MAINNET_DEPLOYMENT_SCRIPT.md) - Full deployment guide
- [Fee Analytics](backend/theta-bridge/src/fee-analytics.js) - Revenue monitoring with Prometheus/Grafana

**🏛️ For Governance:**
- [Persistence Whitelist Proposal](docs/governance/PERSISTENCE_WHITELIST_PROPOSAL.md) - Governance template
- [Roadmap](#-roadmap) - Project phases and milestones

---

Built with ⚡ by the XFUEL team.
