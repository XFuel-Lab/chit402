//! Soundness/completeness tests for the sumcheck matmul argument.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::matmul::{prove, verify, MatMul};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
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
