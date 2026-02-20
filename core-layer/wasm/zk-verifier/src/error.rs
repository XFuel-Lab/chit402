use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized: only admin can perform this action")]
    Unauthorized {},

    #[error("Contract is paused")]
    Paused {},

    #[error("Circuit not registered: {circuit_id}")]
    CircuitNotRegistered { circuit_id: String },

    #[error("Circuit already registered: {circuit_id}")]
    CircuitAlreadyRegistered { circuit_id: String },

    #[error("Nullifier already used: {nullifier}")]
    NullifierAlreadyUsed { nullifier: String },

    #[error("Invalid proof: verification failed")]
    InvalidProof {},

    #[error("Invalid hex encoding: {field}")]
    InvalidHex { field: String },

    #[error("Program vkey mismatch for circuit {circuit_id}")]
    VKeyMismatch { circuit_id: String },
}
