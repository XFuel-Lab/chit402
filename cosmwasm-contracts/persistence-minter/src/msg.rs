use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Addr, Uint128};
use cw20::{Cw20Coin, MinterResponse};

#[cw_serde]
pub struct InstantiateMsg {
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
    pub initial_balances: Vec<Cw20Coin>,
    pub mint_cap: Option<Uint128>,
    pub marketing: Option<cw20_base::msg::InstantiateMarketingInfo>,
    pub verifier_address: String,
    pub rev_splitter_address: String,
}

#[cw_serde]
pub enum ExecuteMsg {
    // CW20 standard messages
    Transfer {
        recipient: String,
        amount: Uint128,
    },
    Burn {
        amount: Uint128,
    },
    Send {
        contract: String,
        amount: Uint128,
        msg: cosmwasm_std::Binary,
    },
    IncreaseAllowance {
        spender: String,
        amount: Uint128,
        expires: Option<cw20::Expiration>,
    },
    DecreaseAllowance {
        spender: String,
        amount: Uint128,
        expires: Option<cw20::Expiration>,
    },
    TransferFrom {
        owner: String,
        recipient: String,
        amount: Uint128,
    },
    BurnFrom {
        owner: String,
        amount: Uint128,
    },
    
    // XFuel-specific messages
    VerifyAndMint {
        zk_proof: ZkProof,
        amount: Uint128,
        recipient: String,
    },
    BurnAndUnwrap {
        amount: Uint128,
    },
    
    // Admin messages
    SetVerifier {
        verifier_address: String,
    },
    SetRevSplitter {
        rev_splitter_address: String,
    },
    Pause {},
    Unpause {},
    
    // LST Staking integration
    DelegateToValidator {
        validator: String,
        amount: Uint128,
    },
}

#[cw_serde]
pub struct ZkProof {
    // Mock ZK proof structure for demonstration
    pub proof_data: String,
    pub public_inputs: Vec<String>,
    pub verification_key: String,
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    // CW20 standard queries
    #[returns(cw20::BalanceResponse)]
    Balance { address: String },
    
    #[returns(cw20::TokenInfoResponse)]
    TokenInfo {},
    
    #[returns(MinterResponse)]
    Minter {},
    
    #[returns(cw20::AllowanceResponse)]
    Allowance { owner: String, spender: String },
    
    #[returns(cw20::AllAccountsResponse)]
    AllAccounts {
        start_after: Option<String>,
        limit: Option<u32>,
    },
    
    // XFuel-specific queries
    #[returns(ConfigResponse)]
    Config {},
    
    #[returns(StateResponse)]
    State {},
}

#[cw_serde]
pub struct ConfigResponse {
    pub verifier_address: Addr,
    pub rev_splitter_address: Addr,
    pub paused: bool,
    pub admin: Addr,
}

#[cw_serde]
pub struct StateResponse {
    pub total_minted: Uint128,
    pub total_burned: Uint128,
    pub total_recycled: Uint128,
    pub total_lp_reinvest: Uint128,
}

// Event structures for emitting
#[cw_serde]
pub struct MintEvent {
    pub recipient: String,
    pub amount: Uint128,
    pub proof_hash: String,
}

#[cw_serde]
pub struct UnwrapEvent {
    pub burner: String,
    pub amount: Uint128,
    pub recycled_amount: Uint128,
    pub lp_reinvest_amount: Uint128,
}



