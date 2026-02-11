use cosmwasm_std::{DivideByZeroError, OverflowError, StdError};
use thiserror::Error;

#[derive(Error, Debug, PartialEq)]
pub enum ContractError {
    #[error("{0}")]
    Std(#[from] StdError),

    #[error("{0}")]
    Overflow(#[from] OverflowError),

    #[error("{0}")]
    DivideByZero(#[from] DivideByZeroError),

    #[error("Unauthorized")]
    Unauthorized {},

    #[error("Contract is paused")]
    Paused {},

    // ── Proof errors ────────────────────────────────────────────────────
    #[error("SP1 ZK proof verification failed")]
    InvalidProof {},

    #[error("Proof outcome: regenerable — {reason}")]
    ProofRegenerableFailure { reason: String },

    #[error("Nullifier already consumed (replay attack prevented)")]
    NullifierAlreadyUsed {},

    // ── Task errors ─────────────────────────────────────────────────────
    #[error("Task already exists: {task_id}")]
    TaskAlreadyExists { task_id: String },

    #[error("Task not found: {task_id}")]
    TaskNotFound { task_id: String },

    #[error("Task already settled: {task_id}")]
    TaskAlreadySettled { task_id: String },

    // ── A2A message errors ──────────────────────────────────────────────
    #[error("Message already exists: {message_id}")]
    MessageAlreadyExists { message_id: String },

    #[error("Message not found: {message_id}")]
    MessageNotFound { message_id: String },

    #[error("Message already verified: {message_id}")]
    MessageAlreadyVerified { message_id: String },

    #[error("Agent not registered: {agent}")]
    AgentNotRegistered { agent: String },

    // ── Validation errors ───────────────────────────────────────────────
    #[error("Fee BPS out of range (must be 50–100): {bps}")]
    InvalidFeeBps { bps: u16 },

    #[error("Amount below minimum: got {got}, need {min}")]
    AmountBelowMinimum { got: String, min: String },

    #[error("Invalid amount")]
    InvalidAmount {},

    #[error("Invalid Theta address format (must be 0x + 40 hex chars)")]
    InvalidThetaAddress {},

    #[error("TTL out of range (must be 1–86400 seconds): {ttl}")]
    InvalidTTL { ttl: u64 },

    #[error("Escrow required for message type {msg_type}")]
    EscrowRequired { msg_type: String },

    #[error("Escrow forbidden for message type {msg_type}")]
    EscrowForbidden { msg_type: String },

    #[error("Invalid output hash — COMPUTE_RESULT requires non-zero output_hash")]
    InvalidOutputHash {},

    #[error("Invalid model ID hash — INFERENCE_REQUEST requires non-zero model_id_hash")]
    InvalidModelIdHash {},

    #[error("Invalid input hash")]
    InvalidInputHash {},

    #[error("IBC channel required for cross-chain destination")]
    IbcChannelRequired {},

    #[error("Max tasks per block exceeded")]
    MaxTasksPerBlockExceeded {},

    #[error("Custom error: {val}")]
    CustomError { val: String },
}
