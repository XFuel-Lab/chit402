//! Product sumcheck: prove `Σ_{x∈{0,1}^s} f(x)·g(x)` for two MLEs `f, g`.
//!
//! Each round the prover sends the degree-2 univariate `s_t(X) = Σ_rest f(X,rest)·g(X,rest)` as its
//! evaluations at `X ∈ {0,1,2}`; the verifier checks `s_t(0)+s_t(1) == claim`, draws a Fiat–Shamir
//! challenge `r_t`, and reduces `claim ← s_t(r_t)`. After `s` rounds the claim is reduced to
//! `f(r)·g(r)` at the random point `r = (r_1,…,r_s)`.
//!
//! The variable folded each round is the **high bit** of the current table (MSB-first), matching the
//! `eq_weights` convention in [`crate::mle`].

use crate::transcript::Transcript;
use crate::{log2_exact, Fr};
use ark_ff::{Field, One, Zero};

/// A non-interactive product-sumcheck proof: per-round univariate evaluations at `{0,1,2}`.
#[derive(Clone, Debug)]
pub struct SumcheckProof {
    pub round_evals: Vec<[Fr; 3]>,
}

/// Interpolate the degree-2 polynomial through `(0,e0),(1,e1),(2,e2)` and evaluate it at `x`.
fn eval_uni_at(evals: &[Fr; 3], x: Fr) -> Fr {
    let [e0, e1, e2] = *evals;
    let two = Fr::from(2u64);
    let two_inv = two.inverse().expect("2 is invertible in BN254 Fr");
    // Lagrange basis on nodes {0,1,2}:
    //   L0 = (x-1)(x-2)/2,  L1 = -(x)(x-2),  L2 = x(x-1)/2
    let l0 = (x - Fr::one()) * (x - two) * two_inv;
    let l1 = -(x * (x - two));
    let l2 = x * (x - Fr::one()) * two_inv;
    e0 * l0 + e1 * l1 + e2 * l2
}

/// Prove `Σ f(x)·g(x)`. Returns `(proof, challenges r, f(r), g(r))`.
pub fn prove_product(
    mut fa: Vec<Fr>,
    mut ga: Vec<Fr>,
    tr: &mut Transcript,
) -> (SumcheckProof, Vec<Fr>, Fr, Fr) {
    assert_eq!(fa.len(), ga.len(), "f and g must have equal length");
    let s = log2_exact(fa.len());
    let mut round_evals = Vec::with_capacity(s);
    let mut challenges = Vec::with_capacity(s);

    for _ in 0..s {
        let half = fa.len() / 2;
        let (mut e0, mut e1, mut e2) = (Fr::zero(), Fr::zero(), Fr::zero());
        for r in 0..half {
            let (f0, f1) = (fa[r], fa[half + r]);
            let (g0, g1) = (ga[r], ga[half + r]);
            e0 += f0 * g0;
            e1 += f1 * g1;
            // linear extrapolation to X=2: p(2) = 2·p(1) - p(0)
            let f2 = f1 + f1 - f0;
            let g2 = g1 + g1 - g0;
            e2 += f2 * g2;
        }
        let evals = [e0, e1, e2];
        tr.absorb_field(b"s0", &e0);
        tr.absorb_field(b"s1", &e1);
        tr.absorb_field(b"s2", &e2);
        let ch = tr.challenge(b"r");

        let mut nf = vec![Fr::zero(); half];
        let mut ng = vec![Fr::zero(); half];
        for r in 0..half {
            nf[r] = fa[r] + ch * (fa[half + r] - fa[r]);
            ng[r] = ga[r] + ch * (ga[half + r] - ga[r]);
        }
        fa = nf;
        ga = ng;
        round_evals.push(evals);
        challenges.push(ch);
    }

    (SumcheckProof { round_evals }, challenges, fa[0], ga[0])
}

/// Verify a product-sumcheck reduces `claim` correctly.
/// Returns `Some((challenges r, reduced_claim))` where `reduced_claim` must equal `f(r)·g(r)`,
/// or `None` if any round's consistency check fails.
pub fn verify_product(
    proof: &SumcheckProof,
    mut claim: Fr,
    tr: &mut Transcript,
) -> Option<(Vec<Fr>, Fr)> {
    let mut challenges = Vec::with_capacity(proof.round_evals.len());
    for evals in &proof.round_evals {
        let [e0, e1, _e2] = *evals;
        if e0 + e1 != claim {
            return None;
        }
        tr.absorb_field(b"s0", &evals[0]);
        tr.absorb_field(b"s1", &evals[1]);
        tr.absorb_field(b"s2", &evals[2]);
        let ch = tr.challenge(b"r");
        claim = eval_uni_at(evals, ch);
        challenges.push(ch);
    }
    Some((challenges, claim))
}

// ─── Generic multi-product sumcheck (degree = number of tables) ───────────────
//
// Proves `Σ_{x∈{0,1}^s} Π_t table_t(x)` for `d = tables.len()` multilinear tables. The round
// polynomial has degree `d`, sent as its evaluations at nodes `{0,1,…,d}`. Used by the Hadamard
// (elementwise-product) gadget with tables `[eq(r,·), a, b]` (degree 3). `prove_product` above is
// the specialized degree-2 case kept for the matmul core.

/// A multi-product sumcheck proof: per-round univariate evaluations at nodes `{0,1,…,d}`.
#[derive(Clone, Debug)]
pub struct MultiSumcheckProof {
    pub round_evals: Vec<Vec<Fr>>,
}

/// Evaluate the polynomial defined by `evals` at nodes `0..evals.len()` at point `x` (Lagrange).
pub fn lagrange_eval(evals: &[Fr], x: Fr) -> Fr {
    let n = evals.len();
    let mut acc = Fr::zero();
    for i in 0..n {
        let xi = Fr::from(i as u64);
        let mut num = Fr::one();
        let mut den = Fr::one();
        for j in 0..n {
            if j == i {
                continue;
            }
            let xj = Fr::from(j as u64);
            num *= x - xj;
            den *= xi - xj;
        }
        acc += evals[i] * num * den.inverse().expect("distinct nodes are invertible");
    }
    acc
}

/// Prove `Σ_x Π_t table_t(x)`. Returns `(proof, challenges r, finals = [table_t(r)])`.
pub fn prove_product_multi(
    mut tables: Vec<Vec<Fr>>,
    tr: &mut Transcript,
) -> (MultiSumcheckProof, Vec<Fr>, Vec<Fr>) {
    let d = tables.len();
    assert!(d >= 1, "need at least one table");
    let len = tables[0].len();
    for t in &tables {
        assert_eq!(t.len(), len, "all tables must be equal length");
    }
    let s = log2_exact(len);
    let mut round_evals = Vec::with_capacity(s);
    let mut challenges = Vec::with_capacity(s);

    for _ in 0..s {
        let half = tables[0].len() / 2;
        let mut evals = vec![Fr::zero(); d + 1];
        for r in 0..half {
            for (xi, ev) in evals.iter_mut().enumerate() {
                let x = Fr::from(xi as u64);
                let mut prod = Fr::one();
                for t in &tables {
                    let tx = t[r] + x * (t[half + r] - t[r]);
                    prod *= tx;
                }
                *ev += prod;
            }
        }
        for e in &evals {
            tr.absorb_field(b"m", e);
        }
        let ch = tr.challenge(b"r");
        for t in tables.iter_mut() {
            let mut nt = vec![Fr::zero(); half];
            for r in 0..half {
                nt[r] = t[r] + ch * (t[half + r] - t[r]);
            }
            *t = nt;
        }
        round_evals.push(evals);
        challenges.push(ch);
    }

    let finals = tables.iter().map(|t| t[0]).collect();
    (MultiSumcheckProof { round_evals }, challenges, finals)
}

/// Verify a multi-product sumcheck reduces `claim`.
/// Returns `Some((challenges r, reduced_claim))` where `reduced_claim` must equal `Π_t table_t(r)`.
pub fn verify_product_multi(
    proof: &MultiSumcheckProof,
    mut claim: Fr,
    tr: &mut Transcript,
) -> Option<(Vec<Fr>, Fr)> {
    let mut challenges = Vec::with_capacity(proof.round_evals.len());
    for evals in &proof.round_evals {
        if evals.len() < 2 || evals[0] + evals[1] != claim {
            return None;
        }
        for e in evals {
            tr.absorb_field(b"m", e);
        }
        let ch = tr.challenge(b"r");
        claim = lagrange_eval(evals, ch);
        challenges.push(ch);
    }
    Some((challenges, claim))
}
