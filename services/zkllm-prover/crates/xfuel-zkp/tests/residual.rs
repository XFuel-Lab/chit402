//! Soundness/completeness tests for the committed residual-add check `out = x + sub`.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::residual::{prove_committed_add, verify_committed_add};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

fn add(x: &[Fr], y: &[Fr]) -> Vec<Fr> {
    x.iter().zip(y.iter()).map(|(a, b)| *a + *b).collect()
}

fn keys(len: usize, rng: &mut impl Rng) -> (pcs::Ck, pcs::Vk) {
    let nv = log2_exact(len);
    let params = pcs::setup(nv, rng);
    pcs::keys(&params, nv)
}

#[test]
fn honest_residual_add_verifies() {
    let mut rng = test_rng();
    for &len in &[2usize, 4, 8, 16, 64] {
        let x = rand_vec(len, &mut rng);
        let sub = rand_vec(len, &mut rng);
        let out = add(&x, &sub);
        let (ck, vk) = keys(len, &mut rng);

        let (proof, cx, cs, co) =
            prove_committed_add(&x, &sub, &out, &ck, &mut Transcript::new(b"add"));
        // The verifier holds no tensors — only the three commitments.
        assert!(
            verify_committed_add(len, &cx, &cs, &co, &proof, &vk, &mut Transcript::new(b"add")),
            "honest residual add len={len} should verify from commitments alone"
        );
    }
}

#[test]
fn wrong_sum_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let x = rand_vec(len, &mut rng);
    let sub = rand_vec(len, &mut rng);
    // out is NOT x + sub: one entry off. At a random point the linear relation fails w.h.p.
    let mut out = add(&x, &sub);
    out[7] += Fr::from(1u64);
    let (ck, vk) = keys(len, &mut rng);

    let (proof, cx, cs, co) = prove_committed_add(&x, &sub, &out, &ck, &mut Transcript::new(b"add"));
    assert!(
        !verify_committed_add(len, &cx, &cs, &co, &proof, &vk, &mut Transcript::new(b"add")),
        "out != x + sub must be rejected"
    );
}

#[test]
fn tampered_opening_value_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let x = rand_vec(len, &mut rng);
    let sub = rand_vec(len, &mut rng);
    let out = add(&x, &sub);
    let (ck, vk) = keys(len, &mut rng);
    let (mut proof, cx, cs, co) =
        prove_committed_add(&x, &sub, &out, &ck, &mut Transcript::new(b"add"));

    // Forge out's claimed value: even if it were made to satisfy the relation, the PCS opening
    // (bound to the real out) no longer matches.
    proof.out.value += Fr::from(1u64);
    assert!(
        !verify_committed_add(len, &cx, &cs, &co, &proof, &vk, &mut Transcript::new(b"add")),
        "a forged opening value must be rejected"
    );
}

#[test]
fn wrong_commitment_is_rejected() {
    let mut rng = test_rng();
    let len = 16;
    let x = rand_vec(len, &mut rng);
    let sub = rand_vec(len, &mut rng);
    let out = add(&x, &sub);
    let (ck, vk) = keys(len, &mut rng);
    let (proof, cx, _cs, co) =
        prove_committed_add(&x, &sub, &out, &ck, &mut Transcript::new(b"add"));

    // A commitment to a different addend diverges the transcript (absorbed before ρ) and the opening.
    let bad_cs = pcs::commit(&ck, &rand_vec(len, &mut rng));
    assert!(
        !verify_committed_add(len, &cx, &bad_cs, &co, &proof, &vk, &mut Transcript::new(b"add")),
        "a mismatched addend commitment must be rejected"
    );
}
