//! Composition test for one full transformer block (attention sub-block → FFN sub-block under one
//! transcript).
//!
//! Note on scope: the attention half uses the softmax lookup tables (so its scores must be
//! in-domain), while the FFN half here runs the placeholder path — a fully-quantized, zero-obligation
//! *end-to-end* block additionally needs the inter-op requantization range-check (M5.3) so the
//! attention output re-enters the FFN's code domain. Each sub-block's own zero-obligation capability
//! is covered by `tests/attention.rs` and `tests/ffn.rs`.

use ark_std::{test_rng, UniformRand};
use xfuel_zkp::attention::AttnConfig;
use xfuel_zkp::block::{prove_block, verify_block};
use xfuel_zkp::ffn::FfnConfig;
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};
use xfuel_zkp::table::ScalarTable;
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::Fr;

fn identity(d: usize) -> Vec<Fr> {
    let mut m = vec![Fr::from(0u64); d * d];
    for i in 0..d {
        m[i * d + i] = Fr::from(1u64);
    }
    m
}

fn manifest(d_model: u32, d_ff: u32) -> ModelManifest {
    ModelManifest {
        family: "llama-block-test".into(),
        n_layers: 1,
        d_model,
        n_heads: 1,
        n_kv_heads: 1,
        d_ff,
        vocab_size: 256,
        norm: NormType::RmsNorm,
        act: ActType::SwiGLU,
        pos: PosType::Rope,
        quant: "q8_0".into(),
    }
}

struct Fixture {
    attn_cfg: AttnConfig,
    ffn_cfg: FfnConfig,
    x: Vec<Fr>,
    wq: Vec<Fr>,
    wk: Vec<Fr>,
    wv: Vec<Fr>,
    wo: Vec<Fr>,
    wgate: Vec<Fr>,
    wup: Vec<Fr>,
    wdown: Vec<Fr>,
    exp: ScalarTable,
    recip: ScalarTable,
}

fn fixture(seq: usize, d_model: usize, d_ff: usize) -> Fixture {
    let mut rng = test_rng();
    let m = manifest(d_model as u32, d_ff as u32);
    Fixture {
        attn_cfg: AttnConfig { seq, d_model, d_head: d_model, norm_name: "rmsnorm" },
        ffn_cfg: FfnConfig::from_manifest(&m, seq),
        x: vec![Fr::from(1u64); seq * d_model],
        wq: identity(d_model),
        wk: identity(d_model),
        wv: identity(d_model),
        wo: identity(d_model),
        wgate: (0..d_model * d_ff).map(|_| Fr::rand(&mut rng)).collect(),
        wup: (0..d_model * d_ff).map(|_| Fr::rand(&mut rng)).collect(),
        wdown: (0..d_ff * d_model).map(|_| Fr::rand(&mut rng)).collect(),
        exp: ScalarTable::new(16, |c| c as i64),
        recip: ScalarTable::new(64, |r| if r == 0 { 0 } else { 64 / r as i64 }),
    }
}

#[test]
fn honest_block_verifies_and_lists_obligations() {
    let f = fixture(4, 4, 8);
    let (proof, out) = prove_block(
        &f.attn_cfg, &f.ffn_cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &f.exp, &f.recip, None,
        &f.wgate, &f.wup, &f.wdown, None, None, &mut Transcript::new(b"block"),
    );
    // Placeholder norms/activation: attn norm + ffn norm + ffn activation remain pending.
    let obl = proof.obligations();
    assert_eq!(obl.len(), 3);
    assert_eq!(obl[0].op, "rmsnorm"); // attention norm
    assert_eq!(obl[1].op, "rmsnorm"); // ffn norm
    assert_eq!(obl[2].op, "silu"); //    ffn activation
    assert!(
        verify_block(
            &f.attn_cfg, &f.ffn_cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &f.exp, &f.recip, None,
            &f.wgate, &f.wup, &f.wdown, None, None, &out, &proof, &mut Transcript::new(b"block")
        ),
        "honest transformer block must verify"
    );
}

#[test]
fn tampered_block_link_is_rejected() {
    let f = fixture(4, 4, 8);
    let (mut proof, out) = prove_block(
        &f.attn_cfg, &f.ffn_cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &f.exp, &f.recip, None,
        &f.wgate, &f.wup, &f.wdown, None, None, &mut Transcript::new(b"block"),
    );
    // Corrupt the attention→FFN link tensor h: the attention residual check must reject.
    proof.h[0] += Fr::from(1u64);
    assert!(
        !verify_block(
            &f.attn_cfg, &f.ffn_cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &f.exp, &f.recip, None,
            &f.wgate, &f.wup, &f.wdown, None, None, &out, &proof, &mut Transcript::new(b"block")
        ),
        "tampered attention→FFN link must be rejected"
    );
}
