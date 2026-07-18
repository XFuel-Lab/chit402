//! Logup lookup argument (Habök-style) — the sound way to prove **transcendental** transformer ops.
//!
//! A non-linear op that can't be expressed as field arithmetic (SiLU, GeLU, softmax's `exp`,
//! RMSNorm's `rsqrt`) is proven by a **table lookup**: precompute the quantized `(input, output)`
//! table for the op, then prove every `(input_i, output_i)` the model used is a row of that table.
//! Because the table encodes the *correct* op, the lookup proves the op was applied correctly —
//! with no field-native circuit for the non-linearity itself.
//!
//! ## The argument
//! Columns are folded to scalars with a random `γ`: `q_i = Σ_c γ^c·query_c[i]`,
//! `τ_j = Σ_c γ^c·table_c[j]`. With a random `β`, the logup identity
//! ```text
//!   Σ_i 1/(β − q_i)  =  Σ_j m_j/(β − τ_j)
//! ```
//! (where `m_j` = multiplicity of table row `j` among the queries) holds iff every query row is a
//! table row. We commit the inverse advice `a_i = 1/(β−q_i)`, `b_j = m_j/(β−τ_j)` and discharge:
//! * **sum identity**  `Σ a = Σ b`  (the logup equation), and
//! * two **zero-checks**  `a_i(β−q_i) = 1`  and  `b_j(β−τ_j) = m_j`, each reduced to a triple-product
//!   `Σ_x eq(r,x)·a(x)·q(x) = β·â(r) − 1` sumcheck (the algebra folds the `−1`/`−m` into the claim).
//!
//! Trust boundary (M5.2b): a *verifiable-computation* reduction — the verifier is given the columns
//! + advice and checks the sumchecks. Binding the column MLE evaluations to polynomial commitments
//! (so the verifier needs only commitments) is the same M5.4 upgrade as the matmul core.

use crate::commitment::commit_field_table;
use crate::mle::{eq_eval, eq_weights, mle_eval};
use crate::sumcheck::{prove_product_multi, verify_product_multi, MultiSumcheckProof};
use crate::transcript::Transcript;
use crate::{log2_exact, Fr};
use ark_ff::{Field, One, Zero};

/// A logup proof that the query rows are a subset of the table rows.
/// Carries the inverse advice + multiplicities (witness, read by the verifier in the M5.2b model)
/// and the two zero-check sumchecks.
pub struct LookupProof {
    pub a: Vec<Fr>,
    pub b: Vec<Fr>,
    pub m: Vec<Fr>,
    pub sc_q: MultiSumcheckProof,
    pub sc_t: MultiSumcheckProof,
}

fn fold_columns(cols: &[&[Fr]], gamma: Fr) -> Vec<Fr> {
    let len = cols[0].len();
    let mut out = vec![Fr::zero(); len];
    let mut coeff = Fr::one();
    for col in cols {
        for i in 0..len {
            out[i] += coeff * col[i];
        }
        coeff *= gamma;
    }
    out
}

/// Absorb columns + draw the fold/logup challenges. Shared by prover and verifier so transcripts
/// stay identical.
fn bind_and_challenge(
    tr: &mut Transcript,
    query_cols: &[&[Fr]],
    table_cols: &[&[Fr]],
    m: &[Fr],
) -> (Fr, Fr) {
    for (i, c) in query_cols.iter().enumerate() {
        tr.absorb_bytes(&[b"lk.q"[0], b"lk.q"[1], b"lk.q"[2], i as u8], &commit_field_table(c));
    }
    for (i, c) in table_cols.iter().enumerate() {
        tr.absorb_bytes(&[b"lk.t"[0], b"lk.t"[1], b"lk.t"[2], i as u8], &commit_field_table(c));
    }
    tr.absorb_bytes(b"lk.m", &commit_field_table(m));
    let gamma = tr.challenge(b"lk.gamma");
    let beta = tr.challenge(b"lk.beta");
    (gamma, beta)
}

/// Prove that every query row `(query_cols[..][i])` equals some table row `(table_cols[..][j])`.
/// `table_cols[0]` must be the (distinct) input codes; multiplicities are computed by matching each
/// query's input code to the table.
pub fn prove_lookup(
    query_cols: &[&[Fr]],
    table_cols: &[&[Fr]],
    tr: &mut Transcript,
) -> LookupProof {
    let n = query_cols[0].len();
    let t = table_cols[0].len();
    assert!(n.is_power_of_two() && t.is_power_of_two());
    for c in query_cols {
        assert_eq!(c.len(), n);
    }
    for c in table_cols {
        assert_eq!(c.len(), t);
    }

    // Multiplicities by matching query input code (col 0) to the table input code (col 0).
    let mut index: std::collections::HashMap<Vec<u8>, usize> = std::collections::HashMap::new();
    for (j, code) in table_cols[0].iter().enumerate() {
        index.insert(field_key(code), j);
    }
    let mut m = vec![Fr::zero(); t];
    for code in query_cols[0].iter() {
        let j = *index
            .get(&field_key(code))
            .expect("query input code must exist in the table (lookup precondition)");
        m[j] += Fr::one();
    }

    let (gamma, beta) = bind_and_challenge(tr, query_cols, table_cols, &m);

    let q = fold_columns(query_cols, gamma);
    let tau = fold_columns(table_cols, gamma);

    let a: Vec<Fr> = q.iter().map(|qi| (beta - qi).inverse().expect("β collides with a query fold (negligible)")).collect();
    let b: Vec<Fr> = tau
        .iter()
        .zip(m.iter())
        .map(|(ti, mj)| *mj * (beta - ti).inverse().expect("β collides with a table fold (negligible)"))
        .collect();

    tr.absorb_bytes(b"lk.a", &commit_field_table(&a));
    tr.absorb_bytes(b"lk.b", &commit_field_table(&b));

    // Zero-check for the query side: Σ_x eq(r,x)·a(x)·q(x) = β·â(r) − 1.
    let sq = log2_exact(n);
    let r2: Vec<Fr> = (0..sq).map(|_| tr.challenge(b"lk.r2")).collect();
    let e2 = eq_weights(&r2);
    let (sc_q, _c2, _f2) = prove_product_multi(vec![e2, a.clone(), q.clone()], tr);

    // Zero-check for the table side: Σ_x eq(r,x)·b(x)·τ(x) = β·b̂(r) − m̂(r).
    let st = log2_exact(t);
    let r3: Vec<Fr> = (0..st).map(|_| tr.challenge(b"lk.r3")).collect();
    let e3 = eq_weights(&r3);
    let (sc_t, _c3, _f3) = prove_product_multi(vec![e3, b.clone(), tau.clone()], tr);

    LookupProof { a, b, m, sc_q, sc_t }
}

/// Verify a logup lookup proof.
pub fn verify_lookup(
    query_cols: &[&[Fr]],
    table_cols: &[&[Fr]],
    proof: &LookupProof,
    tr: &mut Transcript,
) -> bool {
    let n = query_cols[0].len();
    let t = table_cols[0].len();
    if !n.is_power_of_two() || !t.is_power_of_two() {
        return false;
    }
    if proof.a.len() != n || proof.b.len() != t || proof.m.len() != t {
        return false;
    }
    for c in query_cols {
        if c.len() != n {
            return false;
        }
    }
    for c in table_cols {
        if c.len() != t {
            return false;
        }
    }

    let (gamma, beta) = bind_and_challenge(tr, query_cols, table_cols, &proof.m);
    let q = fold_columns(query_cols, gamma);
    let tau = fold_columns(table_cols, gamma);

    // Logup sum identity: Σ a = Σ b (direct in the M5.2b model; a sumcheck+PCS in M5.4).
    let sum_a: Fr = proof.a.iter().copied().sum();
    let sum_b: Fr = proof.b.iter().copied().sum();
    if sum_a != sum_b {
        return false;
    }

    tr.absorb_bytes(b"lk.a", &commit_field_table(&proof.a));
    tr.absorb_bytes(b"lk.b", &commit_field_table(&proof.b));

    // Query-side zero-check.
    let sq = log2_exact(n);
    let r2: Vec<Fr> = (0..sq).map(|_| tr.challenge(b"lk.r2")).collect();
    let claim_q = beta * mle_eval(&proof.a, &r2) - Fr::one();
    let (ch2, reduced2) = match verify_product_multi(&proof.sc_q, claim_q, tr) {
        Some(v) => v,
        None => return false,
    };
    let expect2 = eq_eval(&r2, &ch2) * mle_eval(&proof.a, &ch2) * mle_eval(&q, &ch2);
    if reduced2 != expect2 {
        return false;
    }

    // Table-side zero-check.
    let st = log2_exact(t);
    let r3: Vec<Fr> = (0..st).map(|_| tr.challenge(b"lk.r3")).collect();
    let claim_t = beta * mle_eval(&proof.b, &r3) - mle_eval(&proof.m, &r3);
    let (ch3, reduced3) = match verify_product_multi(&proof.sc_t, claim_t, tr) {
        Some(v) => v,
        None => return false,
    };
    let expect3 = eq_eval(&r3, &ch3) * mle_eval(&proof.b, &ch3) * mle_eval(&tau, &ch3);
    reduced3 == expect3
}

/// Stable byte key for a field element (for multiplicity matching).
fn field_key(f: &Fr) -> Vec<u8> {
    use ark_ff::{BigInteger, PrimeField};
    f.into_bigint().to_bytes_le()
}
