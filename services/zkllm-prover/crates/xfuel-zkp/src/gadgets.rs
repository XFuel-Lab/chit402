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

/// Prove `z = a ⊙ b`.
pub fn prove_hadamard(a: &[Fr], b: &[Fr], z: &[Fr], tr: &mut Transcript) -> HadamardProof {
    assert_eq!(a.len(), b.len());
    assert_eq!(a.len(), z.len());
    let s = log2_exact(a.len());

    tr.absorb_bytes(b"had.a", &commit_field_table(a));
    tr.absorb_bytes(b"had.b", &commit_field_table(b));
    tr.absorb_bytes(b"had.z", &commit_field_table(z));
    let r: Vec<Fr> = (0..s).map(|_| tr.challenge(b"had.r")).collect();

    let e = eq_weights(&r);
    let z_at_r = mle_eval(z, &r);
    let (sumcheck, _ch, finals) = prove_product_multi(vec![e, a.to_vec(), b.to_vec()], tr);
    HadamardProof { r, z_at_r, sumcheck, a_final: finals[1], b_final: finals[2] }
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
