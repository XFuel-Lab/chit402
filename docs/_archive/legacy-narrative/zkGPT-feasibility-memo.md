# zkGPT Feasibility Memo (Phase 1)

> **Purpose:** Answer replace vs layer vs parallel path, verifier impact, implementation source, and recommended first milestone. Fill this after reading the paper and (optionally) the [zkGPT whitepaper PDF](https://eprint.iacr.org/2025/1184) or local copy (e.g. `C:\Users\seeha\Downloads\zkGPT whitepaper.pdf`).
>
> **Reference:** [PHASE1_INTEGRATION_PLAN.md](../PHASE1_INTEGRATION_PLAN.md) § 1.1.

---

## Reference: zkGPT whitepaper summary (for verifier/implementation)

*The following is extracted from the zkGPT paper (NUS/HKUST; eprint 2025/1184) and the local whitepaper PDF for quick reference.*

| Item | From whitepaper |
|------|------------------|
| **Proof system** | GKR (sumcheck) + Lasso (lookup). Not Groth16/PLONK. |
| **Polynomial commitment** | Hyrax (transparent); prover O(N), proof size and verifier time O(√N). |
| **Non-interactive** | Yes, via Fiat–Shamir. Proof can be “downloaded and publicly verified offline.” |
| **Proof size** | **101 KB** (vs VOLE-based “gigabytes”; vs SP1 Groth16 ~260 bytes). |
| **Curve** | BN254 (~100-bit security); mcl library. |
| **Implementation** | C++; sumcheck/ML-friendly GKR from zkCNN; Lasso from a16z/jolt (lasso branch). |
| **Open source** | https://github.com/security-Anonymous/zkgpt |
| **Performance** | GPT-2 inference proof in &lt;25 s; ~279× vs Hao et al., ~185× vs ZKML (Eurosys’24). |
| **Model support** | GPT-2; quantized (Q=16); zkCNN-style quantization. |
| **Public input** | Input embedding matrix. **Witness:** model weights, intermediate rounding results, lookup queries. |

**Implication for XFuel:** zkGPT uses a **different proof system** (GKR+Lasso) than SP1 (Groth16/PLONK). So we need a **second verifier** (`ZKVerifierZkGPT`) that implements or wraps GKR+Lasso verification on-chain (or via precompile). The existing `ZKVerifierSP1` cannot verify zkGPT proofs natively.

---

## 1. Replace vs layer vs parallel path

*(Fill after reading paper.)*

- [x] Does zkGPT **replace** the current SP1 zkVM approach for inference, **layer on top** of it, or run as a **parallel path** (inference can choose SP1 or zkGPT)?
- **Conclusion:** **Parallel path.** Inference can specify `proof_system: zkgpt` or `sp1`; SP1 remains default; zkGPT is alternative for LLM inference (same settlement, different verifier).

---

## 2. Verifier impact

*(Fill after reading paper and checking on-chain verification feasibility.)*

- [x] Can zkGPT proofs be verified by existing `ZKVerifierSP1.verifyProof()` (Groth16/PLONK)? **No** — different proof system (GKR + Lasso).
- [x] New contract `ZKVerifierZkGPT` required; wrapper is future/bounty per upgrade package.
- **Conclusion:** **New verifier contract** `ZKVerifierZkGPT` with same `verifyProof(circuitId, publicValues, proofBytes, nullifier)` signature for drop-in routing.

---

## 3. Implementation source

*(Check author GitHub: jiahengzhang; repo: security-Anonymous/zkgpt.)*

- [x] Open-source prover: [security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt). Verifier: implement from paper or adopt upstream if released.
- **Conclusion:** **Use existing repo** for prover (ZKG-1); implement verifier from paper for ZKG-2.

---

## 4. Recommended first milestone

*(e.g. single transformer block, or GPT-2-small end-to-end.)*

- **First milestone:** GPT-2-small (or single transformer block) inference proof verified on-chain via `ZKVerifierZkGPT`; proof time and gas documented.

---

## 5. Compatibility matrix (zkGPT ↔ current stack)

| Question | Answer |
|----------|--------|
| zkGPT proof format accepted by `ZKVerifierSP1`? | **No** (different proof system). |
| New contract(s) required? | **Yes** — `ZKVerifierZkGPT` (interface + implementation). |
| Changes to ZKMLCircuit / ThetaInferenceCircuit? | Optional: configurable zkVerifierZkGPT address; route inference with `proof_system: zkgpt` to ZKVerifierZkGPT. |
| Routing: how does backend choose SP1 vs zkGPT? | **`proof_system`** in task request (`sp1` \| `zkgpt`); default `sp1`. |

---

## 6. Baseline (for benchmarking)

- [ ] Current SP1 zkVM proving time for one inference (e.g. small LLaMA or proxy task): _TBD_
- [ ] Current verification gas (one proof) on Theta testnet: _TBD_

---

*Once filled, this memo gates the implementation steps ZKG-1 through ZKG-5 in [PHASE1_KICKOFF.md](../PHASE1_KICKOFF.md).*
