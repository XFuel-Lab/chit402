# Tier-3 zkGPT (Proof-of-Inference) — Unblock Decision Doc

> **Status:** Decision doc (planning only — no code in this pass).
> **Date:** 2026-07-17
> **Scope:** How to unblock Tier-3 (zkGPT proof-of-inference) given the GPU-capacity
> failure. Covers (a) feasible model/hardware sizing, (b) alternative backends /
> segmented proving, (c) whether Interstellar changes the math, (d) small-model-first
> scoping.
> **Authoritative state:** [`docs/RUNTIME_STATE.md`](../RUNTIME_STATE.md). Tier-1
> (signed receipt) and Tier-2 (SP1 settlement proof) are DONE/live; Tier-3 is
> BLOCKED. The local zkGPT mock is **dev-only** and never a demo/live path.

---

## 1. TL;DR & Recommendation

> **Two findings, in order of importance:**
> **(1) Do not rebuild zkGPT from the academic repo — adopt what already shipped.**
> The zkML field moved fast: as of **mid-2026 the exact thing we set out to build is a
> solved, open-source, production-grade problem** (Lagrange **DeepProve**, plus
> Polyhedra **zkPyTorch/Expander**). DeepProve already proves **GPT-2, Gemma-3, and
> Llama-class (incl. Llama-3 70B on its public dashboard) end-to-end**, with **12M+
> proofs in production** and on-chain verification. Re-implementing zkGPT (GPT-2-only,
> 1-contributor academic C++) would be **reinventing a worse version of a solved
> problem**. See the feasibility breakdown in **§1A**.
> **(2) The original blocker was misdiagnosed (RAM, not GPU)** — still true and still
> useful, because every one of these systems is RAM-heavy. Kept below.

**The blocker was misdiagnosed.** zkGPT (upstream `security-Anonymous/zkgpt`, eprint
2025/1184) is **not a GPU workload**. The paper's own hardware is a **16-core Intel
Xeon 6126 CPU with 200 GB RAM, 32 threads** — no GPU. The only GPU-relevant part is
the *circuit-initiation* pre-step (plaintext matmul), which the authors call a
demo-only bottleneck, not the proving bottleneck. We were chasing GPU instances for a
job that actually needs **a big-RAM CPU box**. The OOM-kills we saw on EdgeCloud/AWS
GPU nodes are consistent with a RAM ceiling, not a GPU ceiling. (DeepProve's own
single-machine numbers use a **24-core / 504 GB CPU** box — same shape, bigger RAM.)

**There are two independent blockers, and only one is about hardware:**

1. **Prover:** produce a real proof-of-inference. **Hardware = high-RAM CPU, not
   GPU.** Whether via zkGPT or DeepProve, this needs ~256–512 GB RAM.
2. **On-chain verifier:** `ZKVerifierZkGPT.sol` is a **stub**. zkGPT uses **GKR +
   Lasso + Hyrax on BN254** — a *different* proof system from our SP1 Groth16 path.
   Nothing is verified on-chain today. **This is the real long pole** — and it is
   *also largely solved for us* if we adopt DeepProve (it ships a verifier + on-chain
   verification path).

**Recommendation — adopt, don't rebuild; proceed smallest-first:**

- **Step 0 (decision, do now):** Adopt **DeepProve** as XFuel's Tier-3
  proof-of-inference engine (primary), with Polyhedra **zkPyTorch/Expander** as the
  fallback. **Do not invest in rebuilding zkGPT.** Gate: confirm the **Lagrange
  License** on the `zkml` crate permits our use (commercial/self-host) — see §1A.4.
- **Step A:** Stand up DeepProve on a **high-RAM CPU** host reachable from the demo
  path (Tier-2 pattern). Prove **GPT-2** end-to-end first (their smallest working
  model), using an ONNX/GGUF model we actually serve. Deliverable: a real proof +
  measured time/RAM (their published GPT-2 point: 512 tokens ≈ 7.6 min, verify 1.3 s,
  ~10.7 MiB proof on a 24-core/504 GB box).
- **Step B (verifier):** Wire DeepProve's verification into settlement — **(B1)**
  off-chain verify + signed attestation for a fast, honest demo, then **(B2)** its
  on-chain/EVM verifier (or a Groth16 wrapper) for trust-minimized Tier-3 on Base.
- **Step C (scope honesty):** With DeepProve, Tier-3 can honestly scale toward
  **Llama-class** over time — but the proof attests a **quantized** forward pass
  (~12–16 bit; DeepProve reports ≥99.6% cosine similarity to fp baseline), not exact
  fp16. State this in receipts.

**Interstellar does not unblock this** (see §5): a prover-side speedup that is
"pending toolchain," not integrated into SP1/zkGPT/DeepProve, and it doesn't change
the RAM reality or build the verifier. Track it; don't wait on it.

**Do we need to invent a new way? No.** Given DeepProve + zkPyTorch are open and
production-proven, inventing a novel proof system would be a large, high-risk effort
that duplicates work others have already productized and battle-tested at 12M+ proofs.
Reserve "invent" only for the thin XFuel-specific glue (input/output-hash binding,
settlement/nullifier wiring, receipt schema) — not the core cryptography.

> **If adoption is licensing-blocked (likely — DeepProve's core is a custom Lagrange
> License):** see the companion
> [`tier3-verifiable-inference-strategy.md`](./tier3-verifiable-inference-strategy.md)
> for the build-our-own path — clean-room from the same permissive primitives
> (`ceno`, `gkr-backend`, `arkworks`, Plonky3, Jolt/Lasso; **avoid** AGPL Expander),
> the market/moat analysis, and why the headline bet is **anti-downgrade +
> payment-bound hybrid tiers**, not a faster full-LLM prover.

---

## 1A. Feasibility: build zkGPT ourselves vs adopt (2026 landscape)

This section answers the three direct questions: *how likely are we to actually build
zkGPT? has anyone else succeeded? can we capture their success?*

### 1A.1 How likely are we to successfully build zkGPT ourselves?

**Low value, medium-high effort, and largely pointless in 2026.** Not because it's
impossible — the RAM reframing (§2) makes a GPT-2 demo genuinely achievable — but
because:

- The upstream repo (`security-Anonymous/zkgpt`) is an **academic artifact**: **1
  contributor, ~11 stars, GPT-2-only, quantized-only**, no HTTP/JSON API, no
  input/output binding, and (critically) **no usable verifier** — the demo just prints
  a proving time. To get to trust-minimized Tier-3 we'd have to build: (a) an
  input-binding adapter, (b) segmentation for anything past GPT-2, and (c) the entire
  **GKR+Lasso+Hyrax on-chain verifier** from the paper. That last item alone is a
  multi-month specialist cryptography effort.
- Meanwhile the research frontier has **moved past zkGPT** (see 1A.2). Building it now
  means shipping a strictly weaker system than freely-available alternatives.

**Estimate:** rebuilding zkGPT to a *credible on-chain Tier-3* ≈ the same order of
effort as the last model build you described — and it lands behind the state of the
art on day one. **Not recommended.**

### 1A.2 Has anyone else successfully built this? (Yes — and surpassed it)

Verifiable **LLM** inference proving went from "academic, hours per proof" to
"open-source, production" during 2025→2026. Key players:

| Project | Status (2026) | Models proven | Proof system | Notes for XFuel |
|---|---|---|---|---|
| **Lagrange DeepProve** | **Open source (Jun 2026), production** | GPT-2, Gemma-3, **Llama-2 / Llama-3 8B & 70B** (public dashboard) | sumcheck + **logup GKR** (same family as zkGPT, far better engineered); reuses `scroll-tech/ceno` | **Best fit.** Full stack (circuits/prover/verifier), **ONNX/safetensors/GGUF**, GPU + distributed proving, on-chain verify, **12M+ proofs in prod**. Accuracy-preserving (≥99.6% cosine sim). CCS 2026 paper (eprint 2026/1112). |
| **Polyhedra zkPyTorch → Expander** | Production SDKs/APIs | VGG-16, **Llama-3** (~150 s/token) | GKR (Expander) | Strong fallback. PyTorch/ONNX in; Python + Rust SDKs, REST proof/verify APIs. eprint 2025/535. |
| **JSTprove (Inference Labs)** | Open (v2.7) | ONNX (Conv2D/GEMM/ReLU/…) | Expander (GKR) | CLI over Expander; **"production use strongly discouraged"** per its own README. Reference only. |
| **EZKL** | Mature, widely used | Small models; **struggles > ~1M params** | Halo2 | Great for tiny models; **not** an LLM path. |
| **NANOZK** (arXiv 2603.18046) | Academic (2026) | GPT-2, GPT-2-Medium, TinyLLaMA-1.1B | Layerwise GKR; **constant 6.9 KB/layer** proofs, 43 s/block | Interesting design (selective per-layer verify) but academic, not productized. |
| **zkLLM** (Sun et al. 2024) | Academic | **LLaMA-13B in ~15 min on A100** | tlookup + zkAttn | GPU-based; predecessor of the current wave. |
| **zkGPT** (our current target) | Academic artifact | **GPT-2 only** | GKR + Lasso + Hyrax, BN254, ~101 KB, <25 s | What we've been trying to build. Now clearly **dominated** by DeepProve. |

**Bottom line:** the thing we set out to build is not just *possible* — it's **already
open-sourced, better, and running in production at millions of proofs** by a team whose
framing ("a cryptographic receipt for every AI inference") is almost identical to
XFuel's Tier-3 pitch.

### 1A.3 Can we capture their success? (Yes — this is the play)

Adopting DeepProve maps cleanly onto XFuel's existing scaffolding and gets us further
than a zkGPT rebuild ever would:

- **Prover:** DeepProve replaces the C++ zkGPT prover + our mock. Slot it behind the
  same `ZKGPT_PROVER_URL`-style client the gateway already speaks to (rename to a
  generic `INFERENCE_PROVER_URL`). ONNX/GGUF means we can feed a model we already
  serve.
- **Verifier:** DeepProve ships a verifier and an on-chain verification path — this
  **retires the biggest unknown** (the from-scratch GKR+Lasso Solidity verifier in
  `ZKG2_VERIFIER_SPEC.md`). We adapt `ZKVerifierZkGPT.sol` (or a renamed
  `ZKVerifierInference`) to their verification interface / wrapper instead of writing
  sumcheck verification ourselves.
- **XFuel-only glue (the part we *do* build):** bind DeepProve's public
  inputs/commitments to XFuel's task (`input_hash`, `output_hash`, model commitment),
  wire the nullifier + settlement path on Base, and define the Tier-3 receipt schema.
  This is integration work, not cryptography research.
- **Two adoption modes:**
  - **Self-host** the open-source prover on our high-RAM box (max control; subject to
    the Lagrange License — see 1A.4).
  - **Consume the Lagrange prover network** as a service (pay-per-proof in ETH/USDC/LA)
    — least infra, but adds an external dependency + per-proof cost, and pays a
    competing network. Evaluate as a stopgap / burst path, not the identity.

### 1A.4 Caveats before committing (must-check gates)

- **License (blocking gate).** DeepProve's core **`zkml` crate is under a custom
  "Lagrange License"** (the rest is Apache-2.0 + MIT). It **may restrict commercial use
  or linking into a proprietary/for-profit protocol.** XFuel must **read that license
  and confirm** our intended use (self-hosted, commercial settlement layer) is
  permitted before building on it. If it isn't, pivot to **Polyhedra zkPyTorch/Expander**
  (check its licensing too) or negotiate terms with Lagrange. *This is the single most
  important thing to resolve first.*
- **Perf is minutes + MB, not zkGPT's "<25 s / 101 KB."** DeepProve trades proof
  size/time for real end-to-end LLM coverage (GPT-2 ≈ 7.6 min, ~10.7 MiB proof). Fine
  for async settlement + on-demand Tier-3; not a per-request hot-path cost. Budget
  accordingly.
- **Quantized, not fp.** Same precision caveat as zkGPT; disclose in receipts.
- **Strategic dependency.** Adopting a Lagrange/Polyhedra stack ties a core XFuel trust
  tier to an external prover ecosystem (and, for DeepProve-as-a-service, a competing
  token network). Prefer **self-hosting the open-source prover** so XFuel owns the
  path; keep the vendor network as optional burst capacity.

### 1A.5 When would "invent a new way" be justified?

Only if **both** DeepProve **and** zkPyTorch are license-incompatible or technically
unworkable for us. Even then, the move is not to invent a new proof system from scratch
but to build on open primitives (`ceno`, Expander/ECC, `sumcheck`/`logup-GKR`,
`arkworks`) — i.e. assemble from the same open components these teams used, not
reinvent the cryptography. Greenfield proof-system research should be treated as a
**last resort**, not a plan.

---

## 2. What "blocked" actually means (root-cause reframing)

From the repo (`services/zkgpt-prover/README.md`, `RUNBOOK-LOCAL-AND-THETA.md`,
`docs/research/zkGPT-feasibility-memo.md`, `docs/ZKG2_VERIFIER_SPEC.md`) and the paper:

| Claim in blocker | Reality | Evidence |
|---|---|---|
| "Need more GPU" | zkGPT proving is **CPU + high-RAM**, 32 threads. GPU only helps a demo-only pre-step; **no CUDA prover exists upstream.** | Paper §Hardware: "Intel Xeon 6126 … 200GB memory … 32 thread parallelization." GitHub README: circuit-init on GPU is "future work," "will not become bottleneck in real world." |
| "Largest GPU instance still failed" | Symptom matches **RAM exhaustion / OOM**, and secondarily container-orchestration issues on EdgeCloud (crash loops, `fsnotify`/inotify limits, readiness probes). | `README.md`: "C++ prover can use a lot of RAM … may be OOM-killed → `proof_outcome: regenerable`, 502." `RUNBOOK` Troubleshooting §1–5 is entirely EdgeCloud deploy/crash-loop, not GPU compute. |
| "If we get GPU, Tier-3 is done" | Even a working prover ≠ Tier-3. The **on-chain verifier is a stub** and would revert. | `ZKG2_VERIFIER_SPEC.md`: `_verifyZkGPTProof` returns false; "settlement will still revert with `ProofFailed` until ZKG-2." |
| "zkGPT proves our llama-3-70b route" | Upstream **only supports GPT-2** (124M-class), quantized (Q=16), fixed dims (12 layers/12 heads/seq≈30). | Paper §9.3 Limitations; README "Current implementation only supports GPT-2." |

**Net:** the hardware problem is real but *mis-shaped* (RAM box, not GPU), and it is
the *easier* of two blockers. The harder blocker is the verifier + the honest scope of
the claim.

---

## 3. (a) Feasible zkGPT circuit / model sizes vs hardware

zkGPT cost is dominated by (i) proving matrix-mults (linear layers) via GKR and
(ii) lookups (Lasso) for non-linear layers (GeLU/softmax/LayerNorm/rounding). Cost
grows with the transformer's total FLOPs ≈ `L · s · d²` (layers × seq-len ×
hidden²). RAM tracks the largest bookkeeping tables + committed intermediate values.

### Reference point (paper, measured)
- **Model:** GPT-2 (the paper's target; upstream demo hardcodes 12 layers, 12 heads,
  seq len ≈ 30).
- **Hardware:** 16-core Xeon, **200 GB RAM**, 32 threads.
- **Prover time:** **< 25 s**. **Proof size:** ~**101 KB**. **Curve:** BN254 (~100-bit).
- **Precision:** quantized Q=16 only (no floating point — see §3 caveat).

### Feasibility matrix (planning estimates — must be confirmed by Step A benchmark)

| Model target | Params | Feasible with upstream code? | Hardware needed | Notes |
|---|---|---|---|---|
| **GPT-2-small** | 124M | **Yes (paper-proven)** | ~256 GB RAM, ≥16 vCPU, **no GPU** | Direct demo target. Start here. |
| GPT-2-medium/large | 355M–774M | Likely, untested | 256–512 GB RAM | Larger tables; RAM is the risk, not GPU. Confirm empirically. |
| GPT-2-XL | 1.5B | Uncertain | 512 GB–1 TB RAM | Beyond paper; may need segmentation (§4). Treat as stretch. |
| Llama-class 7B | 7B | **No (not supported)** | — | Different arch (RoPE, SwiGLU, RMSNorm, GQA). Upstream is GPT-2-specific. Would require new circuit engineering, not just hardware. |
| Llama-3-70B | 70B | **No** | — | Not realistic with this codebase in 2026. Do not promise it. |

**Two hard caveats that bound the claim:**

1. **GPT-2 only.** The circuits are written for GPT-2's block structure. "Prove
   llama-3-70b" is out of scope for zkGPT-upstream regardless of hardware.
2. **Quantized only.** Paper §9.3: zkGPT "is unsuitable for directly proving the
   floating-point inference." So a Tier-3 proof attests a **quantized** GPT-2 forward
   pass, not the exact fp16 output a production endpoint would return. This must be
   stated in any receipt/marketing (consistent with RUNTIME_STATE's tiered-trust
   precision).

### What hardware to actually provision (Step A)
- **Primary:** one **memory-optimized CPU** instance, ~**256 GB RAM**, 16–32 vCPU
  (e.g. AWS `r6i.8xlarge`/`r7i.8xlarge` = 256 GB; `x2/u-` for headroom). Spot/on-demand
  for a one-shot demo proof is fine. **No accelerator.**
- **Reachability:** must be callable from the demo path. Mirror the Tier-2 pattern —
  prover behind a locked-down endpoint, reachable from the Lightsail demo box
  (`35.180.10.142`). Do **not** try to co-host on the small Lightsail box.
- **EdgeCloud:** only worth retrying if EdgeCloud offers a **high-RAM CPU** SKU (not a
  GPU SKU). If EdgeCloud can't give ≥256 GB RAM, it's the wrong host for this job;
  that's a capacity mismatch, not a protocol blocker.

---

## 4. (b) Alternative proving backends & partial / segmented proving

### 4.1 Segmenting the zkGPT proof (biggest lever on the RAM wall)
zkGPT proves the network layer-by-layer; GKR is naturally per-layer/per-block. The RAM
ceiling comes from holding large tables/witnesses simultaneously. Options:

- **Per-transformer-block proving + recursion/aggregation.** Prove each block (or a
  small group of blocks) independently, chaining the inter-block activation commitment,
  then aggregate. Keeps peak RAM to ~one block. This mirrors the paper's "circuit
  squeeze" parallelism and matches XFuel's existing recursive-aggregation instinct.
  **Cost:** engineering — upstream demo doesn't expose a streaming/segmented API
  (`README` §"Upstream interface": demo has no I/O contract). Requires modifying the
  C++ or building an adapter that drives block-wise proving.
- **Single-block milestone first.** The feasibility memo already names "single
  transformer block" as an acceptable first milestone. A one-block proof is a genuine,
  demonstrable proof-of-inference primitive and de-risks the pipeline at tiny RAM.
- **Distributed proving (later).** Papers already tracked in
  [`ZK-RESEARCH-PIPELINE.md`](../ZK-RESEARCH-PIPELINE.md) — **Cirrus** (2024/1873,
  accountable distributed SNARK), **Hekaton** (2024/1208, shard witness across
  machines) — target exactly the "circuit too big for one machine's RAM" regime.
  These are the principled fix if we push past GPT-2-small. Not needed for the first
  demo; note as the scale path.

### 4.2 Verifier backends (the real long pole)
zkGPT proofs (GKR+Lasso+Hyrax, BN254, ~101 KB) cannot be verified by our SP1 Groth16
verifier. From `ZKG2_VERIFIER_SPEC.md`, three options:

| Option | What it is | Trust | Effort | When |
|---|---|---|---|---|
| **B1. Off-chain verifier + attestation** | Run the zkGPT verifier off-chain (fast, √N verify time); XFuel signs an attestation that a valid proof was seen. | Committee/attester trust (Tier ~2.5) | Low | **Ship the first credible demo.** Clearly labeled as attested, not on-chain. |
| **B2a. On-chain GKR+Lasso in Solidity/Yul** | Implement sumcheck + Lasso + Hyrax checks using BN254 precompiles (`ecAdd/ecMul/ecPairing`). | Trustless | **High** (complex, gas-heavy) | Trust-minimized end state; needs exact byte layout from upstream. |
| **B2b. Groth16-wrapper** | A SNARK circuit that verifies the zkGPT proof; emit one Groth16 π → reuse `ZKVerifierSP1`. | Trustless | High (build the wrapper circuit) | Cleanest on-chain story; already flagged as "future/bounty" in the upgrade package. |

**Recommendation:** **B1 now** (unblocks a real, honestly-labeled Tier-3 demo without
waiting on a hard crypto build), with **B2b (wrapper)** as the trust-minimized target
because it collapses Tier-3 onto the existing Base verifier and Groth16 gas profile.

> **Note (supersedes much of §4.1–4.2 for the recommended path):** if we **adopt
> DeepProve** (§1A), most of the above is handled upstream — DeepProve does its own
> layer-by-layer proving, aggregation, distributed/GPU proving, **and ships a verifier
> with an on-chain path.** The segmentation and from-scratch verifier work below only
> applies if we (against recommendation) rebuild zkGPT ourselves. The verifier-trust
> taxonomy (B1 attestation vs B2 on-chain/wrapper) still applies — it's how we wire
> DeepProve's verification into settlement.

### 4.3 Backend choice — adopt, ranked
Our existing zkGPT scaffolding (client, wrapper, routing `proof_system`, stub verifier,
tests) is a **thin integration seam we can keep and repoint at a better prover** — not
a reason to finish the academic zkGPT. Ranked:

1. **DeepProve (primary).** End-to-end LLM, open source, verifier included, ONNX/GGUF,
   production-proven. Pending the license gate (§1A.4).
2. **Polyhedra zkPyTorch/Expander (fallback).** If DeepProve's license blocks us, or
   we prefer a PyTorch-native compiler + Expander.
3. **Finish upstream zkGPT (not recommended).** Only if 1 and 2 are both unworkable —
   and even then, reuse open primitives rather than the 1-contributor repo.
4. **EZKL / SP1-zkVM over a tiny model (demo-only crutch).** Fast to stand up for a
   *toy* proof but not an LLM path; avoid presenting as the real Tier-3.

---

## 5. (c) Does Interstellar change the GPU/feasibility math?

**Short answer: no, not for unblocking Tier-3 now.**

- **What it is:** Interstellar (eprint 2025/1294, Jieyi Long / Theta Labs, PKC 2026) is
  a **GKR-based IVC folding** scheme — a **prover-side speedup** (1.59×–6.74× on
  matrix/transformer workloads) + collaborative folding for swarms.
- **Why it doesn't unblock us:**
  1. **Availability:** WHITEPAPER §12 and the pipeline mark it **"Pending toolchain —
     not yet in SP1; await Theta EdgeCloud prover."** There is nothing to run today.
  2. **Wrong layer:** It's a *prover* optimization for the **SP1/GKR** pipeline. zkGPT
     is a separate C++ GKR+Lasso system. Interstellar doesn't make zkGPT's prover
     faster or its verifier exist.
  3. **Doesn't change the RAM/GPU nature:** A folding speedup reduces prover
     time/cost per round; it doesn't turn a 200 GB-RAM CPU job into a GPU job, and it
     doesn't build the on-chain verifier.
- **Where it *is* relevant (later):** If/when XFuel proves inference **inside the SP1
  pipeline** (the "zkVM-friendly LLM proving" future/bounty item), Interstellar's GKR
  folding could cut that prover cost, and its **collaborative folding** is the right
  primitive for swarm-scale distributed proving. That's a scale/roadmap lever, not a
  Tier-3 unblock.

**Verdict:** keep Interstellar as a tracked research-track upgrade (as it already is);
do **not** gate Tier-3 on it.

---

## 6. (d) Small-model-first scope & milestone plan

Concrete, gated milestones. Each has a crisp exit criterion so we don't slide back into
the mock or over-promise.

Gated milestones for the **adopt-DeepProve** path (crisp exit criteria so we don't
slide back into the mock or over-promise). zkGPT-rebuild milestones are dropped.

| # | Milestone | Exit criterion | Blocker it removes |
|---|---|---|---|
| **M0 — license gate** | Legal review of DeepProve `zkml` "Lagrange License" (and Polyhedra as fallback) | Written go/no-go on self-hosted commercial use | The one gate that can kill the whole plan |
| **M1 — host** | Provision high-RAM CPU host (~256–512 GB) reachable from demo path (Tier-2 pattern) | DeepProve builds + runs a sample proof without OOM | The mis-shaped "GPU" blocker |
| **M2 — real proof** | Real **GPT-2** end-to-end proof via DeepProve on a model we serve (ONNX/GGUF) | Non-mock proof + time/RAM logged in `ZKG5_BENCHMARK.md` | Prover-side Tier-3 (real, off-mock) |
| **M3 — attested demo** | Wire DeepProve **off-chain verify + signed attestation** into the gateway | A task returns a receipt attesting a *verified* inference proof (labeled attested) | Ships a credible, honest Tier-3 demo |
| **M4 — trustless (gate)** | DeepProve **on-chain/EVM verifier** on Base (or Groth16 wrapper); adapt `ZKVerifierZkGPT`→`ZKVerifierInference` | Proof verifies on Base; nullifier stored | Real trustless Tier-3 |
| **M5 — scale** | Larger models (Gemma-3 / Llama-class), GPU + distributed proving, per-proof cost tuning | A Llama-class proof demonstrated + cost/latency documented | Scale beyond GPT-2 |

**Minimum bar for a legitimate Tier-3 demo:** **M3** (real proof + verified, even if
verification is off-chain/attested and clearly labeled). **Trustless** Tier-3 = **M4**.

---

## 7. Decision — recommended path

1. **Adopt, don't rebuild.** Make **DeepProve** the Tier-3 engine (Polyhedra
   zkPyTorch/Expander fallback). Stop all effort toward finishing the academic zkGPT.
2. **Clear the license gate (M0) first** — DeepProve's `zkml` crate is under a custom
   Lagrange License; confirm commercial self-host is permitted before building.
3. **Reclassify the blocker** in `RUNTIME_STATE.md`: from "GPU capacity" to **"(1) was
   a RAM (not GPU) sizing error; (2) Tier-3 now = adopt DeepProve, pending license +
   high-RAM host."** Stop provisioning GPUs for this.
4. **Execute M1→M3** on a memory-optimized CPU host behind a locked endpoint (Tier-2
   pattern); prove **GPT-2** first on a model we actually serve; ship an honestly
   labeled attested demo.
5. **Plan M4** (DeepProve on-chain verifier / Groth16 wrapper on Base) as the
   trust-minimized end state, reusing the existing verifier-address seam.
6. **Scope honesty:** Tier-3 = proof-of-inference for a **quantized model XFuel runs**;
   with DeepProve this can scale toward Llama-class, but disclose quantization and
   per-proof cost. Consistent with existing tier language ("only where XFuel runs the
   model").
7. **Prefer self-hosting** the open-source prover so XFuel owns the trust path; treat
   the Lagrange prover *network* as optional burst capacity, not identity.
8. **Interstellar / SP1-native LLM proving:** research track for scale; not on the
   Tier-3 critical path.

### Options summary (for sign-off)

| Option | Gets a demo? | Trustless? | Effort | Recommendation |
|---|---|---|---|---|
| Keep chasing GPU | No | — | Wasted | **Reject** (wrong resource) |
| Rebuild academic zkGPT (GPT-2) | Eventually | Only after we build the verifier | High, dominated by DeepProve | **Reject** (reinvents a solved, worse system) |
| **Adopt DeepProve, self-host + off-chain attest (M3)** | **Yes** | No (attested) | Low–Med | **Adopt now** (pending M0 license) |
| **+ DeepProve on-chain verifier / wrapper (M4)** | Yes | **Yes** | Med–High (mostly integration) | **Adopt as end state** |
| Adopt Polyhedra zkPyTorch/Expander | Yes | Yes | Med | **Fallback** if DeepProve license blocks us |
| DeepProve-as-a-service (Lagrange network) | Yes | Yes | Lowest infra | Stopgap / burst only (external dep + per-proof cost) |
| Invent a new proof system | Yes | Yes | Very high, high risk | **Last resort** only if all adopt paths fail |

---

## 8. Risks & open questions

- **License (blocking).** DeepProve's `zkml` crate uses a custom **Lagrange License**;
  it may restrict commercial/proprietary use. **M0 must resolve this in writing** before
  any build. Fallback: Polyhedra zkPyTorch/Expander (check its license too).
- **Strategic dependency.** Tying a core XFuel trust tier to an external prover
  ecosystem (and, for the service option, a competing token network) is a governance
  and continuity risk. Mitigate by self-hosting the open-source prover.
- **Cost/latency profile.** DeepProve is minutes-per-proof and MB-scale proofs (GPT-2 ≈
  7.6 min, ~10.7 MiB). Fine for async/on-demand Tier-3; must be priced and rate-limited,
  not put on a per-request hot path.
- **RAM ceiling per model.** Published single-machine figure is a **24-core / 504 GB**
  box. Larger models need more RAM and/or distributed/GPU proving. M2 must record actual
  peak RAM before promising bigger models.
- **Proof↔statement binding (the glue we own).** The Tier-3 receipt is only meaningful
  if the proof's public inputs/commitments bind XFuel's task (`input_hash`,
  `output_hash`, model commitment) and the nullifier/settlement path. This integration
  is on us regardless of prover.
- **Quantization gap.** Proof attests a **quantized** forward pass (DeepProve reports
  ≥99.6% cosine sim to fp), not exact fp16. Disclose in receipts. Prove the same
  quantized model the demo serves.
- **On-chain verification cost.** Confirm DeepProve's EVM verifier gas on Base (or use a
  Groth16 wrapper). Benchmark before committing to on-chain (M4).
- **EdgeCloud fit.** If EdgeCloud has no high-RAM CPU SKU, it's the wrong host — a
  capacity mismatch, not a protocol failure.

## 9. Non-goals (this pass)
- No code, no deployment, no benchmarks run here — this is the decision doc that gates
  M0–M5.
- Not rebuilding the academic zkGPT (explicitly rejected in §1A / §7).
- Not inventing a new proof system unless every adopt path (DeepProve, Polyhedra) is
  license-incompatible or unworkable — last resort only.
- Not putting Tier-3 on the Interstellar/SP1-native critical path.

---

## 10. References

**Adopt candidates (2026 landscape):**
- **DeepProve (Lagrange)** — repo [github.com/Lagrange-Labs/deep-prove](https://github.com/Lagrange-Labs/deep-prove)
  (Rust; sumcheck + logup GKR; ONNX/safetensors/GGUF; GPT-2/Gemma-3/Llama-class;
  verifier + on-chain path; 12M+ proofs in prod). Paper: eprint
  [2026/1112](https://eprint.iacr.org/2026/1112) (CCS 2026). **License caveat:** `zkml`
  crate under custom "Lagrange License"; rest Apache-2.0 + MIT — review before use.
  Blog: [deepprove-is-now-open-source](https://lagrange.dev/blog/deepprove-is-now-open-source).
- **Polyhedra zkPyTorch / Expander** — [blog.polyhedra.network/zkpytorch](https://blog.polyhedra.network/zkpytorch/),
  eprint [2025/535](https://eprint.iacr.org/2025/535) (PyTorch→GKR; VGG-16, Llama-3
  ~150 s/token). Fallback adopt path.
- Others surveyed: EZKL (Halo2, small models), NANOZK (arXiv 2603.18046, layerwise,
  6.9 KB/layer), zkLLM (LLaMA-13B/15 min on A100), JSTprove/Inference Labs (Expander,
  "prod discouraged").

**zkGPT (rejected as build target):**
- Paper: zkGPT, eprint [2025/1184](https://eprint.iacr.org/2025/1184) (USENIX Security
  2025) — hardware (Xeon/200 GB/32-thread), GPT-2, Q=16, ~101 KB, <25 s, §9.3
  limitations (quantized-only).
- Upstream: [github.com/security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt)
  (C++; GPT-2 only; 1 contributor; ≥16 cores / ≥200 GB RAM; GPU only for demo
  circuit-init; no usable verifier).
- Repo: `services/zkgpt-prover/README.md`, `RUNBOOK-LOCAL-AND-THETA.md`,
  `THETA-EDGECLOUD-DEPLOY.md`; `docs/research/zkGPT-feasibility-memo.md`;
  `docs/ZKG2_VERIFIER_SPEC.md`; `docs/PHASE1_KICKOFF.md`;
  `docs/ZK-RESEARCH-PIPELINE.md`; `docs/ZK-RESEARCH-UPGRADE-PACKAGE.md`.
- Interstellar: eprint [2025/1294](https://eprint.iacr.org/2025/1294) (Jieyi Long,
  Theta Labs; PKC 2026); WHITEPAPER §12 (research track, "pending toolchain").
- Distributed proving (scale path): Cirrus [2024/1873](https://eprint.iacr.org/2024/1873),
  Hekaton [2024/1208](https://eprint.iacr.org/2024/1208).
- As-deployed truth: [`docs/RUNTIME_STATE.md`](../RUNTIME_STATE.md).
