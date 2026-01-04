use cosmwasm_std::{StdError, OverflowError};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("{0}")]
    Overflow(#[from] OverflowError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Contract is paused")]
    ContractPaused {},

    #[error("Already minted for this Theta transaction")]
    AlreadyMinted {},

    #[error("Invalid amount")]
    InvalidAmount {},

    #[error("Max supply exceeded")]
    MaxSupplyExceeded {},

    #[error("Invalid Theta address format")]
    InvalidThetaAddress {},
}

