//! Soundness/completeness tests for the logup lookup argument.

use ark_std::rand::Rng;
use ark_std::test_rng;
use xfuel_zkp::lookup::{
    prove_committed_lookup, prove_lookup, verify_committed_lookup, verify_lookup,
};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

/// Committer/verifier keys sized to the query side (`log2 n`) and table side (`log2 t`).
fn lookup_keys(
    n: usize,
    t: usize,
    rng: &mut impl Rng,
) -> ((pcs::Ck, pcs::Vk), (pcs::Ck, pcs::Vk)) {
    let (vn, vt) = (log2_exact(n), log2_exact(t));
    let pq = pcs::setup(vn, rng);
    let pt = pcs::setup(vt, rng);
    (pcs::keys(&pq, vn), pcs::keys(&pt, vt))
}

/// A 2-column table: input code j → out = f(j). Queries pick random rows of it.
fn table(t: usize) -> (Vec<Fr>, Vec<Fr>) {
    let tin: Vec<Fr> = (0..t).map(|j| Fr::from(j as u64)).collect();
    let tout: Vec<Fr> = (0..t).map(|j| Fr::from((j * j + 3) as u64)).collect();
    (tin, tout)
}

fn queries(n: usize, t: usize, tout: &[Fr], rng: &mut impl Rng) -> (Vec<Fr>, Vec<Fr>) {
    let mut qin = Vec::with_capacity(n);
    let mut qout = Vec::with_capacity(n);
    for _ in 0..n {
        let j = rng.gen_range(0..t);
        qin.push(Fr::from(j as u64));
        qout.push(tout[j]);
    }
    (qin, qout)
}

#[test]
fn honest_subset_verifies() {
    let mut rng = test_rng();
    for &(n, t) in &[(4usize, 4usize), (8, 4), (16, 8), (2, 2)] {
        let (tin, tout) = table(t);
        let (qin, qout) = queries(n, t, &tout, &mut rng);
        let proof = prove_lookup(&[&qin, &qout], &[&tin, &tout], &mut Transcript::new(b"lk"));
        assert!(
            verify_lookup(&[&qin, &qout], &[&tin, &tout], &proof, &mut Transcript::new(b"lk")),
            "honest subset n={n} t={t} should verify"
        );
    }
}

#[test]
fn wrong_output_is_rejected() {
    let mut rng = test_rng();
    let (n, t) = (8, 8);
    let (tin, tout) = table(t);
    let (qin, mut qout) = queries(n, t, &tout, &mut rng);
    // Corrupt one query output so (qin[2], qout[2]) is no longer a table row.
    qout[2] += Fr::from(1u64);
    let proof = prove_lookup(&[&qin, &qout], &[&tin, &tout], &mut Transcript::new(b"lk"));
    assert!(
        !verify_lookup(&[&qin, &qout], &[&tin, &tout], &proof, &mut Transcript::new(b"lk")),
        "a query row absent from the table must be rejected"
    );
}

#[test]
fn tampered_multiplicity_is_rejected() {
    let mut rng = test_rng();
    let (n, t) = (8, 8);
    let (tin, tout) = table(t);
    let (qin, qout) = queries(n, t, &tout, &mut rng);
    let mut proof = prove_lookup(&[&qin, &qout], &[&tin, &tout], &mut Transcript::new(b"lk"));
    // Forge a multiplicity: breaks the Σa = Σb logup identity and/or the table zero-check.
    proof.m[0] += Fr::from(1u64);
    assert!(
        !verify_lookup(&[&qin, &qout], &[&tin, &tout], &proof, &mut Transcript::new(b"lk")),
        "tampered multiplicity must be rejected"
    );
}

#[test]
fn tampered_inverse_advice_is_rejected() {
    let mut rng = test_rng();
    let (n, t) = (8, 8);
    let (tin, tout) = table(t);
    let (qin, qout) = queries(n, t, &tout, &mut rng);
    let mut proof = prove_lookup(&[&qin, &qout], &[&tin, &tout], &mut Transcript::new(b"lk"));
    // Forge inverse advice: the query zero-check a(β−q)=1 must fail.
    proof.a[1] += Fr::from(3u64);
    assert!(
        !verify_lookup(&[&qin, &qout], &[&tin, &tout], &proof, &mut Transcript::new(b"lk")),
        "tampered inverse advice must be rejected"
    );
}

#[test]
fn committed_subset_verifies_without_the_columns() {
    let mut rng = test_rng();
    for &(n, t) in &[(4usize, 4usize), (8, 4), (16, 8), (2, 2)] {
        let (tin, tout) = table(t);
        let (qin, qout) = queries(n, t, &tout, &mut rng);
        let ((ck_q, vk_q), (ck_t, vk_t)) = lookup_keys(n, t, &mut rng);

        let proof = prove_committed_lookup(
            &[&qin, &qout], &[&tin, &tout], &ck_q, &ck_t, &mut Transcript::new(b"lk"),
        );
        // The verifier is given only the commitments + openings — never the columns or advice.
        assert!(
            verify_committed_lookup(n, t, &proof, &vk_q, &vk_t, &mut Transcript::new(b"lk")),
            "honest committed subset n={n} t={t} should verify from commitments alone"
        );
    }
}

#[test]
fn committed_forged_sum_is_rejected() {
    let mut rng = test_rng();
    let (n, t) = (8, 8);
    let (tin, tout) = table(t);
    let (qin, qout) = queries(n, t, &tout, &mut rng);
    let ((ck_q, vk_q), (ck_t, vk_t)) = lookup_keys(n, t, &mut rng);
    let mut proof = prove_committed_lookup(
        &[&qin, &qout], &[&tin, &tout], &ck_q, &ck_t, &mut Transcript::new(b"lk"),
    );

    // Forge the claimed common sum: the Σa grand-sum sumcheck's first round no longer sums to it.
    proof.sum += Fr::from(1u64);
    assert!(
        !verify_committed_lookup(n, t, &proof, &vk_q, &vk_t, &mut Transcript::new(b"lk")),
        "a forged Σa = Σb sum must be rejected"
    );
}

#[test]
fn committed_forged_opening_value_is_rejected() {
    let mut rng = test_rng();
    let (n, t) = (8, 8);
    let (tin, tout) = table(t);
    let (qin, qout) = queries(n, t, &tout, &mut rng);
    let ((ck_q, vk_q), (ck_t, vk_t)) = lookup_keys(n, t, &mut rng);
    let mut proof = prove_committed_lookup(
        &[&qin, &qout], &[&tin, &tout], &ck_q, &ck_t, &mut Transcript::new(b"lk"),
    );

    // Forge a claimed evaluation: the PCS opening no longer matches the committed a.
    proof.a_ch2.value += Fr::from(1u64);
    assert!(
        !verify_committed_lookup(n, t, &proof, &vk_q, &vk_t, &mut Transcript::new(b"lk")),
        "a forged opening value must fail the commitment check"
    );
}

#[test]
fn committed_wrong_advice_commitment_is_rejected() {
    let mut rng = test_rng();
    let (n, t) = (8, 8);
    let (tin, tout) = table(t);
    let (qin, qout) = queries(n, t, &tout, &mut rng);
    let ((ck_q, vk_q), (ck_t, vk_t)) = lookup_keys(n, t, &mut rng);
    let mut proof = prove_committed_lookup(
        &[&qin, &qout], &[&tin, &tout], &ck_q, &ck_t, &mut Transcript::new(b"lk"),
    );

    // Replace the b-advice commitment with a commitment to different data: absorbed before the
    // challenges, so the whole transcript (and every derived point) diverges → reject.
    let bogus: Vec<Fr> = (0..t).map(|j| Fr::from((j + 7) as u64)).collect();
    proof.comm_b = pcs::commit(&ck_t, &bogus);
    assert!(
        !verify_committed_lookup(n, t, &proof, &vk_q, &vk_t, &mut Transcript::new(b"lk")),
        "a mismatched advice commitment must be rejected"
    );
}
