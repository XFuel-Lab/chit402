use cosmwasm_std::Addr;
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub minter_contract: Option<Addr>,
    pub total_verifications: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ProofRecord {
    pub theta_tx_hash: String,
    pub nonce: u64,
    pub verified_at: u64,
    pub public_inputs: Vec<String>,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const PROOF_RECORDS: Map<&str, ProofRecord> = Map::new("proof_records");

