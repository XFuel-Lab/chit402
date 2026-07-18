//! Soundness/completeness tests for multi-head + GQA attention (with and without RoPE).

use xfuel_zkp::ffn::NormParams;
use xfuel_zkp::mha::{prove_mha, verify_mha, MhaConfig, RopeParams};
use xfuel_zkp::norm::RsqrtTable;
use xfuel_zkp::table::ScalarTable;
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

/// `rows × cols` matrix whose first row is all ones (rest zero). With an all-ones input row this
/// makes every projection output an all-ones row (each output column = the input row-sum · 1).
fn first_row_ones(rows: usize, cols: usize) -> Vec<Fr> {
    let mut m = vec![Fr::from(0u64); rows * cols];
    for slot in m.iter_mut().take(cols) {
        *slot = Fr::from(1u64);
    }
    m
}

fn exp_table() -> ScalarTable {
    ScalarTable::new(16, |c| c as i64)
}
fn recip_table() -> ScalarTable {
    ScalarTable::new(64, |r| if r == 0 { 0 } else { 64 / r as i64 })
}

struct Fx {
    cfg: MhaConfig,
    x: Vec<Fr>,
    wq: Vec<Fr>,
    wk: Vec<Fr>,
    wv: Vec<Fr>,
    wo: Vec<Fr>,
}

fn fixture(n_heads: usize, n_kv_heads: usize) -> Fx {
    let (seq, d_head) = (2usize, 2usize);
    let d_model = n_heads * d_head;
    let (qw, kvw) = (n_heads * d_head, n_kv_heads * d_head);
    Fx {
        cfg: MhaConfig { seq, d_model, n_heads, n_kv_heads, d_head, norm_name: "rmsnorm" },
        x: vec![Fr::from(1u64); seq * d_model],
        wq: first_row_ones(d_model, qw),
        wk: first_row_ones(d_model, kvw),
        wv: first_row_ones(d_model, kvw),
        wo: first_row_ones(qw, d_model),
    }
}

#[test]
fn honest_gqa_verifies() {
    let f = fixture(2, 1); // 2 query heads share 1 KV head (GQA)
    let (exp, recip) = (exp_table(), recip_table());
    let (proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, None, None,
        &mut Transcript::new(b"mha"),
    );
    assert_eq!(proof.heads.len(), 2);
    assert_eq!(proof.obligations.len(), 1);
    assert_eq!(proof.obligations[0].op, "rmsnorm");
    assert!(verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, None, None,
        &mut Transcript::new(b"mha")
    ));
}

#[test]
fn honest_full_multihead_verifies() {
    let f = fixture(2, 2); // full MHA (no grouping)
    let (exp, recip) = (exp_table(), recip_table());
    let (proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, None, None,
        &mut Transcript::new(b"mha"),
    );
    assert!(verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, None, None,
        &mut Transcript::new(b"mha")
    ));
}

#[test]
fn quantized_gqa_has_zero_obligations() {
    let f = fixture(2, 1);
    let (exp, recip) = (exp_table(), recip_table());
    let rsqrt = RsqrtTable::new(64, (f.cfg.d_model as f64).sqrt(), 0.0);
    let w_norm = vec![Fr::from(1u64); f.cfg.d_model];
    let np = NormParams { weight: &w_norm, table: &rsqrt };
    let (proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, Some(&np), None,
        &mut Transcript::new(b"mha"),
    );
    assert!(proof.obligations.is_empty());
    assert!(verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, Some(&np), None,
        &mut Transcript::new(b"mha")
    ));
}

#[test]
fn mha_with_rope_verifies() {
    let f = fixture(2, 1);
    let (exp, recip) = (exp_table(), recip_table());
    // Identity RoPE (cos=1, sin=0): exercises the RoPE verify path without changing code domains.
    let half = f.cfg.seq * f.cfg.d_head / 2;
    let cos = vec![Fr::from(1u64); half];
    let sin = vec![Fr::from(0u64); half];
    let rope = RopeParams { cos: &cos, sin: &sin };
    let (proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, None, Some(&rope),
        &mut Transcript::new(b"mha"),
    );
    assert!(verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, None, Some(&rope),
        &mut Transcript::new(b"mha")
    ));
}

#[test]
fn tampered_head_score_is_rejected() {
    let f = fixture(2, 1);
    let (exp, recip) = (exp_table(), recip_table());
    let (mut proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, None, None,
        &mut Transcript::new(b"mha"),
    );
    proof.heads[1].scores[0] += Fr::from(1u64);
    assert!(!verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, None, None,
        &mut Transcript::new(b"mha")
    ));
}

#[test]
fn tampered_concat_is_rejected() {
    let f = fixture(2, 1);
    let (exp, recip) = (exp_table(), recip_table());
    let (mut proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, None, None,
        &mut Transcript::new(b"mha"),
    );
    // Break the concat→output-projection link: verifier recomputes concat from heads and rejects.
    proof.concat[0] += Fr::from(1u64);
    assert!(!verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, None, None,
        &mut Transcript::new(b"mha")
    ));
}

#[test]
fn tampered_rope_is_rejected() {
    let f = fixture(2, 1);
    let (exp, recip) = (exp_table(), recip_table());
    let half = f.cfg.seq * f.cfg.d_head / 2;
    let cos = vec![Fr::from(1u64); half];
    let sin = vec![Fr::from(0u64); half];
    let rope = RopeParams { cos: &cos, sin: &sin };
    let (mut proof, out) = prove_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &exp, &recip, None, Some(&rope),
        &mut Transcript::new(b"mha"),
    );
    // Claim a rotated Q that isn't the public-linear rotation of the bound Q.
    proof.q_rot[0] += Fr::from(1u64);
    assert!(!verify_mha(
        &f.cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &out, &proof, &exp, &recip, None, Some(&rope),
        &mut Transcript::new(b"mha")
    ));
}
