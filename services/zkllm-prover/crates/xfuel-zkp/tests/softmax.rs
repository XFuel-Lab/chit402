//! Soundness/completeness tests for the committed causal softmax.

use ark_std::test_rng;
use xfuel_zkp::softmax::{prove_committed_softmax, verify_committed_softmax};
use xfuel_zkp::table::ScalarTable;
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

/// Small non-negative scores so masked entries stay in the exp domain and row-sums stay in the
/// reciprocal domain. Upper-triangular entries are masked to 0 by the argument.
fn scores(seq: usize) -> Vec<Fr> {
    (0..seq * seq).map(|k| Fr::from(((k % 4) + 1) as u64)).collect()
}

/// exp: identity code map (code 0 → 0, the causal-mask sentinel). recip: any deterministic map.
fn tables() -> (ScalarTable, ScalarTable) {
    let exp = ScalarTable::new(16, |c| c as i64);
    let recip = ScalarTable::new(64, |c| (c as i64 % 7) + 1);
    (exp, recip)
}

/// All committer/verifier keys for the four widths, trimmed from one SRS.
struct Keys {
    ck_sq: pcs::Ck,
    ck_s: pcs::Ck,
    ck_exp: pcs::Ck,
    ck_recip: pcs::Ck,
    vk_sq: pcs::Vk,
    vk_s: pcs::Vk,
    vk_exp: pcs::Vk,
    vk_recip: pcs::Vk,
}

fn keys(seq: usize, exp_domain: usize, recip_domain: usize) -> Keys {
    let mut rng = test_rng();
    let (nv_sq, nv_s) = (log2_exact(seq * seq), log2_exact(seq));
    let (nv_exp, nv_recip) = (log2_exact(exp_domain), log2_exact(recip_domain));
    let max = nv_sq.max(nv_s).max(nv_exp).max(nv_recip);
    let params = pcs::setup(max, &mut rng);
    let (ck_sq, vk_sq) = pcs::keys(&params, nv_sq);
    let (ck_s, vk_s) = pcs::keys(&params, nv_s);
    let (ck_exp, vk_exp) = pcs::keys(&params, nv_exp);
    let (ck_recip, vk_recip) = pcs::keys(&params, nv_recip);
    Keys { ck_sq, ck_s, ck_exp, ck_recip, vk_sq, vk_s, vk_exp, vk_recip }
}

#[test]
fn honest_softmax_verifies() {
    for &seq in &[2usize, 4] {
        let (exp, recip) = tables();
        let s = scores(seq);
        let k = keys(seq, exp.domain, recip.domain);

        let (proof, comm_s, comm_p, _p) = prove_committed_softmax(
            &s, seq, &exp, &recip, &k.ck_sq, &k.ck_s, &k.ck_exp, &k.ck_recip,
            &mut Transcript::new(b"sm"),
        );
        // The verifier holds no seq×seq tensors — only comm_s, comm_p and the canonical tables.
        assert!(
            verify_committed_softmax(
                seq, &exp, &recip, &comm_s, &comm_p, &proof, &k.ck_sq, &k.ck_exp, &k.ck_recip,
                &k.vk_sq, &k.vk_s, &k.vk_exp, &k.vk_recip, &mut Transcript::new(b"sm"),
            ),
            "honest committed softmax seq={seq} should verify from commitments alone"
        );
    }
}

#[test]
fn wrong_output_commitment_is_rejected() {
    let seq = 4;
    let (exp, recip) = tables();
    let s = scores(seq);
    let k = keys(seq, exp.domain, recip.domain);
    let (proof, comm_s, _comm_p, _p) = prove_committed_softmax(
        &s, seq, &exp, &recip, &k.ck_sq, &k.ck_s, &k.ck_exp, &k.ck_recip,
        &mut Transcript::new(b"sm"),
    );

    let bad: Vec<Fr> = (0..seq * seq).map(|i| Fr::from((i + 1) as u64)).collect();
    let bad_comm_p = pcs::commit(&k.ck_sq, &bad);
    assert!(
        !verify_committed_softmax(
            seq, &exp, &recip, &comm_s, &bad_comm_p, &proof, &k.ck_sq, &k.ck_exp, &k.ck_recip,
            &k.vk_sq, &k.vk_s, &k.vk_exp, &k.vk_recip, &mut Transcript::new(b"sm"),
        ),
        "a mismatched output commitment must be rejected"
    );
}

#[test]
fn forged_exp_table_is_rejected() {
    // Prove with one exp table, verify against a different one (also 0→0). The lookup's table-tie
    // must reject — the committed E is not exp(masked) under the verifier's table.
    let seq = 4;
    let (exp_prove, recip) = tables();
    let exp_verify = ScalarTable::new(16, |c| (c as i64 * 3) % 16);
    let s = scores(seq);
    let k = keys(seq, exp_prove.domain, recip.domain);
    let (proof, comm_s, comm_p, _p) = prove_committed_softmax(
        &s, seq, &exp_prove, &recip, &k.ck_sq, &k.ck_s, &k.ck_exp, &k.ck_recip,
        &mut Transcript::new(b"sm"),
    );

    assert!(
        !verify_committed_softmax(
            seq, &exp_verify, &recip, &comm_s, &comm_p, &proof, &k.ck_sq, &k.ck_exp, &k.ck_recip,
            &k.vk_sq, &k.vk_s, &k.vk_exp, &k.vk_recip, &mut Transcript::new(b"sm"),
        ),
        "an E proven against a different exp table must be rejected by the table-tie"
    );
}

#[test]
fn forged_scaling_opening_is_rejected() {
    let seq = 4;
    let (exp, recip) = tables();
    let s = scores(seq);
    let k = keys(seq, exp.domain, recip.domain);
    let (mut proof, comm_s, comm_p, _p) = prove_committed_softmax(
        &s, seq, &exp, &recip, &k.ck_sq, &k.ck_s, &k.ck_exp, &k.ck_recip,
        &mut Transcript::new(b"sm"),
    );

    // Forge the reduced E(ch): the scaling product check or its PCS opening no longer matches.
    proof.e_final += Fr::from(1u64);
    assert!(
        !verify_committed_softmax(
            seq, &exp, &recip, &comm_s, &comm_p, &proof, &k.ck_sq, &k.ck_exp, &k.ck_recip,
            &k.vk_sq, &k.vk_s, &k.vk_exp, &k.vk_recip, &mut Transcript::new(b"sm"),
        ),
        "a forged scaling opening must be rejected"
    );
}

#[test]
fn tampered_masked_commitment_is_rejected() {
    // Swap the carried comm_masked for a commitment to a different tensor: the mask Hadamard's output
    // opening and the exp-lookup input tie both break.
    let seq = 4;
    let (exp, recip) = tables();
    let s = scores(seq);
    let k = keys(seq, exp.domain, recip.domain);
    let (mut proof, comm_s, comm_p, _p) = prove_committed_softmax(
        &s, seq, &exp, &recip, &k.ck_sq, &k.ck_s, &k.ck_exp, &k.ck_recip,
        &mut Transcript::new(b"sm"),
    );

    let bogus: Vec<Fr> = (0..seq * seq).map(|i| Fr::from((2 * i + 5) as u64)).collect();
    proof.comm_masked = pcs::commit(&k.ck_sq, &bogus);
    assert!(
        !verify_committed_softmax(
            seq, &exp, &recip, &comm_s, &comm_p, &proof, &k.ck_sq, &k.ck_exp, &k.ck_recip,
            &k.vk_sq, &k.vk_s, &k.vk_exp, &k.vk_recip, &mut Transcript::new(b"sm"),
        ),
        "a tampered masked commitment must be rejected"
    );
}
