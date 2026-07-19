//! Soundness/completeness tests for the sumcheck matmul argument.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::matmul::{commit, prove, prove_committed, verify, verify_committed, MatMul};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

/// Build committer/verifier keys sized to `A` (`log2(m·k)` vars) and `B` (`log2(k·n)` vars).
fn matmul_keys(
    m: usize,
    k: usize,
    n: usize,
    rng: &mut impl Rng,
) -> ((pcs::Ck, pcs::Vk), (pcs::Ck, pcs::Vk)) {
    let va = log2_exact(m * k);
    let vb = log2_exact(k * n);
    let pa = pcs::setup(va, rng);
    let pb = pcs::setup(vb, rng);
    (pcs::keys(&pa, va), pcs::keys(&pb, vb))
}

#[test]
fn honest_proof_verifies() {
    let mut rng = test_rng();
    for &(m, k, n) in &[(1usize, 2usize, 1usize), (4, 8, 2), (8, 8, 8), (2, 16, 4)] {
        let a = rand_vec(m * k, &mut rng);
        let b = rand_vec(k * n, &mut rng);
        let mm = MatMul::new(m, k, n, a.clone(), b.clone());
        let proof = prove(&mm, &mut Transcript::new(b"t"));
        assert!(
            verify(m, k, n, &a, &b, &mm.c, &proof, &mut Transcript::new(b"t")),
            "honest {m}x{k}*{k}x{n} should verify"
        );
    }
}

#[test]
fn tampered_output_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let proof = prove(&mm, &mut Transcript::new(b"t"));

    // Flip one entry of C: the claim recomputed from the tampered C won't match.
    let mut bad_c = mm.c.clone();
    bad_c[0] += Fr::from(1u64);
    assert!(
        !verify(m, k, n, &a, &b, &bad_c, &proof, &mut Transcript::new(b"t")),
        "tampered C must be rejected"
    );
}

#[test]
fn tampered_weights_are_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let proof = prove(&mm, &mut Transcript::new(b"t"));

    // Verify against tampered A (final MLE binding f(r)=Â(rx,r) fails).
    let mut bad_a = a.clone();
    bad_a[3] += Fr::from(7u64);
    assert!(
        !verify(m, k, n, &bad_a, &b, &mm.c, &proof, &mut Transcript::new(b"t")),
        "tampered A must be rejected"
    );
}

#[test]
fn forged_final_evaluation_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let mut proof = prove(&mm, &mut Transcript::new(b"t"));

    // Forge the claimed final f(r): breaks reduced == f_final*g_final and the MLE binding.
    proof.f_final += Fr::from(1u64);
    assert!(
        !verify(m, k, n, &a, &b, &mm.c, &proof, &mut Transcript::new(b"t")),
        "forged f_final must be rejected"
    );
}

#[test]
fn committed_proof_verifies_without_the_tensors() {
    let mut rng = test_rng();
    // Include a rectangular case so A (log2 m·k) and B (log2 k·n) have different MLE widths.
    for &(m, k, n) in &[(1usize, 2usize, 1usize), (4, 8, 2), (8, 8, 8), (2, 16, 4)] {
        let a = rand_vec(m * k, &mut rng);
        let b = rand_vec(k * n, &mut rng);
        let mm = MatMul::new(m, k, n, a, b);
        let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
        let (comm_a, comm_b) = commit(&mm, &ck_a, &ck_b);

        let proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));
        // The verifier is given only C and the commitments — never A or B.
        assert!(
            verify_committed(
                m, k, n, &comm_a, &comm_b, &mm.c, &proof, &vk_a, &vk_b,
                &mut Transcript::new(b"t")
            ),
            "honest committed {m}x{k}*{k}x{n} should verify from commitments alone"
        );
    }
}

#[test]
fn committed_wrong_weight_commitment_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a, b);
    let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
    let (comm_a, _comm_b) = commit(&mm, &ck_a, &ck_b);
    let proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));

    // A commitment to *different* weights (the PoMA anchor is B) must fail the opening check.
    let other_b = rand_vec(k * n, &mut rng);
    let bad_comm_b = pcs::commit(&ck_b, &other_b);
    assert!(
        !verify_committed(
            m, k, n, &comm_a, &bad_comm_b, &mm.c, &proof, &vk_a, &vk_b,
            &mut Transcript::new(b"t")
        ),
        "an opening bound to a different weight commitment must be rejected"
    );
}

#[test]
fn committed_forged_final_evaluation_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a, b);
    let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
    let (comm_a, comm_b) = commit(&mm, &ck_a, &ck_b);
    let mut proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));

    // Forge f_final: the PCS opening no longer matches the claimed evaluation.
    proof.inner.f_final += Fr::from(1u64);
    assert!(
        !verify_committed(
            m, k, n, &comm_a, &comm_b, &mm.c, &proof, &vk_a, &vk_b,
            &mut Transcript::new(b"t")
        ),
        "forged f_final must fail the commitment opening"
    );
}
