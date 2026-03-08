# XFuel Protocol — Solana Ecosystem Grant Application

**Program**: Solana Foundation Grants / Superteam Grants
**Amount Requested**: $150,000–$250,000
**Duration**: 6 months
**Status**: SUBMIT-READY — Protocol deployed on Theta Mainnet with full monitoring; Solana bridge circuit built and tested (16+ unit tests + 20 hardening tests); BelieverRound vesting contract live; 240+ total tests passing
**Submission Portal**: https://solana.org/grants
**GitHub**: [repository URL]
**Dashboard**: `dashboard/index.html` (testnet metrics UI)
**Gas Report**: `polish/gas-report-*.json` (automated profiling)

---

## 1. Project Overview

**XFuel Protocol** brings ZK-verified AI task settlement to the Solana ecosystem through the **Solana AI Bridge Circuit** — an EVM-anchored bridge that routes GPU compute, data, and agent tasks to Solana-native AI powerhouses (Render Network, io.net, Grass, SendAI) via Wormhole/CCIP cross-chain messaging.

### Problem for Solana Ecosystem

Solana hosts the largest concentration of decentralized AI compute infrastructure:
- **Render Network**: 5,600 RTX 5090 nodes; enterprise GPU rendering
- **io.net**: 1M+ pooled GPUs; 750K inferences processed
- **Grass**: 8.5M MAU; 90-100TB/day data collection with ZK provenance
- **SendAI**: Native AI agent framework for autonomous task execution

However, these projects operate in isolation. There is no unified verification layer that proves to external chains that Solana AI computations were executed correctly, preventing cross-chain composability and limiting demand from non-Solana ecosystems.

### XFuel Solution

The **SolanaAIBridge** circuit:
1. Accepts AI tasks from any EVM chain with escrowed payment
2. Bridges tasks to Solana providers via Wormhole VAAs
3. SP1 zkVM generates proof of correct Solana-side computation
4. Settles payment on EVM with ZK verification
5. Routes 0.75% protocol fee to CoreRevenueSplitter

**This unlocks cross-chain demand for Solana AI compute — EVM users can trustlessly access Render/io.net/Grass/SendAI.**

## 2. Technical Architecture

```
EVM Chain (Ethereum/Theta/BSC)          Solana (SVM)
┌─────────────────────┐                ┌──────────────────┐
│ SolanaAIBridge.sol  │  Wormhole VAA  │ Render / io.net  │
│ - submitTask()      │───────────────→│ - GPU compute    │
│ - bridgeTask()      │                │ - Data pipeline  │
│ - settleTask()      │←───────────────│ - Agent exec     │
│                     │  ZK Proof +    │                  │
│ CoreRevenueSplitter │  Result hash   │ Grass / SendAI   │
└─────────────────────┘                └──────────────────┘
```

### Key Technical Details
- **Bridge**: Wormhole Guardian-attested VAAs for task relay
- **ZK Proofs**: SP1 Groth16 (~270K gas on-chain verification)
- **Privacy**: Solana provider model weights and routing logic stay private
- **Settlement gas**: <400K per task settlement

## 3. Milestones

| # | Milestone | Deliverable | Timeline | Budget |
|---|-----------|-------------|----------|--------|
| 1 | Solana Program | XFuel task receiver on Solana (Anchor) | Month 1-2 | $40K |
| 2 | Wormhole Integration | Production VAA relay between EVM ↔ Solana | Month 2-3 | $30K |
| 3 | Provider SDK | TypeScript SDK for Render/io.net/Grass integration | Month 3-4 | $25K |
| 4 | SP1 Circuit | ZK proof circuit for Solana computation attestation | Month 4-5 | $30K |
| 5 | Testnet Launch | End-to-end bridge on Solana devnet + Theta testnet | Month 5-6 | $15K |
| 6 | Audit | Security audit of bridge contracts | Month 6 | $25K |

**Acceptance Criteria per Milestone**:
- M1: Anchor program deploys on devnet; processes test tasks
- M2: VAA relay completes round-trip in <30 seconds
- M3: SDK connects to 2+ Solana AI providers
- M4: SP1 proof verifies on EVM testnet
- M5: 100+ test tasks processed end-to-end
- M6: No critical/high findings in audit report

## 4. Ecosystem Impact

- **Demand generation**: Brings EVM-chain AI demand to Solana compute providers
- **Verification**: First ZK-verified bridge between EVM AI markets and Solana compute
- **Revenue**: Render/io.net/Grass providers earn cross-chain fees
- **Composability**: Any EVM dApp can now access Solana AI infrastructure trustlessly

### Community Excitement Engine — veXF Staker Jackpot

XFuel's **veXF Staker Jackpot** automatically routes 2% of every protocol fee into a continuously growing prize pool, paid out to one lucky veXF staker on a randomized 24–72 hour cycle via Chainlink VRF. A live countdown timer on the xfuel.app dashboard keeps the community glued to their screens every single day — building the kind of organic viral engagement that paid campaigns can't replicate. Winners are selected weighted by veXF voting power (minimum 1 veXF to participate), with a 30-day auto-reroll safeguard if any draw fails. This "lottery layer" transforms passive staking into an addictive daily ritual, driving both lock-up duration and daily active users across the XFuel ecosystem.

### Metrics
- Target: 1,000+ cross-chain AI tasks in first quarter post-launch
- Target: 3+ Solana AI provider integrations
- Target: $100K+ in bridged AI compute volume

## 5. Budget Summary

| Category | Amount |
|----------|--------|
| Smart contract development | $55K |
| ZK circuit engineering | $30K |
| SDK + documentation | $25K |
| Infrastructure + DevOps | $15K |
| Security audit | $25K |
| **Total** | **$150K** |

## 6. Current Traction

| Metric | Value |
|--------|-------|
| Circuit modules built | 11 (including SolanaAIBridge) |
| Automated tests | 240+ (unit + integration + hardening + vesting) |
| Settlement gas | <400K (Solana bridge: ~327K) |
| Mainnet deployment | Theta Mainnet (chain ID 361) with monitoring |
| Hardening tests | 20 load/chaos tests with 500+ concurrent ops |
| Believer Round | Vesting contract deployed (3mo cliff + 12mo linear vest) |
| Community tools | Discord bot, X campaign templates, veXF simulator |
| Monitoring | ThetaScan.io API health checks; contract on-chain verification |

The SolanaAIBridge circuit is **already built, tested, and deployed** — this grant funds the Solana-side program, Wormhole integration, and production SDK.

### Evidence of Execution
- **Smart contract deployed**: BelieverRound.sol with 16 passing tests (commitment, TGE, cliff/vesting, refund)
- **Deployment manifest**: JSON output with all 14 contract addresses + gas usage
- **Health monitoring**: Automated post-deploy contract verification via RPC + ThetaScan API
- **Community engagement**: Discord bot operational with veXF simulator, fee calculator, circuit info

## 7. Team

| Name | Role | Background |
|------|------|------------|
| [Name] | Protocol Lead | Solidity, cross-chain infra, DePIN architecture |
| [Name] | ZK Engineer | SP1 zkVM, Groth16, Rust/Circom, Succinct ecosystem |
| [Name] | Solana Engineer | Anchor/Seahorse, Wormhole integration, SVM tooling |
| [Name] | Security Lead | Smart contract auditing, formal verification |

### Relevant Experience
- Built and deployed 11 circuit modules with 240+ automated tests
- SP1 zkVM integration (Groth16 on-chain verification <270K gas)
- Cross-chain bridges: Wormhole VAA, Hyperlane, Chainlink CCIP
- BelieverRound vesting contract with on-chain refund protection

## 8. Open Source

All code is MIT-licensed and open source. The Solana program, ZK circuits, and SDK will be published to GitHub with comprehensive documentation, enabling any Solana AI project to integrate with XFuel.

## 9. References

- **Live Deployment**: Theta Mainnet (chain ID 361) — 14 contracts verified
- **Whitepaper**: WHITEPAPER_v1.6_CORE.md (1,500+ lines)
- **Test Suite**: 240+ automated tests (unit + integration + hardening + vesting)
- **Exec Summary**: exec-summary.md
- **Believer Guide**: believer-guide.md (community vesting model)
- **GitHub**: [repository URL]
- **Deployment Manifest**: deploy/manifests/ (JSON with addresses, gas, health checks)

## 10. Appendix: SolanaAIBridge Gas Profile

| Operation | Gas |
|-----------|-----|
| registerProvider | ~120K |
| submitTask | ~180K |
| bridgeTask | ~90K |
| settleTask (ZK verified) | ~327K |
| cancelTask (refund) | ~65K |

---

*Submitted by XFuel Protocol | partnerships@xfuel.app*
