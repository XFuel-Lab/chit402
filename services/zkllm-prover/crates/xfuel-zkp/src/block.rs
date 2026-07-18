//! One full transformer block — the composition of [`crate::attention`] and [`crate::ffn`] under a
//! single Fiat–Shamir transcript. Pre-norm decoder layout:
//! ```text
//!   h   = X + Attn(norm₁(X))     (attention sub-block — includes its own norm + residual)
//!   out = h + FFN(norm₂(h))      (SwiGLU FFN sub-block — includes its own norm + residual)
//! ```
//! In quantized mode (both norms + activation + softmax tables supplied) the whole block has **zero
//! pending obligations** — every step is soundly argued. This is the M5.2b-cont milestone: *one full
//! transformer block proven*. Multi-head/GQA and RoPE are the remaining witness-assembly extensions
//! documented in [`crate::attention`]; the cryptographic argument set is complete here.

use crate::activation::ActivationTable;
use crate::attention::{prove_attention, verify_attention, AttnConfig, AttnProof};
use crate::ffn::{prove_ffn, verify_ffn, FfnConfig, FfnProof, NormParams};
use crate::gadgets::LookupObligation;
use crate::table::ScalarTable;
use crate::transcript::Transcript;
use crate::Fr;

/// A proof for one transformer block: the attention sub-block, its output `h` (the FFN's input),
/// and the FFN sub-block.
pub struct BlockProof {
    pub attn: AttnProof,
    pub h: Vec<Fr>,
    pub ffn: FfnProof,
}

impl BlockProof {
    /// All pending obligations across both sub-blocks (empty in fully-quantized mode).
    pub fn obligations(&self) -> Vec<LookupObligation> {
        let mut o = self.attn.obligations.clone();
        o.extend(self.ffn.obligations.iter().cloned());
        o
    }
}

/// Prove one transformer block. `x` is seq×d_model. Attention weights `wq,wk,wv` are d_model×d_head,
/// `wo` is d_head×d_model; FFN weights `wgate,wup` are d_model×d_ff, `wdown` is d_ff×d_model. The
/// `exp_table`/`recip_table` drive the softmax, `act_table` the FFN activation, and the two
/// `NormParams` the two RMSNorms (all `Some` ⇒ zero pending obligations). Returns `(proof, out)`.
#[allow(clippy::too_many_arguments)]
pub fn prove_block(
    attn_cfg: &AttnConfig,
    ffn_cfg: &FfnConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    attn_norm: Option<&NormParams>,
    wgate: &[Fr],
    wup: &[Fr],
    wdown: &[Fr],
    act_table: Option<&ActivationTable>,
    ffn_norm: Option<&NormParams>,
    tr: &mut Transcript,
) -> (BlockProof, Vec<Fr>) {
    let (attn, h) =
        prove_attention(attn_cfg, x, wq, wk, wv, wo, exp_table, recip_table, attn_norm, tr);
    let (ffn, out) = prove_ffn(ffn_cfg, &h, wgate, wup, wdown, act_table, ffn_norm, tr);
    (BlockProof { attn, h, ffn }, out)
}

/// Verify one transformer block proof against public `x`, weights, tables and claimed `out`.
#[allow(clippy::too_many_arguments)]
pub fn verify_block(
    attn_cfg: &AttnConfig,
    ffn_cfg: &FfnConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    attn_norm: Option<&NormParams>,
    wgate: &[Fr],
    wup: &[Fr],
    wdown: &[Fr],
    act_table: Option<&ActivationTable>,
    ffn_norm: Option<&NormParams>,
    out: &[Fr],
    proof: &BlockProof,
    tr: &mut Transcript,
) -> bool {
    if !verify_attention(
        attn_cfg, x, wq, wk, wv, wo, &proof.h, &proof.attn, exp_table, recip_table, attn_norm, tr,
    ) {
        return false;
    }
    verify_ffn(
        ffn_cfg, &proof.h, wgate, wup, wdown, out, &proof.ffn, act_table, ffn_norm, tr,
    )
}
