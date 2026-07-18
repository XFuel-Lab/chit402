//! Tests for the public-linear RoPE gadget.

use xfuel_zkp::rope::{apply_rope, verify_rope};
use xfuel_zkp::Fr;

fn v(xs: &[u64]) -> Vec<Fr> {
    xs.iter().map(|&x| Fr::from(x)).collect()
}

#[test]
fn angle_zero_is_identity() {
    // cos = 1, sin = 0 ⇒ no rotation (fixed-point scale S = 1 here).
    let (seq, d_head) = (2, 4);
    let x = v(&[1, 2, 3, 4, 5, 6, 7, 8]);
    let cos = vec![Fr::from(1u64); seq * d_head / 2];
    let sin = vec![Fr::from(0u64); seq * d_head / 2];
    let out = apply_rope(&x, seq, d_head, &cos, &sin);
    assert_eq!(out, x, "identity rotation must be a no-op");
    assert!(verify_rope(&x, &out, seq, d_head, &cos, &sin));
}

#[test]
fn honest_rotation_recomputes_and_verifies() {
    // A concrete exact-integer rotation: cos=3, sin=4 (fixed-point codes; scale is downstream).
    let (seq, d_head) = (1, 2);
    let x = v(&[2, 5]);
    let cos = v(&[3]);
    let sin = v(&[4]);
    let out = apply_rope(&x, seq, d_head, &cos, &sin);
    // [2*3 - 5*4, 2*4 + 5*3] = [-14, 23]
    assert_eq!(out[0], Fr::from(2u64) * Fr::from(3u64) - Fr::from(5u64) * Fr::from(4u64));
    assert_eq!(out[1], Fr::from(2u64) * Fr::from(4u64) + Fr::from(5u64) * Fr::from(3u64));
    assert!(verify_rope(&x, &out, seq, d_head, &cos, &sin), "honest RoPE must verify");
}

#[test]
fn tampered_rotation_is_rejected() {
    let (seq, d_head) = (2, 4);
    let x = v(&[1, 2, 3, 4, 5, 6, 7, 8]);
    let cos = v(&[3, 5, 7, 9]);
    let sin = v(&[4, 6, 8, 10]);
    let mut out = apply_rope(&x, seq, d_head, &cos, &sin);
    out[3] += Fr::from(1u64);
    assert!(!verify_rope(&x, &out, seq, d_head, &cos, &sin), "tampered RoPE output must be rejected");
}

#[test]
fn wrong_public_coefficients_are_rejected() {
    let (seq, d_head) = (1, 2);
    let x = v(&[2, 5]);
    let out = apply_rope(&x, seq, d_head, &v(&[3]), &v(&[4]));
    // Verifying against different public cos/sin must fail (they bind the rotation).
    assert!(!verify_rope(&x, &out, seq, d_head, &v(&[3]), &v(&[5])));
}
