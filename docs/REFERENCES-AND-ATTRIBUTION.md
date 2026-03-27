# XFuel Protocol — References & Attribution

> This document provides formal attribution for third-party research, papers, and open-source work integrated into or referenced by XFuel Protocol. We give full credit to authors and sources and comply with academic and open-source citation norms.

---

## Phase 1 Research Integration

XFuel's Phase 1 ZK Research Upgrade (see [ZK-RESEARCH-UPGRADE-PACKAGE.md](ZK-RESEARCH-UPGRADE-PACKAGE.md) and [PHASE1_KICKOFF.md](PHASE1_KICKOFF.md)) integrates two research lines with explicit attribution below.

---

### zkGPT — Non-Interactive ZK for LLM Inference

**Use in XFuel:** Optional proof path for `inference_request` when `proof_system: zkgpt` is specified. A dedicated verifier contract (`ZKVerifierZkGPT.sol`) and prover integration path (`zkgpt-prover/`) implement or reference the zkGPT design. SP1 remains the default; zkGPT runs as a parallel path for LLM inference.

| Item | Attribution |
|------|-------------|
| **Paper** | *zkGPT: Efficient Non-Interactive Zero-Knowledge Proof Framework for Large Language Model Inference* |
| **Eprint** | [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184) |
| **Authors / Institution** | NUS / HKUST (see paper for full author list). Author GitHub: [jiahengzhang](https://github.com/jiahengzhang). |
| **Open-source implementation** | [github.com/security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt) (C++; GKR + Lasso; BN254; Hyrax). |
| **Technical summary** | GKR (sumcheck) + Lasso (lookup); ~101 KB proof; non-interactive; BN254; GPT-2 inference proof in &lt;25 s. |

**XFuel integration:** Inference tasks may request `proof_system: "zkgpt"` via M2M API. The verifier stub lives in `contracts/core/ZKVerifierZkGPT.sol`; the prover integration is scaffolded in `zkgpt-prover/` and follows the upstream zkGPT construction. See [research/zkGPT-feasibility-memo.md](research/zkGPT-feasibility-memo.md).

---

### Fair Exchange (Proxy Adaptor Signatures — PAS)

**Use in XFuel:** A2A bid settlement can be performed via a PAS-adapted signature instead of a ZK proof, giving cryptographic atomicity between payment release and result delivery. Implemented in `A2ACircuit.settleBidFairExchange()` and M2M endpoint `POST /a2a-settle-fair-exchange`.

| Item | Attribution |
|------|-------------|
| **Paper** | *Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM* |
| **Eprint** | [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395) |
| **Authors** | See paper for full author list. |
| **Technical summary** | Proxy Adaptor Signatures (PAS): buyer delegates to proxies; seller obtains an adapted signature only upon revealing the witness (result); contract verifies the signature and releases escrow. Compatible with EVM (standard signature verification). |

**XFuel integration:** The requester (buyer) and provider (seller) exchange payment and result atomically. The contract verifies an ECDSA signature over a canonical message (bidId, provider, acceptedPrice) from a registered `fairExchangeProxy` address. Design details: [research/fair-exchange-design-memo.md](research/fair-exchange-design-memo.md).

---

## Interstellar (GKR-Based IVC — Research Track)

**Use in XFuel:** Tracked as a future prover-side upgrade (no on-chain contract changes). Documented in WHITEPAPER Section 12 and ZK-RESEARCH-PIPELINE.

| Item | Attribution |
|------|-------------|
| **Paper** | *Interstellar* (GKR-based IVC folding) |
| **Eprint** | [eprint.iacr.org/2025/1294](https://eprint.iacr.org/2025/1294) |
| **Authors** | Jieyi Long, Theta Labs. Published PKC 2026. |

---

## Other Referenced Research

The full set of ZK and DePIN research considered by XFuel (zkML, collaborative SNARKs, distributed proving, etc.) is listed with eprint links and status in [ZK-RESEARCH-PIPELINE.md](ZK-RESEARCH-PIPELINE.md). That document is the single pipeline for prioritization and attribution of papers.

---

## Compliance & Licensing

- **Academic citation:** When referencing XFuel’s use of zkGPT or Fair Exchange (PAS) in publications or materials, please cite the original eprint papers above.
- **Open-source:** XFuel’s integration code is under the repository’s license (see [LICENSE](../LICENSE)). The zkGPT upstream repository (security-Anonymous/zkgpt) has its own license; we do not redistribute it — we reference it and document integration points.
- **Trademarks / names:** “zkGPT” and “Interstellar” refer to the cited works; XFuel does not claim ownership of these names.

---

*Last updated: March 2026. For Phase 1 implementation status, see [PHASE1_KICKOFF.md](PHASE1_KICKOFF.md).*
