//! Soundness/completeness tests for the Hadamard (elementwise-product) gadget.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::gadgets::{
    prove_committed_hadamard, prove_committed_hadamard_io, prove_hadamard,
    verify_committed_hadamard, verify_committed_hadamard_io, verify_hadamard,
};
use xfuel_zkp::matmul::{prove_committed_io, verify_committed_io, MatMul};
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

#[test]
fn committed_hadamard_io_verifies_without_any_tensor() {
    let mut rng = test_rng();
    for &len in &[2usize, 4, 8, 16, 64] {
        let a = rand_vec(len, &mut rng);
        let b = rand_vec(len, &mut rng);
        let z = hadamard(&a, &b);
        let params = pcs::setup(log2_exact(len), &mut rng);
        let (ck, vk) = pcs::keys(&params, log2_exact(len));

        let (proof, comm_a, comm_b, comm_z) =
            prove_committed_hadamard_io(&a, &b, &z, &ck, &mut Transcript::new(b"hio"));
        // The verifier holds NO tensors — not even z (the output is committed + opened).
        assert!(
            verify_committed_hadamard_io(
                len, &comm_a, &comm_b, &comm_z, &proof, &vk, &mut Transcript::new(b"hio")
            ),
            "honest I/O-committed hadamard len={len} should verify from commitments alone"
        );
    }
}

#[test]
fn committed_hadamard_io_tampered_output_commitment_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let a = rand_vec(len, &mut rng);
    let b = rand_vec(len, &mut rng);
    let z = hadamard(&a, &b);
    let params = pcs::setup(log2_exact(len), &mut rng);
    let (ck, vk) = pcs::keys(&params, log2_exact(len));
    let (proof, comm_a, comm_b, _comm_z) =
        prove_committed_hadamard_io(&a, &b, &z, &ck, &mut Transcript::new(b"hio"));

    // A commitment to a different output must fail (transcript diverges + z-opening mismatch).
    let bad_comm_z = pcs::commit(&ck, &rand_vec(len, &mut rng));
    assert!(
        !verify_committed_hadamard_io(
            len, &comm_a, &comm_b, &bad_comm_z, &proof, &vk, &mut Transcript::new(b"hio")
        ),
        "a mismatched output commitment must be rejected"
    );
}

#[test]
fn matmul_output_feeds_a_hadamard_operand_by_commitment_reuse() {
    // Cross-op-type composition: prove Y = A·B (matmul-io) then W = Y ⊙ G (hadamard-io), linking the
    // two by reusing Y's commitment as the Hadamard's operand commitment. The verifier holds NO
    // tensors and never materializes Y — exactly the seam a succinct block relies on. All tensors are
    // 4×4 (16 elems, 4 vars) so one trusted setup covers every commit.
    let mut rng = test_rng();
    let nv = log2_exact(16);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);

    let a = rand_vec(16, &mut rng);
    let b = rand_vec(16, &mut rng);
    let g = rand_vec(16, &mut rng);
    let mm = MatMul::new(4, 4, 4, a, b); // Y = mm.c
    let w = hadamard(&mm.c, &g); // W = Y ⊙ G

    let mut tp = Transcript::new(b"seam");
    let (p_mm, comm_a, comm_b, comm_y) = prove_committed_io(&mm, &ck, &ck, &ck, &mut tp);
    let (p_had, comm_y2, comm_g, comm_w) =
        prove_committed_hadamard_io(&mm.c, &g, &w, &ck, &mut tp);

    assert_eq!(
        pcs::commitment_bytes(&comm_y),
        pcs::commitment_bytes(&comm_y2),
        "the matmul output commitment must be reused as the hadamard operand commitment"
    );

    let mut tv = Transcript::new(b"seam");
    assert!(
        verify_committed_io(4, 4, 4, &comm_a, &comm_b, &comm_y, &p_mm, &vk, &vk, &vk, &mut tv),
        "matmul must verify from commitments"
    );
    assert!(
        verify_committed_hadamard_io(16, &comm_y, &comm_g, &comm_w, &p_had, &vk, &mut tv),
        "hadamard reusing the matmul output commitment must verify — no intermediate materialized"
    );
}
