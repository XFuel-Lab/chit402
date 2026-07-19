//! Soundness/completeness tests for the sumcheck matmul argument.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::matmul::{
    commit, prove, prove_committed, prove_committed_io, prove_committed_io_bt, verify,
    verify_committed, verify_committed_io, verify_committed_io_bt, MatMul,
};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

/// Build committer/verifier keys sized to `A` (`log2(m·k)` vars) and `B` (`log2(k·n)` vars).
fn matmul_keys(
    m: usize,
    k: usize,
    n: usize,
    rng: &mut impl Rng,
) -> ((pcs::Ck, pcs::Vk), (pcs::Ck, pcs::Vk)) {
    let va = log2_exact(m * k);
    let vb = log2_exact(k * n);
    let pa = pcs::setup(va, rng);
    let pb = pcs::setup(vb, rng);
    (pcs::keys(&pa, va), pcs::keys(&pb, vb))
}

#[test]
fn honest_proof_verifies() {
    let mut rng = test_rng();
    for &(m, k, n) in &[(1usize, 2usize, 1usize), (4, 8, 2), (8, 8, 8), (2, 16, 4)] {
        let a = rand_vec(m * k, &mut rng);
        let b = rand_vec(k * n, &mut rng);
        let mm = MatMul::new(m, k, n, a.clone(), b.clone());
        let proof = prove(&mm, &mut Transcript::new(b"t"));
        assert!(
            verify(m, k, n, &a, &b, &mm.c, &proof, &mut Transcript::new(b"t")),
            "honest {m}x{k}*{k}x{n} should verify"
        );
    }
}

#[test]
fn tampered_output_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let proof = prove(&mm, &mut Transcript::new(b"t"));

    // Flip one entry of C: the claim recomputed from the tampered C won't match.
    let mut bad_c = mm.c.clone();
    bad_c[0] += Fr::from(1u64);
    assert!(
        !verify(m, k, n, &a, &b, &bad_c, &proof, &mut Transcript::new(b"t")),
        "tampered C must be rejected"
    );
}

#[test]
fn tampered_weights_are_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let proof = prove(&mm, &mut Transcript::new(b"t"));

    // Verify against tampered A (final MLE binding f(r)=Â(rx,r) fails).
    let mut bad_a = a.clone();
    bad_a[3] += Fr::from(7u64);
    assert!(
        !verify(m, k, n, &bad_a, &b, &mm.c, &proof, &mut Transcript::new(b"t")),
        "tampered A must be rejected"
    );
}

#[test]
fn forged_final_evaluation_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a.clone(), b.clone());
    let mut proof = prove(&mm, &mut Transcript::new(b"t"));

    // Forge the claimed final f(r): breaks reduced == f_final*g_final and the MLE binding.
    proof.f_final += Fr::from(1u64);
    assert!(
        !verify(m, k, n, &a, &b, &mm.c, &proof, &mut Transcript::new(b"t")),
        "forged f_final must be rejected"
    );
}

#[test]
fn committed_proof_verifies_without_the_tensors() {
    let mut rng = test_rng();
    // Include a rectangular case so A (log2 m·k) and B (log2 k·n) have different MLE widths.
    for &(m, k, n) in &[(1usize, 2usize, 1usize), (4, 8, 2), (8, 8, 8), (2, 16, 4)] {
        let a = rand_vec(m * k, &mut rng);
        let b = rand_vec(k * n, &mut rng);
        let mm = MatMul::new(m, k, n, a, b);
        let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
        let (comm_a, comm_b) = commit(&mm, &ck_a, &ck_b);

        let proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));
        // The verifier is given only C and the commitments — never A or B.
        assert!(
            verify_committed(
                m, k, n, &comm_a, &comm_b, &mm.c, &proof, &vk_a, &vk_b,
                &mut Transcript::new(b"t")
            ),
            "honest committed {m}x{k}*{k}x{n} should verify from commitments alone"
        );
    }
}

#[test]
fn committed_wrong_weight_commitment_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a, b);
    let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
    let (comm_a, _comm_b) = commit(&mm, &ck_a, &ck_b);
    let proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));

    // A commitment to *different* weights (the PoMA anchor is B) must fail the opening check.
    let other_b = rand_vec(k * n, &mut rng);
    let bad_comm_b = pcs::commit(&ck_b, &other_b);
    assert!(
        !verify_committed(
            m, k, n, &comm_a, &bad_comm_b, &mm.c, &proof, &vk_a, &vk_b,
            &mut Transcript::new(b"t")
        ),
        "an opening bound to a different weight commitment must be rejected"
    );
}

#[test]
fn committed_challenge_binds_the_weight_commitment() {
    // Soundness guard: the evaluation point must depend on the A,B commitments, not just C. If a
    // verifier were handed a proof produced under a *different* weight commitment (i.e. the prover
    // committed to other weights than the transcript pins), the re-derived point must diverge and
    // the proof must fail. This is the property that closes the adaptive-witness attack.
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a, b);
    let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
    let (comm_a, _comm_b) = commit(&mm, &ck_a, &ck_b);
    let proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));

    // Verify with a commitment to different weights: since commB is absorbed before (rx,ry), the
    // point re-derives differently and the sumcheck rx/ry equality check fails.
    let other_b = rand_vec(k * n, &mut rng);
    let bad_comm_b = pcs::commit(&ck_b, &other_b);
    assert!(
        !verify_committed(
            m, k, n, &comm_a, &bad_comm_b, &mm.c, &proof, &vk_a, &vk_b,
            &mut Transcript::new(b"t")
        ),
        "the evaluation point must be bound to the weight commitment"
    );
}

#[test]
fn committed_forged_final_evaluation_is_rejected() {
    let mut rng = test_rng();
    let (m, k, n) = (4, 8, 4);
    let a = rand_vec(m * k, &mut rng);
    let b = rand_vec(k * n, &mut rng);
    let mm = MatMul::new(m, k, n, a, b);
    let ((ck_a, vk_a), (ck_b, vk_b)) = matmul_keys(m, k, n, &mut rng);
    let (comm_a, comm_b) = commit(&mm, &ck_a, &ck_b);
    let mut proof = prove_committed(&mm, &ck_a, &ck_b, &mut Transcript::new(b"t"));

    // Forge f_final: the PCS opening no longer matches the claimed evaluation.
    proof.inner.f_final += Fr::from(1u64);
    assert!(
        !verify_committed(
            m, k, n, &comm_a, &comm_b, &mm.c, &proof, &vk_a, &vk_b,
            &mut Transcript::new(b"t")
        ),
        "forged f_final must fail the commitment opening"
    );
}

#[test]
fn io_matmul_chain_verifies_without_materializing_the_intermediate() {
    // The block composition primitive: prove Z = (A·B)·D where the verifier is given ONLY the input,
    // weight and output commitments — never the intermediate Y = A·B. The two matmuls are linked
    // purely by reusing Y's commitment (matmul-1's output = matmul-2's operand); no separate linking
    // argument. All tensors are 4×4 (16 elems, 4 MLE vars) so one trusted setup covers every commit.
    let mut rng = test_rng();
    let nv = log2_exact(16);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);

    let a = rand_vec(16, &mut rng);
    let b = rand_vec(16, &mut rng);
    let d = rand_vec(16, &mut rng);
    let mm1 = MatMul::new(4, 4, 4, a, b); // Y = mm1.c
    let mm2 = MatMul::new(4, 4, 4, mm1.c.clone(), d); // Z = mm2.c = Y·D

    // Prove both matmuls under ONE shared transcript (as a real block would).
    let mut tp = Transcript::new(b"chain");
    let (p1, comm_a, comm_b, comm_y) = prove_committed_io(&mm1, &ck, &ck, &ck, &mut tp);
    let (p2, comm_y2, comm_d, comm_z) = prove_committed_io(&mm2, &ck, &ck, &ck, &mut tp);

    // The link is literal commitment reuse: matmul-1's output commitment IS matmul-2's operand one.
    assert_eq!(
        pcs::commitment_bytes(&comm_y),
        pcs::commitment_bytes(&comm_y2),
        "the intermediate commitment must be reused across the chain"
    );

    // Verifier replays the same transcript order and holds no tensors — only commitments (+ never Y).
    let mut tv = Transcript::new(b"chain");
    assert!(
        verify_committed_io(4, 4, 4, &comm_a, &comm_b, &comm_y, &p1, &vk, &vk, &vk, &mut tv),
        "matmul-1 must verify from commitments alone"
    );
    assert!(
        verify_committed_io(4, 4, 4, &comm_y, &comm_d, &comm_z, &p2, &vk, &vk, &vk, &mut tv),
        "matmul-2 must verify reusing the intermediate commitment as its operand"
    );
}

#[test]
fn io_matmul_chain_rejects_a_tampered_intermediate() {
    // Composition soundness: a prover cannot feed matmul-2 a different intermediate than matmul-1
    // emitted. We prove matmul-2 over a tampered Y', but the verifier uses matmul-1's HONEST output
    // commitment as matmul-2's operand commitment — the mismatch (absorbed before the point is drawn)
    // makes the re-derived point diverge and the opening fail.
    let mut rng = test_rng();
    let nv = log2_exact(16);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);

    let a = rand_vec(16, &mut rng);
    let b = rand_vec(16, &mut rng);
    let d = rand_vec(16, &mut rng);
    let mm1 = MatMul::new(4, 4, 4, a, b);
    let (_p1, _ca, _cb, comm_y) = prove_committed_io(&mm1, &ck, &ck, &ck, &mut Transcript::new(b"c"));

    // Tamper the intermediate fed into matmul-2.
    let mut y_bad = mm1.c.clone();
    y_bad[0] += Fr::from(1u64);
    let mm2 = MatMul::new(4, 4, 4, y_bad, d);
    let (p2, comm_y_bad, comm_d, comm_z) =
        prove_committed_io(&mm2, &ck, &ck, &ck, &mut Transcript::new(b"c2"));

    assert_ne!(
        pcs::commitment_bytes(&comm_y),
        pcs::commitment_bytes(&comm_y_bad),
        "a tampered intermediate must commit differently"
    );
    // Verify matmul-2 with the honest intermediate commitment (what the chain forces): must reject.
    assert!(
        !verify_committed_io(4, 4, 4, &comm_y, &comm_d, &comm_z, &p2, &vk, &vk, &vk, &mut Transcript::new(b"c2")),
        "matmul-2 built on a different intermediate than matmul-1 emitted must be rejected"
    );
}

/// Row-major `S = Q·Kᵀ` where `Q` is `m×k` and `K` is `n×k`: `S[i,j] = Σ_l Q[i,l]·K[j,l]`.
fn scores_qkt(q: &[Fr], k_mat: &[Fr], m: usize, k: usize, n: usize) -> Vec<Fr> {
    let mut s = vec![Fr::from(0u64); m * n];
    for i in 0..m {
        for j in 0..n {
            let mut acc = Fr::from(0u64);
            for l in 0..k {
                acc += q[i * k + l] * k_mat[j * k + l];
            }
            s[i * n + j] = acc;
        }
    }
    s
}

#[test]
fn io_bt_matmul_verifies() {
    // S = Q·Kᵀ with K committed in its natural n×k layout and opened at the swapped point.
    let mut rng = test_rng();
    let nv = log2_exact(16);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);

    let q = rand_vec(16, &mut rng); // 4×4
    let k_mat = rand_vec(16, &mut rng); // 4×4 (natural)
    let s = scores_qkt(&q, &k_mat, 4, 4, 4);

    let (proof, comm_q, comm_k, comm_s) =
        prove_committed_io_bt(&q, &k_mat, 4, 4, 4, &ck, &ck, &ck, &mut Transcript::new(b"bt"));
    // Sanity: the argument's committed output equals the independently-computed S.
    assert_eq!(pcs::commitment_bytes(&comm_s), pcs::commitment_bytes(&pcs::commit(&ck, &s)));
    assert!(
        verify_committed_io_bt(4, 4, 4, &comm_q, &comm_k, &comm_s, &proof, &vk, &vk, &vk, &mut Transcript::new(b"bt")),
        "honest S = Q·Kᵀ must verify from commitments alone"
    );
}

#[test]
fn io_bt_reuses_a_projection_output_commitment() {
    // The attention seam: K is produced by a projection matmul (K = Xn·Wk) and committed as its n×k
    // output; the scores matmul S = Q·Kᵀ must reuse THAT commitment as its B operand — no separate Kᵀ.
    let mut rng = test_rng();
    let nv = log2_exact(16);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);

    let xn = rand_vec(16, &mut rng);
    let wk = rand_vec(16, &mut rng);
    let mm_k = MatMul::new(4, 4, 4, xn, wk); // K = mm_k.c (4×4)
    let q = rand_vec(16, &mut rng);
    let s = scores_qkt(&q, &mm_k.c, 4, 4, 4);

    let mut tp = Transcript::new(b"attn");
    let (p_k, _cxn, _cwk, comm_k) = prove_committed_io(&mm_k, &ck, &ck, &ck, &mut tp);
    let (p_s, comm_q, comm_k2, comm_s) =
        prove_committed_io_bt(&q, &mm_k.c, 4, 4, 4, &ck, &ck, &ck, &mut tp);

    // The scores' B-operand commitment IS the projection's output commitment.
    assert_eq!(
        pcs::commitment_bytes(&comm_k),
        pcs::commitment_bytes(&comm_k2),
        "the K projection output commitment must be reused as the scores operand commitment"
    );

    let mut tv = Transcript::new(b"attn");
    // (Reconstruct the projection's input/weight commitments the way a full block would carry them.)
    let (comm_xn, comm_wk) = commit(&mm_k, &ck, &ck);
    assert!(
        verify_committed_io(4, 4, 4, &comm_xn, &comm_wk, &comm_k, &p_k, &vk, &vk, &vk, &mut tv),
        "the K projection must verify"
    );
    assert!(
        verify_committed_io_bt(4, 4, 4, &comm_q, &comm_k, &comm_s, &p_s, &vk, &vk, &vk, &mut tv),
        "scores reusing the projection's K commitment must verify — no Kᵀ materialized"
    );
}

#[test]
fn io_bt_tampered_k_commitment_is_rejected() {
    let mut rng = test_rng();
    let nv = log2_exact(16);
    let params = pcs::setup(nv, &mut rng);
    let (ck, vk) = pcs::keys(&params, nv);

    let q = rand_vec(16, &mut rng);
    let k_mat = rand_vec(16, &mut rng);
    let (proof, comm_q, _comm_k, comm_s) =
        prove_committed_io_bt(&q, &k_mat, 4, 4, 4, &ck, &ck, &ck, &mut Transcript::new(b"bt"));

    let bad_comm_k = pcs::commit(&ck, &rand_vec(16, &mut rng));
    assert!(
        !verify_committed_io_bt(4, 4, 4, &comm_q, &bad_comm_k, &comm_s, &proof, &vk, &vk, &vk, &mut Transcript::new(b"bt")),
        "a mismatched K commitment must be rejected"
    );
}
