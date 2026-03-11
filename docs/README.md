# XFuel Protocol — Documentation Hub

> **Live app:** [xfuel.app](https://xfuel.app) · **GitHub:** [github.com/XFuelAI/xfuel-protocol](https://github.com/XFuelAI/xfuel-protocol) · **Security:** security@xfuel.app

---

## Start Here by Role

### 👩‍💻 I'm a Developer

| Goal | Document |
|---|---|
| Understand the full architecture | [WHITEPAPER.md](../WHITEPAPER.md) |
| Set up and run the repo | [Main README](../README.md) |
| Deploy to Theta Testnet | [Deployment Guide](./DEPLOYMENT.md) |
| Run the test suite (755+ tests) | [Testing Guide](./TESTING.md) |
| Integrate via the M2M API | [M2M API Reference](./M2M_API.md) · [SDK README](../sdk/js/README.md) |
| Understand all circuit contracts | [Circuit Design](./Circuit-Design-and-Expansion.md) · [Circuits Reference](./CIRCUITS.md) |
| Verify a live deployment | `node scripts/verify-deployment.cjs --manifest <manifest>` |
| Debug on-chain transactions | `npx hardhat test --trace` (hardhat-tracer) |

### 🔍 I'm an Auditor (CertiK Phase 1)

| Goal | Document |
|---|---|
| Audit readiness checklist | [Audit & Grant Readiness](./AUDIT_GRANT_READINESS.md) |
| Pre-submission gap analysis | [Gap Analysis](./GAP_ANALYSIS.md) |
| Formal audit scope | [CertiK Phase 1 Scope](./certik-phase1-scope.json) |
| Security architecture | [Security Design](./security-design.md) |
| ZK verification baseline | [ZK Audit Baseline](./zk-audit-baseline.json) |
| Bug bounty program | [Bug Bounty](./bug-bounty.md) |
| Core contract source | `contracts/core/` — ZKVerifierSP1, CoreRevenueSplitter, veXFGovernance, SP1ProofHooks |
| Safeguards & mitigations | [Routing Mitigations](./routing-mitigations-design.md) · [Safeguards](./SAFEGUARDS.md) |

### 💰 I'm an Investor / Grant Reviewer

| Goal | Document |
|---|---|
| Project overview and vision | [Main README](../README.md) |
| Technical whitepaper | [WHITEPAPER.md](../WHITEPAPER.md) |
| Token economics | [Whitepaper Section 5](../WHITEPAPER.md) · [Tokenomics Sensitivity](./tokenomics-sensitivity.md) |
| GET mechanics (revenue) | [Growth-Expansion-Treasury](./Growth-Expansion-Treasury.md) |
| Technical benchmarks | [Technical Specifications](./Technical-Specifications.md) |
| Phase completion reports | [Phase Reports](#phase-reports) |
| Theta integration plan | [Theta Integration Plan](./THETA_INTEGRATION_PLAN.md) · [Theta Integrations](./THETA_INTEGRATIONS.md) |

### 🤝 I'm a Contributor

| Goal | Document |
|---|---|
| Getting started | [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Code of conduct | [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) |
| Submit an issue or PR | [GitHub Issue Templates](../.github/ISSUE_TEMPLATE/) |
| Changelog | [CHANGELOG.md](../CHANGELOG.md) |
| Quick reference card | [Quick Reference](./QUICK_REFERENCE.md) |

---

## Documentation Sections

### Architecture & Core Protocol

- **[WHITEPAPER.md](../WHITEPAPER.md)** — Canonical whitepaper v2.4 (Hybrid Theta-Centric Architecture)
- **[Technical Specifications](./Technical-Specifications.md)** — Core Layer, ZK verification, cross-chain integration, benchmarks
- **[Circuit Design & Expansion](./Circuit-Design-and-Expansion.md)** — All 16+ circuit implementations and design history
- **[Circuits Reference](./CIRCUITS.md)** — Circuit contract and handler documentation
- **[ZK Bridge Architecture](./ZK_BRIDGE_ARCHITECTURE.md)** — ZK proof flow diagrams
- **[ZK Bridge Implementation](./ZK_BRIDGE_IMPLEMENTATION.md)** — SP1 zkVM proof generation details

### Deployment & Operations

- **[Deployment Guide](./DEPLOYMENT.md)** — Full deployment walkthrough (Theta, Bittensor, CosmWasm)
- **[Unified Deployment Guide](./UNIFIED_DEPLOYMENT_GUIDE.md)** — Consolidated multi-network deployment
- **[Testing Guide](./TESTING.md)** — How to run the full test suite (755+ tests)
- **[Security Deployment Checklist](./SECURITY_DEPLOYMENT_CHECKLIST.md)** — Pre-deployment security gates

### API & Integration

- **[M2M API Reference](./M2M_API.md)** — Machine-to-machine API (task submission, A2A messaging, proof retrieval)
- **[SDK README](../sdk/js/README.md)** — JavaScript/TypeScript SDK (`xfuel-sdk`)
- **[Theta Integration Plan](./THETA_INTEGRATION_PLAN.md)** — Full Theta ecosystem integration roadmap
- **[Theta Integrations](./THETA_INTEGRATIONS.md)** — EdgeStore, Video API, TDROP, EdgeCloud specs
- **[TAO Circuit + Hyperlane E2E](./TAO_CIRCUIT_HYPERLANE_E2E.md)** — Bittensor cross-chain flow

### Audit & Security

- **[Audit & Grant Readiness](./AUDIT_GRANT_READINESS.md)** — CertiK Phase 1 checklist and progress tracker
- **[Gap Analysis](./GAP_ANALYSIS.md)** — Pre-submission gap analysis with priority sprints
- **[CertiK Phase 1 Scope](./certik-phase1-scope.json)** — Formal audit scope definition (v5.0.0)
- **[Security Design](./security-design.md)** — Defense-in-depth architecture, emergency response
- **[Safeguards](./SAFEGUARDS.md)** — Circuit-level and protocol-level safeguards
- **[Routing Mitigations](./routing-mitigations-design.md)** — Fee routing safety mechanisms
- **[Bug Bounty Program](./bug-bounty.md)** — Vulnerability reporting (up to $50K rewards)
- **[ZK Audit Baseline](./zk-audit-baseline.json)** — ZK verification audit baseline
- **[ZK Patch Report](./zk-patch-report.json)** — Security patches applied

### Governance & Tokenomics

- **[Whitepaper Section 5 & 9](../WHITEPAPER.md)** — Token distribution, governance model
- **[Growth-Expansion-Treasury](./Growth-Expansion-Treasury.md)** — GET mechanics and multi-sig governance
- **[Tokenomics Sensitivity](./tokenomics-sensitivity.md)** — Economic model stress tests
- **[Auto-Rebalance](./AUTO_REBALANCE.md)** — Automated yield routing logic

### Phase Reports {#phase-reports}

| Phase | Focus | Report |
|---|---|---|
| Phase 3 | Governance + Revenue Splitter | [phase3-report.json](./phase3-report.json) |
| Phase 4 | Scale + ZK Rollup | [phase4-report.json](./phase4-report.json) |
| Phase 5 | Multi-Network AI | [phase5-report.json](./phase5-report.json) |
| Phase 6 | Ecosystem Expansion | [phase6-report.json](./phase6-report.json) |
| Priority Circuits | Circuit validation | [priority-circuits-report.json](./priority-circuits-report.json) |

---

## Contributing to Documentation

Found an issue with the docs? Want to improve them?

1. Check [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines
2. Submit a PR with your improvements
3. Update this index if adding new docs

---

**Last Updated:** March 2026
**Documentation Version:** v2.4 (Hybrid Theta-Centric Architecture)
