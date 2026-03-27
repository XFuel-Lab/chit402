# XFuel Protocol — ZK Research Pipeline

> Tracking cryptographic research relevant to XFuel's ZK stack, zkML circuits, distributed proving, and privacy infrastructure. Updated as new papers are reviewed.
>
> **Licensing:** All IACR ePrint papers are open-access academic research. Implementations derived from these constructions are generally permissible (most associated code is MIT/Apache 2.0). No licensing fees apply. Confirm any specific code repo license before integrating.

---

## How to Read This File

Each entry is classified by:

- **Priority** — `High` (implement when feasible), `Medium` (track and evaluate), `Monitor` (keep watching)
- **Affects** — which part of XFuel's stack the paper targets
- **Status** — `Pending toolchain` / `Researchable now` / `Prototype-ready` / `Blocked on dependency`
- **No contract changes** flag — most prover-side improvements do NOT require modifying `contracts/core/`

---

## Product-Fit Shortlist (Highest Impact)

Filtered view: papers and directions that move shipped product the most, with minimal scope creep. Use this to decide **what to prototype first** and what to defer.

| Priority | Item | Product fit | Why now |
|----------|------|-------------|---------|
| **P0 — Ship** | **zkGPT** (2025/1184) | `inference_request` integrity | Drop-in LLM proof system; model-privacy + non-interactive; direct replacement path for current zkML pipeline. |
| **P0 — Ship** | **Fair Exchange** (2026/395) | A2A `settleBid` / escrow | Atomic payment ↔ result; no contract redesign, extends existing `A2ACircuit`. |
| **P1 — Evaluate** | **Interstellar** (2025/1294) | Prover cost + swarm | One possible prover path; Theta-first, collaborative folding. Adopt only if it proves necessary and aligned with chosen stack; see Tier 1 breakdown. |
| **P1 — Next quarter** | **2026/111** (matrix constraints) | zkML memory/cost | Removes R1CS bottleneck for large models; pair with zkGPT for full zkML stack. |
| **P1 — Next quarter** | **2025/507** (non-linear/activations) | zkML proving time | Complements 2026/111; ReLU/GELU/softmax in ZK without blow-up. |
| **P1 — Next quarter** | **2024/940 + 2024/143** (collaborative SNARK) | Input privacy for routing | Provider never sees witness; implement as `SP1_PROVER=collaborative` when ready. |
| **P1 — Next quarter** | **zkAgent** (2026/199) | Multi-step agent execution | One proof for full agent trace; extends A2A value prop without new core contracts. |
| **P1 — Next quarter** | **Mira** (2024/2025) | Rollup batch verification | Cheaper Groth16 aggregation for `verifyMultiLevelRecursive`; low integration risk. |
| **P2 — This year** | **2025/1732** (high-precision zkML) | Enterprise + DataHubs | Full-precision provenance; premium tier and DataHubs integrity. |
| **P2 — This year** | **Cirrus** (2024/1873) | Swarm accountability | Identify malicious prover; slashing + DePIN reputation; pairs with any collaborative prover (e.g. 2024/940 or Interstellar if adopted). |
| **P2 — This year** | **VerfCNN + zkRNN** | Vision + sequential models | Complete model coverage (LLM + CNN + RNN) for EdgeCloud catalog. |
| **P2 — This year** | **2021/1633 + Janus** | DataHubs provenance | Foundational pipeline + TLS-scale provenance for attestation. |
| **Defer** | Post-quantum (LatticeFold, Neo, Symphony) | Long-term verifier | Track; no product dependency until PQ timeline hardens. |
| **Defer** | Consensus / PoUW (2025/685) | Theta alignment | Strategic only; no immediate contract or prover change. |

**Rule of thumb:** Prefer items that (a) need **no or minimal contract changes**, (b) map to a **single XFuel surface** (e.g. inference, A2A, rollup), and (c) have a **clear “replace or wrap existing component”** path.

**→ Execution view:** For a single bundled, non-overlapping upgrade roadmap cherry-picking the best per area, see **[ZK-RESEARCH-UPGRADE-PACKAGE.md](./ZK-RESEARCH-UPGRADE-PACKAGE.md)**.

---

## Tier 1 Breakdown — All Findings Digest

Structured digest of every Tier 1 entry: what it is, how it affects the project (upgrade / shift / conversion), and how to treat it so upgrades are digested in the right order.

| # | Finding | What it is | Type | Contract impact | How to treat it |
|---|---------|------------|------|-----------------|-----------------|
| 1 | **Interstellar** (2025/1294) | GKR-based IVC + collaborative folding; 1.59x–6.74x prover speedup on matrix workloads; multi-prover → one proof. | **Optional prover path** | None | One possible direction, not mandatory. Adopt only if (a) Theta EdgeCloud offers the prover, (b) benchmarks beat current SP1 path, and (c) you want to standardize on GKR. Otherwise keep SP1 + other Tier 1 options. |
| 2 | **zkGPT** (2025/1184) | Non-interactive ZK for LLM inference; model-privacy; built for "prove correct inference without revealing weights." | **Upgrade** (prover/circuit) | None | Strong product fit for `inference_request`. Treat as primary candidate to improve or replace current zkML pipeline. No stack conversion — wrap or replace ZKMLCircuit. |
| 3 | **High-precision ZK inference** (2025/1732) | Full-precision (non-quantized) ZK ML inference without prohibitive circuit cost. | **Upgrade** (prover) | None | Premium tier + DataHubs. Add when enterprise/full-precision demand is clear; not required for initial launch. |
| 4 | **Structured matrix constraints** (2026/111) | Replaces R1CS with structured matrix constraint systems for NN inference; lower memory, same verification. | **Upgrade** (prover/circuit) | Possible public-values format change | Reduces zkML memory/cost bottleneck. Pair with zkGPT or current pipeline; evaluate as ZKMLCircuit_v2. |
| 5 | **Collaborative zk-SNARK** (2024/940 + 143) | Distributed proof generation; no single server sees the witness; 2024/143 adds malicious security. | **Upgrade** (prover/orchestration) | None | Delivers "provider never sees input" without changing settlement. Implement as optional prover mode; independent of choosing Interstellar. |
| 6 | **Non-linear ML in ZK** (2025/507) | Table-lookup-based ZK for ReLU/GELU/softmax so activations don't blow up circuit size. | **Upgrade** (prover) | None | Complements 2026/111 (linear) for full zkML stack. Adopt when optimizing transformer proving. |
| 7 | **Fair Exchange** (2026/395) | Cryptographic fair exchange: payment and result atomically linked; no party can cheat. | **Upgrade** (circuit/flow) | Potential new primitive in A2A | Direct fit for `settleBid` / escrow. Harden existing flow; no product pivot. |
| 8 | **zkAgent** (2026/199) | One-shot ZK proof for full multi-step LLM agent execution (tools, calls, multi-turn). | **Upgrade** (circuit) | New AgentExecutionCircuit possible | Extends A2A with verified agent traces. Add when multi-step agent verification is a product requirement. |
| 9 | **zkRNN** (2026/073) | ZK proofs for RNN inference (LSTM, GRU, Mamba-style). | **Upgrade** (prover/circuit) | None | Expands model coverage for streaming/long-context. Add when RNN models are on the roadmap. |
| 10 | **VerfCNN** (2025/2020) | Optimally efficient zkSNARK for CNNs (vision). Same lineage as zkGPT. | **Upgrade** (prover/circuit) | None | Vision/CNN coverage. Add when offering verified vision inference. |
| 11 | **Verifiable decentralized AI pipelines** (2021/1633) | Foundational framework: verifiable provenance across data → compute → verification across orgs. | **Reference / design** | None | Use as theoretical grounding for DataHubs and pipeline design; not an implementation drop-in. |
| 12 | **Arbigraph** (2025/710) | Verifiable delegation of arbitrary Turing-complete execution (not only ML). | **Extension** (orchestration) | None | For `compute_bid` and general HPC; adopt when expanding beyond ML-specific circuits. |
| 13 | **Proofs of useful work** (2025/685) | PoW replaced with useful matrix multiplication (AI compute); miner input constrained. | **Strategic / future** | Would need new consensus circuit | Long-term consensus alignment with Theta. Monitor; no immediate conversion. |
| 14 | **Mira** (2024/2025) | Cheaper aggregation of Groth16 (and KZG) arguments for batch verification. | **Upgrade** (verifier) | None | Reduces cost of `verifyMultiLevelRecursive`. Low-risk verifier-side option. |
| 15 | **Private GPT** (2025/2251) | Public decoding + secure verification; only input/output private. | **Upgrade** (architecture) | None | Validates "prove correctness, hide I/O" split. Use to inform verification design; MPC side optional. |
| 16 | **Mosformer** (2025/1510) | Maliciously secure 3-party MPC for transformer inference (input privacy). | **Add-on** (MPC layer) | None | Complements ZK: MPC for privacy during inference, ZK for settlement. Premium privacy tier. |
| 17 | **PIGEON** (2024/1371) | GPU-accelerated MPC for private NN inference; practical throughput. | **Add-on** (MPC layer) | None | Same as above: optional privacy layer; ZK remains for on-chain correctness. |
| 18 | **PPML for quantized models** (2024/1132) | Privacy-preserving ML designed for quantized models (first-class). | **Upgrade** (prover) | None | Aligns with existing `"variant": "quantized"`; evaluate for ZKMLCircuit quantized path. |
| 19 | **Mystique** (2021/730) | Foundational ZK for private ML inference; mixed arithmetic/boolean; open-source. | **Reference** | None | Background reading for ZKMLCircuit_v2; no mandatory conversion. |
| 20 | **Single-server private delegation** (2025/2113) | One untrusted server produces proof without learning witness. | **Upgrade** (prover) | None | Single-node version of "provider doesn't see input." Opt-in `privacy_mode` when routing to one EdgeCloud node. |

### Summary by type

- **Upgrade (no product pivot):** zkGPT, 2026/111, 2025/507, 2024/940+143, Fair Exchange, zkAgent, zkRNN, VerfCNN, Mira, 2025/1732, 2024/1132, 2025/2113 — improve or extend existing surfaces.
- **Optional prover path:** Interstellar — adopt only if it proves necessary and aligned; not a requirement.
- **Add-on / complement:** Mosformer, PIGEON, 2025/2251 — MPC or architectural ideas alongside current ZK stack.
- **Reference / design:** 2021/1633, Mystique — inform design; no direct "convert to this."
- **Extension:** Arbigraph — for non-ML compute when you expand scope.
- **Strategic / monitor:** 2025/685 (PoUW) — no immediate conversion.

### Suggested digestion order

1. **Core product:** zkGPT (inference) and Fair Exchange (A2A) — highest impact, minimal scope creep.
2. **zkML stack:** 2026/111 + 2025/507 (and optionally 2024/1132) — once zkGPT path is clear.
3. **Privacy:** 2024/940+143 or 2025/2113 — when "provider doesn't see input" is a requirement.
4. **Verifier / batch:** Mira — when optimizing rollup verification cost.
5. **Broader coverage:** zkAgent, VerfCNN, zkRNN — as product needs (multi-step agents, vision, RNN) appear.
6. **Prover alternatives:** Interstellar only if Theta path and benchmarks justify it; otherwise 2024/940 + Cirrus (Tier 2) for collaborative + accountability.

---

## Tier 1 — High Priority

### Interstellar: GKR-based IVC with Collaborative Folding
**Paper:** [eprint.iacr.org/2025/1294](https://eprint.iacr.org/2025/1294)
**Authors:** Jieyi Long (Theta Labs)
**Venue:** PKC 2026
**Affects:** `sp1-prover/`, zkML inference circuits
**Status:** Pending toolchain (not yet in SP1; await Theta EdgeCloud prover)
**Contract changes:** None — final proof remains Groth16/PLONK

**Why it matters:**
- **1.59x–6.74x prover speedup** on matrix/transformer workloads — directly cuts cost and latency of `inference_request` proofs
- **Collaborative folding** — multiple provers with disjoint private witnesses produce a single joint IVC proof, the cryptographic primitive needed for ZK-verified swarm tasks (`formSwarm → joinSwarm → settleSwarmAgent`)
- Authored by Theta Labs — first-party upgrade path to XFuel's primary infrastructure chain

**Implementation path:**
- [ ] Engage Theta Labs team on EdgeCloud prover availability
- [ ] Benchmark vs SP1 STARK aggregation on llama-3-70b + MiMC nullifier workloads
- [ ] Prototype collaborative folding for 2-prover swarm task in `sp1-prover/`
- [ ] Add `SP1_PROVER=interstellar` env option when production-ready
- [ ] Update `SP1ProofHooks.sol` NatSpec (no ABI changes)

---

### zkGPT: Efficient Non-Interactive ZK Proof Framework for LLM Inference
**Paper:** [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184)
**Authors:** Wenjie Qu, Yijun Sun, Xuanming Liu, Tao Lu, Yanpei Guo, Kai Chen, Jiaheng Zhang
**Venue:** 2025
**Affects:** `sp1-prover/`, `contracts/circuits/ZKMLCircuit.sol`, `ThetaInferenceCircuit`
**Status:** Researchable now — highly actionable
**Contract changes:** None (prover-side only)

**Why it matters:**
This is the closest thing to a drop-in proof system for XFuel's primary use case. The abstract is explicit: "service providers may deploy smaller models to reduce costs, potentially deceiving users — ZKPs allow providers to prove LLM inference without compromising the privacy of model parameters." That is *precisely* XFuel's `inference_request` integrity guarantee.

Three properties make this immediately relevant:
1. **Non-interactive** — compatible with XFuel's async task/settle flow (no back-and-forth between prover and verifier)
2. **Supports LLM architectures** — prior zkML work didn't support transformers at scale; zkGPT does
3. **Model parameter privacy** — the GPU provider can prove it ran the correct model without revealing weights, directly supporting EdgeCloud dedicated deployments with proprietary fine-tuned models

**Complementary with 2026/111 + 2025/507:** zkGPT provides the end-to-end LLM-specific proof system; the matrix constraint paper (2026/111) improves the linear layer efficiency; the non-linear function paper (2025/507) handles activations. These three together form a complete zkML proving stack for LLM inference.

**Implementation path:**
- [ ] Read zkGPT paper fully — assess whether it replaces SP1 zkVM approach or layers on top
- [ ] Identify if zkGPT has an open-source implementation (check author GitHub: jiahengzhang)
- [ ] Prototype proof of a single transformer block (attention + FFN) using zkGPT framework
- [ ] Benchmark against current SP1 approach on Theta EdgeCloud quantized model
- [ ] If viable: integrate as `ZKMLCircuit_v2` with `proof_system: zkgpt` mode in task request
- [ ] Potential whitepaper angle: "XFuel uses zkGPT to prove LLM inference integrity on-chain"

---

### Zero-Knowledge AI Inference with High Precision
**Paper:** [eprint.iacr.org/2025/1732](https://eprint.iacr.org/2025/1732)
**Authors:** Arman Riasi, Haodi Wang, Rouzbeh Behnia, Viet Vo, Thang Hoang
**Venue:** Sep 2025
**Affects:** `sp1-prover/`, zkML circuits, DataHubs
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
Addresses the precision problem in ZK ML inference — existing zkML approaches require quantization or approximation that degrades model quality, because full-precision floating point is expensive in circuits. This paper provides **high-precision** ZK inference, meaning you can prove the output of a full-precision model (not just a quantized approximation) without the astronomical circuit overhead.

For XFuel this matters on two levels:
1. **Enterprise/professional use cases** — users who need provably accurate inference (medical, financial, legal) can't accept quantization artifacts. High-precision zkML unlocks these markets.
2. **DataHubs provenance** — proving that a specific dataset produced a specific model output with full precision is a core DataHubs integrity guarantee. Low-precision proofs undermine that.

The paper focuses on the AIaaS (AI as a Service) threat model — exactly XFuel's `inference_request` model where the service provider (EdgeCloud GPU) might cheat.

**Implementation path:**
- [ ] Evaluate precision vs proof size tradeoff — understand what "high precision" costs in proof generation time
- [ ] Compare against quantized approach: quantized model + Sparsity-Aware (2024/1018) vs full-precision + this paper
- [ ] Consider as a premium `precision_mode: full` option in the task request API
- [ ] DataHubs circuit: assess whether this is required for provenance guarantees

---

### Structured Matrix Constraint Systems for Architecture-Hiding zkML
**Paper:** [eprint.iacr.org/2026/111](https://eprint.iacr.org/2026/111)
**Authors:** Mingshu Cong, Sherman S. M. Chow, Tsz Hon Yuen, Siu-Ming Yiu
**Venue:** Jan 2026
**Affects:** `contracts/circuits/ZKMLCircuit.sol`, `sp1-prover/`
**Status:** Researchable now
**Contract changes:** Possible — proof public values format may change for zkML circuits

**Why it matters:**
The core problem with current SP1 zkML: "general-purpose zkSNARKs do not scale in zkML because compiling matrix-heavy NNs into arithmetic circuits is memory-prohibitive." This paper removes the R1CS circuit representation entirely for neural net inference, replacing it with structured matrix constraint systems. Results in dramatically lower memory overhead for proving large model inference (llama-3-70b class).
- Keeps model architecture private (weights and layer topology hidden from verifier)
- Compatible with succinct on-chain verification — proof size stays small

**Implementation path:**
- [ ] Read paper fully; assess R1CS → matrix constraint migration cost for `ZKMLCircuit`
- [ ] Benchmark memory usage vs current SP1 approach on 7B parameter model
- [ ] If viable: prototype as `ZKMLCircuit_v2` without touching audit-scope contracts
- [ ] Coordinate with CertiK Phase 3 audit scope (ZKMLCircuit is Phase 3)

---

### Scalable Collaborative zk-SNARK (Fully Distributed Proof Delegation)
**Paper:** [eprint.iacr.org/2024/940](https://eprint.iacr.org/2024/940) (scalable) + [eprint.iacr.org/2024/143](https://eprint.iacr.org/2024/143) (malicious security)
**Authors:** Liu, Zhou, Wang, Pang, He, Zhang, Yang (2024/940); Liu, Zhou, Wang, Zhang, Yang (2024/143)
**Affects:** `sp1-prover/`, `core-layer/` orchestrator
**Status:** Researchable now — has open-source implementation
**Contract changes:** None

**Why it matters:**
Production-engineering counterpart to Interstellar's collaborative folding. Two complementary papers:
- **2024/940**: First scalable collaborative zk-SNARK for fully distributed proof generation — a client delegates proof work to many servers, and no individual server learns the witness
- **2024/143**: Adds malicious security (semi-honest → malicious upgrade), meaning a Byzantine GPU provider cannot extract input even with active cheating

This maps to XFuel's core privacy promise: "route to Theta EdgeCloud, Akash, etc. without the provider learning your inference input." Currently this is an assumption; these papers make it cryptographically enforced.

**Implementation path:**
- [ ] Identify open-source implementation (check paper authors' GitHub)
- [ ] Evaluate integration as `SP1_PROVER=collaborative` mode in `core-layer/`
- [ ] Test with 2-node setup (client + single EdgeCloud node) before multi-node
- [ ] Document privacy guarantee upgrade in `docs/security-design.md`

---

### Scalable ZK Proofs for Non-linear Functions in ML
**Paper:** [eprint.iacr.org/2025/507](https://eprint.iacr.org/2025/507)
**Authors:** Hao, Chen, Li, Weng, Zhang, Yang, Zhang
**Affects:** `sp1-prover/`, zkML circuits
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
Matrix multiplications (linear layers) are the bulk of a transformer's compute but non-linear activations (ReLU, GELU, softmax) are the bottleneck in ZK proving — they're "arithmetization-unfriendly" and currently require enormous circuit overhead. This paper proposes the first systematic framework for non-linear ML functions in ZK via table lookup.

**Complementary pair with 2026/111:** That paper solves the linear/matrix part; this paper solves the non-linear/activation part. Together they address the full zkML proving cost stack.

**Implementation path:**
- [ ] Assess compatibility with 2026/111 matrix constraint approach
- [ ] Prototype ReLU/GELU table lookup proof for a simple 2-layer MLP as baseline
- [ ] Measure proving time delta on quantized EdgeCloud model variants
- [ ] Combine with 2026/111 in a unified zkML proving benchmark

---

### Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM
**Paper:** [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395)
**Authors:** Jay Taylor, Paul Gerhart, Sri AravindaKrishnan Thyagarajan
**Venue:** Feb 2026
**Affects:** `contracts/circuits/A2ACircuit.sol`, `CoreRevenueSplitter`, SDK
**Status:** Researchable now — highly actionable
**Contract changes:** Potential circuit-level addition (new escrow/exchange primitive)

**Why it matters:**
This paper was literally written for XFuel's use case. The abstract: "AI agents and custodial services are increasingly being entrusted as intermediaries to conduct transactions on behalf of institutions... ensuring that a buyer obtains the goods if and only if the seller receives payment."

XFuel's A2A flow (`submitBid → acceptBid → settleBid`) already implements this, but using a trust assumption: the agent receiving the bid knows the bid amount before deciding to accept. This paper provides the **cryptographic primitive for fair exchange** — a buyer (agent requesting compute) and seller (GPU provider) exchange payment and task result simultaneously, with neither able to cheat.

Three properties immediately relevant:
1. **Delegation without custody** — an AI agent authorizes a payment on behalf of a user without ever holding the user's funds. Maps directly to XFuel's `x402`-style micropayment channels (`createEscrow` / `claimEscrow`)
2. **Time-sensitive goods** — the paper explicitly handles proprietary, time-sensitive goods (AI inference output is both proprietary and time-sensitive — stale outputs have no value)
3. **Industry context cited** — Google's Agent-to-Payments (AP2) protocol is mentioned as a standard that "leaves open the core challenge of fair exchange." XFuel solves the same problem on-chain with ZK

This paper's construction can be used to harden `A2ACircuit.settleBid` so that payment release and output delivery are **atomically linked** — the GPU provider can't receive payment without releasing the output hash, and the client can't receive the output without the payment being committed.

**Implementation path:**
- [ ] Read paper fully — assess whether the fair exchange primitive maps to `settleBid(bidId, resultHash, proofBytes, nullifier)`
- [ ] Evaluate: can `resultHash` delivery and TFUEL escrow release be made atomic via this construction?
- [ ] Prototype atomic settle in `A2ACircuit` — no changes to Core Layer required if done at circuit level
- [ ] SDK: expose `client.settleWithFairExchange(bidId, result)` wrapping the new primitive
- [ ] Whitepaper angle: "XFuel provides cryptographic fair exchange for AI agent payments — the same problem Google AP2 leaves unsolved"

---

### zkAgent: Verifiable LLM Agent Execution via One-Shot Complete Inference Proof
**Paper:** [eprint.iacr.org/2026/199](https://eprint.iacr.org/2026/199)
**Authors:** Lizheng Wang, Hancheng Lou, Chongrong Li, Yu Yu, Yuncong Hu
**Venue:** Feb 2026
**Affects:** `contracts/circuits/A2ACircuit.sol`, `ThetaInferenceCircuit`, SDK
**Status:** Researchable now — **directly describes XFuel's use case**
**Contract changes:** Potential new `AgentExecutionCircuit` — no Core Layer changes

**Why it matters:**
The abstract is almost a product description for XFuel: "LLM-based agents... manage sensitive data and financial assets... the agent provider may be compromised and return malicious outputs... zero-knowledge proofs verify the correctness of LLM inference."

This paper goes one step further than standard LLM inference proving — it handles **multi-step agent execution** (tool use, function calls, multi-turn interactions), not just single-shot inference. The key insight: a "one-shot complete proof" covers the entire agent execution trace, not just one forward pass. This maps to XFuel's A2A multi-step workflows where an agent submits a task, calls tools, and returns a final result — all of which currently require separate proofs per step.

Two specific XFuel applications:
1. **A2A task execution proof** — prove that an agent completed a multi-step workflow (capability_query → inference_request → result) without cheating at any step, with a single on-chain verification
2. **Agentic financial operations** — the paper explicitly motivates this by mentioning "financial assets"; directly relevant to agents using XFuel's escrow/micropayment system

**Implementation path:**
- [ ] Read paper fully — extract the "one-shot complete proof" construction and assess compatibility with SP1 zkVM
- [ ] Design `AgentExecutionCircuit` extending `A2ACircuit` with multi-step trace proving
- [ ] Prototype: prove a 3-step agent execution (query → infer → return) as a single SP1 proof
- [ ] SDK: expose `client.proveAgentExecution(trace)` for agentic workflows
- [ ] Whitepaper angle: "XFuel's zkAgent circuit enables cryptographically verified autonomous agent execution"

---

### zkRNN: Zero-Knowledge Proofs for Recurrent Neural Network Inference
**Paper:** [eprint.iacr.org/2026/073](https://eprint.iacr.org/2026/073)
**Authors:** Fatemeh Zarinjouei, Behzad Abdolmaleki, Maryam Zarezadeh, Bhavish Mohee, Aysajan Abidin, Stefan Köpsell
**Venue:** Jan 2026
**Affects:** `ZKMLCircuit`, `ThetaInferenceCircuit`
**Status:** Researchable now
**Contract changes:** None (prover-side circuit)

**Why it matters:**
The existing zkML landscape (zkGPT, 2026/111, 2025/507) focuses entirely on transformers. RNNs (LSTMs, GRUs, Mamba-style state space models) are a significant class of deployed models — more efficient for long-context tasks than transformers, and increasingly popular on EdgeCloud for streaming/time-series workloads. This is the **first ZK proof scheme for RNN inference**, filling a gap in XFuel's model coverage.

For XFuel: if a user submits an `inference_request` against an RNN-based model (e.g., a time-series prediction model, a streaming audio model, or a Mamba-architecture LLM variant), the current SP1 proof pipeline would treat it like any arbitrary computation. zkRNN provides a purpose-built, optimized circuit for RNN-specific operations (recurrent state updates, gating functions) that would be dramatically more efficient than the generic SP1 zkVM approach.

**Implementation path:**
- [ ] Assess model coverage: which RNN architectures are supported (LSTM, GRU, Mamba)?
- [ ] Check EdgeCloud model availability — are any deployed models RNN-based?
- [ ] Prototype as a separate `ZKRNNCircuit` alongside `ZKMLCircuit` (transformer-focused)
- [ ] Benchmark vs SP1 zkVM on same RNN model — measure circuit efficiency gain

---

### VerfCNN: Optimal Complexity zkSNARK for Convolutional Neural Networks
**Paper:** [eprint.iacr.org/2025/2020](https://eprint.iacr.org/2025/2020)
**Authors:** Wenjie Qu, Yanpei Guo, Yue Ying, Jiaheng Zhang
**Venue:** Oct 2025
**Affects:** `ZKMLCircuit`, image/vision model inference
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
XFuel's current zkML focus is transformers (LLMs). But EdgeCloud also hosts vision models (image generation, classification, object detection — all CNN-based). VerfCNN provides an **optimally efficient zkSNARK for CNNs**, achieving the theoretical lower bound on circuit complexity for convolutional operations. The same authors have produced zkGPT (2025/1184, already in Tier 1) — this is the CNN counterpart from the same research group.

Together: zkGPT handles text/LLM inference, VerfCNN handles vision/CNN inference, zkRNN handles sequential/RNN inference. These three cover the full deployed model landscape on EdgeCloud.

**Implementation path:**
- [ ] Assess which vision models are available on EdgeCloud on-demand API
- [ ] Prototype `ZKVisionCircuit` using VerfCNN construction for a ResNet-50 or ViT inference task
- [ ] Benchmark vs SP1 zkVM on same CNN — measure the "optimal complexity" gain
- [ ] Pair with zkGPT for a unified `ZKMLCircuit_v2` covering both text and vision

---

### ZK Proofs for Verifiable Decentralized AI Pipelines
**Paper:** [eprint.iacr.org/2021/1633](https://eprint.iacr.org/2021/1633)
**Authors:** Nitin Singh, Pankaj Dayama, Vinayaka Pandit (IBM Research)
**Venue:** 2021 (foundational)
**Affects:** `ZKMLCircuit`, DataHubs, `ThetaInferenceCircuit`
**Status:** Researchable now — foundational reference
**Contract changes:** None

**Why it matters:**
Foundational paper for the concept of "verifiable provenance for decentralized AI pipelines" — XFuel's DataHubs use case in academic form. The framework covers confidentiality of data and model assets alongside verifiability at each pipeline step. Written from the perspective of different organizations owning different pipeline stages — exactly XFuel's model where data comes from DataHubs, compute from EdgeCloud, and verification settles on Theta. Worth reading as the theoretical grounding for DataHubs circuit design.

---

### Arbigraph: Verifiable Turing-Complete Execution Delegation
**Paper:** [eprint.iacr.org/2025/710](https://eprint.iacr.org/2025/710)
**Authors:** Michael Mirkin, Hongyin Chen, Ohad Eitan, Gal Granot, Ittay Eyal
**Venue:** Apr 2025
**Affects:** `core-layer/` orchestrator, task delegation model
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
Verifiable delegation of **Turing-complete computation** to untrusted parties — the most general form of XFuel's task routing model. Where zkAgent proves specific LLM agent execution, Arbigraph proves arbitrary program execution. For XFuel's non-inference compute tasks (`compute_bid` message type, general HPC workloads), this is the relevant construction. Enables XFuel to extend beyond ML-specific circuits to verifiable general compute.

---

### Proofs of Useful Work from Matrix Multiplication
**Paper:** [eprint.iacr.org/2025/685](https://eprint.iacr.org/2025/685)
**Authors:** Ilan Komargodski, Omri Weinstein
**Venue:** May 2025
**Affects:** Consensus / mining alignment with AI compute
**Status:** Monitor — speculative but strategically interesting
**Contract changes:** Would require new consensus circuit

**Why it matters:**
Revisits the longstanding problem of replacing blockchain Proof-of-Work with real AI compute (matrix multiplication = the core of neural network inference). The specific challenge: the miner chooses the input — so a honest miner might just use trivial inputs. This paper provides a protocol where the miner's freedom to choose inputs is cryptographically constrained so that the work is genuinely useful.

For XFuel long-term: if Theta validators could earn block rewards by doing real AI inference (instead of artificial PoW), XFuel's staking/fee mechanism and Theta's consensus could be unified. Highly speculative but strategically significant — watch this space.

---

### Mira: Efficient Folding for Pairing-Based Arguments (Groth16 aggregation)
**Paper:** [eprint.iacr.org/2024/2025](https://eprint.iacr.org/2024/2025)
**Authors:** Josh Beal, Ben Fisch
**Venue:** 2024
**Affects:** `sp1-prover/`, rollup batch verification, `ZKVerifierSP1.sol`
**Status:** Researchable now
**Contract changes:** None for prover; potential verifier optimization

**Why it matters:**
XFuel uses Groth16 as the final wrapping proof for on-chain settlement. Mira specifically addresses the pain point of **aggregating Groth16 proofs** — exactly what `verifyMultiLevelRecursive` does when batching 100 task settlements. Current Groth16 aggregation via folding requires arithmetic over the base field, which is expensive. Mira makes pairing-based argument aggregation (Groth16, KZG) dramatically cheaper — directly reducing the cost of XFuel's rollup batch settlement. The Fisch co-authorship (Ben Fisch is behind several production-deployed proof systems) signals this is engineered for practical deployment.

**Implementation path:**
- [ ] Read paper — assess drop-in compatibility with current SP1/Groth16 aggregation path
- [ ] Benchmark: Mira aggregation of 100 Groth16 proofs vs current recursive STARK + wrap approach
- [ ] If viable: implement as `AGGREGATOR=mira` option in rollup batch settlement
**Paper:** [eprint.iacr.org/2025/2251](https://eprint.iacr.org/2025/2251)
**Authors:** Zhengyi Li, Yue Guan, Kang Yang, Yu Feng, Ning Liu, Yu Yu, Jingwen Leng, Minyi Guo
**Venue:** Dec 2025
**Affects:** `sp1-prover/`, `ZKMLCircuit`, `ThetaInferenceCircuit`
**Status:** Researchable now — highly actionable
**Contract changes:** None

**Why it matters:**
The key insight is architectural: for public (open-weight) GPT models like LLaMA-3, **decoding doesn't need to be secret** — only the user's *input* and *output* need privacy protection. The paper proposes public decoding (fast, no crypto overhead) combined with secure *verification* that the correct model was used on the private input.

This maps almost exactly to XFuel's EdgeCloud deployment model:
- Models running on EdgeCloud are open-weight (LLaMA-3-70B, Mistral, etc.) — no need to hide weights
- What needs proving: the provider ran the correct model on the claimed input hash
- What needs hiding: the user's input (the prompt content)

The "public decoding + secure verification" split is dramatically more efficient than full MPC inference because it avoids encrypting the expensive autoregressive generation loop. The verification step (proving correctness) is where XFuel's ZK pipeline fits in. This paper essentially validates XFuel's current architecture and provides a formal framework for the verification component.

**Implementation path:**
- [ ] Read paper fully — extract the verification protocol and assess if it's ZK-based or MPC-based
- [ ] If ZK-based: evaluate as a replacement/complement for `ThetaInferenceCircuit` proof generation
- [ ] If MPC-based: assess overhead vs current SP1 zkVM approach on EdgeCloud hardware
- [ ] Benchmark: public decoding + ZK verify vs full SP1 proof on LLaMA-3-70B inference task

---

### Mosformer: Maliciously Secure Three-Party Inference for Large Transformers
**Paper:** [eprint.iacr.org/2025/1510](https://eprint.iacr.org/2025/1510)
**Authors:** Ke Cheng, Yuheng Xia, Anxiao Song, Jiaxuan Fu, Wenjie Qu, Yulong Shen, Jiaheng Zhang
**Venue:** Sep 2025
**Affects:** Input privacy for `inference_request` routing
**Status:** Monitor — MPC paradigm, not ZK
**Contract changes:** None (infrastructure-level only)

**Why it matters:**
Most MPC-based secure inference only handles the *semi-honest* threat model — providers follow the protocol but try to learn your input passively. Mosformer achieves **malicious security for transformer inference** — the GPU provider can actively deviate from the protocol and still cannot extract your input. This is the strongest privacy guarantee for the three-party setting (client + two GPU nodes).

For XFuel's DePIN routing (Theta EdgeCloud + Akash as backup nodes), a two-provider setup is natural. Mosformer's 3-party model fits: client + EdgeCloud node 1 + EdgeCloud node 2 (or EdgeCloud + Akash). The malicious security matches XFuel's adversarial threat model for premium privacy tasks.

Note: This is MPC, not ZK. It doesn't replace SP1 proofs — it sits *alongside* them. The MPC handles input privacy during inference; the ZK proof settles correctness on-chain afterwards.

**Implementation path:**
- [ ] Assess latency overhead for transformer-scale inference (is it practical for LLaMA-3-70B?)
- [ ] Map to XFuel's two-provider routing: EdgeCloud + Akash as the two compute parties
- [ ] Consider as a `privacy_mode: malicious` option in the task request API (premium tier)

---

### PIGEON: High Throughput MPC for Private Neural Network Inference
**Paper:** [eprint.iacr.org/2024/1371](https://eprint.iacr.org/2024/1371)
**Authors:** Harth-Kitzerow, Wang, Rajat, Carle, Annavaram
**Venue:** 2024
**Affects:** Input privacy infrastructure
**Status:** Monitor — GPU-accelerated MPC, practical throughput numbers
**Contract changes:** None

**Why it matters:**
Specifically addresses GPU-accelerated MPC for private inference — the first framework to show practical throughput numbers on GPU hardware. This matters for XFuel because EdgeCloud nodes are GPU machines; any privacy layer needs to run *on* the GPU, not fight it. PIGEON shows this is achievable and provides benchmarks against plaintext inference that make the overhead concrete.

---

### New PPML Paradigm for Quantized Models
**Paper:** [eprint.iacr.org/2024/1132](https://eprint.iacr.org/2024/1132)
**Authors:** Tianpei Lu, Bingsheng Zhang, Xiaoyuan Zhang, Kui Ren
**Venue:** Nov 2024
**Affects:** `sp1-prover/`, quantized model inference
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
XFuel already uses `"variant": "quantized"` for EdgeCloud inference. Existing privacy-preserving ML (PPML) frameworks struggle with quantized models because the internal structure of quantized operators is complex and maps poorly to standard MPC/ZK circuits. This paper builds a PPML paradigm specifically designed for quantized models — directly compatible with XFuel's existing quantized inference pipeline.

Unlike most PPML work that ignores quantization or treats it as an afterthought, this paper treats quantization as a first-class citizen. The efficiency gains from quantization carry through to the privacy layer instead of being negated by it.

**Implementation path:**
- [ ] Read paper — assess whether the PPML paradigm is MPC-based, ZK-based, or hybrid
- [ ] If ZK-compatible: evaluate as an enhancement to `ZKMLCircuit` for quantized model proofs
- [ ] Pair with Sparsity-Aware paper (2024/1018) — both target quantized/pruned models

---

### Mystique: ZK Proofs for Private ML Inference
**Paper:** [eprint.iacr.org/2021/730](https://eprint.iacr.org/2021/730)
**Authors:** Chenkai Weng, Kang Yang, Xiang Xie, Jonathan Katz, Xiao Wang
**Venue:** 2021 (foundational)
**Affects:** `sp1-prover/`, ZK inference circuits
**Status:** Researchable now — foundational reference, open-source
**Contract changes:** None

**Why it matters:**
Foundational paper for ZK-based (not MPC-based) private ML inference. Unlike the MPC papers above, Mystique specifically addresses ZK proofs for deep neural networks — the same paradigm XFuel uses. It introduces efficient conversions between different ZK proof representations to handle the mixed arithmetic/boolean operations in neural nets. This is the earlier counterpart to zkGPT (2025/1184) — reading both together gives the full picture of how the field evolved from 2021 to 2025.

Worth reading as background before implementing `ZKMLCircuit_v2`.

---

> **Note on MPC vs ZK for private inference:**
> The `private inference` search returns mostly MPC/HE papers. XFuel's current stack is ZK-based (SP1 proofs settling on-chain). These are complementary paradigms:
> - **ZK proofs** (XFuel's current approach): prove *correctness* of computation on-chain, ~270K gas, async
> - **MPC protocols** (Mosformer, PIGEON, BumbleBee, etc.): hide *inputs* during computation, no on-chain footprint
> The ideal architecture combines both: MPC during inference (input privacy) + ZK proof afterwards (correctness settlement). Papers 2025/2113 (single-server outsourcing) and 2024/940+143 (collaborative SNARKs) already in Tier 1 address the ZK-native version of this combination.
**Paper:** [eprint.iacr.org/2025/2113](https://eprint.iacr.org/2025/2113)
**Authors:** Abbaszadeh, Hafezi, Katz, Meiklejohn
**Affects:** `core-layer/`, `backend/theta-bridge/`
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
"A client/prover outsources most of its work to a single untrusted server while the server learns nothing about the witness or the statement being proved." This is the single-server version of the collaborative proving model — directly relevant when XFuel routes a task to a single dedicated EdgeCloud node. Currently the node sees the proving witness; this construction makes that cryptographically impossible.

The privacy guarantee upgrade: from "trust the GPU provider" to "provider is cryptographically prevented from learning your input."

**Implementation path:**
- [ ] Evaluate overhead vs standard SP1 proving (latency cost of privacy guarantee)
- [ ] Implement as opt-in `privacy_mode: true` flag in task request API
- [ ] Document tradeoff (higher proving latency vs input privacy) in `docs/M2M_API.md`

---

## Tier 2 — Medium Priority

### DFS: Delegation-Friendly zkSNARK with Private Prover Delegation
**Paper:** [eprint.iacr.org/2025/296](https://eprint.iacr.org/2025/296)
**Authors:** Yuncong Hu, Pratyush Mishra, Xiao Wang, Jie Xie, Kang Yang, Yu Yu, Yuwen Zhang
**Venue:** Feb 2025
**Affects:** `sp1-prover/`, `core-layer/` task routing
**Status:** Researchable now — **most directly relevant proof delegation paper**
**Contract changes:** None

**Why it matters:**
This paper explicitly addresses XFuel's exact problem: "outsource proof generation either through public delegation, which reveals the witness to the third party, or, more preferably, private delegation that keeps the witness hidden using MPC. However, current private delegation schemes struggle with scalability and efficiency."

DFS introduces a new SNARK construction designed from the ground up to be delegation-friendly — the proof can be generated by an untrusted server without revealing the witness, at near-single-server efficiency (unlike existing MPC-based private delegation which multiplies prover cost). Authors include Pratyush Mishra (arkworks) and Kang Yang — production-caliber work.

XFuel's threat model exactly: a user submits a task, EdgeCloud generates the SP1 proof, the user's input hash is the witness. Currently EdgeCloud sees the witness. DFS enables private delegation so EdgeCloud generates the proof without learning the witness.

**Implementation path:**
- [ ] Read paper — extract the delegation-friendly construction and assess SP1 compatibility
- [ ] Benchmark delegation overhead vs standard SP1 proof generation on LLaMA-3-70B task
- [ ] Implement as `SP1_PROVER=dfs-delegate` mode for premium private tasks

---

### Collaborative zkSNARKs with Sublinear Prover Time
**Paper:** [eprint.iacr.org/2025/1388](https://eprint.iacr.org/2025/1388)
**Authors:** Zhiyong Fang, Sanjam Garg, Bhaskar Roberts, Wenxuan Wu, Yupeng Zhang
**Venue:** Jul 2025
**Affects:** `sp1-prover/`, swarm proving
**Status:** Researchable now — significant efficiency upgrade over 2024/940
**Contract changes:** None

**Why it matters:**
Direct upgrade to [2024/940](https://eprint.iacr.org/2024/940) (already in Tier 1). The existing collaborative SNARK has each server run at least as slow as single-server — distributing across N nodes doesn't reduce per-node cost. This paper achieves **sublinear prover time per server** with constant proof size: the first construction where distributed proving is genuinely faster than single-server proving.

For XFuel's swarm model: a 3-agent swarm proves a joint task with each node doing *less* work than a single prover. This is the efficiency breakthrough that makes collaborative proving practical at scale.

**Implementation path:**
- [ ] Compare against 2024/940 — quantify the sublinear speedup concretely
- [ ] Benchmark on XFuel's inference workload with 2, 3, 5 servers
- [ ] When production-ready, replace 2024/940 as the recommended collaborative prover

---

### Blind zkSNARKs: Private Proof Delegation via Homomorphic Encryption
**Paper:** [eprint.iacr.org/2024/1684](https://eprint.iacr.org/2024/1684)
**Authors:** Gama, Heydari Beni, Kang, Spiessens, Vercauteren
**Venue:** 2024
**Affects:** `sp1-prover/`, single-server private delegation
**Status:** Researchable now — practical up to 2^20 R1CS constraints
**Contract changes:** None

**Why it matters:**
"Blind zkSNARKs" — the proof server generates a ZK proof over homomorphically encrypted data, never seeing the plaintext witness. Practical for circuits up to 2^20 R1CS constraints. The three approaches to private delegation now tracked — DFS, 2025/2113, and Blind zkSNARKs — each have different tradeoffs (construction-native vs outsourcing-native vs HE-based). Having all three lets XFuel choose the right one per use case.

**Implementation path:**
- [ ] Assess XFuel's SP1 inference circuit size vs the 2^20 constraint limit
- [ ] Compare overhead vs DFS and 2025/2113 at equivalent circuit sizes
- [ ] Consider as `privacy_mode: blind` for circuits under the size threshold

---

### Folding Schemes with Privacy-Preserving Selective Verification
**Paper:** [eprint.iacr.org/2024/1530](https://eprint.iacr.org/2024/1530)
**Authors:** Joan Boyar, Simon Erfurth
**Venue:** 2024
**Affects:** `sp1-prover/`, multi-verifier batch settlement
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
Standard folding merges N proofs — once folded, the verifier sees all statements. This paper adds **selective verification**: a prover aggregates M statements into one folded proof, but each verifier proves *only their subset* without seeing others. For XFuel's batch of 100 task settlements: each task client can verify only their own settlement from the batch proof, improving privacy in the rollup settlement model.

---

### Verifiable Computing for Approximate Computation
**Paper:** [eprint.iacr.org/2019/762](https://eprint.iacr.org/2019/762)
**Authors:** Shuo Chen, Jung Hee Cheon, Dongwoo Kim, Daejun Park
**Venue:** 2019 (foundational)
**Affects:** `ZKMLCircuit`, quantized inference proving
**Status:** Researchable now — foundational reference
**Contract changes:** None

**Why it matters:**
Existing ZK only handles exact arithmetic. Quantized model inference produces approximate outputs (rounding at each layer). This is the first paper to handle approximate computation in ZK — proving `1.11 × 2.22 ≈ 2.46` rather than requiring exact `2.4642`. Directly relevant to XFuel's `"variant": "quantized"` EdgeCloud inference. Pairs with PPML quantized model paper (2024/1132).

---

### Cirrus: Performant and Accountable Distributed SNARK
**Paper:** [eprint.iacr.org/2024/1873](https://eprint.iacr.org/2024/1873)
**Authors:** Wenhao Wang, Fangyan Shi, Dani Vilardell, Fan Zhang (Yale / Cornell / Tsinghua)
**Venue:** Preprint 2024, revised Aug 2025
**Affects:** `sp1-prover/`, `core-layer/` task routing, swarm proving
**Status:** Researchable now — benchmarked and implemented
**Contract changes:** None

**Why it matters:**
Cirrus is the single most directly relevant distributed proving paper to XFuel's infrastructure. The abstract names the exact use case: *"verifiable machine learning or virtual machines."* The design targets three properties that map precisely to XFuel's requirements:

1. **Horizontal scalability with low overhead** — linear computation per worker, logarithmic communication. XFuel routes tasks to N EdgeCloud nodes; Cirrus means adding more nodes scales linearly in cost, not super-linearly. Benchmarks: 33M-gate circuits in under 40 seconds using 32 eight-core machines.

2. **Accountability** — efficient detection of *which specific worker* produced a malicious proof, identified in under 4 seconds. This is the missing primitive in XFuel's current model: if an EdgeCloud node cheats on a zkML proof, there is currently no cryptographic way to identify the culprit. Cirrus adds forensic accountability to the distributed prover, which is essential for XFuel's fee slashing and DePIN reputation model.

3. **Universal trusted setup independent of circuits and number of workers** — builds on HyperPlonk (EUROCRYPT'23), so the same SRS (structured reference string) works regardless of how many workers participate or which circuit is being proved. This is critical for XFuel's multi-tier DePIN router: tasks route to different numbers of nodes depending on availability, and you can't re-do a trusted setup ceremony each time.

**Comparison to related work:**
- vs **2024/940** (scalable collaborative SNARK): 2024/940 focuses on privacy (witness hiding across workers); Cirrus focuses on performance + accountability. They solve complementary problems. XFuel needs both — likely a combined deployment where collaborative privacy applies to the inner circuit and Cirrus's accountability protocol wraps the distributed coordination layer.
- vs **2025/1388** (sublinear collaborative SNARK): 2025/1388 reduces per-worker proving time; Cirrus reduces coordinator overhead and adds accountability. Cirrus's `>7x` speedup over the prior accountable baseline (Hekaton) makes it the current state of the art for production-deployable distributed proving.
- vs **Hekaton (2024/1208)**: Cirrus directly benchmarks against Hekaton and wins by 7x on PLONK-friendly circuits. Both should be tracked; Hekaton is the predecessor.

**XFuel-specific applications:**

*Swarm proving:* XFuel's `formSwarm → joinSwarm → settleSwarmAgent` model up to 18 agents. With Cirrus, each agent in a swarm is a Cirrus worker. The coordinator (likely the task-submitting agent or a smart contract) receives the aggregated proof. If any agent submits a malformed partial proof, the accountability protocol identifies them in 4 seconds — enabling automatic stake slashing via `A2ACircuit`.

*DePIN provider accountability:* Currently, if Theta EdgeCloud, Akash, or Render produces a bad proof, XFuel has no cryptographic recourse beyond re-running the task. Cirrus's accountability primitive gives XFuel the ability to prove on-chain *which specific GPU provider* was faulty — enabling slashing, blacklisting, or reputation penalties without trusting any single party's claim.

*Hierarchical aggregation:* Cirrus introduces a hierarchical aggregation technique that reduces the coordinator's workload. For XFuel's `verifyMultiLevelRecursive` function (which currently does multi-level recursive STARK aggregation), this maps to a tree-structured proof aggregation where inner nodes aggregate subsets and the root produces the final on-chain proof — reducing the coordinator's bottleneck at `rollupBatchSize = 100`.

**Implementation path:**
- [ ] Read full paper — extract the HyperPlonk-based distributed protocol and accountability construction
- [ ] Assess compatibility with SP1's underlying proof system (SP1 uses STARKs internally; does Cirrus's HyperPlonk wrapper compose with STARK-based inner proofs?)
- [ ] Prototype: 2-worker Cirrus proof for a simple inference circuit on Hardhat local
- [ ] Benchmark: 32-worker Cirrus on EdgeCloud vs current single-node SP1 CUDA proving — target the 40s/33M-gate claim
- [ ] Integrate accountability hook: on malicious-worker detection, emit `ProviderSlashed(workerId)` event in `A2ACircuit`
- [ ] Whitepaper angle: "XFuel uses Cirrus to provide cryptographically accountable distributed GPU proving — faulty providers are identified and slashed on-chain within seconds"

---

### Hekaton: Horizontally-Scalable zkSNARKs via Proof Aggregation
**Paper:** [eprint.iacr.org/2024/1208](https://eprint.iacr.org/2024/1208)
**Authors:** Michael Rosenberg, Tushar Mopuri, Hossein Hafezi, Ian Miers, Pratyush Mishra
**Venue:** CCS 2024
**Affects:** `sp1-prover/`, recursive rollup
**Status:** Researchable now — published at CCS, production-adjacent
**Contract changes:** None

**Why it matters:**
The predecessor to Cirrus and the first horizontally-scalable zkSNARK with accountability (CCS 2024). Where Cirrus is 7x faster on PLONK-friendly circuits, Hekaton is the established baseline with CCS peer review behind it. For XFuel: Hekaton enables proof generation for circuits too large to fit in a single machine's RAM by distributing the witness across workers. XFuel's LLM inference proofs (LLaMA-3-70B circuit) are in this regime — the full model circuit exceeds single-machine memory. Hekaton is the fallback if Cirrus's HyperPlonk dependency doesn't compose cleanly with SP1. Authors include Pratyush Mishra (also DFS paper) and Ian Miers — production-grade.

**Implementation path:**
- [ ] Read alongside Cirrus — understand what Cirrus improves and whether the tradeoffs favor Hekaton for any XFuel use case
- [ ] Evaluate RAM requirements for LLaMA-3-70B circuit — confirm whether single-machine RAM is actually the bottleneck

---

### Symphony: Lattice-Based Folding SNARK (No In-Circuit Hashing)
**Paper:** [eprint.iacr.org/2025/1905](https://eprint.iacr.org/2025/1905)
**Authors:** Binyi Chen (same author as LatticeFold)
**Venue:** Oct 2025
**Affects:** `sp1-prover/`, Keccak/hash circuit overhead
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
Every existing folding-based SNARK (Nova, HyperNova, Interstellar) must embed a hash function inside the SNARK circuit to enable recursion — this is why Keccak inside a circuit is so expensive (tens of thousands of constraints, tracked separately via Keccacheck). Symphony is the **first folding-based SNARK that completely avoids embedding hashes in circuits** by rethinking how folding uses random oracles.

Properties: memory-efficient, parallelizable, streaming-friendly, plausibly post-quantum (lattice-based). From Binyi Chen (LatticeFold author) — high-quality work.

For XFuel: Symphony directly eliminates the Keccak-in-circuit overhead that Keccacheck (2025/1764) tries to reduce. If Symphony is integrated, the nullifier computation in `SP1ProofHooks.sol` no longer requires an expensive in-circuit Keccak — the hash can be computed outside the SNARK circuit entirely. This is a more fundamental fix than Keccacheck's optimization approach.

**Implementation path:**
- [ ] Compare with Keccacheck (2025/1764) — is Symphony a replacement or complement?
- [ ] Assess lattice-based PQ implications alongside LatticeFold (2024/257)
- [ ] Prototype: null the in-circuit Keccak using Symphony's approach and benchmark circuit size reduction

---

### Collaborative Incrementally Verifiable Computation (2026/410)
**Paper:** [eprint.iacr.org/2026/410](https://eprint.iacr.org/2026/410)
**Authors:** Eden Aldema Tshuva, Sanjam Garg, Abhiram Kothapalli, Rotem Oshman, Omkant Pandey, Bhaskar Roberts
**Venue:** Feb 2026
**Affects:** `sp1-prover/`, swarm proving, `A2ACircuit`
**Status:** Researchable now — most recent (Feb 2026), same group as 2025/1388
**Contract changes:** None

**Why it matters:**
The culmination of the collaborative IVC research line (Garg group). Existing collaborative SNARKs still "struggle to support many target applications in practice, which operate over large-scale datasets." This paper extends collaborative proving to full **Incrementally Verifiable Computation** — meaning the collaborative proof covers not just one circuit evaluation but an entire incremental computation across many steps.

For XFuel's swarm: rather than each agent proving its own step and aggregating later, collaborative IVC lets the swarm produce a single IVC proof that covers the entire multi-agent computation incrementally. This is the strongest version of swarm proving and directly enables the `settleSwarmAgent` flow to produce one compact on-chain proof for an entire multi-step multi-agent workflow.

**Implementation path:**
- [ ] Read alongside 2025/1388 — understand what "large-scale datasets" means concretely
- [ ] Assess whether this supersedes 2024/940 + 2025/1388 or is complementary
- [ ] Long-term: design `SwarmIVCCircuit` using collaborative IVC for full swarm workflow proving

---
**Paper:** [eprint.iacr.org/2025/1790](https://eprint.iacr.org/2025/1790)
**Authors:** Seyoung Yoon, Hyunji Kim, Hwajeong Seo
**Venue:** Oct 2025
**Affects:** `core-layer/` MCP tier (Tier 3 of DePIN router), `A2ACircuit`
**Status:** Researchable now
**Contract changes:** None (infrastructure/transport layer)

**Why it matters:**
XFuel's 6-tier DePIN priority router includes **MCP (local)** as Tier 3: `Theta EdgeCloud → RapidAPI → MCP → Akash → Render → Bedrock`. The Model Context Protocol is the transport layer for local/low-latency compute. Standard MCP leaves authentication, encryption, and authorization optional. CA-MCPQ mandates them and adds post-quantum security:

- **Post-quantum mutual authentication** — the agent calling MCP and the MCP server authenticate each other with PQ-safe cryptography (relevant as Theta infrastructure prepares for quantum threats)
- **KEM-derived session keys** — key encapsulation mechanism for forward-secret session encryption; prevents replay attacks on agent tool calls
- **Role-based access control at protocol level** — relevant to XFuel's `registerAgent` / `capabilityFlags` model in `A2ACircuit`
- **Authenticated sequencing** — prevents reordering attacks on multi-step agent tool call sequences; maps to zkAgent's multi-step execution proof requirement

For XFuel: if an agent is routing through the MCP tier, CA-MCPQ hardens that channel against both classical and quantum adversaries. This is the transport security complement to the ZK proof correctness guarantees — CA-MCPQ secures the channel, zkAgent proves the execution.

**Implementation path:**
- [ ] Review current MCP tier implementation in `core-layer/` — assess authentication model
- [ ] Evaluate CA-MCPQ as a drop-in upgrade to MCP session handling
- [ ] Consider for `A2ACircuit.registerAgent` capability handshake: PQ-authenticated agent registration

---

### Cryptographically Secure Digital Consent
**Paper:** [eprint.iacr.org/2024/1839](https://eprint.iacr.org/2024/1839)
**Authors:** Durak, Talayhan, Vaudenay (EPFL)
**Venue:** Nov 2024
**Affects:** `A2ACircuit`, SDK (user authorization for agent-initiated payments)
**Status:** Monitor
**Contract changes:** Potential new authorization primitive

**Why it matters:**
When an AI agent executes a financial transaction on behalf of a user, the user's consent needs to be cryptographically verifiable — not just a logged API key approval. This paper provides a formal framework for "cryptographically secure digital consent" that can be integrated into third-party service authorization. For XFuel: an agent calling `CoreRevenueSplitter.createEscrow` on behalf of a user should be able to prove it has the user's cryptographic consent for that specific operation. Pairs with the fair exchange paper (2026/395) to make agent-initiated payments both atomic and user-authorized.

---
**Paper:** [eprint.iacr.org/2025/1912](https://eprint.iacr.org/2025/1912)
**Authors:** Tianyu Zheng, Shang Gao, Yu Guo, Bin Xiao
**Venue:** Oct 2025
**Affects:** `sp1-prover/`, recursive rollup layer
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
XFuel's `verifyRecursiveRollup` aggregates up to 100 inner proofs into one on-chain verification. The current IVC accumulation approach has a verifier cost that scales **linearly** with the number of accumulated instances — so batching 100 proofs means the accumulation verifier does 100x work. Quasar achieves **sublinear** accumulation verifier complexity by introducing a novel polynomial commitment-based scheme. For XFuel's rollup batch size of 100, this directly reduces the recursive overhead of every batch settlement.

Pairs well with KiloNova (2023/1579) for non-uniform circuit support — Quasar handles the accumulation efficiency, KiloNova handles the mixed circuit types in a batch.

**Implementation path:**
- [ ] Assess current accumulation verifier overhead in SP1 recursive rollup
- [ ] Benchmark Quasar sublinear accumulation vs current linear approach at batch sizes 10, 50, 100
- [ ] If overhead reduction significant: propose as `ROLLUP_ACCUMULATOR=quasar` prover option

---

### LatticeFold: Post-Quantum Lattice-Based Folding
**Paper:** [eprint.iacr.org/2024/257](https://eprint.iacr.org/2024/257)
**Authors:** Dan Boneh, Binyi Chen
**Venue:** 2024 (Boneh is one of the most cited cryptographers alive)
**Affects:** `sp1-prover/`, post-quantum roadmap
**Status:** Researchable now — open-source implementation available
**Contract changes:** Requires new verifier contract for post-quantum path (future work)

**Why it matters:**
All current folding schemes (Nova, HyperNova, Interstellar) use discrete-log commitments — not post-quantum secure. LatticeFold is the **first** lattice-based folding protocol, based on Module SIS (a standard post-quantum hardness assumption). From Dan Boneh — this will become the foundational reference for post-quantum IVC.

For XFuel: this is the post-quantum migration path for the entire recursive/folding stack. When quantum computers become a real threat (2030+ horizon), this is what you'd upgrade to. The on-chain verifier would need to change (lattice-based verification is different from pairing-based Groth16), but the circuit interface stays the same.

**Implementation path:**
- [ ] Track official implementation — likely from Boneh's group at Stanford
- [ ] Assess Module SIS verifier gas cost on Theta EVM (lattice ops are heavier than pairings)
- [ ] Long-term: plan `ZKVerifierLattice.sol` alongside `ZKVerifierSP1.sol` for post-quantum transition

---

### Lova: Lattice-Based Folding from Unstructured Lattices
**Paper:** [eprint.iacr.org/2024/1964](https://eprint.iacr.org/2024/1964)
**Authors:** Fenzi, Knabenhans, Nguyen, Pham
**Venue:** Dec 2024
**Affects:** `sp1-prover/`, post-quantum roadmap
**Status:** Researchable now
**Contract changes:** Same as LatticeFold — future post-quantum verifier

**Why it matters:**
Complementary to LatticeFold but uses **unstructured** lattices (standard LWE) rather than Module SIS. This matters because unstructured lattice assumptions are more conservative — fewer attack vectors are known. LatticeFold vs Lova is a tradeoff: LatticeFold is more efficient but relies on module structure; Lova is more conservative but potentially heavier. Read alongside LatticeFold to understand the post-quantum folding design space.

---

### KiloNova: Folding-based SNARKs for Non-Uniform Machine Executions
**Paper:** [eprint.iacr.org/2023/1579](https://eprint.iacr.org/2023/1579)
**Authors:** Tianyu Zheng, Shang Gao, Yu Guo, Bin Xiao
**Venue:** 2023 (updated Feb 2026)
**Affects:** `sp1-prover/`, recursive rollup with mixed circuit types
**Status:** Researchable now
**Contract changes:** None

**Why it matters:**
XFuel's recursive rollup batches multiple task settlement proofs — but these proofs come from **different circuit types** (inference proof, A2A bid proof, bridge proof, governance vote proof). Existing folding schemes struggle with non-uniform circuits (they assume all folded instances use the same circuit). KiloNova introduces preprocessing folding for mixed/non-uniform circuits, directly enabling XFuel to fold heterogeneous task proofs into a single batch without padding overhead.

This closes a real gap: currently your `rollupBatchSize = 100` assumes homogeneous proofs. KiloNova makes heterogeneous batching efficient.

---

### Simulation-Extractability of Proof-Carrying Data / IVC
**Paper:** [eprint.iacr.org/2025/2037](https://eprint.iacr.org/2025/2037)
**Authors:** Abdolmaleki, Campanelli, Dao, Khoshakhlagh
**Venue:** Feb 2026
**Affects:** `contracts/core/ZKVerifierSP1.sol` (security model)
**Status:** Read for security awareness
**Contract changes:** None (security analysis, not construction)

**Why it matters:**
Asks whether recursive/IVC proof systems are resistant to **malleability attacks** — whether an adversary who sees a valid IVC proof can produce a different valid proof for a false statement. For XFuel's nullifier-based replay protection, this is directly relevant: if an attacker could maul a valid settlement proof into a different valid proof for a fake task, they could drain fees without doing work. This paper formalizes the security property and proves (or disproves) it for known constructions. Read before the CertiK Phase 1 audit — auditors will ask about this.

---

### Polymath: Groth16 Is Not The Limit
**Paper:** [eprint.iacr.org/2024/916](https://eprint.iacr.org/2024/916)
**Authors:** Helger Lipmaa
**Affects:** `contracts/core/ZKVerifierSP1.sol`, proof size
**Status:** Researchable now
**Contract changes:** New verifier contract required (different proof format)

**Why it matters:**
XFuel's on-chain verification currently costs ~270K gas for Groth16 (3 group elements = 1536 bits). Polymath achieves shorter proofs (1408 bits, ~8% smaller) with better security properties. More importantly, at 192-bit security it's **nearly half the size** of Groth16. If XFuel moves to higher security targets post-audit, Polymath becomes the obvious successor to Groth16 as the final wrapping proof system.

Not urgent now — the SP1 gateway abstracts the proof system — but relevant for the post-audit verifier design.

---

### IVC in the Open-and-sign Random Oracle Model
**Paper:** [eprint.iacr.org/2025/1663](https://eprint.iacr.org/2025/1663)
**Authors:** Mary Maller, Nicolas Mohnblatt, Arantxa Zapico
**Affects:** Security model for recursive verifier
**Status:** Read for security awareness
**Contract changes:** None

Previous IVC constructions had security proofs in models that don't justify recursive composition — meaning the security of XFuel's multi-level recursive verification (`verifyMultiLevelRecursive`) rests on assumptions that haven't been formally proven sound for recursive use. This paper addresses exactly that gap, providing an IVC security proof compatible with recursive SNARKs. Relevant context for the CertiK audit team when they examine the recursive verification functions.

---

### GIGA Protocol: Trustless Parallel Computation in Blockchains
**Paper:** [eprint.iacr.org/2025/645](https://eprint.iacr.org/2025/645)
**Authors:** Garoffolo, Kaidalov, Oliynykov, Di Tullio, Rodinko
**Affects:** `core-layer/`, task routing architecture
**Status:** Monitor
**Contract changes:** Potentially significant

Full trustless parallel computation across blockchain nodes — each node proves only its shard of the computation, recursive SNARKs aggregate. Conceptually more ambitious than XFuel's current model (centralized orchestration + ZK settlement). Relevant as a longer-term architectural reference for fully decentralizing XFuel's task router itself.

---

### Proving CPU Executions in Small Space (Jolt zkVM optimization)
**Paper:** [eprint.iacr.org/2025/611](https://eprint.iacr.org/2025/611)
**Authors:** Nair, Thaler, Zhu
**Affects:** `sp1-prover/` (alternative zkVM backend)
**Status:** Monitor — SP1 alternative path
**Contract changes:** None

Optimizes Jolt (sum-check based zkVM) for drastically reduced memory footprint without SNARK recursion. XFuel is built on SP1 (RISC-V based), not Jolt. But if SP1 prover memory becomes a bottleneck on EdgeCloud nodes (limited RAM), this is the alternative zkVM to evaluate. Justin Thaler is one of the most influential zkVM researchers — track his work.

### Collaborative Incrementally Verifiable Computation
**Paper:** [eprint.iacr.org/2026/410](https://eprint.iacr.org/2026/410)
**Authors:** Aldema Tshuva, Garg, Kothapalli, Oshman, Pandey, Roberts
**Venue:** Feb 2026
**Affects:** `sp1-prover/`, swarm settlement
**Status:** Researchable now
**Contract changes:** None

More theoretical framing of collaborative IVC at scale (vs Interstellar's GKR-specific approach and 2024/940's practical SNARK delegation). Covers large-scale datasets explicitly — cited applications include "jointly trained machine learning models." Useful as the theoretical foundation underpinning both Interstellar and the collaborative SNARK papers above. Read alongside those, not instead of.

---

### UltraFold: Efficient Distributed BaseFold
**Paper:** [eprint.iacr.org/2026/266](https://eprint.iacr.org/2026/266)
**Authors:** Wang, Zhang
**Affects:** `sp1-prover/`, EdgeCloud prover infrastructure
**Status:** Researchable now
**Contract changes:** None

BaseFold is a transparent (no trusted setup), post-quantum polynomial commitment scheme. UltraFold makes it **distributed** — the polynomial being committed to is too large for one machine, so commitment work is sharded across nodes. Relevant when a single EdgeCloud GPU node can't hold the full proving witness for a large model. No trusted setup is also a significant advantage for auditors. Post-quantum ready.

---

### Neo and SuperNeo: Post-Quantum Folding with Pay-Per-Bit Costs
**Paper:** [eprint.iacr.org/2026/242](https://eprint.iacr.org/2026/242)
**Authors:** Nguyen, Setty (Microsoft Research — Nova/HyperNova authors)
**Affects:** `sp1-prover/`, post-quantum roadmap
**Status:** Researchable now
**Contract changes:** None

"Pay-per-bit commitment costs" — you only pay for witness bits that are actually used. Highly relevant for sparse zkML circuits (inference tasks with mostly-zero activations after pruning/quantization). XFuel already uses `"variant": "quantized"` on EdgeCloud — quantized models are inherently sparse, and this scheme capitalizes on that. Post-quantum security over small fields (Goldilocks). From the Nova lineage (same author as HyperNova), so well-engineered.

---

### GKR for Boolean Circuits with Sub-linear RAM Operations
**Paper:** [eprint.iacr.org/2025/717](https://eprint.iacr.org/2025/717)
**Authors:** Hu, Li, Qiu, Xie, Ying, Zhang, Zhang
**Affects:** `sp1-prover/`, bridge/settlement circuits
**Status:** Researchable now
**Contract changes:** None

Extends GKR (the protocol underlying Interstellar) to handle **binary operations** efficiently — the domain of EVM-compatible computations, not just ML matrix ops. Relevant because XFuel's bridge, governance, and settlement circuits involve bitwise operations and EVM state that GKR handles poorly today. This paper closes that gap, making GKR viable as a universal prover backend across all XFuel circuits, not just zkML.

---

### Keccacheck: SNARK-Friendly Keccak
**Paper:** [eprint.iacr.org/2025/1764](https://eprint.iacr.org/2025/1764)
**Authors:** Kostrzewa, Klein, Adkins, Świrski, Żmuda
**Affects:** `sp1-prover/`, `contracts/core/SP1ProofHooks.sol` (nullifier computation)
**Status:** Researchable now
**Contract changes:** None — affects circuit side only

Keccak is used everywhere in XFuel: `keccak256` in `SP1ProofHooks.sol` for nullifier computation, task ID hashing, commitment hashing. Proving Keccak inside a SNARK currently costs tens of thousands of constraints. Keccacheck dramatically reduces this, cutting proof generation time for every task settlement. Directly lowers the gas overhead introduced by XFuel's nullifier replay-protection scheme.

---

### Dynamic zk-SNARKs
**Paper:** [eprint.iacr.org/2026/144](https://eprint.iacr.org/2026/144) + [eprint.iacr.org/2024/1566](https://eprint.iacr.org/2024/1566)
**Authors:** Wang, Papamanthou, Srinivasan, Papadopoulos
**Affects:** `sp1-prover/`, streaming inference tasks
**Status:** Researchable now
**Contract changes:** None

Dynamic zk-SNARKs allow proof **updates** proportional to the change between statements (Hamming distance), not full recomputation. For XFuel: if a streaming inference task's output changes incrementally (e.g., a long LLM response generated token by token), you update the proof rather than regenerating it from scratch. Reduces latency and cost for long-running or iterative compute jobs.

---

### gcVM: Publicly Auditable MPC for Private EVM Computation
**Paper:** [eprint.iacr.org/2026/170](https://eprint.iacr.org/2026/170)
**Authors:** Yana, Levy, Rosulek, Dahari-Garbian
**Affects:** `contracts/circuits/A2ACircuit.sol`, confidential bidding
**Status:** Monitor
**Contract changes:** Potentially significant — new circuit type

Enables **confidential smart contract calls** on EVM-compatible chains. For XFuel: A2A agent bids could be made confidential (bid price hidden from competing agents) while still being publicly auditable. Also relevant for confidential task routing decisions. Higher complexity than other entries — garbled circuits are heavier than ZK in practice, but MPC+ZK hybrid approach may be tractable.

---

### Sparsity-Aware Protocol for ZK-Friendly ML Models
**Paper:** [eprint.iacr.org/2024/1018](https://eprint.iacr.org/2024/1018)
**Authors:** Li, Liang, Dong
**Affects:** `sp1-prover/`, zkML circuits
**Status:** Researchable now
**Contract changes:** None

ZK framework specifically designed for **pruned and quantized models**. XFuel already uses quantized model variants (`"variant": "quantized"` in EdgeCloud API). This paper provides the ZK framework that exploits sparsity from quantization/pruning to dramatically reduce proof size and generation time. Directly synergizes with XFuel's existing quantized inference routing.

---

## Tier 3 — Monitor

| Paper | Link | Relevance |
|---|---|---|
| Plonk Without Random Oracles | [2026/200](https://eprint.iacr.org/2026/200) | Hardens PLONK security proof — relevant to recursive verification safety |
| arya-STARK: Aggregation-Robust Federated Learning | [2025/2238](https://eprint.iacr.org/2025/2238) | STARK-based federated learning integrity — DataHubs circuit alignment |
| PIRANHAS: Privacy-Preserving Remote Attestation in Swarms | [2025/2228](https://eprint.iacr.org/2025/2228) | Swarm remote attestation without interaction — maps to `formSwarm` integrity |
| DNS-Anchored zk-SNARK Proofs | [2025/2332](https://eprint.iacr.org/2025/2332) | ZK for domain/TLS identity — relevant if XFuel adds identity circuits |
| Optimizing Backend Verification in zk-Rollup Architectures | [2025/1390](https://eprint.iacr.org/2025/1390) | BLS12-381 pairing check optimization — if XFuel moves to custom verifier |
| FRIVail: DAS from FRI Binius | [2025/2292](https://eprint.iacr.org/2025/2292) | Data availability sampling — relevant to Theta EdgeStore integration |
| DeepFold: Multilinear PCS from Reed-Solomon | [2024/1595](https://eprint.iacr.org/2024/1595) | 3x proof size reduction vs BaseFold — post-quantum verifier upgrade path |
| SoK: Lookup Table Arguments | [2025/1876](https://eprint.iacr.org/2025/1876) | Comprehensive survey of lookup arguments — informs Keccacheck + non-linear activation proving |
| SubLogarithmic Linear Time SNARKs (HybridPlonk) | [2025/908](https://eprint.iacr.org/2025/908) | Linear-time prover + sublogarithmic proof size — potential long-term SP1 successor |
| STIR: FRI with Fewer Queries | [2024/390](https://eprint.iacr.org/2024/390) | Better query complexity than FRI — relevant if XFuel moves to custom STARK |
| On Proving Pairings | [2024/640](https://eprint.iacr.org/2024/640) | Efficient in-circuit pairing verification — needed for recursive Groth16 inside SNARKs |
| ProtoGalaxy: Folding Multiple Instances | [2023/1106](https://eprint.iacr.org/2023/1106) | Efficient multi-instance folding — relevant to high-throughput batch settlement |
| Mangrove: Framework for Folding-based SNARKs | [2024/416](https://eprint.iacr.org/2024/416) | Boneh et al. — general-purpose folding framework; read alongside Interstellar for design patterns |
| LURK: Turing-complete ZK language | [2023/369](https://eprint.iacr.org/2023/369) | LISP-based ZK programming language — long-term alternative to SP1 circuit model |
| BumbleBee: Secure Two-party Transformer Inference | [2023/1678](https://eprint.iacr.org/2023/1678) | MPC for large transformer inference — latency benchmark reference for privacy premium tier |
| FANNG-MPC: Active-secure MLaaS Framework | [2023/1918](https://eprint.iacr.org/2023/1918) | Actively-secure MPC framework for ML-as-a-service — matches XFuel's AIaaS model |
| CryptGPU: GPU-accelerated Privacy-Preserving ML | [2021/533](https://eprint.iacr.org/2021/533) | GPU MPC framework — foundational reference for EdgeCloud GPU privacy layer |
| MIOPE: Ensemble Inference with Input/Output Privacy | [2025/2287](https://eprint.iacr.org/2025/2287) | Multi-model ensemble inference without trusted aggregator — DataHubs multi-model query privacy |
| Zendoo: zk-SNARK Verifiable Cross-Chain Transfer | [2020/123](https://eprint.iacr.org/2020/123) | Sidechain/mainchain ZK verification without knowing sidechain internals — architectural reference for Theta↔Bittensor relay |
| zkCross: Privacy-Preserving Cross-Chain Auditing | [2024/888](https://eprint.iacr.org/2024/888) | ZK cross-chain auditing + privacy — auditability vs privacy in relay (Phase 3+ if replacing Hyperlane) |
| QV-net: Decentralized Self-Tallying Quadratic Voting | [2025/1146](https://eprint.iacr.org/2025/1146) | DAO quadratic voting with maximal ballot secrecy — veXF governance / DAO vote privacy |
| Scalable Coercion-Resistant Voting for Blockchain | [2023/1578](https://eprint.iacr.org/2023/1578) | Coercion-resistant remote voting without vote-buying witness — veXF proposal voting hardening |
| Janus: Fast Privacy-Preserving Data Provenance for TLS | [2023/1377](https://eprint.iacr.org/2023/1377) | Selective TLS payload provenance at scale — DataHubs / attestation from web APIs |
| Trustless Delegation of Vector Commitment (partial disclosure) | [2025/1528](https://eprint.iacr.org/2025/1528) | VC with verifiable partial sequences for resource-constrained devices — DataHubs integrity + order |
| Overpass Channels: ZK-SNARK Payment Network | [2024/1526](https://eprint.iacr.org/2024/1526) | Horizontally scalable, privacy-enhanced payments with ZK — A2A micropayment / escrow design reference |
| Scalable and Lightweight State-Channel Audits | [2024/1135](https://eprint.iacr.org/2024/1135) | Auditable off-chain channel statistics (AML) — regulatory audit for createEscrow/claimEscrow flows |

---

## Recommended Next IACR Searches

Run these queries at [eprint.iacr.org/search](https://eprint.iacr.org/search) to find additional relevant papers:

| Query | What it finds | Searched |
|---|---|---|
| `zkML` | zkML-specific papers | ✅ |
| `recursive snark` | Recursive/IVC proof systems | ✅ |
| `"collaborative snark"` | Multi-party proof generation cluster | |
| `"proof delegation"` | Outsourced proving — the EdgeCloud privacy use case | ✅ (65 results — see new entries) |
| `folding` | IVC/folding schemes — Interstellar's family | |
| `"distributed prover"` | Multi-machine proof sharding | |
| `"verifiable inference"` | ML inference integrity proofs | ✅ (22 results — see new Tier 1 entries) |
| `"private inference"` | Input-hiding inference proving | ✅ (37 results — see notes below) |
| `keccak snark` | Nullifier circuit optimization | |
| `"federated learning" zk` | DataHubs / privacy-preserving training | ✅ (1 result — arya-STARK already tracked) |
| `"agent payment"` | Delegated AI payment authorization | ✅ |
| `"agent integration"` | Agent security protocols | ✅ (6 results — 1 relevant) |
| `"proof aggregation"` | Batch proof compression — rollup efficiency | ✅ (96 results — Cirrus, Hekaton, Symphony, 2026/410 added) |
| `"verifiable computation"` | Delegation + outsourcing of arbitrary computation | |
| `cross-chain proof` | ZK relay / sidechain verification | ✅ (12 results — Zendoo, zkCross added to Tier 3) |
| `proof of useful work` | Consensus aligned with real compute (e.g. ML) | ✅ (615 results — 2025/685 already Tier 2) |
| `private voting` | Coercion-resistant / private e-voting, DAO voting | ✅ (29 results — QV-net, 2023/1578 added to Tier 3) |
| `data provenance` | Verifiable data origin / TLS provenance | ✅ (38 results — Janus, 2025/1528; 2021/1633 already in pipeline) |
| `payment channel` | Off-chain payments, state channels, escrow | ✅ (56 results — Overpass, 2024/1135 added to Tier 3) |

---

## Stack Impact Summary

| XFuel Component | Papers to Watch |
|---|---|
| `sp1-prover/` (all proofs) | Interstellar, Neo/SuperNeo, UltraFold, GKR Boolean, Quasar (accumulation), Symphony (no in-circuit hash) |
| `ZKMLCircuit` / `ThetaInferenceCircuit` | zkGPT (2025/1184), VerfCNN (2025/2020), zkRNN (2026/073), 2026/111, 2025/507, 2025/1732, Sparsity-Aware, Interstellar |
| Swarm proving (`A2ACircuit`) | Interstellar collaborative folding, 2024/940+143, 2025/1388 (sublinear collab), 2026/410 (collab IVC), Cirrus (accountable distributed) |
| Agent execution proving (multi-step) | zkAgent (2026/199), Arbigraph (2025/710) |
| Recursive rollup (`verifyMultiLevelRecursive`) | Quasar, KiloNova, ProtoGalaxy, Mangrove, **Mira** (Groth16 aggregation), **Cirrus** (hierarchical aggregation), Hekaton |
| Input privacy (MPC layer, premium tier) | 2025/2251 (private GPT), Mosformer, PIGEON, BumbleBee |
| Input privacy (ZK-native, single/multi server) | 2025/2113 (single-server), 2024/940 (multi-server), DFS 2025/296 (delegation-friendly), 2024/1684 (blind zkSNARK) |
| Nullifier computation (`SP1ProofHooks`) | Keccacheck, SoK: Lookup Table Arguments, Symphony (eliminates in-circuit hash entirely) |
| Streaming / incremental tasks | Dynamic zk-SNARKs |
| Post-quantum readiness | Neo/SuperNeo, UltraFold (BaseFold), DeepFold, LatticeFold, Lova |
| Confidential A2A bids | gcVM |
| A2A agent authorization / consent | 2024/1839 (Cryptographic Digital Consent), 2026/395 (Fair Exchange) |
| DataHubs provenance pipeline | ZK Verifiable Decentralized AI Pipelines (2021/1633), arya-STARK, 2025/1732, Janus (2023/1377), 2025/1528 (VC delegation) |
| On-chain verifier (long-term) | Polymath (shorter Groth16), STIR (fewer FRI queries), HybridPlonk |
| Security model / audit prep | 2025/2037 (IVC malleability), 2025/1663 (IVC security proof), Plonk Without RO |
| Cross-chain relay (Hyperlane / ZK bridge) | Zendoo (2020/123), zkCross (2024/888) |
| Consensus / PoUW alignment | 2025/685 (Proofs of Useful Work from Matrix Multiplication) |
| veXF governance / private voting | QV-net (2025/1146), Scalable Coercion-Resistant Voting (2023/1578) |
| A2A escrow / micropayments | Overpass Channels (2024/1526), State-Channel Audits (2024/1135) |

---

## Interstellar-Optimized Stack & Integration (If Adopted)

*Only relevant if Interstellar is chosen as a prover path after evaluation (see Tier 1 breakdown). Otherwise rely on SP1 + 2024/940, Cirrus, zkGPT, etc.*

Interstellar (GKR-based IVC + collaborative folding) can be **optimized or composed** with other pipeline tech so one integrated stack covers zkML, swarm, and settlement.

### Combo options (when using Interstellar)

| Layer | Interstellar role | Combine with | Outcome |
|-------|-------------------|--------------|---------|
| **zkML front-end** | GKR handles matrix / sum-check for transformer ops | **zkGPT** (2025/1184) or **2026/111** (matrix constraints) | Use zkGPT/2026/111 for circuit design and witness format; use Interstellar as prover backend for same circuit to get 1.59x–6.74x speedup. No conflict: one defines *what* is proved, the other *how* it’s folded. |
| **Binary / EVM** | GKR is matrix-friendly, weak on bitwise | **GKR Boolean** (2025/717) | Extend Interstellar to bridge/settlement/governance circuits (EVM state, bitwise ops) without leaving GKR family. Single prover backend for both zkML and non-ML circuits. |
| **Recursion / hash** | Folding today needs in-circuit hash (Keccak cost) | **Symphony** (2025/1905) | Symphony removes in-circuit hash from folding. If Interstellar’s recursion is re-expressed in Symphony’s framework, nullifier and recursion cost drop; evaluate compatibility of GKR folding with Symphony’s lattice-based folding. |
| **Collaborative + accountability** | Interstellar gives collaborative folding | **2024/940+143** or **Cirrus** (2024/1873) | Interstellar = cryptographic primitive (joint proof from disjoint witnesses). 2024/940 = privacy across workers; Cirrus = coordinator + slashing. Path: Interstellar for per-swarm proof, Cirrus for distribution and accountability over many workers. |
| **Final aggregation** | Interstellar outputs a folded proof | **Mira** (2024/2025) | Batch many Interstellar (or SP1) proofs; aggregate with Mira for cheaper Groth16 verification. Clean split: Interstellar = prover efficiency, Mira = verifier efficiency. |
| **Post-quantum** | Interstellar is discrete-log based | **LatticeFold** / **Neo** | When moving to PQ: replace Interstellar’s folding with LatticeFold or Neo; keep “collaborative folding” semantics and swap the commitment scheme. |

### Suggested integrated stack (only if Interstellar is the chosen prover)

1. **Circuit / witness:** zkGPT (or 2026/111 + 2025/507) for LLM inference; GKR Boolean for bridge/governance.
2. **Prover:** Interstellar as primary backend (when available); optional 2024/940 or Cirrus for multi-worker distribution and accountability.
3. **Recursion:** Current in-circuit Keccak → evaluate Symphony or Keccacheck to reduce cost.
4. **On-chain:** Mira for Groth16 aggregation; existing `ZKVerifierSP1` for single-proof verification.

Integration order *if you adopt Interstellar*: (1) Ship when Theta EdgeCloud supports it; (2) add GKR Boolean for non-ML circuits; (3) layer Cirrus or 2024/940 for swarm; (4) add Mira for batch verification; (5) revisit Symphony/LatticeFold when PQ or recursion cost is the bottleneck. If you do *not* adopt Interstellar, the same circuit/verifier choices (zkGPT, Mira, etc.) still apply with SP1 or 2024/940 as prover.

---

## Managing the Innovation Pipeline

The pipeline is large and growing. Practical ways to keep it actionable:

1. **Triage cadence** — Quarterly: re-rank Tier 1/2 against the Product-Fit Shortlist; move items that no longer fit product roadmap to Tier 3 or “Defer.”
2. **Single owner per theme** — Assign one owner per theme (e.g. zkML, swarm, rollup, privacy, DataHubs). They decide what gets prototyped and what stays “monitor.”
3. **Dependency graph** — Before prototyping, write down: “This blocks / is blocked by X.” Prefer starting with unblocked items (e.g. zkGPT, Fair Exchange, Mira) and defer things that depend on multiple unknowns (e.g. full PQ migration).
4. **One proof-system migration at a time** — Avoid parallelizing multiple prover/circuit changes “Interstellar + zkGPT + Cirrus + Symphony” in the same sprint. Sequence: e.g. zkGPT first (circuit/witness), then one prover path (SP1 improvements, or 2024/940, or Interstellar if adopted), then Cirrus (distribution), then verifier-side (Mira / Symphony).
5. **“Do / Do next / Monitor” buckets** — Force every Tier 1/2 entry into exactly one: **Do now** (in current roadmap), **Do next** (next quarter or next year), **Monitor** (no commitment). Product-Fit Shortlist is the “Do now / Do next” source of truth.
6. **Reuse one doc** — Keep a single pipeline doc (this file); link from WHITEPAPER Section 12 and AGENTS.md so roadmap and research stay in sync.
7. **IACR search discipline** — When adding new searches, add 1–3 Tier 2/3 entries max per search; avoid turning every search into 10 new “must read” papers. Prefer updating existing rows with “see also X.”

---

*Last updated: March 2026. Searches completed: zkML, recursive snark, agent payment, agent integration, federated learning zk, private inference, verifiable inference, proof delegation, proof aggregation, zk inference, cross-chain proof, proof of useful work, private voting, data provenance, payment channel.*
*Cross-reference with [`WHITEPAPER.md`](../WHITEPAPER.md) Section 12 (Research Track) for the Interstellar roadmap entry.*
