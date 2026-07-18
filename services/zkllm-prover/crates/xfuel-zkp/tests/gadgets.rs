//! Soundness/completeness tests for the Hadamard (elementwise-product) gadget.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::gadgets::{prove_hadamard, verify_hadamard};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

fn hadamard(a: &[Fr], b: &[Fr]) -> Vec<Fr> {
    a.iter().zip(b.iter()).map(|(x, y)| *x * *y).collect()
}

#[test]
fn honest_hadamard_verifies() {
    let mut rng = test_rng();
    for &len in &[1usize, 2, 4, 8, 16, 64] {
        let a = rand_vec(len, &mut rng);
        let b = rand_vec(len, &mut rng);
        let z = hadamard(&a, &b);
        let proof = prove_hadamard(&a, &b, &z, &mut Transcript::new(b"h"));
        assert!(
            verify_hadamard(&a, &b, &z, &proof, &mut Transcript::new(b"h")),
            "honest hadamard len={len} should verify"
        );
    }
}

#[test]
fn tampered_output_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let a = rand_vec(len, &mut rng);
    let b = rand_vec(len, &mut rng);
    let z = hadamard(&a, &b);
    let proof = prove_hadamard(&a, &b, &z, &mut Transcript::new(b"h"));

    let mut bad_z = z.clone();
    bad_z[5] += Fr::from(1u64);
    assert!(
        !verify_hadamard(&a, &b, &bad_z, &proof, &mut Transcript::new(b"h")),
        "tampered z must be rejected"
    );
}

#[test]
fn tampered_input_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let a = rand_vec(len, &mut rng);
    let b = rand_vec(len, &mut rng);
    let z = hadamard(&a, &b);
    let proof = prove_hadamard(&a, &b, &z, &mut Transcript::new(b"h"));

    let mut bad_a = a.clone();
    bad_a[2] += Fr::from(3u64);
    assert!(
        !verify_hadamard(&bad_a, &b, &z, &proof, &mut Transcript::new(b"h")),
        "tampered a must be rejected"
    );
}

#[test]
fn non_product_witness_is_rejected() {
    let mut rng = test_rng();
    let len = 8;
    let a = rand_vec(len, &mut rng);
    let b = rand_vec(len, &mut rng);
    // z is NOT a⊙b — prover cannot produce a passing proof.
    let z = rand_vec(len, &mut rng);
    let proof = prove_hadamard(&a, &b, &z, &mut Transcript::new(b"h"));
    assert!(
        !verify_hadamard(&a, &b, &z, &proof, &mut Transcript::new(b"h")),
        "z != a⊙b must be rejected"
    );
}
