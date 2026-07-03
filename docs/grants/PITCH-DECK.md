# XFuel Protocol — Pitch Deck

**ZK-Verified Settlement for AI Compute Across Decentralized GPU Networks**

*Version 1.0 — April 2026*

---

## Slide 1: Cover

**XFuel Protocol**
*The Pumping Station for Decentralized AI*

> "Submit an AI task anywhere — XFuel routes it to the best GPU, proves delivery with a ZK proof, and settles payment on-chain with transparent fee splits."

- **Website:** [xfuel.app](https://xfuel.app)
- **GitHub:** [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Contact:** founderxfuel@gmail.com

---

## Slide 2: The Problem

**Decentralized AI compute is a $10B+ market — but the settlement layer is broken.**

Every decentralized GPU network (Theta, Bittensor, Akash, Render) operates as a silo:

### 1. No Proof of Delivery
Nodes claim they ran your inference, but there is no cryptographic receipt. Consumers pay and trust — there is no trustless verification that work was actually completed.

### 2. No Unified Settlement
Each network has its own token, fee model, and trust assumptions. Developers building AI agents or dApps must write a custom integration per provider, increasing cost and fragmentation.

### 3. No Transparent Economics
Fee flows are opaque. Operators cannot verify revenue is split fairly. Stakers cannot audit yield sources. Investors cannot see where protocol funds actually go.

**Result:** AI agents are locked into single providers, overpay for unverified compute, and cannot compose across DePIN networks. The "decentralized AI" stack has centralized trust at the settlement layer.

---

## Slide 3: The Solution

**XFuel is the ZK settlement and orchestration layer for AI compute.**

It sits between AI consumers (agents, dApps, enterprises) and GPU providers (Theta EdgeCloud, Bittensor, Akash, Render, and beyond).

### Architecture

```
Agent / dApp / Enterprise
          │
          ▼  M2M REST API + Webhooks
┌─────────────────────────┐
│       XFuel Core Layer  │
│  ┌─────────────────┐    │
│  │  ZKVerifierSP1  │ ◄──┼── SP1 Groth16 proof (~260 bytes, ~270K gas)
│  │  RevenueSplit   │    │   30% BBB · 30% Growth · 25% Stakers · 15% Ops
│  │  veXF Gov       │    │   Vote-escrowed governance
│  └─────────────────┘    │
└───────────┬─────────────┘
            │ Modular Circuits (21+ and growing)
            ├── Theta EdgeCloud     (Tier 1 — primary GPU backbone)
            ├── Bittensor EVM       (dTAO subnet integration)
            ├── Akash Network       (decentralized GPU marketplace)
            ├── Render Network      (image/LLM workloads)
            └── AWS Bedrock         (enterprise fallback)
```

### Key Properties

| Capability | Detail |
|------------|--------|
| **ZK Proof of delivery** | SP1 Groth16/PLONK — cryptographic receipt for every task |
| **6-tier routing** | Priority engine routes to cheapest/fastest available provider |
| **On-chain fee splits** | `CoreRevenueSplitter` — 30/30/25/15, publicly auditable |
| **Replay protection** | Nullifiers + per-sender nonces prevent proof reuse |
| **Modular circuits** | Independent plug-in modules, no shared state between providers |
| **Agent-native** | A2A communication, webhooks, MCP endpoints, swarm coordination |

---

## Slide 4: Technology

### ZK Proof Pipeline

1. Task intent submitted → fee tagged with `ProviderTag` (Theta, Akash, Bittensor, etc.)
2. SP1 prover (CUDA, dedicated GPU) generates Groth16 proof (~260 bytes)
3. `AITaskPublicValues` committed on-chain: task type, chains, amounts, output hash, timestamp, nonce
4. `ZKVerifierSP1.verifyProof()` called — ~270K gas
5. Nullifier stored → replay protection enforced
6. Fees distributed via `CoreRevenueSplitter.distribute()`

### Why SP1?

- **FRI-based STARKs** — no trusted setup ceremony
- **Groth16/PLONK wrapping** — succinct on-chain verification
- **zkVM** — any Rust computation is provable without custom circuits
- **Proof-system agnostic verifier** — ready for Interstellar / future upgrades

### Research Foundation

XFuel integrates and attributes two peer-reviewed research contributions:

| Integration | Source |
|-------------|--------|
| **zkGPT** (Phase 1) | [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184) — verifiable LLM inference |
| **Fair Exchange (PAS)** | [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395) — delegated payments for AI agents |
| **Interstellar** (research track) | [eprint.iacr.org/2025/1294](https://eprint.iacr.org/2025/1294) — 1.6–6.7x prover speedup for transformers |

---

## Slide 5: Product

### Live Today

| Product | Status |
|---------|--------|
| **xfuel.app** | Live — Believer/Angel round UIs, on-chain stats, wallet integration |
| **BelieverRound** | Live on Theta mainnet (361) — TFUEL commitments, lock bonuses, 180d refund |
| **AngelRound** | Live on Theta mainnet (361) — strategic round, pre-TGE treasury use |
| **AngelEscrow** | Live — immutable 3-bucket escrow (AUDIT / SUBCHAIN / DEVOPS), multisig gated |
| **M2M Task API** | Operational — `POST /task-request`, `GET /task-status`, webhook delivery |
| **SP1 Prover** | CUDA Docker image, health watchdog, auto-restart |

### Frontend Stack
React + TypeScript + Vite · Wagmi/Viem for on-chain reads · TanStack Query · Vercel deploy

### Contract Stack
Solidity 0.8.22 · OpenZeppelin · Hardhat · CosmWasm (IBC track)

---

## Slide 6: Traction

**All numbers represent completed, tested, deployed work — not roadmap.**

| Metric | Value |
|--------|-------|
| Smart contract modules | 21+ circuits |
| Automated tests | 700+ (unit + integration + security + fuzz) |
| Core statement coverage | **92.84%** |
| Core function coverage | **95.05%** |
| Phase 1 audit scope coverage | 5 contracts, ~2,800 LOC |
| Audit readiness checklist | **59/59 items complete** |
| Security tests | Reentrancy (5), access control (9), boundary (12), fuzz (32) |
| Deployment phases completed | 6 phases, testnet + mainnet |
| Smoke tests (post-deploy) | 17/17 passed |
| Settlement gas | <270K per Groth16 verification |
| Fuzz tests (corpus) | 32 tests, up to 500 ops per run |
| CosmWasm tests | 18/18 passing |

### Funding Infrastructure

| Signal | Detail |
|--------|--------|
| Believer Round (live) | TFUEL commitments + lock bonuses + on-chain refund |
| Angel Round (live) | Strategic pre-TGE round with transparent treasury |
| AngelEscrow (live) | Ring-fenced buckets: AUDIT, SUBCHAIN, DEVOPS — no discretionary spend |
| Multisig admin | Gnosis Safe on Theta mainnet |
| Bug bounty | Published — up to $50,000 Critical |

---

## Slide 7: Revenue Model

**Every AI task generates protocol fees (0.1–1%).**

All fees are collected and distributed automatically by `CoreRevenueSplitter`:

| Bucket | Share | Purpose |
|--------|-------|---------|
| **Buyback-Burn (BBB)** | 30% | Buy XF on open market + burn — deflationary pressure |
| **Growth & Expansion (GET)** | 30% | Machine incentives (50%) · LP boost (30%) · Agent grants (20%) |
| **veXF Staker Rewards** | 25% | Real yield to governance lockers every epoch |
| **Operations Treasury** | 15% | Audits, infrastructure, Fee-to-Stake validator routing |

### Projections (Steady-State)

| Monthly Volume | Avg Fee | Monthly Revenue | Annual Revenue |
|---------------|---------|-----------------|----------------|
| $2M | 0.5% | $10K | $120K |
| $10M | 0.5% | $50K | $600K |
| $50M | 0.5% | $250K | $3M |

*Volume target composition: 60% AI inference · 25% data/communications · 15% financial settlements*

---

## Slide 8: Tokenomics

**XF — 1,000,000,000 total supply (fixed)**

| Allocation | % | XF Amount | Vesting |
|-----------|---|-----------|---------|
| Community Round (Believers) | 15% | 150,000,000 | 90d cliff + 270d linear |
| Angel / Strategic | 10% | 100,000,000 | 90d cliff + 270d linear |
| Engagement Rewards | 15% | 150,000,000 | Merkle seasons, task-based |
| Ecosystem & Partnerships | 20% | 200,000,000 | Governance-approved spend |
| Team & Founders | 15% | 150,000,000 | 12mo cliff + 36mo linear |
| Protocol Treasury | 15% | 150,000,000 | DAO-controlled via veXF |
| Liquidity (LP seed) | 10% | 100,000,000 | Unlocked at TGE |

### Token Utility

| Utility | Mechanism |
|---------|-----------|
| **Governance** | Lock XF → veXF, vote on circuits, fees, treasury |
| **Yield** | 25% of all protocol fees to veXF holders |
| **Deflationary** | 30% of fees used for buyback-and-burn |
| **Access** | veXF weight gates proposal creation + stake route influence |

### Pricing (Community Round)
- **Believer base:** 5 XF per 1 TFUEL
- **Angel base:** 8 XF per 1 TFUEL
- **Lock bonuses:** +8% / +20% / +35% XF for 1 / 2 / 3 year lock tiers

---

## Slide 9: Market Opportunity

| Segment | 2026 Estimate | Growth |
|---------|--------------|--------|
| Total AI Compute Market | $150B+ | ~40% YoY |
| Decentralized AI / DePIN | $10B+ | ~80% YoY |
| Verifiable AI Settlement | **Greenfield** | XFuel is category creator |

### Why now

- AI agent proliferation (ChatGPT, Grok, Claude, open-source LLMs) is creating massive demand for programmatic, cost-efficient inference.
- DePIN GPU networks are scaling but lack a trust layer — operators and buyers need ZK receipts to settle fairly.
- Cross-chain AI tasks (run on Bittensor, settle on Theta, pay on Cosmos) are becoming real — there is no protocol that handles this end-to-end today.

**Even 0.1% capture of decentralized AI volume = $10M+ annual protocol revenue at current market scale.**

---

## Slide 10: Competitive Landscape

| | **XFuel** | Ritual | Giza | Modulus | Generic Bridges |
|--|-----------|--------|------|---------|-----------------|
| ZK proof of compute | **SP1 Groth16** | ONNX verify | Cairo | Plonky2 | No |
| Multi-DePIN routing | **6 providers** | Single | Single | Single | N/A |
| On-chain fee splits | **30/30/25/15** | No | No | No | No |
| Modular circuit architecture | **21+ circuits** | Monolithic | Monolithic | Monolithic | N/A |
| Funding on-chain | **Believer + Angel** | VC only | VC only | VC only | N/A |
| Open source | **MIT** | Partial | Partial | Partial | Varies |

**XFuel is the only protocol combining ZK-verified AI settlement + multi-DePIN routing + transparent on-chain economics + a modular circuit architecture.**

---

## Slide 11: Roadmap

| Phase | Timeline | Deliverables | Status |
|-------|----------|-------------|--------|
| **Build** | Q1 2026 | Core Layer + 21 circuits + 700 tests + funding contracts | ✅ Done |
| **Fund** | Q1–Q2 2026 | Believer/Angel rounds on mainnet, AngelEscrow | ✅ Live |
| **Audit** | Q2 2026 | Phase 1 audit — 5 core contracts (~2,800 LOC) | 🔄 Scoped |
| **Launch** | Q3 2026 | Mainnet full contracts, subchain, public metrics dashboard | 🗓 Planned |
| **Scale** | Q4 2026 | SDK, 3+ partner integrations, Phase 2 audit (bridges, TAO) | 🗓 Planned |
| **Govern** | Q1 2027 | veXF governance live, Fee-to-Stake, community proposals | 🗓 Planned |

### Phase 1 Audit Scope

| Contract | Lines | Risk |
|----------|-------|------|
| ZKVerifierSP1 | 620 | Critical |
| CoreRevenueSplitter | 1,067 | High |
| veXFGovernance | 320 | High |
| ThetaInferenceCircuit | 637 | High |
| SP1ProofHooks | 181 | Medium |

---

## Slide 12: Use of Funds

*Adapt dollar amounts to the specific grant program.*

| Use of Funds | % | Purpose |
|-------------|---|---------|
| Security audit (Phase 1) | 40% | Independent audit of core contracts before mainnet launch |
| Infrastructure | 25% | SP1 prover (CUDA), RPC redundancy, monitoring, subchain deploy |
| Engineering | 20% | Circuit expansion, SDK, developer tooling |
| Documentation & community | 10% | Integration guides, API docs, developer onboarding |
| Legal & operations | 5% | Entity, compliance review, terms of service |

### What these funds unlock

1. **Audited production contracts** — credibility required for institutional integration
2. **Public metrics dashboard** — real-time proof counts, fee flows, circuit activity
3. **Developer SDK** — `npm install xfuel-sdk` with TypeScript-first API
4. **3+ partner integrations** — first inference providers / consumers on mainnet

---

## Slide 13: Security & Trust

**Every major trust signal is already in place — this is not roadmap.**

| Signal | Status |
|--------|--------|
| Audit scope defined | CertiK Phase 1, 5 contracts, ~2,800 LOC |
| Audit readiness | **59/59 items complete** — [view checklist](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_GRANT_READINESS.md) |
| Test coverage | 92.84% statements, 95.05% functions (core) |
| Security test suite | Reentrancy (5), access control (9), boundary (12), fuzz (32) = **58 security tests** |
| Bug bounty | Published — up to $50K Critical — [bug-bounty.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/bug-bounty.md) |
| Responsible disclosure | founderxfuel@gmail.com + [GitHub Security Advisories](https://github.com/XFuel-Lab/xfuel-protocol/security) |
| Admin custody | Gnosis Safe multisig on mainnet |
| AngelEscrow | Immutable buckets — no discretionary fund movement |
| Open source | MIT license — all contracts, circuits, off-chain code |

---

## Slide 14: Team

### Founder

*[Add your name, photo, LinkedIn, and relevant background here.]*

**Execution track record (this project):**
- Designed and shipped 21 circuit modules and a full ZK settlement stack in under 6 months
- 700+ automated tests; all 6 development phases completed
- Funding infrastructure live on mainnet with on-chain escrow and transparency
- 59/59 audit readiness items completed; CertiK Phase 1 scoped and ready

**Building with AI-augmented development:**
- Primary stack: Cursor + Claude (code generation + review), Grok (architecture decisions)
- ~80% code AI-generated, refined through extensive testing and manual review
- This approach demonstrates both execution velocity and the kind of AI-native workflow XFuel is built to serve

### Open Positions (funded by grant)
- ZK Engineer — SP1/Groth16 prover optimization
- Backend Lead — Node.js, cross-chain bridges
- BD & Partnerships — DePIN ecosystem, inference providers

---

## Slide 15: Contact & Links

| Resource | Link |
|----------|------|
| **Live app** | [xfuel.app](https://xfuel.app) |
| **GitHub** | [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol) |
| **Whitepaper** | [WHITEPAPER.md v2.4](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/WHITEPAPER.md) |
| **Audit readiness** | [AUDIT_GRANT_READINESS.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_GRANT_READINESS.md) |
| **Bug bounty** | [bug-bounty.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/bug-bounty.md) |
| **Security page** | [xfuel.app/security](https://xfuel.app/security) |
| **Email** | founderxfuel@gmail.com |
| **Twitter / X** | [@XFuelLab](https://twitter.com/XFuelLab) |
| **Discord** | https://discord.com/invite/He5j6NeQ6R |

---

## Appendix A: Smart Contract Addresses

### Theta Mainnet (Chain 361)

| Contract | Address |
|----------|---------|
| BelieverRound | `0xeEC59184144904B1363beb4C88e5877BDFd25691` |
| AngelRound | `0x558FC765b5fA6e59A0cdea5F2Fb9F53d2C4ce772` |
| Admin (Gnosis Safe) | `0x9D6fC5EEa264182783Da01Bcfc135E52bE7bF257` |

### Theta Testnet (Chain 365)

| Contract | Address |
|----------|---------|
| CoreRevenueSplitter | `0x56A3E4e2E47Ad1D1e9DB2DD9446479b3Be01d1F0` |
| ZKVerifierSP1 | `0x8E0789E95f0F18F49E1BBA765893C9dfbF09570f` |
| A2ACircuit | `0x3eb4b410373413BfAcc48A3Cd872713F44EA8015` |
| ThetaGPUCircuit | `0x8188cAc55607d61c8ECf1cB850B65b47e682ADAc` |
| TAOCircuit | `0x1526CD125022c06dFda2Fc1c6563de0e72581E8e` |
| BridgeCircuit | `0xE4a9D5Cd8fCA9B6dba6DaCfc1A7A3B1b2a928F7d` |

---

## Appendix B: Technical Specifications

| Parameter | Value |
|-----------|-------|
| Primary chain | Theta EVM (mainnet 361, testnet 365) |
| Cross-chain | Bittensor EVM (964/945), Cosmos IBC (pending governance) |
| Proof system | SP1 zkVM — FRI STARKs + Groth16/PLONK wrapping |
| Proof size | ~260 bytes (Groth16) |
| Verification gas | ~270K (Theta EVM) |
| Settlement gas | <100K per circuit task |
| Cross-chain relay | Hyperlane |
| Solidity version | 0.8.22 (all audit-scope contracts) |
| Admin framework | OpenZeppelin AccessControl + Pausable |
| Governance | Vote-escrowed (Curve-style, 1–4x multiplier, max 4 years) |
| Escrow | Native TFUEL, AngelEscrow immutable buckets |
| Off-chain | Node.js core-listener, AI task router, M2M REST API |

---

*XFuel Protocol — April 2026. This document is for grant and funding application purposes only and does not constitute investment advice. All metrics reflect completed development work as of the document date.*
