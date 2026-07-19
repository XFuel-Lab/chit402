//! Soundness/completeness tests for the committed row-sum reduction `narrow[r] = Σ_j wide[r,j]`.

use ark_std::rand::Rng;
use ark_std::{test_rng, UniformRand};
use xfuel_zkp::reduce::{prove_committed_rowsum, verify_committed_rowsum};
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{log2_exact, pcs, Fr};

fn rand_vec(len: usize, rng: &mut impl Rng) -> Vec<Fr> {
    (0..len).map(|_| Fr::rand(rng)).collect()
}

fn row_sums(wide: &[Fr], rows: usize, cols: usize) -> Vec<Fr> {
    (0..rows)
        .map(|r| (0..cols).fold(Fr::from(0u64), |acc, j| acc + wide[r * cols + j]))
        .collect()
}

fn keys(len: usize, rng: &mut impl Rng) -> (pcs::Ck, pcs::Vk) {
    let nv = log2_exact(len);
    let params = pcs::setup(nv, rng);
    pcs::keys(&params, nv)
}

#[test]
fn honest_rowsum_verifies() {
    let mut rng = test_rng();
    for &(rows, cols) in &[(2usize, 2usize), (4, 2), (2, 8), (8, 4), (16, 16)] {
        let wide = rand_vec(rows * cols, &mut rng);
        let narrow = row_sums(&wide, rows, cols);
        let (ck_w, vk_w) = keys(rows * cols, &mut rng);
        let (ck_n, vk_n) = keys(rows, &mut rng);

        let (proof, cw, cn) = prove_committed_rowsum(
            &wide, &narrow, rows, cols, &ck_w, &ck_n, &mut Transcript::new(b"rs"),
        );
        // The verifier holds no tensors — only the two commitments.
        assert!(
            verify_committed_rowsum(
                rows, cols, &cw, &cn, &proof, &vk_w, &vk_n, &mut Transcript::new(b"rs")
            ),
            "honest row-sum rows={rows} cols={cols} should verify from commitments alone"
        );
    }
}

#[test]
fn wrong_rowsum_is_rejected() {
    let mut rng = test_rng();
    let (rows, cols) = (8usize, 4usize);
    let wide = rand_vec(rows * cols, &mut rng);
    // narrow is NOT the row-sum: one row is off. Multilinear-in-ρ agreement fails w.h.p.
    let mut narrow = row_sums(&wide, rows, cols);
    narrow[3] += Fr::from(1u64);
    let (ck_w, vk_w) = keys(rows * cols, &mut rng);
    let (ck_n, vk_n) = keys(rows, &mut rng);

    let (proof, cw, cn) = prove_committed_rowsum(
        &wide, &narrow, rows, cols, &ck_w, &ck_n, &mut Transcript::new(b"rs"),
    );
    assert!(
        !verify_committed_rowsum(
            rows, cols, &cw, &cn, &proof, &vk_w, &vk_n, &mut Transcript::new(b"rs")
        ),
        "narrow != rowsum(wide) must be rejected"
    );
}

#[test]
fn tampered_wide_opening_is_rejected() {
    let mut rng = test_rng();
    let (rows, cols) = (8usize, 4usize);
    let wide = rand_vec(rows * cols, &mut rng);
    let narrow = row_sums(&wide, rows, cols);
    let (ck_w, vk_w) = keys(rows * cols, &mut rng);
    let (ck_n, vk_n) = keys(rows, &mut rng);
    let (mut proof, cw, cn) = prove_committed_rowsum(
        &wide, &narrow, rows, cols, &ck_w, &ck_n, &mut Transcript::new(b"rs"),
    );

    // Forge the reduced wide(ch): the sumcheck's final check or the PCS opening no longer matches.
    proof.wide_final += Fr::from(1u64);
    assert!(
        !verify_committed_rowsum(
            rows, cols, &cw, &cn, &proof, &vk_w, &vk_n, &mut Transcript::new(b"rs")
        ),
        "a forged wide(ch) must be rejected"
    );
}

#[test]
fn wrong_commitment_is_rejected() {
    let mut rng = test_rng();
    let (rows, cols) = (8usize, 4usize);
    let wide = rand_vec(rows * cols, &mut rng);
    let narrow = row_sums(&wide, rows, cols);
    let (ck_w, vk_w) = keys(rows * cols, &mut rng);
    let (ck_n, vk_n) = keys(rows, &mut rng);
    let (proof, cw, _cn) = prove_committed_rowsum(
        &wide, &narrow, rows, cols, &ck_w, &ck_n, &mut Transcript::new(b"rs"),
    );

    // A commitment to a different narrow diverges the transcript (absorbed before ρ) and the opening.
    let bad_cn = pcs::commit(&ck_n, &rand_vec(rows, &mut rng));
    assert!(
        !verify_committed_rowsum(
            rows, cols, &cw, &bad_cn, &proof, &vk_w, &vk_n, &mut Transcript::new(b"rs")
        ),
        "a mismatched narrow commitment must be rejected"
    );
}
