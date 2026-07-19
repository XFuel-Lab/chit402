//! RMSNorm gadget — the pre-attention / pre-FFN normalization, proven **soundly** by composing
//! tools that already exist in the crate (no new argument primitive).
//!
//! For a residual row `x` (length `d`) with a per-channel weight `w` (length `d`):
//! ```text
//!   ss       = Σ_j x_j²                       (sum of squares, per row)
//!   inv_rms  = 1 / sqrt(ss/d + eps)           (the only transcendental step)
//!   y_j      = x_j · inv_rms · w_j            (scaled output)
//! ```
//! The decomposition into sound sub-arguments:
//! * `xsq = x ⊙ x` — a [`crate::gadgets`] Hadamard proof.
//! * `ss_r = Σ_j xsq[r,j]` — a **linear** row-reduction, checked directly (the verifier holds `xsq`).
//! * `inv_rms = rsqrt_table(ss)` — the transcendental, discharged by the [`crate::lookup`] logup over
//!   a **canonical, deterministic** `ss_code → inv_rms_code` table (same pattern as the activation
//!   table). This — not an "exact in-field quadratic constraint" — is the sound choice: the real
//!   `1/sqrt(·)` is irrational, so a rounded fixed-point `inv_rms` can never satisfy
//!   `inv_rms²·(ss/d+eps)=1` exactly in the field; the table encodes the *correct rounded* value and
//!   the lookup proves the model used it.
//! * `t = x ⊙ broadcast_rows(inv_rms)` then `y = t ⊙ broadcast_cols(w)` — two more Hadamard proofs.
//!
//! Trust boundary (M5.2b-cont): a *verifiable-computation* reduction, like the rest of M5.x — the
//! verifier is given the tensors + advice and checks the sub-arguments. Binding the code-domain
//! consistency across ops (the inter-op **requantization range-check** so `y` re-enters the next
//! op's code domain) is M5.3; the polynomial-commitment binding is M5.4.

use crate::commitment::commit_field_table;
use crate::gadgets::{
    prove_committed_hadamard_io, prove_hadamard, verify_committed_hadamard_io, verify_hadamard,
    CommittedIoHadamardProof, HadamardProof,
};
use crate::lookup::{
    prove_committed_lookup, prove_lookup, verify_committed_lookup, verify_lookup,
    CommittedLookupProof, LookupProof,
};
use crate::mle::{eq_eval, eq_weights, mle_eval};
use crate::pcs;
use crate::reduce::{
    prove_committed_rowsum, verify_committed_rowsum, CommittedRowSumProof,
};
use crate::sumcheck::{prove_product_multi, verify_product_multi, MultiSumcheckProof};
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};
use ark_ff::{PrimeField, Zero};

/// A canonical quantized `rsqrt` lookup table (columns: input `ss` code, output `inv_rms` code).
///
/// Deterministic from `(domain, out_scale, eps)` so prover and verifier reconstruct byte-identical
/// tables. Code `s ∈ 0..domain` denotes the (non-negative) sum-of-squares accumulator; the output is
/// `round(out_scale / sqrt(s + eps))`, clamped into `0..domain`.
pub struct RsqrtTable {
    pub domain: usize,
    pub out_scale: f64,
    pub eps: f64,
    pub in_codes: Vec<Fr>,
    pub out_codes: Vec<Fr>,
}

impl RsqrtTable {
    /// Build the table over `domain` codes (power of two ≥ 2).
    pub fn new(domain: usize, out_scale: f64, eps: f64) -> Self {
        assert!(domain.is_power_of_two() && domain >= 2, "domain must be a power of two ≥ 2");
        let mut in_codes = Vec::with_capacity(domain);
        let mut out_codes = Vec::with_capacity(domain);
        let max_code = (domain - 1) as i64;
        for s in 0..domain {
            let inv = out_scale / (s as f64 + eps).sqrt();
            let code = (inv.round() as i64).clamp(0, max_code);
            in_codes.push(Fr::from(s as u64));
            out_codes.push(Fr::from(code as u64));
        }
        Self { domain, out_scale, eps, in_codes, out_codes }
    }

    /// Apply the table to a column of `ss` codes (each must be a valid code `0..domain`).
    pub fn apply(&self, ss_codes: &[Fr]) -> Vec<Fr> {
        ss_codes.iter().map(|c| self.out_codes[code_to_index(c, self.domain)]).collect()
    }

    fn prove(&self, ss: &[Fr], inv_rms: &[Fr], tr: &mut Transcript) -> LookupProof {
        prove_lookup(&[ss, inv_rms], &[&self.in_codes, &self.out_codes], tr)
    }

    fn verify(&self, ss: &[Fr], inv_rms: &[Fr], proof: &LookupProof, tr: &mut Transcript) -> bool {
        verify_lookup(&[ss, inv_rms], &[&self.in_codes, &self.out_codes], proof, tr)
    }
}

/// Decode a small non-negative field code to a `usize` index (panics if not a small in-domain code).
fn code_to_index(code: &Fr, domain: usize) -> usize {
    let big = code.into_bigint();
    let limbs = big.as_ref();
    for &l in &limbs[1..] {
        assert_eq!(l, 0, "rsqrt input `ss` is not a valid small code");
    }
    let idx = limbs[0] as usize;
    assert!(idx < domain, "rsqrt input code {idx} out of domain {domain}");
    idx
}

/// A sound RMSNorm proof for a `seq × d` tensor, in the verifiable-computation model.
/// Intermediate tensors are carried explicitly (M5.4 replaces them with commitment openings).
pub struct RmsNormProof {
    pub seq: usize,
    pub d: usize,
    pub xsq: Vec<Fr>,
    pub ss: Vec<Fr>,
    pub inv_rms: Vec<Fr>,
    pub t: Vec<Fr>,
    pub p_sq: HadamardProof,
    pub p_rsqrt: LookupProof,
    pub p_scale1: HadamardProof,
    pub p_scale2: HadamardProof,
}

/// Broadcast a per-row column `v` (len `seq`) across `d` columns → `bc[r*d+j] = v[r]`.
fn broadcast_rows(v: &[Fr], d: usize) -> Vec<Fr> {
    let mut out = Vec::with_capacity(v.len() * d);
    for &vr in v {
        for _ in 0..d {
            out.push(vr);
        }
    }
    out
}

/// Broadcast a per-channel weight `w` (len `d`) across `seq` rows → `bc[r*d+j] = w[j]`.
fn broadcast_cols(w: &[Fr], seq: usize, d: usize) -> Vec<Fr> {
    let mut out = Vec::with_capacity(seq * d);
    for _ in 0..seq {
        out.extend_from_slice(w);
    }
    out
}

/// Row-wise sum of squares: `ss[r] = Σ_j xsq[r*d+j]`.
fn row_sums(xsq: &[Fr], seq: usize, d: usize) -> Vec<Fr> {
    let mut ss = vec![Fr::zero(); seq];
    for r in 0..seq {
        let mut acc = Fr::zero();
        for j in 0..d {
            acc += xsq[r * d + j];
        }
        ss[r] = acc;
    }
    ss
}

/// Prove `y = RMSNorm(x)` for a `seq × d` tensor with per-channel weight `w` (len `d`), where the
/// `inv_rms` transcendental is defined by the canonical `table`. Returns `(proof, y)`.
///
/// `seq` and `d` must be powers of two (the sub-sumchecks are over the boolean hypercube). Every
/// `ss[r] = Σ_j x[r,j]²` must be a valid code of `table` (lookup precondition).
pub fn prove_rmsnorm(
    x: &[Fr],
    w: &[Fr],
    seq: usize,
    d: usize,
    table: &RsqrtTable,
    tr: &mut Transcript,
) -> (RmsNormProof, Vec<Fr>) {
    assert!(seq.is_power_of_two() && d.is_power_of_two(), "seq and d must be powers of two");
    assert_eq!(x.len(), seq * d, "x must be seq*d");
    assert_eq!(w.len(), d, "w must be length d");

    // xsq = x ⊙ x (sound Hadamard).
    let xsq: Vec<Fr> = x.iter().map(|v| *v * *v).collect();
    let p_sq = prove_hadamard(x, x, &xsq, tr);

    // ss = row-sum of xsq (linear; checked directly by the verifier).
    let ss = row_sums(&xsq, seq, d);

    // inv_rms = rsqrt_table(ss) (sound lookup — the only transcendental).
    let inv_rms = table.apply(&ss);
    let p_rsqrt = table.prove(&ss, &inv_rms, tr);

    // t = x ⊙ broadcast_rows(inv_rms) (sound Hadamard).
    let inv_bc = broadcast_rows(&inv_rms, d);
    let t: Vec<Fr> = x.iter().zip(inv_bc.iter()).map(|(a, b)| *a * *b).collect();
    let p_scale1 = prove_hadamard(x, &inv_bc, &t, tr);

    // y = t ⊙ broadcast_cols(w) (sound Hadamard).
    let w_bc = broadcast_cols(w, seq, d);
    let y: Vec<Fr> = t.iter().zip(w_bc.iter()).map(|(a, b)| *a * *b).collect();
    let p_scale2 = prove_hadamard(&t, &w_bc, &y, tr);

    let proof = RmsNormProof { seq, d, xsq, ss, inv_rms, t, p_sq, p_rsqrt, p_scale1, p_scale2 };
    (proof, y)
}

/// Verify a `y = RMSNorm(x)` proof against public `x`, `w`, claimed `y`, and the canonical `table`.
#[allow(clippy::too_many_arguments)]
pub fn verify_rmsnorm(
    x: &[Fr],
    w: &[Fr],
    seq: usize,
    d: usize,
    y: &[Fr],
    proof: &RmsNormProof,
    table: &RsqrtTable,
    tr: &mut Transcript,
) -> bool {
    if !seq.is_power_of_two() || !d.is_power_of_two() {
        return false;
    }
    if proof.seq != seq || proof.d != d {
        return false;
    }
    if x.len() != seq * d
        || w.len() != d
        || y.len() != seq * d
        || proof.xsq.len() != seq * d
        || proof.ss.len() != seq
        || proof.inv_rms.len() != seq
        || proof.t.len() != seq * d
    {
        return false;
    }

    // xsq = x ⊙ x.
    if !verify_hadamard(x, x, &proof.xsq, &proof.p_sq, tr) {
        return false;
    }

    // ss = row-sum of xsq (direct linear check — verifier holds xsq).
    if row_sums(&proof.xsq, seq, d) != proof.ss {
        return false;
    }

    // inv_rms = rsqrt_table(ss).
    if !table.verify(&proof.ss, &proof.inv_rms, &proof.p_rsqrt, tr) {
        return false;
    }

    // t = x ⊙ broadcast_rows(inv_rms).
    let inv_bc = broadcast_rows(&proof.inv_rms, d);
    if !verify_hadamard(x, &inv_bc, &proof.t, &proof.p_scale1, tr) {
        return false;
    }

    // y = t ⊙ broadcast_cols(w).
    let w_bc = broadcast_cols(w, seq, d);
    verify_hadamard(&proof.t, &w_bc, y, &proof.p_scale2, tr)
}

// ─── Committed (succinct) RMSNorm — M5.4b ─────────────────────────────────────
//
// Assembles the committed sub-arguments so the verifier holds no activation tensors — only the
// input/output commitments (and the small public per-channel weight `w`). Dataflow, all under one
// Fiat–Shamir transcript:
//   1. `xsq = x ⊙ x`               → `gadgets::…hadamard_io`  (commits + opens the output `xsq`)
//   2. `ss  = Σ_j xsq[r,j]`        → `reduce::…rowsum`        (commits + opens `ss`)
//   3. `inv = rsqrt_table(ss)`     → `lookup::…committed`     (query cols `[ss, inv]`)
//   4. `y   = x ⊙ inv[r] ⊙ w[j]`   → a 4-product sumcheck fusing both scalings (no broadcast tensors
//      materialized for the verifier: `inv` is opened at the row-bits of the challenge and `w` — public
//      — is evaluated directly).
// Ops are linked by **commitment reuse** (PCS binding = same polynomial across every seam): the
// hadamard output commitment IS the row-sum input; the row-sum output commitment IS the lookup's `ss`
// column; the lookup's `inv` column commitment IS the scaling's per-row operand; and `x`,`y` thread
// straight through. The verifier ties these by comparing commitment bytes, and ties the lookup's
// committed table to the canonical `rsqrt` table (else a prover could look up against a forged table).
//
// `w` is kept public here (verifier-held), matching the plain path; committing `w` under the model's
// PoMA commitment is the remaining step for a fully weight-bound block.

/// A succinct RMSNorm proof: the three committed sub-proofs plus the fused-scaling sumcheck and its
/// openings. Internal commitments (`xsq`, `ss`) are carried so the verifier can thread the seams;
/// `inv`'s commitment lives in `p_lookup.comm_query[1]`.
pub struct CommittedRmsNormProof {
    pub comm_xsq: pcs::Comm,
    pub comm_ss: pcs::Comm,
    pub p_sq: CommittedIoHadamardProof,
    pub p_rowsum: CommittedRowSumProof,
    pub p_lookup: CommittedLookupProof,
    pub y_at_rho: Fr,
    pub open_y: pcs::OpeningProof,
    pub sc_scale: MultiSumcheckProof,
    pub x_final: Fr,
    pub open_x_scale: pcs::OpeningProof,
    pub inv_final: Fr,
    pub open_inv_scale: pcs::OpeningProof,
}

/// Absorb the scaling step's dims, `w`, and the `x`,`inv`,`y` commitments, then draw the point ρ.
fn bind_scale(
    tr: &mut Transcript,
    seq: usize,
    d: usize,
    w: &[Fr],
    comm_x: &pcs::Comm,
    comm_inv: &pcs::Comm,
    comm_y: &pcs::Comm,
) -> Vec<Fr> {
    tr.absorb_bytes(b"nrm.seq", &(seq as u64).to_le_bytes());
    tr.absorb_bytes(b"nrm.d", &(d as u64).to_le_bytes());
    tr.absorb_bytes(b"nrm.w", &commit_field_table(w));
    tr.absorb_bytes(b"nrm.x", &pcs::commitment_bytes(comm_x));
    tr.absorb_bytes(b"nrm.inv", &pcs::commitment_bytes(comm_inv));
    tr.absorb_bytes(b"nrm.y", &pcs::commitment_bytes(comm_y));
    (0..log2_exact(seq * d)).map(|_| tr.challenge(b"nrm.scale.rho")).collect()
}

/// Prove `y = RMSNorm(x)` succinctly. `ck_wide` sizes the `seq·d` tensors (`x`, `xsq`, `y`),
/// `ck_narrow` the length-`seq` columns (`ss`, `inv`), `ck_table` the `rsqrt` table domain. Returns
/// the proof, the `(x, y)` commitments, and `y`.
#[allow(clippy::too_many_arguments)]
pub fn prove_committed_rmsnorm(
    x: &[Fr],
    w: &[Fr],
    seq: usize,
    d: usize,
    table: &RsqrtTable,
    ck_wide: &pcs::Ck,
    ck_narrow: &pcs::Ck,
    ck_table: &pcs::Ck,
    tr: &mut Transcript,
) -> (CommittedRmsNormProof, pcs::Comm, pcs::Comm, Vec<Fr>) {
    assert!(seq.is_power_of_two() && d.is_power_of_two(), "seq and d must be powers of two");
    assert_eq!(x.len(), seq * d, "x must be seq*d");
    assert_eq!(w.len(), d, "w must be length d");

    let comm_x = pcs::commit(ck_wide, x);

    // 1. xsq = x ⊙ x (I/O-committed: output commitment feeds the row-sum).
    let xsq: Vec<Fr> = x.iter().map(|v| *v * *v).collect();
    let (p_sq, _ca, _cb, comm_xsq) = prove_committed_hadamard_io(x, x, &xsq, ck_wide, tr);

    // 2. ss = row-sum of xsq (reuse comm_xsq as the wide input).
    let ss = row_sums(&xsq, seq, d);
    let (p_rowsum, _cw, comm_ss) =
        prove_committed_rowsum(&xsq, &ss, seq, d, ck_wide, ck_narrow, tr);

    // 3. inv = rsqrt_table(ss) (query cols [ss, inv]; comm_query[0] == comm_ss by determinism).
    let inv = table.apply(&ss);
    let p_lookup = prove_committed_lookup(
        &[&ss, &inv],
        &[&table.in_codes, &table.out_codes],
        ck_narrow,
        ck_table,
        tr,
    );

    // 4. y = x ⊙ inv[r] ⊙ w[j] — fused via a 4-product sumcheck, no broadcast tensors for the verifier.
    let inv_bc = broadcast_rows(&inv, d);
    let w_bc = broadcast_cols(w, seq, d);
    let y: Vec<Fr> = (0..seq * d).map(|i| x[i] * inv_bc[i] * w_bc[i]).collect();
    let comm_y = pcs::commit(ck_wide, &y);
    let comm_inv = pcs::commit(ck_narrow, &inv); // == p_lookup.comm_query[1]

    let rho = bind_scale(tr, seq, d, w, &comm_x, &comm_inv, &comm_y);
    let y_at_rho = mle_eval(&y, &rho);
    let eq2 = eq_weights(&rho);
    let (sc_scale, ch, finals) =
        prove_product_multi(vec![eq2, x.to_vec(), inv_bc, w_bc], tr);

    let n_row = log2_exact(seq);
    let open_y = pcs::open(ck_wide, &y, &rho);
    let open_x_scale = pcs::open(ck_wide, x, &ch);
    let open_inv_scale = pcs::open(ck_narrow, &inv, &ch[..n_row]);

    let proof = CommittedRmsNormProof {
        comm_xsq,
        comm_ss,
        p_sq,
        p_rowsum,
        p_lookup,
        y_at_rho,
        open_y,
        sc_scale,
        x_final: finals[1],
        open_x_scale,
        inv_final: finals[2],
        open_inv_scale,
    };
    (proof, comm_x, comm_y, y)
}

/// Succinctly verify `y = RMSNorm(x)` from `comm_x`, `comm_y`, the public `w`, and the canonical
/// `table`. The verifier holds no activation tensors. `ck_table` is needed only to re-derive the
/// canonical table commitments for the anti-forged-table tie (the table is public model infra).
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_rmsnorm(
    w: &[Fr],
    seq: usize,
    d: usize,
    table: &RsqrtTable,
    comm_x: &pcs::Comm,
    comm_y: &pcs::Comm,
    proof: &CommittedRmsNormProof,
    ck_table: &pcs::Ck,
    vk_wide: &pcs::Vk,
    vk_narrow: &pcs::Vk,
    vk_table: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !seq.is_power_of_two() || !d.is_power_of_two() || w.len() != d {
        return false;
    }

    // 1. xsq = x ⊙ x (both operands are comm_x; output is the carried comm_xsq).
    if !verify_committed_hadamard_io(
        seq * d, comm_x, comm_x, &proof.comm_xsq, &proof.p_sq, vk_wide, tr,
    ) {
        return false;
    }

    // 2. ss = row-sum of xsq (wide = comm_xsq, narrow = comm_ss).
    if !verify_committed_rowsum(
        seq, d, &proof.comm_xsq, &proof.comm_ss, &proof.p_rowsum, vk_wide, vk_narrow, tr,
    ) {
        return false;
    }

    // 3. inv = rsqrt_table(ss). Tie the lookup's ss-column to comm_ss, and its committed table to the
    //    canonical rsqrt table (a forged table would otherwise let the prover "look up" anything).
    if proof.p_lookup.comm_query.len() != 2 || proof.p_lookup.comm_table.len() != 2 {
        return false;
    }
    let bytes = pcs::commitment_bytes;
    if bytes(&proof.p_lookup.comm_query[0]) != bytes(&proof.comm_ss) {
        return false;
    }
    let want_in = pcs::commit(ck_table, &table.in_codes);
    let want_out = pcs::commit(ck_table, &table.out_codes);
    if bytes(&proof.p_lookup.comm_table[0]) != bytes(&want_in)
        || bytes(&proof.p_lookup.comm_table[1]) != bytes(&want_out)
    {
        return false;
    }
    if !verify_committed_lookup(seq, table.domain, &proof.p_lookup, vk_narrow, vk_table, tr) {
        return false;
    }
    let comm_inv = &proof.p_lookup.comm_query[1];

    // 4. y = x ⊙ inv[r] ⊙ w[j] — the fused scaling sumcheck.
    let rho = bind_scale(tr, seq, d, w, comm_x, comm_inv, comm_y);
    let (ch, reduced) = match verify_product_multi(&proof.sc_scale, proof.y_at_rho, tr) {
        Some(v) => v,
        None => return false,
    };
    let n_row = log2_exact(seq);
    let eq_final = eq_eval(&rho, &ch);
    // w is public: w_bc(ch) = ŵ(col-bits of ch); inv is opened at the row-bits.
    let w_final = mle_eval(w, &ch[n_row..]);
    if reduced != eq_final * proof.x_final * proof.inv_final * w_final {
        return false;
    }

    pcs::verify(vk_wide, comm_y, &rho, proof.y_at_rho, &proof.open_y)
        && pcs::verify(vk_wide, comm_x, &ch, proof.x_final, &proof.open_x_scale)
        && pcs::verify(vk_narrow, comm_inv, &ch[..n_row], proof.inv_final, &proof.open_inv_scale)
}
