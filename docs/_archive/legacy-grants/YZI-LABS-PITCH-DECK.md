# XFuel Protocol — YZi Labs Grant Application

**ZK-Verified Settlement for AI Compute Across DePIN Networks**

*April 2026*

---

## 1. The Problem

Decentralized AI compute is a $10B+ market (Theta, Bittensor, Akash, Render combined) — but every network is a silo:

- **No proof of delivery.** Nodes claim they ran your inference, but there is no cryptographic receipt. You pay and hope.
- **No unified settlement.** Each network has its own fee model, its own token, its own trust assumptions. Agents that need to route work across providers must build custom integrations for each one.
- **No transparent economics.** Fee flows are opaque. Operators cannot verify that revenue is split fairly; stakers cannot audit yield sources.

**Result:** AI agents and dApps are locked into single providers, overpay for unverified compute, and cannot compose across DePIN networks. The "decentralized AI" stack has centralized trust at the settlement layer.

---

## 2. The Solution: XFuel Protocol

XFuel is the **ZK settlement and orchestration layer** that sits between AI consumers (agents, dApps, enterprises) and GPU providers (Theta EdgeCloud, Bittensor, Akash, and beyond).

**One sentence:** *Submit an AI task anywhere — XFuel routes it to the best GPU, proves delivery with a ZK proof, and settles payment on-chain with transparent fee splits.*

### How it works

```
Agent / dApp
    │
    ▼
┌───────────────┐
│  XFuel Core   │  ← M2M API (REST + webhooks)
│  Layer        │
├───────────────┤
│ ZKVerifierSP1 │  ← SP1 Groth16 proof verification (~270K gas)
│ RevenueSplit  │  ← 30% BBB · 30% Growth · 25% Stakers · 15% Treasury
│ veXF Gov      │  ← Vote-escrowed governance
└───────┬───────┘
        │ Circuits (modular plug-ins)
        ├── Theta EdgeCloud (primary GPU backbone)
        ├── Bittensor EVM (dTAO subnets)
        ├── Akash Network
        ├── Render Network
        └── AWS Bedrock (last-resort fallback)
```

### Key differentiators

| Capability | XFuel | Competitors |
|------------|-------|-------------|
| **ZK proof of delivery** | SP1 Groth16 (~260 bytes, <270K gas) | Trust-based or none |
| **Multi-network routing** | 6-tier priority engine (EdgeCloud → Akash → ...) | Single-provider lock-in |
| **On-chain fee transparency** | CoreRevenueSplitter with auditable 30/30/25/15 split | Opaque fee pools |
| **Replay protection** | Nullifier + nonce per proof | Manual dedup or none |
| **Modular architecture** | Independent circuits per provider, no shared state | Monolithic contracts |

---

## 3. Why Theta & EdgeCloud

XFuel is **Theta-native by design**:

- **Primary GPU backbone:** Theta EdgeCloud is Tier 1 in our 6-tier DePIN router — the first and cheapest path for every inference request.
- **Chain settlement:** All core contracts deploy on Theta EVM (mainnet 361). Funding rounds (Believer + Angel) settle in TFUEL.
- **EdgeCloud attestation:** Our `ThetaInferenceCircuit` integrates directly with EdgeCloud's on-demand API for GPU-backed inference, then wraps delivery in an SP1 proof.
- **Theta subchain ready:** Architecture supports XFuel-specific subchain for high-throughput task settlement, leveraging Theta's subchain framework.

**XFuel makes Theta the default settlement chain for verifiable AI compute across the entire DePIN ecosystem** — bringing cross-chain volume and fees back to Theta.

---

## 4. Traction & Technical Readiness

### Built and deployed (not roadmap)

| Metric | Value |
|--------|-------|
| Circuit modules (repo) | 21+ |
| Automated tests | 700+ (unit + integration + security + fuzz) |
| Core test coverage | 92.84% statements, 95.05% functions |
| Settlement gas | <270K per Groth16 verification |
| Mainnet contracts | BelieverRound + AngelRound live on Theta 361 |
| AngelEscrow | Immutable 3-bucket TFUEL escrow (AUDIT / SUBCHAIN / DEVOPS) |
| Testnet contracts | 6 core contracts on Theta 365, smoke-tested |
| Audit readiness | 59/59 checklist items complete (CertiK Phase 1 scoped) |
| M2M API | REST + webhook task pipeline, operational |
| SP1 prover | CUDA Docker image with health checks + auto-restart watchdog |

### Funding infrastructure (on-chain, live)

| Contract | Network | Status |
|----------|---------|--------|
| BelieverRound | Theta mainnet (361) | Open — commit TFUEL, lock tiers, 180d refund |
| AngelRound | Theta mainnet (361) | Open — strategic, pre-TGE treasury use |
| AngelEscrow | Theta mainnet (361) | Ring-fenced buckets with multisig threshold |
| CommunityEngagementDistributor | Scoped | Merkle seasons for 15% engagement rewards |

### Live product

- **xfuel.app** — Believer/Angel round UIs with wallet integration, on-chain stats, AngelEscrow transparency panel.
- **GitHub** — Open-source (MIT): [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)

---

## 5. Revenue Model

**Every AI task generates protocol fees (0.1–1%).**

All fees flow through `CoreRevenueSplitter`:

| Bucket | Share | Purpose |
|--------|-------|---------|
| Buyback-Burn (BBB) | 30% | Deflationary pressure — buy XF on market + burn |
| Growth & Expansion (GET) | 30% | Machine incentives (50%), LP boost (30%), Agent grants (20%) |
| veXF Staker Rewards | 25% | Real yield to governance lockers |
| Operations Treasury | 15% | Audits, infra, Fee-to-Stake validator routing |

### Revenue projections (steady-state)

| Monthly Volume | Avg Fee | Monthly Revenue | Annual Revenue |
|---------------|---------|-----------------|----------------|
| $2M | 0.5% | $10K | $120K |
| $10M | 0.5% | $50K | $600K |
| $50M | 0.5% | $250K | $3M |

Volume target: 60% AI inference, 25% data/communications, 15% settlements.

---

## 6. Tokenomics

**XF token — 1,000,000,000 total supply**

| Allocation | % | XF Amount | Notes |
|-----------|---|-----------|-------|
| Community Round (Believers) | 15% | 150,000,000 | Open TFUEL sale, lock bonuses, 180d refund |
| Angel / Strategic | 10% | 100,000,000 | Pre-TGE treasury use, no refund |
| Engagement Rewards | 15% | 150,000,000 | Merkle seasons, task-based points |
| Ecosystem & Partnerships | 20% | 200,000,000 | Grants, integrations, co-marketing |
| Team & Founders | 15% | 150,000,000 | 12mo cliff + 36mo linear |
| Protocol Treasury | 15% | 150,000,000 | DAO-controlled via veXF governance |
| Liquidity (LP seed) | 10% | 100,000,000 | Unlocked at TGE for DEX listing |

**Vesting:** All funded rounds — 90d cliff + 270d linear. Lock bonuses extend claim delays (365d / 730d / 1095d after TGE) for +8% / +20% / +35% XF.

---

## 7. Market Opportunity

| Segment | 2026 Market Size | Growth |
|---------|-----------------|--------|
| Total AI Compute | $150B+ | ~40% YoY |
| Decentralized AI/DePIN | $10B+ | ~80% YoY |
| Theta EdgeCloud (inference) | Growing | Expanding GPU capacity |
| Verifiable AI settlement | **Greenfield** | XFuel is first-mover |

**XFuel's addressable market = any project that needs provable, cross-chain AI task settlement.** Even 0.1% of decentralized AI volume = $10M+ annual protocol revenue.

---

## 8. Competitive Landscape

| | XFuel | Ritual | Giza | Modulus | Generic bridges |
|--|-------|--------|------|---------|-----------------|
| ZK proof of compute | SP1 Groth16 | ONNX verify | Cairo-based | Plonky2 | No |
| Multi-DePIN routing | 6 providers | Single | Single | Single | N/A |
| Theta-native | Yes (primary chain) | No | No | No | No |
| Revenue split on-chain | 30/30/25/15 | No | No | No | No |
| Funding on-chain | Believer + Angel | VC only | VC only | VC only | N/A |
| Modular circuit architecture | 21+ circuits | Monolithic | Monolithic | Monolithic | N/A |
| Open source | MIT | Partial | Partial | Partial | Varies |

**XFuel is the only protocol combining ZK-verified AI settlement + multi-DePIN routing + transparent on-chain economics + Theta-native positioning.**

---

## 9. Roadmap

| Phase | Timeline | Deliverables | Status |
|-------|----------|-------------|--------|
| **Build** | Q1 2026 | Core Layer + 21 circuits + 700 tests + funding contracts | **Done** |
| **Fund** | Q1–Q2 2026 | Believer/Angel rounds on Theta mainnet, AngelEscrow | **Live** |
| **Audit** | Q2 2026 | CertiK Phase 1 — core + verifier + funding (5 contracts, ~2,800 LOC) | **Scoped** |
| **Launch** | Q3 2026 | Full mainnet core contracts, subchain, public dashboard | Planned |
| **Scale** | Q4 2026 | SDK release, 3+ partner integrations, Phase 2 audit (bridges, TAO) | Planned |
| **Govern** | Q1 2027 | veXF governance live, Fee-to-Stake, community proposals | Planned |

---

## 10. The Ask

### Grant request: Audit & Infrastructure

| Use of Funds | Allocation |
|-------------|-----------|
| **CertiK Phase 1 audit** (ZKVerifierSP1, CoreRevenueSplitter, veXFGovernance, ThetaInferenceCircuit, SP1ProofHooks, BelieverRound, AngelRound) | 55% |
| **Subchain deployment** — XFuel subchain on Theta for high-throughput settlement | 20% |
| **Infrastructure** — SP1 prover (CUDA), monitoring, RPC redundancy | 15% |
| **Documentation & developer onboarding** — SDK, integration guides, API docs | 10% |

**Note:** YZi Labs and CertiK announced a [$1M audit grant pool](https://www.cryptopolitan.com/yzi-labs-certik-1m-audit-grant-easy/) for EASY participants — XFuel's Phase 1 scope is audit-ready (59/59 checklist items complete, scope JSON prepared).

### What the grant unlocks

1. **Audited, production-grade contracts** on Theta mainnet — credibility for institutional partners.
2. **Theta subchain** for XFuel — dedicated throughput for AI task settlement, showcasing Theta's subchain technology.
3. **Reference implementation** — the first ZK-verified AI settlement layer on any DePIN network, starting with Theta.

---

## 11. YZi Labs Alignment

XFuel maps directly to **multiple EASY S3 focus areas**:

| YZi Focus Area | XFuel Alignment |
|----------------|-----------------|
| **Decentralized compute / DePIN** | Core product — ZK-verified settlement across GPU providers |
| **AI data networks** | Data attestation circuits, agent-to-agent communication |
| **Privacy-preserving infrastructure** | ZK proofs keep model weights private; nullifier isolation |
| **On-chain markets** | Task marketplace with on-chain bidding, escrow, and settlement |

### Why XFuel is a strong EASY candidate

- **Execution speed:** Solo founder, 21+ circuits, 700+ tests, mainnet contracts in <6 months.
- **Open source:** Full MIT license — auditability, composability, ecosystem contribution.
- **Revenue from day 1:** Every settled task generates fees through the on-chain splitter.
- **Theta ecosystem multiplier:** Brings cross-chain AI volume back to Theta; positions EdgeCloud as the default GPU for verifiable inference.

---

## 12. Security & Trust

| Signal | Status |
|--------|--------|
| Audit scope | CertiK Phase 1 — 5 core contracts, ~2,800 LOC |
| Audit readiness | 59/59 items complete ([checklist](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_GRANT_READINESS.md)) |
| Test coverage | 92.84% statements, 95.05% functions (core) |
| Security tests | Reentrancy (5), access control (9), boundary (12), fuzz (32) |
| Bug bounty | [Published](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/bug-bounty.md) — up to $50K Critical |
| Multisig admin | Gnosis Safe on Theta mainnet |
| On-chain transparency | AngelEscrow with immutable buckets, public totalRaised |
| Responsible disclosure | founderxfuel@gmail.com + [GitHub Security Advisories](https://github.com/XFuel-Lab/xfuel-protocol/security) |

---

## 13. Team

**Solo founder** — built the entire protocol leveraging AI-assisted development (Cursor + Claude, Grok for architecture). This is a strength, not a weakness:

- Demonstrates that one determined builder can ship 21 circuits, 700+ tests, and mainnet contracts in under 6 months.
- The codebase is designed for team scaling — modular circuits, comprehensive tests, and documentation.
- **Seeking:** ZK engineer, backend lead, and BD/partnerships lead — grant funding enables these hires.

*Chris Hayes, Navy Comm Tech/Crypto Certified TOP SECRET CLEARANCE, Electrical Engineer High Voltage and Chemical Refining,Previous Founder of Hayes Automation LLC Specializing in engineered equipment for process automation in industrial applications.

---

## 14. Links & References

| Resource | URL |
|----------|-----|
| **Live app** | [xfuel.app](https://xfuel.app) |
| **GitHub** | [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol) |
| **Whitepaper** | [WHITEPAPER.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/WHITEPAPER.md) (v2.4, 750+ lines) |
| **Audit checklist** | [AUDIT_GRANT_READINESS.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/AUDIT_GRANT_READINESS.md) |
| **BelieverRound** | [Theta explorer](https://explorer.thetatoken.org/address/0xeEC59184144904B1363beb4C88e5877BDFd25691) |
| **AngelRound** | [Theta explorer](https://explorer.thetatoken.org/address/0x558FC765b5fA6e59A0cdea5F2Fb9F53d2C4ce772) |
| **Bug bounty** | [bug-bounty.md](https://github.com/XFuel-Lab/xfuel-protocol/blob/main/docs/bug-bounty.md) |
| **Security page** | [xfuel.app/security](https://xfuel.app/security) |
| **Contact** | founderxfuel@gmail.com |
| **Twitter** | [@XFuelLab](https://twitter.com/XFuelLab) |
| **Discord** | [discord.com/invite/He5j6NeQ6R](https://discord.com/invite/He5j6NeQ6R) |

---

*XFuel Protocol is not investment advice. Token allocations, pricing, and timelines are subject to change. This document is for grant application purposes.*
