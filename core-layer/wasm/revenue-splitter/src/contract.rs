use cosmwasm_std::{
    coins, entry_point, to_json_binary, BankMsg, Binary, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128,
};

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

const CONTRACT_NAME: &str = "crates.io:xfuel-revenue-splitter";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");
const TOTAL_BPS: u16 = 10000;

// ─── Instantiate ──────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    cw2::set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let split = msg.split_config.unwrap_or_default();
    validate_split(&split)?;

    let stake_pool = if msg.stake_pool_address.is_empty() {
        None
    } else {
        Some(deps.api.addr_validate(&msg.stake_pool_address)?)
    };

    CONFIG.save(
        deps.storage,
        &Config {
            admin: deps.api.addr_validate(&msg.admin)?,
            bbb_address: deps.api.addr_validate(&msg.bbb_address)?,
            lp_address: deps.api.addr_validate(&msg.lp_address)?,
            staker_address: deps.api.addr_validate(&msg.staker_address)?,
            treasury_address: deps.api.addr_validate(&msg.treasury_address)?,
            stake_pool_address: stake_pool,
            split,
        },
    )?;

    STATS.save(deps.storage, &Stats::default())?;

    Ok(Response::new().add_attribute("action", "instantiate"))
}

// ─── Execute ──────────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::Distribute {} => execute_distribute(deps, env),
        ExecuteMsg::DepositFee { circuit_id } => execute_deposit_fee(deps, info, circuit_id),
        ExecuteMsg::UpdateSplit { config } => execute_update_split(deps, info, config),
        ExecuteMsg::UpdateRecipient { role, address } => {
            execute_update_recipient(deps, info, role, address)
        }
        ExecuteMsg::UpdateAdmin { new_admin } => execute_update_admin(deps, info, new_admin),
    }
}

/// Distribute accumulated fees according to the 30/30/25/15 split.
///
/// Fee-to-stake: carves 15-25% of the treasury allocation for validator staking.
/// Per Theta docs: wTHETA staking for subchain validators.
fn execute_distribute(deps: DepsMut, env: Env) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Query contract balance
    let balance = deps
        .querier
        .query_balance(&env.contract.address, "ufuel")?; // Generic denom

    if balance.amount.is_zero() {
        return Err(ContractError::NothingToDistribute {});
    }

    let total = balance.amount;
    let split = &config.split;

    // Calculate splits
    let bbb_amount = total.multiply_ratio(split.bbb_bps as u128, TOTAL_BPS as u128);
    let lp_amount = total.multiply_ratio(split.lp_bps as u128, TOTAL_BPS as u128);
    let staker_amount = total.multiply_ratio(split.staker_bps as u128, TOTAL_BPS as u128);
    let treasury_raw = total - bbb_amount - lp_amount - staker_amount;

    // Fee-to-stake from treasury
    let fee_to_stake_amount =
        treasury_raw.multiply_ratio(split.fee_to_stake_bps as u128, TOTAL_BPS as u128);
    let treasury_amount = treasury_raw - fee_to_stake_amount;

    let mut msgs = vec![];
    let denom = "ufuel"; // Generic — set per deployment chain

    if !bbb_amount.is_zero() {
        msgs.push(BankMsg::Send {
            to_address: config.bbb_address.to_string(),
            amount: coins(bbb_amount.u128(), denom),
        });
    }
    if !lp_amount.is_zero() {
        msgs.push(BankMsg::Send {
            to_address: config.lp_address.to_string(),
            amount: coins(lp_amount.u128(), denom),
        });
    }
    if !staker_amount.is_zero() {
        msgs.push(BankMsg::Send {
            to_address: config.staker_address.to_string(),
            amount: coins(staker_amount.u128(), denom),
        });
    }
    if !treasury_amount.is_zero() {
        msgs.push(BankMsg::Send {
            to_address: config.treasury_address.to_string(),
            amount: coins(treasury_amount.u128(), denom),
        });
    }
    if !fee_to_stake_amount.is_zero() {
        if let Some(ref pool) = config.stake_pool_address {
            msgs.push(BankMsg::Send {
                to_address: pool.to_string(),
                amount: coins(fee_to_stake_amount.u128(), denom),
            });
        }
    }

    // Update stats
    let mut stats = STATS.load(deps.storage)?;
    stats.total_distributed += total;
    stats.total_bbb += bbb_amount;
    stats.total_lp += lp_amount;
    stats.total_staker += staker_amount;
    stats.total_treasury += treasury_amount;
    stats.total_fee_to_stake += fee_to_stake_amount;
    STATS.save(deps.storage, &stats)?;

    Ok(Response::new()
        .add_messages(msgs)
        .add_attribute("action", "distribute")
        .add_attribute("total", total.to_string())
        .add_attribute("bbb", bbb_amount.to_string())
        .add_attribute("lp", lp_amount.to_string())
        .add_attribute("staker", staker_amount.to_string())
        .add_attribute("treasury", treasury_amount.to_string())
        .add_attribute("fee_to_stake", fee_to_stake_amount.to_string()))
}

fn execute_deposit_fee(
    deps: DepsMut,
    info: MessageInfo,
    circuit_id: String,
) -> Result<Response, ContractError> {
    let sent = info
        .funds
        .first()
        .map(|c| c.amount)
        .unwrap_or(Uint128::zero());

    if sent.is_zero() {
        return Err(ContractError::ZeroAmount {});
    }

    let mut stats = STATS.load(deps.storage)?;
    stats.total_collected += sent;
    STATS.save(deps.storage, &stats)?;

    let existing = CIRCUIT_FEES
        .may_load(deps.storage, &circuit_id)?
        .unwrap_or(Uint128::zero());
    CIRCUIT_FEES.save(deps.storage, &circuit_id, &(existing + sent))?;

    Ok(Response::new()
        .add_attribute("action", "deposit_fee")
        .add_attribute("circuit_id", circuit_id)
        .add_attribute("amount", sent.to_string()))
}

fn execute_update_split(
    deps: DepsMut,
    info: MessageInfo,
    new_config: SplitConfig,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    validate_split(&new_config)?;
    config.split = new_config;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new().add_attribute("action", "update_split"))
}

fn execute_update_recipient(
    deps: DepsMut,
    info: MessageInfo,
    role: String,
    address: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    let addr = deps.api.addr_validate(&address)?;
    match role.as_str() {
        "bbb" => config.bbb_address = addr,
        "lp" => config.lp_address = addr,
        "staker" => config.staker_address = addr,
        "treasury" => config.treasury_address = addr,
        "stake_pool" => config.stake_pool_address = Some(addr),
        _ => return Err(ContractError::InvalidRole { role }),
    }
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "update_recipient")
        .add_attribute("role", role))
}

fn execute_update_admin(
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

    Ok(Response::new().add_attribute("action", "update_admin"))
}

fn validate_split(split: &SplitConfig) -> Result<(), ContractError> {
    let total = split.bbb_bps + split.lp_bps + split.staker_bps + split.treasury_bps;
    if total != TOTAL_BPS {
        return Err(ContractError::InvalidSplit { total });
    }
    if split.fee_to_stake_bps < 1500 || split.fee_to_stake_bps > 2500 {
        return Err(ContractError::InvalidFeeToStake {
            bps: split.fee_to_stake_bps,
        });
    }
    Ok(())
}

// ─── Query ────────────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::GetConfig {} => {
            let config = CONFIG.load(deps.storage)?;
            to_json_binary(&ConfigResponse {
                admin: config.admin.to_string(),
                bbb_address: config.bbb_address.to_string(),
                lp_address: config.lp_address.to_string(),
                staker_address: config.staker_address.to_string(),
                treasury_address: config.treasury_address.to_string(),
                stake_pool_address: config
                    .stake_pool_address
                    .map(|a| a.to_string())
                    .unwrap_or_default(),
            })
        }
        QueryMsg::GetStats {} => {
            let stats = STATS.load(deps.storage)?;
            to_json_binary(&StatsResponse {
                total_collected: stats.total_collected,
                total_distributed: stats.total_distributed,
                total_bbb: stats.total_bbb,
                total_lp: stats.total_lp,
                total_staker: stats.total_staker,
                total_treasury: stats.total_treasury,
                total_fee_to_stake: stats.total_fee_to_stake,
            })
        }
        QueryMsg::GetSplit {} => {
            let config = CONFIG.load(deps.storage)?;
            to_json_binary(&SplitResponse {
                config: config.split,
            })
        }
        QueryMsg::GetPendingBalance {} => {
            let balance = deps
                .querier
                .query_balance(&env.contract.address, "ufuel")?;
            to_json_binary(&PendingBalanceResponse {
                amount: balance.amount,
            })
        }
    }
}
