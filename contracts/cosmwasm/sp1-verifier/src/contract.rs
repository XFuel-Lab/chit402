use cosmwasm_std::{
    entry_point, to_json_binary, Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult,
};

use ark_bn254::{Bn254, Fr};
use ark_ff::PrimeField;
use ark_groth16::{Groth16, PreparedVerifyingKey, Proof, VerifyingKey};
use ark_snark::SNARK;
use ark_serialize::CanonicalDeserialize;
use ark_std::vec::Vec as ArkVec;

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
            vkey_data,
        } => execute_register_circuit(deps, info, circuit_id, program_vkey, label, vkey_data),
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
        true
    } else {
        let vkey_data = CIRCUIT_VKEYS
            .may_load(deps.storage, &circuit_id)?
            .unwrap_or_else(|| _vkey_bytes.clone());
        verify_sp1_proof_wasm(&vkey_data, &public_values, &proof_bytes)
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
            .add_attribute("timestamp", env.block.time.seconds().to_string())
            .add_attribute("total_verified", stats.total_verified.to_string())
            .add_attribute("ibc_source", "xfuel-zk-verifier"))
    } else {
        stats.total_failed += 1;
        STATS.save(deps.storage, &stats)?;

        Err(ContractError::InvalidProof {})
    }
}

/// SP1 Groth16 proof verification using arkworks BN254 pairings.
///
/// Per SP1 v6 Hypercube docs: Groth16 proofs on BN254 consist of three curve
/// points (A: G1, B: G2, C: G1). Verification performs the bilinear pairing:
///   e(A, B) == e(alpha_g1, beta_g2) * e(vk_x, gamma_g2) * e(C, delta_g2)
///
/// The verification key must be stored on-chain when circuits are registered
/// (serialized via ark-serialize CanonicalSerialize, stored in CIRCUIT_VKEYS).
///
/// Public inputs are deserialized as BN254 scalar field elements (Fr).
/// Proof bytes are deserialized as three curve points in canonical format.
fn verify_sp1_proof_wasm(
    vkey_bytes: &[u8],
    public_values: &str,
    proof_bytes: &str,
) -> bool {
    let proof_raw = match hex::decode(proof_bytes) {
        Ok(b) => b,
        Err(_) => return false,
    };
    if proof_raw.len() < 192 {
        return false;
    }

    let public_raw = match hex::decode(public_values) {
        Ok(b) => b,
        Err(_) => return false,
    };

    let proof: Proof<Bn254> = match Proof::deserialize_compressed(&proof_raw[..]) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let vk: VerifyingKey<Bn254> = match VerifyingKey::deserialize_compressed(vkey_bytes) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let mut public_inputs: ArkVec<Fr> = ArkVec::new();
    for chunk in public_raw.chunks(32) {
        match Fr::from_le_bytes_mod_order(chunk).into() {
            val => public_inputs.push(val),
        }
    }

    let pvk = PreparedVerifyingKey::from(vk);
    Groth16::<Bn254>::verify_with_processed_vk(&pvk, &public_inputs, &proof).is_ok()
}

fn execute_register_circuit(
    deps: DepsMut,
    info: MessageInfo,
    circuit_id: String,
    program_vkey: String,
    label: String,
    vkey_data: Option<String>,
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

    if let Some(vk_hex) = vkey_data {
        let vk_bytes = hex::decode(&vk_hex).map_err(|_| ContractError::InvalidHex {
            field: "vkey_data".into(),
        })?;
        CIRCUIT_VKEYS.save(deps.storage, &circuit_id, &vk_bytes)?;
    }

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

// ─── Migrate ──────────────────────────────────────────────────────────────────

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn migrate(deps: DepsMut, _env: Env, _msg: MigrateMsg) -> Result<Response, ContractError> {
    cw2::set_contract_version(deps.storage, CONTRACT_NAME, CONTRACT_VERSION)?;
    Ok(Response::new().add_attribute("action", "migrate"))
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

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::from_json;

    const ADMIN: &str = "admin";
    const USER: &str = "user";
    const CIRCUIT_ID: &str = "ai_task";
    const VKEY_HEX: &str = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const NULLIFIER: &str = "nullifier_001";

    fn setup_contract(mock_mode: bool) -> cosmwasm_std::OwnedDeps<
        cosmwasm_std::MemoryStorage,
        cosmwasm_std::testing::MockApi,
        cosmwasm_std::testing::MockQuerier,
    > {
        let mut deps = mock_dependencies();
        let msg = InstantiateMsg {
            admin: ADMIN.to_string(),
            mock_mode,
        };
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), mock_env(), info, msg).unwrap();
        deps
    }

    fn register_circuit(deps: &mut cosmwasm_std::OwnedDeps<
        cosmwasm_std::MemoryStorage,
        cosmwasm_std::testing::MockApi,
        cosmwasm_std::testing::MockQuerier,
    >) {
        let msg = ExecuteMsg::RegisterCircuit {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            label: "AI Task Circuit".to_string(),
            vkey_data: None,
        };
        let info = mock_info(ADMIN, &[]);
        execute(deps.as_mut(), mock_env(), info, msg).unwrap();
    }

    // ─── Instantiate ──────────────────────────────────────────────────────────

    #[test]
    fn instantiate_sets_config() {
        let deps = setup_contract(true);
        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.admin.as_str(), ADMIN);
        assert!(config.mock_mode);
        assert!(!config.paused);
    }

    #[test]
    fn instantiate_sets_zero_stats() {
        let deps = setup_contract(true);
        let stats = STATS.load(&deps.storage).unwrap();
        assert_eq!(stats.total_verified, 0);
        assert_eq!(stats.total_failed, 0);
        assert_eq!(stats.circuit_count, 0);
    }

    // ─── Circuit Management ───────────────────────────────────────────────────

    #[test]
    fn register_circuit_success() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let circuit = CIRCUITS.load(&deps.storage, CIRCUIT_ID).unwrap();
        assert_eq!(circuit.program_vkey, VKEY_HEX);
        assert_eq!(circuit.label, "AI Task Circuit");

        let stats = STATS.load(&deps.storage).unwrap();
        assert_eq!(stats.circuit_count, 1);
    }

    #[test]
    fn register_circuit_unauthorized() {
        let mut deps = setup_contract(true);
        let msg = ExecuteMsg::RegisterCircuit {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            label: "Test".to_string(),
            vkey_data: None,
        };
        let info = mock_info(USER, &[]);
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Unauthorized {}));
    }

    #[test]
    fn register_circuit_duplicate_rejected() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let msg = ExecuteMsg::RegisterCircuit {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            label: "Duplicate".to_string(),
            vkey_data: None,
        };
        let info = mock_info(ADMIN, &[]);
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::CircuitAlreadyRegistered { .. }));
    }

    #[test]
    fn remove_circuit_success() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let msg = ExecuteMsg::RemoveCircuit {
            circuit_id: CIRCUIT_ID.to_string(),
        };
        let info = mock_info(ADMIN, &[]);
        execute(deps.as_mut(), mock_env(), info, msg).unwrap();

        let stats = STATS.load(&deps.storage).unwrap();
        assert_eq!(stats.circuit_count, 0);
        assert!(CIRCUITS.may_load(&deps.storage, CIRCUIT_ID).unwrap().is_none());
    }

    // ─── Proof Verification (Mock Mode) ───────────────────────────────────────

    #[test]
    fn verify_proof_mock_mode_success() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let msg = ExecuteMsg::VerifyProof {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            public_values: "00".repeat(32),
            proof_bytes: "ab".repeat(130),
            nullifier: NULLIFIER.to_string(),
        };
        let info = mock_info(USER, &[]);
        let res = execute(deps.as_mut(), mock_env(), info, msg).unwrap();

        assert!(res.attributes.iter().any(|a| a.key == "result" && a.value == "valid"));
        assert!(res.attributes.iter().any(|a| a.key == "circuit_id" && a.value == CIRCUIT_ID));
        assert!(res.attributes.iter().any(|a| a.key == "ibc_source" && a.value == "xfuel-zk-verifier"));

        let stats = STATS.load(&deps.storage).unwrap();
        assert_eq!(stats.total_verified, 1);
    }

    #[test]
    fn verify_proof_nullifier_replay_rejected() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let msg = ExecuteMsg::VerifyProof {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            public_values: "00".repeat(32),
            proof_bytes: "ab".repeat(130),
            nullifier: NULLIFIER.to_string(),
        };
        let info = mock_info(USER, &[]);
        execute(deps.as_mut(), mock_env(), info.clone(), msg.clone()).unwrap();

        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::NullifierAlreadyUsed { .. }));
    }

    #[test]
    fn verify_proof_unregistered_circuit_rejected() {
        let mut deps = setup_contract(true);

        let msg = ExecuteMsg::VerifyProof {
            circuit_id: "nonexistent".to_string(),
            program_vkey: VKEY_HEX.to_string(),
            public_values: "00".repeat(32),
            proof_bytes: "ab".repeat(130),
            nullifier: NULLIFIER.to_string(),
        };
        let info = mock_info(USER, &[]);
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::CircuitNotRegistered { .. }));
    }

    #[test]
    fn verify_proof_vkey_mismatch_rejected() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let msg = ExecuteMsg::VerifyProof {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: "ff".repeat(32),
            public_values: "00".repeat(32),
            proof_bytes: "ab".repeat(130),
            nullifier: NULLIFIER.to_string(),
        };
        let info = mock_info(USER, &[]);
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::VKeyMismatch { .. }));
    }

    #[test]
    fn verify_proof_paused_rejected() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let pause_msg = ExecuteMsg::SetPaused { paused: true };
        execute(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), pause_msg).unwrap();

        let msg = ExecuteMsg::VerifyProof {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            public_values: "00".repeat(32),
            proof_bytes: "ab".repeat(130),
            nullifier: NULLIFIER.to_string(),
        };
        let info = mock_info(USER, &[]);
        let err = execute(deps.as_mut(), mock_env(), info, msg).unwrap_err();
        assert!(matches!(err, ContractError::Paused {}));
    }

    // ─── Nullifier Query ──────────────────────────────────────────────────────

    #[test]
    fn query_nullifier_unused() {
        let deps = setup_contract(true);
        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::IsNullifierUsed { nullifier: NULLIFIER.to_string() },
        ).unwrap();
        let resp: NullifierResponse = from_json(&res).unwrap();
        assert!(!resp.used);
    }

    #[test]
    fn query_nullifier_used_after_verify() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        let msg = ExecuteMsg::VerifyProof {
            circuit_id: CIRCUIT_ID.to_string(),
            program_vkey: VKEY_HEX.to_string(),
            public_values: "00".repeat(32),
            proof_bytes: "ab".repeat(130),
            nullifier: NULLIFIER.to_string(),
        };
        execute(deps.as_mut(), mock_env(), mock_info(USER, &[]), msg).unwrap();

        let res = query(
            deps.as_ref(),
            mock_env(),
            QueryMsg::IsNullifierUsed { nullifier: NULLIFIER.to_string() },
        ).unwrap();
        let resp: NullifierResponse = from_json(&res).unwrap();
        assert!(resp.used);
    }

    // ─── Stats & Config Queries ───────────────────────────────────────────────

    #[test]
    fn query_stats_reflects_verifications() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        for i in 0..3 {
            let msg = ExecuteMsg::VerifyProof {
                circuit_id: CIRCUIT_ID.to_string(),
                program_vkey: VKEY_HEX.to_string(),
                public_values: "00".repeat(32),
                proof_bytes: "ab".repeat(130),
                nullifier: format!("nullifier_{}", i),
            };
            execute(deps.as_mut(), mock_env(), mock_info(USER, &[]), msg).unwrap();
        }

        let res = query(deps.as_ref(), mock_env(), QueryMsg::GetStats {}).unwrap();
        let resp: StatsResponse = from_json(&res).unwrap();
        assert_eq!(resp.total_verified, 3);
        assert_eq!(resp.circuit_count, 1);
        assert!(resp.mock_mode);
    }

    #[test]
    fn query_config_returns_correct_values() {
        let deps = setup_contract(false);
        let res = query(deps.as_ref(), mock_env(), QueryMsg::GetConfig {}).unwrap();
        let resp: ConfigResponse = from_json(&res).unwrap();
        assert_eq!(resp.admin, ADMIN);
        assert!(!resp.mock_mode);
        assert!(!resp.paused);
    }

    // ─── Admin Operations ─────────────────────────────────────────────────────

    #[test]
    fn update_admin_success() {
        let mut deps = setup_contract(true);
        let msg = ExecuteMsg::UpdateAdmin { new_admin: USER.to_string() };
        execute(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), msg).unwrap();

        let config = CONFIG.load(&deps.storage).unwrap();
        assert_eq!(config.admin.as_str(), USER);
    }

    #[test]
    fn toggle_mock_mode() {
        let mut deps = setup_contract(true);
        let msg = ExecuteMsg::SetMockMode { enabled: false };
        execute(deps.as_mut(), mock_env(), mock_info(ADMIN, &[]), msg).unwrap();

        let config = CONFIG.load(&deps.storage).unwrap();
        assert!(!config.mock_mode);
    }

    // ─── Multiple Unique Nullifiers ───────────────────────────────────────────

    #[test]
    fn multiple_unique_nullifiers_accepted() {
        let mut deps = setup_contract(true);
        register_circuit(&mut deps);

        for i in 0..5 {
            let msg = ExecuteMsg::VerifyProof {
                circuit_id: CIRCUIT_ID.to_string(),
                program_vkey: VKEY_HEX.to_string(),
                public_values: "00".repeat(32),
                proof_bytes: "ab".repeat(130),
                nullifier: format!("unique_{}", i),
            };
            let res = execute(deps.as_mut(), mock_env(), mock_info(USER, &[]), msg);
            assert!(res.is_ok(), "Nullifier {} should be accepted", i);
        }

        let stats = STATS.load(&deps.storage).unwrap();
        assert_eq!(stats.total_verified, 5);
    }
}
