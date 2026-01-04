use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub zk_verifier: Addr,
    pub paused: bool,
    pub max_supply: Option<Uint128>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct MintRecord {
    pub theta_tx_hash: String,
    pub recipient: Addr,
    pub amount: Uint128,
    pub minted_at: u64,
    pub nonce: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct BurnRecord {
    pub burner: Addr,
    pub amount: Uint128,
    pub theta_recipient: String,
    pub burned_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Stats {
    pub total_minted: Uint128,
    pub total_burned: Uint128,
    pub total_mint_operations: u64,
    pub total_burn_operations: u64,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const STATS: Item<Stats> = Item::new("stats");
pub const MINT_RECORDS: Map<&str, MintRecord> = Map::new("mint_records");
pub const BURN_RECORDS: Map<u64, BurnRecord> = Map::new("burn_records");

