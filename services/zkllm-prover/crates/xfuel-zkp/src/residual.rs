//! Committed residual-add check — `out = x + sub` on committed tensors (M5.4b composition).
//!
//! A pre-norm decoder block wires two residual adds (`h = x + Attn(norm₁ x)`, `out = h + FFN(norm₂ h)`).
//! To keep the block succinct these must be checked without the verifier holding the tensors. Addition
//! is *linear*, so no sumcheck is needed: if `out = x + sub` as multilinear extensions then
//! `ôut(ρ) = x̂(ρ) + ŝub(ρ)` at **every** point ρ; conversely if `out ≠ x + sub` the two sides disagree
//! at a uniformly random ρ except with probability `len/|F|` (Schwartz–Zippel, ~2⁻²⁴⁰ here). So the
//! argument is one Fiat–Shamir point + three [`crate::pcs`] openings.
//!
//! Like the other committed paths, the three commitments are absorbed **before** ρ is drawn, so the
//! prover fixes all tensors before learning the point. For composition the caller reuses commitments:
//! `x` is the incoming residual stream, `sub` the sub-block output, `out` the new stream — each a
//! commitment already produced (or consumed) by an adjacent op.

use crate::pcs;
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};

/// A committed residual-add proof: openings of `x`, `sub`, `out` at one Fiat–Shamir point ρ.
pub struct CommittedAddProof {
    pub x: pcs::Opening,
    pub sub: pcs::Opening,
    pub out: pcs::Opening,
}

/// Absorb the length and the three commitments, then draw the random evaluation point ρ.
fn bind_add(
    tr: &mut Transcript,
    len: usize,
    comm_x: &pcs::Comm,
    comm_sub: &pcs::Comm,
    comm_out: &pcs::Comm,
) -> Vec<Fr> {
    tr.absorb_bytes(b"add.len", &(len as u64).to_le_bytes());
    tr.absorb_bytes(b"add.x", &pcs::commitment_bytes(comm_x));
    tr.absorb_bytes(b"add.sub", &pcs::commitment_bytes(comm_sub));
    tr.absorb_bytes(b"add.out", &pcs::commitment_bytes(comm_out));
    (0..log2_exact(len)).map(|_| tr.challenge(b"add.rho")).collect()
}

/// Prove `out = x + sub` (caller supplies all three equal-length tensors). Returns the proof and the
/// `(x, sub, out)` commitments so a caller can reuse them across the block seam.
pub fn prove_committed_add(
    x: &[Fr],
    sub: &[Fr],
    out: &[Fr],
    ck: &pcs::Ck,
    tr: &mut Transcript,
) -> (CommittedAddProof, pcs::Comm, pcs::Comm, pcs::Comm) {
    assert_eq!(x.len(), sub.len(), "x and sub must be equal length");
    assert_eq!(x.len(), out.len(), "out must match x/sub length");
    let comm_x = pcs::commit(ck, x);
    let comm_sub = pcs::commit(ck, sub);
    let comm_out = pcs::commit(ck, out);
    let rho = bind_add(tr, x.len(), &comm_x, &comm_sub, &comm_out);
    let proof = CommittedAddProof {
        x: pcs::open_at(ck, x, &rho),
        sub: pcs::open_at(ck, sub, &rho),
        out: pcs::open_at(ck, out, &rho),
    };
    (proof, comm_x, comm_sub, comm_out)
}

/// Succinctly verify `out = x + sub` from the three commitments (the verifier holds no tensors).
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_add(
    len: usize,
    comm_x: &pcs::Comm,
    comm_sub: &pcs::Comm,
    comm_out: &pcs::Comm,
    proof: &CommittedAddProof,
    vk: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !len.is_power_of_two() {
        return false;
    }
    let rho = bind_add(tr, len, comm_x, comm_sub, comm_out);
    // The linear relation, checked at the random point.
    if proof.out.value != proof.x.value + proof.sub.value {
        return false;
    }
    // Each claimed evaluation must be a genuine opening of its commitment at ρ.
    pcs::check_open(vk, comm_x, &rho, &proof.x)
        && pcs::check_open(vk, comm_sub, &rho, &proof.sub)
        && pcs::check_open(vk, comm_out, &rho, &proof.out)
}
