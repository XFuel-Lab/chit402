# ZKG-5: zkGPT Prover & Verifier Benchmarks

> Placeholder for Phase 1 benchmark results. Fill once the zkGPT prover (ZKG-1) and on-chain verifier (ZKG-2) are operational.

**References:** [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184), [ZKG2_VERIFIER_SPEC.md](ZKG2_VERIFIER_SPEC.md), [zkgpt-prover/README.md](../zkgpt-prover/README.md).

---

## 1. What to measure

| Metric | Source | Notes |
|--------|--------|--------|
| **Prover time (ms)** | zkGPT prover service / upstream repo | Time from request to proof ready (e.g. single block or GPT-2-small). Paper: &lt;25 s for GPT-2. |
| **Proof size (bytes)** | Prover output | Expect ~101 KB per paper. |
| **Verification gas** | On-chain `ZKVerifierZkGPT.verifyProof` | Gas used once real GKR+Lasso verifier is implemented. Stub is not representative. |
| **End-to-end latency** | Task submit → proof → verify → settle | From M2M request to settlement event. |

---

## 2. How to run (when E2E is ready)

1. **Prover:** Run upstream zkGPT (or HTTP wrapper) with a fixed model/input. Record wall-clock time and proof size. Optionally run multiple trials and report min/avg/max. *Until then:* the mock server (`node zkgpt-prover/mock-server.cjs`) returns ~101 KB stub proofs; you can measure client round-trip with `npm run test:zkgpt-mock`.
2. **Verifier:** Deploy `ZKVerifierZkGPT` with real implementation (ZKG-2). Call `verifyProof(circuitId, publicValues, proofBytes, nullifier)` and record `gasUsed` from the receipt. The stub verifier does not reflect real verification cost.
3. **E2E:** Submit an `inference_request` with `proof_system: zkgpt`; note timestamp at submit and at settlement event; compute latency.

---

## 3. Results

| Scenario | Prover time (ms) | Proof size (bytes) | Verification gas | E2E latency (s) |
|----------|------------------|--------------------|------------------|-----------------|
| **Mock (wrapper-template on Theta EdgeCloud)** | ~500 | ~103_424 | N/A (stub verifier) | ~0.7 |
| GPT-2-small (paper reference) | &lt;25_000 | ~101_000 | TBD | TBD |
| Single block / minimal (real C++ prover) | TBD | TBD | TBD | TBD |

*Mock: M2M task-request → Theta GPU node (xfuel-zkgpt-prover) → stub proof → fee_collected. Real prover and verification gas pending ZKG-1 (C++ build) and ZKG-2 (GKR+Lasso verifier).*

---

## 4. Comparison (SP1 baseline)

| System | Proof size | Verify gas (EVM) | Prover time (typical) |
|--------|------------|------------------|------------------------|
| SP1 (Groth16) | ~260 bytes | ~270K | Sub-200 ms (EdgeCloud batch) |
| zkGPT (GKR+Lasso) | ~101 KB | TBD | &lt;25 s (paper, GPT-2) |

zkGPT trades smaller proof-system footprint and LLM-specific optimizations for larger proof size and different verification cost; benchmarks will inform when to recommend `proof_system: zkgpt` vs `sp1`.
