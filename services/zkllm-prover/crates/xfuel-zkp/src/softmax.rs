//! Committed **causal softmax** — the novel core of a succinct attention block (M5.4b).
//!
//! Given committed scores `S` (seq×seq), proves the causal row-wise softmax
//! ```text
//!   masked = S ⊙ M                 (M = lower-triangular 0/1 causal selector, public)
//!   E      = exp(masked)           (logup lookup; exp code 0 → 0, so masked-out entries vanish)
//!   z[i]   = Σ_j E[i,j]            (committed row-sum)
//!   r[i]   = 1 / z[i]              (logup lookup)
//!   P[i,j] = E[i,j] · r[i]         (fused row-scale sumcheck)
//! ```
//! producing committed `P`, with the verifier holding **no** seq×seq tensors. Every step is one of the
//! committed primitives, linked by commitment reuse (PCS binding ⇒ same polynomial across each seam):
//! `gadgets::…hadamard_io` for the mask, `ScalarTable::…committed` for `exp`/reciprocal,
//! `reduce::…rowsum` for the denominators, and a 3-product `[eq, E, r_bc]` sumcheck for the final
//! per-row scaling (so `r` is opened only at the row-bits — no broadcast tensor is materialized).
//!
//! Two anti-forgery ties, both mirroring the committed RMSNorm: the causal mask `M` is committed and
//! compared to the canonical selector (else a prover could drop the causal constraint), and each
//! lookup's committed table is tied to its canonical `exp`/reciprocal table.
//!
//! Trust boundary: the `1/√d_head` score scale and score→code requant fold into the `exp` table's
//! domain (a table parameter); the KZG trusted setup is as in [`crate::pcs`].

use crate::gadgets::{
    prove_committed_hadamard_io, verify_committed_hadamard_io, CommittedIoHadamardProof,
};
use crate::lookup::CommittedLookupProof;
use crate::mle::{eq_eval, eq_weights, mle_eval};
use crate::pcs;
use crate::reduce::{prove_committed_rowsum, verify_committed_rowsum, CommittedRowSumProof};
use crate::sumcheck::{prove_product_multi, verify_product_multi, MultiSumcheckProof};
use crate::table::ScalarTable;
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};
use ark_ff::{One, Zero};

/// The lower-triangular causal selector `M[i,j] = 1 if j ≤ i else 0` (seq×seq, row-major). Public and
/// deterministic, so prover and verifier commit byte-identical tensors.
pub fn causal_selector(seq: usize) -> Vec<Fr> {
    let mut m = vec![Fr::zero(); seq * seq];
    for i in 0..seq {
        for j in 0..=i {
            m[i * seq + j] = Fr::one();
        }
    }
    m
}

/// Broadcast a per-row column `v` (len `rows`) across `cols` → `bc[i·cols+j] = v[i]`.
fn broadcast_rows(v: &[Fr], cols: usize) -> Vec<Fr> {
    let mut out = Vec::with_capacity(v.len() * cols);
    for &vi in v {
        for _ in 0..cols {
            out.push(vi);
        }
    }
    out
}

/// A committed causal-softmax proof. Internal commitments are carried so the verifier can thread the
/// seams; `E`'s commitment is `p_exp.comm_query[1]`, `r`'s is `p_recip.comm_query[1]`.
pub struct CommittedSoftmaxProof {
    pub comm_mask: pcs::Comm,
    pub comm_masked: pcs::Comm,
    pub comm_z: pcs::Comm,
    pub p_mask: CommittedIoHadamardProof,
    pub p_exp: CommittedLookupProof,
    pub p_rowsum: CommittedRowSumProof,
    pub p_recip: CommittedLookupProof,
    pub p_at_rho: Fr,
    pub open_p: pcs::OpeningProof,
    pub sc_scale: MultiSumcheckProof,
    pub e_final: Fr,
    pub open_e_scale: pcs::OpeningProof,
    pub recip_final: Fr,
    pub open_recip_scale: pcs::OpeningProof,
}

/// Absorb the scaling step's dims and the `E`,`r`,`P` commitments, then draw the point ρ.
fn bind_scale(
    tr: &mut Transcript,
    seq: usize,
    comm_e: &pcs::Comm,
    comm_r: &pcs::Comm,
    comm_p: &pcs::Comm,
) -> Vec<Fr> {
    tr.absorb_bytes(b"sm.seq", &(seq as u64).to_le_bytes());
    tr.absorb_bytes(b"sm.e", &pcs::commitment_bytes(comm_e));
    tr.absorb_bytes(b"sm.r", &pcs::commitment_bytes(comm_r));
    tr.absorb_bytes(b"sm.p", &pcs::commitment_bytes(comm_p));
    (0..log2_exact(seq * seq)).map(|_| tr.challenge(b"sm.scale.rho")).collect()
}

/// Prove `P = causal_softmax(S)` succinctly. `ck_sq` sizes the seq×seq tensors (`S`,`M`,`masked`,`E`,
/// `P`), `ck_s` the length-`seq` columns (`z`,`r`), `ck_exp_t`/`ck_recip_t` the two table domains.
/// Returns the proof, the `S` and `P` commitments, and `P`.
#[allow(clippy::too_many_arguments)]
pub fn prove_committed_softmax(
    scores: &[Fr],
    seq: usize,
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    ck_sq: &pcs::Ck,
    ck_s: &pcs::Ck,
    ck_exp_t: &pcs::Ck,
    ck_recip_t: &pcs::Ck,
    tr: &mut Transcript,
) -> (CommittedSoftmaxProof, pcs::Comm, pcs::Comm, Vec<Fr>) {
    assert!(seq.is_power_of_two(), "seq must be a power of two");
    assert_eq!(scores.len(), seq * seq, "scores must be seq*seq");
    assert_eq!(exp_table.out_codes[0], Fr::zero(), "exp table code 0 must map to 0 (mask sentinel)");

    let comm_s = pcs::commit(ck_sq, scores);

    // 1. masked = S ⊙ M (M the public causal selector; committed + tied on the verifier side).
    let mask = causal_selector(seq);
    let masked: Vec<Fr> = scores.iter().zip(mask.iter()).map(|(s, m)| *s * *m).collect();
    let (p_mask, _cs, _cm, comm_masked) =
        prove_committed_hadamard_io(scores, &mask, &masked, ck_sq, tr);
    let comm_mask = pcs::commit(ck_sq, &mask);

    // 2. E = exp(masked) (committed lookup; comm_query[0] == comm_masked by determinism).
    let exps = exp_table.apply(&masked);
    let p_exp = exp_table.prove_committed(&masked, &exps, ck_sq, ck_exp_t, tr);

    // 3. z = row-sum of E (reuse comm_e as the wide input).
    let rowsum: Vec<Fr> = (0..seq)
        .map(|i| (0..seq).fold(Fr::zero(), |acc, j| acc + exps[i * seq + j]))
        .collect();
    let (p_rowsum, _cw, comm_z) =
        prove_committed_rowsum(&exps, &rowsum, seq, seq, ck_sq, ck_s, tr);

    // 4. r = 1/z (committed lookup; comm_query[0] == comm_z).
    let recip = recip_table.apply(&rowsum);
    let p_recip = recip_table.prove_committed(&rowsum, &recip, ck_s, ck_recip_t, tr);

    // 5. P = E ⊙ r[i] — fused per-row scaling (no broadcast tensor for the verifier).
    let recip_bc = broadcast_rows(&recip, seq);
    let probs: Vec<Fr> = exps.iter().zip(recip_bc.iter()).map(|(e, r)| *e * *r).collect();
    let comm_p = pcs::commit(ck_sq, &probs);
    let comm_e = pcs::commit(ck_sq, &exps); // == p_exp.comm_query[1]
    let comm_r = pcs::commit(ck_s, &recip); // == p_recip.comm_query[1]

    let rho = bind_scale(tr, seq, &comm_e, &comm_r, &comm_p);
    let p_at_rho = mle_eval(&probs, &rho);
    let eq2 = eq_weights(&rho);
    let (sc_scale, ch, finals) =
        prove_product_multi(vec![eq2, exps.clone(), recip_bc], tr);

    let n_row = log2_exact(seq);
    let open_p = pcs::open(ck_sq, &probs, &rho);
    let open_e_scale = pcs::open(ck_sq, &exps, &ch);
    let open_recip_scale = pcs::open(ck_s, &recip, &ch[..n_row]);

    let proof = CommittedSoftmaxProof {
        comm_mask,
        comm_masked,
        comm_z,
        p_mask,
        p_exp,
        p_rowsum,
        p_recip,
        p_at_rho,
        open_p,
        sc_scale,
        e_final: finals[1],
        open_e_scale,
        recip_final: finals[2],
        open_recip_scale,
    };
    (proof, comm_s, comm_p, probs)
}

/// Succinctly verify `P = causal_softmax(S)` from `comm_s`, `comm_p`, and the canonical tables. The
/// verifier holds no seq×seq tensors. `ck_*` re-derive the canonical mask/table commitments (public
/// infra) for the anti-forgery ties.
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_softmax(
    seq: usize,
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    comm_s: &pcs::Comm,
    comm_p: &pcs::Comm,
    proof: &CommittedSoftmaxProof,
    ck_sq: &pcs::Ck,
    ck_exp_t: &pcs::Ck,
    ck_recip_t: &pcs::Ck,
    vk_sq: &pcs::Vk,
    vk_s: &pcs::Vk,
    vk_exp_t: &pcs::Vk,
    vk_recip_t: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !seq.is_power_of_two() || exp_table.out_codes[0] != Fr::zero() {
        return false;
    }
    let bytes = pcs::commitment_bytes;

    // 1. masked = S ⊙ M. Tie M to the canonical causal selector, then verify the Hadamard.
    if bytes(&proof.comm_mask) != bytes(&pcs::commit(ck_sq, &causal_selector(seq))) {
        return false;
    }
    if !verify_committed_hadamard_io(
        seq * seq, comm_s, &proof.comm_mask, &proof.comm_masked, &proof.p_mask, vk_sq, tr,
    ) {
        return false;
    }

    // 2. E = exp(masked). Tie the lookup's input column to comm_masked; table-tie is inside verify.
    if proof.p_exp.comm_query.len() != 2
        || bytes(&proof.p_exp.comm_query[0]) != bytes(&proof.comm_masked)
    {
        return false;
    }
    if !exp_table.verify_committed(seq * seq, &proof.p_exp, ck_exp_t, vk_sq, vk_exp_t, tr) {
        return false;
    }
    let comm_e = &proof.p_exp.comm_query[1];

    // 3. z = row-sum of E (wide = comm_e, narrow = comm_z).
    if !verify_committed_rowsum(seq, seq, comm_e, &proof.comm_z, &proof.p_rowsum, vk_sq, vk_s, tr) {
        return false;
    }

    // 4. r = 1/z. Tie the lookup's input column to comm_z.
    if proof.p_recip.comm_query.len() != 2
        || bytes(&proof.p_recip.comm_query[0]) != bytes(&proof.comm_z)
    {
        return false;
    }
    if !recip_table.verify_committed(seq, &proof.p_recip, ck_recip_t, vk_s, vk_recip_t, tr) {
        return false;
    }
    let comm_r = &proof.p_recip.comm_query[1];

    // 5. P = E ⊙ r[i] — the fused row-scaling sumcheck.
    let rho = bind_scale(tr, seq, comm_e, comm_r, comm_p);
    let (ch, reduced) = match verify_product_multi(&proof.sc_scale, proof.p_at_rho, tr) {
        Some(v) => v,
        None => return false,
    };
    let n_row = log2_exact(seq);
    let eq_final = eq_eval(&rho, &ch);
    if reduced != eq_final * proof.e_final * proof.recip_final {
        return false;
    }

    pcs::verify(vk_sq, comm_p, &rho, proof.p_at_rho, &proof.open_p)
        && pcs::verify(vk_sq, comm_e, &ch, proof.e_final, &proof.open_e_scale)
        && pcs::verify(vk_s, comm_r, &ch[..n_row], proof.recip_final, &proof.open_recip_scale)
}
