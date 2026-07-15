use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::Addr;

#[cw_serde]
pub struct InstantiateMsg {
    pub admin: Option<String>,
    pub minter_contract: Option<String>,
}

#[cw_serde]
pub enum ExecuteMsg {
    /// Verify a Groth16 ZK-SNARK proof
    VerifyProof {
        proof: ZkProof,
        public_inputs: Vec<String>,
        theta_tx_hash: String,
        nonce: u64,
    },
    /// Update admin
    UpdateAdmin { admin: String },
    /// Set authorized minter contract
    SetMinterContract { minter: String },
}

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// Get contract config
    #[returns(ConfigResponse)]
    Config {},
    /// Check if a proof has been used (replay protection)
    #[returns(ProofStatusResponse)]
    ProofStatus { theta_tx_hash: String },
    /// Get verification count
    #[returns(StatsResponse)]
    Stats {},
}

#[cw_serde]
pub struct ZkProof {
    /// Groth16 proof components (mock format for now)
    pub a: Vec<String>, // Point A (2 elements)
    pub b: Vec<Vec<String>>, // Point B (2x2 elements)
    pub c: Vec<String>, // Point C (2 elements)
}

#[cw_serde]
pub struct ConfigResponse {
    pub admin: Addr,
    pub minter_contract: Option<Addr>,
    pub total_verifications: u64,
}

#[cw_serde]
pub struct ProofStatusResponse {
    pub theta_tx_hash: String,
    pub used: bool,
    pub verified_at: Option<u64>,
}

#[cw_serde]
pub struct StatsResponse {
    pub total_verifications: u64,
    pub unique_transactions: u64,
}

/// Migration message
#[cw_serde]
pub struct MigrateMsg {}

