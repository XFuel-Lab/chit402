//! Tests for the inter-op requantization gadget (division-with-remainder + two range checks),
//! including the payoff: a requantized output re-enters an activation's code domain and its lookup
//! verifies under a shared transcript.

use xfuel_zkp::activation::{ActKind, ActivationTable};
use xfuel_zkp::range::RangeTable;
use xfuel_zkp::requant::{prove_requant, verify_requant};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn v(xs: &[u64]) -> Vec<Fr> {
    xs.iter().map(|&x| Fr::from(x)).collect()
}

// acc = q*4 + r  with q ∈ [0,16), r ∈ [0,4):
//   q = [3, 0,15, 7, 8, 1,15, 2], r = [1,0,3,2,0,1,3,0]
const DIVISOR: usize = 4;
const Q_BOUND: usize = 16;
fn acc_col() -> Vec<Fr> {
    v(&[13, 0, 63, 30, 32, 5, 63, 8])
}
fn expected_q() -> Vec<Fr> {
    v(&[3, 0, 15, 7, 8, 1, 15, 2])
}

#[test]
fn honest_requant_verifies() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (proof, q) = prove_requant(&acc, DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    assert_eq!(q, expected_q(), "quotient must be ⌊acc/D⌋");
    assert!(
        verify_requant(&acc, &q, DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "honest requant must verify"
    );
}

#[test]
fn tampered_quotient_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (proof, mut q) = prove_requant(&acc, DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    q[0] += Fr::from(1u64); // breaks acc = q·D + r
    assert!(
        !verify_requant(&acc, &q, DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "tampered quotient must be rejected"
    );
}

#[test]
fn tampered_remainder_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (mut proof, q) = prove_requant(&acc, DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    proof.r[1] += Fr::from(1u64); // breaks the division identity
    assert!(
        !verify_requant(&acc, &q, DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "tampered remainder must be rejected"
    );
}

#[test]
fn out_of_range_decomposition_is_rejected() {
    // Malicious downgrade: keep the identity acc = q·D + r but push the remainder out of [0,D)
    // (q[0]: 3→2, r[0]: 1→5, since 2·4+5 = 13). The division identity still holds, but the
    // remainder range-check no longer matches its proof ⇒ rejected. This is what makes the
    // Euclidean decomposition unique.
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (mut proof, mut q) = prove_requant(&acc, DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    q[0] = Fr::from(2u64);
    proof.r[0] = Fr::from(5u64);
    assert_eq!(acc[0], q[0] * Fr::from(DIVISOR as u64) + proof.r[0], "identity still holds");
    assert!(
        !verify_requant(&acc, &q, DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "an out-of-range remainder must be caught by the range check"
    );
}

#[test]
fn wrong_divisor_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (proof, q) = prove_requant(&acc, DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    let wrong_r = RangeTable::new(8);
    assert!(
        !verify_requant(&acc, &q, 8, &wrong_r, &q_table, &proof, &mut Transcript::new(b"rq")),
        "verifying with the wrong divisor must fail"
    );
}

#[test]
fn requant_output_feeds_activation_lookup() {
    // End-to-end hop: a wide accumulator is requantized into [0,16) and that quotient is used
    // directly as the input code of a quantized SiLU activation lookup — both proven under one
    // transcript. This is the "output re-enters the next op's code domain" closure (M5.3).
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let act = ActivationTable::new(ActKind::Silu, Q_BOUND, 0.5);
    let acc = acc_col();

    let mut tr_p = Transcript::new(b"chain");
    let (rq_proof, q) = prove_requant(&acc, DIVISOR, &r_table, &q_table, &mut tr_p);
    let out = act.apply(&q);
    let act_proof = act.prove(&q, &out, &mut tr_p);

    let mut tr_v = Transcript::new(b"chain");
    assert!(
        verify_requant(&acc, &q, DIVISOR, &r_table, &q_table, &rq_proof, &mut tr_v),
        "requant hop must verify"
    );
    assert!(
        act.verify(&q, &out, &act_proof, &mut tr_v),
        "activation on the requantized codes must verify under the shared transcript"
    );
}
