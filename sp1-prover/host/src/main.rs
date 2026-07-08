use anyhow::Result;
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use sp1_sdk::{ProveRequest, Prover, ProverClient, ProvingKey, SP1Stdin, include_elf};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;
use base64::Engine;
use xfuel_sp1_hooks::{
    encode_ai_task_public_values_v2, u256_be32_from_u128, PublicValuesVersion,
    PAYMENT_RAIL_USDC,
};

// Guest program ELF, embedded at compile time via build.rs + sp1_build::build_program
const ELF: sp1_sdk::Elf = include_elf!("deposit-proof-program");

// ============================================================================
// TYPES - Must match program/src/main.rs
// ============================================================================

type Address = [u8; 20];
type Hash256 = [u8; 32];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct U256([u8; 32]);

impl U256 {
    fn from_hex(s: &str) -> Result<Self> {
        let s = s.strip_prefix("0x").unwrap_or(s);
        let bytes = hex::decode(s)?;
        let mut arr = [0u8; 32];

        // Hex strings are big-endian, U256 internal is little-endian
        for (i, &b) in bytes.iter().rev().enumerate() {
            if i < 32 {
                arr[i] = b;
            }
        }

        Ok(U256(arr))
    }

    #[allow(dead_code)]
    fn to_hex(&self) -> String {
        let hex_bytes: Vec<u8> = self.0.iter().rev().copied().collect();
        format!("0x{}", hex::encode(hex_bytes))
    }

    fn from_u128(value: u128) -> Self {
        let mut arr = [0u8; 32];
        arr[..16].copy_from_slice(&value.to_le_bytes());
        U256(arr)
    }

    fn as_u128(&self) -> u128 {
        u128::from_le_bytes(self.0[..16].try_into().unwrap())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicInputs {
    pub vault_address: Address,
    pub net_amount: U256,
    pub block_number: u64,
    pub merkle_root: Hash256,
    pub identity_commitment: Hash256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateInputs {
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

// ============================================================================
// API TYPES - HTTP/JSON interface (supports single + batch)
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct ProofRequest {
    pub vault_address: String,
    pub net_amount: String,
    pub block_number: u64,
    pub merkle_root: String,
    pub identity_commitment: String,

    #[serde(default = "default_zero_address")]
    pub sender_address: String,
    #[serde(default)]
    pub gross_amount: String,
    #[serde(default)]
    pub fee_amount: String,
    #[serde(default)]
    pub block_hash: String,
    #[serde(default)]
    pub block_timestamp: u64,
    #[serde(default)]
    pub tx_hash: String,
    #[serde(default)]
    pub tx_index: u16,
    #[serde(default)]
    pub merkle_proof: Vec<String>,
    #[serde(default)]
    pub merkle_path_indices: Vec<u8>,
    #[serde(default)]
    pub identity_secret: String,
    #[serde(default)]
    pub identity_nullifier: String,
    #[serde(default)]
    pub identity_trapdoor: String,

    // ── AI task extensions (Phase E / backend ai-listener.js) ─────────────
    #[serde(default)]
    pub ai_task: bool,
    #[serde(default)]
    pub task_type: Option<String>,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub source_chain: Option<String>,
    #[serde(default)]
    pub source_tx: Option<String>,
    #[serde(default)]
    pub output_hash: Option<String>,
    #[serde(default)]
    pub completed_at: Option<u64>,
    #[serde(default)]
    pub fee_bps: Option<u16>,

    // ── Phase 2: x402 payment binding (optional) ──────────────────────────
    #[serde(default)]
    pub payment_commitment: Option<String>,
    #[serde(default)]
    pub payment_ref_hash: Option<String>,
    #[serde(default)]
    pub payment_rail: Option<u8>,
    #[serde(default)]
    pub payment_amount: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchProofRequest {
    #[serde(default)]
    pub batch: bool,
    pub deposits: Vec<ProofRequest>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UnifiedProofRequest {
    Batch(BatchProofRequest),
    Single(ProofRequest),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProofResponse {
    pub proof: String,
    pub public_inputs: PublicInputsJson,
    pub nullifier: String,
    pub proving_time_ms: u64,
    /// Phase 2: 1 = v1 layout, 2 = v2 (+ paymentCommitment). Omitted for deposit proofs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_values_version: Option<u8>,
    /// Phase 2: ABI-encoded v2 public values (hex) for on-chain verifyProof.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_public_values_abi: Option<String>,
    /// Phase 2: payment commitment echoed from guest output.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payment_commitment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BatchProofResponse {
    pub proof: String,
    pub batch_size: u32,
    pub nullifiers: Vec<String>,
    pub batch_commitment: String,
    pub proving_time_ms: u64,
    pub effective_time_per_deposit_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UnifiedProofResponse {
    Batch(BatchProofResponse),
    Single(ProofResponse),
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PublicInputsJson {
    pub vault_address: String,
    pub net_amount: String,
    pub block_number: u64,
    pub merkle_root: String,
    pub identity_commitment: String,
}

/// Wire format for the binary /prove/binary endpoint.
/// Serialized with bincode v1 (little-endian, length-prefixed Vecs).
#[derive(Debug, Serialize, Deserialize)]
pub struct BinaryProofResponse {
    pub proof_bytes: Vec<u8>,
    pub public_values: Vec<u8>,
    pub is_batch: bool,
    pub batch_size: u32,
    pub proving_time_ms: u64,
    pub nullifiers: Vec<Vec<u8>>,
    pub batch_commitment: Vec<u8>,
}

// ============================================================================
// METRICS
// ============================================================================

struct ProverMetrics {
    proofs_total: AtomicU64,
    binary_proofs: AtomicU64,
    json_proofs: AtomicU64,
    errors_total: AtomicU64,
    total_prove_time_ms: AtomicU64,
    last_prove_time_ms: AtomicU64,
    min_prove_time_ms: AtomicU64,
    max_prove_time_ms: AtomicU64,
    total_deposits: AtomicU64,
    last_batch_size: AtomicU64,
    queue_depth: AtomicU64,
    start_time: std::time::Instant,
    skip_verify: bool,
}

impl ProverMetrics {
    fn new() -> Self {
        let skip = std::env::var("SP1_SKIP_VERIFY")
            .map(|v| v == "1" || v == "true")
            .unwrap_or(false);
        Self {
            proofs_total: AtomicU64::new(0),
            binary_proofs: AtomicU64::new(0),
            json_proofs: AtomicU64::new(0),
            errors_total: AtomicU64::new(0),
            total_prove_time_ms: AtomicU64::new(0),
            last_prove_time_ms: AtomicU64::new(0),
            min_prove_time_ms: AtomicU64::new(u64::MAX),
            max_prove_time_ms: AtomicU64::new(0),
            total_deposits: AtomicU64::new(0),
            last_batch_size: AtomicU64::new(0),
            queue_depth: AtomicU64::new(0),
            start_time: std::time::Instant::now(),
            skip_verify: skip,
        }
    }

    fn record_proof(&self, proving_time_ms: u64, is_binary: bool, deposit_count: u64) {
        self.proofs_total.fetch_add(1, Ordering::Relaxed);
        self.total_prove_time_ms.fetch_add(proving_time_ms, Ordering::Relaxed);
        self.last_prove_time_ms.store(proving_time_ms, Ordering::Relaxed);
        self.min_prove_time_ms.fetch_min(proving_time_ms, Ordering::Relaxed);
        self.max_prove_time_ms.fetch_max(proving_time_ms, Ordering::Relaxed);
        self.total_deposits.fetch_add(deposit_count, Ordering::Relaxed);
        self.last_batch_size.store(deposit_count, Ordering::Relaxed);
        if is_binary {
            self.binary_proofs.fetch_add(1, Ordering::Relaxed);
        } else {
            self.json_proofs.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn record_error(&self) {
        self.errors_total.fetch_add(1, Ordering::Relaxed);
    }

    fn to_json(&self) -> serde_json::Value {
        let total = self.proofs_total.load(Ordering::Relaxed);
        let total_time = self.total_prove_time_ms.load(Ordering::Relaxed);
        let avg = if total > 0 { total_time / total } else { 0 };
        let min_raw = self.min_prove_time_ms.load(Ordering::Relaxed);
        let min = if min_raw == u64::MAX { 0 } else { min_raw };

        let total_deps = self.total_deposits.load(Ordering::Relaxed);
        let last_batch = self.last_batch_size.load(Ordering::Relaxed);
        let last_ms = self.last_prove_time_ms.load(Ordering::Relaxed);
        let effective_ms = if last_batch > 0 { last_ms / last_batch } else { last_ms };

        serde_json::json!({
            "proofs_served_total": total,
            "binary_proofs": self.binary_proofs.load(Ordering::Relaxed),
            "json_proofs": self.json_proofs.load(Ordering::Relaxed),
            "errors_total": self.errors_total.load(Ordering::Relaxed),
            "avg_prove_time_ms": avg,
            "min_prove_time_ms": min,
            "max_prove_time_ms": self.max_prove_time_ms.load(Ordering::Relaxed),
            "last_prove_time_ms": last_ms,
            "total_deposits": total_deps,
            "last_batch_size": last_batch,
            "effective_ms_per_deposit": effective_ms,
            "current_queue_depth": self.queue_depth.load(Ordering::Relaxed),
            "uptime_seconds": self.start_time.elapsed().as_secs(),
            "skip_verify": self.skip_verify,
        })
    }
}

async fn query_gpu_stats() -> serde_json::Value {
    let output = tokio::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let parts: Vec<&str> = stdout.trim().split(", ").collect();
            if parts.len() >= 5 {
                serde_json::json!({
                    "utilization_pct": parts[0].trim().parse::<u32>().unwrap_or(0),
                    "memory_used_mb": parts[1].trim().parse::<u32>().unwrap_or(0),
                    "memory_total_mb": parts[2].trim().parse::<u32>().unwrap_or(0),
                    "temperature_c": parts[3].trim().parse::<u32>().unwrap_or(0),
                    "power_watts": parts[4].trim().parse::<f32>().unwrap_or(0.0),
                })
            } else {
                serde_json::json!(null)
            }
        }
        _ => serde_json::json!(null),
    }
}

// ============================================================================
// BATCH TYPES - Must match program/src/main.rs UnifiedBatch* structs exactly
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchPublicInputs {
    pub public_values_version: u8,
    pub proof_type: ProofType,
    pub batch_size: u32,
    pub deposits: Vec<PublicInputs>,
    pub reverse_burns: Vec<ReverseBurnPublicInputs>,
    pub fee_burns: Vec<FeeBurnPublicInputs>,
    pub ai_tasks: Vec<AITaskPublicInputs>,
    pub a2a_messages: Vec<A2AMessagePublicInputs>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchPrivateInputs {
    pub deposits: Vec<PrivateInputs>,
    pub reverse_burns: Vec<ReverseBurnPrivateInputs>,
    pub ai_tasks: Vec<AITaskPrivateInputs>,
    pub a2a_messages: Vec<A2AMessagePrivateInputs>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProofType {
    ForwardDeposit,
    ReverseBurn,
    FeeBurn,
    AITask,
    A2AMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChainId {
    Theta,
    Osmosis,
    Akash,
    Bittensor,
    Persistence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageType {
    ComputeBid,
    ComputeResult,
    InferenceRequest,
    CapabilityQuery,
    DataAttestation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReverseBurnPublicInputs {
    pub user_address: Hash256,
    pub theta_recipient: Address,
    pub burned_amount: U256,
    pub nonce: u64,
    pub block_height: u64,
    pub timestamp: u64,
    pub chain_id: Hash256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct FeeBurnPublicInputs {
    pub fee_amount: U256,
    pub burn_count: u64,
    pub block_height: u64,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ReverseBurnPrivateInputs {
    pub tx_hash: Hash256,
    pub event_index: u16,
    pub fee_amount: U256,
    pub gross_amount: U256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AITaskPublicInputs {
    pub task_type: MessageType,
    pub source_chain: ChainId,
    pub destination_chain: ChainId,
    pub task_id_hash: Hash256,
    pub sender_hash: Hash256,
    pub net_amount: U256,
    pub fee_amount: U256,
    pub fee_bps: u16,
    pub output_hash: Hash256,
    pub block_height: u64,
    pub timestamp: u64,
    pub nonce: u64,
    pub payment_commitment: Hash256,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AITaskPrivateInputs {
    pub gross_amount: U256,
    pub source_tx_hash: Hash256,
    pub model_id_hash: Hash256,
    pub input_hash: Hash256,
    pub provider_hash: Hash256,
    pub execution_duration_ms: u64,
    pub ibc_channel_hash: Hash256,
    pub tao_evm_target: Address,
    pub payment_ref_hash: Hash256,
    pub payment_rail: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct A2AMessagePublicInputs {
    pub msg_type: MessageType,
    pub sender_chain: ChainId,
    pub recipient_chain: ChainId,
    pub payload_hash: Hash256,
    pub nonce: u64,
    pub escrow_amount: U256,
    pub timestamp: u64,
    pub ttl: u64,
    pub block_height: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct A2AMessagePrivateInputs {
    pub sender_identity: Hash256,
    pub sender_address: Hash256,
    pub recipient_address: Hash256,
    pub escrow_tx_hash: Hash256,
    pub ibc_channel_hash: Hash256,
    pub payload_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BatchOutput {
    pub proof_type: ProofType,
    pub batch_size: u32,
    pub nullifiers: Vec<Hash256>,
    pub batch_commitment: Hash256,
    pub outcome: ProofOutcome,
    pub aggregate_fee: U256,
    pub output_hashes: Vec<Hash256>,
    pub payment_commitments: Vec<Hash256>,
    pub public_values_version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProofOutcome {
    Valid,
    Regenerable { reason_hash: Hash256 },
    Invalid { reason_hash: Hash256 },
}

// ============================================================================
// PARSING
// ============================================================================

fn default_zero_address() -> String {
    "0x0000000000000000000000000000000000000000".into()
}

fn parse_hash_or_zero(s: Option<&String>) -> Hash256 {
    match s {
        Some(v) if !v.is_empty() && v != "null" => parse_hash(v).unwrap_or([0u8; 32]),
        _ => [0u8; 32],
    }
}

fn parse_chain_id(s: &str) -> ChainId {
    match s.to_lowercase().as_str() {
        "theta" => ChainId::Theta,
        "osmosis" => ChainId::Osmosis,
        "akash" => ChainId::Akash,
        "bittensor" | "tao" => ChainId::Bittensor,
        "persistence" => ChainId::Persistence,
        _ => ChainId::Theta,
    }
}

fn parse_message_type(s: &str) -> MessageType {
    match s.to_lowercase().as_str() {
        "compute_bid" => MessageType::ComputeBid,
        "compute_result" => MessageType::ComputeResult,
        "inference_request" => MessageType::InferenceRequest,
        "capability_query" => MessageType::CapabilityQuery,
        "data_attestation" => MessageType::DataAttestation,
        _ => MessageType::InferenceRequest,
    }
}

/// True when the host should use v2 public values (payment binding in-circuit).
/// Requires `SP1_PUBLIC_VALUES_V2=true` AND a non-zero payment_commitment on the request.
fn resolve_public_values_version(req: &ProofRequest) -> u8 {
    let v2_flag = std::env::var("SP1_PUBLIC_VALUES_V2")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if !v2_flag {
        return PublicValuesVersion::V1 as u8;
    }
    match &req.payment_commitment {
        Some(c) if !c.is_empty() && c != "0x0" && c != "0x0000000000000000000000000000000000000000000000000000000000000000" => {
            PublicValuesVersion::V2 as u8
        }
        _ => PublicValuesVersion::V1 as u8,
    }
}

fn parse_ai_task_batch(
    req: &ProofRequest,
) -> Result<(BatchPublicInputs, BatchPrivateInputs)> {
    let public_values_version = resolve_public_values_version(req);
    let task_id_hash = parse_hash(&req.merkle_root)?; // backend sets keccak256(taskId)
    let sender_hash = parse_hash(&req.identity_commitment)?;
    let net_amount = U256::from_hex(&req.net_amount)?;
    let fee_amount = if req.fee_amount.is_empty() {
        U256::from_u128(0)
    } else {
        U256::from_hex(&req.fee_amount)?
    };
    let fee_bps = req.fee_bps.unwrap_or(50);

    let output_hash = parse_hash_or_zero(req.output_hash.as_ref());
    let payment_commitment = if public_values_version == PublicValuesVersion::V2 as u8 {
        parse_hash(req.payment_commitment.as_ref().ok_or_else(|| {
            anyhow::anyhow!("v2 requires payment_commitment on the request")
        })?)?
    } else {
        [0u8; 32]
    };

    let payment_ref_hash = parse_hash_or_zero(req.payment_ref_hash.as_ref());
    let payment_rail = req.payment_rail.unwrap_or(PAYMENT_RAIL_USDC);

    let task_type = parse_message_type(
        req.task_type.as_deref().unwrap_or("inference_request"),
    );
    let source_chain = parse_chain_id(req.source_chain.as_deref().unwrap_or("theta"));
    let destination_chain = ChainId::Theta;

    // M2M off-chain tasks may send block_number 0; guest requires block_height > 0.
    let block_height = req.block_number.max(1);
    let timestamp = req.completed_at.unwrap_or(req.block_timestamp).max(1);
    let nonce = 1u64;

    let gross_amount = if req.gross_amount.is_empty() || req.gross_amount == "0" {
        // Derive gross from net + fee when omitted (backend AI path)
        let net = net_amount.as_u128();
        let fee = fee_amount.as_u128();
        U256::from_u128(net + fee)
    } else {
        U256::from_hex(&req.gross_amount)?
    };

    let source_tx_hash = parse_hash_or_zero(req.source_tx.as_ref());

    let ai_public = AITaskPublicInputs {
        task_type,
        source_chain,
        destination_chain,
        task_id_hash,
        sender_hash,
        net_amount,
        fee_amount,
        fee_bps,
        output_hash,
        block_height,
        timestamp,
        nonce,
        payment_commitment,
    };

    let ai_private = AITaskPrivateInputs {
        gross_amount,
        source_tx_hash,
        model_id_hash: [0u8; 32],
        input_hash: [0u8; 32],
        provider_hash: [0u8; 32],
        execution_duration_ms: 1,
        ibc_channel_hash: [0u8; 32],
        tao_evm_target: [0u8; 20],
        payment_ref_hash,
        payment_rail,
    };

    Ok((
        BatchPublicInputs {
            public_values_version,
            proof_type: ProofType::AITask,
            batch_size: 1,
            deposits: vec![],
            reverse_burns: vec![],
            fee_burns: vec![],
            ai_tasks: vec![ai_public],
            a2a_messages: vec![],
        },
        BatchPrivateInputs {
            deposits: vec![],
            reverse_burns: vec![],
            ai_tasks: vec![ai_private],
            a2a_messages: vec![],
        },
    ))
}

fn parse_proof_request(request: &ProofRequest) -> Result<(PublicInputs, PrivateInputs)> {
    let public_inputs = PublicInputs {
        vault_address: parse_address(&request.vault_address)?,
        net_amount: U256::from_hex(&request.net_amount)?,
        block_number: request.block_number,
        merkle_root: parse_hash(&request.merkle_root)?,
        identity_commitment: parse_hash(&request.identity_commitment)?,
    };

    let private_inputs = PrivateInputs {
        sender_address: parse_address(&request.sender_address)?,
        gross_amount: U256::from_hex(&request.gross_amount)?,
        fee_amount: U256::from_hex(&request.fee_amount)?,
        block_hash: parse_hash(&request.block_hash)?,
        block_timestamp: request.block_timestamp,
        tx_hash: parse_hash(&request.tx_hash)?,
        tx_index: request.tx_index,
        merkle_proof: request
            .merkle_proof
            .iter()
            .map(|s| parse_hash(s))
            .collect::<Result<Vec<_>>>()?,
        merkle_path_indices: request
            .merkle_path_indices
            .iter()
            .map(|&x| x != 0)
            .collect(),
        identity_secret: parse_hash(&request.identity_secret)?,
        identity_nullifier: parse_hash(&request.identity_nullifier)?,
        identity_trapdoor: parse_hash(&request.identity_trapdoor)?,
    };

    Ok((public_inputs, private_inputs))
}

fn parse_address(s: &str) -> Result<Address> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s)?;
    if bytes.len() != 20 {
        anyhow::bail!("Invalid address length");
    }
    let mut arr = [0u8; 20];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn parse_hash(s: &str) -> Result<Hash256> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s)?;
    if bytes.len() != 32 {
        anyhow::bail!("Invalid hash length");
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn parse_request_to_batch(
    request: UnifiedProofRequest,
) -> Result<(BatchPublicInputs, BatchPrivateInputs, bool, Vec<ProofRequest>)> {
    match request {
        UnifiedProofRequest::Single(single_req) => {
            if single_req.ai_task {
                let (pub_batch, priv_batch) = parse_ai_task_batch(&single_req)?;
                return Ok((pub_batch, priv_batch, false, vec![single_req]));
            }
            let (pub_in, priv_in) = parse_proof_request(&single_req)?;
            Ok((
                BatchPublicInputs {
                    public_values_version: 1,
                    proof_type: ProofType::ForwardDeposit,
                    batch_size: 1,
                    deposits: vec![pub_in],
                    reverse_burns: vec![],
                    fee_burns: vec![],
                    ai_tasks: vec![],
                    a2a_messages: vec![],
                },
                BatchPrivateInputs {
                    deposits: vec![priv_in],
                    reverse_burns: vec![],
                    ai_tasks: vec![],
                    a2a_messages: vec![],
                },
                false,
                vec![single_req],
            ))
        }
        UnifiedProofRequest::Batch(batch_req) => {
            let batch_size = batch_req.deposits.len();
            if batch_size == 0 {
                anyhow::bail!("Batch must contain at least 1 deposit");
            }
            if batch_size > 20 {
                anyhow::bail!("Batch size exceeds maximum (20)");
            }
            let mut public_inputs = Vec::with_capacity(batch_size);
            let mut private_inputs = Vec::with_capacity(batch_size);
            for req in &batch_req.deposits {
                let (pub_in, priv_in) = parse_proof_request(req)?;
                public_inputs.push(pub_in);
                private_inputs.push(priv_in);
            }
            Ok((
                BatchPublicInputs {
                    public_values_version: 1,
                    proof_type: ProofType::ForwardDeposit,
                    batch_size: batch_size as u32,
                    deposits: public_inputs,
                    reverse_burns: vec![],
                    fee_burns: vec![],
                    ai_tasks: vec![],
                    a2a_messages: vec![],
                },
                BatchPrivateInputs {
                    deposits: private_inputs,
                    reverse_burns: vec![],
                    ai_tasks: vec![],
                    a2a_messages: vec![],
                },
                true,
                batch_req.deposits,
            ))
        }
    }
}

fn chain_discriminant(c: &ChainId) -> u8 {
    match c {
        ChainId::Theta => 0,
        ChainId::Osmosis => 1,
        ChainId::Akash => 2,
        ChainId::Bittensor => 3,
        ChainId::Persistence => 4,
    }
}

fn message_type_discriminant(m: &MessageType) -> u8 {
    match m {
        MessageType::ComputeBid => 1,
        MessageType::ComputeResult => 2,
        MessageType::InferenceRequest => 3,
        MessageType::CapabilityQuery => 4,
        MessageType::DataAttestation => 5,
    }
}

fn build_response(
    mut proof: sp1_sdk::SP1ProofWithPublicValues,
    is_batch: bool,
    original_requests: &[ProofRequest],
    proving_time_ms: u64,
) -> Result<UnifiedProofResponse> {
    let batch_output: BatchOutput = proof.public_values.read();
    let proof_bytes = bincode::serialize(&proof)?;
    let proof_b64 = base64::engine::general_purpose::STANDARD.encode(&proof_bytes);

    if is_batch {
        let nullifiers: Vec<String> = batch_output
            .nullifiers
            .iter()
            .map(|n| format!("0x{}", hex::encode(n)))
            .collect();
        let effective_time_per_deposit_ms = proving_time_ms / batch_output.batch_size as u64;
        eprintln!(
            "Batch done: {}ms total, {}ms/deposit",
            proving_time_ms, effective_time_per_deposit_ms
        );
        Ok(UnifiedProofResponse::Batch(BatchProofResponse {
            proof: proof_b64,
            batch_size: batch_output.batch_size,
            nullifiers,
            batch_commitment: format!("0x{}", hex::encode(batch_output.batch_commitment)),
            proving_time_ms,
            effective_time_per_deposit_ms,
        }))
    } else {
        let nullifier = format!("0x{}", hex::encode(batch_output.nullifiers[0]));
        eprintln!("Single proof done: {}ms", proving_time_ms);

        let req = &original_requests[0];
        let (pv_version, ai_abi, pay_commitment) = if req.ai_task {
            let pv = Some(batch_output.public_values_version);
            let pc = batch_output
                .payment_commitments
                .first()
                .map(|h| format!("0x{}", hex::encode(h)));
            let abi = if batch_output.public_values_version == PublicValuesVersion::V2 as u8 {
                Some(build_ai_public_values_abi_v2(req, &batch_output)?)
            } else {
                None
            };
            (pv, abi, pc)
        } else {
            (None, None, None)
        };

        Ok(UnifiedProofResponse::Single(ProofResponse {
            proof: proof_b64,
            public_inputs: PublicInputsJson {
                vault_address: original_requests[0].vault_address.clone(),
                net_amount: original_requests[0].net_amount.clone(),
                block_number: original_requests[0].block_number,
                merkle_root: original_requests[0].merkle_root.clone(),
                identity_commitment: original_requests[0].identity_commitment.clone(),
            },
            nullifier,
            proving_time_ms,
            public_values_version: pv_version,
            ai_public_values_abi: ai_abi,
            payment_commitment: pay_commitment,
        }))
    }
}

/// ABI-encode v2 AI-task public values for on-chain `verifyProof` (13 words).
fn build_ai_public_values_abi_v2(req: &ProofRequest, output: &BatchOutput) -> Result<String> {
    let task_type = parse_message_type(
        req.task_type.as_deref().unwrap_or("inference_request"),
    );
    let source_chain = parse_chain_id(req.source_chain.as_deref().unwrap_or("theta"));
    let task_id_hash = parse_hash(&req.merkle_root)?;
    let sender_hash = parse_hash(&req.identity_commitment)?;
    let net_amount = U256::from_hex(&req.net_amount)?;
    let fee_amount = if req.fee_amount.is_empty() {
        U256::from_u128(0)
    } else {
        U256::from_hex(&req.fee_amount)?
    };
    let fee_bps = req.fee_bps.unwrap_or(50);
    let output_hash = parse_hash_or_zero(req.output_hash.as_ref());
    let block_height = req.block_number.max(1);
    let timestamp = req.completed_at.unwrap_or(req.block_timestamp).max(1);
    let nonce = 1u64;
    let payment_commitment = output
        .payment_commitments
        .first()
        .copied()
        .unwrap_or([0u8; 32]);

    let net_be = u256_be32_from_u128(net_amount.as_u128());
    let fee_be = u256_be32_from_u128(fee_amount.as_u128());

    let encoded = encode_ai_task_public_values_v2(
        message_type_discriminant(&task_type),
        chain_discriminant(&source_chain),
        chain_discriminant(&ChainId::Theta),
        &task_id_hash,
        &sender_hash,
        &net_be,
        &fee_be,
        fee_bps,
        &output_hash,
        block_height,
        timestamp,
        nonce,
        &payment_commitment,
    );
    Ok(format!("0x{}", hex::encode(encoded)))
}

fn build_binary_response(
    mut proof: sp1_sdk::SP1ProofWithPublicValues,
    is_batch: bool,
    proving_time_ms: u64,
) -> Result<Vec<u8>> {
    let batch_output: BatchOutput = proof.public_values.read();
    let proof_bytes = bincode::serialize(&proof)?;
    let public_values = bincode::serialize(&batch_output)?;

    let nullifiers: Vec<Vec<u8>> = batch_output
        .nullifiers
        .iter()
        .map(|n| n.to_vec())
        .collect();

    let response = BinaryProofResponse {
        proof_bytes,
        public_values,
        is_batch,
        batch_size: batch_output.batch_size,
        proving_time_ms,
        nullifiers,
        batch_commitment: batch_output.batch_commitment.to_vec(),
    };

    bincode::serialize(&response).map_err(|e| anyhow::anyhow!("bincode serialize error: {}", e))
}

// ============================================================================
// CLI
// ============================================================================

#[derive(Parser)]
#[command(name = "sp1-deposit-prover")]
#[command(about = "SP1 ZK Prover for XFUEL deposit proofs", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate a proof from JSON input file
    Prove {
        #[arg(short, long)]
        input: PathBuf,
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Start HTTP server for proof generation
    Serve {
        #[arg(short, long, default_value = "8080")]
        port: u16,
    },
    /// Build the guest program
    Build {
        #[arg(short, long)]
        release: bool,
    },
}

// ============================================================================
// MAIN
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    // Bridge SP1_PRIVATE_KEY -> NETWORK_PRIVATE_KEY for Succinct Network compatibility
    if let Ok(key) = std::env::var("SP1_PRIVATE_KEY") {
        if !key.is_empty() && std::env::var("NETWORK_PRIVATE_KEY").is_err() {
            unsafe { std::env::set_var("NETWORK_PRIVATE_KEY", &key) };
        }
    }

    let cli = Cli::parse();

    match cli.command {
        Commands::Prove { input, output } => {
            eprintln!("Reading input from: {}", input.display());
            let input_json = std::fs::read_to_string(&input)?;
            let request: ProofRequest = serde_json::from_str(&input_json)?;

            eprintln!(
                "SP1_PROVER={}",
                std::env::var("SP1_PROVER").unwrap_or_else(|_| "local".into())
            );
            let client = ProverClient::from_env().await;
            eprintln!("Generating proving keys...");
            let pk = client.setup(ELF).await?;
            eprintln!("Proving keys ready!");

            let start = std::time::Instant::now();
            let (pub_in, priv_in) = parse_proof_request(&request)?;
            let mut stdin = SP1Stdin::new();
            stdin.write(&BatchPublicInputs {
                public_values_version: 1,
                proof_type: ProofType::ForwardDeposit,
                batch_size: 1,
                deposits: vec![pub_in],
                reverse_burns: vec![],
                fee_burns: vec![],
                ai_tasks: vec![],
                a2a_messages: vec![],
            });
            stdin.write(&BatchPrivateInputs {
                deposits: vec![priv_in],
                reverse_burns: vec![],
                ai_tasks: vec![],
                a2a_messages: vec![],
            });

            let proof = client.prove(&pk, stdin).compressed().await?;
            client.verify(&proof, pk.verifying_key(), None)?;

            let proving_time_ms = start.elapsed().as_millis() as u64;
            let response = build_response(proof, false, &[request], proving_time_ms)?;

            if let UnifiedProofResponse::Single(ref resp) = response {
                println!("Proving time: {}ms", resp.proving_time_ms);
                println!("Nullifier: {}", resp.nullifier);
            }

            if let Some(output_path) = output {
                let output_json = serde_json::to_string_pretty(&response)?;
                std::fs::write(&output_path, output_json)?;
                println!("Proof written to: {}", output_path.display());
            } else {
                println!("{}", serde_json::to_string_pretty(&response)?);
            }
        }

        Commands::Serve { port } => {
            eprintln!("Initializing SP1 prover...");
            eprintln!(
                "SP1_PROVER={}",
                std::env::var("SP1_PROVER").unwrap_or_else(|_| "local".into())
            );

            // Create client (respects SP1_PROVER env: cuda / network / local)
            let client = ProverClient::from_env().await;

            // Generate proving key once at startup (expensive, reused for all requests)
            eprintln!("Generating proving keys (this takes a few minutes on first run)...");
            let pk = client.setup(ELF).await?;
            eprintln!("Proving keys ready!");

            let metrics = Arc::new(ProverMetrics::new());

            // CUDA prover is single-threaded and panics on concurrent access.
            // Arc<Mutex<>> serializes all proving requests.
            let client = Arc::new(Mutex::new(client));
            let pk = Arc::new(pk);

            eprintln!("Starting HTTP server on port {}", port);

            use axum::{
                extract::Json,
                http::StatusCode,
                response::IntoResponse,
                routing::{get, post},
                Router,
            };
            use tower_http::cors::CorsLayer;

            let app = Router::new()
                .route("/health", get(|| async { "OK" }))
                .route(
                    "/healthz",
                    get({
                        let metrics = metrics.clone();
                        move || {
                            let metrics = metrics.clone();
                            async move {
                                let m = metrics.to_json();
                                let queue = m["current_queue_depth"].as_u64().unwrap_or(0);
                                let errors = m["errors_total"].as_u64().unwrap_or(0);
                                let proofs = m["proofs_served_total"].as_u64().unwrap_or(0);
                                let uptime = m["uptime_seconds"].as_u64().unwrap_or(0);

                                let status = if queue > 50 { "degraded" } else { "healthy" };
                                let code = if status == "healthy" {
                                    StatusCode::OK
                                } else {
                                    StatusCode::SERVICE_UNAVAILABLE
                                };

                                (
                                    code,
                                    axum::Json(serde_json::json!({
                                        "status": status,
                                        "uptime_seconds": uptime,
                                        "proofs_served": proofs,
                                        "errors": errors,
                                        "queue_depth": queue,
                                    })),
                                )
                            }
                        }
                    }),
                )
                .route(
                    "/metrics",
                    get({
                        let metrics = metrics.clone();
                        move || {
                            let metrics = metrics.clone();
                            async move {
                                let mut resp = metrics.to_json();
                                let gpu = query_gpu_stats().await;
                                resp.as_object_mut().unwrap().insert("gpu".into(), gpu);
                                axum::Json(resp)
                            }
                        }
                    }),
                )
                .route(
                    "/prove",
                    post({
                        let client = client.clone();
                        let pk = pk.clone();
                        let metrics = metrics.clone();
                        move |Json(request): Json<UnifiedProofRequest>| {
                            let client = client.clone();
                            let pk = pk.clone();
                            let metrics = metrics.clone();
                            async move {
                                metrics.queue_depth.fetch_add(1, Ordering::Relaxed);
                                let is_batch =
                                    matches!(request, UnifiedProofRequest::Batch(_));
                                eprintln!(
                                    "Received {} proof request",
                                    if is_batch { "BATCH" } else { "SINGLE" }
                                );

                                let (batch_public, batch_private, is_batch, original_requests) =
                                    match parse_request_to_batch(request) {
                                        Ok(v) => v,
                                        Err(e) => {
                                            return (
                                                StatusCode::BAD_REQUEST,
                                                format!("Parse error: {:#}", e),
                                            )
                                                .into_response()
                                        }
                                    };

                                let mut stdin = SP1Stdin::new();
                                stdin.write(&batch_public);
                                stdin.write(&batch_private);

                                let start = std::time::Instant::now();

                                // Acquire mutex (CUDA requires sequential access)
                                let client_guard = client.lock().await;

                                let proof_result =
                                    client_guard.prove(&*pk, stdin).compressed().await;

                                match proof_result {
                                    Ok(proof) => {
                                        if !metrics.skip_verify {
                                            if let Err(e) = client_guard.verify(
                                                &proof,
                                                pk.verifying_key(),
                                                None,
                                            ) {
                                                eprintln!("WARNING: Local verification failed (proof still returned): {:?}", e);
                                            }
                                        }
                                        drop(client_guard);

                                        let proving_time_ms =
                                            start.elapsed().as_millis() as u64;

                                        match build_response(
                                            proof,
                                            is_batch,
                                            &original_requests,
                                            proving_time_ms,
                                        ) {
                                            Ok(resp) => {
                                                metrics.record_proof(proving_time_ms, false, batch_public.batch_size as u64);
                                                metrics.queue_depth.fetch_sub(1, Ordering::Relaxed);
                                                (StatusCode::OK, Json(resp)).into_response()
                                            }
                                            Err(e) => (
                                                StatusCode::INTERNAL_SERVER_ERROR,
                                                format!("Response build error: {:#}", e),
                                            )
                                                .into_response(),
                                        }
                                    }
                                    Err(e) => {
                                        drop(client_guard);
                                        eprintln!("Error generating proof: {:?}", e);
                                        metrics.record_error();
                                        metrics.queue_depth.fetch_sub(1, Ordering::Relaxed);
                                        (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            format!("Error: {:#}", e),
                                        )
                                            .into_response()
                                    }
                                }
                            }
                        }
                    }),
                )
                .route(
                    "/prove/binary",
                    post({
                        let client = client.clone();
                        let pk = pk.clone();
                        let metrics = metrics.clone();
                        move |Json(request): Json<UnifiedProofRequest>| {
                            let client = client.clone();
                            let pk = pk.clone();
                            let metrics = metrics.clone();
                            async move {
                                metrics.queue_depth.fetch_add(1, Ordering::Relaxed);
                                let is_batch =
                                    matches!(request, UnifiedProofRequest::Batch(_));
                                eprintln!(
                                    "Received {} proof request (binary endpoint)",
                                    if is_batch { "BATCH" } else { "SINGLE" }
                                );

                                let (batch_public, batch_private, is_batch, _original_requests) =
                                    match parse_request_to_batch(request) {
                                        Ok(v) => v,
                                        Err(e) => {
                                            return (
                                                StatusCode::BAD_REQUEST,
                                                format!("Parse error: {:#}", e),
                                            )
                                                .into_response()
                                        }
                                    };

                                let mut stdin = SP1Stdin::new();
                                stdin.write(&batch_public);
                                stdin.write(&batch_private);

                                let start = std::time::Instant::now();
                                let client_guard = client.lock().await;

                                let proof_result =
                                    client_guard.prove(&*pk, stdin).compressed().await;

                                match proof_result {
                                    Ok(proof) => {
                                        if !metrics.skip_verify {
                                            if let Err(e) = client_guard.verify(
                                                &proof,
                                                pk.verifying_key(),
                                                None,
                                            ) {
                                                eprintln!("WARNING: Local verification failed (proof still returned): {:?}", e);
                                            }
                                        }
                                        drop(client_guard);

                                        let proving_time_ms =
                                            start.elapsed().as_millis() as u64;

                                        match build_binary_response(
                                            proof,
                                            is_batch,
                                            proving_time_ms,
                                        ) {
                                            Ok(bytes) => {
                                                metrics.record_proof(proving_time_ms, true, batch_public.batch_size as u64);
                                                metrics.queue_depth.fetch_sub(1, Ordering::Relaxed);
                                                eprintln!(
                                                    "Binary proof sent: {} bytes in {}ms",
                                                    bytes.len(),
                                                    proving_time_ms
                                                );
                                                (
                                                    StatusCode::OK,
                                                    [(
                                                        axum::http::header::CONTENT_TYPE,
                                                        "application/octet-stream",
                                                    )],
                                                    bytes,
                                                )
                                                    .into_response()
                                            }
                                            Err(e) => (
                                                StatusCode::INTERNAL_SERVER_ERROR,
                                                format!(
                                                    "Binary response build error: {:#}",
                                                    e
                                                ),
                                            )
                                                .into_response(),
                                        }
                                    }
                                    Err(e) => {
                                        drop(client_guard);
                                        eprintln!("Error generating proof: {:?}", e);
                                        metrics.record_error();
                                        metrics.queue_depth.fetch_sub(1, Ordering::Relaxed);
                                        (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            format!("Error: {:#}", e),
                                        )
                                            .into_response()
                                    }
                                }
                            }
                        }
                    }),
                )
                .route(
                    "/benchmark",
                    post({
                        let client = client.clone();
                        let pk = pk.clone();
                        let metrics = metrics.clone();
                        move |Json(payload): Json<serde_json::Value>| {
                            let client = client.clone();
                            let pk = pk.clone();
                            let metrics = metrics.clone();
                            async move {
                                let count = payload.get("count")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(5)
                                    .min(20) as usize;
                                let skip_verify = payload.get("skip_verify")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(metrics.skip_verify);

                                let test_data = match std::fs::read_to_string("/app/test-data/deposit-1tfuel.json") {
                                    Ok(s) => s,
                                    Err(_) => {
                                        return (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            "Test data not found at /app/test-data/deposit-1tfuel.json",
                                        ).into_response()
                                    }
                                };
                                let request: UnifiedProofRequest = match serde_json::from_str(&test_data) {
                                    Ok(r) => r,
                                    Err(e) => {
                                        return (
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            format!("Failed to parse test data: {}", e),
                                        ).into_response()
                                    }
                                };
                                let (batch_public, batch_private, is_batch, _) =
                                    match parse_request_to_batch(request) {
                                        Ok(v) => v,
                                        Err(e) => {
                                            return (
                                                StatusCode::INTERNAL_SERVER_ERROR,
                                                format!("Parse error: {:#}", e),
                                            ).into_response()
                                        }
                                    };

                                eprintln!("Benchmark: running {} proofs (skip_verify={})", count, skip_verify);
                                let mut times: Vec<u64> = Vec::with_capacity(count);
                                let mut errors = 0u64;
                                let wall_start = std::time::Instant::now();

                                for i in 0..count {
                                    let mut stdin = SP1Stdin::new();
                                    stdin.write(&batch_public);
                                    stdin.write(&batch_private);

                                    let start = std::time::Instant::now();
                                    let client_guard = client.lock().await;
                                    let result = client_guard.prove(&*pk, stdin).compressed().await;
                                    match result {
                                        Ok(proof) => {
                                            if !skip_verify {
                                                let _ = client_guard.verify(&proof, pk.verifying_key(), None);
                                            }
                                            drop(client_guard);
                                            let ms = start.elapsed().as_millis() as u64;
                                            times.push(ms);
                                            metrics.record_proof(ms, true, 1);
                                            eprintln!("  benchmark #{}: {}ms", i + 1, ms);
                                        }
                                        Err(e) => {
                                            drop(client_guard);
                                            errors += 1;
                                            metrics.record_error();
                                            eprintln!("  benchmark #{} FAILED: {:?}", i + 1, e);
                                        }
                                    }
                                }

                                let wall_ms = wall_start.elapsed().as_millis() as u64;
                                times.sort();
                                let sum: u64 = times.iter().sum();
                                let avg = if !times.is_empty() { sum / times.len() as u64 } else { 0 };
                                let min = times.first().copied().unwrap_or(0);
                                let max = times.last().copied().unwrap_or(0);
                                let p50 = if !times.is_empty() { times[times.len() / 2] } else { 0 };
                                let p95_idx = ((times.len() as f64) * 0.95).ceil() as usize;
                                let p95 = if !times.is_empty() { times[p95_idx.min(times.len() - 1)] } else { 0 };

                                (
                                    StatusCode::OK,
                                    axum::Json(serde_json::json!({
                                        "count": count,
                                        "succeeded": times.len(),
                                        "errors": errors,
                                        "skip_verify": skip_verify,
                                        "wall_time_ms": wall_ms,
                                        "gpu_times_ms": times,
                                        "stats": {
                                            "min_ms": min,
                                            "max_ms": max,
                                            "avg_ms": avg,
                                            "p50_ms": p50,
                                            "p95_ms": p95,
                                        },
                                        "throughput_proofs_per_sec": if wall_ms > 0 {
                                            (times.len() as f64 / (wall_ms as f64 / 1000.0) * 100.0).round() / 100.0
                                        } else { 0.0 },
                                        "sub_1s": min < 1000,
                                    })),
                                ).into_response()
                            }
                        }
                    }),
                )
                .layer(CorsLayer::permissive());

            let addr = format!("0.0.0.0:{}", port);
            eprintln!("Server listening on {}", addr);

            loop {
                let listener = tokio::net::TcpListener::bind(&addr).await?;
                let server = axum::serve(listener, app.clone());

                match server.await {
                    Ok(_) => {
                        eprintln!("Server exited cleanly, restarting in 1s...");
                    }
                    Err(e) => {
                        eprintln!("Server error: {:?}, restarting in 2s...", e);
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    }
                }
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                eprintln!("Restarting HTTP server...");
            }
        }

        Commands::Build { release } => {
            println!("Building guest program...");
            let mut cmd = std::process::Command::new("cargo");
            cmd.arg("prove")
                .arg("build")
                .current_dir("../program");
            if release {
                cmd.arg("--release");
            }
            let status = cmd.status()?;
            if !status.success() {
                anyhow::bail!("Build failed");
            }
            println!("Build complete!");
        }
    }

    Ok(())
}
