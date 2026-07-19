//! Soundness/completeness tests for the Hadamard (elementwise-product) gadget.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::gadgets::{
    prove_committed_hadamard, prove_hadamard, verify_committed_hadamard, verify_hadamard,
};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

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

#[test]
fn committed_hadamard_verifies_without_the_operands() {
    let mut rng = test_rng();
    // len >= 2: multilinear KZG needs >= 1 variable (a 1-element operand has a 0-var MLE). Real
    // transformer operands are never single-element.
    for &len in &[2usize, 4, 8, 16, 64] {
        let a = rand_vec(len, &mut rng);
        let b = rand_vec(len, &mut rng);
        let z = hadamard(&a, &b);
        let params = pcs::setup(log2_exact(len), &mut rng);
        let (ck, vk) = pcs::keys(&params, log2_exact(len));

        let proof = prove_committed_hadamard(&a, &b, &z, &ck, &mut Transcript::new(b"h"));
        let comm_a = pcs::commit(&ck, &a);
        let comm_b = pcs::commit(&ck, &b);
        // The verifier holds only z + the commitments — never a or b.
        assert!(
            verify_committed_hadamard(&z, &comm_a, &comm_b, &proof, &vk, &mut Transcript::new(b"h")),
            "honest committed hadamard len={len} should verify from commitments alone"
        );
    }
}

#[test]
fn committed_hadamard_wrong_commitment_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let a = rand_vec(len, &mut rng);
    let b = rand_vec(len, &mut rng);
    let z = hadamard(&a, &b);
    let params = pcs::setup(log2_exact(len), &mut rng);
    let (ck, vk) = pcs::keys(&params, log2_exact(len));
    let proof = prove_committed_hadamard(&a, &b, &z, &ck, &mut Transcript::new(b"h"));
    let comm_a = pcs::commit(&ck, &a);

    // A commitment to a different operand must fail: it changes the transcript (so r mismatches)
    // and the opening no longer matches.
    let other_b = rand_vec(len, &mut rng);
    let bad_comm_b = pcs::commit(&ck, &other_b);
    assert!(
        !verify_committed_hadamard(&z, &comm_a, &bad_comm_b, &proof, &vk, &mut Transcript::new(b"h")),
        "a mismatched operand commitment must be rejected"
    );
}

#[test]
fn committed_hadamard_forged_final_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let a = rand_vec(len, &mut rng);
    let b = rand_vec(len, &mut rng);
    let z = hadamard(&a, &b);
    let params = pcs::setup(log2_exact(len), &mut rng);
    let (ck, vk) = pcs::keys(&params, log2_exact(len));
    let mut proof = prove_committed_hadamard(&a, &b, &z, &ck, &mut Transcript::new(b"h"));
    let comm_a = pcs::commit(&ck, &a);
    let comm_b = pcs::commit(&ck, &b);

    // Forge a_final: the PCS opening no longer matches the claimed evaluation.
    proof.inner.a_final += Fr::from(1u64);
    assert!(
        !verify_committed_hadamard(&z, &comm_a, &comm_b, &proof, &vk, &mut Transcript::new(b"h")),
        "forged a_final must fail the commitment opening"
    );
}
