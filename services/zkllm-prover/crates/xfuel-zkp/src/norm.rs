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

use crate::gadgets::{prove_hadamard, verify_hadamard, HadamardProof};
use crate::lookup::{prove_lookup, verify_lookup, LookupProof};
use crate::transcript::Transcript;
use crate::Fr;
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
