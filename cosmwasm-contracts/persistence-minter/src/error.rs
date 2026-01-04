use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Contract is paused")]
    Paused {},

    #[error("ZK proof verification failed")]
    InvalidProof {},

    #[error("Invalid recipient address")]
    InvalidRecipient {},

    #[error("Insufficient balance")]
    InsufficientBalance {},

    #[error("Amount must be greater than zero")]
    InvalidAmount {},

    #[error("Mint cap exceeded")]
    MintCapExceeded {},

    #[error("Custom Error val: {val:?}")]
    CustomError { val: String },
}



