//! Model architecture manifest + arch-bound PoMA commitment.
//!
//! A compact, canonical description of a transformer architecture. It drives which gadgets the
//! prover composes (a later milestone) and — crucially — is **committed** so a proof attests
//! "*these* weights **+ this** architecture produced this output," closing a model-substitution
//! gap that a weights-only commitment leaves open.
//!
//! One manifest covers the ZK-addressable LLM market: `family` + the norm/act/pos/GQA fields
//! distinguish Llama, Mistral, Qwen, Gemma, GPT-2, etc.

use crate::commitment::keccak256;

/// Normalization variant.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NormType {
    LayerNorm,
    RmsNorm,
}

/// Feed-forward activation / gating.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActType {
    GeLU,
    SiLU,
    SwiGLU,
    GeGLU,
}

/// Positional encoding.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PosType {
    Learned,
    Rope,
    ALiBi,
}

fn norm_tag(n: NormType) -> u8 {
    match n {
        NormType::LayerNorm => 0,
        NormType::RmsNorm => 1,
    }
}
fn act_tag(a: ActType) -> u8 {
    match a {
        ActType::GeLU => 0,
        ActType::SiLU => 1,
        ActType::SwiGLU => 2,
        ActType::GeGLU => 3,
    }
}
fn pos_tag(p: PosType) -> u8 {
    match p {
        PosType::Learned => 0,
        PosType::Rope => 1,
        PosType::ALiBi => 2,
    }
}

/// A transformer architecture manifest (the ZK analogue of a GGUF/HF config).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelManifest {
    pub family: String,
    pub n_layers: u32,
    pub d_model: u32,
    pub n_heads: u32,
    pub n_kv_heads: u32,
    pub d_ff: u32,
    pub vocab_size: u32,
    pub norm: NormType,
    pub act: ActType,
    pub pos: PosType,
    pub quant: String,
}

impl ModelManifest {
    /// Deterministic, length-prefixed canonical byte encoding (stable across languages/versions).
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        let put_str = |out: &mut Vec<u8>, s: &str| {
            out.extend_from_slice(&(s.len() as u32).to_le_bytes());
            out.extend_from_slice(s.as_bytes());
        };
        put_str(&mut out, &self.family);
        for v in [
            self.n_layers,
            self.d_model,
            self.n_heads,
            self.n_kv_heads,
            self.d_ff,
            self.vocab_size,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.push(norm_tag(self.norm));
        out.push(act_tag(self.act));
        out.push(pos_tag(self.pos));
        put_str(&mut out, &self.quant);
        out
    }

    /// Architecture commitment: `keccak256("xfuel-manifest-v1" || canonical_bytes)`.
    pub fn arch_commitment(&self) -> [u8; 32] {
        let mut data = Vec::with_capacity(17 + 64);
        data.extend_from_slice(b"xfuel-manifest-v1");
        data.extend_from_slice(&self.canonical_bytes());
        keccak256(&data)
    }
}
