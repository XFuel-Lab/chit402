//! Multi-head attention with **grouped-query attention (GQA)** and optional **RoPE** — the
//! full-width sibling of the single-head [`crate::attention`] core.
//!
//! This is the M5.2b-cont *assembly*: it adds **no new cryptographic argument**. It shares one
//! norm + one set of Q/K/V/O projections, applies RoPE (public-linear, [`crate::rope`]) to Q and K,
//! then runs the **same** per-head softmax argument (`Q_h·K_hᵀ` → causal mask → `exp` + row-sum +
//! reciprocal lookups → normalization Hadamard → `P_h·V_h`) as [`crate::attention`], for every head,
//! under one Fiat–Shamir transcript. GQA is pure index layout: head `h` reads KV group
//! `h / (n_heads / n_kv_heads)`. Zero pending obligations in quantized mode.
//!
//! Layout (row-major): `Q` is `seq × (n_heads·d_head)`, `K`/`V` are `seq × (n_kv_heads·d_head)`,
//! `Wo` is `(n_heads·d_head) × d_model`. `seq` and `d_head` are powers of two (softmax-lookup and
//! matmul shape constraints); `d_head` is even when RoPE is enabled.

use crate::attention::{broadcast_rows, causal_mask, row_sums, transpose};
use crate::ffn::NormParams;
use crate::gadgets::{prove_hadamard, verify_hadamard, HadamardProof, LookupObligation};
use crate::lookup::LookupProof;
use crate::matmul::{prove as prove_mm, verify as verify_mm, MatMul, MatMulProof};
use crate::norm::{prove_rmsnorm, verify_rmsnorm, RmsNormProof};
use crate::rope::{apply_rope, verify_rope};
use crate::table::ScalarTable;
use crate::transcript::Transcript;
use crate::Fr;

/// Public RoPE tables (`cos`/`sin` fixed-point codes, each length `seq · d_head/2`).
pub struct RopeParams<'a> {
    pub cos: &'a [Fr],
    pub sin: &'a [Fr],
}

/// Multi-head attention geometry + gadget selection.
pub struct MhaConfig {
    pub seq: usize,
    pub d_model: usize,
    pub n_heads: usize,
    pub n_kv_heads: usize,
    pub d_head: usize,
    pub norm_name: &'static str,
}

impl MhaConfig {
    fn q_width(&self) -> usize {
        self.n_heads * self.d_head
    }
    fn kv_width(&self) -> usize {
        self.n_kv_heads * self.d_head
    }
    fn kv_of(&self, head: usize) -> usize {
        head / (self.n_heads / self.n_kv_heads)
    }
}

/// Per-head softmax-attention advice + sub-proofs (identical shape to the single-head core).
pub struct HeadProof {
    pub scores: Vec<Fr>,
    pub exps: Vec<Fr>,
    pub rowsum: Vec<Fr>,
    pub recip: Vec<Fr>,
    pub probs: Vec<Fr>,
    pub ctx: Vec<Fr>,
    pub p_scores: MatMulProof,
    pub p_exp: LookupProof,
    pub p_recip: LookupProof,
    pub p_prob: HadamardProof,
    pub p_ctx: MatMulProof,
}

/// A proof for one multi-head (GQA) attention sub-block.
pub struct MhaProof {
    pub xn: Vec<Fr>,
    pub q: Vec<Fr>,
    pub k: Vec<Fr>,
    pub v: Vec<Fr>,
    pub q_rot: Vec<Fr>,
    pub k_rot: Vec<Fr>,
    pub concat: Vec<Fr>,
    pub o: Vec<Fr>,
    pub p_norm: Option<RmsNormProof>,
    pub p_q: MatMulProof,
    pub p_k: MatMulProof,
    pub p_v: MatMulProof,
    pub heads: Vec<HeadProof>,
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

/// Extract head `h` (columns `[h·d_head, (h+1)·d_head)`) of a `seq × width` matrix → `seq × d_head`.
fn slice_head(mat: &[Fr], seq: usize, width: usize, d_head: usize, h: usize) -> Vec<Fr> {
    let mut out = vec![Fr::from(0u64); seq * d_head];
    for s in 0..seq {
        for e in 0..d_head {
            out[s * d_head + e] = mat[s * width + h * d_head + e];
        }
    }
    out
}

/// Apply RoPE independently to every head-slice of a `seq × (n_heads·d_head)` matrix.
fn rope_all_heads(
    mat: &[Fr],
    seq: usize,
    n_heads: usize,
    d_head: usize,
    rope: &RopeParams,
) -> Vec<Fr> {
    let width = n_heads * d_head;
    let mut out = mat.to_vec();
    for h in 0..n_heads {
        let head = slice_head(mat, seq, width, d_head, h);
        let rot = apply_rope(&head, seq, d_head, rope.cos, rope.sin);
        for s in 0..seq {
            for e in 0..d_head {
                out[s * width + h * d_head + e] = rot[s * d_head + e];
            }
        }
    }
    out
}

/// Verify RoPE was applied correctly to every head-slice (public-linear, direct recomputation).
fn verify_rope_all_heads(
    src: &[Fr],
    rotated: &[Fr],
    seq: usize,
    n_heads: usize,
    d_head: usize,
    rope: &RopeParams,
) -> bool {
    let width = n_heads * d_head;
    for h in 0..n_heads {
        let head = slice_head(src, seq, width, d_head, h);
        let rot_head = slice_head(rotated, seq, width, d_head, h);
        if !verify_rope(&head, &rot_head, seq, d_head, rope.cos, rope.sin) {
            return false;
        }
    }
    true
}

/// Prove one multi-head (GQA) attention sub-block. `norm` mirrors [`crate::ffn`]; `rope = Some`
/// applies RoPE to Q/K, `None` skips it (learned-/no-positional). Returns `(proof, out)`.
#[allow(clippy::too_many_arguments)]
pub fn prove_mha(
    cfg: &MhaConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    norm: Option<&NormParams>,
    rope: Option<&RopeParams>,
    tr: &mut Transcript,
) -> (MhaProof, Vec<Fr>) {
    let (seq, d_model, d_head) = (cfg.seq, cfg.d_model, cfg.d_head);
    let (qw, kvw) = (cfg.q_width(), cfg.kv_width());
    assert_eq!(x.len(), seq * d_model);
    assert_eq!(wq.len(), d_model * qw);
    assert_eq!(wk.len(), d_model * kvw);
    assert_eq!(wv.len(), d_model * kvw);
    assert_eq!(wo.len(), qw * d_model);
    assert!(cfg.n_heads.is_multiple_of(cfg.n_kv_heads), "n_heads must be a multiple of n_kv_heads");
    assert_eq!(exp_table.out_codes[0], Fr::from(0u64), "exp table code 0 must map to 0 (mask sentinel)");

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

    let mmq = MatMul::new(seq, d_model, qw, xn.clone(), wq.to_vec());
    let q = mmq.c.clone();
    let p_q = prove_mm(&mmq, tr);
    let mmk = MatMul::new(seq, d_model, kvw, xn.clone(), wk.to_vec());
    let k = mmk.c.clone();
    let p_k = prove_mm(&mmk, tr);
    let mmv = MatMul::new(seq, d_model, kvw, xn.clone(), wv.to_vec());
    let v = mmv.c.clone();
    let p_v = prove_mm(&mmv, tr);

    // RoPE (public-linear): rotate every query head and every kv head.
    let (q_rot, k_rot) = match rope {
        Some(rp) => (
            rope_all_heads(&q, seq, cfg.n_heads, d_head, rp),
            rope_all_heads(&k, seq, cfg.n_kv_heads, d_head, rp),
        ),
        None => (q.clone(), k.clone()),
    };

    let mut concat = vec![Fr::from(0u64); seq * qw];
    let mut heads = Vec::with_capacity(cfg.n_heads);
    for h in 0..cfg.n_heads {
        let kv = cfg.kv_of(h);
        let qh = slice_head(&q_rot, seq, qw, d_head, h);
        let kkv = slice_head(&k_rot, seq, kvw, d_head, kv);
        let vkv = slice_head(&v, seq, kvw, d_head, kv);

        // scores = Q_h · K_kvᵀ
        let kt = transpose(&kkv, seq, d_head);
        let mms = MatMul::new(seq, d_head, seq, qh, kt);
        let scores = mms.c.clone();
        let p_scores = prove_mm(&mms, tr);

        let masked = causal_mask(&scores, seq);
        let exps = exp_table.apply(&masked);
        let p_exp = exp_table.prove(&masked, &exps, tr);

        let rowsum = row_sums(&exps, seq, seq);
        let recip = recip_table.apply(&rowsum);
        let p_recip = recip_table.prove(&rowsum, &recip, tr);

        let recip_bc = broadcast_rows(&recip, seq);
        let probs: Vec<Fr> = exps.iter().zip(recip_bc.iter()).map(|(e, r)| *e * *r).collect();
        let p_prob = prove_hadamard(&exps, &recip_bc, &probs, tr);

        let mmc = MatMul::new(seq, seq, d_head, probs.clone(), vkv);
        let ctx = mmc.c.clone();
        let p_ctx = prove_mm(&mmc, tr);

        for s in 0..seq {
            for e in 0..d_head {
                concat[s * qw + h * d_head + e] = ctx[s * d_head + e];
            }
        }
        heads.push(HeadProof {
            scores,
            exps,
            rowsum,
            recip,
            probs,
            ctx,
            p_scores,
            p_exp,
            p_recip,
            p_prob,
            p_ctx,
        });
    }

    let mmo = MatMul::new(seq, qw, d_model, concat.clone(), wo.to_vec());
    let o = mmo.c.clone();
    let p_o = prove_mm(&mmo, tr);

    let out: Vec<Fr> = x.iter().zip(o.iter()).map(|(a, b)| *a + *b).collect();

    let proof = MhaProof {
        xn,
        q,
        k,
        v,
        q_rot,
        k_rot,
        concat,
        o,
        p_norm,
        p_q,
        p_k,
        p_v,
        heads,
        p_o,
        obligations,
    };
    (proof, out)
}

/// Verify a multi-head (GQA) attention proof.
#[allow(clippy::too_many_arguments)]
pub fn verify_mha(
    cfg: &MhaConfig,
    x: &[Fr],
    wq: &[Fr],
    wk: &[Fr],
    wv: &[Fr],
    wo: &[Fr],
    out: &[Fr],
    proof: &MhaProof,
    exp_table: &ScalarTable,
    recip_table: &ScalarTable,
    norm: Option<&NormParams>,
    rope: Option<&RopeParams>,
    tr: &mut Transcript,
) -> bool {
    let (seq, d_model, d_head) = (cfg.seq, cfg.d_model, cfg.d_head);
    let (qw, kvw) = (cfg.q_width(), cfg.kv_width());
    if cfg.n_kv_heads == 0 || !cfg.n_heads.is_multiple_of(cfg.n_kv_heads) {
        return false;
    }
    if proof.xn.len() != seq * d_model
        || proof.q.len() != seq * qw
        || proof.k.len() != seq * kvw
        || proof.v.len() != seq * kvw
        || proof.q_rot.len() != seq * qw
        || proof.k_rot.len() != seq * kvw
        || proof.concat.len() != seq * qw
        || proof.o.len() != seq * d_model
        || out.len() != seq * d_model
        || proof.heads.len() != cfg.n_heads
    {
        return false;
    }
    if exp_table.out_codes[0] != Fr::from(0u64) {
        return false;
    }

    let mut expected_obl = Vec::new();
    match (norm, &proof.p_norm) {
        (Some(np), Some(pn)) => {
            if !verify_rmsnorm(x, np.weight, seq, d_model, &proof.xn, pn, np.table, tr) {
                return false;
            }
        }
        (None, None) => expected_obl.push(LookupObligation::new(norm_op(cfg.norm_name), x, &proof.xn)),
        _ => return false,
    }

    if !verify_mm(seq, d_model, qw, &proof.xn, wq, &proof.q, &proof.p_q, tr) {
        return false;
    }
    if !verify_mm(seq, d_model, kvw, &proof.xn, wk, &proof.k, &proof.p_k, tr) {
        return false;
    }
    if !verify_mm(seq, d_model, kvw, &proof.xn, wv, &proof.v, &proof.p_v, tr) {
        return false;
    }

    // RoPE: verifier recomputes the rotation from the bound Q/K (or requires identity when off).
    match rope {
        Some(rp) => {
            if !verify_rope_all_heads(&proof.q, &proof.q_rot, seq, cfg.n_heads, d_head, rp)
                || !verify_rope_all_heads(&proof.k, &proof.k_rot, seq, cfg.n_kv_heads, d_head, rp)
            {
                return false;
            }
        }
        None => {
            if proof.q_rot != proof.q || proof.k_rot != proof.k {
                return false;
            }
        }
    }

    let mut concat = vec![Fr::from(0u64); seq * qw];
    for h in 0..cfg.n_heads {
        let kv = cfg.kv_of(h);
        let hp = &proof.heads[h];
        if hp.scores.len() != seq * seq
            || hp.exps.len() != seq * seq
            || hp.rowsum.len() != seq
            || hp.recip.len() != seq
            || hp.probs.len() != seq * seq
            || hp.ctx.len() != seq * d_head
        {
            return false;
        }

        let qh = slice_head(&proof.q_rot, seq, qw, d_head, h);
        let kkv = slice_head(&proof.k_rot, seq, kvw, d_head, kv);
        let vkv = slice_head(&proof.v, seq, kvw, d_head, kv);
        let kt = transpose(&kkv, seq, d_head);
        if !verify_mm(seq, d_head, seq, &qh, &kt, &hp.scores, &hp.p_scores, tr) {
            return false;
        }

        let masked = causal_mask(&hp.scores, seq);
        if !exp_table.verify(&masked, &hp.exps, &hp.p_exp, tr) {
            return false;
        }
        if row_sums(&hp.exps, seq, seq) != hp.rowsum {
            return false;
        }
        if !recip_table.verify(&hp.rowsum, &hp.recip, &hp.p_recip, tr) {
            return false;
        }
        let recip_bc = broadcast_rows(&hp.recip, seq);
        if !verify_hadamard(&hp.exps, &recip_bc, &hp.probs, &hp.p_prob, tr) {
            return false;
        }
        if !verify_mm(seq, seq, d_head, &hp.probs, &vkv, &hp.ctx, &hp.p_ctx, tr) {
            return false;
        }
        for s in 0..seq {
            for e in 0..d_head {
                concat[s * qw + h * d_head + e] = hp.ctx[s * d_head + e];
            }
        }
    }

    // Bind the prover's concat to the per-head contexts, then the output projection + residual.
    if concat != proof.concat {
        return false;
    }
    if !verify_mm(seq, qw, d_model, &proof.concat, wo, &proof.o, &proof.p_o, tr) {
        return false;
    }
    for i in 0..out.len() {
        if out[i] != x[i] + proof.o[i] {
            return false;
        }
    }

    proof.obligations == expected_obl
}
