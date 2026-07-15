use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Instantiate message for the ZK Verifier contract.
///
/// Research ties (CosmWasm docs, 2026):
///   - Entry point pattern: instantiate, execute, query.
///   - cw-storage-plus for typed key-value state.
///   - IBC integration via stargate feature for cross-chain proof relay.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    /// Admin address (can update program keys, pause contract).
    pub admin: String,
    /// Whether to run in mock mode (accept all proofs without verification).
    pub mock_mode: bool,
}

/// Execute messages for proof verification and circuit management.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Verify an SP1 proof.
    /// Chain-agnostic: works with any SP1 program verification key.
    VerifyProof {
        /// Circuit identifier (e.g., "ai_task", "forward_deposit").
        circuit_id: String,
        /// SP1 program verification key (hex-encoded 32 bytes).
        program_vkey: String,
        /// ABI-encoded public values committed by the SP1 program (hex).
        public_values: String,
        /// Groth16 or PLONK proof bytes (hex).
        proof_bytes: String,
        /// Nullifier for replay protection (hex-encoded 32 bytes).
        nullifier: String,
    },

    /// Register a new circuit's program verification key.
    /// Optional vkey_data: hex-encoded serialized arkworks VerifyingKey<Bn254>
    /// for full BN254 Groth16 pairing verification in production mode.
    RegisterCircuit {
        circuit_id: String,
        program_vkey: String,
        label: String,
        vkey_data: Option<String>,
    },

    /// Remove a circuit.
    RemoveCircuit {
        circuit_id: String,
    },

    /// Update admin address.
    UpdateAdmin {
        new_admin: String,
    },

    /// Toggle mock mode.
    SetMockMode {
        enabled: bool,
    },

    /// Pause/unpause the contract.
    SetPaused {
        paused: bool,
    },
}

/// Query messages.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    /// Check if a nullifier has been used.
    IsNullifierUsed { nullifier: String },

    /// Get circuit info.
    GetCircuit { circuit_id: String },

    /// Get contract statistics.
    GetStats {},

    /// Get contract configuration.
    GetConfig {},
}

// ─── Query Responses ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct NullifierResponse {
    pub used: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct CircuitResponse {
    pub circuit_id: String,
    pub program_vkey: String,
    pub label: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct StatsResponse {
    pub total_verified: u64,
    pub total_failed: u64,
    pub circuit_count: u32,
    pub mock_mode: bool,
    pub paused: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub admin: String,
    pub mock_mode: bool,
    pub paused: bool,
}

/// Migration message for contract upgrades.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MigrateMsg {}
