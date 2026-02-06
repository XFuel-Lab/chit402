use cosmwasm_std::{
    entry_point, to_json_binary, BankMsg, Binary, Coin, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128,
};
use cw2::set_contract_version;
use cw20_base::ContractError as Cw20Error;
use cw20_base::contract::{
    execute_burn, execute_send, execute_transfer,
    query_balance, query_token_info, query_minter,
};
use cw20_base::allowances::{
    execute_burn_from, execute_decrease_allowance, execute_increase_allowance, execute_transfer_from,
    query_allowance,
};
use cw20_base::enumerable::query_all_accounts;
use cw20_base::state::{TokenInfo, MinterData, TOKEN_INFO, BALANCES};

use crate::error::ContractError;
use crate::msg::{ConfigResponse, ExecuteMsg, InstantiateMsg, QueryMsg, StateResponse, ZkProof};
use crate::state::{Config, State, CONFIG, STATE, PROCESSED_PROOFS, FUNDED_USERS, REVERSE_BURN_NONCES};
use crate::zk_verifier::{verify_zk_proof, generate_proof_hash};

const CONTRACT_NAME: &str = "crates.io:persistence-minter";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// Minimum XPRT to pre-fund new users (0.001 XPRT)
const MIN_XPRT_FUNDING: u128 = 1_000_000_000_000_000; // 0.001 XPRT with 18 decimals

// Revenue split percentages
const RECYCLE_PERCENTAGE: u128 = 30;
const LP_REINVEST_PERCENTAGE: u128 = 70;

/// Helper function to detect dummy addresses (all zeros, all ones, or placeholder patterns)
fn is_dummy_address(address: &str) -> bool {
    // Check for common dummy patterns
    if address.contains("000000000000") || address.contains("111111111111") {
        return true;
    }
    // Check for placeholder names (case-insensitive)
    let lower = address.to_lowercase();
    if lower.contains("dummy") || lower.contains("placeholder") || lower.contains("temp") {
        return true;
    }
    false
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    // Validate symbol is IBCTFUEL
    if msg.symbol != "IBCTFUEL" {
        return Err(ContractError::CustomError {
            val: "Symbol must be IBCTFUEL".to_string(),
        });
    }

    // Validate decimals is 18
    if msg.decimals != 18 {
        return Err(ContractError::CustomError {
            val: "Decimals must be 18".to_string(),
        });
    }

    // Initialize CW20 base contract
    let token_info = TokenInfo {
        name: msg.name,
        symbol: msg.symbol,
        decimals: msg.decimals,
        total_supply: Uint128::zero(),
        mint: Some(MinterData {
            minter: env.contract.address.clone(),
            cap: msg.mint_cap,
        }),
    };
    TOKEN_INFO.save(deps.storage, &token_info)?;

    // Set initial balances
    for balance in msg.initial_balances {
        let addr = deps.api.addr_validate(&balance.address)?;
        BALANCES.save(deps.storage, &addr, &balance.amount)?;
    }

    // Initialize XFuel-specific config
    let verifier_addr = deps.api.addr_validate(&msg.verifier_address)?;
    let rev_splitter_addr = deps.api.addr_validate(&msg.rev_splitter_address)?;
    let fee_collector_addr = deps.api.addr_validate(&msg.fee_collector_address)?;

    let config = Config {
        admin: info.sender.clone(),
        verifier_address: verifier_addr,
        rev_splitter_address: rev_splitter_addr,
        fee_collector_address: fee_collector_addr,
        paused: false,
        mint_cap: msg.mint_cap,
        mock_mode: msg.mock_mode.unwrap_or(false), // Default to production mode
    };
    CONFIG.save(deps.storage, &config)?;

    // Initialize state
    let state = State::default();
    STATE.save(deps.storage, &state)?;

    let mut response = Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", info.sender)
        .add_attribute("token_name", token_info.name)
        .add_attribute("token_symbol", token_info.symbol)
        .add_attribute("mock_mode", config.mock_mode.to_string());

    // Warn if using dummy addresses (governance prep)
    if is_dummy_address(&msg.verifier_address) {
        response = response.add_attribute("warning", "USING_DUMMY_VERIFIER_ADDRESS");
    }
    if is_dummy_address(&msg.rev_splitter_address) {
        response = response.add_attribute("warning", "USING_DUMMY_REV_SPLITTER_ADDRESS");
    }
    if is_dummy_address(&msg.fee_collector_address) {
        response = response.add_attribute("warning", "USING_DUMMY_FEE_COLLECTOR_ADDRESS");
    }

    Ok(response)
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        // CW20 standard execute messages
        ExecuteMsg::Transfer { recipient, amount } => {
            execute_transfer(deps, env, info, recipient, amount).map_err(|e| e.into())
        }
        ExecuteMsg::Burn { amount } => {
            execute_burn(deps, env, info, amount).map_err(|e| e.into())
        }
        ExecuteMsg::Send { contract, amount, msg } => {
            execute_send(deps, env, info, contract, amount, msg).map_err(|e| e.into())
        }
        ExecuteMsg::IncreaseAllowance { spender, amount, expires } => {
            execute_increase_allowance(deps, env, info, spender, amount, expires).map_err(|e| e.into())
        }
        ExecuteMsg::DecreaseAllowance { spender, amount, expires } => {
            execute_decrease_allowance(deps, env, info, spender, amount, expires).map_err(|e| e.into())
        }
        ExecuteMsg::TransferFrom { owner, recipient, amount } => {
            execute_transfer_from(deps, env, info, owner, recipient, amount).map_err(|e| e.into())
        }
        ExecuteMsg::BurnFrom { owner, amount } => {
            execute_burn_from(deps, env, info, owner, amount).map_err(|e| e.into())
        }
        
        // XFuel-specific execute messages
        ExecuteMsg::VerifyAndMint { zk_proof, amount, recipient } => {
            execute_verify_and_mint(deps, env, info, zk_proof, amount, recipient)
        }
        ExecuteMsg::BurnAndUnwrap { amount } => {
            execute_burn_and_unwrap(deps, env, info, amount)
        }
        ExecuteMsg::BurnForUnwrap { amount, theta_recipient } => {
            execute_burn_for_unwrap(deps, env, info, amount, theta_recipient)
        }
        ExecuteMsg::SetVerifier { verifier_address } => {
            execute_set_verifier(deps, info, verifier_address)
        }
        ExecuteMsg::SetRevSplitter { rev_splitter_address } => {
            execute_set_rev_splitter(deps, info, rev_splitter_address)
        }
        ExecuteMsg::SetFeeCollector { fee_collector_address } => {
            execute_set_fee_collector(deps, info, fee_collector_address)
        }
        ExecuteMsg::SetMinter { minter_address } => {
            execute_set_minter(deps, info, minter_address)
        }
        ExecuteMsg::Pause {} => execute_pause(deps, info),
        ExecuteMsg::Unpause {} => execute_unpause(deps, info),
        // DelegateToValidator temporarily disabled - requires staking feature
        /*
        ExecuteMsg::DelegateToValidator { validator, amount } => {
            execute_delegate(deps, env, info, validator, amount)
        }
        */
    }
}

pub fn execute_verify_and_mint(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    zk_proof: ZkProof,
    amount: Uint128,
    recipient: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Check if contract is paused
    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Validate amount
    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    // Validate recipient
    let recipient_addr = deps.api.addr_validate(&recipient)?;

    // Check mint cap
    if let Some(cap) = config.mint_cap {
        if state.total_minted + amount > cap {
            return Err(ContractError::MintCapExceeded {});
        }
    }

    // Generate proof hash
    let proof_hash = generate_proof_hash(&zk_proof);

    // Check if proof was already processed (prevent replay attacks)
    if PROCESSED_PROOFS.may_load(deps.storage, &proof_hash)?.unwrap_or(false) {
        return Err(ContractError::CustomError {
            val: "Proof already processed".to_string(),
        });
    }

    // Verify ZK proof (skip if mock_mode enabled)
    if config.mock_mode {
        // MOCK MODE: Skip ZK verification for governance testing
        deps.api.debug("⚠️ MOCK MODE: Skipping ZK proof verification");
    } else {
        // PRODUCTION MODE: Full ZK verification
        let is_valid = verify_zk_proof(&zk_proof, amount, &recipient)?;
        if !is_valid {
            return Err(ContractError::InvalidProof {});
        }
    }

    // Mark proof as processed
    PROCESSED_PROOFS.save(deps.storage, &proof_hash, &true)?;

    // Mint tokens to recipient
    let mut token_info = TOKEN_INFO.load(deps.storage)?;
    token_info.total_supply += amount;
    TOKEN_INFO.save(deps.storage, &token_info)?;

    let balance = BALANCES.may_load(deps.storage, &recipient_addr)?.unwrap_or_default();
    BALANCES.save(deps.storage, &recipient_addr, &(balance + amount))?;

    // Update state
    state.total_minted += amount;
    STATE.save(deps.storage, &state)?;

    let mut response = Response::new()
        .add_attribute("action", "verify_and_mint")
        .add_attribute("recipient", &recipient)
        .add_attribute("amount", amount.to_string())
        .add_attribute("proof_hash", &proof_hash)
        .add_attribute("contract", env.contract.address.to_string())
        .add_attribute("timestamp", env.block.time.to_string());

    // Add mock mode indicator if active
    if config.mock_mode {
        response = response.add_attribute("mock_mode", "true")
            .add_attribute("warning", "ZK_VERIFICATION_SKIPPED");
    }

    // Check if user needs initial XPRT funding (for new Keplr users)
    let is_funded = FUNDED_USERS.may_load(deps.storage, &recipient_addr)?.unwrap_or(false);
    if !is_funded {
        // Pre-fund with 0.001 XPRT for gas fees
        let funding_msg = BankMsg::Send {
            to_address: recipient.clone(),
            amount: vec![Coin {
                denom: "uxprt".to_string(), // Persistence native token
                amount: Uint128::from(MIN_XPRT_FUNDING),
            }],
        };

        // Mark user as funded
        FUNDED_USERS.save(deps.storage, &recipient_addr, &true)?;

        response = response
            .add_message(funding_msg)
            .add_attribute("initial_xprt_funded", "true")
            .add_attribute("xprt_amount", MIN_XPRT_FUNDING.to_string());
    }

    // Note: LST staking delegation is handled post-mint by the backend
    // The minted ibcTFUEL is then swapped for target LST and delegated
    // This allows flexible routing based on yield optimization strategies

    Ok(response)
}

pub fn execute_burn_and_unwrap(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // Check if contract is paused
    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Validate amount
    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    // Burn tokens from sender
    let balance = BALANCES.may_load(deps.storage, &info.sender)?.unwrap_or_default();
    if balance < amount {
        return Err(ContractError::InsufficientBalance {});
    }

    BALANCES.save(deps.storage, &info.sender, &(balance - amount))?;

    let mut token_info = TOKEN_INFO.load(deps.storage)?;
    token_info.total_supply = token_info.total_supply.checked_sub(amount)?;
    TOKEN_INFO.save(deps.storage, &token_info)?;

    // Calculate revenue split
    let recycled_amount = amount.multiply_ratio(RECYCLE_PERCENTAGE, 100u128);
    let lp_reinvest_amount = amount.multiply_ratio(LP_REINVEST_PERCENTAGE, 100u128);

    // Update state
    state.total_burned += amount;
    state.total_recycled += recycled_amount;
    state.total_lp_reinvest += lp_reinvest_amount;
    STATE.save(deps.storage, &state)?;

    // Emit event for backend to process unwrap
    // Backend will:
    // 1. Send 30% to RevSplitter contract
    // 2. Flag 70% for LP reinvestment
    let response = Response::new()
        .add_attribute("action", "burn_and_unwrap")
        .add_attribute("burner", info.sender.to_string())
        .add_attribute("amount", amount.to_string())
        .add_attribute("recycled_amount", recycled_amount.to_string())
        .add_attribute("lp_reinvest_amount", lp_reinvest_amount.to_string())
        .add_attribute("rev_splitter", config.rev_splitter_address.to_string());

    Ok(response)
}

/// User-initiated reverse bridge: Burns ibcTFUEL to unwrap TFUEL on Theta chain
/// Calculates 0.5% fee, sends to FeeCollector via CW20 Send hook, burns remaining 99.5%
/// Emits BurnForUnwrap event with theta_recipient and nonce for SP1 proof
pub fn execute_burn_for_unwrap(
    mut deps: DepsMut,
    env: Env,
    info: MessageInfo,
    amount: Uint128,
    theta_recipient: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    let mut state = STATE.load(deps.storage)?;

    // 1. Validate: paused, amount, theta_recipient, balance
    if config.paused {
        return Err(ContractError::Paused {});
    }

    if amount.is_zero() {
        return Err(ContractError::InvalidAmount {});
    }

    // Validate theta_recipient (Ethereum address: 0x + 40 hex chars)
    if theta_recipient.len() != 42 || !theta_recipient.starts_with("0x") {
        return Err(ContractError::CustomError {
            val: "Invalid Theta address format (must be 0x + 40 hex chars)".to_string(),
        });
    }

    // Check user has sufficient balance
    let balance = BALANCES.may_load(deps.storage, &info.sender)?.unwrap_or_default();
    if balance < amount {
        return Err(ContractError::InsufficientBalance {});
    }

    // 2. Calculate fee (0.5%) and burn amount (99.5%)
    let fee_amount = amount.multiply_ratio(50u128, 10000u128);
    let burn_amount = amount.checked_sub(fee_amount)?;

    // 3. Get/update nonce for replay protection
    let nonce = REVERSE_BURN_NONCES
        .may_load(deps.storage, &info.sender)?
        .unwrap_or(0);
    let next_nonce = nonce + 1;
    REVERSE_BURN_NONCES.save(deps.storage, &info.sender, &next_nonce)?;

    // 4. Update state tracking
    state.total_reverse_burned = state.total_reverse_burned.checked_add(burn_amount)?;
    state.total_reverse_fees = state.total_reverse_fees.checked_add(fee_amount)?;
    STATE.save(deps.storage, &state)?;

    // 5. Send fee from USER → FeeCollector using CW20 Send (triggers Receive hook)
    // Use execute_send which handles the CW20 Send pattern correctly
    let send_response = execute_send(
        deps.branch(),
        env.clone(),
        info.clone(),
        config.fee_collector_address.to_string(),
        fee_amount,
        Binary::default(),
    )?;

    // 6. Burn from USER using execute_burn
    // This correctly burns from info.sender (the user)
    let burn_response = execute_burn(
        deps.branch(),
        env.clone(),
        info.clone(),
        burn_amount,
    )?;

    // 7. Build response combining both operations plus custom attributes
    let mut response = Response::new()
        .add_submessages(send_response.messages)
        .add_submessages(burn_response.messages)
        .add_attributes(send_response.attributes)
        .add_attributes(burn_response.attributes)
        .add_attribute("action", "burn_for_unwrap")
        .add_attribute("user", info.sender.to_string())
        .add_attribute("amount_burned", burn_amount.to_string())
        .add_attribute("fee_amount", fee_amount.to_string())
        .add_attribute("theta_recipient", theta_recipient)
        .add_attribute("nonce", next_nonce.to_string())
        .add_attribute("block_height", env.block.height.to_string())
        .add_attribute("timestamp", env.block.time.seconds().to_string())
        .add_attribute("chain_id", "core-1") // Persistence mainnet
        // Critical attribute for SP1 proof generation
        .add_attribute("for_sp1_proof", "burn_for_unwrap");

    // Add mock mode indicator if active
    if config.mock_mode {
        response = response
            .add_attribute("mock_mode", "true")
            .add_attribute("mock_sp1_event", "burn_for_unwrap")
            .add_attribute("warning", "SP1_PROOF_NOT_REQUIRED_IN_MOCK_MODE");
    }

    Ok(response)
}

pub fn execute_set_verifier(
    deps: DepsMut,
    info: MessageInfo,
    verifier_address: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    // Only admin can set verifier
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let verifier_addr = deps.api.addr_validate(&verifier_address)?;
    config.verifier_address = verifier_addr;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_verifier")
        .add_attribute("verifier", verifier_address))
}

pub fn execute_set_rev_splitter(
    deps: DepsMut,
    info: MessageInfo,
    rev_splitter_address: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    // Only admin can set rev splitter
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let rev_splitter_addr = deps.api.addr_validate(&rev_splitter_address)?;
    config.rev_splitter_address = rev_splitter_addr;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_rev_splitter")
        .add_attribute("rev_splitter", rev_splitter_address))
}

pub fn execute_set_fee_collector(
    deps: DepsMut,
    info: MessageInfo,
    fee_collector_address: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    // Only admin can set fee collector
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    let fee_collector_addr = deps.api.addr_validate(&fee_collector_address)?;
    config.fee_collector_address = fee_collector_addr;
    CONFIG.save(deps.storage, &config)?;

    let mut response = Response::new()
        .add_attribute("action", "set_fee_collector")
        .add_attribute("fee_collector", fee_collector_address);

    // Warn if setting dummy address
    if is_dummy_address(&fee_collector_address.to_string()) {
        response = response.add_attribute("warning", "USING_DUMMY_FEE_COLLECTOR_ADDRESS");
    }

    Ok(response)
}

pub fn execute_set_minter(
    deps: DepsMut,
    info: MessageInfo,
    minter_address: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Only admin can set minter
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Update the minter in TOKEN_INFO
    let mut token_info = TOKEN_INFO.load(deps.storage)?;
    let minter_addr = deps.api.addr_validate(&minter_address)?;
    
    if let Some(ref mut minter_data) = token_info.mint {
        minter_data.minter = minter_addr;
        TOKEN_INFO.save(deps.storage, &token_info)?;
    } else {
        return Err(ContractError::CustomError {
            val: "Token has no minter configured".to_string(),
        });
    }

    let mut response = Response::new()
        .add_attribute("action", "set_minter")
        .add_attribute("minter", minter_address);

    // Warn if setting dummy address
    if is_dummy_address(&minter_address) {
        response = response.add_attribute("warning", "USING_DUMMY_MINTER_ADDRESS");
    }

    Ok(response)
}

pub fn execute_pause(deps: DepsMut, info: MessageInfo) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;

    // Only admin can pause
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

    // Only admin can unpause
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.paused = false;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "unpause")
        .add_attribute("paused", "false"))
}

// NOTE: StakingMsg requires cosmwasm-std "staking" feature
// Commented out until staking feature is enabled in dependencies
/*
pub fn execute_delegate(
    deps: DepsMut,
    _env: Env,
    info: MessageInfo,
    validator: String,
    amount: Uint128,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;

    // Only admin can delegate
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    // Validate validator address
    deps.api.addr_validate(&validator)?;

    // Create staking delegation message
    let delegate_msg = StakingMsg::Delegate {
        validator: validator.clone(),
        amount: Coin {
            denom: "uxprt".to_string(),
            amount,
        },
    };

    Ok(Response::new()
        .add_message(delegate_msg)
        .add_attribute("action", "delegate_to_validator")
        .add_attribute("validator", validator)
        .add_attribute("amount", amount.to_string()))
}
*/

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        // CW20 standard queries
        QueryMsg::Balance { address } => {
            to_json_binary(&query_balance(deps, address)?)
        }
        QueryMsg::TokenInfo {} => {
            to_json_binary(&query_token_info(deps)?)
        }
        QueryMsg::Minter {} => {
            to_json_binary(&query_minter(deps)?)
        }
        QueryMsg::Allowance { owner, spender } => {
            to_json_binary(&query_allowance(deps, owner, spender)?)
        }
        QueryMsg::AllAccounts { start_after, limit } => {
            to_json_binary(&query_all_accounts(deps, start_after, limit)?)
        }
        
        // XFuel-specific queries
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::State {} => to_json_binary(&query_state(deps)?),
    }
}

pub fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        verifier_address: config.verifier_address,
        rev_splitter_address: config.rev_splitter_address,
        fee_collector_address: config.fee_collector_address,
        paused: config.paused,
        admin: config.admin,
        mock_mode: config.mock_mode,
    })
}

pub fn query_state(deps: Deps) -> StdResult<StateResponse> {
    let state = STATE.load(deps.storage)?;
    Ok(StateResponse {
        total_minted: state.total_minted,
        total_burned: state.total_burned,
        total_recycled: state.total_recycled,
        total_lp_reinvest: state.total_lp_reinvest,
        total_reverse_burned: state.total_reverse_burned,
        total_reverse_fees: state.total_reverse_fees,
    })
}

// Implement From trait to convert Cw20Error to ContractError
impl From<Cw20Error> for ContractError {
    fn from(err: Cw20Error) -> Self {
        match err {
            Cw20Error::Std(e) => ContractError::Std(e),
            Cw20Error::Unauthorized {} => ContractError::Unauthorized {},
            _ => ContractError::CustomError {
                val: err.to_string(),
            },
        }
    }
}

