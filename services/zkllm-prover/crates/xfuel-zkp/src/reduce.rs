//! Committed **row-sum reduction** — `narrow[r] = Σ_{j} wide[r·cols + j]` on committed tensors.
//!
//! A linear reduction from a `rows×cols` tensor to a length-`rows` column, needed twice in a block:
//! RMSNorm's sum-of-squares (`ss[r] = Σ_j x²[r,j]`) and attention's softmax denominators. On
//! committed tensors the verifier can't hold `wide`, so the direct `row_sums` check is replaced by a
//! sumcheck.
//!
//! **The argument.** Draw a random point ρ over the `log₂(rows)` row bits (after absorbing both
//! commitments). Then
//! ```text
//!   narroŵ(ρ) = Σ_r eq(ρ,r)·narrow[r] = Σ_r eq(ρ,r)·Σ_j wide[r,j] = Σ_{r,j} eqbc(r,j)·wide[r,j]
//! ```
//! where `eqbc[r·cols+j] = eq_weights(ρ)[r]` is `eq(ρ,·)` broadcast across the column bits. The RHS is
//! a two-product sumcheck over all `log₂(rows·cols)` bits of `[eqbc, wide]`; the claim `narroŵ(ρ)` is
//! opened from `comm_narrow`, and the sumcheck's final `wide(ch)` is opened from `comm_wide`. The
//! broadcast operand needs **no** opening: its multilinear extension is `eqbĉ(x) = eq(ρ, x_row)`
//! (independent of the column bits, since `Σ_j eq(x_col,j) = 1`), which the verifier computes from ρ
//! and the row bits of the challenge. Because both `narroŵ(ρ)` and `Σ_r eq(ρ,r)Σ_j wide[r,j]` are
//! multilinear in ρ, agreement at a random ρ forces `narrow = rowsum(wide)` everywhere (Schwartz–Zippel).

use crate::mle::{eq_eval, eq_weights, mle_eval};
use crate::pcs;
use crate::sumcheck::{prove_product, verify_product, SumcheckProof};
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};

/// A committed row-sum proof: the reduction sumcheck plus the two openings binding the claim
/// `narrow(ρ)` and the reduced `wide(ch)` to their commitments.
pub struct CommittedRowSumProof {
    pub narrow_at_rho: Fr,
    pub open_narrow: pcs::OpeningProof,
    pub sumcheck: SumcheckProof,
    pub wide_final: Fr,
    pub open_wide: pcs::OpeningProof,
}

/// Broadcast per-row weights `eqw` (len `rows`) across `cols` columns → `bc[r·cols+j] = eqw[r]`.
fn broadcast_cols(eqw: &[Fr], cols: usize) -> Vec<Fr> {
    let mut out = Vec::with_capacity(eqw.len() * cols);
    for &e in eqw {
        for _ in 0..cols {
            out.push(e);
        }
    }
    out
}

/// Absorb dims and both commitments, then draw the row-point ρ (`log₂(rows)` challenges).
fn bind_rowsum(
    tr: &mut Transcript,
    rows: usize,
    cols: usize,
    comm_wide: &pcs::Comm,
    comm_narrow: &pcs::Comm,
) -> Vec<Fr> {
    tr.absorb_bytes(b"rs.rows", &(rows as u64).to_le_bytes());
    tr.absorb_bytes(b"rs.cols", &(cols as u64).to_le_bytes());
    tr.absorb_bytes(b"rs.wide", &pcs::commitment_bytes(comm_wide));
    tr.absorb_bytes(b"rs.narrow", &pcs::commitment_bytes(comm_narrow));
    (0..log2_exact(rows)).map(|_| tr.challenge(b"rs.rho")).collect()
}

/// Prove `narrow[r] = Σ_j wide[r·cols+j]` (caller supplies both, `narrow` the honest row-sum).
/// Returns the proof and the `(wide, narrow)` commitments for reuse across the block seam.
pub fn prove_committed_rowsum(
    wide: &[Fr],
    narrow: &[Fr],
    rows: usize,
    cols: usize,
    ck_wide: &pcs::Ck,
    ck_narrow: &pcs::Ck,
    tr: &mut Transcript,
) -> (CommittedRowSumProof, pcs::Comm, pcs::Comm) {
    assert_eq!(wide.len(), rows * cols, "wide must be rows*cols");
    assert_eq!(narrow.len(), rows, "narrow must be length rows");
    let comm_wide = pcs::commit(ck_wide, wide);
    let comm_narrow = pcs::commit(ck_narrow, narrow);
    let rho = bind_rowsum(tr, rows, cols, &comm_wide, &comm_narrow);

    let narrow_at_rho = mle_eval(narrow, &rho);
    let eqbc = broadcast_cols(&eq_weights(&rho), cols);
    let (sumcheck, ch, _eq_final, wide_final) = prove_product(eqbc, wide.to_vec(), tr);

    let open_narrow = pcs::open(ck_narrow, narrow, &rho);
    let open_wide = pcs::open(ck_wide, wide, &ch);
    (
        CommittedRowSumProof { narrow_at_rho, open_narrow, sumcheck, wide_final, open_wide },
        comm_wide,
        comm_narrow,
    )
}

/// Succinctly verify `narrow = rowsum(wide)` from the two commitments (verifier holds no tensors).
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_rowsum(
    rows: usize,
    cols: usize,
    comm_wide: &pcs::Comm,
    comm_narrow: &pcs::Comm,
    proof: &CommittedRowSumProof,
    vk_wide: &pcs::Vk,
    vk_narrow: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !rows.is_power_of_two() || !cols.is_power_of_two() {
        return false;
    }
    let rho = bind_rowsum(tr, rows, cols, comm_wide, comm_narrow);

    // The sumcheck reduces the claim narrow(ρ); its value is bound to comm_narrow by the opening.
    let (ch, reduced) = match verify_product(&proof.sumcheck, proof.narrow_at_rho, tr) {
        Some(v) => v,
        None => return false,
    };
    // eqbc(ch) is public: eq(ρ, row-bits of ch) — no opening needed for the broadcast operand.
    let n_row = log2_exact(rows);
    let eq_final = eq_eval(&rho, &ch[..n_row]);
    if reduced != eq_final * proof.wide_final {
        return false;
    }
    pcs::verify(vk_narrow, comm_narrow, &rho, proof.narrow_at_rho, &proof.open_narrow)
        && pcs::verify(vk_wide, comm_wide, &ch, proof.wide_final, &proof.open_wide)
}
