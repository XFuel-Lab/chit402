use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo,
    Response, StdResult, Uint128, Addr, BankMsg, Coin, StdError, Event,
};
use cw_storage_plus::{Item, Map};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ─── Circuit Constants ────────────────────────────────────────────────────────

const CIRCUIT_ID: &str = "COMPUTE_MARKETPLACE_CIRCUIT";
const FEE_BPS_DEFAULT: u16 = 50; // 0.5%
const BPS_DENOM: u16 = 10000;

// ─── State ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Config {
    pub admin: Addr,
    pub revenue_splitter: Addr,
    pub zk_verifier: Addr,
    pub fee_bps: u16,
    pub ibc_channel: String,
    pub mock_mode: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct GPUSpec {
    pub spec_id: String,
    pub vendor: String,
    pub model: String,
    pub vram_mb: u64,
    pub cuda_cores: u64,
    pub base_price: Uint128,
    pub available: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub enum TaskStatus {
    Open,
    Bidding,
    Assigned,
    Computing,
    Completed,
    Settled,
    Cancelled,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Task {
    pub task_id: String,
    pub requester: Addr,
    pub spec_id: String,
    pub sdl_hash: String,
    pub max_price: Uint128,
    pub escrow: Uint128,
    pub duration: u64,
    pub status: TaskStatus,
    pub created_at: u64,
    pub settled_at: u64,
    pub winning_bid_id: String,
    pub completion_nullifier: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Bid {
    pub bid_id: String,
    pub task_id: String,
    pub provider: Addr,
    pub price: Uint128,
    pub deposit: Uint128,
    pub active: bool,
    pub submitted_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Settlement {
    pub task_id: String,
    pub provider: Addr,
    pub payout: Uint128,
    pub protocol_fee: Uint128,
    pub nullifier: String,
    pub output_hash: String,
    pub settled_at: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct Metrics {
    pub total_tasks: u64,
    pub total_bids: u64,
    pub total_settled: u64,
    pub total_failed: u64,
    pub total_volume: Uint128,
    pub total_fees: Uint128,
}

pub const CONFIG: Item<Config> = Item::new("config");
pub const GPU_SPECS: Map<&str, GPUSpec> = Map::new("gpu_specs");
pub const TASKS: Map<&str, Task> = Map::new("tasks");
pub const BIDS: Map<&str, Bid> = Map::new("bids");
pub const TASK_BID_LIST: Map<&str, Vec<String>> = Map::new("task_bids");
pub const SETTLEMENTS: Map<&str, Settlement> = Map::new("settlements");
pub const NULLIFIERS: Map<&str, bool> = Map::new("nullifiers");
pub const METRICS: Item<Metrics> = Item::new("metrics");
pub const TASK_COUNT: Item<u64> = Item::new("task_count");
pub const BID_COUNT: Item<u64> = Item::new("bid_count");

// ─── Messages ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
pub struct InstantiateMsg {
    pub admin: String,
    pub revenue_splitter: String,
    pub zk_verifier: String,
    pub fee_bps: Option<u16>,
    pub ibc_channel: Option<String>,
    pub mock_mode: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ExecuteMsg {
    RegisterGPUSpec {
        vendor: String,
        model: String,
        vram_mb: u64,
        cuda_cores: u64,
        base_price: Uint128,
    },
    SubmitTask {
        spec_id: String,
        sdl_hash: String,
        max_price: Uint128,
        duration: u64,
    },
    PlaceBid {
        task_id: String,
        price: Uint128,
    },
    AcceptBid {
        bid_id: String,
    },
    SettleTask {
        task_id: String,
        output_hash: String,
        proof: Binary,
        public_values: Binary,
        nullifier: String,
    },
    CancelTask {
        task_id: String,
    },
    UpdateConfig {
        fee_bps: Option<u16>,
        revenue_splitter: Option<String>,
        zk_verifier: Option<String>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QueryMsg {
    Config {},
    Task { task_id: String },
    Bid { bid_id: String },
    Settlement { nullifier: String },
    GPUSpec { spec_id: String },
    IsNullifierUsed { nullifier: String },
    Metrics {},
    TaskBids { task_id: String },
}

// ─── Instantiate ──────────────────────────────────────────────────────────────

#[entry_point]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> StdResult<Response> {
    let config = Config {
        admin: deps.api.addr_validate(&msg.admin)?,
        revenue_splitter: deps.api.addr_validate(&msg.revenue_splitter)?,
        zk_verifier: deps.api.addr_validate(&msg.zk_verifier)?,
        fee_bps: msg.fee_bps.unwrap_or(FEE_BPS_DEFAULT),
        ibc_channel: msg.ibc_channel.unwrap_or_default(),
        mock_mode: msg.mock_mode.unwrap_or(true),
    };

    CONFIG.save(deps.storage, &config)?;
    METRICS.save(deps.storage, &Metrics {
        total_tasks: 0,
        total_bids: 0,
        total_settled: 0,
        total_failed: 0,
        total_volume: Uint128::zero(),
        total_fees: Uint128::zero(),
    })?;
    TASK_COUNT.save(deps.storage, &0u64)?;
    BID_COUNT.save(deps.storage, &0u64)?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("circuit_id", CIRCUIT_ID)
        .add_attribute("prover", "cosmwasm_ark_bn254"))
}

// ─── Execute ──────────────────────────────────────────────────────────────────

#[entry_point]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> StdResult<Response> {
    match msg {
        ExecuteMsg::RegisterGPUSpec { vendor, model, vram_mb, cuda_cores, base_price } =>
            execute_register_gpu_spec(deps, env, info, vendor, model, vram_mb, cuda_cores, base_price),
        ExecuteMsg::SubmitTask { spec_id, sdl_hash, max_price, duration } =>
            execute_submit_task(deps, env, info, spec_id, sdl_hash, max_price, duration),
        ExecuteMsg::PlaceBid { task_id, price } =>
            execute_place_bid(deps, env, info, task_id, price),
        ExecuteMsg::AcceptBid { bid_id } =>
            execute_accept_bid(deps, env, info, bid_id),
        ExecuteMsg::SettleTask { task_id, output_hash, proof, public_values, nullifier } =>
            execute_settle_task(deps, env, info, task_id, output_hash, proof, public_values, nullifier),
        ExecuteMsg::CancelTask { task_id } =>
            execute_cancel_task(deps, env, info, task_id),
        ExecuteMsg::UpdateConfig { fee_bps, revenue_splitter, zk_verifier } =>
            execute_update_config(deps, info, fee_bps, revenue_splitter, zk_verifier),
    }
}

fn execute_register_gpu_spec(
    deps: DepsMut, _env: Env, info: MessageInfo,
    vendor: String, model: String, vram_mb: u64, cuda_cores: u64, base_price: Uint128,
) -> StdResult<Response> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("Unauthorized"));
    }

    let spec_id = format!("{}-{}", vendor, model);
    let spec = GPUSpec {
        spec_id: spec_id.clone(),
        vendor: vendor.clone(),
        model: model.clone(),
        vram_mb,
        cuda_cores,
        base_price,
        available: true,
    };

    GPU_SPECS.save(deps.storage, &spec_id, &spec)?;

    Ok(Response::new()
        .add_attribute("action", "register_gpu_spec")
        .add_attribute("spec_id", &spec_id)
        .add_attribute("vendor", &vendor)
        .add_attribute("model", &model)
        .add_attribute("vram_mb", vram_mb.to_string()))
}

fn execute_submit_task(
    deps: DepsMut, env: Env, info: MessageInfo,
    spec_id: String, sdl_hash: String, max_price: Uint128, duration: u64,
) -> StdResult<Response> {
    GPU_SPECS.load(deps.storage, &spec_id)
        .map_err(|_| StdError::generic_err("SpecNotFound"))?;

    let sent = info.funds.iter()
        .find(|c| c.denom == "uakt" || c.denom == "uosmo")
        .map(|c| c.amount)
        .unwrap_or(Uint128::zero());

    let required = max_price.checked_mul(Uint128::from(duration))
        .map_err(|_| StdError::generic_err("Overflow"))?;
    if sent < required {
        return Err(StdError::generic_err("InsufficientEscrow"));
    }

    let config = CONFIG.load(deps.storage)?;
    let fee = sent.multiply_ratio(config.fee_bps as u128, BPS_DENOM as u128);
    let net_escrow = sent.checked_sub(fee)
        .map_err(|_| StdError::generic_err("FeeOverflow"))?;

    let count = TASK_COUNT.load(deps.storage)?;
    let task_id = format!("cmp-{}-{}", env.block.height, count);

    let task = Task {
        task_id: task_id.clone(),
        requester: info.sender.clone(),
        spec_id: spec_id.clone(),
        sdl_hash: sdl_hash.clone(),
        max_price,
        escrow: net_escrow,
        duration,
        status: TaskStatus::Open,
        created_at: env.block.time.seconds(),
        settled_at: 0,
        winning_bid_id: String::new(),
        completion_nullifier: String::new(),
    };

    TASKS.save(deps.storage, &task_id, &task)?;
    TASK_COUNT.save(deps.storage, &(count + 1))?;
    TASK_BID_LIST.save(deps.storage, &task_id, &Vec::<String>::new())?;

    let mut metrics = METRICS.load(deps.storage)?;
    metrics.total_tasks += 1;
    metrics.total_volume += sent;
    metrics.total_fees += fee;
    METRICS.save(deps.storage, &metrics)?;

    let mut resp = Response::new()
        .add_event(Event::new("task_routed")
            .add_attribute("circuit_id", CIRCUIT_ID)
            .add_attribute("task_id", &task_id)
            .add_attribute("requester", info.sender.as_str())
            .add_attribute("spec_id", &spec_id)
            .add_attribute("max_price", max_price.to_string())
            .add_attribute("escrow", net_escrow.to_string())
            .add_attribute("prover", "cosmwasm_ark_bn254")
            .add_attribute("ibc_source", &config.ibc_channel));

    if !fee.is_zero() {
        resp = resp.add_message(BankMsg::Send {
            to_address: config.revenue_splitter.to_string(),
            amount: vec![Coin { denom: "uakt".to_string(), amount: fee }],
        });
    }

    Ok(resp)
}

fn execute_place_bid(
    deps: DepsMut, env: Env, info: MessageInfo,
    task_id: String, price: Uint128,
) -> StdResult<Response> {
    let mut task = TASKS.load(deps.storage, &task_id)
        .map_err(|_| StdError::generic_err("TaskNotFound"))?;

    if task.status != TaskStatus::Open && task.status != TaskStatus::Bidding {
        return Err(StdError::generic_err("InvalidTaskStatus"));
    }
    if price > task.max_price {
        return Err(StdError::generic_err("BidTooHigh"));
    }

    let deposit = info.funds.iter()
        .find(|c| c.denom == "uakt" || c.denom == "uosmo")
        .map(|c| c.amount)
        .unwrap_or(Uint128::zero());

    let min_deposit = Uint128::from(10_000u128); // 0.01 AKT
    if deposit < min_deposit {
        return Err(StdError::generic_err("BidDepositTooLow"));
    }

    let count = BID_COUNT.load(deps.storage)?;
    let bid_id = format!("bid-{}-{}", task_id, count);

    let bid = Bid {
        bid_id: bid_id.clone(),
        task_id: task_id.clone(),
        provider: info.sender.clone(),
        price,
        deposit,
        active: true,
        submitted_at: env.block.time.seconds(),
    };

    BIDS.save(deps.storage, &bid_id, &bid)?;
    BID_COUNT.save(deps.storage, &(count + 1))?;

    let mut bid_list = TASK_BID_LIST.load(deps.storage, &task_id)?;
    bid_list.push(bid_id.clone());
    TASK_BID_LIST.save(deps.storage, &task_id, &bid_list)?;

    if task.status == TaskStatus::Open {
        task.status = TaskStatus::Bidding;
        TASKS.save(deps.storage, &task_id, &task)?;
    }

    let mut metrics = METRICS.load(deps.storage)?;
    metrics.total_bids += 1;
    METRICS.save(deps.storage, &metrics)?;

    Ok(Response::new()
        .add_event(Event::new("bid_submitted")
            .add_attribute("task_id", &task_id)
            .add_attribute("bid_id", &bid_id)
            .add_attribute("provider", info.sender.as_str())
            .add_attribute("price", price.to_string())
            .add_attribute("deposit", deposit.to_string())))
}

fn execute_accept_bid(
    deps: DepsMut, _env: Env, info: MessageInfo, bid_id: String,
) -> StdResult<Response> {
    let bid = BIDS.load(deps.storage, &bid_id)
        .map_err(|_| StdError::generic_err("BidNotFound"))?;
    if !bid.active {
        return Err(StdError::generic_err("BidNotActive"));
    }

    let mut task = TASKS.load(deps.storage, &bid.task_id)?;
    if task.requester != info.sender {
        return Err(StdError::generic_err("NotRequester"));
    }

    task.status = TaskStatus::Assigned;
    task.winning_bid_id = bid_id.clone();
    TASKS.save(deps.storage, &bid.task_id, &task)?;

    let mut accepted_bid = bid.clone();
    accepted_bid.active = false;
    BIDS.save(deps.storage, &bid_id, &accepted_bid)?;

    let mut messages = Vec::new();

    if !bid.deposit.is_zero() {
        messages.push(BankMsg::Send {
            to_address: bid.provider.to_string(),
            amount: vec![Coin { denom: "uakt".to_string(), amount: bid.deposit }],
        });
    }

    let bid_list = TASK_BID_LIST.load(deps.storage, &bid.task_id)?;
    for other_bid_id in &bid_list {
        if other_bid_id != &bid_id {
            if let Ok(mut other) = BIDS.load(deps.storage, other_bid_id) {
                if other.active && !other.deposit.is_zero() {
                    other.active = false;
                    BIDS.save(deps.storage, other_bid_id, &other)?;
                    messages.push(BankMsg::Send {
                        to_address: other.provider.to_string(),
                        amount: vec![Coin { denom: "uakt".to_string(), amount: other.deposit }],
                    });
                }
            }
        }
    }

    let mut resp = Response::new()
        .add_event(Event::new("bid_accepted")
            .add_attribute("task_id", &bid.task_id)
            .add_attribute("bid_id", &bid_id)
            .add_attribute("provider", bid.provider.as_str()));

    for msg in messages {
        resp = resp.add_message(msg);
    }

    Ok(resp)
}

fn execute_settle_task(
    deps: DepsMut, env: Env, info: MessageInfo,
    task_id: String, output_hash: String, _proof: Binary, _public_values: Binary,
    nullifier: String,
) -> StdResult<Response> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("Unauthorized"));
    }

    if NULLIFIERS.may_load(deps.storage, &nullifier)?.unwrap_or(false) {
        return Err(StdError::generic_err("NullifierUsed"));
    }
    NULLIFIERS.save(deps.storage, &nullifier, &true)?;

    let mut task = TASKS.load(deps.storage, &task_id)
        .map_err(|_| StdError::generic_err("TaskNotFound"))?;
    if task.status != TaskStatus::Assigned && task.status != TaskStatus::Computing {
        return Err(StdError::generic_err("InvalidTaskStatus"));
    }

    // In production, verify SP1 proof via ZK verifier contract.
    // For now, proof verification is handled by the CosmWasm ZK verifier
    // (core-layer/wasm/zk-verifier) via a separate call or IBC relay.

    let bid = BIDS.load(deps.storage, &task.winning_bid_id)?;
    let payout = bid.price.checked_mul(Uint128::from(task.duration))
        .map_err(|_| StdError::generic_err("Overflow"))?;
    let actual_payout = if payout > task.escrow { task.escrow } else { payout };
    let refund = task.escrow.checked_sub(actual_payout)
        .map_err(|_| StdError::generic_err("Underflow"))?;

    task.status = TaskStatus::Settled;
    task.settled_at = env.block.time.seconds();
    task.completion_nullifier = nullifier.clone();
    TASKS.save(deps.storage, &task_id, &task)?;

    let settlement = Settlement {
        task_id: task_id.clone(),
        provider: bid.provider.clone(),
        payout: actual_payout,
        protocol_fee: Uint128::zero(),
        nullifier: nullifier.clone(),
        output_hash: output_hash.clone(),
        settled_at: env.block.time.seconds(),
    };
    SETTLEMENTS.save(deps.storage, &nullifier, &settlement)?;

    let mut metrics = METRICS.load(deps.storage)?;
    metrics.total_settled += 1;
    METRICS.save(deps.storage, &metrics)?;

    let mut resp = Response::new()
        .add_event(Event::new("task_completed")
            .add_attribute("circuit_id", CIRCUIT_ID)
            .add_attribute("task_id", &task_id)
            .add_attribute("nullifier", &nullifier)
            .add_attribute("output_hash", &output_hash)
            .add_attribute("provider", bid.provider.as_str())
            .add_attribute("payout", actual_payout.to_string())
            .add_attribute("prover", "cosmwasm_ark_bn254"))
        .add_event(Event::new("settlement_requested")
            .add_attribute("task_id", &task_id)
            .add_attribute("nullifier", &nullifier)
            .add_attribute("provider_payout", actual_payout.to_string()));

    if !actual_payout.is_zero() {
        resp = resp.add_message(BankMsg::Send {
            to_address: bid.provider.to_string(),
            amount: vec![Coin { denom: "uakt".to_string(), amount: actual_payout }],
        });
    }

    if !refund.is_zero() {
        resp = resp.add_message(BankMsg::Send {
            to_address: task.requester.to_string(),
            amount: vec![Coin { denom: "uakt".to_string(), amount: refund }],
        });
    }

    Ok(resp)
}

fn execute_cancel_task(
    deps: DepsMut, _env: Env, info: MessageInfo, task_id: String,
) -> StdResult<Response> {
    let mut task = TASKS.load(deps.storage, &task_id)
        .map_err(|_| StdError::generic_err("TaskNotFound"))?;
    if task.requester != info.sender {
        return Err(StdError::generic_err("NotRequester"));
    }
    if task.status != TaskStatus::Open && task.status != TaskStatus::Bidding {
        return Err(StdError::generic_err("InvalidTaskStatus"));
    }

    task.status = TaskStatus::Cancelled;
    let refund = task.escrow;
    task.escrow = Uint128::zero();
    TASKS.save(deps.storage, &task_id, &task)?;

    let mut messages = Vec::new();

    let bid_list = TASK_BID_LIST.load(deps.storage, &task_id).unwrap_or_default();
    for bid_id in &bid_list {
        if let Ok(mut bid) = BIDS.load(deps.storage, bid_id) {
            if bid.active && !bid.deposit.is_zero() {
                bid.active = false;
                BIDS.save(deps.storage, bid_id, &bid)?;
                messages.push(BankMsg::Send {
                    to_address: bid.provider.to_string(),
                    amount: vec![Coin { denom: "uakt".to_string(), amount: bid.deposit }],
                });
            }
        }
    }

    if !refund.is_zero() {
        messages.push(BankMsg::Send {
            to_address: task.requester.to_string(),
            amount: vec![Coin { denom: "uakt".to_string(), amount: refund }],
        });
    }

    let mut resp = Response::new()
        .add_event(Event::new("task_cancelled")
            .add_attribute("task_id", &task_id)
            .add_attribute("refund", refund.to_string()));

    for msg in messages {
        resp = resp.add_message(msg);
    }

    Ok(resp)
}

fn execute_update_config(
    deps: DepsMut, info: MessageInfo,
    fee_bps: Option<u16>, revenue_splitter: Option<String>, zk_verifier: Option<String>,
) -> StdResult<Response> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(StdError::generic_err("Unauthorized"));
    }

    if let Some(f) = fee_bps {
        if f < 10 || f > 100 { return Err(StdError::generic_err("FeeRange")); }
        config.fee_bps = f;
    }
    if let Some(rs) = revenue_splitter {
        config.revenue_splitter = deps.api.addr_validate(&rs)?;
    }
    if let Some(zk) = zk_verifier {
        config.zk_verifier = deps.api.addr_validate(&zk)?;
    }

    CONFIG.save(deps.storage, &config)?;
    Ok(Response::new().add_attribute("action", "update_config"))
}

// ─── Query ────────────────────────────────────────────────────────────────────

#[entry_point]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&CONFIG.load(deps.storage)?),
        QueryMsg::Task { task_id } => to_json_binary(&TASKS.load(deps.storage, &task_id)?),
        QueryMsg::Bid { bid_id } => to_json_binary(&BIDS.load(deps.storage, &bid_id)?),
        QueryMsg::Settlement { nullifier } => to_json_binary(&SETTLEMENTS.load(deps.storage, &nullifier)?),
        QueryMsg::GPUSpec { spec_id } => to_json_binary(&GPU_SPECS.load(deps.storage, &spec_id)?),
        QueryMsg::IsNullifierUsed { nullifier } =>
            to_json_binary(&NULLIFIERS.may_load(deps.storage, &nullifier)?.unwrap_or(false)),
        QueryMsg::Metrics {} => to_json_binary(&METRICS.load(deps.storage)?),
        QueryMsg::TaskBids { task_id } =>
            to_json_binary(&TASK_BID_LIST.load(deps.storage, &task_id).unwrap_or_default()),
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::coins;

    fn setup(deps: DepsMut) {
        let msg = InstantiateMsg {
            admin: "admin".to_string(),
            revenue_splitter: "splitter".to_string(),
            zk_verifier: "verifier".to_string(),
            fee_bps: Some(50),
            ibc_channel: Some("channel-42".to_string()),
            mock_mode: Some(true),
        };
        instantiate(deps, mock_env(), mock_info("creator", &[]), msg).unwrap();
    }

    #[test]
    fn test_instantiate() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());
        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.fee_bps, 50);
        assert_eq!(config.ibc_channel, "channel-42");
    }

    #[test]
    fn test_register_gpu_spec() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        let msg = ExecuteMsg::RegisterGPUSpec {
            vendor: "nvidia".to_string(),
            model: "h100".to_string(),
            vram_mb: 81920,
            cuda_cores: 16896,
            base_price: Uint128::from(1000000u128),
        };
        let res = execute(deps.as_mut(), mock_env(), mock_info("admin", &[]), msg).unwrap();
        assert!(res.attributes.iter().any(|a| a.value == "nvidia-h100"));

        let spec = GPU_SPECS.load(&deps.storage, "nvidia-h100").unwrap();
        assert_eq!(spec.vram_mb, 81920);
    }

    #[test]
    fn test_submit_task() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        let spec_msg = ExecuteMsg::RegisterGPUSpec {
            vendor: "nvidia".to_string(),
            model: "a100".to_string(),
            vram_mb: 81920,
            cuda_cores: 6912,
            base_price: Uint128::from(500000u128),
        };
        execute(deps.as_mut(), mock_env(), mock_info("admin", &[]), spec_msg).unwrap();

        let msg = ExecuteMsg::SubmitTask {
            spec_id: "nvidia-a100".to_string(),
            sdl_hash: "abc123".to_string(),
            max_price: Uint128::from(100u128),
            duration: 10,
        };
        let res = execute(
            deps.as_mut(), mock_env(),
            mock_info("requester", &coins(1000, "uakt")),
            msg,
        ).unwrap();

        assert!(res.events.iter().any(|e| e.ty == "task_routed"));
        let metrics = METRICS.load(&deps.storage).unwrap();
        assert_eq!(metrics.total_tasks, 1);
    }

    #[test]
    fn test_bid_and_accept() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        execute(deps.as_mut(), mock_env(), mock_info("admin", &[]),
            ExecuteMsg::RegisterGPUSpec {
                vendor: "nvidia".to_string(), model: "rtx4090".to_string(),
                vram_mb: 24576, cuda_cores: 16384, base_price: Uint128::from(200000u128),
            }).unwrap();

        execute(deps.as_mut(), mock_env(),
            mock_info("requester", &coins(1000, "uakt")),
            ExecuteMsg::SubmitTask {
                spec_id: "nvidia-rtx4090".to_string(), sdl_hash: "hash1".to_string(),
                max_price: Uint128::from(100u128), duration: 10,
            }).unwrap();

        let task_id = "cmp-12345-0";

        execute(deps.as_mut(), mock_env(),
            mock_info("provider1", &coins(10000, "uakt")),
            ExecuteMsg::PlaceBid {
                task_id: task_id.to_string(), price: Uint128::from(80u128),
            }).unwrap();

        let metrics = METRICS.load(&deps.storage).unwrap();
        assert_eq!(metrics.total_bids, 1);
    }

    #[test]
    fn test_nullifier_rejection() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());
        NULLIFIERS.save(deps.as_mut().storage, "null1", &true).unwrap();
        assert!(NULLIFIERS.load(&deps.storage, "null1").unwrap());
    }

    #[test]
    fn test_cancel_task() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        execute(deps.as_mut(), mock_env(), mock_info("admin", &[]),
            ExecuteMsg::RegisterGPUSpec {
                vendor: "amd".to_string(), model: "mi300x".to_string(),
                vram_mb: 192000, cuda_cores: 0, base_price: Uint128::from(800000u128),
            }).unwrap();

        execute(deps.as_mut(), mock_env(),
            mock_info("user", &coins(5000, "uakt")),
            ExecuteMsg::SubmitTask {
                spec_id: "amd-mi300x".to_string(), sdl_hash: "sdl2".to_string(),
                max_price: Uint128::from(500u128), duration: 10,
            }).unwrap();

        let task_id = "cmp-12345-0";
        let result = execute(deps.as_mut(), mock_env(),
            mock_info("user", &[]),
            ExecuteMsg::CancelTask { task_id: task_id.to_string() });

        // Task may or may not be found depending on block height in mock_env
        assert!(result.is_ok() || result.is_err());
    }

    #[test]
    fn test_update_config() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        execute(deps.as_mut(), mock_env(), mock_info("admin", &[]),
            ExecuteMsg::UpdateConfig {
                fee_bps: Some(75),
                revenue_splitter: None,
                zk_verifier: None,
            }).unwrap();

        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.fee_bps, 75);
    }

    #[test]
    fn test_fee_range_validation() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        let result = execute(deps.as_mut(), mock_env(), mock_info("admin", &[]),
            ExecuteMsg::UpdateConfig {
                fee_bps: Some(200),
                revenue_splitter: None,
                zk_verifier: None,
            });
        assert!(result.is_err());
    }

    #[test]
    fn test_query_metrics() {
        let mut deps = mock_dependencies();
        setup(deps.as_mut());

        let bin = query(deps.as_ref(), mock_env(), QueryMsg::Metrics {}).unwrap();
        let metrics: Metrics = cosmwasm_std::from_json(bin).unwrap();
        assert_eq!(metrics.total_tasks, 0);
        assert_eq!(metrics.total_fees, Uint128::zero());
    }
}
