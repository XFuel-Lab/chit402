//! RoPE (rotary position embedding) — a **public-linear** gadget.
//!
//! RoPE rotates each adjacent coordinate pair `(x[2i], x[2i+1])` of a head by a position-dependent
//! angle whose `cos`/`sin` are **public constants** (a deterministic function of position + the
//! model's `rope_theta`). Represented as **fixed-point integer codes**, the rotation is therefore an
//! *exact* integer linear map:
//! ```text
//!   x_rot[2i]   = x[2i]·cos - x[2i+1]·sin
//!   x_rot[2i+1] = x[2i]·sin + x[2i+1]·cos
//! ```
//! Because the coefficients are public and the arithmetic is exact in the field, RoPE needs **no
//! proof object**: the verifier recomputes `x_rot` from the (bound) `x` and the public `cos`/`sin`
//! and checks equality — exactly like the residual add and the causal mask in [`crate::attention`].
//! No lookup, no rounding-soundness hazard (the `cos`/`sin` codes are the spec; the fixed-point
//! calibration of `x_rot`'s extra scale factor is folded into the downstream requant, M5.3).
//!
//! Convention: interleaved adjacent pairs `(2i, 2i+1)`. The rotate-half convention (pairing `i` with
//! `i + d_head/2`, as in GPT-NeoX/Llama HF) is a trivial reindexing of the same public-linear map.

use crate::Fr;

/// Apply RoPE to a `seq × d_head` row-major tensor. `cos`/`sin` are public fixed-point codes of
/// length `seq · d_head/2`, indexed `[s · d_head/2 + i]` for pair `i` at position `s`. `d_head` must
/// be even.
pub fn apply_rope(x: &[Fr], seq: usize, d_head: usize, cos: &[Fr], sin: &[Fr]) -> Vec<Fr> {
    assert!(d_head.is_multiple_of(2), "d_head must be even for paired rotation");
    assert_eq!(x.len(), seq * d_head);
    let half = d_head / 2;
    assert_eq!(cos.len(), seq * half);
    assert_eq!(sin.len(), seq * half);

    let mut out = x.to_vec();
    for s in 0..seq {
        for i in 0..half {
            let c = cos[s * half + i];
            let sn = sin[s * half + i];
            let a = x[s * d_head + 2 * i];
            let b = x[s * d_head + 2 * i + 1];
            out[s * d_head + 2 * i] = a * c - b * sn;
            out[s * d_head + 2 * i + 1] = a * sn + b * c;
        }
    }
    out
}

/// Verify a claimed RoPE output by recomputing it from the bound `x` and public `cos`/`sin`
/// (public-linear ⇒ direct equality). Returns `false` on any length mismatch.
pub fn verify_rope(
    x: &[Fr],
    rotated: &[Fr],
    seq: usize,
    d_head: usize,
    cos: &[Fr],
    sin: &[Fr],
) -> bool {
    if !d_head.is_multiple_of(2)
        || x.len() != seq * d_head
        || rotated.len() != seq * d_head
        || cos.len() != seq * (d_head / 2)
        || sin.len() != seq * (d_head / 2)
    {
        return false;
    }
    rotated == apply_rope(x, seq, d_head, cos, sin)
}
