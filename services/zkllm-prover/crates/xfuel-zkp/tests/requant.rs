//! Tests for the inter-op requantization gadget (division-with-remainder + two range checks),
//! including the payoff: a requantized output re-enters an activation's code domain and its lookup
//! verifies under a shared transcript.

use ark_std::test_rng;
use xfuel_zkp::activation::{ActKind, ActivationTable};
use xfuel_zkp::range::RangeTable;
use xfuel_zkp::requant::{
    prove_committed_requant, prove_requant, verify_committed_requant, verify_requant,
};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

fn v(xs: &[u64]) -> Vec<Fr> {
    xs.iter().map(|&x| Fr::from(x)).collect()
}

fn zero() -> Fr {
    Fr::from(0u64)
}

/// Encode a signed integer as a field element (negatives wrap to `p - |x|`).
fn signed(x: i64) -> Fr {
    if x >= 0 {
        Fr::from(x as u64)
    } else {
        -Fr::from((-x) as u64)
    }
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
    let (proof, q) = prove_requant(&acc, zero(), DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    assert_eq!(q, expected_q(), "quotient must be ⌊acc/D⌋");
    assert!(
        verify_requant(&acc, &q, zero(), DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "honest requant must verify"
    );
}

#[test]
fn tampered_quotient_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (proof, mut q) = prove_requant(&acc, zero(), DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    q[0] += Fr::from(1u64); // breaks acc = q·D + r
    assert!(
        !verify_requant(&acc, &q, zero(), DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "tampered quotient must be rejected"
    );
}

#[test]
fn tampered_remainder_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (mut proof, q) = prove_requant(&acc, zero(), DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    proof.r[1] += Fr::from(1u64); // breaks the division identity
    assert!(
        !verify_requant(&acc, &q, zero(), DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
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
    let (mut proof, mut q) = prove_requant(&acc, zero(), DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    q[0] = Fr::from(2u64);
    proof.r[0] = Fr::from(5u64);
    assert_eq!(acc[0], q[0] * Fr::from(DIVISOR as u64) + proof.r[0], "identity still holds");
    assert!(
        !verify_requant(&acc, &q, zero(), DIVISOR, &r_table, &q_table, &proof, &mut Transcript::new(b"rq")),
        "an out-of-range remainder must be caught by the range check"
    );
}

#[test]
fn wrong_divisor_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let acc = acc_col();
    let (proof, q) = prove_requant(&acc, zero(), DIVISOR, &r_table, &q_table, &mut Transcript::new(b"rq"));
    let wrong_r = RangeTable::new(8);
    assert!(
        !verify_requant(&acc, &q, zero(), 8, &wrong_r, &q_table, &proof, &mut Transcript::new(b"rq")),
        "verifying with the wrong divisor must fail"
    );
}

#[test]
fn signed_accumulator_with_bias_verifies() {
    // A matmul over signed codes yields a (possibly negative) accumulator. A public bias shifts it
    // into the non-negative domain so the Euclidean decomposition acc + bias = q·D + r is
    // well-defined; the bias is public and enters the directly-checked identity.
    let divisor = 4usize;
    let q_bound = 16usize;
    let (r_table, q_table) = (RangeTable::new(divisor), RangeTable::new(q_bound));
    let bias = Fr::from(8u64);
    // acc + 8 = [5, 7, 10, 13, 0, 8, 15, 3]; ⌊·/4⌋ = [1, 1, 2, 3, 0, 2, 3, 0]
    let acc = vec![
        signed(-3), signed(-1), signed(2), signed(5),
        signed(-8), signed(0), signed(7), signed(-5),
    ];
    let expected = v(&[1, 1, 2, 3, 0, 2, 3, 0]);

    let (proof, q) = prove_requant(&acc, bias, divisor, &r_table, &q_table, &mut Transcript::new(b"srq"));
    assert_eq!(q, expected, "quotient must be ⌊(acc+bias)/D⌋ for the shifted signed accumulator");
    assert!(
        verify_requant(&acc, &q, bias, divisor, &r_table, &q_table, &proof, &mut Transcript::new(b"srq")),
        "signed accumulator with a valid bias must verify"
    );
    // A mismatched bias breaks the exact division identity → rejected.
    assert!(
        !verify_requant(&acc, &q, Fr::from(9u64), divisor, &r_table, &q_table, &proof, &mut Transcript::new(b"srq")),
        "a mismatched bias must be rejected by the division identity"
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
    let (rq_proof, q) = prove_requant(&acc, zero(), DIVISOR, &r_table, &q_table, &mut tr_p);
    let out = act.apply(&q);
    let act_proof = act.prove(&q, &out, &mut tr_p);

    let mut tr_v = Transcript::new(b"chain");
    assert!(
        verify_requant(&acc, &q, zero(), DIVISOR, &r_table, &q_table, &rq_proof, &mut tr_v),
        "requant hop must verify"
    );
    assert!(
        act.verify(&q, &out, &act_proof, &mut tr_v),
        "activation on the requantized codes must verify under the shared transcript"
    );
}

// ─── Committed (succinct) requant — M5.4b ─────────────────────────────────────

/// Keys for the committed requant: `n` = acc/q/r column (len 8 → 3 vars), remainder (4 → 2 vars),
/// quotient (16 → 4 vars) table domains. Max var = 4.
#[allow(clippy::type_complexity)]
fn committed_keys() -> (pcs::Params, (pcs::Ck, pcs::Vk), (pcs::Ck, pcs::Vk), (pcs::Ck, pcs::Vk)) {
    let mut rng = test_rng();
    let params = pcs::setup(4, &mut rng);
    let kn = pcs::keys(&params, log2_exact(8));
    let krt = pcs::keys(&params, log2_exact(DIVISOR));
    let kqt = pcs::keys(&params, log2_exact(Q_BOUND));
    (params, kn, krt, kqt)
}

#[test]
fn committed_requant_verifies() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let (_params, kn, krt, kqt) = committed_keys();
    let acc = acc_col();

    let (proof, comm_acc, _comm_q, q) = prove_committed_requant(
        &acc, zero(), DIVISOR, &r_table, &q_table, &kn.0, &krt.0, &kqt.0, &mut Transcript::new(b"crq"),
    );
    assert_eq!(q, expected_q(), "quotient must be ⌊acc/D⌋");
    assert!(
        verify_committed_requant(
            8, zero(), DIVISOR, &r_table, &q_table, &comm_acc, &proof, &krt.0, &kqt.0, &kn.1,
            &krt.1, &kqt.1, &mut Transcript::new(b"crq"),
        ),
        "honest committed requant must verify from commitments alone"
    );
}

#[test]
fn committed_requant_wrong_accumulator_commitment_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let (_params, kn, krt, kqt) = committed_keys();
    let acc = acc_col();

    let (proof, _comm_acc, _comm_q, _q) = prove_committed_requant(
        &acc, zero(), DIVISOR, &r_table, &q_table, &kn.0, &krt.0, &kqt.0, &mut Transcript::new(b"crq"),
    );
    // A commitment to a different accumulator must fail the division-identity opening.
    let bad_comm = pcs::commit(&kn.0, &v(&[13, 0, 63, 30, 32, 5, 63, 9]));
    assert!(
        !verify_committed_requant(
            8, zero(), DIVISOR, &r_table, &q_table, &bad_comm, &proof, &krt.0, &kqt.0, &kn.1,
            &krt.1, &kqt.1, &mut Transcript::new(b"crq"),
        ),
        "a wrong accumulator commitment must be rejected"
    );
}

#[test]
fn committed_requant_tampered_quotient_opening_is_rejected() {
    let (r_table, q_table) = (RangeTable::new(DIVISOR), RangeTable::new(Q_BOUND));
    let (_params, kn, krt, kqt) = committed_keys();
    let acc = acc_col();

    let (mut proof, comm_acc, _comm_q, _q) = prove_committed_requant(
        &acc, zero(), DIVISOR, &r_table, &q_table, &kn.0, &krt.0, &kqt.0, &mut Transcript::new(b"crq"),
    );
    // Forge the quotient's claimed evaluation: breaks the affine identity acc+bias = q·D + r at ρ.
    proof.q.value += Fr::from(1u64);
    assert!(
        !verify_committed_requant(
            8, zero(), DIVISOR, &r_table, &q_table, &comm_acc, &proof, &krt.0, &kqt.0, &kn.1,
            &krt.1, &kqt.1, &mut Transcript::new(b"crq"),
        ),
        "a tampered quotient opening must be rejected"
    );
}
