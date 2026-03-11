# XFuel Protocol — Grant Application Template

> **Use this template** when applying for ecosystem grants (OpenTensor, NEAR, Akash, Theta, etc.).
> Replace placeholders `[...]` with project-specific details.

---

## 1. Project Overview

| Field | Details |
|-------|---------|
| **Project Name** | XFuel Protocol — [Circuit / Feature Name] |
| **Requested Amount** | $[100,000 – 500,000] USD equivalent |
| **Token** | [NEAR / TAO / AKT / TFUEL / USDC] |
| **Duration** | [6 – 12 months] |
| **Team Size** | [3–8 contributors] <!-- Note: current XFuel submissions use "1 (solo-dev, open-source)" — adjust per context --> |
| **Contact** | [name@xfuel.app] |
| **Website** | [https://xfuel.app](https://xfuel.app) |
| **GitHub** | [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol) |

### 1.1 One-Liner

XFuel Protocol is a modular, ZK-verifiable AI infrastructure layer that [specific benefit for the target ecosystem — e.g., "routes Bittensor subnet inference through zero-knowledge proofs, enabling trustless AI task settlement on TAO EVM"].

### 1.2 Problem Statement

[2-3 paragraphs describing the specific problem this grant addresses. Example:]

Current [ecosystem] AI infrastructure lacks:
- **Verifiability**: No on-chain proof that AI inference was computed correctly.
- **Privacy**: Model weights and proprietary data are exposed during inference.
- **Interoperability**: Siloed compute markets that don't communicate cross-chain.

### 1.3 Proposed Solution

[2-3 paragraphs on how XFuel solves the problem. Reference the specific circuit.]

XFuel's [CircuitName] circuit provides:
- ZK-verified [task/inference/data] settlement using SP1 zkVM (Groth16 ~270K gas).
- Fully isolated, pluggable circuit architecture with no shared state.
- Automatic fee routing to the ecosystem via CoreRevenueSplitter.

---

## 2. Technical Architecture

### 2.1 System Diagram

```
[User/Agent]
     │
     ▼
┌─────────────────────┐    ┌──────────────────┐
│  [CircuitName].sol   │───▶│ CoreRevenueSplitter │
│  (On-chain contract) │    │  (Fee distribution)  │
└────────┬────────────┘    └──────────────────┘
         │
         ▼
┌─────────────────────┐    ┌──────────────────┐
│  circuit-handler.js  │───▶│  SP1 Prover       │
│  (Off-chain logic)   │    │  (ZK proof gen)   │
└─────────────────────┘    └──────────────────┘
```

### 2.2 Core Components

| Component | Description | Status |
|-----------|------------|--------|
| `[CircuitName].sol` | [On-chain Solidity contract — brief description] | [Built / Planned] |
| `[handler].js` | [Off-chain handler — brief description] | [Built / Planned] |
| `CoreRevenueSplitter` | Protocol fee distribution (30% BBB, 30% LP, 25% veXF, 15% Treasury) | Built |
| `ZKVerifierSP1` | SP1 zero-knowledge proof verification | Built |
| `ai-listener.js` | Multi-chain event listener and circuit dispatcher | Built |

### 2.3 Integration with [Ecosystem]

[Describe specific integration points with the target ecosystem. Example for OpenTensor:]

- **Bittensor EVM (Chain ID 964)**: Direct deployment on TAO's EVM layer.
- **Subnet Inference**: XFuel routes subnet tasks via `submitTask()`, settles with ZK proofs.
- **dTAO Staking**: Fee-to-Stake mechanism routes protocol revenue to TAO validators.

---

## 3. Milestones & Deliverables

### Milestone 1: [Foundation] — Month 1-2

| Deliverable | Description | Acceptance Criteria |
|-------------|------------|-------------------|
| Smart contract deployment | Deploy [CircuitName].sol to [ecosystem] testnet | Contract verified on explorer |
| Handler integration | Connect to CoreListener for event processing | Handler responds to [N] event types |
| Test suite | 15 unit tests + 10 integration tests passing | CI green, >90% code coverage |

**Budget: $[25,000 – 50,000]**

### Milestone 2: [Core Features] — Month 3-5

| Deliverable | Description | Acceptance Criteria |
|-------------|------------|-------------------|
| ZK proof pipeline | SP1 prover generates valid proofs for [use case] | Proof verification < 300K gas |
| Fee integration | Protocol fees flow to CoreRevenueSplitter | Fees tracked on [ecosystem] explorer |
| Mainnet deployment | Deploy to [ecosystem] mainnet | 10 successful settlements on mainnet |

**Budget: $[30,000 – 75,000]**

### Milestone 3: [Ecosystem Growth] — Month 6-9

| Deliverable | Description | Acceptance Criteria |
|-------------|------------|-------------------|
| SDK / documentation | Developer docs + integration SDK | Published to npm/docs site |
| Partner integrations | [2-3] ecosystem projects integrated | Live transactions from partners |
| Performance optimization | Settlement gas < 100K | Gas profiling tests passing |

**Budget: $[25,000 – 75,000]**

### Milestone 4: [Scale & Sustain] — Month 10-12

| Deliverable | Description | Acceptance Criteria |
|-------------|------------|-------------------|
| Audit | Third-party smart contract audit | Audit report published |
| Governance handoff | veXF governance for circuit parameters | On-chain vote executed |
| Growth metrics | [1,000+] unique users, [$100K+] TVL | Dashboard metrics verified |

**Budget: $[20,000 – 50,000]**

---

## 4. Team

| Name | Role | Background |
|------|------|-----------|
| [Lead Name] | Protocol Lead | [Brief bio — e.g., "5 years DeFi, previously at X"] |
| [Dev Name] | Smart Contract Engineer | [Brief bio] |
| [Dev Name] | ZK/Prover Engineer | [Brief bio] |
| [Dev Name] | Full-Stack / Frontend | [Brief bio] |

### 4.1 Relevant Experience

- [Previous project 1 — brief description and outcome]
- [Previous project 2 — brief description and outcome]
- XFuel Protocol: [N] circuits built, [N] tests passing, [describe current state]

---

## 5. Budget Summary

| Category | Amount | % |
|----------|--------|---|
| Smart contract development | $[X] | [X]% |
| ZK prover infrastructure | $[X] | [X]% |
| Testing & auditing | $[X] | [X]% |
| Documentation & SDK | $[X] | [X]% |
| Infrastructure (RPC, hosting) | $[X] | [X]% |
| Contingency | $[X] | 10% |
| **Total** | **$[X]** | **100%** |

### 5.1 Payment Schedule

| Milestone | Trigger | Amount |
|-----------|---------|--------|
| M1 complete | Testnet deployment + tests green | $[X] |
| M2 complete | Mainnet deployment + fee flow | $[X] |
| M3 complete | SDK + partner integrations | $[X] |
| M4 complete | Audit + governance | $[X] |

---

## 6. Ecosystem Impact

### 6.1 Value to [Ecosystem]

- **TVL Growth**: XFuel routes [type] through [ecosystem], increasing on-chain activity.
- **Fee Generation**: Protocol fees paid in [native token], increasing token utility.
- **Developer Adoption**: Open-source circuit SDK lowers barrier for new projects.
- **Cross-Chain Reach**: Chain-abstracted design brings users from other ecosystems.

### 6.2 Success Metrics (12 months)

| Metric | Target |
|--------|--------|
| Unique users | [1,000+] |
| Total settlements | [10,000+] |
| TVL | [$100K+] |
| Fees generated | [$10K+] |
| Integrating projects | [5+] |
| GitHub stars | [500+] |

### 6.3 Long-Term Sustainability

- Protocol fees (0.5-1% per settlement) provide self-sustaining revenue.
- veXF governance enables community-driven parameter tuning.
- Modular circuit architecture allows permissionless expansion.

---

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Smart contract vulnerability | Medium | High | Third-party audit (M4); formal verification for critical paths |
| Low adoption | Medium | Medium | Ecosystem partnerships; developer incentives; SDK/docs investment |
| ZK prover latency | Low | Medium | SP1 optimized for RISC-V; recursive proofs for batching |
| Regulatory uncertainty | Low | Low | Non-custodial design; no token issuance in grant scope |

---

## 8. Open Source Commitment

All code produced under this grant will be:
- Licensed under MIT
- Published to [github.com/XFuel-Lab/xfuel-protocol](https://github.com/XFuel-Lab/xfuel-protocol)
- Documented with NatSpec (Solidity) and JSDoc (JavaScript)
- Tested with comprehensive Hardhat test suites

---

## 9. Appendix

### A. Existing Protocol Stats

| Metric | Value |
|--------|-------|
| Total circuits | 21 (4 core + 17 expansion) |
| Total tests | 755+ (85%+ coverage on audit-scope contracts) |
| Solidity contracts | 22 (5 core + 17 circuits) |
| Gas optimized | All settlements < 300K gas |
| ZK backend | SP1 zkVM v6.0.2 (Groth16 + PLONK) |

### B. Reference Documentation

- [WHITEPAPER.md](WHITEPAPER.md) — Full technical architecture (v2.4 — Hybrid Theta-Centric)
- [README.md](README.md) — Setup, testing, deployment guides
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
- [docs/AUDIT_GRANT_READINESS.md](docs/AUDIT_GRANT_READINESS.md) — CertiK Phase 1 readiness checklist

### C. Circuit Architecture

```
contracts/circuits/
├── ThetaInferenceCircuit.sol    # EdgeCloud AI inference (Theta-primary)
├── A2ACircuit.sol               # Agent-to-agent task market
├── ThetaGPUCircuit.sol          # Raw GPU compute leasing
├── DataHubs.sol                 # Data contribution + EdgeStore sealing
├── BridgeCircuit.sol            # Cross-chain ZK bridge
├── InferenceRouter.sol          # Multi-chain inference routing
├── ComputeMarketplace.sol       # DePIN compute marketplace
├── TAOCircuit.sol               # Bittensor dTAO staking
├── ZKMLCircuit.sol              # Private ML inference
├── AkashCircuit.sol             # Akash Network GPU leasing
└── [11 expansion circuits]      # See docs/CIRCUITS.md
```

---

*Template version: 2.0 — XFuel Protocol, March 2026 (v2.4 — Hybrid Theta-Centric Architecture)*
*Adapt sections to match the specific grant program's requirements.*
