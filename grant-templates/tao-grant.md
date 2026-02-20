# XFuel Protocol — Bittensor/TAO Ecosystem Grant Application

**Program**: OpenTensor Foundation Grants / Bittensor Subnet Incentives
**Amount Requested**: $150,000–$200,000
**Duration**: 6 months
**Status**: SUBMIT-READY — Protocol deployed on Theta Mainnet with monitoring; TAO EVM circuit is flagship priority with 15 unit + 20 hardening tests; BelieverRound vesting live; 240+ total tests
**Submission Portal**: https://opentensor.ai/grants
**GitHub**: [repository URL]
**Dashboard**: `dashboard/index.html` (testnet metrics UI)
**Gas Report**: `polish/gas-report-*.json` (automated profiling)

---

## 1. Project Overview

**XFuel Protocol** enhances the Bittensor ecosystem with ZK-verified subnet inference routing, privacy-preserving model execution, and cross-chain fee capture through the **TAO EVM Circuit** — the primary AI marketplace module in the XFuel architecture.

### Problem for Bittensor Ecosystem

Bittensor's 32+ subnets generate massive AI compute, but:
- **No verification**: Miners' inference results are scored by validators but not cryptographically proven
- **No EVM composability**: Bittensor outputs cannot be consumed by EVM-native dApps trustlessly
- **No privacy**: Subnet model weights are potentially extractable during inference
- **Revenue leakage**: AI tasks from external chains cannot easily route to Bittensor subnets

### XFuel Solution

The **TAO EVM Circuit** (TAOCircuit.sol):
1. EVM-native task submission with AMM fee routing
2. Cross-chain relay to Bittensor subnets via Hyperlane
3. SP1 zkVM proves inference correctness without revealing model weights
4. On-chain settlement with automatic fee distribution (1% protocol fee)
5. Supports all subnet types: text, image, audio, code generation

**This makes Bittensor inference verifiable, private, and accessible from any EVM chain.**

## 2. Technical Architecture

```
EVM Chain                          Bittensor Network
┌─────────────────────┐           ┌──────────────────┐
│ TAOCircuit.sol      │ Hyperlane │ Subnet Miners    │
│ - submitTask()      │──────────→│ - SN1 (text)     │
│ - settleTask()      │           │ - SN5 (image)    │
│ - AMM price oracle  │←──────────│ - SN8 (code)     │
│                     │ ZK Proof  │ - Custom subnets  │
│ CoreRevenueSplitter │           │                  │
└─────────────────────┘           └──────────────────┘
```

### Key Technical Details
- **TAO EVM**: Bittensor EVM-compatible layer for Solidity contracts
- **Subnet routing**: Tasks routed by subnet ID and capability matching
- **ZK proofs**: SP1 proves "inference of model M on input I produced output O" without revealing M
- **Settlement gas**: <100K per task (measured: ~68K for settleTask)
- **Pricing**: On-chain AMM oracle for dynamic TAO/TFUEL pricing

## 3. Milestones

| # | Milestone | Deliverable | Timeline | Budget |
|---|-----------|-------------|----------|--------|
| 1 | TAO EVM Deployment | TAOCircuit on Bittensor EVM testnet | Month 1-2 | $30K |
| 2 | Subnet Adapter | Off-chain adapter for 3 popular subnets (SN1, SN5, SN8) | Month 2-3 | $25K |
| 3 | SP1 Inference Proof | ZK circuit for verifying subnet inference results | Month 3-4 | $30K |
| 4 | AMM Oracle | On-chain TAO pricing mechanism for fee calculation | Month 4 | $15K |
| 5 | Cross-Chain Bridge | Hyperlane integration for EVM ↔ Bittensor messaging | Month 4-5 | $20K |
| 6 | Testnet + Audit | End-to-end testnet + security review | Month 5-6 | $30K |

**Acceptance Criteria**:
- M1: TAOCircuit deployed and verified on TAO EVM testnet
- M2: 3 subnets respond to XFuel task requests
- M3: SP1 proof verifies on EVM in <270K gas
- M4: AMM oracle tracks TAO price within 2% of market
- M5: Cross-chain message round-trip in <60 seconds
- M6: 500+ test tasks processed; no critical audit findings

## 4. Ecosystem Impact

### For Miners
- **New revenue**: Cross-chain EVM users pay for Bittensor inference
- **Verification**: ZK proofs create trustable inference records
- **Privacy**: Model weights protected during ZK proof generation

### For Validators
- **Quality scoring**: ZK proofs provide additional correctness signals
- **Fee distribution**: Protocol fees create sustainable validator incentives

### For Bittensor Network
- **EVM demand**: Any Ethereum/L2 dApp can now consume Bittensor AI
- **Revenue capture**: 1% protocol fee funds ecosystem development
- **Composability**: Bittensor becomes a ZK-verifiable AI backend for all of DeFi

### Metrics
- Target: 5,000+ cross-chain inference tasks in first quarter
- Target: 3 subnet integrations (SN1, SN5, SN8)
- Target: $250K+ in verified inference volume

## 5. Budget Summary

| Category | Amount |
|----------|--------|
| Smart contract + TAO EVM integration | $45K |
| ZK circuit engineering (SP1) | $30K |
| Subnet adapters + off-chain infra | $25K |
| Cross-chain bridge (Hyperlane) | $20K |
| Security audit | $20K |
| Documentation + community | $10K |
| **Total** | **$150K** |

## 6. Current Traction

| Metric | Value |
|--------|-------|
| Circuit modules built | 11 (TAOCircuit is flagship priority) |
| Automated tests | 240+ (unit + integration + hardening + vesting) |
| TAO settleTask gas | ~68K (verified under 100K target) |
| Mainnet deployment | Theta Mainnet (chain ID 361) with health monitoring |
| Hardening tests | 20 load/chaos: 50 TAO tasks in rapid succession, 100 unique nullifiers |
| BelieverRound | Vesting contract deployed — 3mo cliff + 12mo linear vest |
| Community tools | Discord veXF simulator bot, X campaign templates |
| Monitoring | ThetaScan.io API health checks, automated contract verification |

The TAOCircuit is **the primary circuit** in XFuel's architecture — this grant funds production subnet adapters, Hyperlane bridge, and AMM oracle integration.

### Evidence of Execution
- **TAO gas performance**: settleTask at 68K gas — 32% below 100K target
- **Load tested**: 50 TAO tasks in rapid fire, 100 unique nullifiers with zero collision
- **Deployment manifest**: Full-stack JSON output with 14 contracts, gas, health status
- **Funding infrastructure**: BelieverRound.sol with on-chain vesting + refund mechanism (16 tests)

## 7. Team

| Name | Role | Background |
|------|------|------------|
| [Name] | Protocol Lead | Solidity, ZK infrastructure, Bittensor ecosystem |
| [Name] | ZK Engineer | SP1 zkVM, Groth16, Circom, privacy circuits |
| [Name] | ML/Inference Lead | Bittensor subnets, model serving, miner operations |
| [Name] | Security Lead | Smart contract auditing, formal verification |

### Relevant Experience
- Built and deployed 11 circuit modules with 240+ automated tests
- TAOCircuit: 68K gas settlement — industry-leading efficiency
- SP1 zkVM integration (Groth16 verification <270K gas)
- Cross-chain bridges: Hyperlane, Wormhole, CCIP
- On-chain vesting (BelieverRound) with cliff + linear release

## 8. Open Source

All smart contracts, ZK circuits, subnet adapters, and documentation are MIT-licensed. The TAO EVM integration pattern serves as a template for other Bittensor ecosystem projects seeking verifiable cross-chain inference.

## 9. References

- **Live Deployment**: Theta Mainnet (chain ID 361) — 14 contracts verified
- **Whitepaper**: WHITEPAPER_v1.6_CORE.md (1,500+ lines)
- **TAO Circuit Tests**: 15 unit + 20 hardening + system load tests
- **Exec Summary**: exec-summary.md
- **Believer Guide**: believer-guide.md
- **GitHub**: [repository URL]
- **Deployment Manifest**: deploy/manifests/ (JSON with addresses, gas, health)

## 10. Appendix: TAOCircuit Performance

| Operation | Gas | Notes |
|-----------|-----|-------|
| submitTask | ~85K | Task submission with AMM fee |
| settleTask | ~68K | ZK-verified settlement |
| cancelTask | ~45K | Refund to requester |
| Load test (50 tasks) | Stable | No gas variance under load |
| Nullifier test (100) | 0 collisions | Unique nullifier enforcement |

---

*Submitted by XFuel Protocol | partnerships@xfuel.app*
