//! Stochastic block-window spot-check (Tier-3b) — the *sampling* orchestration on top of the
//! per-block prover.
//!
//! Full zkML (T3c) proves **every** block of an N-layer model — sound but expensive. The T3b tier
//! instead proves a **Fiat–Shamir-selected pseudo-random window** of `k` blocks. The selection is
//! bound to the [`crate::commitment::model_commitment`] **and** the PBR
//! [`crate::commitment::inference_binding_commitment`] (which contains the output hash), so:
//!
//! * the prover **cannot choose** which blocks are checked — the indices are a deterministic
//!   function of the public commitments; and
//! * any tampering with the computed trace changes the output hash → changes the binding → **re-rolls
//!   the selection**, so a cheat on *any* block is caught with probability `≥ k / N` per attempt.
//!
//! Combined with on-chain stake + slashing ([`ProviderStaking`], Phase 4), the *expected* cost of a
//! caught cheat exceeds its gain, which is the economic security argument for the cheaper tier.
//!
//! This module is deliberately generic over *how* a single block is proven/verified (a closure), so
//! it composes with [`crate::block::prove_block`] without re-plumbing its (many) parameters and stays
//! testable in isolation. Chaining soundness (that block `i`'s output is block `i+1`'s input across
//! the *full* trace) is the caller's responsibility via the committed trace; this layer proves that
//! the FS-selected blocks are individually correct and were not cherry-picked.

use crate::block::BlockProof;
use crate::transcript::Transcript;
use crate::Fr;
use ark_ff::{BigInteger, PrimeField};

/// Reduce a field challenge to an index in `[0, n)` using its low 16 bytes (little-endian).
fn field_to_index(c: &Fr, n: usize) -> usize {
    let bytes = c.into_bigint().to_bytes_le();
    let mut v: u128 = 0;
    for (i, b) in bytes.iter().take(16).enumerate() {
        v |= (*b as u128) << (8 * i);
    }
    (v % n as u128) as usize
}

/// Derive `k` **distinct** block indices in `[0, n_layers)` from the model + PBR commitments via
/// Fiat–Shamir. Deterministic, order-independent (sorted), and unpredictable: bound to the output
/// hash inside `binding`, so any change to the computed trace re-rolls the window. `k` is clamped to
/// `n_layers`.
pub fn select_blocks(
    model_commitment: &[u8; 32],
    binding: &[u8; 32],
    n_layers: usize,
    k: usize,
) -> Vec<usize> {
    assert!(n_layers > 0, "n_layers must be positive");
    let k = k.min(n_layers);
    let mut tr = Transcript::new(b"spotcheck-select");
    tr.absorb_bytes(b"model", model_commitment);
    tr.absorb_bytes(b"binding", binding);

    let mut chosen: Vec<usize> = Vec::with_capacity(k);
    let mut guard = 0u32;
    while chosen.len() < k {
        let idx = field_to_index(&tr.challenge(b"block"), n_layers);
        if !chosen.contains(&idx) {
            chosen.push(idx);
        }
        guard += 1;
        assert!(guard < 100_000, "block selection failed to converge");
    }
    chosen.sort_unstable();
    chosen
}

/// A spot-check proof: which blocks were selected, their per-block proofs, and their claimed
/// outputs (public trace entries needed to re-verify each selected block).
pub struct SpotCheckProof {
    pub selected: Vec<usize>,
    pub blocks: Vec<BlockProof>,
    pub outs: Vec<Vec<Fr>>,
}

/// Prove a Fiat–Shamir-selected window of `k` blocks out of `n_layers`. `prove_one(layer, tr)`
/// proves a single block (typically a [`crate::block::prove_block`] call closed over that layer's
/// weights/tables/input) and returns its proof and claimed output. The commitments are absorbed
/// first so the transcript — and thus every block proof — is bound to the model + PBR statement.
pub fn prove_block_window<PF>(
    model_commitment: &[u8; 32],
    binding: &[u8; 32],
    n_layers: usize,
    k: usize,
    mut prove_one: PF,
    tr: &mut Transcript,
) -> SpotCheckProof
where
    PF: FnMut(usize, &mut Transcript) -> (BlockProof, Vec<Fr>),
{
    tr.absorb_bytes(b"spotcheck-model", model_commitment);
    tr.absorb_bytes(b"spotcheck-binding", binding);
    let selected = select_blocks(model_commitment, binding, n_layers, k);

    let mut blocks = Vec::with_capacity(selected.len());
    let mut outs = Vec::with_capacity(selected.len());
    for &layer in &selected {
        tr.absorb_bytes(b"layer-idx", &(layer as u64).to_le_bytes());
        let (p, out) = prove_one(layer, tr);
        blocks.push(p);
        outs.push(out);
    }
    SpotCheckProof { selected, blocks, outs }
}

/// Verify a spot-check proof. The verifier **re-derives** the selection from the public commitments
/// and rejects unless the prover proved exactly those blocks (no cherry-picking), then verifies each
/// selected block via `verify_one(layer, block_proof, out, tr)`.
pub fn verify_block_window<VF>(
    model_commitment: &[u8; 32],
    binding: &[u8; 32],
    n_layers: usize,
    k: usize,
    proof: &SpotCheckProof,
    mut verify_one: VF,
    tr: &mut Transcript,
) -> bool
where
    VF: FnMut(usize, &BlockProof, &[Fr], &mut Transcript) -> bool,
{
    tr.absorb_bytes(b"spotcheck-model", model_commitment);
    tr.absorb_bytes(b"spotcheck-binding", binding);
    let selected = select_blocks(model_commitment, binding, n_layers, k);

    // The prover must have proven exactly the FS-selected blocks, in the canonical (sorted) order.
    if selected != proof.selected
        || proof.blocks.len() != selected.len()
        || proof.outs.len() != selected.len()
    {
        return false;
    }

    for (i, &layer) in selected.iter().enumerate() {
        tr.absorb_bytes(b"layer-idx", &(layer as u64).to_le_bytes());
        if !verify_one(layer, &proof.blocks[i], &proof.outs[i], tr) {
            return false;
        }
    }
    true
}
