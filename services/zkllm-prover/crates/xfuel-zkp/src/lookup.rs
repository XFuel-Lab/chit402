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
//! Trust boundary. [`prove_lookup`]/[`verify_lookup`] are a *verifiable-computation* reduction — the
//! verifier holds the columns + advice and (a) sums `a`,`b` directly and (b) recomputes their MLE
//! evaluations. [`prove_committed_lookup`]/[`verify_committed_lookup`] (M5.4a) close both gaps: the
//! grand-sum `Σa = Σb` becomes two sumchecks, every column and advice vector is committed via
//! [`crate::pcs`], and each MLE evaluation is discharged by a PCS opening — so the verifier holds only
//! commitments. Commitments are absorbed into the transcript *before* any challenge, so a prover
//! cannot pick the witness after seeing the "random" points.

use crate::commitment::commit_field_table;
use crate::mle::{eq_eval, eq_weights, mle_eval};
use crate::pcs;
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

/// Multiplicity of each table row among the queries, matched on the input code (column 0).
fn multiplicities(query_code: &[Fr], table_code: &[Fr]) -> Vec<Fr> {
    let mut index: std::collections::HashMap<Vec<u8>, usize> = std::collections::HashMap::new();
    for (j, code) in table_code.iter().enumerate() {
        index.insert(field_key(code), j);
    }
    let mut m = vec![Fr::zero(); table_code.len()];
    for code in query_code.iter() {
        let j = *index
            .get(&field_key(code))
            .expect("query input code must exist in the table (lookup precondition)");
        m[j] += Fr::one();
    }
    m
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

    let m = multiplicities(query_cols[0], table_cols[0]);

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

// ─── Committed (succinct) lookup — M5.4a ──────────────────────────────────────
//
// The verifier holds only commitments. Each MLE evaluation the M5.2b verifier recomputed becomes a
// PCS opening; the direct `Σa == Σb` sum becomes two grand-sum sumchecks that reduce each sum to a
// single (committed) evaluation. `γ,β` and the zero-check points are all drawn *after* the operand
// commitments are absorbed, so the witness is fixed before any challenge.

/// Fold committed-column opening *values* at a shared point into the folded-column evaluation
/// `Σ_c γ^c · col_c(point)` — the linear-in-columns image of [`fold_columns`].
fn fold_values(vals: &[Fr], gamma: Fr) -> Fr {
    let mut acc = Fr::zero();
    let mut coeff = Fr::one();
    for v in vals {
        acc += coeff * v;
        coeff *= gamma;
    }
    acc
}

/// A succinct logup proof: the two zero-check sumchecks, the two grand-sum sumchecks (`Σa`, `Σb`),
/// the claimed common sum, all commitments, and every opening the verifier needs.
pub struct CommittedLookupProof {
    pub sum: Fr,
    pub sc_sum_a: MultiSumcheckProof,
    pub sc_sum_b: MultiSumcheckProof,
    pub sc_q: MultiSumcheckProof,
    pub sc_t: MultiSumcheckProof,
    pub comm_query: Vec<pcs::Comm>,
    pub comm_table: Vec<pcs::Comm>,
    pub comm_m: pcs::Comm,
    pub comm_a: pcs::Comm,
    pub comm_b: pcs::Comm,
    pub a_cha: pcs::Opening,
    pub a_r2: pcs::Opening,
    pub a_ch2: pcs::Opening,
    pub b_chb: pcs::Opening,
    pub b_r3: pcs::Opening,
    pub b_ch3: pcs::Opening,
    pub m_r3: pcs::Opening,
    pub query_ch2: Vec<pcs::Opening>,
    pub table_ch3: Vec<pcs::Opening>,
}

/// Absorb the operand commitments, then draw `(γ, β)`. Shared by prover and verifier.
fn bind_committed(
    tr: &mut Transcript,
    comm_query: &[pcs::Comm],
    comm_table: &[pcs::Comm],
    comm_m: &pcs::Comm,
) -> (Fr, Fr) {
    // Fixed iteration order fixes each column's position, so one domain label per side suffices.
    for c in comm_query {
        tr.absorb_bytes(b"clk.q", &pcs::commitment_bytes(c));
    }
    for c in comm_table {
        tr.absorb_bytes(b"clk.t", &pcs::commitment_bytes(c));
    }
    tr.absorb_bytes(b"clk.m", &pcs::commitment_bytes(comm_m));
    (tr.challenge(b"clk.gamma"), tr.challenge(b"clk.beta"))
}

/// Prove that every query row is a table row, succinctly. `ck_q` sizes the query side (`log2(n)`
/// vars: query columns + `a`); `ck_t` sizes the table side (`log2(t)` vars: table columns, `m`, `b`).
pub fn prove_committed_lookup(
    query_cols: &[&[Fr]],
    table_cols: &[&[Fr]],
    ck_q: &pcs::Ck,
    ck_t: &pcs::Ck,
    tr: &mut Transcript,
) -> CommittedLookupProof {
    let n = query_cols[0].len();
    let t = table_cols[0].len();
    assert!(n.is_power_of_two() && t.is_power_of_two());
    for c in query_cols {
        assert_eq!(c.len(), n);
    }
    for c in table_cols {
        assert_eq!(c.len(), t);
    }

    let m = multiplicities(query_cols[0], table_cols[0]);

    let comm_query: Vec<pcs::Comm> = query_cols.iter().map(|c| pcs::commit(ck_q, c)).collect();
    let comm_table: Vec<pcs::Comm> = table_cols.iter().map(|c| pcs::commit(ck_t, c)).collect();
    let comm_m = pcs::commit(ck_t, &m);
    let (gamma, beta) = bind_committed(tr, &comm_query, &comm_table, &comm_m);

    let q = fold_columns(query_cols, gamma);
    let tau = fold_columns(table_cols, gamma);
    let a: Vec<Fr> = q.iter().map(|qi| (beta - qi).inverse().expect("β collides with a query fold (negligible)")).collect();
    let b: Vec<Fr> = tau
        .iter()
        .zip(m.iter())
        .map(|(ti, mj)| *mj * (beta - ti).inverse().expect("β collides with a table fold (negligible)"))
        .collect();

    let comm_a = pcs::commit(ck_q, &a);
    let comm_b = pcs::commit(ck_t, &b);
    tr.absorb_bytes(b"clk.a", &pcs::commitment_bytes(&comm_a));
    tr.absorb_bytes(b"clk.b", &pcs::commitment_bytes(&comm_b));

    // Grand sums: prove Σa = Σb = sum. Each single-factor sumcheck reduces the sum to one evaluation.
    let sum: Fr = a.iter().copied().sum();
    tr.absorb_field(b"clk.sum", &sum);
    let (sc_sum_a, cha, _fa) = prove_product_multi(vec![a.clone()], tr);
    let (sc_sum_b, chb, _fb) = prove_product_multi(vec![b.clone()], tr);

    // Query-side zero-check: Σ_x eq(r2,x)·a(x)·q(x) = β·â(r2) − 1.
    let sq = log2_exact(n);
    let r2: Vec<Fr> = (0..sq).map(|_| tr.challenge(b"clk.r2")).collect();
    let e2 = eq_weights(&r2);
    let (sc_q, ch2, _f2) = prove_product_multi(vec![e2, a.clone(), q.clone()], tr);

    // Table-side zero-check: Σ_x eq(r3,x)·b(x)·τ(x) = β·b̂(r3) − m̂(r3).
    let st = log2_exact(t);
    let r3: Vec<Fr> = (0..st).map(|_| tr.challenge(b"clk.r3")).collect();
    let e3 = eq_weights(&r3);
    let (sc_t, ch3, _f3) = prove_product_multi(vec![e3, b.clone(), tau.clone()], tr);

    CommittedLookupProof {
        sum,
        sc_sum_a,
        sc_sum_b,
        sc_q,
        sc_t,
        a_cha: pcs::open_at(ck_q, &a, &cha),
        b_chb: pcs::open_at(ck_t, &b, &chb),
        a_r2: pcs::open_at(ck_q, &a, &r2),
        a_ch2: pcs::open_at(ck_q, &a, &ch2),
        b_r3: pcs::open_at(ck_t, &b, &r3),
        b_ch3: pcs::open_at(ck_t, &b, &ch3),
        m_r3: pcs::open_at(ck_t, &m, &r3),
        query_ch2: query_cols.iter().map(|c| pcs::open_at(ck_q, c, &ch2)).collect(),
        table_ch3: table_cols.iter().map(|c| pcs::open_at(ck_t, c, &ch3)).collect(),
        comm_query,
        comm_table,
        comm_m,
        comm_a,
        comm_b,
    }
}

/// Succinctly verify a committed logup proof. `n`,`t` are the query/table lengths (powers of two).
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_lookup(
    n: usize,
    t: usize,
    proof: &CommittedLookupProof,
    vk_q: &pcs::Vk,
    vk_t: &pcs::Vk,
    tr: &mut Transcript,
) -> bool {
    if !n.is_power_of_two() || !t.is_power_of_two() {
        return false;
    }
    if proof.query_ch2.len() != proof.comm_query.len() || proof.table_ch3.len() != proof.comm_table.len() {
        return false;
    }

    let (gamma, beta) = bind_committed(tr, &proof.comm_query, &proof.comm_table, &proof.comm_m);
    tr.absorb_bytes(b"clk.a", &pcs::commitment_bytes(&proof.comm_a));
    tr.absorb_bytes(b"clk.b", &pcs::commitment_bytes(&proof.comm_b));

    // Grand sums: both must reduce the *same* claimed sum, and the reduced value must be the
    // committed a(cha) / b(chb). This is where Σa == Σb is enforced.
    tr.absorb_field(b"clk.sum", &proof.sum);
    let (cha, red_a) = match verify_product_multi(&proof.sc_sum_a, proof.sum, tr) {
        Some(v) => v,
        None => return false,
    };
    if proof.a_cha.value != red_a {
        return false;
    }
    let (chb, red_b) = match verify_product_multi(&proof.sc_sum_b, proof.sum, tr) {
        Some(v) => v,
        None => return false,
    };
    if proof.b_chb.value != red_b {
        return false;
    }

    // Query-side zero-check.
    let sq = log2_exact(n);
    let r2: Vec<Fr> = (0..sq).map(|_| tr.challenge(b"clk.r2")).collect();
    let claim_q = beta * proof.a_r2.value - Fr::one();
    let (ch2, red2) = match verify_product_multi(&proof.sc_q, claim_q, tr) {
        Some(v) => v,
        None => return false,
    };
    let q_ch2 = fold_values(&proof.query_ch2.iter().map(|o| o.value).collect::<Vec<_>>(), gamma);
    if red2 != eq_eval(&r2, &ch2) * proof.a_ch2.value * q_ch2 {
        return false;
    }

    // Table-side zero-check.
    let st = log2_exact(t);
    let r3: Vec<Fr> = (0..st).map(|_| tr.challenge(b"clk.r3")).collect();
    let claim_t = beta * proof.b_r3.value - proof.m_r3.value;
    let (ch3, red3) = match verify_product_multi(&proof.sc_t, claim_t, tr) {
        Some(v) => v,
        None => return false,
    };
    let tau_ch3 = fold_values(&proof.table_ch3.iter().map(|o| o.value).collect::<Vec<_>>(), gamma);
    if red3 != eq_eval(&r3, &ch3) * proof.b_ch3.value * tau_ch3 {
        return false;
    }

    // All claimed evaluations must be genuine openings of the committed tensors at the derived points.
    pcs::check_open(vk_q, &proof.comm_a, &cha, &proof.a_cha)
        && pcs::check_open(vk_q, &proof.comm_a, &r2, &proof.a_r2)
        && pcs::check_open(vk_q, &proof.comm_a, &ch2, &proof.a_ch2)
        && pcs::check_open(vk_t, &proof.comm_b, &chb, &proof.b_chb)
        && pcs::check_open(vk_t, &proof.comm_b, &r3, &proof.b_r3)
        && pcs::check_open(vk_t, &proof.comm_b, &ch3, &proof.b_ch3)
        && pcs::check_open(vk_t, &proof.comm_m, &r3, &proof.m_r3)
        && proof
            .comm_query
            .iter()
            .zip(proof.query_ch2.iter())
            .all(|(c, o)| pcs::check_open(vk_q, c, &ch2, o))
        && proof
            .comm_table
            .iter()
            .zip(proof.table_ch3.iter())
            .all(|(c, o)| pcs::check_open(vk_t, c, &ch3, o))
}
