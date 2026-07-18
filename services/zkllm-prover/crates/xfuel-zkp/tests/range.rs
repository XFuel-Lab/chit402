//! Tests for the range-check gadget (membership lookup into `[0, bound)`).

use xfuel_zkp::range::RangeTable;
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn v(xs: &[u64]) -> Vec<Fr> {
    xs.iter().map(|&x| Fr::from(x)).collect()
}

#[test]
fn honest_in_range_verifies() {
    let table = RangeTable::new(16);
    let xs = v(&[0, 15, 7, 3, 15, 0, 8, 1]);
    let proof = table.prove(&xs, &mut Transcript::new(b"range"));
    assert!(
        table.verify(&xs, &proof, &mut Transcript::new(b"range")),
        "in-range column must verify"
    );
}

#[test]
fn tampered_value_out_of_range_is_rejected() {
    let table = RangeTable::new(16);
    let xs = v(&[0, 15, 7, 3, 15, 0, 8, 1]);
    let proof = table.prove(&xs, &mut Transcript::new(b"range"));
    // Push one entry to the boundary value `bound` (just outside [0,16)).
    let mut bad = xs.clone();
    bad[2] = Fr::from(16u64);
    assert!(
        !table.verify(&bad, &proof, &mut Transcript::new(b"range")),
        "an out-of-range value must be rejected"
    );
}

#[test]
fn tampered_in_range_value_is_rejected() {
    // Even swapping to a *different but still in-range* value must fail: the proof binds the
    // exact column, not just membership.
    let table = RangeTable::new(16);
    let xs = v(&[0, 15, 7, 3, 15, 0, 8, 1]);
    let proof = table.prove(&xs, &mut Transcript::new(b"range"));
    let mut bad = xs.clone();
    bad[0] = Fr::from(9u64);
    assert!(
        !table.verify(&bad, &proof, &mut Transcript::new(b"range")),
        "changing a bound value must break the proof"
    );
}

#[test]
fn wrong_bound_is_rejected() {
    // A proof built for [0,16) must not verify against a [0,8) table (different table columns ⇒
    // different transcript + multiplicities).
    let xs = v(&[0, 15, 7, 3, 15, 0, 8, 1]);
    let proof = RangeTable::new(16).prove(&xs, &mut Transcript::new(b"range"));
    let smaller = RangeTable::new(8);
    assert!(
        !smaller.verify(&xs, &proof, &mut Transcript::new(b"range")),
        "verifying against a different bound must fail"
    );
}
