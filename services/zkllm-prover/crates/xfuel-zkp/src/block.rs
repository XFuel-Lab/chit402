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
use crate::attention::{
    prove_attention, prove_committed_attention, verify_attention, verify_committed_attention,
    AttnConfig, AttnProof, CommittedAttnProof,
};
use crate::ffn::{
    prove_committed_ffn, prove_ffn, verify_committed_ffn, verify_ffn, CommittedFfnProof, FfnConfig,
    FfnProof, NormParams, RequantParams,
};
use crate::gadgets::LookupObligation;
use crate::pcs;
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
/// `exp_table`/`recip_table` drive the softmax, `act_table` the FFN activation, `ffn_requant` the
/// optional wide→code hop on the FFN gate, and the two `NormParams` the two RMSNorms (all `Some` ⇒
/// zero pending obligations). Returns `(proof, out)`.
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
    ffn_requant: Option<&RequantParams>,
    ffn_norm: Option<&NormParams>,
    tr: &mut Transcript,
) -> (BlockProof, Vec<Fr>) {
    let (attn, h) =
        prove_attention(attn_cfg, x, wq, wk, wv, wo, exp_table, recip_table, attn_norm, tr);
    let (ffn, out) = prove_ffn(ffn_cfg, &h, wgate, wup, wdown, act_table, ffn_requant, ffn_norm, tr);
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
    ffn_requant: Option<&RequantParams>,
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
        ffn_cfg, &proof.h, wgate, wup, wdown, out, &proof.ffn, act_table, ffn_requant, ffn_norm, tr,
    )
}

// ─── Committed (succinct) transformer block — M5.4b ───────────────────────────
//
// The capstone of the succinct sub-block toolbox: compose committed attention → committed FFN under
// one transcript so the verifier holds only the block's input/output commitments + the public
// weights. The seam is a *single shared commitment* `comm_h` — the attention residual output, reused
// verbatim as the FFN input:
//   h   = X + Attn(RMSNorm(X))   attention::…committed   (comm_x → comm_h)
//   out = h + FFN(RMSNorm(h))    ffn::…committed          (comm_h → comm_out)
// Both sub-blocks size their seq·d_model tensors from the *same* SRS via `pcs::keys`, which is
// deterministic, so the FFN's internally-committed input equals the attention output commitment
// byte-for-byte — the seam needs no linking argument, only reuse of the one carried `comm_h`.
// Fully-quantized: all norms + tables + the FFN requant are required, so the block is soundly argued
// end-to-end (the committed sibling of a zero-obligation [`prove_block`]).

/// A committed transformer-block proof: the two committed sub-blocks plus the shared seam commitment
/// `comm_h` (attention output = FFN input), carried once and threaded to both.
pub struct CommittedBlockProof {
    pub comm_h: pcs::Comm,
    pub attn: CommittedAttnProof,
    pub ffn: CommittedFfnProof,
}

/// Prove one transformer block succinctly. `x` is seq×d_model; attention weights `wq,wk,wv` are
/// d_model×d_head and `wo` is d_head×d_model; FFN weights `wgate,wup` are d_model×d_ff and `wdown` is
/// d_ff×d_model. `exp_table`/`recip_table` drive the softmax, `act_table` the FFN activation,
/// `ffn_requant` the gate wide→code hop, and the two `NormParams` the two RMSNorms. `params` is an
/// SRS with `max_vars ≥` every tensor width. Returns `(proof, comm_x, comm_out, out)`.
#[allow(clippy::too_many_arguments)]
pub fn prove_committed_block(
    attn_cfg: &AttnConfig,
    ffn_cfg: &FfnConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    attn_norm: &NormParams,
    wgate: &[Fr],
    wup: &[Fr],
    wdown: &[Fr],
    act_table: &ActivationTable,
    ffn_requant: &RequantParams,
    ffn_norm: &NormParams,
    params: &pcs::Params,
    tr: &mut Transcript,
) -> (CommittedBlockProof, pcs::Comm, pcs::Comm, Vec<Fr>) {
    let (attn, comm_x, comm_h, h) = prove_committed_attention(
        attn_cfg, x, wq, wk, wv, wo, attn_norm, exp_table, recip_table, params, tr,
    );
    let (ffn, comm_h_ffn, comm_out, out) = prove_committed_ffn(
        ffn_cfg, &h, wgate, wup, wdown, act_table, ffn_requant, ffn_norm, params, tr,
    );
    debug_assert_eq!(
        pcs::commitment_bytes(&comm_h),
        pcs::commitment_bytes(&comm_h_ffn),
        "the attention output and FFN input must commit identically (shared SRS ⇒ same key)"
    );
    (CommittedBlockProof { comm_h, attn, ffn }, comm_x, comm_out, out)
}

/// Succinctly verify a transformer-block proof from `comm_x`, `comm_out`, the public weights/tables,
/// and the block proof. The attention→FFN seam is enforced by passing the single carried `comm_h` as
/// both the attention output commitment and the FFN input commitment — tampering it breaks either the
/// attention residual opening or the FFN norm opening.
#[allow(clippy::too_many_arguments)]
pub fn verify_committed_block(
    attn_cfg: &AttnConfig,
    ffn_cfg: &FfnConfig,
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    attn_norm: &NormParams,
    wgate: &[Fr],
    wup: &[Fr],
    wdown: &[Fr],
    act_table: &ActivationTable,
    ffn_requant: &RequantParams,
    ffn_norm: &NormParams,
    comm_x: &pcs::Comm,
    comm_out: &pcs::Comm,
    proof: &CommittedBlockProof,
    params: &pcs::Params,
    tr: &mut Transcript,
) -> bool {
    if !verify_committed_attention(
        attn_cfg, wq, wk, wv, wo, attn_norm, exp_table, recip_table, comm_x, &proof.comm_h,
        &proof.attn, params, tr,
    ) {
        return false;
    }
    verify_committed_ffn(
        ffn_cfg, wgate, wup, wdown, act_table, ffn_requant, ffn_norm, &proof.comm_h, comm_out,
        &proof.ffn, params, tr,
    )
}
