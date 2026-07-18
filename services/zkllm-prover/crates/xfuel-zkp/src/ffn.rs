//! SwiGLU feed-forward sub-block — the first full **composition** of the matmul core with the
//! [`crate::gadgets`] layer under a single Fiat–Shamir transcript.
//!
//! For a residual-stream input `X` (seq × d_model) with a pre-norm architecture:
//! ```text
//!   xn   = norm(X)                     (obligation: rmsnorm/layernorm — M5.2b)
//!   gate = xn · Wgate                  (matmul proof)
//!   up   = xn · Wup                    (matmul proof)
//!   act  = SiLU(gate)                  (obligation: silu — M5.2b)
//!   h    = act ⊙ up                    (hadamard proof — sound)
//!   down = h · Wdown                   (matmul proof)
//!   out  = X + down                    (residual — direct, linear)
//! ```
//! Config is driven by [`ModelManifest`] (`d_model`, `d_ff`, `act`, `norm`), so GPT-2-style FFN
//! (GeLU, no gate) falls out as a subset once the activation lookup lands. What is **soundly
//! proven today** (quantized mode): all three linear projections, the SwiGLU gating, the SiLU/GeLU
//! **activation** (lookup), and the **RMSNorm** (via [`crate::norm`]) — so a quantized FFN block has
//! **zero pending obligations**. The placeholder path (no tables) keeps typed [`LookupObligation`]s
//! for exercising the linear+gating composition on arbitrary field inputs. Attention
//! (RoPE/GQA/softmax) is the sibling sub-block, M5.2b-cont.

use crate::activation::ActivationTable;
use crate::gadgets::{
    act_name, apply_activation, prove_hadamard, verify_hadamard, HadamardProof, LookupObligation,
};
use crate::lookup::LookupProof;
use crate::manifest::{ModelManifest, NormType};
use crate::matmul::{prove as prove_mm, verify as verify_mm, MatMul, MatMulProof};
use crate::norm::{prove_rmsnorm, verify_rmsnorm, RmsNormProof, RsqrtTable};
use crate::transcript::Transcript;
use crate::Fr;

/// Norm parameters for the (quantized) sound path: a per-channel weight and the canonical `rsqrt`
/// table. When supplied, `norm(X)` is **soundly proven** by the [`crate::norm`] gadget and the
/// `rmsnorm`/`layernorm` obligation is discharged.
pub struct NormParams<'a> {
    pub weight: &'a [Fr],
    pub table: &'a RsqrtTable,
}

/// FFN geometry + gadget selection, derived from a [`ModelManifest`].
pub struct FfnConfig {
    pub seq: usize,
    pub d_model: usize,
    pub d_ff: usize,
    pub act_name: &'static str,
    pub norm_name: &'static str,
    act: crate::manifest::ActType,
}

impl FfnConfig {
    pub fn from_manifest(m: &ModelManifest, seq: usize) -> Self {
        Self {
            seq,
            d_model: m.d_model as usize,
            d_ff: m.d_ff as usize,
            act_name: act_name(m.act),
            norm_name: match m.norm {
                NormType::RmsNorm => "rmsnorm",
                NormType::LayerNorm => "layernorm",
            },
            act: m.act,
        }
    }
}

/// A proof for one SwiGLU FFN sub-block. Intermediate tensors are carried explicitly (M5.2
/// verifiable-computation model); M5.4 replaces them with polynomial-commitment openings.
pub struct FfnProof {
    pub seq: usize,
    pub d_model: usize,
    pub d_ff: usize,
    pub xn: Vec<Fr>,
    pub gate: Vec<Fr>,
    pub up: Vec<Fr>,
    pub act: Vec<Fr>,
    pub h: Vec<Fr>,
    pub down: Vec<Fr>,
    pub p_gate: MatMulProof,
    pub p_up: MatMulProof,
    pub p_down: MatMulProof,
    pub p_had: HadamardProof,
    /// When `Some`, the normalization is **soundly proven** by this RMSNorm gadget and the
    /// `rmsnorm`/`layernorm` obligation is discharged. When `None`, `xn` is an identity placeholder
    /// and the norm remains a pending `obligations` entry.
    pub p_norm: Option<RmsNormProof>,
    /// When `Some`, the activation is **soundly proven** by this lookup (quantized mode) and the
    /// `silu`/`gelu` obligation is discharged. When `None`, the activation is a placeholder and
    /// remains a pending `obligations` entry.
    pub act_lookup: Option<LookupProof>,
    pub obligations: Vec<LookupObligation>,
}

/// Reference SwiGLU normalization placeholder (see [`apply_activation`] note — sound norm is M5.2b).
fn apply_norm(x: &[Fr]) -> Vec<Fr> {
    x.to_vec()
}

/// Prove one SwiGLU FFN sub-block. `x` is seq×d_model; weights are row-major
/// (`wgate,wup`: d_model×d_ff; `wdown`: d_ff×d_model). Returns `(proof, out)`.
///
/// When `norm` is `Some` (quantized mode), `xn = RMSNorm(x)` is **soundly proven** by the
/// [`crate::norm`] gadget and the `rmsnorm` obligation is discharged; when `None`, `xn` is an
/// identity placeholder and the norm stays a pending obligation.
///
/// When `act_table` is `Some` (quantized mode), the activation is computed from the table and
/// **soundly proven** by a lookup (the `silu`/`gelu` obligation is discharged); the gate values
/// must be valid codes for that table. When `None`, the activation is a placeholder (identity) and
/// stays a pending obligation — used to exercise the linear+gating composition on arbitrary field
/// inputs.
#[allow(clippy::too_many_arguments)]
pub fn prove_ffn(
    cfg: &FfnConfig,
    x: &[Fr],
    wgate: &[Fr],
    wup: &[Fr],
    wdown: &[Fr],
    act_table: Option<&ActivationTable>,
    norm: Option<&NormParams>,
    tr: &mut Transcript,
) -> (FfnProof, Vec<Fr>) {
    let (seq, d_model, d_ff) = (cfg.seq, cfg.d_model, cfg.d_ff);
    assert_eq!(x.len(), seq * d_model);
    assert_eq!(wgate.len(), d_model * d_ff);
    assert_eq!(wup.len(), d_model * d_ff);
    assert_eq!(wdown.len(), d_ff * d_model);

    let mut obligations = Vec::new();
    let (xn, p_norm) = match norm {
        Some(np) => {
            let (pn, xn) = prove_rmsnorm(x, np.weight, seq, d_model, np.table, tr);
            (xn, Some(pn))
        }
        None => {
            let xn = apply_norm(x);
            obligations.push(LookupObligation::new(norm_op(cfg.norm_name), x, &xn));
            (xn, None)
        }
    };

    let mm_gate = MatMul::new(seq, d_model, d_ff, xn.clone(), wgate.to_vec());
    let gate = mm_gate.c.clone();
    let p_gate = prove_mm(&mm_gate, tr);

    let mm_up = MatMul::new(seq, d_model, d_ff, xn.clone(), wup.to_vec());
    let up = mm_up.c.clone();
    let p_up = prove_mm(&mm_up, tr);

    let (act, act_lookup) = match act_table {
        Some(table) => {
            let act = table.apply(&gate);
            let proof = table.prove(&gate, &act, tr);
            (act, Some(proof))
        }
        None => {
            let act = apply_activation(cfg.act, &gate);
            obligations.push(LookupObligation::new(cfg.act_name, &gate, &act));
            (act, None)
        }
    };

    let h: Vec<Fr> = act.iter().zip(up.iter()).map(|(a, b)| *a * *b).collect();
    let p_had = prove_hadamard(&act, &up, &h, tr);

    let mm_down = MatMul::new(seq, d_ff, d_model, h.clone(), wdown.to_vec());
    let down = mm_down.c.clone();
    let p_down = prove_mm(&mm_down, tr);

    let out: Vec<Fr> = x.iter().zip(down.iter()).map(|(a, b)| *a + *b).collect();

    let proof = FfnProof {
        seq,
        d_model,
        d_ff,
        xn,
        gate,
        up,
        act,
        h,
        down,
        p_gate,
        p_up,
        p_down,
        p_had,
        p_norm,
        act_lookup,
        obligations,
    };
    (proof, out)
}

/// Verify a SwiGLU FFN sub-block proof against public `x`, weights and claimed `out`.
/// Checks — in quantized mode — the RMSNorm gadget, then the three matmul proofs, the activation
/// lookup, the gating Hadamard proof, and the residual add. Pass the same `act_table` / `norm` used
/// to prove (or `None` for the placeholder paths). Remaining [`LookupObligation`]s are returned to
/// the caller.
#[allow(clippy::too_many_arguments)]
pub fn verify_ffn(
    cfg: &FfnConfig,
    x: &[Fr],
    wgate: &[Fr],
    wup: &[Fr],
    wdown: &[Fr],
    out: &[Fr],
    proof: &FfnProof,
    act_table: Option<&ActivationTable>,
    norm: Option<&NormParams>,
    tr: &mut Transcript,
) -> bool {
    let (seq, d_model, d_ff) = (cfg.seq, cfg.d_model, cfg.d_ff);
    if proof.seq != seq || proof.d_model != d_model || proof.d_ff != d_ff {
        return false;
    }
    if proof.xn.len() != seq * d_model
        || proof.gate.len() != seq * d_ff
        || proof.up.len() != seq * d_ff
        || proof.act.len() != seq * d_ff
        || proof.h.len() != seq * d_ff
        || proof.down.len() != seq * d_model
        || out.len() != seq * d_model
    {
        return false;
    }

    // Normalization: sound RMSNorm gadget (quantized) or placeholder obligation. Must come first —
    // it feeds the transcript before the projections, matching the prover.
    let mut expected_obl = Vec::new();
    match (norm, &proof.p_norm) {
        (Some(np), Some(pn)) => {
            if !verify_rmsnorm(x, np.weight, seq, d_model, &proof.xn, pn, np.table, tr) {
                return false;
            }
        }
        (None, None) => {
            expected_obl.push(LookupObligation::new(norm_op(cfg.norm_name), x, &proof.xn));
        }
        // Mode/proof mismatch (quantized verify against placeholder proof or vice-versa).
        _ => return false,
    }

    if !verify_mm(seq, d_model, d_ff, &proof.xn, wgate, &proof.gate, &proof.p_gate, tr) {
        return false;
    }
    if !verify_mm(seq, d_model, d_ff, &proof.xn, wup, &proof.up, &proof.p_up, tr) {
        return false;
    }

    // Activation: sound lookup (quantized) or placeholder obligation.
    match (act_table, &proof.act_lookup) {
        (Some(table), Some(lk)) => {
            if !table.verify(&proof.gate, &proof.act, lk, tr) {
                return false;
            }
        }
        (None, None) => {
            expected_obl.push(LookupObligation::new(cfg.act_name, &proof.gate, &proof.act));
        }
        // Mode/proof mismatch (quantized verify against placeholder proof or vice-versa).
        _ => return false,
    }

    if !verify_hadamard(&proof.act, &proof.up, &proof.h, &proof.p_had, tr) {
        return false;
    }
    if !verify_mm(seq, d_ff, d_model, &proof.h, wdown, &proof.down, &proof.p_down, tr) {
        return false;
    }

    // Residual: out = x + down (linear, checked directly).
    for i in 0..out.len() {
        if out[i] != x[i] + proof.down[i] {
            return false;
        }
    }

    proof.obligations == expected_obl
}

fn norm_op(name: &str) -> &'static str {
    if name == "layernorm" {
        "layernorm"
    } else {
        "rmsnorm"
    }
}
