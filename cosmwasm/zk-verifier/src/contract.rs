use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
    StdError, Addr,
};
use cw2::set_contract_version;

use crate::msg::{ExecuteMsg, InstantiateMsg, QueryMsg, ConfigResponse, ProofStatusResponse, StatsResponse, ZkProof};
use crate::state::{Config, ProofRecord, CONFIG, PROOF_RECORDS};
use crate::error::ContractError;

const CONTRACT_NAME: &str = "crates.io:zk-verifier";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let admin = msg.admin
        .map(|a| deps.api.addr_validate(&a))
        .transpose()?
        .unwrap_or(info.sender.clone());

    let minter_contract = msg.minter_contract
        .map(|m| deps.api.addr_validate(&m))
        .transpose()?;

    let config = Config {
        admin,
        minter_contract,
        total_verifications: 0,
    };

    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("method", "instantiate")
        .add_attribute("admin", config.admin)
        .add_attribute("contract", env.contract.address))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    match msg {
        ExecuteMsg::VerifyProof { proof, public_inputs, theta_tx_hash, nonce } => {
            execute_verify_proof(deps, env, info, proof, public_inputs, theta_tx_hash, nonce)
        }
        ExecuteMsg::UpdateAdmin { admin } => execute_update_admin(deps, info, admin),
        ExecuteMsg::SetMinterContract { minter } => execute_set_minter(deps, info, minter),
    }
}

pub fn execute_verify_proof(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    proof: ZkProof,
    public_inputs: Vec<String>,
    theta_tx_hash: String,
    nonce: u64,
) -> Result<Response, ContractError> {
    // Check if proof already used (replay protection)
    if PROOF_RECORDS.may_load(deps.storage, &theta_tx_hash)?.is_some() {
        return Err(ContractError::ProofAlreadyUsed {});
    }

    // Verify the proof (MOCK IMPLEMENTATION - replace with ark-groth16 later)
    let proof_valid = verify_groth16_mock(&proof, &public_inputs)?;
    if !proof_valid {
        return Err(ContractError::InvalidProof {});
    }

    // Save proof record
    let record = ProofRecord {
        theta_tx_hash: theta_tx_hash.clone(),
        nonce,
        verified_at: env.block.time.seconds(),
        public_inputs: public_inputs.clone(),
    };
    PROOF_RECORDS.save(deps.storage, &theta_tx_hash, &record)?;

    // Update stats
    CONFIG.update(deps.storage, |mut config| -> StdResult<_> {
        config.total_verifications += 1;
        Ok(config)
    })?;

    Ok(Response::new()
        .add_attribute("method", "verify_proof")
        .add_attribute("theta_tx_hash", theta_tx_hash)
        .add_attribute("nonce", nonce.to_string())
        .add_attribute("verified_by", info.sender)
        .add_attribute("proof_valid", "true"))
}

/// MOCK Groth16 verification - replace with ark-groth16 for production
fn verify_groth16_mock(proof: &ZkProof, public_inputs: &[String]) -> Result<bool, ContractError> {
    // Basic validation checks
    if proof.a.len() != 2 {
        return Err(ContractError::InvalidProofFormat { msg: "Invalid point A".to_string() });
    }
    if proof.b.len() != 2 || proof.b[0].len() != 2 || proof.b[1].len() != 2 {
        return Err(ContractError::InvalidProofFormat { msg: "Invalid point B".to_string() });
    }
    if proof.c.len() != 2 {
        return Err(ContractError::InvalidProofFormat { msg: "Invalid point C".to_string() });
    }
    if public_inputs.is_empty() {
        return Err(ContractError::InvalidProofFormat { msg: "No public inputs".to_string() });
    }

    // MOCK: For testing, accept any well-formed proof
    // TODO: Replace with actual ark-groth16 pairing check:
    // e(A, B) == e(alpha, beta) * e(C, delta) * e(pub_inputs, gamma)
    
    Ok(true)
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

pub fn execute_set_minter(
    deps: DepsMut,
    info: MessageInfo,
    minter: String,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    config.minter_contract = Some(deps.api.addr_validate(&minter)?);
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("method", "set_minter")
        .add_attribute("minter", minter))
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::Config {} => to_json_binary(&query_config(deps)?),
        QueryMsg::ProofStatus { theta_tx_hash } => to_json_binary(&query_proof_status(deps, theta_tx_hash)?),
        QueryMsg::Stats {} => to_json_binary(&query_stats(deps)?),
    }
}

fn query_config(deps: Deps) -> StdResult<ConfigResponse> {
    let config = CONFIG.load(deps.storage)?;
    Ok(ConfigResponse {
        admin: config.admin,
        minter_contract: config.minter_contract,
        total_verifications: config.total_verifications,
    })
}

fn query_proof_status(deps: Deps, theta_tx_hash: String) -> StdResult<ProofStatusResponse> {
    let record = PROOF_RECORDS.may_load(deps.storage, &theta_tx_hash)?;
    
    Ok(ProofStatusResponse {
        theta_tx_hash: theta_tx_hash.clone(),
        used: record.is_some(),
        verified_at: record.map(|r| r.verified_at),
    })
}

fn query_stats(deps: Deps) -> StdResult<StatsResponse> {
    let config = CONFIG.load(deps.storage)?;
    
    // Count unique transactions
    let unique_count: u64 = PROOF_RECORDS
        .range(deps.storage, None, None, cosmwasm_std::Order::Ascending)
        .count() as u64;
    
    Ok(StatsResponse {
        total_verifications: config.total_verifications,
        unique_transactions: unique_count,
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
            minter_contract: None,
        };
        let info = mock_info("creator", &[]);
        let res = instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();
        assert_eq!(0, res.messages.len());
    }

    #[test]
    fn verify_proof_success() {
        let mut deps = mock_dependencies();
        let msg = InstantiateMsg {
            admin: None,
            minter_contract: None,
        };
        let info = mock_info("creator", &[]);
        instantiate(deps.as_mut(), mock_env(), info.clone(), msg).unwrap();

        // Mock proof
        let proof = ZkProof {
            a: vec!["0x123".to_string(), "0x456".to_string()],
            b: vec![
                vec!["0x789".to_string(), "0xabc".to_string()],
                vec!["0xdef".to_string(), "0x012".to_string()],
            ],
            c: vec!["0x345".to_string(), "0x678".to_string()],
        };

        let msg = ExecuteMsg::VerifyProof {
            proof,
            public_inputs: vec!["100000000000000000".to_string()], // 0.1 TFUEL in wei
            theta_tx_hash: "0xabcdef123456".to_string(),
            nonce: 1,
        };

        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();
        assert_eq!(res.attributes.len(), 5);
    }
}

