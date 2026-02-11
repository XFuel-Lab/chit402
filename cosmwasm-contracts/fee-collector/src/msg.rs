use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Addr, Uint128};

#[cw_serde]
pub struct InstantiateMsg {
    /// Admin address (can pause, trigger burns, update settings)
    pub admin: String,
    /// Address of the ibcTFUEL token contract
    pub ibctfuel_token: String,
    /// Address of the persistence-minter contract (burns flow back here)
    pub minter_contract: String,
    /// Minimum accumulated fees before burn is allowed (prevents dust burns)
    pub min_burn_amount: Uint128,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// CW20 Receive hook - called when ibcTFUEL tokens are sent to this contract
    /// This is the standard CW20 pattern for receiving tokens
    Receive {
        sender: String,
        amount: Uint128,
        msg: cosmwasm_std::Binary,
    },

    /// Trigger fee burn (callable by admin or governance/CronCat)
    /// Burns all accumulated fees and emits FeeBurn event for SP1 proof
    TriggerFeeBurn {},

    /// Update admin address
    SetAdmin { new_admin: String },

    /// Update minter contract address
    SetMinterContract { new_minter: String },

    /// Update minimum burn amount
    SetMinBurnAmount { amount: Uint128 },

    /// Emergency pause
    Pause {},

    /// Unpause
    Unpause {},

    /// Emergency withdraw (admin only, for stuck funds)
    EmergencyWithdraw { amount: Uint128, recipient: String },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// Get current config
    #[returns(ConfigResponse)]
    Config {},

    /// Get current state (accumulated fees, total burned, etc.)
    #[returns(StateResponse)]
    State {},

    /// Check if ready to burn (accumulated >= min_burn_amount)
    #[returns(ReadyToBurnResponse)]
    ReadyToBurn {},
}

#[cw_serde]
pub struct ConfigResponse {
    pub admin: Addr,
    pub ibctfuel_token: Addr,
    pub minter_contract: Addr,
    pub min_burn_amount: Uint128,
    pub paused: bool,
}

#[cw_serde]
pub struct StateResponse {
    pub accumulated_fees: Uint128,
    pub total_burned: Uint128,
    pub total_burns_count: u64,
    pub last_burn_time: u64,
}

#[cw_serde]
pub struct ReadyToBurnResponse {
    pub ready: bool,
    pub accumulated: Uint128,
    pub minimum: Uint128,
}
