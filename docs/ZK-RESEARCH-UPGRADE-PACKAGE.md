# XFuel — Unified ZK Research Upgrade Package

> **One project, one roadmap.** This document bundles the best improvements from [ZK-RESEARCH-PIPELINE.md](./ZK-RESEARCH-PIPELINE.md) into a single, non-overlapping upgrade package for XFuel. Each area gets exactly one primary improvement (or one complementary set); optional and deferred items are called out so the stack stays coherent.

**Design principles:**
- **No overlap** — one best-in-class choice per capability (e.g. one collaborative prover path, one zkML front-end).
- **Compatibility-first** — exclude tech that requires a different proof system or is blocked on tooling.
- **Unified sequencing** — phases (Ship → Stack → Privacy → Scale → Coverage) so migrations don’t conflict.
- **Single doc** — this package is the execution view; the pipeline doc remains the research source of truth.

---

## Package at a Glance

| Phase | Name | What it is | Overlaps avoided |
|-------|------|------------|-------------------|
| **1 — Ship** | Core product | zkGPT + Fair Exchange | Replaces/wraps current zkML + A2A flow; no second LLM proof system. |
| **2 — Stack** | zkML efficiency | 2026/111 + 2025/507 + Sparsity-Aware | Complements zkGPT (matrix + activations + quantized); no duplicate circuit work. |
| **3 — Privacy** | Input privacy | Collaborative SNARK (2024/940+143 → 2025/1388) + single-server (2025/2113) | One privacy layer, two modes (multi-node / single-node). |
| **4 — Scale** | Verifier + accountability | Mira + Cirrus | Mira = batch verification; Cirrus = distributed proving + slashing; no second aggregation scheme. |
| **5 — Coverage** | Model + agents | VerfCNN, zkRNN, zkAgent | One circuit per model class (vision, RNN, multi-step); no overlap with zkGPT (LLM). |
| **6 — Premium** | Tiers + DataHubs | High-precision (2025/1732), Keccacheck, optional MPC, DataHubs | Optional add-ons; no replacement of core proof path. |
| **Optional** | Prover path | Interstellar (when available) | Adopt only if Theta EdgeCloud offers it and it wins benchmarks; otherwise SP1 + above. |

**Explicitly out of scope (this package):** Post-quantum (LatticeFold, Neo, Symphony), PoUW/consensus (2025/685), second MPC stack (pick one of Mosformer/PIGEON if adding MPC), and any second collaborative prover (either 2024/940+143/2025/1388 **or** Interstellar, not both in the same role).

---

## Phase 1 — Ship: Core Product

**Goal:** Highest impact with minimal scope creep. zkGPT = **inference prover path**. **Phase 1 scope:** second verifier only; wrapper and zkVM-style work are **future / bounty** (below).

| Improvement | Source | XFuel surface | Contract impact |
|-------------|--------|---------------|-----------------|
| **zkGPT** | 2025/1184 | `inference_request`, ZKMLCircuit / ThetaInferenceCircuit | New `ZKVerifierZkGPT` for inference; routing chooses SP1 vs ZkGPT by `proof_system` |
| **Fair Exchange** | 2026/395 | A2A `settleBid`, escrow (`createEscrow` / `claimEscrow`) | Potential new primitive in A2ACircuit |

**Why these two only:**  
zkGPT is the single drop-in LLM proof system (non-interactive, model-privacy, direct fit for `inference_request`). Fair Exchange is the single cryptographic primitive that makes payment ↔ result atomic for A2A. No other item in the pipeline replaces these roles.

**zkGPT in Phase 1:** Use **second verifier** (`ZKVerifierZkGPT`). Integrate zkGPT prover; for inference with `proof_system: zkgpt`, call the new verifier. Settlement unchanged. **Impact:** One contract + one routing branch; each tx verifies one proof (no extra per-tx cost); minimal perf impact. **Future / bounty (out of Phase 1):** (1) **Wrapper** — zkGPT π → Groth16 Π → `ZKVerifierSP1`; single on-chain verifier if delivered. (2) **zkVM-friendly LLM proving** — zkGPT-style ideas inside SP1/zkVM; publishable. See [PHASE1_INTEGRATION_PLAN.md](./PHASE1_INTEGRATION_PLAN.md) § 0.

**Deliverables (Phase 1):**
- [ ] zkGPT: integrate prover (e.g. upstream repo); deploy `ZKVerifierZkGPT`; add `proof_system: zkgpt` to task request and wire ZKMLCircuit. Settlement unchanged.
- [ ] Fair Exchange: map primitive to `settleBid(bidId, resultHash, proofBytes, nullifier)`; prototype atomic settle; SDK `client.settleWithFairExchange(bidId, result)`.

**Reference:** Pipeline § zkGPT, § Fair Exchange.

---

## Phase 2 — Stack: zkML Efficiency

**Goal:** Full zkML proving stack for LLM inference (memory, activations, quantized) without introducing a second LLM proof system.

| Improvement | Source | Role | Contract impact |
|-------------|--------|------|-----------------|
| **Structured matrix constraints** | 2026/111 | Linear/matrix layers; lower memory, same verification | Possible public-values format for zkML |
| **Non-linear ML in ZK** | 2025/507 | ReLU/GELU/softmax via table lookup; no activation blow-up | None |
| **Sparsity-Aware ZK for quantized models** | 2024/1018 | Exploit pruning/quantization in ZK; aligns with `"variant": "quantized"` | None |

**Overlap rule:** 2026/111 and 2025/507 are **complements** to zkGPT (matrix vs activations). Sparsity-Aware is the single ZK-friendly quantized/pruned framework; we do not also add 2024/1132 (PPML quantized) as a second quantized path in this package.

**Deliverables:**
- [ ] After zkGPT path is clear: evaluate 2026/111 for ZKMLCircuit_v2 matrix side; 2025/507 for activation side; Sparsity-Aware for quantized variant.
- [ ] Single unified zkML benchmark: zkGPT + 2026/111 + 2025/507 (+ Sparsity-Aware for quantized).

**Reference:** Pipeline § 2026/111, § 2025/507, § Sparsity-Aware (Tier 2).

---

## Phase 3 — Privacy: Input Privacy (Provider Never Sees Witness)

**Goal:** One cryptographically enforced “provider doesn’t see input” path, with two modes: multi-node (collaborative) and single-node (single-server delegation).

| Improvement | Source | Mode | Contract impact |
|-------------|--------|------|-----------------|
| **Collaborative zk-SNARK** | 2024/940 + 2024/143; upgrade path 2025/1388 | Multi-node: no single server sees witness; malicious security (143); later sublinear prover (1388) | None |
| **Single-server private delegation** | 2025/2113 | Single-node: one EdgeCloud node produces proof without learning witness | None |

**Overlap rule:** We pick **one** collaborative construction (2024/940+143 first, then 2025/1388 when ready). We do not also adopt Interstellar in the same role; Interstellar is an optional **prover backend** (Phase 6 Optional). 2025/2113 is the only single-server private-delegation option in the package.

**Deliverables:**
- [ ] Implement as `SP1_PROVER=collaborative` (2024/940+143), then evaluate 2025/1388 as replacement for lower per-server cost.
- [ ] Implement as `privacy_mode: true` (or similar) using 2025/2113 for single-node routing.
- [ ] Document in `docs/security-design.md` and `docs/M2M_API.md`.

**Reference:** Pipeline § 2024/940 + 143, § 2025/1388 (Tier 2), § 2025/2113.

---

## Phase 4 — Scale: Verifier + Distributed Accountability

**Goal:** Cheaper batch verification and cryptographically accountable distributed proving (identify malicious prover, enable slashing).

| Improvement | Source | Role | Contract impact |
|-------------|--------|------|-----------------|
| **Mira** | 2024/2025 | Cheaper Groth16 (and KZG) aggregation for `verifyMultiLevelRecursive` | None |
| **Cirrus** | 2024/1873 | Distributed SNARK with accountability: identify faulty worker, hierarchical aggregation | None; optional hook e.g. `ProviderSlashed(workerId)` in A2ACircuit |

**Overlap rule:** One aggregation story: **Mira** for Groth16 batch verification. One distributed-accountability story: **Cirrus** (we do not add Hekaton as a second accountable distributed prover in this package; Hekaton remains fallback if Cirrus doesn’t compose with SP1). Quasar (sublinear accumulation) could be added later as a verifier-side optimization; it does not replace Mira (aggregation vs accumulation).

**Deliverables:**
- [ ] Mira: assess drop-in compatibility with SP1/Groth16 aggregation; benchmark vs current recursive STARK + wrap; implement as `AGGREGATOR=mira` (or equivalent) for rollup batch settlement.
- [ ] Cirrus: prototype 2-worker Cirrus for a simple inference circuit; benchmark; integrate accountability so malicious-worker detection can emit slashing/reputation events.

**Reference:** Pipeline § Mira, § Cirrus.

---

## Phase 5 — Coverage: Model Classes + Multi-Step Agents

**Goal:** One best-in-class circuit or extension per model/execution class, without duplicating zkGPT (LLM).

| Improvement | Source | XFuel surface | Contract impact |
|-------------|--------|---------------|-----------------|
| **VerfCNN** | 2025/2020 | Vision/CNN inference (image classification, detection, etc.) | None |
| **zkRNN** | 2026/073 | RNN inference (LSTM, GRU, Mamba-style); streaming/long-context | None |
| **zkAgent** | 2026/199 | Multi-step agent execution (tools, calls, multi-turn); one proof for full trace | New AgentExecutionCircuit possible; no core contract change |

**Overlap rule:** zkGPT = LLM. VerfCNN = vision. zkRNN = sequential/RNN. zkAgent = multi-step agent trace. No second vision or RNN proof system in this package.

**Deliverables:**
- [ ] VerfCNN: when vision inference is on roadmap; prototype `ZKVisionCircuit` (e.g. ResNet-50 or ViT); benchmark vs SP1 zkVM.
- [ ] zkRNN: when RNN models are on roadmap; assess architectures (LSTM, GRU, Mamba); prototype ZKRNNCircuit.
- [ ] zkAgent: design AgentExecutionCircuit extending A2A; prototype 3-step execution (query → infer → return) as one proof; SDK `client.proveAgentExecution(trace)`.

**Reference:** Pipeline § VerfCNN, § zkRNN, § zkAgent.

---

## Phase 6 — Premium: Tiers, Nullifier, DataHubs, Optional MPC

**Goal:** Optional tiers and infrastructure improvements that do not replace the core proof path.

| Improvement | Source | Role | Contract impact |
|-------------|--------|------|-----------------|
| **High-precision ZK inference** | 2025/1732 | Enterprise/DataHubs; full-precision provenance | None; optional `precision_mode: full` |
| **Keccacheck** | 2025/1764 | SNARK-friendly Keccak; lower cost of nullifier/replay protection | None (circuit-side only) |
| **DataHubs provenance** | 2021/1633 (design) + Janus 2023/1377 (TLS-scale) | Verifiable pipeline design + TLS-scale provenance for attestation | None |
| **Optional MPC (input privacy)** | One of Mosformer (2025/1510) or PIGEON (2024/1371) | Premium privacy tier: MPC during inference, ZK for settlement | None |

**Overlap rule:** One high-precision path (2025/1732). One Keccak optimization (Keccacheck; we do not also switch to Symphony’s “no in-circuit hash” in this package). One MPC option if we add a premium privacy tier (choose either Mosformer or PIGEON, not both). DataHubs: 2021/1633 as design reference, Janus as implementation-oriented provenance.

**Deliverables:**
- [ ] 2025/1732: evaluate as premium `precision_mode: full`; DataHubs circuit if required for provenance.
- [ ] Keccacheck: integrate into nullifier/witness path; measure proof-time reduction.
- [ ] DataHubs: use 2021/1633 for pipeline design; evaluate Janus for TLS-scale attestation.
- [ ] MPC: if offering premium privacy, pick Mosformer or PIGEON; implement as `privacy_mode: malicious` (or similar).

**Reference:** Pipeline § 2025/1732, § Keccacheck (Tier 2), § 2021/1633, § Janus (Tier 3), § Mosformer, § PIGEON.

---

## Optional: Alternative Prover Path (Interstellar)

**When to consider:** Theta EdgeCloud offers an Interstellar prover **and** benchmarks show clear gain over the current SP1 path **and** you want a GKR-based backend for matrix workloads.

| Improvement | Source | Role | Contract impact |
|-------------|--------|------|-----------------|
| **Interstellar** | 2025/1294 | GKR-based IVC + collaborative folding; 1.59x–6.74x prover speedup on matrix workloads | None (final proof still Groth16/PLONK) |

**Overlap rule:** If Interstellar is adopted, it is the **prover backend** for matrix/zkML and (with GKR Boolean 2025/717) potentially for non-ML circuits. We do **not** run both Interstellar and 2024/940+143 as two separate “collaborative” paths; we choose one. If Interstellar is not adopted, the package relies on SP1 + 2024/940+143 (and Cirrus) for collaborative and accountability.

**Deliverables (only if adopted):**
- [ ] Engage Theta Labs on EdgeCloud prover availability.
- [ ] Benchmark vs SP1 on llama-3-70b + nullifier workloads.
- [ ] Add `SP1_PROVER=interstellar` when production-ready; optional GKR Boolean (2025/717) for bridge/governance circuits.

**Reference:** Pipeline § Interstellar, § Interstellar-Optimized Stack.

---

## What This Package Explicitly Excludes

To keep one coherent stack and avoid overlap or blocked work:

| Category | Excluded | Reason |
|----------|----------|--------|
| **Post-quantum** | LatticeFold, Neo, Symphony, Lova, UltraFold, DeepFold | Defer until PQ timeline hardens; no product dependency in this package. |
| **Consensus** | 2025/685 (PoUW) | Strategic only; would need new consensus circuit; not part of this upgrade. |
| **Second collaborative prover** | Running both 2024/940 and Interstellar in the same role | Choose one: either collaborative SNARK (940+143/1388) or Interstellar when available. |
| **Second quantized ZK** | Both 2024/1132 (PPML quantized) and Sparsity-Aware | One quantized path: Sparsity-Aware (ZK-native) in this package. |
| **Second aggregation** | Hekaton as primary | Cirrus is primary accountable distributed prover; Hekaton as fallback only. |
| **Second MPC stack** | Both Mosformer and PIGEON | At most one MPC add-on for premium privacy. |
| **In-circuit hash removal** | Symphony (no in-circuit hash) in this package | Keccacheck gives immediate gain; Symphony is larger change (lattice-based); defer to PQ or later. |
| **Generic compute** | Arbigraph (2025/710) | Extension for non-ML `compute_bid`; out of scope until we expand beyond ML-specific circuits. |

---

## Dependency Order (No Parallel Proof-System Migrations)

Respect the pipeline’s “one proof-system migration at a time” rule:

1. **Phase 1** (zkGPT + Fair Exchange) — unblocked; ship first.
2. **Phase 2** (2026/111, 2025/507, Sparsity-Aware) — after zkGPT path is clear.
3. **Phase 3** (Collaborative + 2025/2113) — independent of 1–2; can run after or in parallel with 2.
4. **Phase 4** (Mira + Cirrus) — verifier and distribution; after or in parallel with 3.
5. **Phase 5** (VerfCNN, zkRNN, zkAgent) — as product needs appear; can follow 2.
6. **Phase 6** (Premium + Keccacheck + DataHubs + optional MPC) — optional; no block on 1–5.
7. **Interstellar** — only if adopted; then evaluate as prover backend without redoing 1–5 (circuit/verifier choices like zkGPT, Mira still apply).

---

## Summary Table: One Primary Per Area

| Area | Primary choice | Alternative not in package |
|------|----------------|----------------------------|
| LLM inference proof | zkGPT | — |
| A2A atomic payment↔result | Fair Exchange | — |
| zkML matrix/memory | 2026/111 | — |
| zkML activations | 2025/507 | — |
| zkML quantized | Sparsity-Aware | 2024/1132 (PPML) |
| Input privacy (multi-node) | 2024/940+143 → 2025/1388 | Interstellar (different prover path) |
| Input privacy (single-node) | 2025/2113 | — |
| Batch verification | Mira | — |
| Distributed + accountability | Cirrus | Hekaton (fallback) |
| Vision/CNN | VerfCNN | — |
| RNN/sequential | zkRNN | — |
| Multi-step agent | zkAgent | — |
| High-precision tier | 2025/1732 | — |
| Nullifier/circuit cost | Keccacheck | Symphony (defer) |
| DataHubs design + attestation | 2021/1633 + Janus | — |
| Premium MPC (optional) | One of Mosformer / PIGEON | — |
| Optional prover backend | Interstellar (when available) | — |

---

*Source: [ZK-RESEARCH-PIPELINE.md](./ZK-RESEARCH-PIPELINE.md). Last updated: March 2026.*
