//! Composition test for one full transformer block (attention sub-block → FFN sub-block under one
//! transcript).
//!
//! Note on scope: the attention half uses the softmax lookup tables (so its scores must be
//! in-domain), while the FFN half here runs the placeholder path — a fully-quantized, zero-obligation
//! *end-to-end* block additionally needs the inter-op requantization range-check (M5.3) so the
//! attention output re-enters the FFN's code domain. Each sub-block's own zero-obligation capability
//! is covered by `tests/attention.rs` and `tests/ffn.rs`.

use ark_std::{test_rng, UniformRand};
use xfuel_zkp::activation::{encode_i64, ActKind, ActivationTable};
use xfuel_zkp::attention::AttnConfig;
use xfuel_zkp::block::{
    prove_block, prove_committed_block, verify_block, verify_committed_block,
};
use xfuel_zkp::ffn::{FfnConfig, NormParams, RequantParams};
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};
use xfuel_zkp::norm::RsqrtTable;
use xfuel_zkp::range::RangeTable;
use xfuel_zkp::table::ScalarTable;
use xfuel_zkp::transcript::Transcript;
use xfuel_zkp::{pcs, Fr};

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
        &f.wgate, &f.wup, &f.wdown, None, None, None, &mut Transcript::new(b"block"),
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
            &f.wgate, &f.wup, &f.wdown, None, None, None, &out, &proof, &mut Transcript::new(b"block")
        ),
        "honest transformer block must verify"
    );
}

#[test]
fn tampered_block_link_is_rejected() {
    let f = fixture(4, 4, 8);
    let (mut proof, out) = prove_block(
        &f.attn_cfg, &f.ffn_cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &f.exp, &f.recip, None,
        &f.wgate, &f.wup, &f.wdown, None, None, None, &mut Transcript::new(b"block"),
    );
    // Corrupt the attention→FFN link tensor h: the attention residual check must reject.
    proof.h[0] += Fr::from(1u64);
    assert!(
        !verify_block(
            &f.attn_cfg, &f.ffn_cfg, &f.x, &f.wq, &f.wk, &f.wv, &f.wo, &f.exp, &f.recip, None,
            &f.wgate, &f.wup, &f.wdown, None, None, None, &out, &proof, &mut Transcript::new(b"block")
        ),
        "tampered attention→FFN link must be rejected"
    );
}

// ─── Committed (succinct) transformer block — M5.4b ───────────────────────────

/// Identity RMSNorm for `d`: `ss = d`, `inv_rms(d) = √d/√d = 1`, weight `1` ⇒ `norm(x) = x`.
fn identity_rsqrt(d: usize) -> RsqrtTable {
    let t = RsqrtTable::new(64, (d as f64).sqrt(), 0.0);
    assert_eq!(t.apply(&[Fr::from(d as u64)])[0], Fr::from(1u64));
    t
}

/// A fully-quantized committed-block fixture. The trick that keeps both halves in-domain: `wo = 0`,
/// so the attention output is `h = x + Ctx·0 = x = 1` (all-ones) — exactly the wide-gate FFN input.
/// The FFN then runs the proven wide→code requant path (`gate = wide`, `⌊·/4⌋ ∈ [0,16)`).
#[allow(clippy::type_complexity)]
fn committed_block_inputs() -> (
    AttnConfig,
    FfnConfig,
    Vec<Fr>,                       // x
    (Vec<Fr>, Vec<Fr>, Vec<Fr>, Vec<Fr>), // wq, wk, wv, wo
    (Vec<Fr>, Vec<Fr>, Vec<Fr>),   // wgate, wup, wdown
    ScalarTable,                   // exp
    ScalarTable,                   // recip
    ActivationTable,               // act
    RangeTable,                    // r_table
    RangeTable,                    // q_table
    RsqrtTable,                    // rsqrt (shared: d_model = 4)
    Vec<Fr>,                       // w_norm
) {
    let (seq, d_model, d_ff) = (2usize, 4usize, 8usize);
    let attn_cfg = AttnConfig { seq, d_model, d_head: d_model, norm_name: "rmsnorm" };
    let m = manifest(d_model as u32, d_ff as u32);
    let ffn_cfg = FfnConfig::from_manifest(&m, seq);

    let x = vec![Fr::from(1u64); seq * d_model];
    let (wq, wk, wv) = (identity(d_model), identity(d_model), identity(d_model));
    let wo = vec![Fr::from(0u64); d_model * d_model]; // zero ⇒ h = x

    // Wide gate: row 0 carries the wide codes, up = 1, down = 1 (identical to the FFN fixture).
    let wide = [3u64, 12, 60, 40, 8, 44, 16, 28];
    let mut wgate = vec![Fr::from(0u64); d_model * d_ff];
    let mut wup = vec![Fr::from(0u64); d_model * d_ff];
    for j in 0..d_ff {
        wgate[j] = Fr::from(wide[j]);
        wup[j] = Fr::from(1u64);
    }
    let wdown = vec![encode_i64(1); d_ff * d_model];

    let exp = ScalarTable::new(16, |c| c as i64); // f(0) = 0 (mask sentinel)
    let recip = ScalarTable::new(64, |r| if r == 0 { 0 } else { 64 / r as i64 });
    let act = ActivationTable::new(ActKind::Silu, 16, 0.5);
    let (r_table, q_table) = (RangeTable::new(4), RangeTable::new(16));
    let rsqrt = identity_rsqrt(d_model);
    let w_norm = vec![Fr::from(1u64); d_model];

    (
        attn_cfg, ffn_cfg, x, (wq, wk, wv, wo), (wgate, wup, wdown), exp, recip, act, r_table,
        q_table, rsqrt, w_norm,
    )
}

/// SRS for the block: the length-64 recip/rsqrt table domains dominate (→ 6 vars).
fn block_srs() -> pcs::Params {
    pcs::setup(6, &mut test_rng())
}

#[test]
fn committed_block_verifies() {
    let (attn_cfg, ffn_cfg, x, (wq, wk, wv, wo), (wgate, wup, wdown), exp, recip, act, r_table, q_table, rsqrt, w_norm) =
        committed_block_inputs();
    let attn_norm = NormParams { weight: &w_norm, table: &rsqrt };
    let ffn_norm = NormParams { weight: &w_norm, table: &rsqrt };
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let params = block_srs();

    let (proof, comm_x, comm_out, _out) = prove_committed_block(
        &attn_cfg, &ffn_cfg, &x, &wq, &wk, &wv, &wo, &exp, &recip, &attn_norm, &wgate, &wup, &wdown,
        &act, &rp, &ffn_norm, &params, &mut Transcript::new(b"cblk"),
    );
    assert!(
        verify_committed_block(
            &attn_cfg, &ffn_cfg, &wq, &wk, &wv, &wo, &exp, &recip, &attn_norm, &wgate, &wup, &wdown,
            &act, &rp, &ffn_norm, &comm_x, &comm_out, &proof, &params, &mut Transcript::new(b"cblk"),
        ),
        "honest committed block (attention → FFN, shared seam commitment) must verify"
    );
}

#[test]
fn committed_block_wrong_output_commitment_is_rejected() {
    let (attn_cfg, ffn_cfg, x, (wq, wk, wv, wo), (wgate, wup, wdown), exp, recip, act, r_table, q_table, rsqrt, w_norm) =
        committed_block_inputs();
    let attn_norm = NormParams { weight: &w_norm, table: &rsqrt };
    let ffn_norm = NormParams { weight: &w_norm, table: &rsqrt };
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let params = block_srs();

    let (proof, comm_x, _comm_out, out) = prove_committed_block(
        &attn_cfg, &ffn_cfg, &x, &wq, &wk, &wv, &wo, &exp, &recip, &attn_norm, &wgate, &wup, &wdown,
        &act, &rp, &ffn_norm, &params, &mut Transcript::new(b"cblk"),
    );
    let (ck_a, _vk) = pcs::keys(&params, 3); // seq*d_model = 2*4 = 8 → 3 vars
    let mut bad = out.clone();
    bad[0] += Fr::from(1u64);
    let bad_comm_out = pcs::commit(&ck_a, &bad);
    assert!(
        !verify_committed_block(
            &attn_cfg, &ffn_cfg, &wq, &wk, &wv, &wo, &exp, &recip, &attn_norm, &wgate, &wup, &wdown,
            &act, &rp, &ffn_norm, &comm_x, &bad_comm_out, &proof, &params, &mut Transcript::new(b"cblk"),
        ),
        "a wrong block output commitment must be rejected"
    );
}

#[test]
fn committed_block_tampered_seam_is_rejected() {
    let (attn_cfg, ffn_cfg, x, (wq, wk, wv, wo), (wgate, wup, wdown), exp, recip, act, r_table, q_table, rsqrt, w_norm) =
        committed_block_inputs();
    let attn_norm = NormParams { weight: &w_norm, table: &rsqrt };
    let ffn_norm = NormParams { weight: &w_norm, table: &rsqrt };
    let rp = RequantParams { bias: Fr::from(0u64), divisor: 4, r_table: &r_table, q_table: &q_table };
    let params = block_srs();

    let (mut proof, comm_x, comm_out, _out) = prove_committed_block(
        &attn_cfg, &ffn_cfg, &x, &wq, &wk, &wv, &wo, &exp, &recip, &attn_norm, &wgate, &wup, &wdown,
        &act, &rp, &ffn_norm, &params, &mut Transcript::new(b"cblk"),
    );
    // The seam commitment comm_h is the attention output AND the FFN input: swapping it breaks the
    // attention residual opening (out side) and the FFN norm opening (in side) at once.
    let (ck_a, _vk) = pcs::keys(&params, 3); // seq*d_model = 8 → 3 vars
    proof.comm_h = pcs::commit(&ck_a, &vec![Fr::from(9u64); 8]);
    assert!(
        !verify_committed_block(
            &attn_cfg, &ffn_cfg, &wq, &wk, &wv, &wo, &exp, &recip, &attn_norm, &wgate, &wup, &wdown,
            &act, &rp, &ffn_norm, &comm_x, &comm_out, &proof, &params, &mut Transcript::new(b"cblk"),
        ),
        "a tampered attention→FFN seam commitment must be rejected"
    );
}
