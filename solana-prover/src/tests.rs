use super::*;
use solana_program::pubkey::Pubkey;

// ────────────────────────────────────────────────────────────────
// State Serialization Tests
// ────────────────────────────────────────────────────────────────

#[test]
fn test_verifier_state_serialization() {
    let state = VerifierState {
        discriminator: VerifierState::DISCRIMINATOR,
        admin: Pubkey::new_unique(),
        mock_mode: true,
        paused: false,
        circuit_count: 5,
        total_verified: 42,
        total_failed: 1,
        total_relayed: 3,
        bump: 255,
    };

    let mut buf = vec![0u8; VerifierState::LEN];
    state.serialize(&mut &mut buf[..]).unwrap();
    let deser = VerifierState::try_from_slice(&buf).unwrap();

    assert_eq!(deser.discriminator, VerifierState::DISCRIMINATOR);
    assert_eq!(deser.admin, state.admin);
    assert!(deser.mock_mode);
    assert!(!deser.paused);
    assert_eq!(deser.circuit_count, 5);
    assert_eq!(deser.total_verified, 42);
    assert_eq!(deser.total_failed, 1);
    assert_eq!(deser.total_relayed, 3);
    assert_eq!(deser.bump, 255);
}

#[test]
fn test_verifier_state_len_matches_serialized() {
    let state = VerifierState {
        discriminator: VerifierState::DISCRIMINATOR,
        admin: Pubkey::default(),
        mock_mode: false,
        paused: false,
        circuit_count: 0,
        total_verified: 0,
        total_failed: 0,
        total_relayed: 0,
        bump: 0,
    };
    let serialized = borsh::to_vec(&state).unwrap();
    assert_eq!(serialized.len(), VerifierState::LEN);
}

#[test]
fn test_circuit_config_serialization() {
    let circuit = CircuitConfig {
        discriminator: CircuitConfig::DISCRIMINATOR,
        circuit_id: [1u8; 32],
        program_vkey: [2u8; 32],
        label: "ai-task-v1".to_string(),
        vk_data: vec![0xAA; 512],
        nr_public_inputs: 4,
        is_active: true,
        verified_count: 0,
        bump: 254,
    };

    let space = CircuitConfig::space(circuit.label.len(), circuit.vk_data.len());
    let mut buf = vec![0u8; space];
    circuit.serialize(&mut &mut buf[..]).unwrap();
    let deser = CircuitConfig::try_from_slice(&buf).unwrap();

    assert_eq!(deser.circuit_id, [1u8; 32]);
    assert_eq!(deser.program_vkey, [2u8; 32]);
    assert_eq!(deser.label, "ai-task-v1");
    assert_eq!(deser.vk_data.len(), 512);
    assert_eq!(deser.nr_public_inputs, 4);
    assert!(deser.is_active);
    assert_eq!(deser.verified_count, 0);
}

#[test]
fn test_circuit_config_space() {
    let label_len = 12;
    let vk_len = 448 + 2 * 64; // base VK + 2 IC points (1 public input)
    let space = CircuitConfig::space(label_len, vk_len);
    assert_eq!(space, 84 + label_len + vk_len);
}

#[test]
fn test_nullifier_record_serialization() {
    let record = NullifierRecord {
        discriminator: NullifierRecord::DISCRIMINATOR,
        nullifier: [0xAA; 32],
        circuit_id: [0xBB; 32],
        verifier: Pubkey::new_unique(),
        timestamp: 1700000000,
        bump: 253,
    };

    let mut buf = vec![0u8; NullifierRecord::LEN];
    record.serialize(&mut &mut buf[..]).unwrap();
    let deser = NullifierRecord::try_from_slice(&buf).unwrap();

    assert_eq!(deser.discriminator, NullifierRecord::DISCRIMINATOR);
    assert_eq!(deser.nullifier, [0xAA; 32]);
    assert_eq!(deser.circuit_id, [0xBB; 32]);
    assert_eq!(deser.verifier, record.verifier);
    assert_eq!(deser.timestamp, 1700000000);
}

#[test]
fn test_nullifier_record_len_matches_serialized() {
    let record = NullifierRecord {
        discriminator: NullifierRecord::DISCRIMINATOR,
        nullifier: [0; 32],
        circuit_id: [0; 32],
        verifier: Pubkey::default(),
        timestamp: 0,
        bump: 0,
    };
    let serialized = borsh::to_vec(&record).unwrap();
    assert_eq!(serialized.len(), NullifierRecord::LEN);
}

// ────────────────────────────────────────────────────────────────
// Instruction Parsing Tests
// ────────────────────────────────────────────────────────────────

#[test]
fn test_instruction_initialize() {
    let ix = XfuelInstruction::Initialize { mock_mode: true };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::Initialize { mock_mode } => assert!(mock_mode),
        _ => panic!("Wrong instruction variant"),
    }
}

#[test]
fn test_instruction_register_circuit() {
    let ix = XfuelInstruction::RegisterCircuit {
        circuit_id: [1u8; 32],
        program_vkey: [2u8; 32],
        label: "depin-compute".to_string(),
        vk_data: vec![0u8; 448 + 128],
        nr_public_inputs: 2,
    };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::RegisterCircuit {
            circuit_id,
            label,
            nr_public_inputs,
            ..
        } => {
            assert_eq!(circuit_id, [1u8; 32]);
            assert_eq!(label, "depin-compute");
            assert_eq!(nr_public_inputs, 2);
        }
        _ => panic!("Wrong instruction variant"),
    }
}

#[test]
fn test_instruction_remove_circuit() {
    let ix = XfuelInstruction::RemoveCircuit {
        circuit_id: [0xFF; 32],
    };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::RemoveCircuit { circuit_id } => {
            assert_eq!(circuit_id, [0xFF; 32]);
        }
        _ => panic!("Wrong instruction variant"),
    }
}

#[test]
fn test_instruction_verify_proof() {
    let ix = XfuelInstruction::VerifyProof {
        circuit_id: [1u8; 32],
        proof: vec![0u8; 256],
        public_values: vec![0u8; 128],
        nullifier: [0xAA; 32],
    };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::VerifyProof {
            proof,
            public_values,
            nullifier,
            ..
        } => {
            assert_eq!(proof.len(), 256);
            assert_eq!(public_values.len(), 128);
            assert_eq!(nullifier, [0xAA; 32]);
        }
        _ => panic!("Wrong instruction variant"),
    }
}

#[test]
fn test_instruction_emit_bridge_event() {
    let ix = XfuelInstruction::EmitBridgeEvent {
        circuit_id: [1u8; 32],
        nullifier: [2u8; 32],
        target_chain: WORMHOLE_CHAIN_THETA,
        payload: vec![0x01, 0x02, 0x03],
    };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::EmitBridgeEvent {
            target_chain,
            payload,
            ..
        } => {
            assert_eq!(target_chain, WORMHOLE_CHAIN_THETA);
            assert_eq!(payload, vec![0x01, 0x02, 0x03]);
        }
        _ => panic!("Wrong instruction variant"),
    }
}

#[test]
fn test_instruction_set_paused() {
    let ix = XfuelInstruction::SetPaused { paused: true };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::SetPaused { paused } => assert!(paused),
        _ => panic!("Wrong instruction variant"),
    }
}

#[test]
fn test_instruction_set_mock_mode() {
    let ix = XfuelInstruction::SetMockMode { mock_mode: false };
    let data = borsh::to_vec(&ix).unwrap();
    let parsed = XfuelInstruction::try_from_slice(&data).unwrap();
    match parsed {
        XfuelInstruction::SetMockMode { mock_mode } => assert!(!mock_mode),
        _ => panic!("Wrong instruction variant"),
    }
}

// ────────────────────────────────────────────────────────────────
// PDA Derivation Tests
// ────────────────────────────────────────────────────────────────

#[test]
fn test_verifier_state_pda_deterministic() {
    let (pda1, bump1) = find_verifier_state_pda();
    let (pda2, bump2) = find_verifier_state_pda();
    assert_eq!(pda1, pda2);
    assert_eq!(bump1, bump2);
}

#[test]
fn test_circuit_pda_deterministic() {
    let circuit_id = [1u8; 32];
    let (pda1, bump1) = find_circuit_pda(&circuit_id);
    let (pda2, bump2) = find_circuit_pda(&circuit_id);
    assert_eq!(pda1, pda2);
    assert_eq!(bump1, bump2);
}

#[test]
fn test_circuit_pda_unique_per_id() {
    let id_a = [1u8; 32];
    let id_b = [2u8; 32];
    let (pda_a, _) = find_circuit_pda(&id_a);
    let (pda_b, _) = find_circuit_pda(&id_b);
    assert_ne!(pda_a, pda_b);
}

#[test]
fn test_nullifier_pda_deterministic() {
    let nullifier = [0xFF; 32];
    let (pda1, bump1) = find_nullifier_pda(&nullifier);
    let (pda2, bump2) = find_nullifier_pda(&nullifier);
    assert_eq!(pda1, pda2);
    assert_eq!(bump1, bump2);
}

#[test]
fn test_nullifier_pda_unique() {
    let null_a = [0xAA; 32];
    let null_b = [0xBB; 32];
    let (pda_a, _) = find_nullifier_pda(&null_a);
    let (pda_b, _) = find_nullifier_pda(&null_b);
    assert_ne!(pda_a, pda_b);
}

// ────────────────────────────────────────────────────────────────
// BN254 Tests
// ────────────────────────────────────────────────────────────────

#[test]
fn test_bn254_negate_g1_zero_point() {
    let zero_point = [0u8; 64];
    let negated = bn254::negate_g1(&zero_point);
    assert_eq!(negated, zero_point);
}

#[test]
fn test_bn254_negate_g1_nonzero() {
    let mut point = [0u8; 64];
    point[0] = 1; // x = 1
    point[32] = 2; // y = 2
    let negated = bn254::negate_g1(&point);
    assert_eq!(negated[..32], point[..32]); // x unchanged
    assert_ne!(negated[32..], point[32..]); // y negated
}

#[test]
fn test_bn254_ec_add_mock() {
    let a = [0u8; 64];
    let b = [0u8; 64];
    let result = bn254::ec_add(&a, &b).unwrap();
    assert_eq!(result.len(), 64);
}

#[test]
fn test_bn254_ec_mul_mock() {
    let point = [0u8; 64];
    let scalar = [1u8; 32];
    let result = bn254::ec_mul(&point, &scalar).unwrap();
    assert_eq!(result.len(), 64);
}

#[test]
fn test_bn254_ec_pairing_mock_success() {
    let pairs = vec![0u8; 192 * 4]; // 4 pairs
    let result = bn254::ec_pairing(&pairs).unwrap();
    assert!(result); // mock always returns true
}

#[test]
fn test_bn254_ec_pairing_invalid_length() {
    let pairs = vec![0u8; 100]; // not a multiple of 192
    let result = bn254::ec_pairing(&pairs);
    assert!(result.is_err());
}

#[test]
fn test_bn254_verify_groth16_mock() {
    let proof = vec![0u8; 256];
    let public_inputs: Vec<[u8; 32]> = vec![[0u8; 32]; 2];
    // VK: alpha(64) + beta(128) + gamma(128) + delta(128) + 3 IC points (nr_inputs+1)
    let vk_data = vec![0u8; 448 + 3 * 64];
    let result = bn254::verify_groth16(&proof, &public_inputs, &vk_data, 2).unwrap();
    assert!(result);
}

#[test]
fn test_bn254_verify_groth16_wrong_proof_len() {
    let proof = vec![0u8; 128]; // too short
    let public_inputs: Vec<[u8; 32]> = vec![];
    let vk_data = vec![0u8; 448 + 64];
    let result = bn254::verify_groth16(&proof, &public_inputs, &vk_data, 0);
    assert!(result.is_err());
}

#[test]
fn test_bn254_verify_groth16_wrong_vk_len() {
    let proof = vec![0u8; 256];
    let public_inputs: Vec<[u8; 32]> = vec![[0u8; 32]];
    let vk_data = vec![0u8; 100]; // too short
    let result = bn254::verify_groth16(&proof, &public_inputs, &vk_data, 1);
    assert!(result.is_err());
}

#[test]
fn test_bn254_verify_groth16_input_count_mismatch() {
    let proof = vec![0u8; 256];
    let public_inputs: Vec<[u8; 32]> = vec![[0u8; 32]]; // 1 input
    let vk_data = vec![0u8; 448 + 3 * 64]; // VK for 2 inputs
    let result = bn254::verify_groth16(&proof, &public_inputs, &vk_data, 2); // expects 2
    assert!(result.is_err());
}

// ────────────────────────────────────────────────────────────────
// Error Code Tests
// ────────────────────────────────────────────────────────────────

#[test]
fn test_error_codes_unique() {
    let errors = [
        XfuelError::InvalidInstructionData,
        XfuelError::Unauthorized,
        XfuelError::Paused,
        XfuelError::CircuitAlreadyRegistered,
        XfuelError::CircuitNotFound,
        XfuelError::CircuitRegistryFull,
        XfuelError::NullifierAlreadyUsed,
        XfuelError::ProofVerificationFailed,
        XfuelError::InvalidProofLength,
        XfuelError::InvalidPublicInputs,
        XfuelError::InvalidVerifyingKey,
        XfuelError::BatchTooLarge,
        XfuelError::InvalidPDA,
    ];

    let codes: Vec<u32> = errors.iter().map(|e| *e as u32).collect();
    let mut unique = codes.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(codes.len(), unique.len());
}

#[test]
fn test_error_to_program_error() {
    let err: ProgramError = XfuelError::Unauthorized.into();
    match err {
        ProgramError::Custom(code) => assert_eq!(code, 1001),
        _ => panic!("Expected Custom error"),
    }
}

#[test]
fn test_error_display() {
    let err = XfuelError::ProofVerificationFailed;
    let msg = format!("{}", err);
    assert!(msg.contains("ProofVerificationFailed"));
}

// ────────────────────────────────────────────────────────────────
// Constants Tests
// ────────────────────────────────────────────────────────────────

#[test]
fn test_groth16_proof_len() {
    assert_eq!(GROTH16_PROOF_LEN, 256); // A(64) + B(128) + C(64)
}

#[test]
fn test_wormhole_chain_ids() {
    assert_eq!(WORMHOLE_CHAIN_SOLANA, 1);
    assert_eq!(WORMHOLE_CHAIN_ETHEREUM, 2);
    assert_eq!(WORMHOLE_CHAIN_THETA, 25);
}

// ────────────────────────────────────────────────────────────────
// Integration Test Framework (requires test-sbf feature + SBF runtime)
// ────────────────────────────────────────────────────────────────

#[cfg(feature = "test-sbf")]
mod integration {
    use super::*;
    use solana_program_test::*;
    use solana_sdk::{
        instruction::{AccountMeta, Instruction},
        signature::{Keypair, Signer},
        system_program,
        transaction::Transaction,
    };

    fn program_test() -> ProgramTest {
        ProgramTest::new(
            "xfuel_solana_prover",
            crate::id(),
            processor!(crate::process_instruction),
        )
    }

    #[tokio::test]
    async fn test_initialize_verifier() {
        let mut context = program_test().start_with_context().await;
        let admin = &context.payer;
        let (verifier_pda, _) = find_verifier_state_pda();

        let ix_data = borsh::to_vec(&XfuelInstruction::Initialize { mock_mode: true }).unwrap();

        let ix = Instruction {
            program_id: crate::id(),
            accounts: vec![
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new(verifier_pda, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: ix_data,
        };

        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&admin.pubkey()),
            &[admin],
            context.last_blockhash,
        );

        context
            .banks_client
            .process_transaction(tx)
            .await
            .unwrap();

        let account = context
            .banks_client
            .get_account(verifier_pda)
            .await
            .unwrap()
            .unwrap();

        let state = VerifierState::try_from_slice(&account.data).unwrap();
        assert!(state.mock_mode);
        assert!(!state.paused);
        assert_eq!(state.circuit_count, 0);
        assert_eq!(state.total_verified, 0);
    }

    #[tokio::test]
    async fn test_register_and_verify_mock() {
        let mut context = program_test().start_with_context().await;
        let admin = context.payer.insecure_clone();
        let (verifier_pda, _) = find_verifier_state_pda();

        // Initialize
        let init_ix = Instruction {
            program_id: crate::id(),
            accounts: vec![
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new(verifier_pda, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: borsh::to_vec(&XfuelInstruction::Initialize { mock_mode: true }).unwrap(),
        };

        let tx = Transaction::new_signed_with_payer(
            &[init_ix],
            Some(&admin.pubkey()),
            &[&admin],
            context.last_blockhash,
        );
        context
            .banks_client
            .process_transaction(tx)
            .await
            .unwrap();

        // Register circuit
        let circuit_id = [0x01; 32];
        let (circuit_pda, _) = find_circuit_pda(&circuit_id);

        let reg_ix = Instruction {
            program_id: crate::id(),
            accounts: vec![
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new(verifier_pda, false),
                AccountMeta::new(circuit_pda, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: borsh::to_vec(&XfuelInstruction::RegisterCircuit {
                circuit_id,
                program_vkey: [0x02; 32],
                label: "test-circuit".to_string(),
                vk_data: vec![0u8; 448 + 64],
                nr_public_inputs: 0,
            })
            .unwrap(),
        };

        let blockhash = context
            .banks_client
            .get_latest_blockhash()
            .await
            .unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[reg_ix],
            Some(&admin.pubkey()),
            &[&admin],
            blockhash,
        );
        context
            .banks_client
            .process_transaction(tx)
            .await
            .unwrap();

        // Verify state updated
        let state_account = context
            .banks_client
            .get_account(verifier_pda)
            .await
            .unwrap()
            .unwrap();
        let state = VerifierState::try_from_slice(&state_account.data).unwrap();
        assert_eq!(state.circuit_count, 1);

        // Verify proof (mock mode)
        let nullifier = [0xAA; 32];
        let (nullifier_pda, _) = find_nullifier_pda(&nullifier);

        let verify_ix = Instruction {
            program_id: crate::id(),
            accounts: vec![
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new(verifier_pda, false),
                AccountMeta::new(circuit_pda, false),
                AccountMeta::new(nullifier_pda, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: borsh::to_vec(&XfuelInstruction::VerifyProof {
                circuit_id,
                proof: vec![0u8; 256],
                public_values: vec![],
                nullifier,
            })
            .unwrap(),
        };

        let blockhash = context
            .banks_client
            .get_latest_blockhash()
            .await
            .unwrap();
        let tx = Transaction::new_signed_with_payer(
            &[verify_ix],
            Some(&admin.pubkey()),
            &[&admin],
            blockhash,
        );
        context
            .banks_client
            .process_transaction(tx)
            .await
            .unwrap();

        // Verify metrics
        let state_account = context
            .banks_client
            .get_account(verifier_pda)
            .await
            .unwrap()
            .unwrap();
        let state = VerifierState::try_from_slice(&state_account.data).unwrap();
        assert_eq!(state.total_verified, 1);
    }
}
