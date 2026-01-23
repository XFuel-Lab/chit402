use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub verifier_address: Addr,
    pub rev_splitter_address: Addr,
    pub paused: bool,
    pub mint_cap: Option<Uint128>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct State {
    pub total_minted: Uint128,
    pub total_burned: Uint128,
    pub total_recycled: Uint128,
    pub total_lp_reinvest: Uint128,
}

impl Default for State {
    fn default() -> Self {
        State {
            total_minted: Uint128::zero(),
            total_burned: Uint128::zero(),
            total_recycled: Uint128::zero(),
            total_lp_reinvest: Uint128::zero(),
        }
    }
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const STATE: Item<State> = Item::new("state");

// Track processed proofs to prevent replay attacks
pub const PROCESSED_PROOFS: Map<&str, bool> = Map::new("processed_proofs");

// Track users who received initial XPRT funding
pub const FUNDED_USERS: Map<&Addr, bool> = Map::new("funded_users");




