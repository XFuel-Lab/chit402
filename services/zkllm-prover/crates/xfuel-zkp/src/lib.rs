//! # XFuel zkLLM — model-agnostic ZK prover core
//!
//! Clean-room, permissive-only (ADR 0003 / ADR 0004). This crate implements the *architecture-
//! agnostic* heart of XFuel's Verified-Inference (Tier-3) prover:
//!
//! * [`matmul`] — a sumcheck-based matrix-multiplication argument (Thaler-style). Matmul is
//!   ~90%+ of transformer inference cost and is identical in form across every LLM (Llama,
//!   Mistral, Qwen, Gemma, GPT-2, MoE …) — only the dimensions change. Get this right once and
//!   the expensive core works for the whole ZK-addressable LLM market.
//! * [`manifest`] — a compact model architecture config + an **arch-bound PoMA commitment**, so a
//!   proof attests "*these* weights **+ this** architecture produced this output".
//! * [`commitment`] — keccak256 commitments (weights merkle root, model commitment) and the
//!   **PBR public-input binding**, byte-compatible with `SP1ProofHooks.computeInferenceBindingCommitment`
//!   and the gateway/SDK, so a zkLLM proof slots into the same settlement path as the SP1 proof.
//!
//! Architecture-specific gadgets ([`gadgets`]) and their composition ([`ffn`] SwiGLU, [`attention`]
//! single-head causal attention, [`mha`] multi-head + GQA attention with [`rope`], and a full
//! [`block`]) are the small, swappable long tail selected by the [`manifest::ModelManifest`]. Soundly proven today: all linear projections (matmul), elementwise
//! gating (Hadamard), the **transcendental activation** (SiLU/GeLU) via the [`lookup`] logup
//! argument over quantized [`activation`] tables, **RMSNorm** ([`norm`], `rsqrt` via the same lookup
//! plus a linear row-reduction), and **softmax** ([`attention`], `exp` and reciprocal via the
//! [`table`] lookup). A quantized SwiGLU FFN block and a quantized single-head attention block each
//! have **zero pending obligations** (single- or multi-head); one full transformer [`block`] composes
//! them under a single transcript, and RoPE ([`rope`]) is public-linear. Inter-op
//! **requantization** ([`requant`]) is proven as division-with-remainder plus two [`range`] checks,
//! so each op's wide accumulator re-enters the next op's code domain soundly (M5.3). The
//! [`spotcheck`] layer turns the per-block prover into the cheaper **Tier-3b** by proving a
//! Fiat–Shamir-selected window of blocks, bound to the model + PBR commitments (M5.3).
//!
//! CPU-only; no GPU. Runs in any container (see the crate `Dockerfile`).

pub mod activation;
pub mod attention;
pub mod block;
pub mod commitment;
pub mod ffn;
pub mod gadgets;
pub mod lookup;
pub mod manifest;
pub mod matmul;
pub mod mha;
pub mod mle;
pub mod norm;
pub mod pcs;
pub mod range;
pub mod reduce;
pub mod requant;
pub mod residual;
pub mod rope;
pub mod spotcheck;
pub mod sumcheck;
pub mod table;
pub mod transcript;

/// The proving field: BN254 scalar field (`Fr`) — chosen for cheap on-chain verification
/// (BN254 precompiles / Groth16 wrap) per ADR 0004.
pub type Fr = ark_bn254::Fr;

/// Exact base-2 logarithm of a power-of-two length. Panics if `n` is not a power of two.
pub fn log2_exact(n: usize) -> usize {
    assert!(n.is_power_of_two() && n > 0, "length must be a power of two, got {n}");
    n.trailing_zeros() as usize
}
