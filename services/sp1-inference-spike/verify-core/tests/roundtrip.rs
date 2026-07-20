//! Windows-checkable proof that the host↔guest serialization round-trips and the multilinear-KZG
//! opening verifies (and rejects tampering) — the substantive logic the SP1 guest will run, minus
//! the zkVM. If these pass on any host, the only remaining unknown for the spike is whether
//! `ark-poly-commit` + BN254 pairings compile + prove inside the SP1 zkVM (the Linux/Docker step).

use ark_std::{test_rng, UniformRand};
use xfuel_inference_spike_core::{encode_opening, verify_opening};
use xfuel_zkp::{log2_exact, pcs, Fr};

fn setup(n: usize) -> (pcs::Ck, pcs::Vk) {
    let mut rng = test_rng();
    let nv = log2_exact(n);
    let params = pcs::setup(nv, &mut rng);
    pcs::keys(&params, nv)
}

#[test]
fn single_opening_roundtrips_through_serialization_and_verifies() {
    let mut rng = test_rng();
    let n = 16usize;
    let (ck, vk) = setup(n);
    let table: Vec<Fr> = (0..n).map(|_| Fr::rand(&mut rng)).collect();
    let comm = pcs::commit(&ck, &table);
    let point: Vec<Fr> = (0..log2_exact(n)).map(|_| Fr::rand(&mut rng)).collect();
    let opening = pcs::open_at(&ck, &table, &point);

    let w = encode_opening(&vk, &comm, &point, opening.value, &opening.proof);
    let bundle = verify_opening(&w);

    assert!(bundle.verified, "the KZG opening must verify after (de)serialization");
    assert_ne!(bundle.digest, [0u8; 32]);
}

#[test]
fn tampered_value_is_rejected() {
    let mut rng = test_rng();
    let n = 16usize;
    let (ck, vk) = setup(n);
    let table: Vec<Fr> = (0..n).map(|_| Fr::rand(&mut rng)).collect();
    let comm = pcs::commit(&ck, &table);
    let point: Vec<Fr> = (0..log2_exact(n)).map(|_| Fr::rand(&mut rng)).collect();
    let opening = pcs::open_at(&ck, &table, &point);

    let bad_value = opening.value + Fr::from(1u64);
    let w = encode_opening(&vk, &comm, &point, bad_value, &opening.proof);
    let bundle = verify_opening(&w);

    assert!(!bundle.verified, "a wrong evaluation must be rejected by the pairing check");
}
