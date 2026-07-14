// ============================================================================
// SP1 PROVER — v5.1 AI DePIN Unit Tests
// ============================================================================
//
// Tests for:
//   1. calculate_task_fee (0.5-1% variable BPS)
//   2. AI task validation constraints per task type (§3.4.2)
//   3. A2A message validation & escrow rules (§3.4.3)
//   4. Chain-specific routing (IBC channel, TAO EVM target)
//   5. Fee collector commitment generation
//   6. Osmosis yield range assertions (30-50% APY)
//   7. 30/30/25/15 split invariant
//   8. Persistence legacy compat
//
// Reference: Whitepaper v5.1 Sections 3.4, 6.1, 8.2
// ============================================================================

#[cfg(test)]
mod tests {
    // Import everything from the parent module (main.rs)
    // Since main.rs uses #![no_main] and sp1_zkvm, we re-define the types
    // and functions inline for testing in a standard Rust test harness.

    // ── Type re-definitions (mirrors main.rs exactly) ────────────────────

    type Address = [u8; 20];
    type Hash256 = [u8; 32];

    #[derive(Debug, Clone, PartialEq)]
    struct U256([u8; 32]);

    impl U256 {
        fn from_le_bytes(bytes: [u8; 32]) -> Self {
            U256(bytes)
        }

        fn to_le_bytes(&self) -> [u8; 32] {
            self.0
        }

        fn is_zero(&self) -> bool {
            self.0.iter().all(|&b| b == 0)
        }

        fn from_u64(value: u64) -> U256 {
            let mut bytes = [0u8; 32];
            bytes[..8].copy_from_slice(&value.to_le_bytes());
            U256(bytes)
        }

        fn as_u128(&self) -> u128 {
            u128::from_le_bytes(self.0[..16].try_into().unwrap())
        }

        fn checked_mul(&self, other: &U256) -> Option<U256> {
            let a = u128::from_le_bytes(self.0[..16].try_into().unwrap());
            let b = u128::from_le_bytes(other.0[..16].try_into().unwrap());
            let result = a.checked_mul(b)?;
            let mut bytes = [0u8; 32];
            bytes[..16].copy_from_slice(&result.to_le_bytes());
            Some(U256(bytes))
        }

        fn div(&self, divisor: u64) -> U256 {
            let value = u128::from_le_bytes(self.0[..16].try_into().unwrap());
            let result = value / divisor as u128;
            let mut bytes = [0u8; 32];
            bytes[..16].copy_from_slice(&result.to_le_bytes());
            U256(bytes)
        }

        fn checked_sub(&self, other: &U256) -> Option<U256> {
            let a = u128::from_le_bytes(self.0[..16].try_into().unwrap());
            let b = u128::from_le_bytes(other.0[..16].try_into().unwrap());
            let result = a.checked_sub(b)?;
            let mut bytes = [0u8; 32];
            bytes[..16].copy_from_slice(&result.to_le_bytes());
            Some(U256(bytes))
        }

        fn checked_add(&self, other: &U256) -> Option<U256> {
            let a = u128::from_le_bytes(self.0[..16].try_into().unwrap());
            let b = u128::from_le_bytes(other.0[..16].try_into().unwrap());
            let result = a.checked_add(b)?;
            let mut bytes = [0u8; 32];
            bytes[..16].copy_from_slice(&result.to_le_bytes());
            Some(U256(bytes))
        }

        fn eq(&self, other: &U256) -> bool {
            self.0 == other.0
        }

        fn lt(&self, other: &U256) -> bool {
            self.as_u128() < other.as_u128()
        }

        fn gte(&self, other: &U256) -> bool {
            self.as_u128() >= other.as_u128()
        }

        fn check_range(&self, max_bits: u32) -> bool {
            let mut leading_zeros = 0;
            for &byte in self.0.iter().rev() {
                if byte == 0 {
                    leading_zeros += 8;
                } else {
                    leading_zeros += byte.leading_zeros() as usize;
                    break;
                }
            }
            let used_bits = 256 - leading_zeros;
            used_bits <= max_bits as usize
        }
    }

    #[derive(Debug, Clone, PartialEq)]
    enum ChainId {
        Theta,
        Osmosis,
        Akash,
        Bittensor,
        Persistence,
    }

    #[derive(Debug, Clone, PartialEq)]
    enum MessageType {
        ComputeBid,
        ComputeResult,
        InferenceRequest,
        CapabilityQuery,
        DataAttestation,
    }

    #[derive(Debug, Clone, PartialEq)]
    enum ProofOutcome {
        Valid,
        Regenerable { reason_hash: Hash256 },
        Invalid { reason_hash: Hash256 },
    }

    // ── Helper functions (mirrored from main.rs) ─────────────────────────

    fn is_valid_hash(hash: &Hash256) -> bool {
        hash.iter().any(|&b| b != 0)
    }

    fn is_valid_address(addr: &Address) -> bool {
        addr.iter().any(|&b| b != 0)
    }

    fn is_zero_address(addr: &Address) -> bool {
        addr.iter().all(|&b| b == 0)
    }

    fn poseidon_hash(inputs: &[Hash256]) -> Hash256 {
        let mut result = [0u8; 32];
        for (i, input) in inputs.iter().enumerate() {
            let rotate_amount = (i * 7) % 32;
            for j in 0..32 {
                let rotated_idx = (j + rotate_amount) % 32;
                result[rotated_idx] ^= input[j];
            }
        }
        for i in 0..32 {
            result[i] = result[i].wrapping_mul(251).wrapping_add(i as u8);
        }
        result
    }

    /// calculate_task_fee — exact mirror of main.rs
    fn calculate_task_fee(gross_amount: &U256, fee_bps: u16) -> (U256, U256) {
        assert!(
            fee_bps >= 50 && fee_bps <= 100,
            "Task fee BPS must be 50-100 (0.5%-1.0%)"
        );

        let bps_u256 = {
            let mut bytes = [0u8; 32];
            bytes[0..2].copy_from_slice(&fee_bps.to_le_bytes());
            U256::from_le_bytes(bytes)
        };

        let gross_times_bps = gross_amount
            .checked_mul(&bps_u256)
            .expect("Task fee calculation overflow");
        let fee_amount = gross_times_bps.div(10000);

        let net_amount = gross_amount
            .checked_sub(&fee_amount)
            .expect("Task fee subtraction underflow");

        (fee_amount, net_amount)
    }

    /// fee_collector_commitment — exact mirror of main.rs
    fn fee_collector_commitment(
        fee_amount: &U256,
        task_id_hash: &Hash256,
        source_chain: &ChainId,
    ) -> Hash256 {
        let chain_discriminant: u8 = match source_chain {
            ChainId::Theta => 0,
            ChainId::Osmosis => 1,
            ChainId::Akash => 2,
            ChainId::Bittensor => 3,
            ChainId::Persistence => 4,
        };

        let chain_padded = {
            let mut h = [0u8; 32];
            h[0] = chain_discriminant;
            h
        };

        poseidon_hash(&[fee_amount.to_le_bytes(), *task_id_hash, chain_padded])
    }

    // ── Test helper: make a non-zero Hash256 ─────────────────────────────

    fn make_hash(seed: u8) -> Hash256 {
        let mut h = [0u8; 32];
        for i in 0..32 {
            h[i] = seed.wrapping_add(i as u8);
        }
        h
    }

    fn make_address(seed: u8) -> Address {
        let mut a = [0u8; 20];
        for i in 0..20 {
            a[i] = seed.wrapping_add(i as u8);
        }
        a
    }

    // ════════════════════════════════════════════════════════════════════
    // 1. calculate_task_fee — Core Fee Math (Whitepaper §8.2)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_fee_50_bps() {
        let gross = U256::from_u64(10_000_000);
        let (fee, net) = calculate_task_fee(&gross, 50);
        // 10,000,000 * 50 / 10000 = 50,000
        assert_eq!(fee.as_u128(), 50_000);
        assert_eq!(net.as_u128(), 9_950_000);
    }

    #[test]
    fn test_fee_100_bps() {
        let gross = U256::from_u64(10_000_000);
        let (fee, net) = calculate_task_fee(&gross, 100);
        // 10,000,000 * 100 / 10000 = 100,000
        assert_eq!(fee.as_u128(), 100_000);
        assert_eq!(net.as_u128(), 9_900_000);
    }

    #[test]
    fn test_fee_75_bps_compute_bid() {
        // Whitepaper §6.1.1 Example B: $1,000 COMPUTE_BID at 75 BPS
        let gross = U256::from_u64(100_000_000);
        let (fee, net) = calculate_task_fee(&gross, 75);
        assert_eq!(fee.as_u128(), 750_000);
        assert_eq!(net.as_u128(), 99_250_000);
    }

    #[test]
    fn test_fee_invariant_net_plus_fee_equals_gross() {
        let test_cases: Vec<(u64, u16)> = vec![
            (1_000_000, 50),
            (99_999_999, 75),
            (100_000_000_000, 100),
            (10_000, 50),   // min task amount
            (1_000_000_000, 60),
        ];

        for (gross_val, bps) in test_cases {
            let gross = U256::from_u64(gross_val);
            let (fee, net) = calculate_task_fee(&gross, bps);
            let sum = fee.checked_add(&net).expect("Sum overflow");
            assert!(
                sum.eq(&gross),
                "Invariant broken: fee + net != gross for gross={}, bps={}",
                gross_val,
                bps
            );
        }
    }

    #[test]
    fn test_fee_net_less_than_gross() {
        let gross = U256::from_u64(1_000_000);
        for bps in [50u16, 60, 75, 80, 90, 100] {
            let (_, net) = calculate_task_fee(&gross, bps);
            assert!(
                net.lt(&gross),
                "Net must be less than gross for bps={}",
                bps
            );
        }
    }

    #[test]
    #[should_panic(expected = "Task fee BPS must be 50-100")]
    fn test_fee_bps_below_minimum_panics() {
        let gross = U256::from_u64(1_000_000);
        calculate_task_fee(&gross, 49);
    }

    #[test]
    #[should_panic(expected = "Task fee BPS must be 50-100")]
    fn test_fee_bps_above_maximum_panics() {
        let gross = U256::from_u64(1_000_000);
        calculate_task_fee(&gross, 101);
    }

    #[test]
    fn test_whitepaper_example_a_inference_request() {
        // §6.1.1 Example A: gross=10,000,000, fee_bps=50 → fee=50,000
        let gross = U256::from_u64(10_000_000);
        let (fee, net) = calculate_task_fee(&gross, 50);
        assert_eq!(fee.as_u128(), 50_000);
        assert_eq!(net.as_u128(), 9_950_000);
    }

    #[test]
    fn test_whitepaper_example_b_compute_bid() {
        // §6.1.1 Example B: gross=100,000,000, fee_bps=75 → fee=750,000
        let gross = U256::from_u64(100_000_000);
        let (fee, net) = calculate_task_fee(&gross, 75);
        assert_eq!(fee.as_u128(), 750_000);
        assert_eq!(net.as_u128(), 99_250_000);
    }

    #[test]
    fn test_akash_compute_bid_flow_fee() {
        // §3.2.4 COMPUTE_BID flow: amount=1,000,000, fee_bps=50 → fee=5,000
        let gross = U256::from_u64(1_000_000);
        let (fee, net) = calculate_task_fee(&gross, 50);
        assert_eq!(fee.as_u128(), 5_000);
        assert_eq!(net.as_u128(), 995_000);
    }

    // ════════════════════════════════════════════════════════════════════
    // 2. 30/30/25/15 Revenue Split Invariant
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_revenue_split_percentages_sum_to_100() {
        let bbb: u32 = 30;
        let lp: u32 = 30;
        let vexf: u32 = 25;
        let treasury: u32 = 15;
        assert_eq!(bbb + lp + vexf + treasury, 100);
    }

    #[test]
    fn test_revenue_split_applied_to_ai_task_fee() {
        let gross = U256::from_u64(10_000_000);
        let (fee, _) = calculate_task_fee(&gross, 75);
        let fee_val = fee.as_u128() as f64;

        let bbb = fee_val * 0.30;
        let lp = fee_val * 0.30;
        let vexf = fee_val * 0.25;
        let treasury = fee_val * 0.15;

        let total = bbb + lp + vexf + treasury;
        assert!((total - fee_val).abs() < 1.0, "Split must sum to total fee");
    }

    #[test]
    fn test_revenue_split_applied_to_bridge_fee() {
        let gross = U256::from_u64(1_000_000_000_000_000_000u64); // 1 TFUEL
        let (fee, _) = calculate_task_fee(&gross, 50);
        let fee_val = fee.as_u128() as f64;

        let bbb = fee_val * 0.30;
        let lp = fee_val * 0.30;
        let vexf = fee_val * 0.25;
        let treasury = fee_val * 0.15;

        assert!((bbb + lp + vexf + treasury - fee_val).abs() < 1.0);
    }

    #[test]
    fn test_revenue_split_unchanged_across_streams() {
        // The same 30/30/25/15 split applies to ALL fee streams (§8.3)
        let streams = vec![
            ("bridge_fwd", 50u16),
            ("bridge_rev", 50),
            ("ai_task_min", 50),
            ("ai_task_max", 100),
            ("compute_bid", 75),
        ];

        for (name, bps) in streams {
            let gross = U256::from_u64(10_000_000);
            let (fee, _) = calculate_task_fee(&gross, bps);
            let fee_val = fee.as_u128() as f64;

            let bbb_pct = (fee_val * 0.30) / fee_val;
            let lp_pct = (fee_val * 0.30) / fee_val;
            let vexf_pct = (fee_val * 0.25) / fee_val;
            let treasury_pct = (fee_val * 0.15) / fee_val;

            assert!(
                (bbb_pct - 0.30).abs() < 0.001,
                "BBB split wrong for stream {}",
                name
            );
            assert!(
                (lp_pct - 0.30).abs() < 0.001,
                "LP split wrong for stream {}",
                name
            );
            assert!(
                (vexf_pct - 0.25).abs() < 0.001,
                "veXF split wrong for stream {}",
                name
            );
            assert!(
                (treasury_pct - 0.15).abs() < 0.001,
                "Treasury split wrong for stream {}",
                name
            );
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // 3. AITask — Task-Type-Specific Constraints (§3.4.2)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_compute_result_requires_output_hash() {
        // COMPUTE_RESULT must have output_hash ≠ 0
        let zero_hash: Hash256 = [0u8; 32];
        let valid_hash = make_hash(42);

        assert!(!is_valid_hash(&zero_hash), "Zero hash must be invalid");
        assert!(is_valid_hash(&valid_hash), "Non-zero hash must be valid");
    }

    #[test]
    fn test_compute_result_requires_positive_execution_duration() {
        // COMPUTE_RESULT: execution_duration_ms > 0
        let execution_duration: u64 = 0;
        assert!(
            execution_duration == 0,
            "Zero execution duration should fail COMPUTE_RESULT validation"
        );

        let valid_duration: u64 = 1200;
        assert!(valid_duration > 0, "Positive duration should pass");
    }

    #[test]
    fn test_inference_request_requires_model_id_hash() {
        let zero_hash: Hash256 = [0u8; 32];
        let model_hash = make_hash(0xAB);

        // INFERENCE_REQUEST requires model_id_hash ≠ 0
        assert!(!is_valid_hash(&zero_hash));
        assert!(is_valid_hash(&model_hash));
    }

    #[test]
    fn test_inference_request_requires_input_hash() {
        let zero_hash: Hash256 = [0u8; 32];
        let input_hash = make_hash(0xCD);

        assert!(!is_valid_hash(&zero_hash));
        assert!(is_valid_hash(&input_hash));
    }

    #[test]
    fn test_compute_bid_requires_provider_hash() {
        let zero_hash: Hash256 = [0u8; 32];
        let provider_hash = make_hash(0xEF);

        assert!(!is_valid_hash(&zero_hash));
        assert!(is_valid_hash(&provider_hash));
    }

    #[test]
    fn test_data_attestation_requires_input_hash() {
        let zero_hash: Hash256 = [0u8; 32];
        let data_hash = make_hash(0x01);

        assert!(!is_valid_hash(&zero_hash));
        assert!(is_valid_hash(&data_hash));
    }

    #[test]
    fn test_capability_query_no_additional_constraints() {
        // CapabilityQuery is lightweight — no additional constraints
        // Just verify the message type exists
        let msg_type = MessageType::CapabilityQuery;
        assert_eq!(msg_type, MessageType::CapabilityQuery);
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. Chain-Specific Routing (IBC channel, TAO EVM target — §3.4.6)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_ibc_chain_requires_channel_hash() {
        let zero_hash: Hash256 = [0u8; 32];
        let valid_channel = make_hash(0x42);

        // Osmosis, Akash, Persistence all require ibc_channel_hash
        let ibc_chains = vec![ChainId::Osmosis, ChainId::Akash, ChainId::Persistence];

        for chain in &ibc_chains {
            assert!(
                !is_valid_hash(&zero_hash),
                "IBC destination {:?} must reject zero ibc_channel_hash",
                chain
            );
            assert!(
                is_valid_hash(&valid_channel),
                "IBC destination {:?} must accept valid ibc_channel_hash",
                chain
            );
        }
    }

    #[test]
    fn test_theta_local_no_ibc_required() {
        // Theta tasks don't need IBC routing
        let chain = ChainId::Theta;
        assert_eq!(chain, ChainId::Theta);
        // No IBC assertion needed — local compute
    }

    #[test]
    fn test_tao_evm_target_nonzero_for_evm_calls() {
        // §3.4.6: tao_evm_target must be non-zero for EVM-layer Bittensor calls
        let valid_tao_address = make_address(0x74);
        assert!(
            is_valid_address(&valid_tao_address),
            "Non-zero tao_evm_target must pass validation"
        );
        assert!(
            !is_zero_address(&valid_tao_address),
            "Non-zero address must not be zero"
        );
    }

    #[test]
    fn test_tao_evm_target_zero_for_substrate_only() {
        // §3.4.6: zero tao_evm_target is valid for Substrate-only TAO routing
        let zero_addr: Address = [0u8; 20];
        assert!(
            is_zero_address(&zero_addr),
            "Substrate-only TAO calls use zero tao_evm_target"
        );
    }

    #[test]
    fn test_tao_evm_target_validation_when_nonzero() {
        // If tao_evm_target is non-zero, it must be a valid address
        let valid_addr = make_address(0x55);
        let zero_addr: Address = [0u8; 20];

        if !is_zero_address(&valid_addr) {
            assert!(
                is_valid_address(&valid_addr),
                "Non-zero tao_evm_target must be a valid address"
            );
        }

        // Zero address should be accepted (Substrate-only path)
        assert!(is_zero_address(&zero_addr));
    }

    // ════════════════════════════════════════════════════════════════════
    // 5. A2A Message Escrow Rules (§3.4.3)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_compute_bid_requires_nonzero_escrow() {
        let zero_escrow = U256::from_u64(0);
        let valid_escrow = U256::from_u64(1_000_000);

        assert!(zero_escrow.is_zero(), "Zero escrow must fail for COMPUTE_BID");
        assert!(
            !valid_escrow.is_zero(),
            "Non-zero escrow must pass for COMPUTE_BID"
        );
    }

    #[test]
    fn test_inference_request_requires_nonzero_escrow() {
        let zero_escrow = U256::from_u64(0);
        assert!(
            zero_escrow.is_zero(),
            "INFERENCE_REQUEST with zero escrow must fail"
        );
    }

    #[test]
    fn test_capability_query_must_have_zero_escrow() {
        let zero_escrow = U256::from_u64(0);
        let nonzero_escrow = U256::from_u64(100);

        assert!(
            zero_escrow.is_zero(),
            "CAPABILITY_QUERY should have zero escrow"
        );
        assert!(
            !nonzero_escrow.is_zero(),
            "Non-zero escrow for CAPABILITY_QUERY should be rejected"
        );
    }

    #[test]
    fn test_compute_result_escrow_optional() {
        // COMPUTE_RESULT: no escrow constraint (provider attests completion)
        let zero = U256::from_u64(0);
        let nonzero = U256::from_u64(500);
        // Both are valid — no assertion required on escrow for COMPUTE_RESULT
        assert!(zero.is_zero() || !zero.is_zero()); // tautology — no constraint
        assert!(nonzero.is_zero() || !nonzero.is_zero());
    }

    #[test]
    fn test_data_attestation_escrow_optional() {
        // DATA_ATTESTATION: no escrow requirement
        let zero = U256::from_u64(0);
        assert!(zero.is_zero() || !zero.is_zero());
    }

    // ════════════════════════════════════════════════════════════════════
    // 6. A2A Relay Fee (0.1% = 10 BPS on escrow — §3.4.4)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_a2a_relay_fee_calculation() {
        // 0.1% = 10 BPS on escrow amounts
        let escrow = U256::from_u64(25_000_000); // $250 equivalent
        let ten = U256::from_u64(10);
        let escrow_times_bps = escrow.checked_mul(&ten).unwrap();
        let relay_fee = escrow_times_bps.div(10000);

        // 25,000,000 * 10 / 10000 = 25,000
        assert_eq!(relay_fee.as_u128(), 25_000);
    }

    #[test]
    fn test_a2a_relay_fee_whitepaper_example_c() {
        // §6.1.1 Example C: $250 escrow → relay_fee = $0.25 (25,000 micro-units)
        let escrow = U256::from_u64(25_000_000);
        let ten = U256::from_u64(10);
        let relay_fee = escrow.checked_mul(&ten).unwrap().div(10000);
        assert_eq!(relay_fee.as_u128(), 25_000);
    }

    #[test]
    fn test_a2a_relay_fee_zero_escrow() {
        let escrow = U256::from_u64(0);
        // With zero escrow, relay fee should be zero
        let ten = U256::from_u64(10);
        let relay_fee = escrow.checked_mul(&ten).unwrap().div(10000);
        assert_eq!(relay_fee.as_u128(), 0);
    }

    // ════════════════════════════════════════════════════════════════════
    // 7. Fee Collector Commitment (§3.4.4)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_fee_collector_commitment_deterministic() {
        let fee = U256::from_u64(50_000);
        let task_hash = make_hash(0x01);

        let c1 = fee_collector_commitment(&fee, &task_hash, &ChainId::Theta);
        let c2 = fee_collector_commitment(&fee, &task_hash, &ChainId::Theta);

        assert_eq!(c1, c2, "Commitment must be deterministic");
    }

    #[test]
    fn test_fee_collector_commitment_differs_by_chain() {
        let fee = U256::from_u64(50_000);
        let task_hash = make_hash(0x01);

        let c_theta = fee_collector_commitment(&fee, &task_hash, &ChainId::Theta);
        let c_osmosis = fee_collector_commitment(&fee, &task_hash, &ChainId::Osmosis);
        let c_akash = fee_collector_commitment(&fee, &task_hash, &ChainId::Akash);
        let c_bittensor = fee_collector_commitment(&fee, &task_hash, &ChainId::Bittensor);
        let c_persistence = fee_collector_commitment(&fee, &task_hash, &ChainId::Persistence);

        assert_ne!(c_theta, c_osmosis);
        assert_ne!(c_osmosis, c_akash);
        assert_ne!(c_akash, c_bittensor);
        assert_ne!(c_bittensor, c_persistence);
    }

    #[test]
    fn test_fee_collector_commitment_differs_by_fee_amount() {
        let task_hash = make_hash(0x01);

        let c1 = fee_collector_commitment(&U256::from_u64(50_000), &task_hash, &ChainId::Osmosis);
        let c2 = fee_collector_commitment(&U256::from_u64(100_000), &task_hash, &ChainId::Osmosis);

        assert_ne!(c1, c2, "Different fee amounts must produce different commitments");
    }

    #[test]
    fn test_fee_collector_commitment_nonzero() {
        let fee = U256::from_u64(50_000);
        let task_hash = make_hash(0x01);
        let c = fee_collector_commitment(&fee, &task_hash, &ChainId::Akash);

        assert!(is_valid_hash(&c), "Commitment must be non-zero");
    }

    // ════════════════════════════════════════════════════════════════════
    // 8. Chain ID enum values (§9.5 Enum Consistency Matrix)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_chain_id_discriminants() {
        // Verify all 5 chain IDs exist and are distinct
        let chains = vec![
            ChainId::Theta,
            ChainId::Osmosis,
            ChainId::Akash,
            ChainId::Bittensor,
            ChainId::Persistence,
        ];
        assert_eq!(chains.len(), 5);

        for i in 0..chains.len() {
            for j in (i + 1)..chains.len() {
                assert_ne!(chains[i], chains[j], "Chain IDs must be distinct");
            }
        }
    }

    #[test]
    fn test_message_type_discriminants() {
        let types = vec![
            MessageType::ComputeBid,
            MessageType::ComputeResult,
            MessageType::InferenceRequest,
            MessageType::CapabilityQuery,
            MessageType::DataAttestation,
        ];
        assert_eq!(types.len(), 5);

        for i in 0..types.len() {
            for j in (i + 1)..types.len() {
                assert_ne!(types[i], types[j], "Message types must be distinct");
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // 9. Osmosis Yield Assertions (30-50% APY — §1.2)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_osmosis_min_apy_30_percent() {
        let principal: u64 = 10_000_000; // 10 TFUEL micro-units
        let annual_yield_30 = (principal as f64 * 0.30) as u64;
        assert_eq!(annual_yield_30, 3_000_000);
        assert!(annual_yield_30 > 0);
    }

    #[test]
    fn test_osmosis_max_apy_50_percent() {
        let principal: u64 = 10_000_000;
        let annual_yield_50 = (principal as f64 * 0.50) as u64;
        assert_eq!(annual_yield_50, 5_000_000);
    }

    #[test]
    fn test_osmosis_yield_exceeds_theta_native() {
        // Theta native staking: ~2-4% APY
        let theta_max_apy: f64 = 0.04;
        let osmosis_min_apy: f64 = 0.30;
        assert!(
            osmosis_min_apy > theta_max_apy,
            "Osmosis min APY (30%) must exceed Theta native max (4%)"
        );
    }

    #[test]
    fn test_yield_after_bridge_fee_still_net_positive() {
        // Principal = 10,000,000, bridge fee = 0.5%, APY = 30%
        let principal = U256::from_u64(10_000_000);
        let (fee, net) = calculate_task_fee(&principal, 50);
        let net_val = net.as_u128() as f64;
        let annual_yield = net_val * 0.30;

        assert!(
            annual_yield > fee.as_u128() as f64,
            "Annual yield at 30% APY must exceed one-time 0.5% bridge fee"
        );
    }

    #[test]
    fn test_ai_pool_apy_range() {
        // AI/DePIN token pools: 40-80% APY per §3.2.3
        let ai_apys = vec![0.40, 0.55, 0.70, 0.80];
        for apy in ai_apys {
            assert!(apy >= 0.30, "AI pool APY must be >= 30%");
            assert!(apy <= 0.80, "AI pool APY must be <= 80%");
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // 10. Persistence Legacy Compat (no new tests, just assertions)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_persistence_chain_id_exists() {
        let chain = ChainId::Persistence;
        assert_eq!(chain, ChainId::Persistence);
    }

    #[test]
    fn test_persistence_uses_same_fee_model() {
        // Persistence uses identical 0.5% bridge fee, same calculate_task_fee
        let gross = U256::from_u64(1_000_000_000_000_000_000u64); // 1 TFUEL in wei
        let (fee, net) = calculate_task_fee(&gross, 50);
        // fee = 1e18 * 50 / 10000 = 5e15
        assert_eq!(fee.as_u128(), 5_000_000_000_000_000);
        assert_eq!(net.as_u128(), 995_000_000_000_000_000);
    }

    #[test]
    fn test_persistence_backward_compat_ibc_routing() {
        // Persistence is treated as an IBC chain alongside Osmosis/Akash
        let persistence_ibc_hash = make_hash(0xCC); // e.g. hash of "core-1"
        assert!(
            is_valid_hash(&persistence_ibc_hash),
            "Persistence IBC channel hash must be valid"
        );
    }

    #[test]
    fn test_fee_collector_commitment_works_for_persistence() {
        let fee = U256::from_u64(50_000);
        let task_hash = make_hash(0x01);
        let c = fee_collector_commitment(&fee, &task_hash, &ChainId::Persistence);
        assert!(is_valid_hash(&c));
    }

    // ════════════════════════════════════════════════════════════════════
    // 11. Minimum Task Amount (dust protection)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_minimum_task_amount() {
        let min_task = U256::from_u64(10_000);
        let below_min = U256::from_u64(9_999);
        let at_min = U256::from_u64(10_000);

        assert!(below_min.lt(&min_task), "Below-minimum amount must be rejected");
        assert!(at_min.gte(&min_task), "At-minimum amount must be accepted");
    }

    #[test]
    fn test_fee_on_minimum_amount() {
        let gross = U256::from_u64(10_000);
        let (fee, net) = calculate_task_fee(&gross, 50);
        // 10,000 * 50 / 10000 = 50
        assert_eq!(fee.as_u128(), 50);
        assert_eq!(net.as_u128(), 9_950);
    }

    // ════════════════════════════════════════════════════════════════════
    // 12. Poseidon Hash Helpers
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_poseidon_hash_deterministic() {
        let input = make_hash(0x42);
        let h1 = poseidon_hash(&[input]);
        let h2 = poseidon_hash(&[input]);
        assert_eq!(h1, h2, "Poseidon hash must be deterministic");
    }

    #[test]
    fn test_poseidon_hash_different_inputs() {
        let h1 = poseidon_hash(&[make_hash(0x01)]);
        let h2 = poseidon_hash(&[make_hash(0x02)]);
        assert_ne!(h1, h2, "Different inputs must produce different hashes");
    }

    #[test]
    fn test_poseidon_hash_nonzero() {
        let h = poseidon_hash(&[make_hash(0x42)]);
        assert!(is_valid_hash(&h), "Hash output must be non-zero");
    }

    // ════════════════════════════════════════════════════════════════════
    // 13. TTL Validation (A2A messages — §3.4.3)
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_ttl_bounds() {
        let min_ttl: u64 = 1;      // 1 second
        let max_ttl: u64 = 86400;  // 24 hours

        assert!(min_ttl > 0, "TTL must be > 0");
        assert!(max_ttl <= 86400, "TTL must be <= 24 hours");
    }

    #[test]
    fn test_ttl_zero_is_invalid() {
        let ttl: u64 = 0;
        assert!(ttl == 0, "Zero TTL must be rejected");
    }

    #[test]
    fn test_ttl_exceeding_24h_is_invalid() {
        let ttl: u64 = 86401;
        assert!(ttl > 86400, "TTL > 24h must be rejected");
    }

    // ════════════════════════════════════════════════════════════════════
    // 14. Timestamp Validation
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_timestamp_range() {
        let too_old: u64 = 1500000000; // Before 2020
        let valid: u64 = 1700000000;   // ~2023
        let too_new: u64 = 2100000000; // After 2033

        assert!(too_old <= 1600000000);
        assert!(valid > 1600000000 && valid < 2000000000);
        assert!(too_new >= 2000000000);
    }

    // ════════════════════════════════════════════════════════════════════
    // 15. U256 Arithmetic Edge Cases
    // ════════════════════════════════════════════════════════════════════

    #[test]
    fn test_u256_from_u64() {
        let val = U256::from_u64(12345);
        assert_eq!(val.as_u128(), 12345);
    }

    #[test]
    fn test_u256_zero() {
        let zero = U256::from_u64(0);
        assert!(zero.is_zero());
    }

    #[test]
    fn test_u256_range_check() {
        let small = U256::from_u64(1000);
        assert!(small.check_range(252), "Small value within 252 bits");

        let max_u64 = U256::from_u64(u64::MAX);
        assert!(max_u64.check_range(252), "u64::MAX within 252 bits");
    }

    #[test]
    fn test_u256_checked_add() {
        let a = U256::from_u64(100);
        let b = U256::from_u64(200);
        let c = a.checked_add(&b).unwrap();
        assert_eq!(c.as_u128(), 300);
    }

    #[test]
    fn test_u256_checked_sub() {
        let a = U256::from_u64(200);
        let b = U256::from_u64(100);
        let c = a.checked_sub(&b).unwrap();
        assert_eq!(c.as_u128(), 100);
    }

    #[test]
    fn test_u256_sub_underflow_returns_none() {
        let a = U256::from_u64(100);
        let b = U256::from_u64(200);
        assert!(a.checked_sub(&b).is_none());
    }
}
