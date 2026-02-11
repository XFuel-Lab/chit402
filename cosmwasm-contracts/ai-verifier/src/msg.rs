use cosmwasm_schema::{cw_serde, QueryResponses};
use cosmwasm_std::{Addr, Binary, Uint128};

// ============================================================================
// ENUMS — Phase E.3 Message Types (sync with main.rs & AIDePINRouter.sol)
// ============================================================================

/// Supported destination chains for AI DePIN routing.
/// Must stay in sync with `ChainId` in:
///   - sp1-prover/program/src/main.rs
///   - contracts/AIDePINRouter.sol
///   - backend/theta-bridge/src/ai-listener.js
#[cw_serde]
pub enum ChainId {
    Theta,       // 0 — Theta EVM (origin chain, local compute via Edge Cloud)
    Osmosis,     // 1 — Primary Cosmos destination (BTC/AI pools, settlement)
    Akash,       // 2 — GPU compute marketplace (IBC-native)
    Bittensor,   // 3 — TAO AI inference subnets (Substrate + EVM)
    Persistence, // 4 — Backward-compatible LST routing
}

/// A2A/M2M message types from Whitepaper v4.5 Phase E.3.
/// Must stay in sync with `MessageType` in main.rs and AIDePINRouter.sol.
///
/// | Type              | Description                                          |
/// |-------------------|------------------------------------------------------|
/// | ComputeBid        | Agent requests GPU resources with ZK-verified escrow |
/// | ComputeResult     | Provider attests job completion with output hash     |
/// | InferenceRequest  | Route ML inference to optimal subnet                 |
/// | CapabilityQuery   | Agent discovers peer capabilities across chains      |
/// | DataAttestation   | Certify dataset provenance on-chain                  |
#[cw_serde]
pub enum MessageType {
    ComputeBid,
    ComputeResult,
    InferenceRequest,
    CapabilityQuery,
    DataAttestation,
}

/// Outcome of SP1 ZK proof verification.
/// Maps to `ProofOutcome` in sp1-prover/program/src/main.rs.
/// Allows non-fatal proof failures without halting the pipeline.
/// ai-listener.js retries `Regenerable` outcomes automatically.
#[cw_serde]
pub enum ProofOutcome {
    /// Proof validated successfully — settlement proceeds
    Valid,
    /// Soft failure — can retry (stale block height, network timeout)
    Regenerable { reason: String },
    /// Hard failure — permanently invalid
    Invalid { reason: String },
}

// ============================================================================
// SP1 PROOF STRUCTURE
// ============================================================================

/// SP1 ZK proof submitted by the relayer backend (ai-listener.js).
/// Compatible with both AITask and A2AMessage proof types from main.rs.
#[cw_serde]
pub struct SP1Proof {
    /// Raw proof bytes (SP1 STARK-to-SNARK recursion output)
    pub proof_data: Binary,
    /// Proof type discriminator: "ai_task" | "a2a_message" | "forward_deposit" | "reverse_burn"
    pub proof_type: String,
    /// Public inputs committed by the prover (JSON-encoded or binary)
    pub public_inputs: Binary,
    /// Verification key hash (ties proof to specific circuit version)
    pub vk_hash: String,
}

// ============================================================================
// INSTANTIATE
// ============================================================================

#[cw_serde]
pub struct InstantiateMsg {
    /// Admin address (can pause, update config, register relayers)
    pub admin: String,
    /// Fee collector contract address (receives 0.5-1% AI task fees)
    pub fee_collector: String,
    /// ibcTFUEL CW20 token contract address on Osmosis
    pub ibctfuel_token: String,
    /// Minimum fee BPS (default: 50 = 0.5%)
    pub min_fee_bps: Option<u16>,
    /// Maximum fee BPS (default: 100 = 1.0%)
    pub max_fee_bps: Option<u16>,
    /// Default fee BPS for AI tasks (default: 50 = 0.5%)
    pub default_fee_bps: Option<u16>,
    /// A2A relay fee BPS (default: 10 = 0.1%)
    pub a2a_relay_fee_bps: Option<u16>,
    /// Minimum task amount to prevent dust (default: 10000)
    pub min_task_amount: Option<Uint128>,
    /// Maximum batch size for proof verification (default: 20)
    pub max_batch_size: Option<u32>,
    /// Fee forwarding threshold — auto-forward when accumulated fees reach this (default: 100_000_000 = 100 ibcTFUEL)
    pub fee_forward_threshold: Option<Uint128>,
    /// Enable mock mode for governance testing (default: false)
    pub mock_mode: Option<bool>,
    /// IBC channel to Akash (e.g. "channel-1")
    pub akash_ibc_channel: Option<String>,
    /// IBC channel from Osmosis to Theta relay (for forward reference)
    pub theta_ibc_channel: Option<String>,
}

// ============================================================================
// EXECUTE MESSAGES
// ============================================================================

#[cw_serde]
pub enum ExecuteMsg {
    // ── AI Task Routing ─────────────────────────────────────────────────
    /// Route an AI task (inference, compute bid, data attestation, etc.)
    /// Validates inputs per task type, calculates fee, stores task.
    /// Emits `TaskRouted` event for ai-listener.js to detect.
    RouteTask {
        task_id: String,
        msg_type: MessageType,
        destination_chain: ChainId,
        /// Gross task amount in ibcTFUEL (micro-units)
        amount: Uint128,
        /// Custom fee BPS (50-100). If omitted, uses default_fee_bps.
        fee_bps: Option<u16>,
        /// Model ID hash (required for InferenceRequest)
        model_id_hash: Option<String>,
        /// Input data hash (required for InferenceRequest, DataAttestation)
        input_hash: Option<String>,
        /// Output hash (required for ComputeResult)
        output_hash: Option<String>,
        /// IBC channel for cross-chain routing (auto-resolved if omitted)
        ibc_channel: Option<String>,
    },

    // ── Task Settlement (SP1 ZK Proof Verification) ─────────────────────
    /// Settle a task with an SP1 ZK proof (called by relayer backend).
    /// Verifies proof → marks task settled → accumulates fees → emits events.
    ///
    /// Maps to `settleTask()` in AIDePINRouter.sol and `validate_ai_task()`
    /// output from main.rs: (nullifier, fee_commitment, output_hash).
    SettleTask {
        task_id: String,
        sp1_proof: SP1Proof,
        nullifier: String,
        output_hash: String,
        fee_commitment: String,
    },

    /// Batch-settle multiple tasks (matches UnifiedBatchOutput from main.rs)
    SettleTaskBatch {
        task_ids: Vec<String>,
        sp1_proofs: Vec<SP1Proof>,
        nullifiers: Vec<String>,
        output_hashes: Vec<String>,
        fee_commitments: Vec<String>,
    },

    // ── A2A Message Routing (Phase E.3) ─────────────────────────────────
    /// Submit a ZK-verifiable A2A (Agent-to-Agent) message.
    /// Agent must be registered via `RegisterAgent` first.
    /// Validates escrow requirements per message type.
    SendA2AMessage {
        message_id: String,
        msg_type: MessageType,
        recipient_chain: ChainId,
        payload_hash: String,
        /// Time-to-live in seconds (1 to 86400)
        ttl: u64,
        /// Escrow amount in ibcTFUEL (required for ComputeBid, InferenceRequest)
        escrow_amount: Option<Uint128>,
    },

    /// Verify an A2A message with an SP1 proof (called by relayer).
    VerifyA2AMessage {
        message_id: String,
        sp1_proof: SP1Proof,
        nullifier: String,
    },

    // ── Agent Registration ──────────────────────────────────────────────
    /// Register an AI agent's on-chain identity commitment.
    /// Required for A2A messaging — validate_a2a_message() checks sender_identity.
    RegisterAgent {
        /// Poseidon hash of the agent's identity secret
        identity_commitment: String,
    },

    // ── Fee Management ──────────────────────────────────────────────────
    /// CW20 Receive hook — accepts ibcTFUEL tokens as task payment / escrow.
    Receive {
        sender: String,
        amount: Uint128,
        msg: Binary,
    },

    /// Forward accumulated fees to FeeCollector.wasm.
    /// Can be called by anyone. Fees flow to 30/30/25/15 split via RevenueSplitter.
    ForwardFees {},

    // ── Admin Functions ─────────────────────────────────────────────────
    /// Add a relayer address (can settle tasks and verify A2A messages)
    AddRelayer { relayer: String },
    /// Remove a relayer address
    RemoveRelayer { relayer: String },
    /// Update admin
    SetAdmin { new_admin: String },
    /// Update fee collector address
    SetFeeCollector { new_fee_collector: String },
    /// Update default fee BPS
    SetDefaultFeeBps { fee_bps: u16 },
    /// Update fee forwarding threshold
    SetFeeForwardThreshold { threshold: Uint128 },
    /// Update Akash IBC channel
    SetAkashIbcChannel { channel: String },
    /// Emergency pause
    Pause {},
    /// Unpause
    Unpause {},
    /// Emergency withdraw stuck funds
    EmergencyWithdraw {
        amount: Uint128,
        recipient: String,
        denom: Option<String>,
    },
}

// ============================================================================
// QUERY MESSAGES
// ============================================================================

#[cw_serde]
#[derive(QueryResponses)]
pub enum QueryMsg {
    /// Get contract configuration
    #[returns(ConfigResponse)]
    Config {},

    /// Get contract state / aggregate stats
    #[returns(StateResponse)]
    State {},

    /// Get task details by ID
    #[returns(TaskResponse)]
    Task { task_id: String },

    /// Get A2A message details by ID
    #[returns(A2AMessageResponse)]
    Message { message_id: String },

    /// Check if an agent is registered
    #[returns(AgentResponse)]
    Agent { address: String },

    /// Check if a nullifier has been used
    #[returns(NullifierResponse)]
    Nullifier { nullifier: String },

    /// Calculate the fee for a given amount and BPS
    #[returns(FeeCalculationResponse)]
    CalculateFee { amount: Uint128, fee_bps: u16 },

    /// Get pending fees available for forwarding
    #[returns(PendingFeesResponse)]
    PendingFees {},

    /// List recent tasks (paginated)
    #[returns(TaskListResponse)]
    ListTasks {
        start_after: Option<String>,
        limit: Option<u32>,
    },

    /// List recent A2A messages (paginated)
    #[returns(MessageListResponse)]
    ListMessages {
        start_after: Option<String>,
        limit: Option<u32>,
    },
}

// ============================================================================
// QUERY RESPONSES
// ============================================================================

#[cw_serde]
pub struct ConfigResponse {
    pub admin: Addr,
    pub fee_collector: Addr,
    pub ibctfuel_token: Addr,
    pub min_fee_bps: u16,
    pub max_fee_bps: u16,
    pub default_fee_bps: u16,
    pub a2a_relay_fee_bps: u16,
    pub min_task_amount: Uint128,
    pub max_batch_size: u32,
    pub fee_forward_threshold: Uint128,
    pub mock_mode: bool,
    pub paused: bool,
    pub akash_ibc_channel: Option<String>,
    pub theta_ibc_channel: Option<String>,
}

#[cw_serde]
pub struct StateResponse {
    pub total_tasks_routed: u64,
    pub total_tasks_settled: u64,
    pub total_a2a_messages_verified: u64,
    pub total_fees_collected: Uint128,
    pub total_fees_forwarded: Uint128,
    pub pending_fees: Uint128,
    pub total_agents_registered: u64,
}

#[cw_serde]
pub struct TaskResponse {
    pub task_id: String,
    pub msg_type: MessageType,
    pub source_chain: ChainId,
    pub destination_chain: ChainId,
    pub requester: Addr,
    pub gross_amount: Uint128,
    pub fee_amount: Uint128,
    pub net_amount: Uint128,
    pub fee_bps: u16,
    pub output_hash: String,
    pub model_id_hash: String,
    pub input_hash: String,
    pub nonce: u64,
    pub timestamp: u64,
    pub settled: bool,
    pub proof_outcome: ProofOutcome,
}

#[cw_serde]
pub struct A2AMessageResponse {
    pub message_id: String,
    pub msg_type: MessageType,
    pub sender_chain: ChainId,
    pub recipient_chain: ChainId,
    pub sender: Addr,
    pub payload_hash: String,
    pub escrow_amount: Uint128,
    pub nonce: u64,
    pub ttl: u64,
    pub timestamp: u64,
    pub verified: bool,
}

#[cw_serde]
pub struct AgentResponse {
    pub address: Addr,
    pub identity_commitment: String,
    pub registered: bool,
    pub nonce: u64,
}

#[cw_serde]
pub struct NullifierResponse {
    pub nullifier: String,
    pub used: bool,
}

#[cw_serde]
pub struct FeeCalculationResponse {
    pub gross_amount: Uint128,
    pub fee_amount: Uint128,
    pub net_amount: Uint128,
    pub fee_bps: u16,
}

#[cw_serde]
pub struct PendingFeesResponse {
    pub pending: Uint128,
    pub threshold: Uint128,
    pub ready_to_forward: bool,
}

#[cw_serde]
pub struct TaskListResponse {
    pub tasks: Vec<TaskResponse>,
}

#[cw_serde]
pub struct MessageListResponse {
    pub messages: Vec<A2AMessageResponse>,
}

/// MinterResponse for compatibility queries
#[cw_serde]
pub struct MinterResponse {
    pub minter: Option<String>,
    pub cap: Option<Uint128>,
}
