# XFuel Protocol — Pitch Deck

**Verifiable Settlement & Payments for AI Compute — Route Any Model, Prove Every Dollar**

*Version 1.1 — July 2026*

---

## Slide 1: Cover

**XFuel Protocol**
*Route any model. Prove every dollar.*

> "Give your AI agent a budget, not your API keys — XFuel routes the task to the best available provider, settles over any rail, and returns a verifiable receipt you can check on-chain."

- **Website:** [xfuel.app](https://xfuel.app)
- **GitHub:** [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- **Contact:** founderxfuel@gmail.com

---

## Slide 2: The Problem

**AI agents are starting to spend money on their own — but there's no accountability layer.**

As agents autonomously buy inference, tools, and data, three gaps block trust:

### 1. No Accountable Spend
Today an agent needs your API keys, and the principal (a person, app, or DAO) can neither **cap** what it spends nor **audit** what it actually bought. Autonomous spend with no receipt is a non-starter for real money.

### 2. No Portable Trust
A result from any provider is unverifiable. There is no cryptographic receipt you can check, share, or settle against on-chain — so work can't be trusted across parties or composed between agents.

### 3. No Native Payment Rail
Agents can't hold credit cards. Per-call crypto micropayments (x402/USDC) are emerging, but there is no clean layer that ties payment to a provable settlement and a transparent fee split.

**Result:** autonomous AI spend is either locked to one provider with shared keys, or unverifiable and unauditable. The trust layer for machine-bought compute is missing.

---

## Slide 3: The Solution

**XFuel is the verifiable settlement + payments layer for AI compute.**

It sits between AI consumers (agents, dApps, enterprises) and *any* compute provider — centralized (OpenAI, Anthropic), neocloud (Groq, Together, Fireworks), or DePIN (Theta EdgeCloud, Akash). The invariant is **route anywhere, settle over any rail, return a verifiable receipt**. Providers are pluggable tiers; the settlement + proof layer is the product.

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
            │ Provider-agnostic router (pluggable tiers, first-available)
            ├── OpenAI-compatible   (OpenAI, Groq, Together, Fireworks, vLLM…)
            ├── Theta EdgeCloud     (DePIN — used when it has capacity)
            ├── Akash Network       (decentralized GPU marketplace)
            ├── Render Network      (image/LLM workloads)
            └── AWS Bedrock / Claude (reliable centralized backstop)
```

### Key Properties

| Capability | Detail |
|------------|--------|
| **Verifiable receipts** | Signed receipt for every task; on-chain SP1 settlement proof on demand |
| **Provider-agnostic routing** | One OpenAI-compatible endpoint → any provider (centralized, neocloud, DePIN) |
| **Agent-native payments** | Pay per call over x402/USDC or TFUEL — budgets + escrow, not shared API keys |
| **On-chain fee splits** | `CoreRevenueSplitter` — 30/30/25/15, publicly auditable |
| **Replay protection** | Nullifiers + per-sender nonces prevent proof reuse |
| **Composable & open** | M2M API, OpenAI gateway, MCP server, SDK, signed webhooks — MIT |

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

## Slide 4b: Proof Scope (what we prove — precisely)

**Trust is tiered, and we're explicit about it. Cost tracks the level of trust you need.**

| Tier | Name | What it cryptographically attests | Cost | Availability |
|------|------|-----------------------------------|------|--------------|
| **0** | Signed receipt | Task, route, model, tokens, cost, and a hash of the output — signed by XFuel | ~free, instant | Always on |
| **1** | ZK settlement proof | Correct fee split, payment binding, output-hash commitment, single-use nullifier — anchored on Theta | Prover cost | On demand / gated |
| **2** | ZK proof-of-inference | The *computation itself* ran as claimed (zkGPT) | High | Roadmap — only where XFuel runs the model |

- **What we claim (true):** verifiable *settlement* over any provider — provably correct fees + an immutable output commitment.
- **What we never claim:** that a black-box API "ran the model correctly." That is only Tier 2, and only where XFuel controls the compute.

This honesty is a credibility asset with auditors and technical reviewers — and it lets a live demo run nearly free (Tier 0) while the expensive proof (Tier 1) is a gated upgrade.

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
| Agentic / autonomous AI spend | Fast-emerging | steep |
| Verifiable AI settlement + agent payments | **Greenfield** | XFuel is category creator |

**Where the volume actually is:** today the majority of inference runs on centralized + neocloud providers (OpenAI, Anthropic, Groq, Together, Fireworks, Bedrock); DePIN is a small but fast-growing slice. XFuel monetizes **settlement across all of it now**, and rides the DePIN + zkML shift as it matures — no rewrite, just new provider tiers.

### Why now

- Agents are beginning to spend money autonomously — creating demand for accountable spend, budgets, and receipts.
- x402 / stablecoin micropayments give agents a native payment rail; no clean verifiable-settlement layer exists on top of it.
- Verifiable receipts + on-chain settlement are exactly what a Web2 billing router can't provide — an open, defensible wedge.

---

## Slide 10: Competitive Landscape

| | **XFuel** | OpenRouter | Ritual / Giza / Modulus | Neoclouds (Groq/Together) |
|--|-----------|-----------|-------------------------|---------------------------|
| Model / provider routing | **Any (agnostic)** | **Any (Web2 leader)** | Single | Own models only |
| Crypto-native agent payments | **x402 + TFUEL** | No (fiat billing) | Partial | No |
| Verifiable settlement receipts | **Signed + on-chain SP1** | No | ZK-ML focused | No |
| Programmable escrow / budgets | **Yes** | No | No | No |
| On-chain fee splits | **30/30/25/15** | No | No | No |
| Open source | **MIT** | No | Partial | No |

**We do not compete with OpenRouter on model coverage — that's a Web2 billing router's game.** XFuel adds what it structurally can't: **crypto-native agent payments + on-chain verifiable settlement + programmable escrow.** Claim we defend: *the neutral, verifiable settlement + payments rail for autonomous AI compute spend.*

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

*Christopher Hayes, USN Veteran, Elec. Eng., Project and Engineering Team Lead, Electrical Authority over $1B facility, Founder - Hayes Automation LLC, currently full time Founder & Developer of Xfuel-Protocol*

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
