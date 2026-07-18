//! Tests for the stochastic block-window spot-check (Tier-3b): Fiat–Shamir block selection bound to
//! the model + PBR commitments, and prove/verify over a selected window using the real per-block
//! prover.

use ark_std::{test_rng, UniformRand};
use xfuel_zkp::attention::AttnConfig;
use xfuel_zkp::block::{prove_block, verify_block};
use xfuel_zkp::ffn::FfnConfig;
use xfuel_zkp::manifest::{ActType, ModelManifest, NormType, PosType};
use xfuel_zkp::spotcheck::{prove_block_window, select_blocks, verify_block_window};
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
        family: "llama-spotcheck-test".into(),
        n_layers: 8,
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

/// A mock N-layer model: every layer shares one block config/weights (enough to exercise the
/// selection + window prove/verify machinery). Each selected block is proven as an isolated
/// statement `x → out` under the spot-check transcript.
struct Model {
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

fn model(seq: usize, d_model: usize, d_ff: usize) -> Model {
    let mut rng = test_rng();
    let m = manifest(d_model as u32, d_ff as u32);
    Model {
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

impl Model {
    fn prove_one(&self, _layer: usize, tr: &mut Transcript) -> (xfuel_zkp::block::BlockProof, Vec<Fr>) {
        prove_block(
            &self.attn_cfg, &self.ffn_cfg, &self.x, &self.wq, &self.wk, &self.wv, &self.wo,
            &self.exp, &self.recip, None, &self.wgate, &self.wup, &self.wdown, None, None, None, tr,
        )
    }

    fn verify_one(
        &self,
        _layer: usize,
        proof: &xfuel_zkp::block::BlockProof,
        out: &[Fr],
        tr: &mut Transcript,
    ) -> bool {
        verify_block(
            &self.attn_cfg, &self.ffn_cfg, &self.x, &self.wq, &self.wk, &self.wv, &self.wo,
            &self.exp, &self.recip, None, &self.wgate, &self.wup, &self.wdown, None, None, None,
            out, proof, tr,
        )
    }
}

const MODEL_C: [u8; 32] = [0xA5; 32];
const BINDING: [u8; 32] = [0x3C; 32];

#[test]
fn selection_is_deterministic_distinct_and_in_range() {
    let (n, k) = (8usize, 3usize);
    let s1 = select_blocks(&MODEL_C, &BINDING, n, k);
    let s2 = select_blocks(&MODEL_C, &BINDING, n, k);
    assert_eq!(s1, s2, "selection must be deterministic for the same commitments");
    assert_eq!(s1.len(), k, "must select exactly k blocks");
    assert!(s1.windows(2).all(|w| w[0] < w[1]), "indices must be sorted + distinct");
    assert!(s1.iter().all(|&i| i < n), "indices must be in range");
}

#[test]
fn selection_changes_with_the_binding() {
    // Any change to the computed trace changes output_hash → binding → re-rolls the window.
    let (n, k) = (8usize, 3usize);
    let base = select_blocks(&MODEL_C, &BINDING, n, k);
    let mut other_binding = BINDING;
    other_binding[0] ^= 0xFF;
    let changed = select_blocks(&MODEL_C, &other_binding, n, k);
    assert_ne!(base, changed, "a different binding must (almost always) reselect");
}

#[test]
fn honest_window_verifies() {
    let (n, k) = (8usize, 3usize);
    let m = model(4, 4, 8);
    let proof = prove_block_window(
        &MODEL_C, &BINDING, n, k, |l, tr| m.prove_one(l, tr), &mut Transcript::new(b"spot"),
    );
    assert_eq!(proof.selected.len(), k);
    assert!(
        verify_block_window(
            &MODEL_C, &BINDING, n, k, &proof, |l, p, o, tr| m.verify_one(l, p, o, tr),
            &mut Transcript::new(b"spot"),
        ),
        "an honest spot-check window must verify"
    );
}

#[test]
fn tampered_block_output_is_rejected() {
    let (n, k) = (8usize, 3usize);
    let m = model(4, 4, 8);
    let mut proof = prove_block_window(
        &MODEL_C, &BINDING, n, k, |l, tr| m.prove_one(l, tr), &mut Transcript::new(b"spot"),
    );
    // Corrupt a selected block's claimed output — that block's verify must reject.
    proof.outs[0][0] += Fr::from(1u64);
    assert!(
        !verify_block_window(
            &MODEL_C, &BINDING, n, k, &proof, |l, p, o, tr| m.verify_one(l, p, o, tr),
            &mut Transcript::new(b"spot"),
        ),
        "a tampered block output must be rejected"
    );
}

#[test]
fn cherry_picked_selection_is_rejected() {
    let (n, k) = (8usize, 3usize);
    let m = model(4, 4, 8);
    let mut proof = prove_block_window(
        &MODEL_C, &BINDING, n, k, |l, tr| m.prove_one(l, tr), &mut Transcript::new(b"spot"),
    );
    // Forge the claimed selection to a set the prover would have preferred — the verifier re-derives
    // the FS selection and must reject the mismatch.
    proof.selected[0] = (proof.selected[0] + 1) % n;
    proof.selected.sort_unstable();
    assert!(
        !verify_block_window(
            &MODEL_C, &BINDING, n, k, &proof, |l, p, o, tr| m.verify_one(l, p, o, tr),
            &mut Transcript::new(b"spot"),
        ),
        "a prover-chosen (non-FS) selection must be rejected"
    );
}
