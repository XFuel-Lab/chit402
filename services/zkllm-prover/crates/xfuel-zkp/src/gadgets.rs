//! Transformer gadgets that compose with the matmul core.
//!
//! * [`prove_hadamard`] / [`verify_hadamard`] — a **sound** argument for the elementwise product
//!   `z = a ⊙ b` (the gating in SwiGLU, and — later — RoPE's public-constant rotation). Reduces
//!   `ẑ(r) = Σ_x eq(r,x)·a(x)·b(x)` via a degree-3 multi-product sumcheck.
//! * [`LookupObligation`] — a typed record of a **transcendental** step (SiLU, softmax, RMSNorm's
//!   rsqrt) whose sound lookup argument (Lasso/logup) is the next sub-milestone (M5.2b). The
//!   forward pass produces its witness now; the obligation makes the "not-yet-argued" boundary
//!   explicit and machine-checkable rather than hidden.

use crate::commitment::commit_field_table;
use crate::manifest::ActType;
use crate::mle::{eq_eval, eq_weights, mle_eval};
use crate::pcs;
use crate::sumcheck::{prove_product_multi, verify_product_multi, MultiSumcheckProof};
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};

/// A sound proof that `z = a ⊙ b` (elementwise), in the verifiable-computation model.
pub struct HadamardProof {
    pub r: Vec<Fr>,
    pub z_at_r: Fr,
    pub sumcheck: MultiSumcheckProof,
    pub a_final: Fr,
    pub b_final: Fr,
}

/// Core prover for an already-drawn point `r`: runs the degree-3 sumcheck and returns the proof plus
/// the sumcheck challenge `ch` (the point at which `a`,`b` are finally evaluated / opened).
fn prove_hadamard_core(a: &[Fr], b: &[Fr], z: &[Fr], r: Vec<Fr>, tr: &mut Transcript) -> (HadamardProof, Vec<Fr>) {
    let e = eq_weights(&r);
    let z_at_r = mle_eval(z, &r);
    let (sumcheck, ch, finals) = prove_product_multi(vec![e, a.to_vec(), b.to_vec()], tr);
    (HadamardProof { r, z_at_r, sumcheck, a_final: finals[1], b_final: finals[2] }, ch)
}

/// Prove `z = a ⊙ b`.
pub fn prove_hadamard(a: &[Fr], b: &[Fr], z: &[Fr], tr: &mut Transcript) -> HadamardProof {
    assert_eq!(a.len(), b.len());
    assert_eq!(a.len(), z.len());
    let s = log2_exact(a.len());

    tr.absorb_bytes(b"had.a", &commit_field_table(a));
    tr.absorb_bytes(b"had.b", &commit_field_table(b));
    tr.absorb_bytes(b"had.z", &commit_field_table(z));
    let r: Vec<Fr> = (0..s).map(|_| tr.challenge(b"had.r")).collect();

    prove_hadamard_core(a, b, z, r, tr).0
}

/// Verify `z = a ⊙ b` (verifier holds `a, b, z` in the M5.2 verifiable-computation model).
pub fn verify_hadamard(a: &[Fr], b: &[Fr], z: &[Fr], proof: &HadamardProof, tr: &mut Transcript) -> bool {
    if a.len() != b.len() || a.len() != z.len() {
        return false;
    }
    let s = log2_exact(a.len());

    tr.absorb_bytes(b"had.a", &commit_field_table(a));
    tr.absorb_bytes(b"had.b", &commit_field_table(b));
    tr.absorb_bytes(b"had.z", &commit_field_table(z));
    let r: Vec<Fr> = (0..s).map(|_| tr.challenge(b"had.r")).collect();
    if r != proof.r {
        return false;
    }
    if mle_eval(z, &r) != proof.z_at_r {
        return false;
    }

    let (ch, reduced) = match verify_product_multi(&proof.sumcheck, proof.z_at_r, tr) {
        Some(v) => v,
        None => return false,
    };
    if reduced != eq_eval(&r, &ch) * proof.a_final * proof.b_final {
        return false;
    }
    // Bind a(r), b(r) to the committed tables.
    proof.a_final == mle_eval(a, &ch) && proof.b_final == mle_eval(b, &ch)
}

/// A succinct Hadamard proof: the sumcheck plus PCS openings binding `a(ch)`, `b(ch)` to commitments
/// of `a`, `b`. The verifier holds only `z` (the elementwise-product output claim) and the two
/// commitments — never the operands. (M5.4a)
pub struct CommittedHadamardProof {
    pub inner: HadamardProof,
    pub open_a: pcs::OpeningProof,
    pub open_b: pcs::OpeningProof,
}

/// Committed-mode binding: absorb the `a`,`b` commitments and the output `z` before drawing `r`.
/// Absorbing the commitments up front fixes the operands before the "random" point is known (same
/// soundness requirement as the committed matmul). `a` and `b` share one MLE width, so one key pair
/// serves both.
fn bind_hadamard_committed(tr: &mut Transcript, comm_a: &pcs::Comm, comm_b: &pcs::Comm, z: &[Fr]) -> Vec<Fr> {
    tr.absorb_bytes(b"had.commA", &pcs::commitment_bytes(comm_a));
    tr.absorb_bytes(b"had.commB", &pcs::commitment_bytes(comm_b));
    tr.absorb_bytes(b"had.z", &commit_field_table(z));
    let s = log2_exact(z.len());
    (0..s).map(|_| tr.challenge(b"had.r")).collect()
}

/// Prove `z = a ⊙ b`, committing `a`,`b` and opening them at the sumcheck challenge point.
pub fn prove_committed_hadamard(a: &[Fr], b: &[Fr], z: &[Fr], ck: &pcs::Ck, tr: &mut Transcript) -> CommittedHadamardProof {
    assert_eq!(a.len(), b.len());
    assert_eq!(a.len(), z.len());
    let comm_a = pcs::commit(ck, a);
    let comm_b = pcs::commit(ck, b);
    let r = bind_hadamard_committed(tr, &comm_a, &comm_b, z);
    let (inner, ch) = prove_hadamard_core(a, b, z, r, tr);
    let open_a = pcs::open(ck, a, &ch);
    let open_b = pcs::open(ck, b, &ch);
    CommittedHadamardProof { inner, open_a, open_b }
}

/// Succinctly verify `z = a ⊙ b` from commitments to `a`,`b` (the verifier holds only `z`).
pub fn verify_committed_hadamard(
    z: &[Fr],
    comm_a: &pcs::Comm,
    comm_b: &pcs::Comm,
    proof: &CommittedHadamardProof,
    vk: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !z.len().is_power_of_two() {
        return false;
    }
    let inner = &proof.inner;
    let r = bind_hadamard_committed(tr, comm_a, comm_b, z);
    if r != inner.r {
        return false;
    }
    if mle_eval(z, &r) != inner.z_at_r {
        return false;
    }
    let (ch, reduced) = match verify_product_multi(&inner.sumcheck, inner.z_at_r, tr) {
        Some(v) => v,
        None => return false,
    };
    if reduced != eq_eval(&r, &ch) * inner.a_final * inner.b_final {
        return false;
    }
    // Bind a(ch), b(ch) to the commitments via PCS openings instead of recomputing mle_eval(a/b).
    pcs::verify(vk, comm_a, &ch, inner.a_final, &proof.open_a)
        && pcs::verify(vk, comm_b, &ch, inner.b_final, &proof.open_b)
}

// ─── I/O-committed Hadamard — composition variant (M5.4b) ─────────────────────
//
// [`verify_committed_hadamard`] still holds the output `z` (it recomputes `ẑ(r)`). For a succinct
// block the gate output feeds the next op, so — mirroring `matmul::verify_committed_io` — the I/O
// variant also commits `z` and discharges `ẑ(r)` with a PCS opening. Chaining then reuses `z`'s
// commitment as the next op's operand commitment, with no separate linking argument.

/// A fully-committed Hadamard proof: also opens the **output** `z` at `r`, so the verifier holds no
/// tensors — only the `a`,`b`,`z` commitments.
pub struct CommittedIoHadamardProof {
    pub inner: HadamardProof,
    pub open_a: pcs::OpeningProof,
    pub open_b: pcs::OpeningProof,
    pub open_z: pcs::OpeningProof,
}

/// I/O-committed binding: absorb the `a`,`b`,`z` commitments before drawing `r`.
fn bind_hadamard_io(
    tr: &mut Transcript,
    comm_a: &pcs::Comm,
    comm_b: &pcs::Comm,
    comm_z: &pcs::Comm,
    len: usize,
) -> Vec<Fr> {
    tr.absorb_bytes(b"hio.a", &pcs::commitment_bytes(comm_a));
    tr.absorb_bytes(b"hio.b", &pcs::commitment_bytes(comm_b));
    tr.absorb_bytes(b"hio.z", &pcs::commitment_bytes(comm_z));
    (0..log2_exact(len)).map(|_| tr.challenge(b"hio.r")).collect()
}

/// Prove `z = a ⊙ b`, committing **all three** tensors and opening `a`,`b` at the sumcheck point and
/// `z` at `r`. Returns the proof and the `(a, b, z)` commitments for reuse across the block seam.
pub fn prove_committed_hadamard_io(
    a: &[Fr],
    b: &[Fr],
    z: &[Fr],
    ck: &pcs::Ck,
    tr: &mut Transcript,
) -> (CommittedIoHadamardProof, pcs::Comm, pcs::Comm, pcs::Comm) {
    assert_eq!(a.len(), b.len());
    assert_eq!(a.len(), z.len());
    let comm_a = pcs::commit(ck, a);
    let comm_b = pcs::commit(ck, b);
    let comm_z = pcs::commit(ck, z);
    let r = bind_hadamard_io(tr, &comm_a, &comm_b, &comm_z, z.len());
    let (inner, ch) = prove_hadamard_core(a, b, z, r, tr);
    let open_a = pcs::open(ck, a, &ch);
    let open_b = pcs::open(ck, b, &ch);
    let open_z = pcs::open(ck, z, &inner.r);
    (CommittedIoHadamardProof { inner, open_a, open_b, open_z }, comm_a, comm_b, comm_z)
}

/// Succinctly verify `z = a ⊙ b` from commitments to `a`,`b`,**`z`** — the verifier holds no tensors.
/// The output claim `ẑ(r) = inner.z_at_r` is discharged by an opening of `comm_z` at `r`, so the same
/// commitment can be reused as the next op's operand commitment.
pub fn verify_committed_hadamard_io(
    len: usize,
    comm_a: &pcs::Comm,
    comm_b: &pcs::Comm,
    comm_z: &pcs::Comm,
    proof: &CommittedIoHadamardProof,
    vk: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !len.is_power_of_two() {
        return false;
    }
    let inner = &proof.inner;
    let r = bind_hadamard_io(tr, comm_a, comm_b, comm_z, len);
    if r != inner.r {
        return false;
    }
    let (ch, reduced) = match verify_product_multi(&inner.sumcheck, inner.z_at_r, tr) {
        Some(v) => v,
        None => return false,
    };
    if reduced != eq_eval(&r, &ch) * inner.a_final * inner.b_final {
        return false;
    }
    pcs::verify(vk, comm_a, &ch, inner.a_final, &proof.open_a)
        && pcs::verify(vk, comm_b, &ch, inner.b_final, &proof.open_b)
        && pcs::verify(vk, comm_z, &r, inner.z_at_r, &proof.open_z)
}

/// A transcendental step whose sound lookup argument is pending (M5.2b). The witness is produced
/// by the forward pass now; this records the input→output relation that must still be argued.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LookupObligation {
    pub op: &'static str,
    pub input_commit: [u8; 32],
    pub output_commit: [u8; 32],
    pub len: usize,
}

impl LookupObligation {
    pub fn new(op: &'static str, input: &[Fr], output: &[Fr]) -> Self {
        Self {
            op,
            input_commit: commit_field_table(input),
            output_commit: commit_field_table(output),
            len: input.len(),
        }
    }
}

/// Activation-name tag for an [`ActType`] (used by obligation records).
pub fn act_name(act: ActType) -> &'static str {
    match act {
        ActType::GeLU => "gelu",
        ActType::SiLU | ActType::SwiGLU => "silu",
        ActType::GeGLU => "gelu",
    }
}

/// Produce the activation witness for `input`.
///
/// M5.2a placeholder: returns the input unchanged so the *composition* (matmul + gating) is
/// exercised and the input→output relation is captured as a [`LookupObligation`]. The numerically
/// correct, **sound** activation (quantized SiLU/GeLU via a lookup table) lands in M5.2b — the
/// obligation is exactly what that argument will discharge.
pub fn apply_activation(_act: ActType, input: &[Fr]) -> Vec<Fr> {
    input.to_vec()
}
