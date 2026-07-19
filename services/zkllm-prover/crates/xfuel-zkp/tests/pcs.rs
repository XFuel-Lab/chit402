//! Tests for the multilinear-KZG polynomial commitment (M5.4 succinctness binding).
//!
//! The load-bearing test is [`opening_matches_our_mle_convention`]: it pins that a PCS opening
//! reproduces exactly `mle::mle_eval(table, point)` under our MSB-first point ordering. If the
//! ark-poly (LSB-first) bridge in `pcs::ark_point` ever regressed, matmul's committed binding would
//! silently check the wrong evaluation — so we assert the two agree at random points.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::mle::mle_eval;
use xfuel_zkp::{pcs, Fr};

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

fn rand_point(vars: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..vars).map(|_| Fr::rand(rng)).collect()
}

#[test]
fn opening_matches_our_mle_convention() {
    let mut rng = test_rng();
    // Cover several sizes; the reversal bug only shows up for num_vars >= 2 with distinct bits.
    for num_vars in 1..=6usize {
        let params = pcs::setup(num_vars, &mut rng);
        let (ck, vk) = pcs::keys(&params, num_vars);
        let table = rand_vec(1usize << num_vars, &mut rng);
        let comm = pcs::commit(&ck, &table);

        for _ in 0..4 {
            let point = rand_point(num_vars, &mut rng);
            let expected = mle_eval(&table, &point);
            let proof = pcs::open(&ck, &table, &point);
            assert!(
                pcs::verify(&vk, &comm, &point, expected, &proof),
                "PCS opening must verify against our mle_eval value (num_vars={num_vars})"
            );
        }
    }
}

#[test]
fn round_trip_verifies() {
    let mut rng = test_rng();
    let num_vars = 5;
    let params = pcs::setup(num_vars, &mut rng);
    let (ck, vk) = pcs::keys(&params, num_vars);
    let table = rand_vec(1usize << num_vars, &mut rng);
    let comm = pcs::commit(&ck, &table);
    let point = rand_point(num_vars, &mut rng);
    let value = mle_eval(&table, &point);
    let proof = pcs::open(&ck, &table, &point);
    assert!(pcs::verify(&vk, &comm, &point, value, &proof));
}

#[test]
fn wrong_value_is_rejected() {
    let mut rng = test_rng();
    let num_vars = 4;
    let params = pcs::setup(num_vars, &mut rng);
    let (ck, vk) = pcs::keys(&params, num_vars);
    let table = rand_vec(1usize << num_vars, &mut rng);
    let comm = pcs::commit(&ck, &table);
    let point = rand_point(num_vars, &mut rng);
    let value = mle_eval(&table, &point);
    let proof = pcs::open(&ck, &table, &point);
    assert!(
        !pcs::verify(&vk, &comm, &point, value + Fr::from(1u64), &proof),
        "a claimed value that isn't the true evaluation must be rejected"
    );
}

#[test]
fn wrong_point_is_rejected() {
    let mut rng = test_rng();
    let num_vars = 4;
    let params = pcs::setup(num_vars, &mut rng);
    let (ck, vk) = pcs::keys(&params, num_vars);
    let table = rand_vec(1usize << num_vars, &mut rng);
    let comm = pcs::commit(&ck, &table);
    let point = rand_point(num_vars, &mut rng);
    let value = mle_eval(&table, &point);
    let proof = pcs::open(&ck, &table, &point);
    // Verify the same (value, proof) at a different point: overwhelmingly not the evaluation there.
    let mut other = point.clone();
    other[0] += Fr::from(1u64);
    assert!(
        !pcs::verify(&vk, &comm, &other, value, &proof),
        "an opening is bound to its query point"
    );
}

#[test]
fn tampered_commitment_is_rejected() {
    let mut rng = test_rng();
    let num_vars = 4;
    let params = pcs::setup(num_vars, &mut rng);
    let (ck, vk) = pcs::keys(&params, num_vars);
    let table = rand_vec(1usize << num_vars, &mut rng);
    let point = rand_point(num_vars, &mut rng);
    let value = mle_eval(&table, &point);
    let proof = pcs::open(&ck, &table, &point);

    // Commit to a *different* tensor; the honest opening/value must not verify against it.
    let other_table = rand_vec(1usize << num_vars, &mut rng);
    let other_comm = pcs::commit(&ck, &other_table);
    assert!(
        !pcs::verify(&vk, &other_comm, &point, value, &proof),
        "an opening is bound to the committed tensor"
    );
}
