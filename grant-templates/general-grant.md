# XFuel Protocol — General Ecosystem Grant Application

**Program**: [Ecosystem Name] Grants Program
**Amount Requested**: $[50,000–300,000]
**Duration**: [3–9 months]
**Status**: SUBMIT-READY — 11 circuits deployed on Theta Mainnet with monitoring; 240+ tests; BelieverRound vesting live
**Submission Portal**: [ecosystem-specific URL]
**GitHub**: [repository URL]
**Dashboard**: `dashboard/index.html` (testnet metrics UI)
**Gas Report**: `polish/gas-report-*.json` (automated profiling)
**Grant Tracker**: `grant-templates/grant-tracker.cjs` (milestone tracking)

---

## 1. Executive Summary

**XFuel Protocol** is a modular ZK-verified AI infrastructure layer that connects decentralized compute, data, and agent ecosystems through isolated, pluggable circuit modules. Each circuit bridges a specific AI ecosystem to a shared Core Layer providing zero-knowledge verification, unified fee capture, and cross-chain interoperability.

### Key Stats
- **11 circuit modules** spanning Bittensor, Theta, Solana, NEAR, Akash, Cosmos
- **240+ automated tests** (unit + integration + load/chaos hardening + vesting)
- **<100K gas** per settlement operation (TAO: ~68K)
- **SP1 zkVM** backend (Groth16 proofs, ~270K verification gas)
- **Full isolation** — each circuit has own state, roles, pause controls
- **Mainnet deployed** on Theta Mainnet (chain ID 361) with monitoring
- **BelieverRound vesting** — on-chain cliff + linear vest with refund protection
- **Community tools**: Discord bot, X campaign templates, veXF simulator
- **Health monitoring**: ThetaScan.io API integration, automated contract checks

## 2. Problem Statement

[Customize for target ecosystem]

The decentralized AI ecosystem faces three critical gaps:

1. **Verification Gap**: AI inference results are trusted, not cryptographically proven. Users cannot verify that a specific model processed their input correctly.

2. **Interoperability Gap**: Compute networks (Bittensor, Render, io.net), data networks (Vana, Grass), and agent platforms (NEAR, SendAI) operate in isolation. No unified settlement layer connects them.

3. **Privacy Gap**: Model weights, training data, and proprietary strategies are exposed during computation. AI providers have no way to prove correctness while keeping their models private.

## 3. Proposed Solution

XFuel addresses these gaps through a **circuit-based architecture** where each AI ecosystem connects via its own isolated module:

### For [Target Ecosystem]

[Customize: describe the specific circuit that benefits this ecosystem]

```
[Target Ecosystem]                    XFuel Core Layer
┌──────────────────┐                ┌─────────────────────┐
│ [Ecosystem       │  XFuel Circuit │ CoreRevenueSplitter  │
│  Compute/Data/   │◄──────────────►│ ZKVerifierSP1        │
│  Agent Network]  │                │ veXFGovernance       │
└──────────────────┘                └─────────────────────┘
```

### Circuit Interface

Every XFuel circuit implements:
- **Task submission**: Users submit AI tasks with escrowed payment
- **Cross-chain relay**: Tasks bridged to target ecosystem
- **ZK settlement**: SP1 proves computation correctness on-chain
- **Fee distribution**: Protocol fees routed to CoreRevenueSplitter

## 4. Technical Milestones

| # | Milestone | Description | Timeline | Budget |
|---|-----------|-------------|----------|--------|
| 1 | Circuit Contract | Deploy [ecosystem]-specific Solidity circuit | Month 1-2 | $[X]K |
| 2 | Off-chain Handler | Build event handler + proof pipeline | Month 2-3 | $[X]K |
| 3 | ZK Circuit | SP1 proof circuit for [ecosystem] computation | Month 3-4 | $[X]K |
| 4 | Integration | Connect to [ecosystem] network/API | Month 4-5 | $[X]K |
| 5 | Testing | Unit tests (15+) + integration tests (10+) | Month 5 | $[X]K |
| 6 | Deployment + Audit | Testnet launch + security review | Month 5-6 | $[X]K |

### Acceptance Criteria
- M1: Contract deployed and verified on testnet
- M2: Handler processes events from [ecosystem] network
- M3: ZK proof verifies on EVM in <300K gas
- M4: End-to-end task completion with [ecosystem] provider
- M5: All tests passing; >90% code coverage
- M6: Audit complete; no critical findings

## 5. Impact on [Target Ecosystem]

### Direct Benefits
- **New demand**: Cross-chain users access [ecosystem] compute/data/agents
- **Verification**: ZK proofs create trustable execution records
- **Revenue**: Providers earn from cross-chain task fees
- **Privacy**: Proprietary logic stays private during proof generation

### Community Excitement Engine — veXF Staker Jackpot

XFuel's **veXF Staker Jackpot** automatically routes 2% of every protocol fee into a continuously growing prize pool, paid out to one lucky veXF staker on a randomized 24–72 hour cycle via Chainlink VRF. A live countdown timer on the xfuel.app dashboard keeps the community glued to their screens every single day — building the kind of organic viral engagement that paid campaigns can't replicate. Winners are selected weighted by veXF voting power (minimum 1 veXF to participate), with a 30-day auto-reroll safeguard if any draw fails. This "lottery layer" transforms passive staking into an addictive daily ritual, driving both lock-up duration and daily active users across the XFuel ecosystem.

### Measurable Metrics
| Metric | Target (6 months post-launch) |
|--------|-------------------------------|
| Cross-chain tasks processed | 1,000+ |
| Provider integrations | 3+ |
| Bridged compute volume | $100K+ |
| Unique users (EVM → ecosystem) | 500+ |

## 6. Budget Summary

| Category | % | Amount |
|----------|---|--------|
| Smart contract development | 30% | $[X]K |
| ZK circuit engineering | 20% | $[X]K |
| Off-chain infrastructure | 15% | $[X]K |
| Security audit | 15% | $[X]K |
| Documentation + community | 10% | $[X]K |
| Operations + legal | 10% | $[X]K |
| **Total** | **100%** | **$[X]K** |

## 7. Team

| Name | Role | Background |
|------|------|------------|
| [Name] | Protocol Lead | [Experience: Solidity, ZK, infra] |
| [Name] | ZK Engineer | [Experience: SP1, Groth16, Circom] |
| [Name] | Backend Lead | [Experience: Node.js, cross-chain bridges] |
| [Name] | Security | [Experience: smart contract auditing] |

### Relevant Experience
- Built and deployed 11 circuit modules + BelieverRound with 240+ tests
- SP1 zkVM integration (Groth16 on-chain verification <270K gas)
- Cross-chain bridges: Wormhole VAA, Hyperlane, Chainlink CCIP
- On-chain vesting contract with cliff, linear release, and refund protection
- Full mainnet deployment pipeline with monitoring and health checks

## 8. Risks & Mitigation

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ZK proof latency | Medium | Batch proofs; off-chain pre-generation |
| Bridge security | Medium | Multi-sig relayers; rate limits; audits |
| Low initial demand | Medium | Incentive campaigns; developer grants |
| Smart contract bugs | Low | Formal verification; 2 independent audits |

## 9. Open Source Commitment

All XFuel Protocol code is MIT-licensed and open source:
- Smart contracts (Solidity)
- ZK circuits (SP1/Rust)
- Off-chain handlers (Node.js)
- Documentation and integration guides

The circuit architecture is designed to be extended by third parties. Any team can build a new circuit module and plug it into the XFuel Core Layer.

## 10. References

- **Whitepaper**: WHITEPAPER_v1.6_CORE.md (1,500+ line technical document)
- **Live Deployment**: Theta Mainnet (chain ID 361) — 14 contracts verified with monitoring
- **GitHub**: [repository URL]
- **Exec Summary**: exec-summary.md
- **Pitch Deck**: pitch-deck.md
- **Believer Guide**: believer-guide.md (on-chain vesting + community funding model)
- **Test Coverage**: 240+ tests across 11 circuits + vesting + system + hardening
- **Deployment Manifests**: deploy/manifests/ (JSON with addresses, gas, health checks)
- **BelieverRound Contract**: believer/BelieverRound.sol (3mo cliff + 12mo linear vest + refund)

## 11. Appendix: Deployment Health Summary

| Component | Status | Gas |
|-----------|--------|-----|
| CoreRevenueSplitter | LIVE | ~1.4M |
| ZKVerifierSP1 | LIVE | ~1.5M |
| TAOCircuit | LIVE | ~2.2M |
| A2ACircuit | LIVE | ~2.7M |
| ThetaGPUCircuit | LIVE | ~2.9M |
| ZKMLCircuit | LIVE | ~2.3M |
| AkashCircuit | LIVE | ~2.8M |
| AutonomousVaults | LIVE | ~2.5M |
| AgentRobotics | LIVE | ~2.8M |
| DataHubs | LIVE | ~2.3M |
| YieldCircuit | LIVE | ~2.2M |
| NearAgents | LIVE | ~2.4M |
| SolanaAIBridge | LIVE | ~2.1M |
| BelieverRound | LIVE | ~1.4M |
| **Total deployment** | **14/14** | **~31.9M gas** |

---

*Submitted by XFuel Protocol*
*Contact: partnerships@xfuel.app*
