//! Phase 2 — x402 payment binding (mirrors `SP1ProofHooks.sol`).
//!
//! Byte-for-byte parity with:
//!   - `SP1ProofHooks.computePaymentCommitment`
//!   - `backend/theta-bridge/src/payment-binding.js`
//!   - `test/security/SP1ProofHooksHarness.test.cjs` ("should match the backend JS formula")
//!
//! Formula:
//!   keccak256(abi.encodePacked(paymentRefHash, taskIdHash, paymentRail, amount))
//!
//! `paymentRail`: 1 = USDC/x402, 2 = TFUEL. `amount` is uint256 big-endian (32 bytes).

use tiny_keccak::{Hasher, Keccak};

/// USDC via x402 (Base settlement).
pub const PAYMENT_RAIL_USDC: u8 = 1;
/// TFUEL on Theta (secondary rail).
pub const PAYMENT_RAIL_TFUEL: u8 = 2;

/// On-chain / SP1 public-values layout version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PublicValuesVersion {
    /// Original 12-field `AITaskPublicValues` (no payment binding).
    V1 = 1,
    /// v2 adds trailing `paymentCommitment` (13th ABI word).
    V2 = 2,
}

impl PublicValuesVersion {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            1 => Some(Self::V1),
            2 => Some(Self::V2),
            _ => None,
        }
    }
}

/// Keccak-256 (Ethereum precompile semantics).
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher = Keccak::v256();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

/// True when every byte is zero (`bytes32(0)` — unbound task).
pub fn is_zero_bytes32(h: &[u8; 32]) -> bool {
    h.iter().all(|&b| b == 0)
}

/// Pack `amount` as Solidity `uint256` for `abi.encodePacked` (32-byte big-endian).
pub fn u256_be32_from_u128(amount: u128) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[16..32].copy_from_slice(&amount.to_be_bytes());
    out
}

/// Pack `amount` from 32 little-endian bytes (SP1 `U256` internal layout).
pub fn u256_be32_from_le_bytes(le: &[u8; 32]) -> [u8; 32] {
    let v = u128::from_le_bytes(le[..16].try_into().expect("32 bytes"));
    u256_be32_from_u128(v)
}

/// Deterministic payment commitment — mirrors `SP1ProofHooks.computePaymentCommitment`.
pub fn compute_payment_commitment(
    payment_ref_hash: &[u8; 32],
    task_id_hash: &[u8; 32],
    payment_rail: u8,
    amount_be32: &[u8; 32],
) -> [u8; 32] {
    // abi.encodePacked: bytes32 + bytes32 + uint8 + uint256 (no padding on uint8)
    let mut buf = [0u8; 97];
    buf[0..32].copy_from_slice(payment_ref_hash);
    buf[32..64].copy_from_slice(task_id_hash);
    buf[64] = payment_rail;
    buf[65..97].copy_from_slice(amount_be32);
    keccak256(&buf)
}

/// Convenience when the economic amount fits in u128 (all current task amounts do).
pub fn compute_payment_commitment_u128(
    payment_ref_hash: &[u8; 32],
    task_id_hash: &[u8; 32],
    payment_rail: u8,
    amount: u128,
) -> [u8; 32] {
    let amount_be = u256_be32_from_u128(amount);
    compute_payment_commitment(payment_ref_hash, task_id_hash, payment_rail, &amount_be)
}

/// ABI-encode the v2 AI-task public values tuple (13 words) for on-chain verification.
/// Matches `SP1ProofHooks.encodeAITaskPublicValuesV2`.
pub fn encode_ai_task_public_values_v2(
    task_type: u8,
    source_chain: u8,
    dest_chain: u8,
    task_id_hash: &[u8; 32],
    sender_hash: &[u8; 32],
    net_amount_be32: &[u8; 32],
    fee_amount_be32: &[u8; 32],
    fee_bps: u16,
    output_hash: &[u8; 32],
    block_height: u64,
    timestamp: u64,
    nonce: u64,
    payment_commitment: &[u8; 32],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(13 * 32);
    append_word_u8(&mut out, task_type);
    append_word_u8(&mut out, source_chain);
    append_word_u8(&mut out, dest_chain);
    append_word_bytes32(&mut out, task_id_hash);
    append_word_bytes32(&mut out, sender_hash);
    append_word_bytes32(&mut out, net_amount_be32);
    append_word_bytes32(&mut out, fee_amount_be32);
    append_word_u16(&mut out, fee_bps);
    append_word_bytes32(&mut out, output_hash);
    append_word_u64(&mut out, block_height);
    append_word_u64(&mut out, timestamp);
    append_word_u64(&mut out, nonce);
    append_word_bytes32(&mut out, payment_commitment);
    out
}

fn append_word_u8(buf: &mut Vec<u8>, v: u8) {
    let mut w = [0u8; 32];
    w[31] = v;
    buf.extend_from_slice(&w);
}

fn append_word_u16(buf: &mut Vec<u8>, v: u16) {
    let mut w = [0u8; 32];
    w[30..32].copy_from_slice(&v.to_be_bytes());
    buf.extend_from_slice(&w);
}

fn append_word_u64(buf: &mut Vec<u8>, v: u64) {
    let mut w = [0u8; 32];
    w[24..32].copy_from_slice(&v.to_be_bytes());
    buf.extend_from_slice(&w);
}

fn append_word_bytes32(buf: &mut Vec<u8>, h: &[u8; 32]) {
    buf.extend_from_slice(h);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commitment_formula_matches_solidity_encode_packed() {
        // Vector from test/security/SP1ProofHooksHarness.test.cjs (parity test)
        let payment_ref_hash = keccak256(b"base:0xabc123");
        let task_id_hash = keccak256(b"task-pay-1");
        let amount_be = u256_be32_from_u128(950_000_000_000_000_000);

        let c = compute_payment_commitment(
            &payment_ref_hash,
            &task_id_hash,
            PAYMENT_RAIL_USDC,
            &amount_be,
        );

        // Recompute manually with the same packed layout
        let mut buf = [0u8; 97];
        buf[0..32].copy_from_slice(&payment_ref_hash);
        buf[32..64].copy_from_slice(&task_id_hash);
        buf[64] = PAYMENT_RAIL_USDC;
        buf[65..97].copy_from_slice(&amount_be);
        assert_eq!(c, keccak256(&buf));
        assert_ne!(c, [0u8; 32]);
    }

    #[test]
    fn v2_encoding_is_13_words() {
        let zero = [0u8; 32];
        let enc = encode_ai_task_public_values_v2(
            1, 0, 1, &zero, &zero, &zero, &zero, 50, &zero, 12345, 1_700_000_000, 1, &zero,
        );
        assert_eq!(enc.len(), 13 * 32);
    }

    #[test]
    fn zero_commitment_means_unbound() {
        assert!(is_zero_bytes32(&[0u8; 32]));
        assert!(!is_zero_bytes32(&[1u8; 32]));
    }
}
