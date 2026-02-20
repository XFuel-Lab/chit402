use cosmwasm_std::StdError;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Invalid split: BPS must sum to 10000, got {total}")]
    InvalidSplit { total: u16 },

    #[error("Fee-to-stake BPS must be 1500-2500, got {bps}")]
    InvalidFeeToStake { bps: u16 },

    #[error("Nothing to distribute")]
    NothingToDistribute {},

    #[error("Invalid recipient role: {role}")]
    InvalidRole { role: String },

    #[error("Zero amount")]
    ZeroAmount {},
}
