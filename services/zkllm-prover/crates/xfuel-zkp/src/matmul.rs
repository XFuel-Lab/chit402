//! Sumcheck-based matrix-multiplication argument (Thaler-style).
//!
//! Proves `C = A·B` by reducing the claim `Ĉ(rx,ry) = Σ_l Â(rx,l)·B̂(l,ry)` (a sumcheck over the
//! shared inner dimension) to evaluations of the multilinear extensions `Â`, `B̂` at a random point.
//! Matmul is the architecture-independent ~90% of transformer inference cost, so this single
//! argument is the reusable core for every LLM.
//!
//! Dimensions `m, k, n` must be powers of two (pad otherwise). All matrices are row-major.
//!
//! Trust boundary (M5.1): this is a *verifiable-computation* reduction — the verifier is given
//! `A, B, C` and checks the reduction is sound. Binding `Â, B̂` evaluations to an on-chain
//! polynomial commitment of the weights (so the verifier needs only the commitment, not `A, B`) is
//! the M5.4 polynomial-commitment milestone.

use crate::mle::{eq_weights, mle_eval};
use crate::sumcheck::{prove_product, verify_product, SumcheckProof};
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};
use ark_ff::{BigInteger, PrimeField, Zero};
use sha3::{Digest, Keccak256};

/// A matrix-multiplication instance `C = A·B` (row-major).
pub struct MatMul {
    pub m: usize,
    pub k: usize,
    pub n: usize,
    pub a: Vec<Fr>,
    pub b: Vec<Fr>,
    pub c: Vec<Fr>,
}

/// A non-interactive proof that `C = A·B`.
pub struct MatMulProof {
    pub rx: Vec<Fr>,
    pub ry: Vec<Fr>,
    pub claim: Fr,
    pub sumcheck: SumcheckProof,
    pub f_final: Fr,
    pub g_final: Fr,
}

impl MatMulProof {
    /// Number of field elements carried by the proof (proof-size signal for benchmarks).
    pub fn field_len(&self) -> usize {
        self.rx.len() + self.ry.len() + 1 + self.sumcheck.round_evals.len() * 3 + 2
    }
}

impl MatMul {
    /// Build an instance, computing `C = A·B`.
    pub fn new(m: usize, k: usize, n: usize, a: Vec<Fr>, b: Vec<Fr>) -> Self {
        assert_eq!(a.len(), m * k, "A must be m*k");
        assert_eq!(b.len(), k * n, "B must be k*n");
        let mut c = vec![Fr::zero(); m * n];
        for i in 0..m {
            for l in 0..k {
                let ail = a[i * k + l];
                let brow = &b[l * n..l * n + n];
                let crow = &mut c[i * n..i * n + n];
                for j in 0..n {
                    crow[j] += ail * brow[j];
                }
            }
        }
        Self { m, k, n, a, b, c }
    }
}

fn encode_dims(m: usize, k: usize, n: usize) -> [u8; 24] {
    let mut out = [0u8; 24];
    out[0..8].copy_from_slice(&(m as u64).to_le_bytes());
    out[8..16].copy_from_slice(&(k as u64).to_le_bytes());
    out[16..24].copy_from_slice(&(n as u64).to_le_bytes());
    out
}

/// A binding commitment to a table of field elements (keccak of concatenated LE bytes).
fn commit_table(table: &[Fr]) -> [u8; 32] {
    let mut h = Keccak256::new();
    for f in table {
        h.update(f.into_bigint().to_bytes_le());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.finalize());
    out
}

fn draw_point(tr: &mut Transcript, vars: usize, label: &[u8]) -> Vec<Fr> {
    (0..vars).map(|_| tr.challenge(label)).collect()
}

/// `Ĉ(rx,ry) = Σ_i eqx[i] Σ_j eqy[j] C[i,j]`.
fn c_hat(c: &[Fr], m: usize, n: usize, eqx: &[Fr], eqy: &[Fr]) -> Fr {
    let mut claim = Fr::zero();
    for i in 0..m {
        let mut rowsum = Fr::zero();
        let row = &c[i * n..i * n + n];
        for j in 0..n {
            rowsum += eqy[j] * row[j];
        }
        claim += eqx[i] * rowsum;
    }
    claim
}

/// Absorb the instance's public commitments and derive the evaluation point `(rx, ry)`.
fn bind_and_draw(tr: &mut Transcript, m: usize, k: usize, n: usize, c: &[Fr]) -> (Vec<Fr>, Vec<Fr>) {
    tr.absorb_bytes(b"dims", &encode_dims(m, k, n));
    tr.absorb_bytes(b"C", &commit_table(c));
    let rx = draw_point(tr, log2_exact(m), b"rx");
    let ry = draw_point(tr, log2_exact(n), b"ry");
    (rx, ry)
}

/// Produce a proof that `C = A·B`.
pub fn prove(mm: &MatMul, tr: &mut Transcript) -> MatMulProof {
    let (rx, ry) = bind_and_draw(tr, mm.m, mm.k, mm.n, &mm.c);
    let eqx = eq_weights(&rx);
    let eqy = eq_weights(&ry);

    // f[l] = Â(rx, l) = Σ_i eqx[i]·A[i,l]
    let mut f = vec![Fr::zero(); mm.k];
    for i in 0..mm.m {
        let w = eqx[i];
        let arow = &mm.a[i * mm.k..i * mm.k + mm.k];
        for l in 0..mm.k {
            f[l] += w * arow[l];
        }
    }
    // g[l] = B̂(l, ry) = Σ_j eqy[j]·B[l,j]
    let mut g = vec![Fr::zero(); mm.k];
    for l in 0..mm.k {
        let brow = &mm.b[l * mm.n..l * mm.n + mm.n];
        let mut acc = Fr::zero();
        for j in 0..mm.n {
            acc += eqy[j] * brow[j];
        }
        g[l] = acc;
    }

    let claim = c_hat(&mm.c, mm.m, mm.n, &eqx, &eqy);
    let (sumcheck, _ch, f_final, g_final) = prove_product(f, g, tr);
    MatMulProof { rx, ry, claim, sumcheck, f_final, g_final }
}

/// Verify a proof that `C = A·B` (verifiable-computation setting: verifier holds `A, B, C`).
pub fn verify(m: usize, k: usize, n: usize, a: &[Fr], b: &[Fr], c: &[Fr], proof: &MatMulProof, tr: &mut Transcript) -> bool {
    let (rx, ry) = bind_and_draw(tr, m, k, n, c);
    if rx != proof.rx || ry != proof.ry {
        return false;
    }
    let eqx = eq_weights(&rx);
    let eqy = eq_weights(&ry);
    if c_hat(c, m, n, &eqx, &eqy) != proof.claim {
        return false;
    }
    let (ch, reduced) = match verify_product(&proof.sumcheck, proof.claim, tr) {
        Some(v) => v,
        None => return false,
    };
    // The reduced claim must equal f(r)·g(r).
    if reduced != proof.f_final * proof.g_final {
        return false;
    }
    // Bind f(r), g(r) to A, B: f(r) = Â(rx, r); g(r) = B̂(r, ry).
    let mut a_point = rx.clone();
    a_point.extend_from_slice(&ch);
    let mut b_point = ch.clone();
    b_point.extend_from_slice(&ry);
    let f_expected = mle_eval(a, &a_point);
    let g_expected = mle_eval(b, &b_point);
    proof.f_final == f_expected && proof.g_final == g_expected
}
