//! Soundness/completeness tests for the RMSNorm gadget (Hadamard chain + rsqrt lookup).

use ark_ff::PrimeField;
use ark_std::test_rng;
use xfuel_zkp::norm::{
    prove_committed_rmsnorm, prove_rmsnorm, verify_committed_rmsnorm, verify_rmsnorm, RsqrtTable,
};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

/// Decode a small non-negative field code to a `u64` (test-only).
fn to_u64(f: &Fr) -> u64 {
    f.into_bigint().as_ref()[0]
}

/// Small non-negative integer inputs so every `ss = Σ x²` stays inside the table domain.
fn fixture(seq: usize, d: usize) -> (Vec<Fr>, Vec<Fr>) {
    let x: Vec<Fr> = (0..seq * d).map(|i| Fr::from((i % 3) as u64)).collect();
    let w: Vec<Fr> = (0..d).map(|j| Fr::from((1 + j % 2) as u64)).collect();
    (x, w)
}

#[test]
fn rsqrt_table_is_deterministic_and_shaped() {
    let a = RsqrtTable::new(64, 4.0, 1.0);
    let b = RsqrtTable::new(64, 4.0, 1.0);
    assert_eq!(a.in_codes, b.in_codes);
    assert_eq!(a.out_codes, b.out_codes);
    assert_eq!(a.in_codes.len(), 64);
    // inv_rms decreases as ss grows: out_codes is non-increasing.
    for s in 1..64 {
        assert!(
            to_u64(&a.out_codes[s]) <= to_u64(&a.out_codes[s - 1]),
            "rsqrt table must be non-increasing at s={s}"
        );
    }
}

#[test]
fn honest_rmsnorm_verifies() {
    for &(seq, d) in &[(2usize, 4usize), (4, 8), (1, 4), (2, 2)] {
        let table = RsqrtTable::new(64, 4.0, 1.0);
        let (x, w) = fixture(seq, d);
        let (proof, y) = prove_rmsnorm(&x, &w, seq, d, &table, &mut Transcript::new(b"norm"));
        assert!(
            verify_rmsnorm(&x, &w, seq, d, &y, &proof, &table, &mut Transcript::new(b"norm")),
            "honest RMSNorm seq={seq} d={d} should verify"
        );
    }
}

#[test]
fn tampered_output_is_rejected() {
    let table = RsqrtTable::new(64, 4.0, 1.0);
    let (x, w) = fixture(4, 8);
    let (proof, mut y) = prove_rmsnorm(&x, &w, 4, 8, &table, &mut Transcript::new(b"norm"));
    y[5] += Fr::from(1u64);
    assert!(
        !verify_rmsnorm(&x, &w, 4, 8, &y, &proof, &table, &mut Transcript::new(b"norm")),
        "tampered RMSNorm output must be rejected"
    );
}

#[test]
fn tampered_inv_rms_is_rejected() {
    let table = RsqrtTable::new(64, 4.0, 1.0);
    let (x, w) = fixture(4, 8);
    let (mut proof, y) = prove_rmsnorm(&x, &w, 4, 8, &table, &mut Transcript::new(b"norm"));
    // Forge inv_rms: no longer the rsqrt of ss, and no longer consistent with t = x ⊙ inv_rms.
    proof.inv_rms[1] += Fr::from(2u64);
    assert!(
        !verify_rmsnorm(&x, &w, 4, 8, &y, &proof, &table, &mut Transcript::new(b"norm")),
        "tampered inv_rms must be rejected"
    );
}

#[test]
fn wrong_rsqrt_relation_is_rejected() {
    // Prove against one table, verify against a different canonical table: the lookup must reject
    // (the model's inv_rms is not a row of the verifier's table).
    let table_prove = RsqrtTable::new(64, 4.0, 1.0);
    let table_verify = RsqrtTable::new(64, 8.0, 1.0);
    let (x, w) = fixture(4, 8);
    let (proof, y) = prove_rmsnorm(&x, &w, 4, 8, &table_prove, &mut Transcript::new(b"norm"));
    assert!(
        !verify_rmsnorm(&x, &w, 4, 8, &y, &proof, &table_verify, &mut Transcript::new(b"norm")),
        "an inv_rms from a different rsqrt table must be rejected"
    );
}

#[test]
fn tampered_sum_of_squares_is_rejected() {
    let table = RsqrtTable::new(64, 4.0, 1.0);
    let (x, w) = fixture(4, 8);
    let (mut proof, y) = prove_rmsnorm(&x, &w, 4, 8, &table, &mut Transcript::new(b"norm"));
    // Break the row-sum-of-squares relation (ss must equal Σ_j xsq[r,j]).
    proof.ss[0] += Fr::from(1u64);
    assert!(
        !verify_rmsnorm(&x, &w, 4, 8, &y, &proof, &table, &mut Transcript::new(b"norm")),
        "tampered sum-of-squares must be rejected"
    );
}

// ─── Committed (succinct) RMSNorm ─────────────────────────────────────────────

type NormKeys = (pcs::Ck, pcs::Vk, pcs::Ck, pcs::Vk, pcs::Ck, pcs::Vk);

/// Trusted-setup keys for the three widths (`seq·d` tensors, length-`seq` columns, table domain),
/// all trimmed from one SRS sized to the largest.
fn committed_keys(seq: usize, d: usize, domain: usize, rng: &mut impl ark_std::rand::Rng) -> NormKeys {
    let (nv_wide, nv_narrow, nv_table) = (log2_exact(seq * d), log2_exact(seq), log2_exact(domain));
    let max = nv_wide.max(nv_narrow).max(nv_table);
    let params = pcs::setup(max, rng);
    let (ck_w, vk_w) = pcs::keys(&params, nv_wide);
    let (ck_n, vk_n) = pcs::keys(&params, nv_narrow);
    let (ck_t, vk_t) = pcs::keys(&params, nv_table);
    (ck_w, vk_w, ck_n, vk_n, ck_t, vk_t)
}

#[test]
fn committed_rmsnorm_verifies_without_the_tensors() {
    let mut rng = test_rng();
    let domain = 64;
    for &(seq, d) in &[(2usize, 4usize), (4, 8), (2, 2), (4, 4)] {
        let table = RsqrtTable::new(domain, 4.0, 1.0);
        let (x, w) = fixture(seq, d);
        let (ck_w, vk_w, ck_n, vk_n, ck_t, vk_t) = committed_keys(seq, d, domain, &mut rng);

        let (proof, comm_x, comm_y, _y) = prove_committed_rmsnorm(
            &x, &w, seq, d, &table, &ck_w, &ck_n, &ck_t, &mut Transcript::new(b"cn"),
        );
        // The verifier holds no activation tensors — only comm_x, comm_y and the public w.
        assert!(
            verify_committed_rmsnorm(
                &w, seq, d, &table, &comm_x, &comm_y, &proof, &ck_t, &vk_w, &vk_n, &vk_t,
                &mut Transcript::new(b"cn"),
            ),
            "honest committed RMSNorm seq={seq} d={d} should verify from commitments alone"
        );
    }
}

#[test]
fn committed_rmsnorm_wrong_output_commitment_is_rejected() {
    let mut rng = test_rng();
    let (seq, d, domain) = (4usize, 8usize, 64usize);
    let table = RsqrtTable::new(domain, 4.0, 1.0);
    let (x, w) = fixture(seq, d);
    let (ck_w, vk_w, ck_n, vk_n, ck_t, vk_t) = committed_keys(seq, d, domain, &mut rng);
    let (proof, comm_x, _comm_y, _y) = prove_committed_rmsnorm(
        &x, &w, seq, d, &table, &ck_w, &ck_n, &ck_t, &mut Transcript::new(b"cn"),
    );

    // A commitment to a different output diverges the scaling transcript + opening.
    let bad_y: Vec<Fr> = (0..seq * d).map(|i| Fr::from((i + 1) as u64)).collect();
    let bad_comm_y = pcs::commit(&ck_w, &bad_y);
    assert!(
        !verify_committed_rmsnorm(
            &w, seq, d, &table, &comm_x, &bad_comm_y, &proof, &ck_t, &vk_w, &vk_n, &vk_t,
            &mut Transcript::new(b"cn"),
        ),
        "a mismatched output commitment must be rejected"
    );
}

#[test]
fn committed_rmsnorm_forged_table_is_rejected() {
    // Prove against one rsqrt table; verify against a different one. The table-tie (lookup's committed
    // table columns must equal the verifier's canonical table) must reject — otherwise a prover could
    // "look up" inv_rms against a table of their choosing.
    let mut rng = test_rng();
    let (seq, d, domain) = (4usize, 8usize, 64usize);
    let table_prove = RsqrtTable::new(domain, 4.0, 1.0);
    let table_verify = RsqrtTable::new(domain, 8.0, 1.0);
    let (x, w) = fixture(seq, d);
    let (ck_w, vk_w, ck_n, vk_n, ck_t, vk_t) = committed_keys(seq, d, domain, &mut rng);
    let (proof, comm_x, comm_y, _y) = prove_committed_rmsnorm(
        &x, &w, seq, d, &table_prove, &ck_w, &ck_n, &ck_t, &mut Transcript::new(b"cn"),
    );

    assert!(
        !verify_committed_rmsnorm(
            &w, seq, d, &table_verify, &comm_x, &comm_y, &proof, &ck_t, &vk_w, &vk_n, &vk_t,
            &mut Transcript::new(b"cn"),
        ),
        "an inv_rms proven against a different rsqrt table must be rejected by the table-tie"
    );
}

#[test]
fn committed_rmsnorm_forged_scaling_opening_is_rejected() {
    let mut rng = test_rng();
    let (seq, d, domain) = (4usize, 8usize, 64usize);
    let table = RsqrtTable::new(domain, 4.0, 1.0);
    let (x, w) = fixture(seq, d);
    let (ck_w, vk_w, ck_n, vk_n, ck_t, vk_t) = committed_keys(seq, d, domain, &mut rng);
    let (mut proof, comm_x, comm_y, _y) = prove_committed_rmsnorm(
        &x, &w, seq, d, &table, &ck_w, &ck_n, &ck_t, &mut Transcript::new(b"cn"),
    );

    // Forge the reduced x(ch): the scaling product check or its PCS opening no longer matches.
    proof.x_final += Fr::from(1u64);
    assert!(
        !verify_committed_rmsnorm(
            &w, seq, d, &table, &comm_x, &comm_y, &proof, &ck_t, &vk_w, &vk_n, &vk_t,
            &mut Transcript::new(b"cn"),
        ),
        "a forged scaling opening must be rejected"
    );
}
