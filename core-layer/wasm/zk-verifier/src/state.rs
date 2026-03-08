use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Contract configuration.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub mock_mode: bool,
    pub paused: bool,
}

/// Registered circuit information.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct CircuitInfo {
    pub program_vkey: String,
    pub label: String,
}

/// Serialized arkworks VerifyingKey<Bn254> stored on-chain per circuit.
/// Populated via RegisterCircuit when `vkey_data` is provided.
/// Used by verify_sp1_proof_wasm for full Groth16 pairing checks.
pub const CIRCUIT_VKEYS: Map<&str, Vec<u8>> = Map::new("circuit_vkeys");

/// Verification statistics.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema, Default)]
pub struct Stats {
    pub total_verified: u64,
    pub total_failed: u64,
    pub circuit_count: u32,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const STATS: Item<Stats> = Item::new("stats");
pub const CIRCUITS: Map<&str, CircuitInfo> = Map::new("circuits");
pub const NULLIFIERS: Map<&str, bool> = Map::new("nullifiers");
