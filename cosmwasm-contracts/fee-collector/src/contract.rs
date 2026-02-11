use cosmwasm_std::{
    entry_point, to_json_binary, Addr, Binary, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128, WasmMsg, CosmosMsg,
};
use cw2::set_contract_version;
use cw20::Cw20ExecuteMsg;

use crate::error::ContractError;
use crate::msg::{ConfigResponse, ExecuteMsg, InstantiateMsg, QueryMsg, ReadyToBurnResponse, StateResponse};
use crate::state::{Config, State, CONFIG, STATE};

const CONTRACT_NAME: &str = "crates.io:fee-collector";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ============================================================================
// INSTANTIATE
// ============================================================================

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let admin_addr = deps.api.addr_validate(&msg.admin)?;
    let token_addr = deps.api.addr_validate(&msg.ibctfuel_token)?;
    let minter_addr = deps.api.addr_validate(&msg.minter_contract)?;

    let config = Config {
        admin: admin_addr.clone(),
        ibctfuel_token: token_addr,
        minter_contract: minter_addr,
        min_burn_amount: msg.min_burn_amount,
        paused: false,
    };
    CONFIG.save(deps.storage, &config)?;

    let state = State {
        accumulated_fees: Uint128::zero(),
        total_burned: Uint128::zero(),
        total_burns_count: 0,
        last_burn_time: env.block.time.seconds(),
    };
    STATE.save(deps.storage, &state)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", admin_addr)
        .add_attribute("contract_name", CONTRACT_NAME)
        .add_attribute("version", CONTRACT_VERSION))
}

// ============================================================================
// EXECUTE
// ============================================================================

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Receive { sender, amount, msg } => {
            execute_receive(deps, env, info, sender, amount, msg)
        }
        ExecuteMsg::TriggerFeeBurn {} => execute_trigger_fee_burn(deps, env, info),
        ExecuteMsg::SetAdmin { new_admin } => execute_set_admin(deps, info, new_admin),
        ExecuteMsg::SetMinterContract { new_minter } => execute_set_minter(deps, info, new_minter),
        ExecuteMsg::SetMinBurnAmount { amount } => execute_set_min_burn(deps, info, amount),
        ExecuteMsg::Pause {} => execute_pause(deps, info),
        ExecuteMsg::Unpause {} => execute_unpause(deps, info),
        ExecuteMsg::EmergencyWithdraw { amount, recipient } => {
            execute_emergency_withdraw(deps, info, amount, recipient)
        }
    }
}

/// CW20 Receive hook - standard pattern for receiving CW20 tokens
/// This is automatically called when tokens are sent via Cw20ExecuteMsg::Send
/// 
/// Security Model:
/// - Only the ibcTFUEL token contract can call this hook (validated via info.sender)
/// - The 'sender' parameter is the original user who sent tokens (informational only)
/// - No need to validate original sender - the token contract already verified they had the tokens
pub fn execute_receive(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    sender: String,
    amount: Uint128,
    _msg: Binary,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Check if paused
    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Validate that the caller (info.sender) is the ibcTFUEL token contract
    // This is the ONLY security check needed - the token contract ensures sender had the tokens
    if info.sender != config.ibctfuel_token {
        return Err(ContractError::Unauthorized {});
    }

    // Validate amount
    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    // Update accumulated fees
    state.accumulated_fees = state.accumulated_fees.checked_add(amount)?;
    STATE.save(deps.storage, &state)?;

    Ok(Response::new()
        .add_attribute("action", "receive_fees")
        .add_attribute("from_sender", sender)
        .add_attribute("amount", amount)
        .add_attribute("accumulated_total", state.accumulated_fees))
}

/// Trigger fee burn - burns all accumulated fees and emits event for SP1 proof
pub fn execute_trigger_fee_burn(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Check if paused
    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Only admin or governance can trigger burns
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Check minimum burn amount
    if state.accumulated_fees < config.min_burn_amount {
        return Err(ContractError::CustomError {
            val: format!(
                "Insufficient accumulated fees. Have: {}, Need: {}",
                state.accumulated_fees, config.min_burn_amount
            ),
        });
    }

    let burn_amount = state.accumulated_fees;

    // Create burn message for CW20 token
    let burn_msg = WasmMsg::Execute {
        contract_addr: config.ibctfuel_token.to_string(),
        msg: to_json_binary(&Cw20ExecuteMsg::Burn {
            amount: burn_amount,
        })?,
        funds: vec![],
    };

    // Update state
    state.total_burned = state.total_burned.checked_add(burn_amount)?;
    state.total_burns_count += 1;
    state.last_burn_time = env.block.time.seconds();
    state.accumulated_fees = Uint128::zero();
    STATE.save(deps.storage, &state)?;

    // Emit FeeBurn event for SP1 proof generation
    // This event will be picked up by the ZK prover to create unwrap proofs
    Ok(Response::new()
        .add_message(burn_msg)
        .add_attribute("action", "fee_burn")
        .add_attribute("burn_amount", burn_amount)
        .add_attribute("burn_count", state.total_burns_count.to_string())
        .add_attribute("timestamp", env.block.time.seconds().to_string())
        .add_attribute("block_height", env.block.height.to_string())
        // This attribute is critical for SP1 proof generation
        .add_attribute("for_sp1_proof", "true"))
}

pub fn execute_set_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let new_admin_addr = deps.api.addr_validate(&new_admin)?;
    config.admin = new_admin_addr.clone();
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_admin")
        .add_attribute("new_admin", new_admin_addr))
}

pub fn execute_set_minter(
    deps: DepsMut,
    info: MessageInfo,
    new_minter: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let new_minter_addr = deps.api.addr_validate(&new_minter)?;
    config.minter_contract = new_minter_addr.clone();
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_minter")
        .add_attribute("new_minter", new_minter_addr))
}

pub fn execute_set_min_burn(
    deps: DepsMut,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.min_burn_amount = amount;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_min_burn_amount")
        .add_attribute("amount", amount))
}

pub fn execute_pause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.paused = true;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "pause")
        .add_attribute("paused", "true"))
}

pub fn execute_unpause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

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
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let recipient_addr = deps.api.addr_validate(&recipient)?;

    // Create transfer message
    let transfer_msg = WasmMsg::Execute {
        contract_addr: config.ibctfuel_token.to_string(),
        msg: to_json_binary(&Cw20ExecuteMsg::Transfer {
            recipient: recipient_addr.to_string(),
            amount,
        })?,
        funds: vec![],
    };

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
        QueryMsg::ReadyToBurn {} => to_json_binary(&query_ready_to_burn(deps)?),
    }
}

pub fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        admin: config.admin,
        ibctfuel_token: config.ibctfuel_token,
        minter_contract: config.minter_contract,
        min_burn_amount: config.min_burn_amount,
        paused: config.paused,
    })
}

pub fn query_state(deps: Deps) -> StdResult<StateResponse> {
    let state = STATE.load(deps.storage)?;
    Ok(StateResponse {
        accumulated_fees: state.accumulated_fees,
        total_burned: state.total_burned,
        total_burns_count: state.total_burns_count,
        last_burn_time: state.last_burn_time,
    })
}

pub fn query_ready_to_burn(deps: Deps) -> StdResult<ReadyToBurnResponse> {
    let config = CONFIG.load(deps.storage)?;
    let state = STATE.load(deps.storage)?;

    Ok(ReadyToBurnResponse {
        ready: state.accumulated_fees >= config.min_burn_amount,
        accumulated: state.accumulated_fees,
        minimum: config.min_burn_amount,
    })
}
