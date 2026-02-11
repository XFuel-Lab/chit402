use cosmwasm_std::{StdError, OverflowError};
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("{0}")]
    Overflow(#[from] OverflowError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Contract is paused")]
    Paused {},

    #[error("Invalid amount")]
    InvalidAmount {},

    #[error("Insufficient balance")]
    InsufficientBalance {},

    #[error("Custom error: {val:?}")]
    CustomError { val: String },
}
