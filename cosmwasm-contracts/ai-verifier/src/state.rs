use cosmwasm_std::{Addr, Uint128};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::msg::{ChainId, MessageType, ProofOutcome};

// ============================================================================
// CONFIG — Immutable-ish settings (admin-updatable)
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    /// Admin address (governance multisig in production)
    pub admin: Addr,
    /// Fee collector contract (receives accumulated AI task fees)
    pub fee_collector: Addr,
    /// ibcTFUEL CW20 token contract on Osmosis
    pub ibctfuel_token: Addr,
    /// Minimum fee BPS (0.5% = 50)
    pub min_fee_bps: u16,
    /// Maximum fee BPS (1.0% = 100)
    pub max_fee_bps: u16,
    /// Default fee BPS for AI tasks (0.5% = 50)
    pub default_fee_bps: u16,
    /// A2A relay fee BPS (0.1% = 10)
    pub a2a_relay_fee_bps: u16,
    /// Minimum task amount (dust protection)
    pub min_task_amount: Uint128,
    /// Maximum batch size for proof verification
    pub max_batch_size: u32,
    /// Fee forwarding threshold (auto-forward to FeeCollector)
    pub fee_forward_threshold: Uint128,
    /// Mock mode — skip SP1 proof verification for governance testing
    pub mock_mode: bool,
    /// Contract paused flag
    pub paused: bool,
    /// IBC channel to Akash (e.g. "channel-1")
    pub akash_ibc_channel: Option<String>,
    /// IBC channel to Theta relay
    pub theta_ibc_channel: Option<String>,
}

// ============================================================================
// STATE — Mutable aggregate counters
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct State {
    pub total_tasks_routed: u64,
    pub total_tasks_settled: u64,
    pub total_a2a_messages_verified: u64,
    pub total_fees_collected: Uint128,
    pub total_fees_forwarded: Uint128,
    pub pending_fees: Uint128,
    pub total_agents_registered: u64,
}

impl Default for State {
    fn default() -> Self {
        State {
            total_tasks_routed: 0,
            total_tasks_settled: 0,
            total_a2a_messages_verified: 0,
            total_fees_collected: Uint128::zero(),
            total_fees_forwarded: Uint128::zero(),
            pending_fees: Uint128::zero(),
            total_agents_registered: 0,
        }
    }
}

// ============================================================================
// AI TASK — Stored per task_id
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct AITask {
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

// ============================================================================
// A2A MESSAGE — Stored per message_id
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct A2AMessage {
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

// ============================================================================
// AGENT REGISTRATION
// ============================================================================

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct RegisteredAgent {
    pub address: Addr,
    pub identity_commitment: String,
    pub registered_at: u64,
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

/// Contract config (singleton)
pub const CONFIG: Item<Config> = Item::new("config");

/// Aggregate state counters (singleton)
pub const STATE: Item<State> = Item::new("state");

/// AI tasks indexed by task_id
pub const TASKS: Map<&str, AITask> = Map::new("tasks");

/// A2A messages indexed by message_id
pub const A2A_MESSAGES: Map<&str, A2AMessage> = Map::new("a2a_messages");

/// Registered AI agents indexed by address
pub const REGISTERED_AGENTS: Map<&Addr, RegisteredAgent> = Map::new("registered_agents");

/// Per-agent nonce tracking (agent address → last used nonce)
pub const AGENT_NONCES: Map<&Addr, u64> = Map::new("agent_nonces");

/// Used nullifiers for replay protection (nullifier string → true)
pub const USED_NULLIFIERS: Map<&str, bool> = Map::new("used_nullifiers");

/// Authorized relayer addresses (relayer address → true)
pub const RELAYERS: Map<&Addr, bool> = Map::new("relayers");
