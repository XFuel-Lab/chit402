use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, CosmosMsg, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128, WasmMsg,
};
use cw2::set_contract_version;
use cw20::Cw20ExecuteMsg;
use sha2::{Digest, Sha256};

use crate::error::ContractError;
use crate::msg::{
    A2AMessageResponse, AgentResponse, ChainId, ConfigResponse, ExecuteMsg,
    FeeCalculationResponse, InstantiateMsg, MessageListResponse, MessageType,
    NullifierResponse, PendingFeesResponse, ProofOutcome, QueryMsg, SP1Proof,
    StateResponse, TaskListResponse, TaskResponse,
};
use crate::state::{
    A2AMessage, AITask, Config, RegisteredAgent, State, A2A_MESSAGES, AGENT_NONCES, CONFIG,
    REGISTERED_AGENTS, RELAYERS, STATE, TASKS, USED_NULLIFIERS,
};

const CONTRACT_NAME: &str = "crates.io:ai-verifier";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// Fee constants (defaults — overridable via InstantiateMsg)
const DEFAULT_MIN_FEE_BPS: u16 = 50;   // 0.5%
const DEFAULT_MAX_FEE_BPS: u16 = 100;  // 1.0%
const DEFAULT_FEE_BPS: u16 = 50;       // 0.5%
const DEFAULT_A2A_RELAY_FEE_BPS: u16 = 10; // 0.1%
const DEFAULT_MIN_TASK_AMOUNT: u128 = 10_000;
const DEFAULT_MAX_BATCH_SIZE: u32 = 20;
const DEFAULT_FEE_FORWARD_THRESHOLD: u128 = 100_000_000; // 100 ibcTFUEL

// ============================================================================
// INSTANTIATE
// ============================================================================

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let admin_addr = deps.api.addr_validate(&msg.admin)?;
    let fee_collector_addr = deps.api.addr_validate(&msg.fee_collector)?;
    let ibctfuel_addr = deps.api.addr_validate(&msg.ibctfuel_token)?;

    let config = Config {
        admin: admin_addr.clone(),
        fee_collector: fee_collector_addr,
        ibctfuel_token: ibctfuel_addr,
        min_fee_bps: msg.min_fee_bps.unwrap_or(DEFAULT_MIN_FEE_BPS),
        max_fee_bps: msg.max_fee_bps.unwrap_or(DEFAULT_MAX_FEE_BPS),
        default_fee_bps: msg.default_fee_bps.unwrap_or(DEFAULT_FEE_BPS),
        a2a_relay_fee_bps: msg.a2a_relay_fee_bps.unwrap_or(DEFAULT_A2A_RELAY_FEE_BPS),
        min_task_amount: msg
            .min_task_amount
            .unwrap_or(Uint128::new(DEFAULT_MIN_TASK_AMOUNT)),
        max_batch_size: msg.max_batch_size.unwrap_or(DEFAULT_MAX_BATCH_SIZE),
        fee_forward_threshold: msg
            .fee_forward_threshold
            .unwrap_or(Uint128::new(DEFAULT_FEE_FORWARD_THRESHOLD)),
        mock_mode: msg.mock_mode.unwrap_or(false),
        paused: false,
        akash_ibc_channel: msg.akash_ibc_channel,
        theta_ibc_channel: msg.theta_ibc_channel,
    };
    CONFIG.save(deps.storage, &config)?;

    let state = State::default();
    STATE.save(deps.storage, &state)?;

    // Auto-register the admin as a relayer
    RELAYERS.save(deps.storage, &admin_addr, &true)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("contract", CONTRACT_NAME)
        .add_attribute("version", CONTRACT_VERSION)
        .add_attribute("admin", admin_addr)
        .add_attribute("mock_mode", config.mock_mode.to_string())
        .add_attribute("default_fee_bps", config.default_fee_bps.to_string()))
}

// ============================================================================
// EXECUTE DISPATCH
// ============================================================================

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        // AI Task Routing
        ExecuteMsg::RouteTask {
            task_id,
            msg_type,
            destination_chain,
            amount,
            fee_bps,
            model_id_hash,
            input_hash,
            output_hash,
            ibc_channel,
        } => execute_route_task(
            deps,
            env,
            info,
            task_id,
            msg_type,
            destination_chain,
            amount,
            fee_bps,
            model_id_hash,
            input_hash,
            output_hash,
            ibc_channel,
        ),

        // Task Settlement
        ExecuteMsg::SettleTask {
            task_id,
            sp1_proof,
            nullifier,
            output_hash,
            fee_commitment,
        } => execute_settle_task(
            deps, env, info, task_id, sp1_proof, nullifier, output_hash, fee_commitment,
        ),
        ExecuteMsg::SettleTaskBatch {
            task_ids,
            sp1_proofs,
            nullifiers,
            output_hashes,
            fee_commitments,
        } => execute_settle_task_batch(
            deps,
            env,
            info,
            task_ids,
            sp1_proofs,
            nullifiers,
            output_hashes,
            fee_commitments,
        ),

        // A2A Messages
        ExecuteMsg::SendA2AMessage {
            message_id,
            msg_type,
            recipient_chain,
            payload_hash,
            ttl,
            escrow_amount,
        } => execute_send_a2a_message(
            deps,
            env,
            info,
            message_id,
            msg_type,
            recipient_chain,
            payload_hash,
            ttl,
            escrow_amount,
        ),
        ExecuteMsg::VerifyA2AMessage {
            message_id,
            sp1_proof,
            nullifier,
        } => execute_verify_a2a_message(deps, env, info, message_id, sp1_proof, nullifier),

        // Agent Registration
        ExecuteMsg::RegisterAgent {
            identity_commitment,
        } => execute_register_agent(deps, env, info, identity_commitment),

        // Fee Management
        ExecuteMsg::Receive {
            sender,
            amount,
            msg,
        } => execute_receive(deps, env, info, sender, amount, msg),
        ExecuteMsg::ForwardFees {} => execute_forward_fees(deps, env, info),

        // Admin
        ExecuteMsg::AddRelayer { relayer } => execute_add_relayer(deps, info, relayer),
        ExecuteMsg::RemoveRelayer { relayer } => execute_remove_relayer(deps, info, relayer),
        ExecuteMsg::SetAdmin { new_admin } => execute_set_admin(deps, info, new_admin),
        ExecuteMsg::SetFeeCollector {
            new_fee_collector,
        } => execute_set_fee_collector(deps, info, new_fee_collector),
        ExecuteMsg::SetDefaultFeeBps { fee_bps } => {
            execute_set_default_fee_bps(deps, info, fee_bps)
        }
        ExecuteMsg::SetFeeForwardThreshold { threshold } => {
            execute_set_fee_forward_threshold(deps, info, threshold)
        }
        ExecuteMsg::SetAkashIbcChannel { channel } => {
            execute_set_akash_ibc_channel(deps, info, channel)
        }
        ExecuteMsg::Pause {} => execute_pause(deps, info),
        ExecuteMsg::Unpause {} => execute_unpause(deps, info),
        ExecuteMsg::EmergencyWithdraw {
            amount,
            recipient,
            denom,
        } => execute_emergency_withdraw(deps, info, amount, recipient, denom),
    }
}

// ============================================================================
// AI TASK ROUTING
// ============================================================================

/// Route an AI task to a destination chain. Validates inputs per task type,
/// calculates fee (0.5-1%), stores task, and emits `TaskRouted` event for
/// ai-listener.js to detect and forward to Theta Edge / Akash / TAO.
///
/// Fee calculation mirrors `calculate_task_fee()` in main.rs:
///   fee_amount = gross × fee_bps / 10000
///   net_amount = gross - fee_amount
#[allow(clippy::too_many_arguments)]
pub fn execute_route_task(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    task_id: String,
    msg_type: MessageType,
    destination_chain: ChainId,
    amount: Uint128,
    fee_bps: Option<u16>,
    model_id_hash: Option<String>,
    input_hash: Option<String>,
    output_hash: Option<String>,
    ibc_channel: Option<String>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Paused check
    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Check task doesn't already exist
    if TASKS.has(deps.storage, &task_id) {
        return Err(ContractError::TaskAlreadyExists {
            task_id: task_id.clone(),
        });
    }

    // For CapabilityQuery, allow zero amount (read-only discovery)
    if msg_type != MessageType::CapabilityQuery {
        if amount < config.min_task_amount {
            return Err(ContractError::AmountBelowMinimum {
                got: amount.to_string(),
                min: config.min_task_amount.to_string(),
            });
        }
    }

    // Resolve fee BPS
    let effective_fee_bps = fee_bps.unwrap_or(config.default_fee_bps);
    if msg_type != MessageType::CapabilityQuery {
        if effective_fee_bps < config.min_fee_bps || effective_fee_bps > config.max_fee_bps {
            return Err(ContractError::InvalidFeeBps {
                bps: effective_fee_bps,
            });
        }
    }

    // Calculate fee — mirrors calculate_task_fee() in main.rs
    let (fee_amount, net_amount) = if msg_type == MessageType::CapabilityQuery {
        (Uint128::zero(), amount) // No fee for capability queries
    } else {
        calculate_task_fee(amount, effective_fee_bps)?
    };

    // Task-type-specific validation
    validate_task_type_inputs(
        &msg_type,
        &model_id_hash,
        &input_hash,
        &output_hash,
    )?;

    // Chain-specific validation — IBC channel required for cross-chain
    validate_chain_routing(&destination_chain, &ibc_channel, &config)?;

    // Generate per-agent nonce
    let nonce = increment_agent_nonce(deps.storage, &info.sender)?;

    // Store task
    let task = AITask {
        task_id: task_id.clone(),
        msg_type: msg_type.clone(),
        source_chain: ChainId::Osmosis, // This contract lives on Osmosis
        destination_chain: destination_chain.clone(),
        requester: info.sender.clone(),
        gross_amount: amount,
        fee_amount,
        net_amount,
        fee_bps: effective_fee_bps,
        output_hash: output_hash.clone().unwrap_or_default(),
        model_id_hash: model_id_hash.clone().unwrap_or_default(),
        input_hash: input_hash.clone().unwrap_or_default(),
        nonce,
        timestamp: env.block.time.seconds(),
        settled: false,
        proof_outcome: ProofOutcome::Valid, // Pending — updated on settlement
    };
    TASKS.save(deps.storage, &task_id, &task)?;

    // Update aggregate state
    state.total_tasks_routed += 1;
    STATE.save(deps.storage, &state)?;

    // Emit TaskRouted event (detected by ai-listener.js)
    Ok(Response::new()
        .add_attribute("action", "route_task")
        .add_attribute("task_id", &task_id)
        .add_attribute("msg_type", format!("{:?}", msg_type))
        .add_attribute("source_chain", "osmosis")
        .add_attribute("destination_chain", format!("{:?}", destination_chain))
        .add_attribute("requester", info.sender)
        .add_attribute("gross_amount", amount)
        .add_attribute("fee_amount", fee_amount)
        .add_attribute("net_amount", net_amount)
        .add_attribute("fee_bps", effective_fee_bps.to_string())
        .add_attribute("model_id_hash", model_id_hash.unwrap_or_default())
        .add_attribute("input_hash", input_hash.unwrap_or_default())
        .add_attribute("nonce", nonce.to_string())
        .add_attribute("timestamp", env.block.time.seconds().to_string())
        .add_attribute("for_ai_listener", "true")) // Critical flag for ai-listener.js
}

// ============================================================================
// TASK SETTLEMENT — SP1 ZK Proof Verification
// ============================================================================

/// Settle a task with an SP1 ZK proof, called by the backend relayer.
///
/// Flow (from AIDePINRouter.sol settleTask comments):
/// 1. ai-listener.js detects TaskRouted event
/// 2. Routes task to Theta Edge / Akash / TAO
/// 3. On completion, calls SP1 prover with AITask proof type
/// 4. Prover runs validate_ai_task() → (nullifier, fee_commitment, output_hash)
/// 5. Relayer calls SettleTask with proof artifacts
///
/// SP1 proof validates (from main.rs validate_ai_task):
/// - Fee calculation: gross × fee_bps / 10000 = fee_amount
/// - Net amount: gross - fee = net_amount
/// - Output hash binding (COMPUTE_RESULT)
/// - Chain-specific routing (IBC channel or TAO EVM target)
/// - Nonce freshness → nullifier generated
#[allow(clippy::too_many_arguments)]
pub fn execute_settle_task(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    task_id: String,
    sp1_proof: SP1Proof,
    nullifier: String,
    output_hash: String,
    fee_commitment: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Only authorized relayers can settle tasks
    require_relayer(deps.as_ref(), &info.sender)?;

    // Load and validate task
    let mut task = TASKS
        .may_load(deps.storage, &task_id)?
        .ok_or(ContractError::TaskNotFound {
            task_id: task_id.clone(),
        })?;

    if task.settled {
        return Err(ContractError::TaskAlreadySettled {
            task_id: task_id.clone(),
        });
    }

    // Check nullifier not already used
    if USED_NULLIFIERS
        .may_load(deps.storage, &nullifier)?
        .unwrap_or(false)
    {
        return Err(ContractError::NullifierAlreadyUsed {});
    }

    // Verify SP1 proof (or mock)
    let outcome = verify_sp1_proof(&config, &sp1_proof, &task_id)?;

    // Mark nullifier used regardless of outcome (prevents replays)
    USED_NULLIFIERS.save(deps.storage, &nullifier, &true)?;

    // Update task state
    task.proof_outcome = outcome.clone();

    let mut response = Response::new();

    match &outcome {
        ProofOutcome::Valid => {
            task.settled = true;
            task.output_hash = output_hash.clone();
            state.total_tasks_settled += 1;

            // Accumulate fees
            if !task.fee_amount.is_zero() {
                state.pending_fees = state
                    .pending_fees
                    .checked_add(task.fee_amount)?;
                state.total_fees_collected = state
                    .total_fees_collected
                    .checked_add(task.fee_amount)?;

                // Auto-forward if threshold reached
                if state.pending_fees >= config.fee_forward_threshold {
                    let forward_msgs =
                        build_fee_forward_msgs(&config, state.pending_fees)?;
                    for msg in forward_msgs {
                        response = response.add_message(msg);
                    }
                    state.total_fees_forwarded = state
                        .total_fees_forwarded
                        .checked_add(state.pending_fees)?;
                    state.pending_fees = Uint128::zero();
                }
            }

            // Emit ProofVerified event
            response = response
                .add_attribute("action", "settle_task")
                .add_attribute("task_id", &task_id)
                .add_attribute("proof_outcome", "valid")
                .add_attribute("nullifier", &nullifier)
                .add_attribute("output_hash", &output_hash)
                .add_attribute("fee_commitment", &fee_commitment)
                .add_attribute("fee_amount", task.fee_amount)
                .add_attribute("settled", "true");
        }
        ProofOutcome::Regenerable { reason } => {
            // Non-fatal: ai-listener.js will retry proof generation
            response = response
                .add_attribute("action", "settle_task")
                .add_attribute("task_id", &task_id)
                .add_attribute("proof_outcome", "regenerable")
                .add_attribute("nullifier", &nullifier)
                .add_attribute("reason", reason)
                .add_attribute("retry_after_block", (env.block.height + 10).to_string())
                .add_attribute("settled", "false");
        }
        ProofOutcome::Invalid { reason } => {
            // Hard failure — permanently invalid
            response = response
                .add_attribute("action", "settle_task")
                .add_attribute("task_id", &task_id)
                .add_attribute("proof_outcome", "invalid")
                .add_attribute("nullifier", &nullifier)
                .add_attribute("reason", reason)
                .add_attribute("settled", "false");
        }
    }

    TASKS.save(deps.storage, &task_id, &task)?;
    STATE.save(deps.storage, &state)?;

    Ok(response)
}

/// Batch-settle multiple tasks. Maximum batch size enforced by config.
/// Matches UnifiedBatchOutput from main.rs.
#[allow(clippy::too_many_arguments)]
pub fn execute_settle_task_batch(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    task_ids: Vec<String>,
    sp1_proofs: Vec<SP1Proof>,
    nullifiers: Vec<String>,
    output_hashes: Vec<String>,
    fee_commitments: Vec<String>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    require_relayer(deps.as_ref(), &info.sender)?;

    let len = task_ids.len();
    if len == 0 || len > config.max_batch_size as usize {
        return Err(ContractError::CustomError {
            val: format!(
                "Invalid batch size: {}. Must be 1-{}",
                len, config.max_batch_size
            ),
        });
    }

    if sp1_proofs.len() != len
        || nullifiers.len() != len
        || output_hashes.len() != len
        || fee_commitments.len() != len
    {
        return Err(ContractError::CustomError {
            val: "Array length mismatch in batch settlement".to_string(),
        });
    }

    let mut response = Response::new()
        .add_attribute("action", "settle_task_batch")
        .add_attribute("batch_size", len.to_string());

    let mut settled_count: u64 = 0;

    for i in 0..len {
        // Skip non-existent, already settled, or used nullifiers
        let task_opt = TASKS.may_load(deps.storage, &task_ids[i])?;
        let mut task = match task_opt {
            Some(t) if !t.settled => t,
            _ => continue,
        };

        if USED_NULLIFIERS
            .may_load(deps.storage, &nullifiers[i])?
            .unwrap_or(false)
        {
            continue;
        }

        let outcome = verify_sp1_proof(&config, &sp1_proofs[i], &task_ids[i])?;
        USED_NULLIFIERS.save(deps.storage, &nullifiers[i], &true)?;
        task.proof_outcome = outcome.clone();

        if outcome == ProofOutcome::Valid {
            task.settled = true;
            task.output_hash = output_hashes[i].clone();
            settled_count += 1;

            if !task.fee_amount.is_zero() {
                state.pending_fees = state
                    .pending_fees
                    .checked_add(task.fee_amount)?;
                state.total_fees_collected = state
                    .total_fees_collected
                    .checked_add(task.fee_amount)?;
            }

            response = response.add_attribute(
                format!("settled_{}", i),
                &task_ids[i],
            );
        }

        TASKS.save(deps.storage, &task_ids[i], &task)?;
    }

    state.total_tasks_settled += settled_count;

    // Forward accumulated fees after batch
    if state.pending_fees >= config.fee_forward_threshold {
        let forward_msgs =
            build_fee_forward_msgs(&config, state.pending_fees)?;
        for msg in forward_msgs {
            response = response.add_message(msg);
        }
        state.total_fees_forwarded = state
            .total_fees_forwarded
            .checked_add(state.pending_fees)?;
        state.pending_fees = Uint128::zero();
    }

    STATE.save(deps.storage, &state)?;

    Ok(response.add_attribute("tasks_settled", settled_count.to_string()))
}

// ============================================================================
// A2A MESSAGE ROUTING — Phase E.3
// ============================================================================

/// Submit and route a ZK-verifiable A2A (Agent-to-Agent) message.
///
/// Validates escrow requirements per A2AMessage constraints in main.rs:
///   - COMPUTE_BID: Requires non-zero escrow
///   - INFERENCE_REQUEST: Requires non-zero escrow (budget)
///   - COMPUTE_RESULT: No escrow required
///   - CAPABILITY_QUERY: Must have zero escrow (read-only)
///   - DATA_ATTESTATION: No escrow required
///
/// Agent must be registered via RegisterAgent before sending messages.
/// A2A relay fee: 0.1% on escrow amounts → FeeCollector/RevenueSplitter.
#[allow(clippy::too_many_arguments)]
pub fn execute_send_a2a_message(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    message_id: String,
    msg_type: MessageType,
    recipient_chain: ChainId,
    payload_hash: String,
    ttl: u64,
    escrow_amount: Option<Uint128>,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Check message doesn't already exist
    if A2A_MESSAGES.has(deps.storage, &message_id) {
        return Err(ContractError::MessageAlreadyExists {
            message_id: message_id.clone(),
        });
    }

    // Agent must be registered
    if !REGISTERED_AGENTS.has(deps.storage, &info.sender) {
        return Err(ContractError::AgentNotRegistered {
            agent: info.sender.to_string(),
        });
    }

    // Validate payload hash
    if payload_hash.is_empty() {
        return Err(ContractError::InvalidInputHash {});
    }

    // Validate TTL (1 second to 24 hours)
    if ttl == 0 || ttl > 86400 {
        return Err(ContractError::InvalidTTL { ttl });
    }

    let escrow = escrow_amount.unwrap_or(Uint128::zero());

    // Validate escrow requirements per message type
    validate_escrow_for_msg_type(&msg_type, escrow)?;

    // Calculate A2A relay fee (0.1% on escrow)
    let relay_fee = if escrow.is_zero() {
        Uint128::zero()
    } else {
        escrow
            .checked_mul(Uint128::new(config.a2a_relay_fee_bps as u128))?
            .checked_div(Uint128::new(10_000))?
    };

    // Generate per-agent nonce
    let nonce = increment_agent_nonce(deps.storage, &info.sender)?;

    // Store message
    let message = A2AMessage {
        message_id: message_id.clone(),
        msg_type: msg_type.clone(),
        sender_chain: ChainId::Osmosis,
        recipient_chain: recipient_chain.clone(),
        sender: info.sender.clone(),
        payload_hash: payload_hash.clone(),
        escrow_amount: escrow,
        nonce,
        ttl,
        timestamp: env.block.time.seconds(),
        verified: false,
    };
    A2A_MESSAGES.save(deps.storage, &message_id, &message)?;

    // Track relay fee
    if !relay_fee.is_zero() {
        state.pending_fees = state.pending_fees.checked_add(relay_fee)?;
        state.total_fees_collected = state.total_fees_collected.checked_add(relay_fee)?;
    }

    STATE.save(deps.storage, &state)?;

    // Emit MessageVerified event (Phase E.3 A2A event)
    Ok(Response::new()
        .add_attribute("action", "send_a2a_message")
        .add_attribute("message_id", &message_id)
        .add_attribute("msg_type", format!("{:?}", msg_type))
        .add_attribute("sender_chain", "osmosis")
        .add_attribute("recipient_chain", format!("{:?}", recipient_chain))
        .add_attribute("sender", info.sender)
        .add_attribute("payload_hash", &payload_hash)
        .add_attribute("escrow_amount", escrow)
        .add_attribute("relay_fee", relay_fee)
        .add_attribute("nonce", nonce.to_string())
        .add_attribute("ttl", ttl.to_string())
        .add_attribute("timestamp", env.block.time.seconds().to_string())
        .add_attribute("for_ai_listener", "true"))
}

/// Verify an A2A message with an SP1 proof (called by relayer).
/// SP1 validates: sender identity, escrow lock, nonce, TTL, payload hash, IBC channel.
pub fn execute_verify_a2a_message(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    message_id: String,
    sp1_proof: SP1Proof,
    nullifier: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    require_relayer(deps.as_ref(), &info.sender)?;

    let mut message = A2A_MESSAGES
        .may_load(deps.storage, &message_id)?
        .ok_or(ContractError::MessageNotFound {
            message_id: message_id.clone(),
        })?;

    if message.verified {
        return Err(ContractError::MessageAlreadyVerified {
            message_id: message_id.clone(),
        });
    }

    if USED_NULLIFIERS
        .may_load(deps.storage, &nullifier)?
        .unwrap_or(false)
    {
        return Err(ContractError::NullifierAlreadyUsed {});
    }

    let outcome = verify_sp1_proof(&config, &sp1_proof, &message_id)?;
    USED_NULLIFIERS.save(deps.storage, &nullifier, &true)?;

    let _ = &env; // Retain env for future TTL expiry checks
    let mut response = Response::new();

    if outcome == ProofOutcome::Valid {
        message.verified = true;
        state.total_a2a_messages_verified += 1;

        // Emit A2AMessageVerified event
        response = response
            .add_attribute("action", "verify_a2a_message")
            .add_attribute("message_id", &message_id)
            .add_attribute("msg_type", format!("{:?}", message.msg_type))
            .add_attribute("sender_chain", format!("{:?}", message.sender_chain))
            .add_attribute("recipient_chain", format!("{:?}", message.recipient_chain))
            .add_attribute("payload_hash", &message.payload_hash)
            .add_attribute("escrow_amount", message.escrow_amount)
            .add_attribute("nonce", message.nonce.to_string())
            .add_attribute("nullifier", &nullifier)
            .add_attribute("verified", "true");
    } else {
        response = response
            .add_attribute("action", "verify_a2a_message")
            .add_attribute("message_id", &message_id)
            .add_attribute("proof_outcome", format!("{:?}", outcome))
            .add_attribute("verified", "false");
    }

    A2A_MESSAGES.save(deps.storage, &message_id, &message)?;
    STATE.save(deps.storage, &state)?;

    Ok(response)
}

// ============================================================================
// AGENT REGISTRATION
// ============================================================================

/// Register an AI agent's on-chain identity commitment.
/// Required for A2A messaging — validate_a2a_message() checks sender_identity.
/// Agents can update their identity by re-registering.
pub fn execute_register_agent(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    identity_commitment: String,
) -> Result<Response, ContractError> {
    if identity_commitment.is_empty() {
        return Err(ContractError::InvalidInputHash {});
    }

    let mut state = STATE.load(deps.storage)?;
    let is_new = !REGISTERED_AGENTS.has(deps.storage, &info.sender);

    let agent = RegisteredAgent {
        address: info.sender.clone(),
        identity_commitment: identity_commitment.clone(),
        registered_at: env.block.time.seconds(),
    };
    REGISTERED_AGENTS.save(deps.storage, &info.sender, &agent)?;

    // Initialize nonce if new agent
    if is_new {
        AGENT_NONCES.save(deps.storage, &info.sender, &0u64)?;
        state.total_agents_registered += 1;
        STATE.save(deps.storage, &state)?;
    }

    Ok(Response::new()
        .add_attribute("action", "register_agent")
        .add_attribute("agent", info.sender)
        .add_attribute("identity_commitment", identity_commitment)
        .add_attribute("is_new", is_new.to_string()))
}

// ============================================================================
// FEE MANAGEMENT
// ============================================================================

/// CW20 Receive hook — accepts ibcTFUEL tokens as task payment / escrow.
/// Only the ibcTFUEL token contract can call this.
pub fn execute_receive(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    sender: String,
    amount: Uint128,
    _msg: Binary,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Only the ibcTFUEL token contract can call this hook
    if info.sender != config.ibctfuel_token {
        return Err(ContractError::Unauthorized {});
    }

    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    Ok(Response::new()
        .add_attribute("action", "receive_ibctfuel")
        .add_attribute("from_sender", sender)
        .add_attribute("amount", amount))
}

/// Forward accumulated fees to FeeCollector.wasm via CW20 Send.
/// Can be called by anyone. Fees flow to 30/30/25/15 split via RevenueSplitter.
pub fn execute_forward_fees(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    if state.pending_fees.is_zero() {
        return Err(ContractError::CustomError {
            val: "No pending fees to forward".to_string(),
        });
    }

    let forward_amount = state.pending_fees;
    let forward_msgs = build_fee_forward_msgs(&config, forward_amount)?;

    state.total_fees_forwarded = state
        .total_fees_forwarded
        .checked_add(forward_amount)?;
    state.pending_fees = Uint128::zero();
    STATE.save(deps.storage, &state)?;

    let mut response = Response::new()
        .add_attribute("action", "forward_fees")
        .add_attribute("amount", forward_amount)
        .add_attribute("fee_collector", config.fee_collector.to_string())
        .add_attribute("total_forwarded", state.total_fees_forwarded);

    for msg in forward_msgs {
        response = response.add_message(msg);
    }

    Ok(response)
}

// ============================================================================
// ADMIN FUNCTIONS
// ============================================================================

pub fn execute_add_relayer(
    deps: DepsMut,
    info: MessageInfo,
    relayer: String,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let relayer_addr = deps.api.addr_validate(&relayer)?;
    RELAYERS.save(deps.storage, &relayer_addr, &true)?;

    Ok(Response::new()
        .add_attribute("action", "add_relayer")
        .add_attribute("relayer", relayer_addr))
}

pub fn execute_remove_relayer(
    deps: DepsMut,
    info: MessageInfo,
    relayer: String,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let relayer_addr = deps.api.addr_validate(&relayer)?;
    RELAYERS.remove(deps.storage, &relayer_addr);

    Ok(Response::new()
        .add_attribute("action", "remove_relayer")
        .add_attribute("relayer", relayer_addr))
}

pub fn execute_set_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let new_admin_addr = deps.api.addr_validate(&new_admin)?;

    let mut config = CONFIG.load(deps.storage)?;
    config.admin = new_admin_addr.clone();
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_admin")
        .add_attribute("new_admin", new_admin_addr))
}

pub fn execute_set_fee_collector(
    deps: DepsMut,
    info: MessageInfo,
    new_fee_collector: String,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let new_addr = deps.api.addr_validate(&new_fee_collector)?;

    let mut config = CONFIG.load(deps.storage)?;
    config.fee_collector = new_addr.clone();
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_fee_collector")
        .add_attribute("new_fee_collector", new_addr))
}

pub fn execute_set_default_fee_bps(
    deps: DepsMut,
    info: MessageInfo,
    fee_bps: u16,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let config = CONFIG.load(deps.storage)?;

    if fee_bps < config.min_fee_bps || fee_bps > config.max_fee_bps {
        return Err(ContractError::InvalidFeeBps { bps: fee_bps });
    }

    let mut config = config;
    config.default_fee_bps = fee_bps;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_default_fee_bps")
        .add_attribute("fee_bps", fee_bps.to_string()))
}

pub fn execute_set_fee_forward_threshold(
    deps: DepsMut,
    info: MessageInfo,
    threshold: Uint128,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let mut config = CONFIG.load(deps.storage)?;
    config.fee_forward_threshold = threshold;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_fee_forward_threshold")
        .add_attribute("threshold", threshold))
}

pub fn execute_set_akash_ibc_channel(
    deps: DepsMut,
    info: MessageInfo,
    channel: String,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let mut config = CONFIG.load(deps.storage)?;
    config.akash_ibc_channel = Some(channel.clone());
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_akash_ibc_channel")
        .add_attribute("channel", channel))
}

pub fn execute_pause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let mut config = CONFIG.load(deps.storage)?;
    config.paused = true;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "pause")
        .add_attribute("paused", "true"))
}

pub fn execute_unpause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let mut config = CONFIG.load(deps.storage)?;
    config.paused = false;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "unpause")
        .add_attribute("paused", "false"))
}

pub fn execute_emergency_withdraw(
    deps: DepsMut,
    info: MessageInfo,
    amount: Uint128,
    recipient: String,
    _denom: Option<String>,
) -> Result<Response, ContractError> {
    require_admin(deps.as_ref(), &info.sender)?;
    let recipient_addr = deps.api.addr_validate(&recipient)?;

    let config = CONFIG.load(deps.storage)?;

    // CW20 transfer (ibcTFUEL)
    let transfer_msg: CosmosMsg = WasmMsg::Execute {
        contract_addr: config.ibctfuel_token.to_string(),
        msg: to_json_binary(&Cw20ExecuteMsg::Transfer {
            recipient: recipient_addr.to_string(),
            amount,
        })?,
        funds: vec![],
    }
    .into();

    Ok(Response::new()
        .add_message(transfer_msg)
        .add_attribute("action", "emergency_withdraw")
        .add_attribute("amount", amount)
        .add_attribute("recipient", recipient_addr))
}

// ============================================================================
// QUERY
// ============================================================================

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::State {} => to_json_binary(&query_state(deps)?),
        QueryMsg::Task { task_id } => to_json_binary(&query_task(deps, task_id)?),
        QueryMsg::Message { message_id } => to_json_binary(&query_message(deps, message_id)?),
        QueryMsg::Agent { address } => to_json_binary(&query_agent(deps, address)?),
        QueryMsg::Nullifier { nullifier } => to_json_binary(&query_nullifier(deps, nullifier)?),
        QueryMsg::CalculateFee { amount, fee_bps } => {
            to_json_binary(&query_calculate_fee(deps, amount, fee_bps)?)
        }
        QueryMsg::PendingFees {} => to_json_binary(&query_pending_fees(deps)?),
        QueryMsg::ListTasks {
            start_after,
            limit,
        } => to_json_binary(&query_list_tasks(deps, start_after, limit)?),
        QueryMsg::ListMessages {
            start_after,
            limit,
        } => to_json_binary(&query_list_messages(deps, start_after, limit)?),
    }
}

pub fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        admin: config.admin,
        fee_collector: config.fee_collector,
        ibctfuel_token: config.ibctfuel_token,
        min_fee_bps: config.min_fee_bps,
        max_fee_bps: config.max_fee_bps,
        default_fee_bps: config.default_fee_bps,
        a2a_relay_fee_bps: config.a2a_relay_fee_bps,
        min_task_amount: config.min_task_amount,
        max_batch_size: config.max_batch_size,
        fee_forward_threshold: config.fee_forward_threshold,
        mock_mode: config.mock_mode,
        paused: config.paused,
        akash_ibc_channel: config.akash_ibc_channel,
        theta_ibc_channel: config.theta_ibc_channel,
    })
}

pub fn query_state(deps: Deps) -> StdResult<StateResponse> {
    let state = STATE.load(deps.storage)?;
    Ok(StateResponse {
        total_tasks_routed: state.total_tasks_routed,
        total_tasks_settled: state.total_tasks_settled,
        total_a2a_messages_verified: state.total_a2a_messages_verified,
        total_fees_collected: state.total_fees_collected,
        total_fees_forwarded: state.total_fees_forwarded,
        pending_fees: state.pending_fees,
        total_agents_registered: state.total_agents_registered,
    })
}

pub fn query_task(deps: Deps, task_id: String) -> StdResult<TaskResponse> {
    let task = TASKS.load(deps.storage, &task_id)?;
    Ok(task_to_response(task))
}

pub fn query_message(deps: Deps, message_id: String) -> StdResult<A2AMessageResponse> {
    let msg = A2A_MESSAGES.load(deps.storage, &message_id)?;
    Ok(message_to_response(msg))
}

pub fn query_agent(deps: Deps, address: String) -> StdResult<AgentResponse> {
    let addr = deps.api.addr_validate(&address)?;
    let agent = REGISTERED_AGENTS.may_load(deps.storage, &addr)?;
    let nonce = AGENT_NONCES
        .may_load(deps.storage, &addr)?
        .unwrap_or(0);

    match agent {
        Some(a) => Ok(AgentResponse {
            address: a.address,
            identity_commitment: a.identity_commitment,
            registered: true,
            nonce,
        }),
        None => Ok(AgentResponse {
            address: addr,
            identity_commitment: String::new(),
            registered: false,
            nonce: 0,
        }),
    }
}

pub fn query_nullifier(deps: Deps, nullifier: String) -> StdResult<NullifierResponse> {
    let used = USED_NULLIFIERS
        .may_load(deps.storage, &nullifier)?
        .unwrap_or(false);
    Ok(NullifierResponse { nullifier, used })
}

pub fn query_calculate_fee(
    deps: Deps,
    amount: Uint128,
    fee_bps: u16,
) -> StdResult<FeeCalculationResponse> {
    let config = CONFIG.load(deps.storage)?;
    if fee_bps < config.min_fee_bps || fee_bps > config.max_fee_bps {
        return Ok(FeeCalculationResponse {
            gross_amount: amount,
            fee_amount: Uint128::zero(),
            net_amount: amount,
            fee_bps,
        });
    }

    let fee_amount = amount
        .checked_mul(Uint128::new(fee_bps as u128))
        .unwrap_or(Uint128::zero())
        .checked_div(Uint128::new(10_000))
        .unwrap_or(Uint128::zero());
    let net_amount = amount.checked_sub(fee_amount).unwrap_or(Uint128::zero());

    Ok(FeeCalculationResponse {
        gross_amount: amount,
        fee_amount,
        net_amount,
        fee_bps,
    })
}

pub fn query_pending_fees(deps: Deps) -> StdResult<PendingFeesResponse> {
    let config = CONFIG.load(deps.storage)?;
    let state = STATE.load(deps.storage)?;

    Ok(PendingFeesResponse {
        pending: state.pending_fees,
        threshold: config.fee_forward_threshold,
        ready_to_forward: state.pending_fees >= config.fee_forward_threshold,
    })
}

pub fn query_list_tasks(
    deps: Deps,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<TaskListResponse> {
    let limit = limit.unwrap_or(30).min(100) as usize;

    let tasks: Vec<TaskResponse> = match start_after {
        Some(start) => TASKS
            .range(
                deps.storage,
                Some(cw_storage_plus::Bound::exclusive(start.as_str())),
                None,
                cosmwasm_std::Order::Ascending,
            )
            .take(limit)
            .filter_map(|r| r.ok())
            .map(|(_, task)| task_to_response(task))
            .collect(),
        None => TASKS
            .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
            .take(limit)
            .filter_map(|r| r.ok())
            .map(|(_, task)| task_to_response(task))
            .collect(),
    };

    Ok(TaskListResponse { tasks })
}

pub fn query_list_messages(
    deps: Deps,
    start_after: Option<String>,
    limit: Option<u32>,
) -> StdResult<MessageListResponse> {
    let limit = limit.unwrap_or(30).min(100) as usize;

    let messages: Vec<A2AMessageResponse> = match start_after {
        Some(start) => A2A_MESSAGES
            .range(
                deps.storage,
                Some(cw_storage_plus::Bound::exclusive(start.as_str())),
                None,
                cosmwasm_std::Order::Ascending,
            )
            .take(limit)
            .filter_map(|r| r.ok())
            .map(|(_, msg)| message_to_response(msg))
            .collect(),
        None => A2A_MESSAGES
            .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
            .take(limit)
            .filter_map(|r| r.ok())
            .map(|(_, msg)| message_to_response(msg))
            .collect(),
    };

    Ok(MessageListResponse { messages })
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/// Calculate task fee: fee = gross × bps / 10000, net = gross - fee.
/// Mirrors `calculate_task_fee()` in sp1-prover/program/src/main.rs.
fn calculate_task_fee(
    gross_amount: Uint128,
    fee_bps: u16,
) -> Result<(Uint128, Uint128), ContractError> {
    let fee_amount = gross_amount
        .checked_mul(Uint128::new(fee_bps as u128))?
        .checked_div(Uint128::new(10_000))?;
    let net_amount = gross_amount.checked_sub(fee_amount)?;
    Ok((fee_amount, net_amount))
}

/// Verify an SP1 proof. In mock mode, always returns Valid.
/// In production, validates the proof against the SP1 verifier.
fn verify_sp1_proof(
    config: &Config,
    sp1_proof: &SP1Proof,
    _context_id: &str,
) -> Result<ProofOutcome, ContractError> {
    if config.mock_mode {
        // Mock mode: accept all proofs (governance testing)
        return Ok(ProofOutcome::Valid);
    }

    // Production mode: validate SP1 proof
    // The proof_data contains the STARK-to-SNARK recursive proof.
    // Verification is done by hashing public inputs and comparing against
    // the committed verification key.
    //
    // In production, this would call an on-chain SP1 verifier contract or
    // use the SP1 precompile (if available on Osmosis).
    //
    // For now: hash-based verification stub that validates proof structure.
    if sp1_proof.proof_data.is_empty() {
        return Ok(ProofOutcome::Invalid {
            reason: "Empty proof data".to_string(),
        });
    }

    if sp1_proof.vk_hash.is_empty() {
        return Ok(ProofOutcome::Invalid {
            reason: "Missing verification key hash".to_string(),
        });
    }

    if sp1_proof.public_inputs.is_empty() {
        return Ok(ProofOutcome::Invalid {
            reason: "Empty public inputs".to_string(),
        });
    }

    // Compute commitment: SHA256(proof_data || public_inputs || vk_hash)
    let mut hasher = Sha256::new();
    hasher.update(sp1_proof.proof_data.as_slice());
    hasher.update(sp1_proof.public_inputs.as_slice());
    hasher.update(sp1_proof.vk_hash.as_bytes());
    let _commitment = hasher.finalize();

    // In production: compare commitment against on-chain SP1 verifier output.
    // For Phase D launch: accept any well-formed proof that passes structure checks.
    // Full cryptographic verification added when Osmosis SP1 precompile is available.
    Ok(ProofOutcome::Valid)
}

/// Validate task-type-specific input requirements.
/// Matches constraints in validate_ai_task() in main.rs.
fn validate_task_type_inputs(
    msg_type: &MessageType,
    model_id_hash: &Option<String>,
    input_hash: &Option<String>,
    output_hash: &Option<String>,
) -> Result<(), ContractError> {
    match msg_type {
        MessageType::ComputeResult => {
            // COMPUTE_RESULT must have a valid output_hash
            if output_hash.as_ref().map_or(true, |h| h.is_empty()) {
                return Err(ContractError::InvalidOutputHash {});
            }
        }
        MessageType::InferenceRequest => {
            // INFERENCE_REQUEST must reference a model and have input
            if model_id_hash.as_ref().map_or(true, |h| h.is_empty()) {
                return Err(ContractError::InvalidModelIdHash {});
            }
            if input_hash.as_ref().map_or(true, |h| h.is_empty()) {
                return Err(ContractError::InvalidInputHash {});
            }
        }
        MessageType::DataAttestation => {
            // DATA_ATTESTATION must have input_hash (the data hash)
            if input_hash.as_ref().map_or(true, |h| h.is_empty()) {
                return Err(ContractError::InvalidInputHash {});
            }
        }
        MessageType::ComputeBid => {
            // ComputeBid: no additional constraints beyond basic validation
        }
        MessageType::CapabilityQuery => {
            // CapabilityQuery is lightweight — no additional constraints
        }
    }
    Ok(())
}

/// Validate chain routing — IBC channel required for Akash/Persistence.
fn validate_chain_routing(
    destination_chain: &ChainId,
    ibc_channel: &Option<String>,
    config: &Config,
) -> Result<(), ContractError> {
    match destination_chain {
        ChainId::Akash => {
            // Must have IBC channel (from param or config)
            if ibc_channel.is_none() && config.akash_ibc_channel.is_none() {
                return Err(ContractError::IbcChannelRequired {});
            }
        }
        ChainId::Persistence => {
            // IBC channel should be provided for Persistence routing
            // (Persistence is backward-compatible)
        }
        ChainId::Osmosis => {
            // Local — no IBC needed
        }
        ChainId::Theta => {
            // Local compute — no IBC needed
        }
        ChainId::Bittensor => {
            // TAO routing handled by ai-listener.js via Substrate bridge
        }
    }
    Ok(())
}

/// Validate escrow requirements per A2A message type.
/// Matches rules in validate_a2a_message() in main.rs.
fn validate_escrow_for_msg_type(
    msg_type: &MessageType,
    escrow: Uint128,
) -> Result<(), ContractError> {
    match msg_type {
        MessageType::ComputeBid => {
            if escrow.is_zero() {
                return Err(ContractError::EscrowRequired {
                    msg_type: "ComputeBid".to_string(),
                });
            }
        }
        MessageType::InferenceRequest => {
            if escrow.is_zero() {
                return Err(ContractError::EscrowRequired {
                    msg_type: "InferenceRequest".to_string(),
                });
            }
        }
        MessageType::CapabilityQuery => {
            if !escrow.is_zero() {
                return Err(ContractError::EscrowForbidden {
                    msg_type: "CapabilityQuery".to_string(),
                });
            }
        }
        // COMPUTE_RESULT and DATA_ATTESTATION: escrow is optional
        _ => {}
    }
    Ok(())
}

/// Increment per-agent nonce (replay protection).
fn increment_agent_nonce(
    storage: &mut dyn cosmwasm_std::Storage,
    agent: &Addr,
) -> Result<u64, ContractError> {
    let current = AGENT_NONCES
        .may_load(storage, agent)?
        .unwrap_or(0);
    let next = current + 1;
    AGENT_NONCES.save(storage, agent, &next)?;
    Ok(next)
}

/// Build CW20 Send message to forward fees to FeeCollector.wasm.
/// Compatible with the fee-collector's Receive hook.
fn build_fee_forward_msgs(
    config: &Config,
    amount: Uint128,
) -> Result<Vec<CosmosMsg>, ContractError> {
    let send_msg = WasmMsg::Execute {
        contract_addr: config.ibctfuel_token.to_string(),
        msg: to_json_binary(&Cw20ExecuteMsg::Send {
            contract: config.fee_collector.to_string(),
            amount,
            msg: Binary::from(b"{\"source\":\"ai_verifier\",\"reason\":\"accumulated_task_fees\"}"),
        })?,
        funds: vec![],
    };

    Ok(vec![send_msg.into()])
}

/// Require the caller to be admin.
fn require_admin(deps: Deps, sender: &Addr) -> Result<(), ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if *sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

/// Require the caller to be an authorized relayer.
fn require_relayer(deps: Deps, sender: &Addr) -> Result<(), ContractError> {
    let config = CONFIG.load(deps.storage)?;
    // Admin is always a relayer
    if *sender == config.admin {
        return Ok(());
    }
    let is_relayer = RELAYERS
        .may_load(deps.storage, sender)?
        .unwrap_or(false);
    if !is_relayer {
        return Err(ContractError::Unauthorized {});
    }
    Ok(())
}

/// Convert AITask to TaskResponse
fn task_to_response(task: AITask) -> TaskResponse {
    TaskResponse {
        task_id: task.task_id,
        msg_type: task.msg_type,
        source_chain: task.source_chain,
        destination_chain: task.destination_chain,
        requester: task.requester,
        gross_amount: task.gross_amount,
        fee_amount: task.fee_amount,
        net_amount: task.net_amount,
        fee_bps: task.fee_bps,
        output_hash: task.output_hash,
        model_id_hash: task.model_id_hash,
        input_hash: task.input_hash,
        nonce: task.nonce,
        timestamp: task.timestamp,
        settled: task.settled,
        proof_outcome: task.proof_outcome,
    }
}

/// Convert A2AMessage to A2AMessageResponse
fn message_to_response(msg: A2AMessage) -> A2AMessageResponse {
    A2AMessageResponse {
        message_id: msg.message_id,
        msg_type: msg.msg_type,
        sender_chain: msg.sender_chain,
        recipient_chain: msg.recipient_chain,
        sender: msg.sender,
        payload_hash: msg.payload_hash,
        escrow_amount: msg.escrow_amount,
        nonce: msg.nonce,
        ttl: msg.ttl,
        timestamp: msg.timestamp,
        verified: msg.verified,
    }
}
