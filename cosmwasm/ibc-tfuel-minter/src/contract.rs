use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
    StdError, Addr, Uint128, SubMsg, WasmMsg, CosmosMsg, from_json,
};
use cw2::set_contract_version;
use cw20_base::ContractError as Cw20Error;

use crate::msg::{
    ExecuteMsg, InstantiateMsg, QueryMsg, ReceiveMsg, ConfigResponse, MintStatsResponse,
    BurnStatsResponse, MintRecordResponse, ZkProof,
};
use crate::state::{Config, MintRecord, BurnRecord, Stats, CONFIG, STATS, MINT_RECORDS, BURN_RECORDS};
use crate::error::ContractError;

const CONTRACT_NAME: &str = "crates.io:ibc-tfuel-minter";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let admin = msg.admin
        .map(|a| deps.api.addr_validate(&a))
        .transpose()?
        .unwrap_or(info.sender.clone());

    let zk_verifier = deps.api.addr_validate(&msg.zk_verifier)?;

    let config = Config {
        admin,
        zk_verifier,
        paused: false,
        max_supply: msg.max_supply,
    };

    let stats = Stats {
        total_minted: Uint128::zero(),
        total_burned: Uint128::zero(),
        total_mint_operations: 0,
        total_burn_operations: 0,
    };

    CONFIG.save(deps.storage, &config)?;
    STATS.save(deps.storage, &stats)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", config.admin)
        .add_attribute("zk_verifier", config.zk_verifier)
        .add_attribute("max_supply", msg.max_supply.unwrap_or(Uint128::zero()).to_string()))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::VerifyAndMint { proof, public_inputs, theta_tx_hash, nonce, recipient, amount } => {
            execute_verify_and_mint(deps, env, info, proof, public_inputs, theta_tx_hash, nonce, recipient, amount)
        }
        ExecuteMsg::Burn { amount, theta_recipient } => {
            execute_burn(deps, env, info, amount, theta_recipient)
        }
        ExecuteMsg::Receive(msg) => execute_receive(deps, env, info, msg),
        ExecuteMsg::UpdateAdmin { admin } => execute_update_admin(deps, info, admin),
        ExecuteMsg::UpdateZkVerifier { zk_verifier } => execute_update_zk_verifier(deps, info, zk_verifier),
        ExecuteMsg::Pause {} => execute_pause(deps, info),
        ExecuteMsg::Unpause {} => execute_unpause(deps, info),
    }
}

pub fn execute_verify_and_mint(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    proof: ZkProof,
    public_inputs: Vec<String>,
    theta_tx_hash: String,
    nonce: u64,
    recipient: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    
    if config.paused {
        return Err(ContractError::ContractPaused {});
    }

    // Check for duplicate mint (replay protection)
    if MINT_RECORDS.may_load(deps.storage, &theta_tx_hash)?.is_some() {
        return Err(ContractError::AlreadyMinted {});
    }

    // Call ZK verifier as submessage
    let verify_msg = WasmMsg::Execute {
        contract_addr: config.zk_verifier.to_string(),
        msg: to_json_binary(&ZkVerifierExecuteMsg::VerifyProof {
            proof,
            public_inputs,
            theta_tx_hash: theta_tx_hash.clone(),
            nonce,
        })?,
        funds: vec![],
    };

    let verify_submsg = SubMsg::reply_on_success(verify_msg, 1);

    // Validate recipient
    let recipient_addr = deps.api.addr_validate(&recipient)?;

    // Check max supply
    let mut stats = STATS.load(deps.storage)?;
    let new_supply = stats.total_minted.checked_add(amount)?;
    if let Some(max_supply) = config.max_supply {
        if new_supply > max_supply {
            return Err(ContractError::MaxSupplyExceeded {});
        }
    }

    // Update stats
    stats.total_minted = new_supply;
    stats.total_mint_operations += 1;
    STATS.save(deps.storage, &stats)?;

    // Record mint
    let mint_record = MintRecord {
        theta_tx_hash: theta_tx_hash.clone(),
        recipient: recipient_addr.clone(),
        amount,
        minted_at: env.block.time.seconds(),
        nonce,
    };
    MINT_RECORDS.save(deps.storage, &theta_tx_hash, &mint_record)?;

    // NOTE: In production, this would mint actual CW20 tokens
    // For now, we track balances in MINT_RECORDS

    Ok(Response::new()
        .add_submessage(verify_submsg)
        .add_attribute("method", "verify_and_mint")
        .add_attribute("theta_tx_hash", theta_tx_hash)
        .add_attribute("recipient", recipient)
        .add_attribute("amount", amount)
        .add_attribute("minted_by", info.sender))
}

// Dummy message type for ZK verifier (actual contract defines this)
#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum ZkVerifierExecuteMsg {
    VerifyProof {
        proof: ZkProof,
        public_inputs: Vec<String>,
        theta_tx_hash: String,
        nonce: u64,
    },
}

pub fn execute_burn(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
    theta_recipient: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    
    if config.paused {
        return Err(ContractError::ContractPaused {});
    }

    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    // Validate Theta address (0x... format)
    if !theta_recipient.starts_with("0x") || theta_recipient.len() != 42 {
        return Err(ContractError::InvalidThetaAddress {});
    }

    // Update stats
    let mut stats = STATS.load(deps.storage)?;
    stats.total_burned = stats.total_burned.checked_add(amount)?;
    stats.total_burn_operations += 1;
    STATS.save(deps.storage, &stats)?;

    // Record burn
    let burn_record = BurnRecord {
        burner: info.sender.clone(),
        amount,
        theta_recipient: theta_recipient.clone(),
        burned_at: env.block.time.seconds(),
    };
    BURN_RECORDS.save(deps.storage, stats.total_burn_operations, &burn_record)?;

    // NOTE: In production, this would burn actual CW20 tokens
    // Backend listens for burn events and processes unwrap on Theta

    Ok(Response::new()
        .add_attribute("method", "burn")
        .add_attribute("burner", info.sender)
        .add_attribute("amount", amount)
        .add_attribute("theta_recipient", theta_recipient)
        .add_attribute("burn_id", stats.total_burn_operations.to_string()))
}

pub fn execute_receive(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    wrapper: cw20::Cw20ReceiveMsg,
) -> Result<Response, ContractError> {
    let msg: ReceiveMsg = from_json(&wrapper.msg)?;
    match msg {
        ReceiveMsg::BurnFrom { theta_recipient } => {
            execute_burn(deps, env, info, wrapper.amount, theta_recipient)
        }
    }
}

pub fn execute_update_admin(
    deps: DepsMut,
    info: MessageInfo,
    new_admin: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.admin = deps.api.addr_validate(&new_admin)?;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("method", "update_admin")
        .add_attribute("new_admin", new_admin))
}

pub fn execute_update_zk_verifier(
    deps: DepsMut,
    info: MessageInfo,
    new_verifier: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.zk_verifier = deps.api.addr_validate(&new_verifier)?;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("method", "update_zk_verifier")
        .add_attribute("new_verifier", new_verifier))
}

pub fn execute_pause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.paused = true;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("method", "pause"))
}

pub fn execute_unpause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.paused = false;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("method", "unpause"))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::MintStats {} => to_json_binary(&query_mint_stats(deps)?),
        QueryMsg::BurnStats {} => to_json_binary(&query_burn_stats(deps)?),
        QueryMsg::MintRecord { theta_tx_hash } => to_json_binary(&query_mint_record(deps, theta_tx_hash)?),
        QueryMsg::Balance { address: _ } => {
            // Mock balance query - in production, query actual CW20
            to_json_binary(&cw20::BalanceResponse { balance: Uint128::zero() })
        }
        QueryMsg::TokenInfo {} => {
            // Mock token info - in production, query actual CW20
            to_json_binary(&cw20::TokenInfoResponse {
                name: "Theta Fuel IBC".to_string(),
                symbol: "ibcTFUEL".to_string(),
                decimals: 18,
                total_supply: Uint128::zero(),
            })
        }
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        admin: config.admin,
        zk_verifier: config.zk_verifier,
        token_address: Addr::unchecked(""), // Mock
        paused: config.paused,
        max_supply: config.max_supply,
    })
}

fn query_mint_stats(deps: Deps) -> StdResult<MintStatsResponse> {
    let stats = STATS.load(deps.storage)?;
    Ok(MintStatsResponse {
        total_minted: stats.total_minted,
        total_mint_operations: stats.total_mint_operations,
        current_supply: stats.total_minted.checked_sub(stats.total_burned).unwrap_or(Uint128::zero()),
    })
}

fn query_burn_stats(deps: Deps) -> StdResult<BurnStatsResponse> {
    let stats = STATS.load(deps.storage)?;
    Ok(BurnStatsResponse {
        total_burned: stats.total_burned,
        total_burn_operations: stats.total_burn_operations,
    })
}

fn query_mint_record(deps: Deps, theta_tx_hash: String) -> StdResult<MintRecordResponse> {
    let record = MINT_RECORDS.load(deps.storage, &theta_tx_hash)?;
    Ok(MintRecordResponse {
        theta_tx_hash: record.theta_tx_hash,
        recipient: record.recipient,
        amount: record.amount,
        minted_at: record.minted_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::Addr;

    #[test]
    fn proper_initialization() {
        let mut deps = mock_dependencies();
        let msg = InstantiateMsg {
            admin: None,
            zk_verifier: "verifier123".to_string(),
            name: "Theta Fuel IBC".to_string(),
            symbol: "ibcTFUEL".to_string(),
            decimals: 18,
            initial_supply: Uint128::zero(),
            max_supply: Some(Uint128::from(1000000u128 * 10u128.pow(18))),
        };
        let info = mock_info("creator", &[]);
        let res = instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();
        assert_eq!(0, res.messages.len());
    }
}

