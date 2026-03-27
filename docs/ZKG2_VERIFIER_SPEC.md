# ZKG-2: zkGPT On-Chain Verifier Specification

> Implementation guide for real GKR + Lasso verification in `ZKVerifierZkGPT.sol`. The contract currently has a stub; this doc specifies proof format, verification steps, and integration so implementers can complete ZKG-2.

**References:** [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184), [github.com/security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt), [docs/REFERENCES-AND-ATTRIBUTION.md](REFERENCES-AND-ATTRIBUTION.md).

**Suggested eprint reading for implementers:** GKR (sumcheck): [eprint.iacr.org/2013/351](https://eprint.iacr.org/2013/351) (Wahby et al.); Lasso: [eprint.iacr.org/2023/1216](https://eprint.iacr.org/2023/1216) (Setty et al.); Hyrax: [eprint.iacr.org/2017/1132](https://eprint.iacr.org/2017/1132) (Wahby et al.); zkGPT (full system): [eprint.iacr.org/2025/1184](https://eprint.iacr.org/2025/1184).

---

## 1. Proof system summary (from paper)

| Item | Value |
|------|--------|
| **Proof system** | GKR (sumcheck) + Lasso (lookup) |
| **Polynomial commitment** | Hyrax (transparent) |
| **Curve** | BN254 (mcl library in C++; EVM has bn254 precompiles) |
| **Proof size** | ~101 KB |
| **Non-interactive** | Fiat–Shamir transform |
| **Public input** | Input embedding matrix (and any public outputs committed in the proof) |

Verification involves: (1) parsing the proof structure, (2) running the GKR sumcheck verifier (multiple rounds), (3) running the Lasso lookup verifier, (4) checking Hyrax polynomial commitments (group operations on BN254). The paper and upstream repo are the authoritative source for the exact byte layout and verification equations.

---

## 2. Contract interface (fixed)

`ZKVerifierZkGPT.verifyProof(circuitId, publicValues, proofBytes, nullifier)` must:

1. **Revert** if `usedNullifiers[nullifier] == true` (replay protection).
2. **Validate** `proofBytes` and `publicValues` (length, structure as per spec below).
3. **Run** the GKR + Lasso verifier logic (to be implemented).
4. **If valid:** set `usedNullifiers[nullifier] = true`, increment `totalVerified`, emit `ProofVerified`, return `true`.
5. **If invalid:** revert (no state change).

---

## 3. Proof and public values format (target)

- **proofBytes:** Opaque blob from the zkGPT prover (~101 KB). Exact layout must be taken from the [zkGPT repo](https://github.com/security-Anonymous/zkgpt) or paper Section on proof structure. Likely contains: GKR proof (sumcheck messages, polynomial commitments), Lasso proof (lookup arguments), and Fiat–Shamir randomness/challenges.
- **publicValues:** ABI-encoded or fixed layout that the verifier expects. Should at least bind: `circuitId`, public input (e.g. input hash or commitment), and any public output (e.g. output hash) so that settlement can enforce correctness. XFuel circuits today pass the same `publicValues` they use for SP1; we may need a zkGPT-specific encoding once the prover output is fixed.

**Size bounds (on-chain):**

- `proofBytes.length`: min 1, max `MAX_ZKGPT_PROOF_BYTES` (e.g. 150_000 to allow for growth). Reject out-of-range to avoid DoS.
- `publicValues.length`: reasonable upper bound (e.g. 4 KB) to cap calldata.

---

## 4. Verification algorithm outline (to implement)

1. **Parse** `proofBytes` into GKR and Lasso components (per upstream format).
2. **Recompute Fiat–Shamir challenges** from transcript (hash of public inputs + proof elements).
3. **GKR:** For each layer, run the sumcheck verifier (polynomial evaluations, consistency with commitments). Hyrax commitments use BN254 scalar multiplication and possibly pairing checks.
4. **Lasso:** Verify the lookup argument (multiset checks, commitment openings).
5. **Consistency:** Ensure public inputs in `publicValues` match the statement committed in the proof.

EVM has `ecAdd`, `ecMul`, `ecPairing` precompiles for BN254. Use them to implement group operations and pairing checks; field arithmetic in Solidity (or Yul) for scalar operations. Gas will be dominated by the number of rounds and pairings; benchmark after a first implementation.

---

## 5. Implementation options

| Option | Pros | Cons |
|--------|------|------|
| **A. Solidity/Yul verifier** | Trustless, single contract | High gas; complex; need exact spec from repo |
| **B. Off-chain verifier + attestation** | Fast to ship | Trust assumption (committee or single attester) |
| **C. Wrap in SNARK** | One Groth16 verify on-chain; reuse ZKVerifierSP1 | Need circuit that implements zkGPT verifier |

Recommended path for ZKG-2: **Option A** with spec and test vectors from upstream. If gas is prohibitive, consider **Option C** (wrapper) as Phase 2.

---

## 6. Tasks checklist (ZKG-2)

- [ ] Obtain exact proof byte layout and public-input encoding from [security-Anonymous/zkgpt](https://github.com/security-Anonymous/zkgpt) (or paper).
- [ ] Implement proof parser (split into GKR + Lasso segments).
- [ ] Implement GKR sumcheck verifier (field ops + Hyrax checks on BN254).
- [ ] Implement Lasso lookup verifier.
- [ ] Wire in `ZKVerifierZkGPT.verifyProof`: validation → parse → verify → nullifier + event.
- [ ] Add fuzz tests and gas benchmarks; document in [ZKG5_BENCHMARK.md](ZKG5_BENCHMARK.md).
- [ ] Run E2E: prover (ZKG-1) → proof → this verifier → settlement.

---

## 7. Contract constants (current)

In `ZKVerifierZkGPT.sol`:

- `MAX_ZKGPT_PROOF_BYTES`: upper bound on `proofBytes.length` (e.g. 150_000).
- `MIN_PROOF_BYTES`: lower bound (e.g. 1) to reject empty.
- Revert with `InvalidProofLength` or similar if out of range.

Once the real verifier is implemented, remove the stub revert and perform the steps in §4.
