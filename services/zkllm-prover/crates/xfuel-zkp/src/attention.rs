//! Causal self-attention sub-block — the sibling of [`crate::ffn`], composing the matmul core with
//! the softmax argument under one Fiat–Shamir transcript.
//!
//! Pre-norm, single-head, causal (decoder) attention on a residual-stream input `X` (seq × d_model):
//! ```text
//!   xn     = norm(X)                          (RMSNorm gadget — sound, quantized)
//!   Q,K,V  = xn·Wq , xn·Wk , xn·Wv            (matmul proofs)          seq × d_head
//!   S      = Q·Kᵀ                             (matmul proof)           seq × seq
//!   Sm     = causal_mask(S)                   (public: keys j>i → the mask sentinel code 0)
//!   E      = exp(Sm)                          (logup lookup — softmax numerator)
//!   z_i    = Σ_j E[i,j]                        (linear row-sum, checked directly)
//!   r_i    = 1 / z_i                          (logup lookup — reciprocal for normalization)
//!   P      = E ⊙ broadcast_rows(r)            (hadamard proof)  →  P[i,j] = E[i,j]/z_i (softmax)
//!   Ctx    = P·V                              (matmul proof)           seq × d_head
//!   O      = Ctx·Wo                           (matmul proof)           seq × d_model
//!   out    = X + O                            (residual — direct, linear)
//! ```
//! **Sound today (quantized mode):** all projections + scores + context + output (matmul), the
//! softmax numerator `exp` and the normalization reciprocal (logup lookups), the normalization
//! scaling (hadamard), and — via [`crate::norm`] — the RMSNorm. A quantized single-head attention
//! block has **zero pending obligations**.
//!
//! **Deliberately scoped (M5.2b-cont follow-ups, all reuse this core):**
//! * **Multi-head + GQA** — an outer loop over heads that slices `Q/K/V` and concatenates `Ctx`;
//!   pure witness assembly, no new argument.
//! * **RoPE** — a public-linear (fixed-point cos/sin) rotation of `Q,K`, provable by direct
//!   recomputation like the residual; omit it here (learned-/no-positional attention, e.g. GPT-2).
//! * **`1/sqrt(d_head)` score scale** and the score→code **requantization** fold into the `exp`
//!   table's domain (a canonical-table parameter); exact inter-op requant range-checks are M5.3.
//!
//! Trust boundary: the same *verifiable-computation* reduction as the rest of M5.x (verifier holds
//! tensors + advice; PCS binding + Groth16 wrap is M5.4).

use crate::gadgets::{prove_hadamard, verify_hadamard, HadamardProof, LookupObligation};
use crate::lookup::LookupProof;
use crate::manifest::{ModelManifest, NormType};
use crate::matmul::{prove as prove_mm, verify as verify_mm, MatMul, MatMulProof};
use crate::norm::{prove_rmsnorm, verify_rmsnorm, RmsNormProof};
use crate::table::ScalarTable;
use crate::transcript::Transcript;
use crate::Fr;
use ark_ff::Zero;

pub use crate::ffn::NormParams;

/// Attention geometry + gadget selection.
pub struct AttnConfig {
    pub seq: usize,
    pub d_model: usize,
    pub d_head: usize,
    pub norm_name: &'static str,
}

impl AttnConfig {
    /// Single-head config from a manifest (`d_head = d_model`, i.e. one head over the full width).
    pub fn from_manifest(m: &ModelManifest, seq: usize) -> Self {
        Self {
            seq,
            d_model: m.d_model as usize,
            d_head: m.d_model as usize,
            norm_name: match m.norm {
                NormType::RmsNorm => "rmsnorm",
                NormType::LayerNorm => "layernorm",
            },
        }
    }
}

/// A proof for one causal self-attention sub-block. Intermediate tensors are carried explicitly
/// (M5.2 verifiable-computation model); M5.4 replaces them with polynomial-commitment openings.
pub struct AttnProof {
    pub seq: usize,
    pub d_model: usize,
    pub d_head: usize,
    pub xn: Vec<Fr>,
    pub q: Vec<Fr>,
    pub k: Vec<Fr>,
    pub v: Vec<Fr>,
    pub scores: Vec<Fr>,
    pub exps: Vec<Fr>,
    pub rowsum: Vec<Fr>,
    pub recip: Vec<Fr>,
    pub probs: Vec<Fr>,
    pub ctx: Vec<Fr>,
    pub o: Vec<Fr>,
    pub p_norm: Option<RmsNormProof>,
    pub p_q: MatMulProof,
    pub p_k: MatMulProof,
    pub p_v: MatMulProof,
    pub p_scores: MatMulProof,
    pub p_exp: LookupProof,
    pub p_recip: LookupProof,
    pub p_prob: HadamardProof,
    pub p_ctx: MatMulProof,
    pub p_o: MatMulProof,
    pub obligations: Vec<LookupObligation>,
}

fn norm_op(name: &str) -> &'static str {
    if name == "layernorm" {
        "layernorm"
    } else {
        "rmsnorm"
    }
}

/// Transpose a `rows × cols` row-major matrix into `cols × rows`.
fn transpose(m: &[Fr], rows: usize, cols: usize) -> Vec<Fr> {
    let mut out = vec![Fr::zero(); rows * cols];
    for r in 0..rows {
        for c in 0..cols {
            out[c * rows + r] = m[r * cols + c];
        }
    }
    out
}

/// Causal mask: keys `j > i` are set to the sentinel code `0` (whose `exp`-table image is 0).
fn causal_mask(scores: &[Fr], seq: usize) -> Vec<Fr> {
    let mut out = scores.to_vec();
    for i in 0..seq {
        for j in (i + 1)..seq {
            out[i * seq + j] = Fr::zero();
        }
    }
    out
}

/// Per-row sums of a `rows × cols` row-major matrix.
fn row_sums(m: &[Fr], rows: usize, cols: usize) -> Vec<Fr> {
    let mut out = vec![Fr::zero(); rows];
    for i in 0..rows {
        let mut acc = Fr::zero();
        for j in 0..cols {
            acc += m[i * cols + j];
        }
        out[i] = acc;
    }
    out
}

/// Broadcast a per-row column `v` (len `rows`) across `cols` → `bc[i*cols+j] = v[i]`.
fn broadcast_rows(v: &[Fr], cols: usize) -> Vec<Fr> {
    let mut out = Vec::with_capacity(v.len() * cols);
    for &vi in v {
        for _ in 0..cols {
            out.push(vi);
        }
    }
    out
}

/// Prove one causal self-attention sub-block. `x` is seq×d_model; `wq,wk,wv` are d_model×d_head and
/// `wo` is d_head×d_model (row-major). `exp_table` is the softmax-numerator table (its code `0` must
/// map to `0` — the causal-mask sentinel); `recip_table` is the row-sum reciprocal. `norm` mirrors
/// [`crate::ffn`]: `Some` proves RMSNorm soundly, `None` keeps an identity placeholder + obligation.
/// Returns `(proof, out)`.
#[allow(clippy::too_many_arguments)]
pub fn prove_attention(
    cfg: &AttnConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    norm: Option<&NormParams>,
    tr: &mut Transcript,
) -> (AttnProof, Vec<Fr>) {
    let (seq, d_model, d_head) = (cfg.seq, cfg.d_model, cfg.d_head);
    assert_eq!(x.len(), seq * d_model);
    assert_eq!(wq.len(), d_model * d_head);
    assert_eq!(wk.len(), d_model * d_head);
    assert_eq!(wv.len(), d_model * d_head);
    assert_eq!(wo.len(), d_head * d_model);
    assert_eq!(exp_table.out_codes[0], Fr::zero(), "exp table code 0 must map to 0 (mask sentinel)");

    let mut obligations = Vec::new();
    let (xn, p_norm) = match norm {
        Some(np) => {
            let (pn, xn) = prove_rmsnorm(x, np.weight, seq, d_model, np.table, tr);
            (xn, Some(pn))
        }
        None => {
            let xn = x.to_vec();
            obligations.push(LookupObligation::new(norm_op(cfg.norm_name), x, &xn));
            (xn, None)
        }
    };

    let mmq = MatMul::new(seq, d_model, d_head, xn.clone(), wq.to_vec());
    let q = mmq.c.clone();
    let p_q = prove_mm(&mmq, tr);

    let mmk = MatMul::new(seq, d_model, d_head, xn.clone(), wk.to_vec());
    let k = mmk.c.clone();
    let p_k = prove_mm(&mmk, tr);

    let mmv = MatMul::new(seq, d_model, d_head, xn.clone(), wv.to_vec());
    let v = mmv.c.clone();
    let p_v = prove_mm(&mmv, tr);

    // Scores S = Q·Kᵀ (Kᵀ is d_head×seq, row-major transpose of K).
    let kt = transpose(&k, seq, d_head);
    let mms = MatMul::new(seq, d_head, seq, q.clone(), kt);
    let scores = mms.c.clone();
    let p_scores = prove_mm(&mms, tr);

    // Softmax numerator: E = exp(causal_mask(S)) via logup lookup.
    let masked = causal_mask(&scores, seq);
    let exps = exp_table.apply(&masked);
    let p_exp = exp_table.prove(&masked, &exps, tr);

    // Row sums (linear, checked directly) → reciprocals via logup lookup.
    let rowsum = row_sums(&exps, seq, seq);
    let recip = recip_table.apply(&rowsum);
    let p_recip = recip_table.prove(&rowsum, &recip, tr);

    // P = E ⊙ broadcast_rows(r)  (softmax probabilities), proven by Hadamard.
    let recip_bc = broadcast_rows(&recip, seq);
    let probs: Vec<Fr> = exps.iter().zip(recip_bc.iter()).map(|(e, r)| *e * *r).collect();
    let p_prob = prove_hadamard(&exps, &recip_bc, &probs, tr);

    // Context Ctx = P·V, output O = Ctx·Wo.
    let mmc = MatMul::new(seq, seq, d_head, probs.clone(), v.clone());
    let ctx = mmc.c.clone();
    let p_ctx = prove_mm(&mmc, tr);

    let mmo = MatMul::new(seq, d_head, d_model, ctx.clone(), wo.to_vec());
    let o = mmo.c.clone();
    let p_o = prove_mm(&mmo, tr);

    let out: Vec<Fr> = x.iter().zip(o.iter()).map(|(a, b)| *a + *b).collect();

    let proof = AttnProof {
        seq,
        d_model,
        d_head,
        xn,
        q,
        k,
        v,
        scores,
        exps,
        rowsum,
        recip,
        probs,
        ctx,
        o,
        p_norm,
        p_q,
        p_k,
        p_v,
        p_scores,
        p_exp,
        p_recip,
        p_prob,
        p_ctx,
        p_o,
        obligations,
    };
    (proof, out)
}

/// Verify a causal self-attention sub-block proof against public `x`, weights, tables and `out`.
#[allow(clippy::too_many_arguments)]
pub fn verify_attention(
    cfg: &AttnConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    out: &[Fr],
    proof: &AttnProof,
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    norm: Option<&NormParams>,
    tr: &mut Transcript,
) -> bool {
    let (seq, d_model, d_head) = (cfg.seq, cfg.d_model, cfg.d_head);
    if proof.seq != seq || proof.d_model != d_model || proof.d_head != d_head {
        return false;
    }
    if proof.xn.len() != seq * d_model
        || proof.q.len() != seq * d_head
        || proof.k.len() != seq * d_head
        || proof.v.len() != seq * d_head
        || proof.scores.len() != seq * seq
        || proof.exps.len() != seq * seq
        || proof.rowsum.len() != seq
        || proof.recip.len() != seq
        || proof.probs.len() != seq * seq
        || proof.ctx.len() != seq * d_head
        || proof.o.len() != seq * d_model
        || out.len() != seq * d_model
    {
        return false;
    }
    if exp_table.out_codes[0] != Fr::zero() {
        return false;
    }

    // Normalization: sound RMSNorm gadget (quantized) or placeholder obligation (must come first).
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
        _ => return false,
    }

    if !verify_mm(seq, d_model, d_head, &proof.xn, wq, &proof.q, &proof.p_q, tr) {
        return false;
    }
    if !verify_mm(seq, d_model, d_head, &proof.xn, wk, &proof.k, &proof.p_k, tr) {
        return false;
    }
    if !verify_mm(seq, d_model, d_head, &proof.xn, wv, &proof.v, &proof.p_v, tr) {
        return false;
    }

    // Scores S = Q·Kᵀ (verifier reconstructs Kᵀ from the bound K).
    let kt = transpose(&proof.k, seq, d_head);
    if !verify_mm(seq, d_head, seq, &proof.q, &kt, &proof.scores, &proof.p_scores, tr) {
        return false;
    }

    // E = exp(causal_mask(S)) (verifier reconstructs the masked query from the bound scores).
    let masked = causal_mask(&proof.scores, seq);
    if !exp_table.verify(&masked, &proof.exps, &proof.p_exp, tr) {
        return false;
    }

    // Row sums (direct) → reciprocals (lookup).
    if row_sums(&proof.exps, seq, seq) != proof.rowsum {
        return false;
    }
    if !recip_table.verify(&proof.rowsum, &proof.recip, &proof.p_recip, tr) {
        return false;
    }

    // P = E ⊙ broadcast_rows(r).
    let recip_bc = broadcast_rows(&proof.recip, seq);
    if !verify_hadamard(&proof.exps, &recip_bc, &proof.probs, &proof.p_prob, tr) {
        return false;
    }

    // Ctx = P·V, O = Ctx·Wo.
    if !verify_mm(seq, seq, d_head, &proof.probs, &proof.v, &proof.ctx, &proof.p_ctx, tr) {
        return false;
    }
    if !verify_mm(seq, d_head, d_model, &proof.ctx, wo, &proof.o, &proof.p_o, tr) {
        return false;
    }

    // Residual: out = x + O.
    for i in 0..out.len() {
        if out[i] != x[i] + proof.o[i] {
            return false;
        }
    }

    proof.obligations == expected_obl
}
