#[cfg(test)]
mod tests {
    use cosmwasm_std::testing::{mock_dependencies, mock_env, mock_info};
    use cosmwasm_std::{from_json, Binary, Uint128};

    use crate::contract::{execute, instantiate, query};
    use crate::msg::*;

    const ADMIN: &str = "osmo1admin000000000000000000000000000000000";
    const FEE_COLLECTOR: &str = "osmo1feecollector00000000000000000000000000";
    const IBCTFUEL: &str = "osmo1ibctfuel00000000000000000000000000000000";
    const RELAYER: &str = "osmo1relayer0000000000000000000000000000000";
    const AGENT1: &str = "osmo1agent100000000000000000000000000000000";
    const AGENT2: &str = "osmo1agent200000000000000000000000000000000";

    fn default_instantiate_msg() -> InstantiateMsg {
        InstantiateMsg {
            admin: ADMIN.to_string(),
            fee_collector: FEE_COLLECTOR.to_string(),
            ibctfuel_token: IBCTFUEL.to_string(),
            min_fee_bps: None,
            max_fee_bps: None,
            default_fee_bps: None,
            a2a_relay_fee_bps: None,
            min_task_amount: None,
            max_batch_size: None,
            fee_forward_threshold: None,
            mock_mode: Some(true), // Use mock mode for tests
            akash_ibc_channel: Some("channel-1".to_string()),
            theta_ibc_channel: Some("channel-0".to_string()),
        }
    }

    fn default_sp1_proof() -> SP1Proof {
        SP1Proof {
            proof_data: Binary::from(b"mock_proof_data_12345"),
            proof_type: "ai_task".to_string(),
            public_inputs: Binary::from(b"mock_public_inputs"),
            vk_hash: "mock_vk_hash_abc123".to_string(),
        }
    }

    // ── Instantiation Tests ─────────────────────────────────────────────

    #[test]
    fn test_instantiate_success() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);

        let res = instantiate(deps.as_mut(), env, info, default_instantiate_msg()).unwrap();
        assert_eq!(res.attributes.len(), 6);

        // Query config
        let config: ConfigResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::Config {}).unwrap()).unwrap();
        assert_eq!(config.admin.as_str(), ADMIN);
        assert_eq!(config.fee_collector.as_str(), FEE_COLLECTOR);
        assert_eq!(config.ibctfuel_token.as_str(), IBCTFUEL);
        assert_eq!(config.default_fee_bps, 50);
        assert_eq!(config.a2a_relay_fee_bps, 10);
        assert!(config.mock_mode);
        assert!(!config.paused);
    }

    #[test]
    fn test_instantiate_defaults() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);

        let msg = InstantiateMsg {
            admin: ADMIN.to_string(),
            fee_collector: FEE_COLLECTOR.to_string(),
            ibctfuel_token: IBCTFUEL.to_string(),
            min_fee_bps: None,
            max_fee_bps: None,
            default_fee_bps: None,
            a2a_relay_fee_bps: None,
            min_task_amount: None,
            max_batch_size: None,
            fee_forward_threshold: None,
            mock_mode: None, // Defaults to false
            akash_ibc_channel: None,
            theta_ibc_channel: None,
        };

        instantiate(deps.as_mut(), env, info, msg).unwrap();

        let config: ConfigResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::Config {}).unwrap()).unwrap();
        assert_eq!(config.min_fee_bps, 50);
        assert_eq!(config.max_fee_bps, 100);
        assert_eq!(config.default_fee_bps, 50);
        assert_eq!(config.a2a_relay_fee_bps, 10);
        assert_eq!(config.max_batch_size, 20);
        assert!(!config.mock_mode);
    }

    // ── AI Task Routing Tests ───────────────────────────────────────────

    #[test]
    fn test_route_inference_request() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let res = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "task-001".to_string(),
                msg_type: MessageType::InferenceRequest,
                destination_chain: ChainId::Akash,
                amount: Uint128::new(1_000_000),
                fee_bps: None,
                model_id_hash: Some("sha256_llama3".to_string()),
                input_hash: Some("sha256_input_data".to_string()),
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap();

        // Check event attributes
        assert!(res.attributes.iter().any(|a| a.key == "action" && a.value == "route_task"));
        assert!(res.attributes.iter().any(|a| a.key == "task_id" && a.value == "task-001"));
        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "for_ai_listener" && a.value == "true"));

        // Verify fee calculation: 0.5% of 1_000_000 = 5_000
        assert!(res.attributes.iter().any(|a| a.key == "fee_amount" && a.value == "5000"));
        assert!(res.attributes.iter().any(|a| a.key == "net_amount" && a.value == "995000"));

        // Query task
        let task: TaskResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::Task {
                    task_id: "task-001".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(task.msg_type, MessageType::InferenceRequest);
        assert_eq!(task.gross_amount, Uint128::new(1_000_000));
        assert_eq!(task.fee_amount, Uint128::new(5_000));
        assert_eq!(task.net_amount, Uint128::new(995_000));
        assert!(!task.settled);
    }

    #[test]
    fn test_route_compute_bid() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let res = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "bid-001".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Akash,
                amount: Uint128::new(500_000),
                fee_bps: Some(75), // 0.75%
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: Some("channel-1".to_string()),
            },
        )
        .unwrap();

        // Fee: 0.75% of 500_000 = 3_750
        assert!(res.attributes.iter().any(|a| a.key == "fee_amount" && a.value == "3750"));
        assert!(res.attributes.iter().any(|a| a.key == "net_amount" && a.value == "496250"));
    }

    #[test]
    fn test_route_capability_query_zero_amount() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let res = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "cap-001".to_string(),
                msg_type: MessageType::CapabilityQuery,
                destination_chain: ChainId::Theta,
                amount: Uint128::zero(),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap();

        // No fee for capability queries
        assert!(res.attributes.iter().any(|a| a.key == "fee_amount" && a.value == "0"));
    }

    #[test]
    fn test_route_task_duplicate_rejected() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            ExecuteMsg::RouteTask {
                task_id: "dup-001".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap();

        // Duplicate should fail
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "dup-001".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::TaskAlreadyExists { .. }));
    }

    #[test]
    fn test_route_task_amount_below_minimum() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "dust-001".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100), // Below 10000 minimum
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::AmountBelowMinimum { .. }));
    }

    #[test]
    fn test_inference_requires_model_id() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "inf-bad".to_string(),
                msg_type: MessageType::InferenceRequest,
                destination_chain: ChainId::Theta,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None, // Missing!
                input_hash: Some("input".to_string()),
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::InvalidModelIdHash {}));
    }

    #[test]
    fn test_compute_result_requires_output_hash() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "cr-bad".to_string(),
                msg_type: MessageType::ComputeResult,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None, // Missing!
                ibc_channel: None,
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::InvalidOutputHash {}));
    }

    // ── Task Settlement Tests ───────────────────────────────────────────

    #[test]
    fn test_settle_task_success() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Route a task
        let info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RouteTask {
                task_id: "settle-001".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Akash,
                amount: Uint128::new(1_000_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap();

        // Settle the task (admin is auto-relayer)
        let info = mock_info(ADMIN, &[]);
        let res = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SettleTask {
                task_id: "settle-001".to_string(),
                sp1_proof: default_sp1_proof(),
                nullifier: "nullifier_001".to_string(),
                output_hash: "output_hash_001".to_string(),
                fee_commitment: "fee_commitment_001".to_string(),
            },
        )
        .unwrap();

        assert!(res.attributes.iter().any(|a| a.key == "proof_outcome" && a.value == "valid"));
        assert!(res.attributes.iter().any(|a| a.key == "settled" && a.value == "true"));

        // Verify task is settled
        let task: TaskResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::Task {
                    task_id: "settle-001".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(task.settled);
        assert_eq!(task.proof_outcome, ProofOutcome::Valid);

        // Verify state counters
        let state: StateResponse =
            from_json(query(deps.as_ref(), mock_env(), QueryMsg::State {}).unwrap()).unwrap();
        assert_eq!(state.total_tasks_routed, 1);
        assert_eq!(state.total_tasks_settled, 1);
        assert_eq!(state.total_fees_collected, Uint128::new(5_000)); // 0.5% of 1M
    }

    #[test]
    fn test_settle_task_nullifier_replay_rejected() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Route two tasks
        for i in 1..=2 {
            let info = mock_info(AGENT1, &[]);
            execute(
                deps.as_mut(),
                env.clone(),
                info,
                ExecuteMsg::RouteTask {
                    task_id: format!("replay-{}", i),
                    msg_type: MessageType::ComputeBid,
                    destination_chain: ChainId::Osmosis,
                    amount: Uint128::new(100_000),
                    fee_bps: None,
                    model_id_hash: None,
                    input_hash: None,
                    output_hash: None,
                    ibc_channel: None,
                },
            )
            .unwrap();
        }

        // Settle first task
        let info = mock_info(ADMIN, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            ExecuteMsg::SettleTask {
                task_id: "replay-1".to_string(),
                sp1_proof: default_sp1_proof(),
                nullifier: "same_nullifier".to_string(),
                output_hash: "out1".to_string(),
                fee_commitment: "fc1".to_string(),
            },
        )
        .unwrap();

        // Try to use the same nullifier for second task
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SettleTask {
                task_id: "replay-2".to_string(),
                sp1_proof: default_sp1_proof(),
                nullifier: "same_nullifier".to_string(), // Replay!
                output_hash: "out2".to_string(),
                fee_commitment: "fc2".to_string(),
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::NullifierAlreadyUsed {}));
    }

    // ── A2A Message Tests ───────────────────────────────────────────────

    #[test]
    fn test_register_agent_and_send_message() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Register agent
        let info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            ExecuteMsg::RegisterAgent {
                identity_commitment: "poseidon_hash_agent1".to_string(),
            },
        )
        .unwrap();

        // Verify agent registered
        let agent: AgentResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::Agent {
                    address: AGENT1.to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(agent.registered);
        assert_eq!(agent.identity_commitment, "poseidon_hash_agent1");

        // Send A2A message (COMPUTE_BID requires escrow)
        let res = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SendA2AMessage {
                message_id: "msg-001".to_string(),
                msg_type: MessageType::ComputeBid,
                recipient_chain: ChainId::Akash,
                payload_hash: "payload_hash_001".to_string(),
                ttl: 3600, // 1 hour
                escrow_amount: Some(Uint128::new(1_000_000)),
            },
        )
        .unwrap();

        assert!(res
            .attributes
            .iter()
            .any(|a| a.key == "action" && a.value == "send_a2a_message"));
        // Relay fee: 0.1% of 1_000_000 = 1_000_000 * 10 / 10_000 = 1000
        assert!(res.attributes.iter().any(|a| a.key == "relay_fee" && a.value == "1000"));
    }

    #[test]
    fn test_unregistered_agent_cannot_send_message() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Try to send message without registering
        let info = mock_info(AGENT1, &[]);
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SendA2AMessage {
                message_id: "msg-unauth".to_string(),
                msg_type: MessageType::CapabilityQuery,
                recipient_chain: ChainId::Theta,
                payload_hash: "hash".to_string(),
                ttl: 60,
                escrow_amount: None,
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::AgentNotRegistered { .. }));
    }

    #[test]
    fn test_compute_bid_requires_escrow() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Register agent
        let info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            ExecuteMsg::RegisterAgent {
                identity_commitment: "id1".to_string(),
            },
        )
        .unwrap();

        // COMPUTE_BID with no escrow → error
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SendA2AMessage {
                message_id: "msg-noescrow".to_string(),
                msg_type: MessageType::ComputeBid,
                recipient_chain: ChainId::Akash,
                payload_hash: "hash".to_string(),
                ttl: 3600,
                escrow_amount: None, // Missing!
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::EscrowRequired { .. }));
    }

    #[test]
    fn test_capability_query_forbids_escrow() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Register agent
        let info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            ExecuteMsg::RegisterAgent {
                identity_commitment: "id1".to_string(),
            },
        )
        .unwrap();

        // CAPABILITY_QUERY with escrow → error
        let err = execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::SendA2AMessage {
                message_id: "msg-forbid".to_string(),
                msg_type: MessageType::CapabilityQuery,
                recipient_chain: ChainId::Theta,
                payload_hash: "hash".to_string(),
                ttl: 60,
                escrow_amount: Some(Uint128::new(100)), // Forbidden!
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::EscrowForbidden { .. }));
    }

    // ── Fee Calculation Tests ───────────────────────────────────────────

    #[test]
    fn test_fee_calculation_query() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // 0.5% of 2_000_000 = 10_000
        let res: FeeCalculationResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::CalculateFee {
                    amount: Uint128::new(2_000_000),
                    fee_bps: 50,
                },
            )
            .unwrap(),
        )
        .unwrap();

        assert_eq!(res.fee_amount, Uint128::new(10_000));
        assert_eq!(res.net_amount, Uint128::new(1_990_000));

        // 1.0% of 2_000_000 = 20_000
        let res: FeeCalculationResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::CalculateFee {
                    amount: Uint128::new(2_000_000),
                    fee_bps: 100,
                },
            )
            .unwrap(),
        )
        .unwrap();

        assert_eq!(res.fee_amount, Uint128::new(20_000));
        assert_eq!(res.net_amount, Uint128::new(1_980_000));
    }

    // ── Admin Tests ─────────────────────────────────────────────────────

    #[test]
    fn test_pause_unpause() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info.clone(), default_instantiate_msg()).unwrap();

        // Pause
        execute(deps.as_mut(), env.clone(), info.clone(), ExecuteMsg::Pause {}).unwrap();

        // Try to route task while paused
        let agent_info = mock_info(AGENT1, &[]);
        let err = execute(
            deps.as_mut(),
            env.clone(),
            agent_info,
            ExecuteMsg::RouteTask {
                task_id: "paused-task".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap_err();

        assert!(matches!(err, crate::error::ContractError::Paused {}));

        // Unpause
        execute(deps.as_mut(), env.clone(), info, ExecuteMsg::Unpause {}).unwrap();

        // Now routing should work
        let agent_info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            agent_info,
            ExecuteMsg::RouteTask {
                task_id: "unpaused-task".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn test_non_admin_cannot_pause() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        let info = mock_info(AGENT1, &[]);
        let err = execute(deps.as_mut(), env.clone(), info, ExecuteMsg::Pause {}).unwrap_err();
        assert!(matches!(err, crate::error::ContractError::Unauthorized {}));
    }

    #[test]
    fn test_add_remove_relayer() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info.clone(), default_instantiate_msg()).unwrap();

        // Add relayer
        execute(
            deps.as_mut(),
            env.clone(),
            info.clone(),
            ExecuteMsg::AddRelayer {
                relayer: RELAYER.to_string(),
            },
        )
        .unwrap();

        // Route a task
        let agent_info = mock_info(AGENT1, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            agent_info,
            ExecuteMsg::RouteTask {
                task_id: "relayer-test".to_string(),
                msg_type: MessageType::ComputeBid,
                destination_chain: ChainId::Osmosis,
                amount: Uint128::new(100_000),
                fee_bps: None,
                model_id_hash: None,
                input_hash: None,
                output_hash: None,
                ibc_channel: None,
            },
        )
        .unwrap();

        // Relayer can settle
        let relayer_info = mock_info(RELAYER, &[]);
        execute(
            deps.as_mut(),
            env.clone(),
            relayer_info,
            ExecuteMsg::SettleTask {
                task_id: "relayer-test".to_string(),
                sp1_proof: default_sp1_proof(),
                nullifier: "null_relayer".to_string(),
                output_hash: "out".to_string(),
                fee_commitment: "fc".to_string(),
            },
        )
        .unwrap();

        // Remove relayer
        execute(
            deps.as_mut(),
            env.clone(),
            info,
            ExecuteMsg::RemoveRelayer {
                relayer: RELAYER.to_string(),
            },
        )
        .unwrap();
    }

    // ── Nonce Tests ─────────────────────────────────────────────────────

    #[test]
    fn test_nonce_increments_per_agent() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Route 3 tasks from same agent
        for i in 1..=3 {
            let info = mock_info(AGENT1, &[]);
            let res = execute(
                deps.as_mut(),
                env.clone(),
                info,
                ExecuteMsg::RouteTask {
                    task_id: format!("nonce-{}", i),
                    msg_type: MessageType::ComputeBid,
                    destination_chain: ChainId::Osmosis,
                    amount: Uint128::new(100_000),
                    fee_bps: None,
                    model_id_hash: None,
                    input_hash: None,
                    output_hash: None,
                    ibc_channel: None,
                },
            )
            .unwrap();

            let nonce_attr = res.attributes.iter().find(|a| a.key == "nonce").unwrap();
            assert_eq!(nonce_attr.value, i.to_string());
        }
    }

    // ── List Query Tests ────────────────────────────────────────────────

    #[test]
    fn test_list_tasks() {
        let mut deps = mock_dependencies();
        let env = mock_env();
        let info = mock_info(ADMIN, &[]);
        instantiate(deps.as_mut(), env.clone(), info, default_instantiate_msg()).unwrap();

        // Route 5 tasks
        for i in 1..=5 {
            let info = mock_info(AGENT1, &[]);
            execute(
                deps.as_mut(),
                env.clone(),
                info,
                ExecuteMsg::RouteTask {
                    task_id: format!("list-{:03}", i),
                    msg_type: MessageType::ComputeBid,
                    destination_chain: ChainId::Osmosis,
                    amount: Uint128::new(100_000),
                    fee_bps: None,
                    model_id_hash: None,
                    input_hash: None,
                    output_hash: None,
                    ibc_channel: None,
                },
            )
            .unwrap();
        }

        let res: TaskListResponse = from_json(
            query(
                deps.as_ref(),
                mock_env(),
                QueryMsg::ListTasks {
                    start_after: None,
                    limit: Some(3),
                },
            )
            .unwrap(),
        )
        .unwrap();

        assert_eq!(res.tasks.len(), 3);
    }
}
