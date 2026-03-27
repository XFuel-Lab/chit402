# Phase 1 Integration Plan — zkGPT + Fair Exchange

> Execution plan for integrating Phase 1 of the [ZK Research Upgrade Package](./ZK-RESEARCH-UPGRADE-PACKAGE.md): **zkGPT** (LLM inference proofs) and **Fair Exchange** (A2A atomic payment ↔ result). This doc separates **research** (paper review, feasibility, compatibility) from **implementation** (code, contracts, SDK).
>
> **Phase 1 scope:** **Second verifier only** for zkGPT. Wrapper and zkVM-friendly LLM proving are **future / bounty** (see § 0.2 and [upgrade package](./ZK-RESEARCH-UPGRADE-PACKAGE.md)).
>
> **Attribution:** Formal citations and research credits — [REFERENCES-AND-ATTRIBUTION.md](./REFERENCES-AND-ATTRIBUTION.md).
>
> **Run Phase 1 checks and current status:** [PHASE1_KICKOFF.md](./PHASE1_KICKOFF.md#run-phase-1-checks) — `npm run test:phase1`, contract tests, zkGPT mock smoke test, post-deploy checklist.

---

## 0. zkGPT in Phase 1: Second Verifier; Future/Bounty for Wrapper and zkVM

### 0.1 How we settle (second verifier path)

Settlement does not change structurally: we verify a proof, then run the same fee distribution and state updates.

| Step | What happens |
|------|----------------|
| 1. Task | User submits `inference_request`; backend routes to GPU; GPU runs model → output. |
| 2. Inference proof | Prover (our service or GPU node) runs **zkGPT prover**: (model_commitment, input, output) → zkGPT proof π (~101 KB). |
| 3. Verify | We call **`ZKVerifierZkGPT.verifyZkGPTProof(publicValues, π)`** (or equivalent). Non-inference (bridge, A2A) keeps using `ZKVerifierSP1`. |
| 4. Settle | Same as today: nullifier recorded, fees to CoreRevenueSplitter, payout to provider, events emitted. Public values (task_id, output_hash, amounts, chain, etc.) are already part of the proof; no extra settlement contract logic. |

So: **we settle by verifying the inference proof (either wrapped or native), then applying existing fee and payout logic.** The only difference is which verifier contract we call and what proof bytes we pass.

### 0.2 Wrapper-first, then fallback

| Priority | Approach | What we do | If it fails |
|----------|----------|------------|-------------|
| **1. Attempt first** | **Wrapper** | Build a circuit that takes (zkGPT proof π, zkGPT public inputs) and proves “π is valid” → output Groth16 proof Π. Submit Π to existing `ZKVerifierSP1`. One verifier on-chain, same settlement flow. | Fall back to 2. |
| **2. Fallback** | **Second verifier** | Add `ZKVerifierZkGPT` (or equivalent) that runs GKR + Lasso verification. For inference tasks with `proof_system: zkgpt`, call this verifier instead of SP1. Settlement (fees, nullifier, payout) unchanged. | — |

This keeps the pipeline aligned: zkGPT is the inference prover; all other upgrades (Phase 2–6) attach to the same settlement and API layer. We only add a second verifier if the wrapper is not practical.

### 0.3 Wrapper: difficulty and “attempt first”

The wrapper circuit must **verify a zkGPT proof inside a SNARK**: i.e. implement the zkGPT verifier (GKR + Lasso) as an arithmetic circuit and prove that computation with Groth16 (or another proof system our verifier accepts). So:

- **Theoretically:** Verifier is polynomial-time → can be compiled to a circuit. Doable.
- **Practically:** GKR and Lasso have many rounds, polynomial evaluations, Fiat–Shamir; the circuit could be large and expensive. Success means: (1) implement verifier in circuit form, (2) run trusted setup (or use transparent), (3) prove in reasonable time and (4) verify on-chain at acceptable gas.

**“Attempt first”** = time-boxed spike (e.g. 2–4 weeks):

1. **Spike 1:** Implement a minimal zkGPT verifier in the target circuit format (e.g. R1CS / Circom / arkworks) for a **single** layer or small proof (e.g. one matrix mult or one Lasso lookup). Measure circuit size and rough proving time.
2. **Spike 2:** If spike 1 is plausible, try full zkGPT verifier for GPT-2-small or one block. If gas or proving time is prohibitive, document and switch to second verifier.
3. **Decision gate:** If wrapper is viable → productize (trusted setup, integration, audit). If not → implement and deploy `ZKVerifierZkGPT`, document the decision in this doc.

No change to settlement design: we still settle the same way; only the verification path (wrapper vs second verifier) differs.

**Impact of a second verifier (Phase 1 choice):** One extra contract and one routing branch; each tx still verifies one proof (no extra per-tx cost). Two code paths and gas profiles to maintain; audit surface +1 verifier. **Net: minimal perf impact; small design addition.** Wrapper and zkVM-friendly LLM proving are **future / bounty** (see [upgrade package](./ZK-RESEARCH-UPGRADE-PACKAGE.md) Phase 1).

---

## 1. Research We Need to Do

### 1.1 zkGPT (Paper 2025/1184)

| Research task | Why it matters | Output |
|---------------|----------------|--------|
| **Read the full paper** | Pipeline says “assess whether it replaces SP1 zkVM approach or layers on top.” We need to know: (a) proof system (Groth16/PLONK/other?), (b) circuit representation (R1CS, custom constraints?), (c) whether it composes with our existing `ZKVerifierSP1` (Groth16/PLONK) or needs a new verifier. | Short write-up: “zkGPT proof format and verifier requirements” |
| **Find / evaluate open-source implementation** | Pipeline: “Identify if zkGPT has an open-source implementation (check author GitHub: jiahengzhang).” If yes, we can prototype against real code; if no, we need to implement from the paper or defer. | Decision: use existing repo vs implement from paper vs prototype with SP1 and migrate later |
| **Map to current stack** | We have `ZKMLCircuit.sol` (model registry, commitment, inference request) and `sp1-prover/` (Rust program + host, currently deposit/bridge). Need to know: does zkGPT produce proofs our `ZKVerifierSP1.verifyProof` can verify, or do we need a zkGPT-specific verifier contract? | Compatibility matrix: zkGPT proof → current verifier yes/no; if no, what changes |
| **Benchmark baseline** | “Benchmark against current SP1 approach on Theta EdgeCloud quantized model.” We need a baseline (current SP1 zkVM proving time/cost for one inference) so we can compare zkGPT. | Baseline: SP1 proof time + gas for one inference (e.g. small LLaMA variant or proxy task) |

**Deliverable:** A short **zkGPT feasibility memo** (1–2 pages) that answers: (1) Replace vs layer vs parallel path, (2) Verifier impact (same `ZKVerifierSP1` or new contract), (3) Implementation source (paper only vs repo), (4) Recommended first milestone (e.g. “single transformer block proof”).

---

### 1.2 Fair Exchange (Paper 2026/395)

| Research task | Why it matters | Output |
|---------------|----------------|--------|
| **Read the full paper** | Pipeline: “Assess whether the fair exchange primitive maps to `settleBid(bidId, resultHash, proofBytes, nullifier)`.” We need the exact cryptographic construction: what is exchanged (payment commitment vs result commitment?), and in what order. | Mapping: paper’s “buyer/seller exchange” ↔ our requester/provider, and which on-chain steps/commitments we need |
| **Atomicity mechanism** | “Can `resultHash` delivery and TFUEL escrow release be made atomic via this construction?” Today: relayer calls `settleBid` with proof; escrow is released after verification. We need to know if the paper gives us a single atomic step (e.g. hash-locked release) or a two-phase commit that we encode in the circuit. | Design: single atomic flow vs two-phase; and whether it’s circuit-only or contract + circuit |
| **Bitcoin vs EVM** | Paper title says “on Bitcoin/EVM.” Confirm the EVM construction (smart contract interface, any new opcodes or precompiles?) and that it fits Theta (EVM-compatible). | Confirmation: EVM construction is self-contained and Theta-compatible |
| **Delegation / custody** | Paper emphasizes “delegation without custody.” Map to our `createEscrow` / `claimEscrow` and agent-initiated payments: do we need new entrypoints or only harden `settleBid`? | Decision: Fair Exchange only in `settleBid` vs also in escrow flows |

**Deliverable:** A short **Fair Exchange design memo** that answers: (1) Exact mapping to `settleBid` and (optionally) escrow, (2) Contract/circuit changes (new state? new function? new proof type?), (3) Whether we need a new circuit or only a new flow that uses existing SP1 proof + new commitment pattern.

---

### 1.3 Cross-cutting

| Research task | Why it matters | Output |
|---------------|----------------|--------|
| **CertiK / audit scope** | `ZKMLCircuit` and `A2ACircuit` may be in scope for Phase 3 or later. Adding a new proof type (zkGPT) or new primitive (Fair Exchange) could expand audit surface. | Note: whether Phase 1 changes fall inside or outside current audit scope; any new contracts to include |
| **SP1 program vs zkGPT** | If zkGPT is a different proof system, do we keep SP1 for non-inference circuits (e.g. deposit, A2A proof) and add zkGPT only for inference? Or migrate inference to zkGPT and leave SP1 for the rest? | Single diagram: which circuit uses which prover/verifier after Phase 1 |

---

## 2. Implementation Plan (After Research)

Implementation is gated on the research outputs above. The following is the target shape once we have the memos.

### 2.1 zkGPT integration (Phase 1: second verifier only)

| Step | Description | Depends on |
|------|-------------|------------|
| **ZKG-1** | Integrate zkGPT prover (e.g. from [security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt)): input = (model commitment, input, output); output = zkGPT proof π. Start with single block or GPT-2-small. | zkGPT feasibility memo (implementation source) |
| **ZKG-2** | Implement and deploy **`ZKVerifierZkGPT`** (GKR + Lasso verification on-chain or via precompile). For inference tasks with `proof_system: zkgpt`, call this verifier. Settlement (fees, nullifier, payout) unchanged. | ZKG-1, zkGPT verifier spec |
| **ZKG-3** | Add `proof_system: zkgpt` to inference task request and backend routing; prover service produces π and submits to ZKVerifierZkGPT. | ZKG-1, ZKG-2 |
| **ZKG-4** | Wire `ZKMLCircuit` (or ZKMLCircuit_v2) to accept zkGPT path: same events, same fee path, verification via ZKVerifierZkGPT. | ZKG-2, ZKG-3 |
| **ZKG-5** | Benchmark: zkGPT prover time and verification gas; document. | ZKG-4, baseline from research |

**Code touchpoints (expected):**

- `contracts/circuits/ZKMLCircuit.sol` or new circuit (proof type, public inputs; same settlement logic)
- New: `zkgpt-prover/` or integration of upstream zkGPT prover; **`contracts/core/ZKVerifierZkGPT.sol`** (or chain precompile)
- `core-layer/` or `backend/theta-bridge/` (task routing, `proof_system` selection, call ZKVerifierZkGPT for zkgpt)

**Future / bounty (not Phase 1):** Wrapper (zkGPT π → Groth16 Π → ZKVerifierSP1); zkVM-friendly LLM proving. See upgrade package "Future / bounty upgrades."

### 2.2 Fair Exchange integration

| Step | Description | Depends on |
|------|-------------|------------|
| **FE-1** | Design atomic flow: e.g. provider commits to result hash; requester commits to payment release; single settlement call that checks both and executes. | Fair Exchange design memo |
| **FE-2** | Implement circuit or commitment logic per paper (if the construction requires a new proof type or new public inputs for `settleBid`). | Fair Exchange design memo |
| **FE-3** | Change or extend `A2ACircuit.settleBid`: e.g. new parameters (commitments, nonces) or new function `settleBidFairExchange(...)` that enforces atomicity. Keep backward compatibility with current `settleBid` if needed. | FE-1, FE-2 |
| **FE-4** | Relayer / backend: when using Fair Exchange, submit the new flow (commitments + settle) instead of current “proof + settle.” | FE-3 |
| **FE-5** | SDK: expose `client.settleWithFairExchange(bidId, result)` that builds the right commitments and calls the new flow. | FE-3, FE-4 |

**Code touchpoints (expected):**

- `contracts/circuits/A2ACircuit.sol` (new state or new function for atomic settle)
- `backend/theta-bridge/` or relayer (orchestration of Fair Exchange steps)
- `sdk/js/` (new method and types)

---

## 3. Order of Work

1. **Research first (both papers)**  
   - Produce zkGPT feasibility memo and Fair Exchange design memo.  
   - No commitment to full integration until we know: verifier impact, implementation source, and atomicity design.

2. **zkGPT path**  
   - If feasible: ZKG-1 → ZKG-2 → ZKG-3 → ZKG-4 → ZKG-5.  
   - If zkGPT is “layer on top” of SP1, we may only add a new SP1 program that encodes zkGPT’s circuit and keep one verifier.

3. **Fair Exchange path**  
   - After design memo: FE-1 → FE-2 → FE-3; then FE-4 and FE-5 (relayer + SDK).

4. **Parallelization**  
   - Research can run in parallel (one owner per paper).  
   - Implementation: zkGPT and Fair Exchange are independent (different contracts and flows), so after research both tracks can proceed in parallel if capacity allows.

---

## 4. Success Criteria for Phase 1

- **zkGPT:** At least one inference request (e.g. single block or small model) is proven with zkGPT and verified on-chain via the existing or extended verifier; proof time and gas documented.  
- **Fair Exchange:** At least one A2A bid is settled using the atomic Fair Exchange flow; no party can receive payment without result or result without payment.  
- **No regression:** Existing `inference_request` and `settleBid` flows still work (either unchanged or behind a feature flag / circuit version).

---

## 5. References

- zkGPT: [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184) — authors include Jiaheng Zhang; repo [security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt). **Whitepaper PDF** (e.g. `C:\Users\seeha\Downloads\zkGPT whitepaper.pdf`): GKR + Lasso; 101 KB proof; non-interactive; BN254; GPT-2 in &lt;25 s.
- Fair Exchange: [eprint.iacr.org/2026/395](https://eprint.iacr.org/2026/395) — “Delegated Payments for AI Agents: Fair Exchange on Bitcoin/EVM.”
- Pipeline: [ZK-RESEARCH-PIPELINE.md](./ZK-RESEARCH-PIPELINE.md) (§ zkGPT, § Fair Exchange).
- Package: [ZK-RESEARCH-UPGRADE-PACKAGE.md](./ZK-RESEARCH-UPGRADE-PACKAGE.md) (Phase 1). Kickoff: [PHASE1_KICKOFF.md](./PHASE1_KICKOFF.md); research templates: [research/zkGPT-feasibility-memo.md](./research/zkGPT-feasibility-memo.md), [research/fair-exchange-design-memo.md](./research/fair-exchange-design-memo.md).
