use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Addr, Uint128};
use cw20::{Cw20ReceiveMsg};

#[cw_serde]
pub struct InstantiateMsg {
    /// Admin address
    pub admin: Option<String>,
    /// ZK Verifier contract address
    pub zk_verifier: String,
    /// CW20 token name
    pub name: String,
    /// CW20 token symbol
    pub symbol: String,
    /// CW20 decimals (18 for TFUEL compatibility)
    pub decimals: u8,
    /// Initial supply (0 for fresh start)
    pub initial_supply: Uint128,
    /// Max supply cap (optional, for safety)
    pub max_supply: Option<Uint128>,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Verify ZK proof and mint ibcTFUEL
    VerifyAndMint {
        proof: ZkProof,
        public_inputs: Vec<String>,
        theta_tx_hash: String,
        nonce: u64,
        recipient: String,
        amount: Uint128,
    },
    /// Burn ibcTFUEL to signal unwrap on Theta
    Burn {
        amount: Uint128,
        theta_recipient: String, // Theta address to receive TFUEL
    },
    /// CW20 Receive hook
    Receive(Cw20ReceiveMsg),
    /// Update admin
    UpdateAdmin { admin: String },
    /// Update ZK verifier contract
    UpdateZkVerifier { zk_verifier: String },
    /// Emergency pause
    Pause {},
    /// Unpause
    Unpause {},
}

#[cw_serde]
pub enum ReceiveMsg {
    /// Burn tokens received via CW20 send
    BurnFrom {
        theta_recipient: String,
    },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// Get contract config
    #[returns(ConfigResponse)]
    Config {},
    /// Get minting stats
    #[returns(MintStatsResponse)]
    MintStats {},
    /// Get burn stats
    #[returns(BurnStatsResponse)]
    BurnStats {},
    /// Get mint record by Theta TX hash
    #[returns(MintRecordResponse)]
    MintRecord { theta_tx_hash: String },
    /// CW20 balance
    #[returns(cw20::BalanceResponse)]
    Balance { address: String },
    /// CW20 token info
    #[returns(cw20::TokenInfoResponse)]
    TokenInfo {},
}

#[cw_serde]
pub struct ZkProof {
    pub a: Vec<String>,
    pub b: Vec<Vec<String>>,
    pub c: Vec<String>,
}

#[cw_serde]
pub struct ConfigResponse {
    pub admin: Addr,
    pub zk_verifier: Addr,
    pub token_address: Addr,
    pub paused: bool,
    pub max_supply: Option<Uint128>,
}

#[cw_serde]
pub struct MintStatsResponse {
    pub total_minted: Uint128,
    pub total_mint_operations: u64,
    pub current_supply: Uint128,
}

#[cw_serde]
pub struct BurnStatsResponse {
    pub total_burned: Uint128,
    pub total_burn_operations: u64,
}

#[cw_serde]
pub struct MintRecordResponse {
    pub theta_tx_hash: String,
    pub recipient: Addr,
    pub amount: Uint128,
    pub minted_at: u64,
}

#[cw_serde]
pub struct MigrateMsg {}

