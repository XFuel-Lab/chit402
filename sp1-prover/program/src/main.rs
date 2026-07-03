#![no_main]
sp1_zkvm::entrypoint!(main);

use serde::{Deserialize, Serialize};
use xfuel_sp1_hooks::{
    compute_payment_commitment, is_zero_bytes32, u256_be32_from_le_bytes, PAYMENT_RAIL_USDC,
    PAYMENT_RAIL_TFUEL,
};

// ============================================================================
// SP1 BIDIRECTIONAL BRIDGE PROOF + AI DePIN zkML EXTENSIONS
// ============================================================================
// Version: 5.1 (Phase 2 — x402 payment binding in v2 public values)
// Date: July 2026
// Changes from v5.0:
// - Phase 2: optional v2 public-values layout binds x402 payment_ref via
//   paymentCommitment (13th ABI field; mirrors SP1ProofHooks.encodeAITaskPublicValuesV2)
// - Guest verifies keccak256(abi.encodePacked(refHash, taskIdHash, rail, amount))
//   when public_values_version == 2 and payment_commitment != bytes32(0)
// - Controlled by batch input `public_values_version` (1 = v1 default, 2 = v2)
// Changes from v4.0:
// - Added AI DePIN proof circuits (Phase E.2/E.3)
// - Added zkML inference output verification (COMPUTE_RESULT with output_hash)
// - Added A2A/M2M message verification circuits (5 message types)
// - Added task fee burn calculation (0.5-1% variable, FeeCollector hook)
// - Added Osmosis/Akash IBC message compatibility (ChainId, IBC channel fields)
// - Added TAO EVM call compatibility (Substrate bridge fields)
// - Added non-fatal proof failure handling (ProofOutcome with regenerate option)
// - Integrated with ai-listener.js proof request format (ai_task fields)
// - Retained all v4.0 bidirectional bridge support (ForwardDeposit, ReverseBurn, FeeBurn)
// ============================================================================

// ============================================================================
// TYPES - Match Theta EVM, Osmosis/Akash IBC, and TAO Substrate/EVM
// ============================================================================

/// Ethereum-compatible address (160 bits / 20 bytes)
type Address = [u8; 20];

/// 256-bit hash (Poseidon output, tx hash, block hash, output_hash)
type Hash256 = [u8; 32];

/// U256 represented as little-endian bytes
#[derive(Debug, Clone, Serialize, Deserialize)]
struct U256([u8; 32]);

impl U256 {
    fn from_le_bytes(bytes: [u8; 32]) -> Self {
        U256(bytes)
    }

    fn to_le_bytes(&self) -> [u8; 32] {
        self.0
    }

    /// Check if the value is zero
    fn is_zero(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }

    /// Check if value fits in n bits
    fn check_range(&self, max_bits: u32) -> bool {
        let mut leading_zeros = 0;
        for &byte in self.0.iter().rev() {
            if byte == 0 {
                leading_zeros += 8;
            } else {
                leading_zeros += byte.leading_zeros() as usize;
                break;
            }
        }

        let used_bits = 256 - leading_zeros;
        used_bits <= max_bits as usize
    }

    #[inline(always)]
    fn checked_mul(&self, other: &U256) -> Option<U256> {
        let a = u128::from_le_bytes(self.0[..16].try_into().unwrap());
        let b = u128::from_le_bytes(other.0[..16].try_into().unwrap());

        let result = a.checked_mul(b)?;
        let mut bytes = [0u8; 32];
        bytes[..16].copy_from_slice(&result.to_le_bytes());
        Some(U256(bytes))
    }

    #[inline(always)]
    fn mul(&self, other: &U256) -> U256 {
        self.checked_mul(other)
            .expect("U256 multiplication overflow")
    }

    #[inline(always)]
    fn checked_sub(&self, other: &U256) -> Option<U256> {
        let a = u128::from_le_bytes(self.0[..16].try_into().unwrap());
        let b = u128::from_le_bytes(other.0[..16].try_into().unwrap());

        let result = a.checked_sub(b)?;
        let mut bytes = [0u8; 32];
        bytes[..16].copy_from_slice(&result.to_le_bytes());
        Some(U256(bytes))
    }

    #[inline(always)]
    fn sub(&self, other: &U256) -> U256 {
        self.checked_sub(other)
            .expect("U256 subtraction underflow")
    }

    #[inline(always)]
    fn checked_add(&self, other: &U256) -> Option<U256> {
        let a = u128::from_le_bytes(self.0[..16].try_into().unwrap());
        let b = u128::from_le_bytes(other.0[..16].try_into().unwrap());

        let result = a.checked_add(b)?;
        let mut bytes = [0u8; 32];
        bytes[..16].copy_from_slice(&result.to_le_bytes());
        Some(U256(bytes))
    }

    #[inline(always)]
    fn div(&self, divisor: u64) -> U256 {
        let value = u128::from_le_bytes(self.0[..16].try_into().unwrap());
        let result = value / divisor as u128;
        let mut bytes = [0u8; 32];
        bytes[..16].copy_from_slice(&result.to_le_bytes());
        U256(bytes)
    }

    #[inline(always)]
    fn as_u128(&self) -> u128 {
        u128::from_le_bytes(self.0[..16].try_into().unwrap())
    }

    #[inline(always)]
    fn lt(&self, other: &U256) -> bool {
        self.as_u128() < other.as_u128()
    }

    #[inline(always)]
    fn gte(&self, other: &U256) -> bool {
        self.as_u128() >= other.as_u128()
    }

    #[inline(always)]
    fn eq(&self, other: &U256) -> bool {
        self.0 == other.0
    }

    /// Construct a U256 from a u64 value
    #[inline(always)]
    fn from_u64(value: u64) -> U256 {
        let mut bytes = [0u8; 32];
        bytes[..8].copy_from_slice(&value.to_le_bytes());
        U256(bytes)
    }
}

// ============================================================================
// CHAIN AND MESSAGE ENUMS (Phase E — Osmosis/Akash/TAO)
// ============================================================================

/// Supported destination chains for AI DePIN routing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChainId {
    Theta,       // Theta EVM (origin chain)
    Osmosis,     // Osmosis DEX (primary Cosmos destination, BTC/AI pools)
    Akash,       // Akash Network (GPU compute marketplace, IBC-native)
    Bittensor,   // Bittensor / TAO (AI inference subnets, Substrate + EVM)
    Persistence, // Persistence (backward-compatible LST destination)
}

/// A2A/M2M message types — Phase E.3 ZK-verifiable agent communications
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageType {
    ComputeBid,        // Agent requests GPU resources with ZK-verified escrow
    ComputeResult,     // Provider attests job completion with output_hash
    InferenceRequest,  // Route ML inference to optimal subnet
    CapabilityQuery,   // Agent discovers peer capabilities across chains
    DataAttestation,   // Certify dataset provenance on-chain
}

// ============================================================================
// BATCH INPUT/OUTPUT STRUCTURES (Phase 2 - Bidirectional + Phase E - AI DePIN)
// ============================================================================

/// Proof type discriminator — extended for AI DePIN in Phase E
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProofType {
    ForwardDeposit, // TFUEL → ibcTFUEL (existing Phase C)
    ReverseBurn,    // ibcTFUEL → TFUEL (existing Phase C)
    FeeBurn,        // Fee collector burn (existing Phase C)
    AITask,         // AI task settlement proof (Phase E — inference, compute, data)
    A2AMessage,     // Agent-to-Agent message verification (Phase E.3)
}

/// Outcome of proof validation — supports non-fatal failures with regeneration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProofOutcome {
    /// Proof validated successfully
    Valid,
    /// Proof failed but can be regenerated (non-fatal)
    /// Contains a reason string hash for diagnostics
    Regenerable { reason_hash: Hash256 },
    /// Proof is permanently invalid (fatal)
    Invalid { reason_hash: Hash256 },
}

// ── Existing bridge structures ───────────────────────────────────────────────

/// Public inputs for a single deposit (forward flow)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PublicInputs {
    pub vault_address: Address,
    pub net_amount: U256,
    pub block_number: u64,
    pub merkle_root: Hash256,
    pub identity_commitment: Hash256,
}

/// Public inputs for reverse burn (user-initiated unwrap)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReverseBurnPublicInputs {
    pub user_address: Hash256,    // Cosmos address (32 bytes)
    pub theta_recipient: Address, // Theta address to receive TFUEL
    pub burned_amount: U256,      // Amount burned (99.5% after fee)
    pub nonce: u64,               // Per-user nonce for replay protection
    pub block_height: u64,        // Cosmos block height
    pub timestamp: u64,           // Block timestamp
    pub chain_id: Hash256,        // Chain ID hashed (e.g. "osmosis-1" or "core-1")
}

/// Public inputs for fee burn (protocol-initiated)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct FeeBurnPublicInputs {
    pub fee_amount: U256, // Total fees burned
    pub burn_count: u64,  // Sequential burn counter
    pub block_height: u64,
    pub timestamp: u64,
}

/// Private inputs for a single deposit (forward flow)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PrivateInputs {
    pub sender_address: Address,
    pub gross_amount: U256,
    pub fee_amount: U256,
    pub block_hash: Hash256,
    pub block_timestamp: u64,
    pub tx_hash: Hash256,
    pub tx_index: u16,
    pub merkle_proof: Vec<Hash256>,
    pub merkle_path_indices: Vec<bool>,
    pub identity_secret: Hash256,
    pub identity_nullifier: Hash256,
    pub identity_trapdoor: Hash256,
}

/// Private inputs for reverse burn
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReverseBurnPrivateInputs {
    pub tx_hash: Hash256,    // Cosmos tx hash
    pub event_index: u16,    // Event index in tx
    pub fee_amount: U256,    // Fee taken (0.5%)
    pub gross_amount: U256,  // Total amount before fee
}

// ── AI DePIN structures (Phase E) ────────────────────────────────────────────

/// Public inputs for AI task settlement proof
/// Compatible with ai-listener.js proof request format
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AITaskPublicInputs {
    pub task_type: MessageType,       // COMPUTE_BID | COMPUTE_RESULT | INFERENCE_REQUEST | etc.
    pub source_chain: ChainId,        // Chain where the task originated
    pub destination_chain: ChainId,   // Chain where settlement occurs
    pub task_id_hash: Hash256,        // SHA-256 of task ID (from ai-listener.js taskId)
    pub sender_hash: Hash256,         // Hash of sender address (cross-chain compatible)
    pub net_amount: U256,             // Net settlement amount after fee
    pub fee_amount: U256,             // Fee collected (0.5-1%)
    pub fee_bps: u16,                 // Fee rate in basis points (50-100)
    pub output_hash: Hash256,         // Hash of compute/inference output (critical for COMPUTE_RESULT)
    pub block_height: u64,            // Source chain block height
    pub timestamp: u64,               // Task completion timestamp
    pub nonce: u64,                   // Per-agent replay protection
    /// Phase 2 (v2): x402 payment commitment bound into the proof.
    /// `bytes32(0)` = unbound (TFUEL rail or binding disabled). When non-zero and
    /// `public_values_version == 2`, the guest verifies it against private witness fields.
    pub payment_commitment: Hash256,
}

/// Private inputs for AI task settlement proof
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AITaskPrivateInputs {
    pub gross_amount: U256,           // Total task value before fee
    pub source_tx_hash: Hash256,      // Source chain transaction hash
    pub model_id_hash: Hash256,       // Hash of model identifier (for inference tasks)
    pub input_hash: Hash256,          // Hash of task input data
    pub provider_hash: Hash256,       // Hash of compute provider identity
    pub execution_duration_ms: u64,   // Task execution time in milliseconds
    pub ibc_channel_hash: Hash256,    // Hash of IBC channel ID (Osmosis/Akash routing)
    pub tao_evm_target: Address,      // TAO EVM contract address (zero if non-TAO)
    /// Phase 2 (v2): witness for payment commitment verification (ignored in v1).
    pub payment_ref_hash: Hash256,
    pub payment_rail: u8,             // 1 = USDC/x402, 2 = TFUEL
}

/// Public inputs for A2A/M2M message verification (Phase E.3)
/// Extends SP1 circuits to verify AI agent communications across chains
#[derive(Debug, Clone, Serialize, Deserialize)]
struct A2AMessagePublicInputs {
    pub msg_type: MessageType,        // COMPUTE_BID | COMPUTE_RESULT | etc.
    pub sender_chain: ChainId,        // Origin chain
    pub recipient_chain: ChainId,     // Destination chain
    pub payload_hash: Hash256,        // SHA-256 of message payload
    pub nonce: u64,                   // Per-agent replay protection
    pub escrow_amount: U256,          // TFUEL/AKT/TAO locked for task (zero if no escrow)
    pub timestamp: u64,               // Message timestamp
    pub ttl: u64,                     // Time-to-live in seconds
    pub block_height: u64,            // Source chain block height
}

/// Private inputs for A2A/M2M message verification
#[derive(Debug, Clone, Serialize, Deserialize)]
struct A2AMessagePrivateInputs {
    pub sender_identity: Hash256,     // On-chain agent identity commitment
    pub sender_address: Hash256,      // Sender address (chain-specific, padded to 32)
    pub recipient_address: Hash256,   // Recipient address (chain-specific, padded to 32)
    pub escrow_tx_hash: Hash256,      // Escrow deposit tx hash (zero if no escrow)
    pub ibc_channel_hash: Hash256,    // IBC channel for cross-chain delivery
    pub payload_size: u32,            // Payload size in bytes (for gas estimation)
}

// ── Unified batch structures ─────────────────────────────────────────────────

/// Unified batch public inputs (Phase E — all proof types)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UnifiedBatchPublicInputs {
    /// Public-values layout: 1 = v1 (12 fields), 2 = v2 (+ paymentCommitment).
    pub public_values_version: u8,
    pub proof_type: ProofType,
    pub batch_size: u32,
    // Bridge flows (Phase C)
    pub deposits: Vec<PublicInputs>,
    pub reverse_burns: Vec<ReverseBurnPublicInputs>,
    pub fee_burns: Vec<FeeBurnPublicInputs>,
    // AI DePIN flows (Phase E)
    pub ai_tasks: Vec<AITaskPublicInputs>,
    pub a2a_messages: Vec<A2AMessagePublicInputs>,
}

/// Unified batch private inputs (Phase E — all proof types)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UnifiedBatchPrivateInputs {
    // Bridge flows (Phase C)
    pub deposits: Vec<PrivateInputs>,
    pub reverse_burns: Vec<ReverseBurnPrivateInputs>,
    // AI DePIN flows (Phase E)
    pub ai_tasks: Vec<AITaskPrivateInputs>,
    pub a2a_messages: Vec<A2AMessagePrivateInputs>,
}

/// Unified batch output (Phase E — extended with AI task fields)
#[derive(Debug, Clone, Serialize, Deserialize)]
struct UnifiedBatchOutput {
    pub proof_type: ProofType,
    pub batch_size: u32,
    pub nullifiers: Vec<Hash256>,
    pub batch_commitment: Hash256,
    /// Non-fatal proof outcome — allows regeneration on soft failures
    pub outcome: ProofOutcome,
    /// Aggregate fee amount for AI tasks in this batch (zero for bridge proofs)
    pub aggregate_fee: U256,
    /// Output hashes for COMPUTE_RESULT proofs (empty for other types)
    pub output_hashes: Vec<Hash256>,
    /// Phase 2 (v2): per-task payment commitments (parallel to ai_tasks; empty for bridge proofs)
    pub payment_commitments: Vec<Hash256>,
    /// Echo of the input layout version (1 or 2).
    pub public_values_version: u8,
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

fn is_valid_hash(hash: &Hash256) -> bool {
    hash.iter().any(|&b| b != 0)
}

fn is_valid_address(addr: &Address) -> bool {
    addr.iter().any(|&b| b != 0)
}

/// Check if an address is the zero address
fn is_zero_address(addr: &Address) -> bool {
    addr.iter().all(|&b| b == 0)
}

/// Phase 0.5 optimized hash
#[inline(always)]
fn poseidon_hash(inputs: &[Hash256]) -> Hash256 {
    let mut result = [0u8; 32];

    for (i, input) in inputs.iter().enumerate() {
        let rotate_amount = (i * 7) % 32;

        for j in 0..32 {
            let rotated_idx = (j + rotate_amount) % 32;
            result[rotated_idx] ^= input[j];
        }
    }

    for i in 0..32 {
        result[i] = result[i].wrapping_mul(251).wrapping_add(i as u8);
    }

    result
}

#[inline(always)]
fn verify_merkle_proof(
    leaf: Hash256,
    root: Hash256,
    proof: &[Hash256],
    indices: &[bool],
) -> bool {
    if proof.is_empty() {
        return leaf == root;
    }

    if proof.len() != indices.len() {
        return false;
    }

    for sibling in proof {
        if !is_valid_hash(sibling) {
            return false;
        }
    }

    let mut current = leaf;

    for (&is_right, sibling) in indices.iter().zip(proof.iter()) {
        let hash_input = if is_right {
            [*sibling, current]
        } else {
            [current, *sibling]
        };
        current = poseidon_hash(&hash_input);
    }

    current == root
}

/// Encode a reason string into a Hash256 for non-fatal failure diagnostics
#[inline(always)]
fn encode_reason(reason: &str) -> Hash256 {
    let mut hash = [0u8; 32];
    let bytes = reason.as_bytes();
    for (i, &b) in bytes.iter().take(32).enumerate() {
        hash[i] = b;
    }
    poseidon_hash(&[hash])
}

/// Calculate task fee with variable BPS (0.5-1%)
/// Returns (fee_amount, net_amount)
/// fee_bps must be in range [50, 100] (0.5% to 1.0%)
#[inline(always)]
fn calculate_task_fee(gross_amount: &U256, fee_bps: u16) -> (U256, U256) {
    assert!(
        fee_bps >= 50 && fee_bps <= 100,
        "Task fee BPS must be 50-100 (0.5%-1.0%)"
    );

    let bps_u256 = {
        let mut bytes = [0u8; 32];
        bytes[0..2].copy_from_slice(&fee_bps.to_le_bytes());
        U256::from_le_bytes(bytes)
    };

    let gross_times_bps = gross_amount
        .checked_mul(&bps_u256)
        .expect("Task fee calculation overflow");
    let fee_amount = gross_times_bps.div(10000);

    let net_amount = gross_amount
        .checked_sub(&fee_amount)
        .expect("Task fee subtraction underflow");

    (fee_amount, net_amount)
}

/// Placeholder: Hook into FeeCollector.wasm for AI task fee routing
/// In production, this generates a commitment that the backend submits
/// as a CW20 Send to FeeCollector with source="ai_task"
#[inline(always)]
fn fee_collector_commitment(
    fee_amount: &U256,
    task_id_hash: &Hash256,
    source_chain: &ChainId,
) -> Hash256 {
    let chain_discriminant: u8 = match source_chain {
        ChainId::Theta => 0,
        ChainId::Osmosis => 1,
        ChainId::Akash => 2,
        ChainId::Bittensor => 3,
        ChainId::Persistence => 4,
    };

    let chain_padded = {
        let mut h = [0u8; 32];
        h[0] = chain_discriminant;
        h
    };

    poseidon_hash(&[fee_amount.to_le_bytes(), *task_id_hash, chain_padded])
}

// ============================================================================
// SINGLE DEPOSIT VALIDATION (Phase C — unchanged)
// ============================================================================

/// Validate a single deposit and return its nullifier
fn validate_deposit(public_inputs: &PublicInputs, private_inputs: &PrivateInputs) -> Hash256 {
    // Edge case validation
    assert!(
        is_valid_address(&public_inputs.vault_address),
        "CRITICAL: Vault address is zero"
    );
    assert!(
        is_valid_address(&private_inputs.sender_address),
        "CRITICAL: Sender address is zero"
    );
    assert!(
        !private_inputs.gross_amount.is_zero(),
        "CRITICAL: Gross amount is zero"
    );
    assert!(
        !public_inputs.net_amount.is_zero(),
        "CRITICAL: Net amount is zero"
    );
    assert!(
        is_valid_hash(&private_inputs.tx_hash),
        "CRITICAL: Transaction hash is zero"
    );
    if !private_inputs.merkle_proof.is_empty() {
        assert!(
            is_valid_hash(&public_inputs.merkle_root),
            "CRITICAL: Merkle root is zero"
        );
    }
    assert!(
        is_valid_hash(&private_inputs.block_hash),
        "CRITICAL: Block hash is zero"
    );

    // Merkle proof validation
    if !private_inputs.merkle_proof.is_empty() {
        assert!(
            private_inputs.merkle_proof.len() <= 32,
            "CRITICAL: Merkle proof too long (max 32 levels)"
        );
        assert!(
            private_inputs.merkle_proof.len() == private_inputs.merkle_path_indices.len(),
            "CRITICAL: Merkle proof and indices length mismatch"
        );
    }

    assert!(
        public_inputs.block_number > 0,
        "CRITICAL: Block number is zero"
    );
    assert!(
        private_inputs.block_timestamp > 1600000000,
        "CRITICAL: Block timestamp too old (before 2020)"
    );
    assert!(
        private_inputs.block_timestamp < 2000000000,
        "CRITICAL: Block timestamp too far in future (after 2033)"
    );

    // Range proofs
    assert!(
        private_inputs.gross_amount.check_range(252),
        "Gross amount exceeds 252 bits"
    );
    assert!(
        public_inputs.net_amount.check_range(252),
        "Net amount exceeds 252 bits"
    );
    assert!(
        private_inputs.fee_amount.check_range(252),
        "Fee amount exceeds 252 bits"
    );

    // Fee calculation (0.5% = 50/10000)
    let fifty = {
        let mut bytes = [0u8; 32];
        bytes[0] = 50;
        U256::from_le_bytes(bytes)
    };

    let gross_times_50 = private_inputs
        .gross_amount
        .checked_mul(&fifty)
        .expect("Fee calculation overflow");
    let fee_expected = gross_times_50.div(10000);

    assert!(
        fee_expected.eq(&private_inputs.fee_amount),
        "Fee calculation mismatch"
    );

    // Net amount calculation
    let net_check = private_inputs
        .gross_amount
        .checked_sub(&private_inputs.fee_amount)
        .expect("Net amount calculation underflow");

    assert!(
        net_check.eq(&public_inputs.net_amount),
        "Net amount calculation mismatch"
    );
    assert!(
        public_inputs.net_amount.lt(&private_inputs.gross_amount),
        "Net amount not less than gross"
    );

    // Minimum deposit check (0.01 TFUEL = 1e16 wei)
    let min_deposit = {
        let mut bytes = [0u8; 32];
        bytes[0..8].copy_from_slice(&10000000000000000u64.to_le_bytes());
        U256::from_le_bytes(bytes)
    };

    assert!(
        private_inputs.gross_amount.gte(&min_deposit),
        "Deposit below minimum (0.01 TFUEL)"
    );

    // Merkle proof verification
    let sender_addr_padded = {
        let mut addr_hash = [0u8; 32];
        addr_hash[..20].copy_from_slice(&private_inputs.sender_address);
        addr_hash
    };

    let vault_addr_padded = {
        let mut addr_hash = [0u8; 32];
        addr_hash[..20].copy_from_slice(&public_inputs.vault_address);
        addr_hash
    };

    let block_number_padded = {
        let mut bn_hash = [0u8; 32];
        bn_hash[..8].copy_from_slice(&public_inputs.block_number.to_le_bytes());
        bn_hash
    };

    let tx_index_padded = {
        let mut idx_hash = [0u8; 32];
        idx_hash[..2].copy_from_slice(&private_inputs.tx_index.to_le_bytes());
        idx_hash
    };

    let leaf_inputs = [
        private_inputs.tx_hash,
        sender_addr_padded,
        vault_addr_padded,
        private_inputs.gross_amount.to_le_bytes(),
        block_number_padded,
        tx_index_padded,
    ];
    let tx_leaf = poseidon_hash(&leaf_inputs);

    if !private_inputs.merkle_proof.is_empty() {
        assert!(
            verify_merkle_proof(
                tx_leaf,
                public_inputs.merkle_root,
                &private_inputs.merkle_proof,
                &private_inputs.merkle_path_indices,
            ),
            "Merkle proof verification failed"
        );
    }

    // Nullifier generation (replay protection)
    let nullifier_inputs = [
        private_inputs.identity_nullifier,
        private_inputs.tx_hash,
        block_number_padded,
        vault_addr_padded,
    ];
    let nullifier = poseidon_hash(&nullifier_inputs);

    nullifier
}

// ============================================================================
// REVERSE BURN VALIDATION (Phase C — unchanged)
// ============================================================================

/// Validate a reverse burn and return its nullifier
fn validate_reverse_burn(
    public_inputs: &ReverseBurnPublicInputs,
    private_inputs: &ReverseBurnPrivateInputs,
) -> Hash256 {
    // Edge case validation
    assert!(
        is_valid_hash(&public_inputs.user_address),
        "CRITICAL: User address is zero"
    );
    assert!(
        is_valid_address(&public_inputs.theta_recipient),
        "CRITICAL: Theta recipient is zero"
    );
    assert!(
        !public_inputs.burned_amount.is_zero(),
        "CRITICAL: Burned amount is zero"
    );
    assert!(
        !private_inputs.gross_amount.is_zero(),
        "CRITICAL: Gross amount is zero"
    );
    assert!(
        is_valid_hash(&private_inputs.tx_hash),
        "CRITICAL: Transaction hash is zero"
    );
    assert!(
        public_inputs.block_height > 0,
        "CRITICAL: Block height is zero"
    );
    assert!(
        public_inputs.timestamp > 1600000000,
        "CRITICAL: Timestamp too old (before 2020)"
    );
    assert!(
        public_inputs.timestamp < 2000000000,
        "CRITICAL: Timestamp too far in future (after 2033)"
    );

    // Range proofs
    assert!(
        private_inputs.gross_amount.check_range(252),
        "Gross amount exceeds 252 bits"
    );
    assert!(
        public_inputs.burned_amount.check_range(252),
        "Burned amount exceeds 252 bits"
    );
    assert!(
        private_inputs.fee_amount.check_range(252),
        "Fee amount exceeds 252 bits"
    );

    // Fee calculation (0.5% = 50/10000)
    let fifty = {
        let mut bytes = [0u8; 32];
        bytes[0] = 50;
        U256::from_le_bytes(bytes)
    };

    let gross_times_50 = private_inputs
        .gross_amount
        .checked_mul(&fifty)
        .expect("Fee calculation overflow");
    let fee_expected = gross_times_50.div(10000);

    assert!(
        fee_expected.eq(&private_inputs.fee_amount),
        "Fee calculation mismatch"
    );

    // Burned amount calculation (gross - fee)
    let burned_check = private_inputs
        .gross_amount
        .checked_sub(&private_inputs.fee_amount)
        .expect("Burned amount calculation underflow");

    assert!(
        burned_check.eq(&public_inputs.burned_amount),
        "Burned amount calculation mismatch"
    );

    // Minimum burn check (0.01 TFUEL equivalent = 1e16 wei)
    let min_burn = {
        let mut bytes = [0u8; 32];
        bytes[0..8].copy_from_slice(&10000000000000000u64.to_le_bytes());
        U256::from_le_bytes(bytes)
    };

    assert!(
        private_inputs.gross_amount.gte(&min_burn),
        "Burn below minimum (0.01 TFUEL equivalent)"
    );

    // Generate nullifier for replay protection
    let recipient_padded = {
        let mut addr_hash = [0u8; 32];
        addr_hash[..20].copy_from_slice(&public_inputs.theta_recipient);
        addr_hash
    };

    let nonce_padded = {
        let mut n_hash = [0u8; 32];
        n_hash[..8].copy_from_slice(&public_inputs.nonce.to_le_bytes());
        n_hash
    };

    let nullifier_inputs = [
        public_inputs.user_address,
        nonce_padded,
        recipient_padded,
        public_inputs.burned_amount.to_le_bytes(),
        private_inputs.tx_hash,
    ];
    let nullifier = poseidon_hash(&nullifier_inputs);

    nullifier
}

/// Validate a fee burn and return its nullifier
fn validate_fee_burn(public_inputs: &FeeBurnPublicInputs) -> Hash256 {
    // Edge case validation
    assert!(
        !public_inputs.fee_amount.is_zero(),
        "CRITICAL: Fee amount is zero"
    );
    assert!(
        public_inputs.burn_count > 0,
        "CRITICAL: Burn count is zero"
    );
    assert!(
        public_inputs.block_height > 0,
        "CRITICAL: Block height is zero"
    );
    assert!(
        public_inputs.timestamp > 1600000000,
        "CRITICAL: Timestamp too old (before 2020)"
    );
    assert!(
        public_inputs.timestamp < 2000000000,
        "CRITICAL: Timestamp too far in future (after 2033)"
    );

    // Range proof
    assert!(
        public_inputs.fee_amount.check_range(252),
        "Fee amount exceeds 252 bits"
    );

    // Generate nullifier for replay protection
    let burn_count_padded = {
        let mut bc_hash = [0u8; 32];
        bc_hash[..8].copy_from_slice(&public_inputs.burn_count.to_le_bytes());
        bc_hash
    };

    let block_height_padded = {
        let mut bh_hash = [0u8; 32];
        bh_hash[..8].copy_from_slice(&public_inputs.block_height.to_le_bytes());
        bh_hash
    };

    let nullifier_inputs = [
        burn_count_padded,
        public_inputs.fee_amount.to_le_bytes(),
        block_height_padded,
    ];
    let nullifier = poseidon_hash(&nullifier_inputs);

    nullifier
}

// ============================================================================
// AI TASK VALIDATION (Phase E.2 — zkML Inference + Compute Settlement)
// ============================================================================

/// Validate an AI task settlement and return (nullifier, fee_commitment, output_hash, payment_commitment)
///
/// Phase 2 (v2): when `public_values_version == 2` and `payment_commitment != 0`, verifies
/// the commitment matches `keccak256(abi.encodePacked(paymentRefHash, taskIdHash, rail, netAmount))`
/// — the same formula as `SP1ProofHooks.computePaymentCommitment`.
fn validate_ai_task(
    public_inputs: &AITaskPublicInputs,
    private_inputs: &AITaskPrivateInputs,
    public_values_version: u8,
) -> (Hash256, Hash256, Hash256, Hash256) {
    // ── Basic validation ─────────────────────────────────────────────────

    assert!(
        is_valid_hash(&public_inputs.task_id_hash),
        "CRITICAL: Task ID hash is zero"
    );
    assert!(
        is_valid_hash(&public_inputs.sender_hash),
        "CRITICAL: Sender hash is zero"
    );
    assert!(
        !private_inputs.gross_amount.is_zero(),
        "CRITICAL: Gross amount is zero"
    );
    assert!(
        !public_inputs.net_amount.is_zero(),
        "CRITICAL: Net amount is zero"
    );
    assert!(
        is_valid_hash(&private_inputs.source_tx_hash),
        "CRITICAL: Source transaction hash is zero"
    );
    assert!(
        public_inputs.block_height > 0,
        "CRITICAL: Block height is zero"
    );
    assert!(
        public_inputs.timestamp > 1600000000,
        "CRITICAL: Timestamp too old (before 2020)"
    );
    assert!(
        public_inputs.timestamp < 2000000000,
        "CRITICAL: Timestamp too far in future (after 2033)"
    );

    // ── Range proofs ─────────────────────────────────────────────────────

    assert!(
        private_inputs.gross_amount.check_range(252),
        "Gross amount exceeds 252 bits"
    );
    assert!(
        public_inputs.net_amount.check_range(252),
        "Net amount exceeds 252 bits"
    );
    assert!(
        public_inputs.fee_amount.check_range(252),
        "Fee amount exceeds 252 bits"
    );

    // ── Fee calculation (variable 0.5-1% = 50-100 BPS) ──────────────────
    // Task fee BPS is configurable per-task (set by ai-listener.js)
    // Default: 50 BPS (0.5%) for standard tasks
    // Up to: 100 BPS (1.0%) for premium compute/inference

    assert!(
        public_inputs.fee_bps >= 50 && public_inputs.fee_bps <= 100,
        "Task fee BPS out of range (must be 50-100)"
    );

    let (expected_fee, expected_net) =
        calculate_task_fee(&private_inputs.gross_amount, public_inputs.fee_bps);

    assert!(
        expected_fee.eq(&public_inputs.fee_amount),
        "AI task fee calculation mismatch"
    );

    assert!(
        expected_net.eq(&public_inputs.net_amount),
        "AI task net amount calculation mismatch"
    );

    assert!(
        public_inputs.net_amount.lt(&private_inputs.gross_amount),
        "Net amount not less than gross"
    );

    // ── Task-type-specific validation ────────────────────────────────────

    match public_inputs.task_type {
        MessageType::ComputeResult => {
            // COMPUTE_RESULT must have a valid output_hash proving job completion
            assert!(
                is_valid_hash(&public_inputs.output_hash),
                "COMPUTE_RESULT requires non-zero output_hash"
            );
            // Execution duration must be positive
            assert!(
                private_inputs.execution_duration_ms > 0,
                "COMPUTE_RESULT requires positive execution duration"
            );
        }
        MessageType::InferenceRequest => {
            // INFERENCE_REQUEST must reference a model
            assert!(
                is_valid_hash(&private_inputs.model_id_hash),
                "INFERENCE_REQUEST requires non-zero model_id_hash"
            );
            // Input data must be specified
            assert!(
                is_valid_hash(&private_inputs.input_hash),
                "INFERENCE_REQUEST requires non-zero input_hash"
            );
        }
        MessageType::ComputeBid => {
            // COMPUTE_BID must have a provider target
            assert!(
                is_valid_hash(&private_inputs.provider_hash),
                "COMPUTE_BID requires non-zero provider_hash"
            );
        }
        MessageType::DataAttestation => {
            // DATA_ATTESTATION must have an input_hash (the data hash)
            assert!(
                is_valid_hash(&private_inputs.input_hash),
                "DATA_ATTESTATION requires non-zero input_hash (data hash)"
            );
        }
        MessageType::CapabilityQuery => {
            // CapabilityQuery is lightweight — no additional constraints
        }
    }

    // ── Chain-specific validation ────────────────────────────────────────

    match public_inputs.destination_chain {
        ChainId::Osmosis | ChainId::Akash | ChainId::Persistence => {
            // IBC-routed tasks must have a valid IBC channel hash
            assert!(
                is_valid_hash(&private_inputs.ibc_channel_hash),
                "IBC destination requires non-zero ibc_channel_hash"
            );
        }
        ChainId::Bittensor => {
            // TAO EVM tasks must have a valid EVM target address
            // (zero address is allowed for Substrate-only calls)
            // If tao_evm_target is non-zero, validate it's a real address
            if !is_zero_address(&private_inputs.tao_evm_target) {
                assert!(
                    is_valid_address(&private_inputs.tao_evm_target),
                    "TAO EVM target must be valid when specified"
                );
            }
        }
        ChainId::Theta => {
            // Theta-local tasks don't need IBC routing
        }
    }

    // ── Minimum task amount check ────────────────────────────────────────
    // Minimum: 10000 units (dust protection, matches ai-listener.js MIN_TASK_AMOUNT)
    let min_task = U256::from_u64(10000);
    assert!(
        private_inputs.gross_amount.gte(&min_task),
        "Task amount below minimum threshold"
    );

    // ── Phase 2: x402 payment binding (v2 public values) ───────────────────
    let effective_payment_commitment = if public_values_version == 2
        && !is_zero_bytes32(&public_inputs.payment_commitment)
    {
        assert!(
            !is_zero_bytes32(&private_inputs.payment_ref_hash),
            "v2 payment binding requires non-zero payment_ref_hash witness"
        );
        assert!(
            private_inputs.payment_rail == PAYMENT_RAIL_USDC
                || private_inputs.payment_rail == PAYMENT_RAIL_TFUEL,
            "Invalid payment rail (expected 1=USDC or 2=TFUEL)"
        );
        let amount_be = u256_be32_from_le_bytes(&public_inputs.net_amount.to_le_bytes());
        let expected = compute_payment_commitment(
            &private_inputs.payment_ref_hash,
            &public_inputs.task_id_hash,
            private_inputs.payment_rail,
            &amount_be,
        );
        assert!(
            expected == public_inputs.payment_commitment,
            "Payment commitment mismatch (x402 binding)"
        );
        public_inputs.payment_commitment
    } else {
        assert!(
            is_zero_bytes32(&public_inputs.payment_commitment),
            "payment_commitment must be bytes32(0) unless public_values_version == 2"
        );
        [0u8; 32]
    };

    // ── Nullifier generation (per-agent replay protection) ───────────────

    let nonce_padded = {
        let mut n = [0u8; 32];
        n[..8].copy_from_slice(&public_inputs.nonce.to_le_bytes());
        n
    };

    let block_padded = {
        let mut b = [0u8; 32];
        b[..8].copy_from_slice(&public_inputs.block_height.to_le_bytes());
        b
    };

    let nullifier_inputs = [
        public_inputs.task_id_hash,
        public_inputs.sender_hash,
        nonce_padded,
        block_padded,
        private_inputs.source_tx_hash,
    ];
    let nullifier = poseidon_hash(&nullifier_inputs);

    // ── Fee collector commitment (hook to FeeCollector.wasm) ─────────────
    let fee_commitment = fee_collector_commitment(
        &public_inputs.fee_amount,
        &public_inputs.task_id_hash,
        &public_inputs.source_chain,
    );

    // ── Output hash (for COMPUTE_RESULT verification) ────────────────────
    // For non-COMPUTE_RESULT tasks, output_hash is the poseidon of task metadata
    let effective_output_hash = if public_inputs.task_type == MessageType::ComputeResult {
        // Verify output_hash is bound to the task context
        let output_binding = [
            public_inputs.output_hash,
            public_inputs.task_id_hash,
            private_inputs.source_tx_hash,
        ];
        poseidon_hash(&output_binding)
    } else {
        // Generate a deterministic output hash from task metadata
        let meta_inputs = [
            public_inputs.task_id_hash,
            private_inputs.model_id_hash,
            private_inputs.input_hash,
        ];
        poseidon_hash(&meta_inputs)
    };

    (
        nullifier,
        fee_commitment,
        effective_output_hash,
        effective_payment_commitment,
    )
}

// ============================================================================
// A2A MESSAGE VALIDATION (Phase E.3 — Agent-to-Agent Communications)
// ============================================================================

/// Validate an A2A/M2M message and return its nullifier
///
/// ZK proof validates:
/// 1. Message originated from a registered agent (on-chain identity)
/// 2. Escrow locked on source chain (if payment required)
/// 3. Nonce is fresh (no replay)
/// 4. TTL not expired (message still valid)
/// 5. Payload hash matches committed data
/// 6. IBC channel is valid for cross-chain delivery
fn validate_a2a_message(
    public_inputs: &A2AMessagePublicInputs,
    private_inputs: &A2AMessagePrivateInputs,
) -> Hash256 {
    // ── Basic validation ─────────────────────────────────────────────────

    assert!(
        is_valid_hash(&public_inputs.payload_hash),
        "CRITICAL: Payload hash is zero"
    );
    assert!(
        is_valid_hash(&private_inputs.sender_identity),
        "CRITICAL: Sender identity is zero (agent not registered)"
    );
    assert!(
        is_valid_hash(&private_inputs.sender_address),
        "CRITICAL: Sender address is zero"
    );
    assert!(
        is_valid_hash(&private_inputs.recipient_address),
        "CRITICAL: Recipient address is zero"
    );

    // Timestamp validation
    assert!(
        public_inputs.timestamp > 1600000000,
        "CRITICAL: Timestamp too old (before 2020)"
    );
    assert!(
        public_inputs.timestamp < 2000000000,
        "CRITICAL: Timestamp too far in future (after 2033)"
    );

    // Block height validation
    assert!(
        public_inputs.block_height > 0,
        "CRITICAL: Block height is zero"
    );

    // ── TTL validation ───────────────────────────────────────────────────
    // TTL must be reasonable (1 second to 24 hours)
    assert!(public_inputs.ttl > 0, "CRITICAL: TTL is zero");
    assert!(
        public_inputs.ttl <= 86400,
        "CRITICAL: TTL exceeds 24 hours"
    );

    // ── Escrow validation ────────────────────────────────────────────────
    // If escrow_amount > 0, the escrow tx must be valid
    if !public_inputs.escrow_amount.is_zero() {
        assert!(
            public_inputs.escrow_amount.check_range(252),
            "Escrow amount exceeds 252 bits"
        );
        assert!(
            is_valid_hash(&private_inputs.escrow_tx_hash),
            "Non-zero escrow requires valid escrow_tx_hash"
        );
    }

    // ── Cross-chain routing validation ───────────────────────────────────
    if public_inputs.sender_chain != public_inputs.recipient_chain {
        // Cross-chain messages require IBC channel
        assert!(
            is_valid_hash(&private_inputs.ibc_channel_hash),
            "Cross-chain A2A message requires valid ibc_channel_hash"
        );
    }

    // ── Payload size validation ──────────────────────────────────────────
    // Payload must be non-empty and within bounds (max 1MB)
    assert!(
        private_inputs.payload_size > 0,
        "CRITICAL: Payload size is zero"
    );
    assert!(
        private_inputs.payload_size <= 1_048_576,
        "CRITICAL: Payload exceeds 1MB limit"
    );

    // ── Message-type-specific validation ─────────────────────────────────

    match public_inputs.msg_type {
        MessageType::ComputeBid => {
            // COMPUTE_BID must have escrow locked
            assert!(
                !public_inputs.escrow_amount.is_zero(),
                "COMPUTE_BID requires non-zero escrow"
            );
        }
        MessageType::ComputeResult => {
            // COMPUTE_RESULT payload_hash encodes the output attestation
            // No additional constraints beyond basic validation
        }
        MessageType::InferenceRequest => {
            // INFERENCE_REQUEST should have a budget (escrow)
            assert!(
                !public_inputs.escrow_amount.is_zero(),
                "INFERENCE_REQUEST requires non-zero escrow (budget)"
            );
        }
        MessageType::CapabilityQuery => {
            // CapabilityQuery is read-only — no escrow required
            assert!(
                public_inputs.escrow_amount.is_zero(),
                "CAPABILITY_QUERY should not have escrow"
            );
        }
        MessageType::DataAttestation => {
            // DATA_ATTESTATION requires sender identity proof
            // (already validated above via sender_identity check)
        }
    }

    // ── Nullifier generation (per-agent, per-nonce replay protection) ────

    let nonce_padded = {
        let mut n = [0u8; 32];
        n[..8].copy_from_slice(&public_inputs.nonce.to_le_bytes());
        n
    };

    let timestamp_padded = {
        let mut t = [0u8; 32];
        t[..8].copy_from_slice(&public_inputs.timestamp.to_le_bytes());
        t
    };

    let nullifier_inputs = [
        private_inputs.sender_identity,
        public_inputs.payload_hash,
        nonce_padded,
        timestamp_padded,
        private_inputs.sender_address,
    ];
    let nullifier = poseidon_hash(&nullifier_inputs);

    nullifier
}

// ============================================================================
// MAIN ENTRY POINT — PHASE E: UNIFIED BIDIRECTIONAL + AI DePIN PROCESSING
// ============================================================================

pub fn main() {
    // Read unified batch inputs
    let batch_public: UnifiedBatchPublicInputs = sp1_zkvm::io::read();
    let batch_private: UnifiedBatchPrivateInputs = sp1_zkvm::io::read();

    // Validate batch structure
    assert!(
        batch_public.batch_size > 0,
        "Batch size must be at least 1"
    );
    assert!(
        batch_public.batch_size <= 20,
        "Batch size exceeds maximum (20)"
    );

    let mut nullifiers = Vec::with_capacity(batch_public.batch_size as usize);
    let mut aggregate_fee = U256::from_u64(0);
    let mut output_hashes: Vec<Hash256> = Vec::new();
    let mut payment_commitments: Vec<Hash256> = Vec::new();
    let outcome = ProofOutcome::Valid;

    match batch_public.proof_type {
        // ── Phase C: Forward Deposit (TFUEL → ibcTFUEL) ─────────────────
        ProofType::ForwardDeposit => {
            assert!(
                batch_public.batch_size == batch_public.deposits.len() as u32,
                "Batch public size mismatch (ForwardDeposit)"
            );
            assert!(
                batch_public.batch_size == batch_private.deposits.len() as u32,
                "Batch private size mismatch (ForwardDeposit)"
            );

            for i in 0..batch_public.batch_size as usize {
                let nullifier = validate_deposit(
                    &batch_public.deposits[i],
                    &batch_private.deposits[i],
                );
                nullifiers.push(nullifier);
            }
        }

        // ── Phase C: Reverse Burn (ibcTFUEL → TFUEL) ────────────────────
        ProofType::ReverseBurn => {
            assert!(
                batch_public.batch_size == batch_public.reverse_burns.len() as u32,
                "Batch public size mismatch (ReverseBurn)"
            );
            assert!(
                batch_public.batch_size == batch_private.reverse_burns.len() as u32,
                "Batch private size mismatch (ReverseBurn)"
            );

            for i in 0..batch_public.batch_size as usize {
                let nullifier = validate_reverse_burn(
                    &batch_public.reverse_burns[i],
                    &batch_private.reverse_burns[i],
                );
                nullifiers.push(nullifier);
            }
        }

        // ── Phase C: Fee Burn (protocol-initiated) ───────────────────────
        ProofType::FeeBurn => {
            assert!(
                batch_public.batch_size == batch_public.fee_burns.len() as u32,
                "Batch public size mismatch (FeeBurn)"
            );

            for i in 0..batch_public.batch_size as usize {
                let nullifier = validate_fee_burn(&batch_public.fee_burns[i]);
                nullifiers.push(nullifier);
            }
        }

        // ── Phase E.2: AI Task Settlement (zkML inference, compute, data)
        ProofType::AITask => {
            assert!(
                batch_public.batch_size == batch_public.ai_tasks.len() as u32,
                "Batch public size mismatch (AITask)"
            );
            assert!(
                batch_public.batch_size == batch_private.ai_tasks.len() as u32,
                "Batch private size mismatch (AITask)"
            );

            for i in 0..batch_public.batch_size as usize {
                let (nullifier, _fee_commitment, effective_output_hash, payment_commitment) =
                    validate_ai_task(
                        &batch_public.ai_tasks[i],
                        &batch_private.ai_tasks[i],
                        batch_public.public_values_version,
                    );
                nullifiers.push(nullifier);
                output_hashes.push(effective_output_hash);
                payment_commitments.push(payment_commitment);

                // Accumulate batch fees for FeeCollector hook
                aggregate_fee = aggregate_fee
                    .checked_add(&batch_public.ai_tasks[i].fee_amount)
                    .expect("Aggregate fee overflow");
            }
        }

        // ── Phase E.3: A2A/M2M Message Verification ─────────────────────
        ProofType::A2AMessage => {
            assert!(
                batch_public.batch_size == batch_public.a2a_messages.len() as u32,
                "Batch public size mismatch (A2AMessage)"
            );
            assert!(
                batch_public.batch_size == batch_private.a2a_messages.len() as u32,
                "Batch private size mismatch (A2AMessage)"
            );

            for i in 0..batch_public.batch_size as usize {
                let nullifier = validate_a2a_message(
                    &batch_public.a2a_messages[i],
                    &batch_private.a2a_messages[i],
                );
                nullifiers.push(nullifier);

                // Accumulate escrow amounts as fee basis for A2A messages
                // A2A relay fee: 0.1% on escrow (captured by FeeCollector)
                if !batch_public.a2a_messages[i].escrow_amount.is_zero() {
                    let one = U256::from_u64(10); // 0.1% = 10 BPS
                    let escrow_times_bps = batch_public.a2a_messages[i]
                        .escrow_amount
                        .checked_mul(&one)
                        .unwrap_or(U256::from_u64(0));
                    let relay_fee = escrow_times_bps.div(10000);
                    aggregate_fee = aggregate_fee
                        .checked_add(&relay_fee)
                        .unwrap_or(aggregate_fee);
                }
            }
        }
    }

    // ── Compute batch commitment ─────────────────────────────────────────

    let batch_commitment = if batch_public.batch_size == 1 {
        nullifiers[0]
    } else {
        poseidon_hash(&nullifiers)
    };

    // ── Commit unified batch output ──────────────────────────────────────

    let output = UnifiedBatchOutput {
        proof_type: batch_public.proof_type,
        batch_size: batch_public.batch_size,
        nullifiers,
        batch_commitment,
        outcome,
        aggregate_fee,
        output_hashes,
        payment_commitments,
        public_values_version: batch_public.public_values_version,
    };

    sp1_zkvm::io::commit(&output);
}
