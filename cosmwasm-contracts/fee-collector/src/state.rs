use cosmwasm_std::Addr;
use cw_storage_plus::Item;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use cosmwasm_std::Uint128;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub ibctfuel_token: Addr,
    pub minter_contract: Addr,
    pub min_burn_amount: Uint128,
    pub paused: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct State {
    pub accumulated_fees: Uint128,
    pub total_burned: Uint128,
    pub total_burns_count: u64,
    pub last_burn_time: u64,
}

impl Default for State {
    fn default() -> Self {
        State {
            accumulated_fees: Uint128::zero(),
            total_burned: Uint128::zero(),
            total_burns_count: 0,
            last_burn_time: 0,
        }
    }
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const STATE: Item<State> = Item::new("state");
