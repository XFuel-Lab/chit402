use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::msg::SplitConfig;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub bbb_address: Addr,
    pub lp_address: Addr,
    pub staker_address: Addr,
    pub treasury_address: Addr,
    pub stake_pool_address: Option<Addr>,
    pub split: SplitConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema, Default)]
pub struct Stats {
    pub total_collected: Uint128,
    pub total_distributed: Uint128,
    pub total_bbb: Uint128,
    pub total_lp: Uint128,
    pub total_staker: Uint128,
    pub total_treasury: Uint128,
    pub total_fee_to_stake: Uint128,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const STATS: Item<Stats> = Item::new("stats");
pub const CIRCUIT_FEES: Map<&str, Uint128> = Map::new("circuit_fees");
