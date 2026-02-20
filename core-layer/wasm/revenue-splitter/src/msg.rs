use cosmwasm_std::Uint128;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Revenue split configuration (in basis points, must sum to 10000).
///
/// Default: 30% BBB / 30% LP / 25% Stakers / 15% Treasury
/// Fee-to-stake: 15-25% of treasury allocation routed to validator staking.
///
/// Per Theta Metachain docs: Subchain validators require wTHETA collateral
/// (1,000 wTHETA per validator + 20,000 TFUEL reserves).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SplitConfig {
    pub bbb_bps: u16,       // Buyback-burn
    pub lp_bps: u16,        // Liquidity provision
    pub staker_bps: u16,    // veXF staker rewards
    pub treasury_bps: u16,  // Protocol treasury
    pub fee_to_stake_bps: u16, // % of treasury to validator staking (1500-2500)
}

impl Default for SplitConfig {
    fn default() -> Self {
        SplitConfig {
            bbb_bps: 3000,
            lp_bps: 3000,
            staker_bps: 2500,
            treasury_bps: 1500,
            fee_to_stake_bps: 2000, // 20% of treasury → staking
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub admin: String,
    pub bbb_address: String,
    pub lp_address: String,
    pub staker_address: String,
    pub treasury_address: String,
    /// Validator staking pool address (e.g., wTHETA/TFUEL pool).
    /// Can be empty string to disable fee-to-stake.
    pub stake_pool_address: String,
    /// Optional: override default split config.
    pub split_config: Option<SplitConfig>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    /// Distribute accumulated native token fees according to the split.
    Distribute {},

    /// Receive fees tagged with a circuit identifier.
    DepositFee { circuit_id: String },

    /// Update split configuration (admin only).
    UpdateSplit { config: SplitConfig },

    /// Update recipient addresses (admin only).
    UpdateRecipient { role: String, address: String },

    /// Update admin (admin only).
    UpdateAdmin { new_admin: String },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    GetConfig {},
    GetStats {},
    GetSplit {},
    GetPendingBalance {},
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct ConfigResponse {
    pub admin: String,
    pub bbb_address: String,
    pub lp_address: String,
    pub staker_address: String,
    pub treasury_address: String,
    pub stake_pool_address: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct StatsResponse {
    pub total_collected: Uint128,
    pub total_distributed: Uint128,
    pub total_bbb: Uint128,
    pub total_lp: Uint128,
    pub total_staker: Uint128,
    pub total_treasury: Uint128,
    pub total_fee_to_stake: Uint128,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct SplitResponse {
    pub config: SplitConfig,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct PendingBalanceResponse {
    pub amount: Uint128,
}
