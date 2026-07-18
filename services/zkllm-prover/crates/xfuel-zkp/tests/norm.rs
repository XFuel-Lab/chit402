//! Soundness/completeness tests for the RMSNorm gadget (Hadamard chain + rsqrt lookup).

use ark_ff::PrimeField;
use xfuel_zkp::norm::{prove_rmsnorm, verify_rmsnorm, RsqrtTable};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

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
