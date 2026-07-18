//! Keccak256 commitments + the PBR public-input binding.
//!
//! These mirror the protocol's on-chain/off-chain commitments byte-for-byte:
//! * [`weights_root`] — keccak Merkle root over ordered weight shards (PoMA `KECCAK_MERKLE`).
//! * [`model_commitment`] — **arch-bound** PoMA: `keccak(weightsRoot || archCommitment)`.
//! * [`inference_binding_commitment`] — the PBR tuple, identical to
//!   `SP1ProofHooks.computeInferenceBindingCommitment` (`abi.encodePacked` semantics), so a zkLLM
//!   proof binds to the same settlement tuple as the SP1 settlement proof.

use crate::Fr;
use ark_ff::{BigInteger, PrimeField};
use sha3::{Digest, Keccak256};

/// keccak256 of `data` (Ethereum keccak, not NIST SHA3).
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.finalize());
    out
}

/// A binding commitment to a table of field elements (keccak of concatenated little-endian bytes).
/// Used to bind witnesses into a Fiat–Shamir transcript before challenges are drawn.
pub fn commit_field_table(table: &[Fr]) -> [u8; 32] {
    let mut h = Keccak256::new();
    for f in table {
        h.update(f.into_bigint().to_bytes_le());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.finalize());
    out
}

fn keccak_concat(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(a);
    h.update(b);
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.finalize());
    out
}

/// keccak Merkle root over ordered weight shards (leaf = `keccak(shard)`; odd level duplicates the
/// last node). Empty input → the zero hash. Mirrors PoMA `KECCAK_MERKLE`.
pub fn weights_root(shards: &[Vec<u8>]) -> [u8; 32] {
    if shards.is_empty() {
        return [0u8; 32];
    }
    let mut level: Vec<[u8; 32]> = shards.iter().map(|s| keccak256(s)).collect();
    while level.len() > 1 {
        let mut next = Vec::with_capacity((level.len() + 1) / 2);
        let mut i = 0;
        while i < level.len() {
            let left = level[i];
            let right = if i + 1 < level.len() { level[i + 1] } else { level[i] };
            next.push(keccak_concat(&left, &right));
            i += 2;
        }
        level = next;
    }
    level[0]
}

/// Arch-bound PoMA model commitment: `keccak(weightsRoot || archCommitment)`.
pub fn model_commitment(weights_root: &[u8; 32], arch_commitment: &[u8; 32]) -> [u8; 32] {
    keccak_concat(weights_root, arch_commitment)
}

/// Payment rail discriminant (mirrors the gateway/Solidity: 1 = USDC/x402, 2 = TFUEL).
pub mod rail {
    pub const USDC: u8 = 1;
    pub const TFUEL: u8 = 2;
}

/// The PBR (Payment-Bound Receipt) tuple bound into a proof's public inputs.
pub struct PbrBinding {
    pub payment_ref_hash: [u8; 32],
    pub task_id_hash: [u8; 32],
    pub rail: u8,
    /// uint256 amount, big-endian (matches `abi.encodePacked(uint256)`).
    pub amount_be: [u8; 32],
    pub model_commitment: [u8; 32],
    pub output_hash: [u8; 32],
}

impl PbrBinding {
    /// Encode a `u128` amount as a big-endian uint256.
    pub fn amount_from_u128(amount: u128) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[16..32].copy_from_slice(&amount.to_be_bytes());
        out
    }
}

/// `keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, amount, modelCommitment, outputHash))`.
/// Byte-identical to `SP1ProofHooks.computeInferenceBindingCommitment` and the gateway/SDK mirror.
pub fn inference_binding_commitment(b: &PbrBinding) -> [u8; 32] {
    let mut data = Vec::with_capacity(32 * 5 + 1);
    data.extend_from_slice(&b.payment_ref_hash);
    data.extend_from_slice(&b.task_id_hash);
    data.push(b.rail);
    data.extend_from_slice(&b.amount_be);
    data.extend_from_slice(&b.model_commitment);
    data.extend_from_slice(&b.output_hash);
    keccak256(&data)
}
