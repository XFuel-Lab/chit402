use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Invalid proof")]
    InvalidProof {},

    #[error("Proof already used (replay protection)")]
    ProofAlreadyUsed {},

    #[error("Invalid proof format: {msg}")]
    InvalidProofFormat { msg: String },
}

