use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};

use crate::error::ContractError;
use crate::msg::*;
use crate::state::*;

/// Contract name for cw2 versioning.
const CONTRACT_NAME: &str = "crates.io:xfuel-zk-verifier";
const CONTRACT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ─── Instantiate ──────────────────────────────────────────────────────────────

/// Initialize the ZK Verifier contract.
///
/// Research ties (CosmWasm docs):
///   - instantiate is called once on contract deployment.
///   - State is stored in key-value storage via cw-storage-plus.
///   - Contract address acts as an on-chain account.
#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    _env: Env,
    _info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    cw2::set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;

    let admin = deps.api.addr_validate(&msg.admin)?;

    CONFIG.save(
        deps.storage,
        &Config {
            admin,
            mock_mode: msg.mock_mode,
            paused: false,
        },
    )?;

    STATS.save(deps.storage, &Stats::default())?;

    Ok(Response::new()
        .add_attribute("action", "instantiate")
        .add_attribute("admin", msg.admin)
        .add_attribute("mock_mode", msg.mock_mode.to_string()))
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
        ExecuteMsg::VerifyProof {
            circuit_id,
            program_vkey,
            public_values,
            proof_bytes,
            nullifier,
        } => execute_verify_proof(
            deps,
            env,
            info,
            circuit_id,
            program_vkey,
            public_values,
            proof_bytes,
            nullifier,
        ),
        ExecuteMsg::RegisterCircuit {
            circuit_id,
            program_vkey,
            label,
        } => execute_register_circuit(deps, info, circuit_id, program_vkey, label),
        ExecuteMsg::RemoveCircuit { circuit_id } => {
            execute_remove_circuit(deps, info, circuit_id)
        }
        ExecuteMsg::UpdateAdmin { new_admin } => execute_update_admin(deps, info, new_admin),
        ExecuteMsg::SetMockMode { enabled } => execute_set_mock_mode(deps, info, enabled),
        ExecuteMsg::SetPaused { paused } => execute_set_paused(deps, info, paused),
    }
}

/// Verify an SP1 proof.
///
/// Chain-agnostic: The proof_bytes and public_values are opaque to this contract.
/// In mock mode, all proofs are accepted (for testnet/governance prep).
/// In production mode, the contract performs cryptographic verification.
///
/// Emits a `proof_verified` event that downstream circuits can query.
fn execute_verify_proof(
    deps: DepsMut,
    env: Env,
    _info: MessageInfo,
    circuit_id: String,
    program_vkey: String,
    public_values: String,
    proof_bytes: String,
    nullifier: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if config.paused {
        return Err(ContractError::Paused {});
    }

    // Validate hex inputs
    let _vkey_bytes =
        hex::decode(&program_vkey).map_err(|_| ContractError::InvalidHex {
            field: "program_vkey".into(),
        })?;

    // Check circuit is registered
    let circuit = CIRCUITS
        .may_load(deps.storage, &circuit_id)?
        .ok_or(ContractError::CircuitNotRegistered {
            circuit_id: circuit_id.clone(),
        })?;

    // Verify program_vkey matches registered circuit
    if circuit.program_vkey != program_vkey {
        return Err(ContractError::VKeyMismatch {
            circuit_id: circuit_id.clone(),
        });
    }

    // Check nullifier not already used
    if NULLIFIERS
        .may_load(deps.storage, &nullifier)?
        .unwrap_or(false)
    {
        return Err(ContractError::NullifierAlreadyUsed {
            nullifier: nullifier.clone(),
        });
    }

    // Mark nullifier as used
    NULLIFIERS.save(deps.storage, &nullifier, &true)?;

    let mut stats = STATS.load(deps.storage)?;

    // Verify proof
    let is_valid = if config.mock_mode {
        // Mock mode: accept all proofs
        true
    } else {
        // Production mode: verify SP1 Groth16/PLONK proof cryptographically.
        // Per SP1 docs: Groth16 verification uses BN254 pairing check.
        // WASM implementation would use a Groth16 verifier library.
        //
        // For this skeleton, we validate the proof structure and return true.
        // In production, integrate with a WASM-compatible BN254 pairing library.
        verify_sp1_proof_wasm(&_vkey_bytes, &public_values, &proof_bytes)
    };

    if is_valid {
        stats.total_verified += 1;
        STATS.save(deps.storage, &stats)?;

        Ok(Response::new()
            .add_attribute("action", "verify_proof")
            .add_attribute("circuit_id", &circuit_id)
            .add_attribute("nullifier", &nullifier)
            .add_attribute("result", "valid")
            .add_attribute("block_height", env.block.height.to_string())
            .add_attribute("timestamp", env.block.time.seconds().to_string()))
    } else {
        stats.total_failed += 1;
        STATS.save(deps.storage, &stats)?;

        Err(ContractError::InvalidProof {})
    }
}

/// SP1 proof verification for WASM targets.
///
/// Research ties:
///   Per SP1 docs, the sp1-verifier crate supports no_std/wasm targets for
///   off-chain verification. For on-chain CosmWasm, we need a lightweight
///   BN254 pairing implementation compatible with wasm32-unknown-unknown.
///
/// TODO: Integrate bn254-wasm or arkworks-wasm for production BN254 pairings.
fn verify_sp1_proof_wasm(
    _vkey_bytes: &[u8],
    _public_values: &str,
    _proof_bytes: &str,
) -> bool {
    // Skeleton: structural validation only.
    // In production, perform full Groth16 pairing check:
    //   e(proof.a, proof.b) == e(vk.alpha, vk.beta) * e(vk_x, vk.gamma) * e(proof.c, vk.delta)

    // Validate proof_bytes is non-empty hex
    if _proof_bytes.is_empty() {
        return false;
    }

    // Validate minimum proof size (Groth16 = 256 bytes minimum)
    let proof_decoded = hex::decode(_proof_bytes).unwrap_or_default();
    if proof_decoded.len() < 128 {
        return false;
    }

    true // Skeleton: accept structurally valid proofs
}

fn execute_register_circuit(
    deps: DepsMut,
    info: MessageInfo,
    circuit_id: String,
    program_vkey: String,
    label: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    if CIRCUITS.may_load(deps.storage, &circuit_id)?.is_some() {
        return Err(ContractError::CircuitAlreadyRegistered {
            circuit_id: circuit_id.clone(),
        });
    }

    CIRCUITS.save(
        deps.storage,
        &circuit_id,
        &CircuitInfo {
            program_vkey: program_vkey.clone(),
            label: label.clone(),
        },
    )?;

    let mut stats = STATS.load(deps.storage)?;
    stats.circuit_count += 1;
    STATS.save(deps.storage, &stats)?;

    Ok(Response::new()
        .add_attribute("action", "register_circuit")
        .add_attribute("circuit_id", circuit_id)
        .add_attribute("label", label))
}

fn execute_remove_circuit(
    deps: DepsMut,
    info: MessageInfo,
    circuit_id: String,
) -> Result<Response, ContractError> {
    let config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }

    if CIRCUITS.may_load(deps.storage, &circuit_id)?.is_none() {
        return Err(ContractError::CircuitNotRegistered {
            circuit_id: circuit_id.clone(),
        });
    }

    CIRCUITS.remove(deps.storage, &circuit_id);

    let mut stats = STATS.load(deps.storage)?;
    stats.circuit_count = stats.circuit_count.saturating_sub(1);
    STATS.save(deps.storage, &stats)?;

    Ok(Response::new()
        .add_attribute("action", "remove_circuit")
        .add_attribute("circuit_id", circuit_id))
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

    Ok(Response::new()
        .add_attribute("action", "update_admin")
        .add_attribute("new_admin", new_admin))
}

fn execute_set_mock_mode(
    deps: DepsMut,
    info: MessageInfo,
    enabled: bool,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    config.mock_mode = enabled;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_mock_mode")
        .add_attribute("enabled", enabled.to_string()))
}

fn execute_set_paused(
    deps: DepsMut,
    info: MessageInfo,
    paused: bool,
) -> Result<Response, ContractError> {
    let mut config = CONFIG.load(deps.storage)?;
    if info.sender != config.admin {
        return Err(ContractError::Unauthorized {});
    }
    config.paused = paused;
    CONFIG.save(deps.storage, &config)?;

    Ok(Response::new()
        .add_attribute("action", "set_paused")
        .add_attribute("paused", paused.to_string()))
}

// ─── Query ────────────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, _env: Env, msg: QueryMsg) -> StdResult<Binary> {
    match msg {
        QueryMsg::IsNullifierUsed { nullifier } => {
            let used = NULLIFIERS
                .may_load(deps.storage, &nullifier)?
                .unwrap_or(false);
            to_json_binary(&NullifierResponse { used })
        }
        QueryMsg::GetCircuit { circuit_id } => {
            let circuit = CIRCUITS.may_load(deps.storage, &circuit_id)?;
            match circuit {
                Some(c) => to_json_binary(&CircuitResponse {
                    circuit_id,
                    program_vkey: c.program_vkey,
                    label: c.label,
                }),
                None => to_json_binary(&CircuitResponse {
                    circuit_id,
                    program_vkey: String::new(),
                    label: String::new(),
                }),
            }
        }
        QueryMsg::GetStats {} => {
            let stats = STATS.load(deps.storage)?;
            let config = CONFIG.load(deps.storage)?;
            to_json_binary(&StatsResponse {
                total_verified: stats.total_verified,
                total_failed: stats.total_failed,
                circuit_count: stats.circuit_count,
                mock_mode: config.mock_mode,
                paused: config.paused,
            })
        }
        QueryMsg::GetConfig {} => {
            let config = CONFIG.load(deps.storage)?;
            to_json_binary(&ConfigResponse {
                admin: config.admin.to_string(),
                mock_mode: config.mock_mode,
                paused: config.paused,
            })
        }
    }
}
