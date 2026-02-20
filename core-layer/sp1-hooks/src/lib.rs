//! XFuel Core Layer — SP1 Proof Hooks
//!
//! Shared types and helpers for SP1 proof generation/verification across
//! Solidity (EVM), CosmWasm (WASM), and Rust host environments.
//!
//! Research ties (SP1 docs v5.x, Feb 2026):
//!   - Guest program: sp1_zkvm::entrypoint!(main), sp1_zkvm::io::{read, commit}
//!   - Host: ProverClient::from_env(), client.prove(&pk, &stdin).groth16().run()
//!   - Verification key: keccak256 of the program ELF
//!   - Groth16 proofs: ~260 bytes on Bn254, ~270k gas on-chain
//!   - Optimize with precompiles for SHA-256, Keccak, BN254 (orders of magnitude faster)
//!   - Set lto = "thin" and codegen-units = 1 for smaller binaries

use serde::{Deserialize, Serialize};

// ─── Circuit Types ────────────────────────────────────────────────────────────

/// Supported proof types in the XFuel Core Layer.
/// Each type maps to a distinct SP1 RISC-V circuit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum CircuitType {
    /// Forward bridge deposit (TFUEL → ibcTFUEL)
    ForwardDeposit,
    /// Reverse burn (ibcTFUEL → TFUEL)
    ReverseBurn,
    /// Fee collector burn
    FeeBurn,
    /// AI task settlement (inference, compute, data attestation)
    AITask,
    /// Agent-to-agent message verification
    A2AMessage,
    /// Custom circuit (plug-in)
    Custom(String),
}

/// Chain identifiers for cross-chain proof routing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChainId {
    Theta,       // EVM Chain ID 361
    Osmosis,     // Cosmos osmosis-1
    Akash,       // Cosmos akashnet-2
    Bittensor,   // EVM Chain ID 964
    Persistence, // Cosmos core-1
    Custom(String),
}

/// Proof outcome with non-fatal failure support.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProofOutcome {
    Valid,
    Regenerable { reason: String },
    Invalid { reason: String },
}

// ─── Proof Request/Response ───────────────────────────────────────────────────

/// Request to generate an SP1 proof.
/// Used by the host prover and off-chain services.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofRequest {
    pub circuit_type: CircuitType,
    pub source_chain: ChainId,
    pub destination_chain: ChainId,

    /// Public values to commit (ABI-encoded).
    pub public_values: Vec<u8>,

    /// Private witness data.
    pub private_inputs: Vec<u8>,

    /// Whether to use Groth16 (true) or PLONK (false).
    /// Per SP1 docs: Groth16 is cheaper (~270k gas) but requires trusted setup.
    pub use_groth16: bool,

    /// Whether this is an urgent proof (AI tasks prefer low latency).
    pub urgent: bool,
}

/// Result of proof generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofResult {
    pub circuit_type: CircuitType,
    pub proof_bytes: Vec<u8>,
    pub public_values: Vec<u8>,
    pub nullifier: [u8; 32],
    pub program_vkey: [u8; 32],
    pub proving_time_ms: u64,
    pub outcome: ProofOutcome,
}

// ─── Fee Helpers ──────────────────────────────────────────────────────────────

/// Calculate task fee with variable BPS (0.1-1%).
/// Returns (fee_amount, net_amount).
///
/// Mirrors the Solidity and SP1 circuit implementations.
pub fn calculate_task_fee(gross_amount: u128, fee_bps: u16) -> (u128, u128) {
    assert!(
        fee_bps >= 10 && fee_bps <= 100,
        "Fee BPS must be 10-100 (0.1%-1.0%)"
    );

    let fee_amount = (gross_amount * fee_bps as u128) / 10000;
    let net_amount = gross_amount - fee_amount;
    (fee_amount, net_amount)
}

/// Compute a deterministic nullifier from task parameters.
pub fn compute_nullifier(
    task_id: &[u8; 32],
    sender: &[u8; 32],
    nonce: u64,
    block_number: u64,
) -> [u8; 32] {
    // Simple hash-based nullifier (matches Solidity SP1ProofHooks.computeNullifier)
    let mut input = Vec::with_capacity(80);
    input.extend_from_slice(task_id);
    input.extend_from_slice(sender);
    input.extend_from_slice(&nonce.to_le_bytes());
    input.extend_from_slice(&block_number.to_le_bytes());

    // Simple hash (in production, use keccak256 or poseidon)
    let mut hash = [0u8; 32];
    for (i, chunk) in input.chunks(32).enumerate() {
        for (j, &byte) in chunk.iter().enumerate() {
            hash[(j + i * 7) % 32] ^= byte;
        }
    }
    for i in 0..32 {
        hash[i] = hash[i].wrapping_mul(251).wrapping_add(i as u8);
    }
    hash
}

/// Compute a fee commitment hash.
pub fn compute_fee_commitment(
    fee_amount: u128,
    task_id: &[u8; 32],
    chain: &ChainId,
) -> [u8; 32] {
    let chain_byte: u8 = match chain {
        ChainId::Theta => 0,
        ChainId::Osmosis => 1,
        ChainId::Akash => 2,
        ChainId::Bittensor => 3,
        ChainId::Persistence => 4,
        ChainId::Custom(_) => 255,
    };

    let mut input = Vec::with_capacity(65);
    input.extend_from_slice(&fee_amount.to_le_bytes());
    input.extend_from_slice(task_id);
    input.push(chain_byte);

    // Simple commitment hash
    let mut hash = [0u8; 32];
    for (i, chunk) in input.chunks(32).enumerate() {
        for (j, &byte) in chunk.iter().enumerate() {
            hash[(j + i * 7) % 32] ^= byte;
        }
    }
    for i in 0..32 {
        hash[i] = hash[i].wrapping_mul(251).wrapping_add(i as u8);
    }
    hash
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_calculation_50bps() {
        let (fee, net) = calculate_task_fee(1_000_000, 50);
        assert_eq!(fee, 5_000); // 0.5%
        assert_eq!(net, 995_000);
        assert_eq!(fee + net, 1_000_000);
    }

    #[test]
    fn test_fee_calculation_100bps() {
        let (fee, net) = calculate_task_fee(1_000_000, 100);
        assert_eq!(fee, 10_000); // 1.0%
        assert_eq!(net, 990_000);
    }

    #[test]
    fn test_fee_calculation_10bps() {
        let (fee, net) = calculate_task_fee(1_000_000, 10);
        assert_eq!(fee, 1_000); // 0.1%
        assert_eq!(net, 999_000);
    }

    #[test]
    #[should_panic(expected = "Fee BPS must be 10-100")]
    fn test_fee_calculation_invalid_bps() {
        calculate_task_fee(1_000_000, 5); // Too low
    }

    #[test]
    fn test_nullifier_deterministic() {
        let task_id = [1u8; 32];
        let sender = [2u8; 32];
        let n1 = compute_nullifier(&task_id, &sender, 1, 100);
        let n2 = compute_nullifier(&task_id, &sender, 1, 100);
        assert_eq!(n1, n2, "Nullifier should be deterministic");
    }

    #[test]
    fn test_nullifier_unique_per_nonce() {
        let task_id = [1u8; 32];
        let sender = [2u8; 32];
        let n1 = compute_nullifier(&task_id, &sender, 1, 100);
        let n2 = compute_nullifier(&task_id, &sender, 2, 100);
        assert_ne!(n1, n2, "Different nonces should produce different nullifiers");
    }

    #[test]
    fn test_circuit_types() {
        let ct = CircuitType::AITask;
        let json = serde_json::to_string(&ct).unwrap();
        assert!(json.contains("AITask"));

        let custom = CircuitType::Custom("my-circuit".to_string());
        let json2 = serde_json::to_string(&custom).unwrap();
        assert!(json2.contains("my-circuit"));
    }
}
