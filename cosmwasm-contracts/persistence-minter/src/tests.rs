use cosmwasm_std::{Addr, Coin, Empty, Uint128};
use cw_multi_test::{App, AppBuilder, Contract, ContractWrapper, Executor};

use crate::contract::{execute, instantiate, query};
use crate::msg::{
    ConfigResponse, ExecuteMsg, InstantiateMsg, QueryMsg, StateResponse, ZkProof,
};
use cw20::{BalanceResponse, TokenInfoResponse};

// Import FeeCollector for integration tests
use cosmwasm_std::to_json_binary;

pub fn contract_minter() -> Box<dyn Contract<Empty>> {
    let contract = ContractWrapper::new(execute, instantiate, query);
    Box::new(contract)
}

const ADMIN: &str = "persistence1admin";
const USER1: &str = "persistence1user1";
const USER2: &str = "persistence1user2";
const VERIFIER: &str = "persistence1000000000000000000000000000000000000"; // Dummy address
const REV_SPLITTER: &str = "persistence1111111111111111111111111111111111111"; // Dummy address
const FEE_COLLECTOR: &str = "persistence1feecollector0000000000000000000000000000000000"; // Dummy address

fn mock_app() -> App {
    AppBuilder::new().build(|router, _, storage| {
        router
            .bank
            .init_balance(
                storage,
                &Addr::unchecked(ADMIN),
                vec![Coin {
                    denom: "uxprt".to_string(),
                    amount: Uint128::new(100_000_000_000_000_000_000), // 100 XPRT
                }],
            )
            .unwrap();
    })
}

fn setup_contract(app: &mut App) -> Addr {
    let code_id = app.store_code(contract_minter());

    let msg = InstantiateMsg {
        name: "IBC Theta Fuel".to_string(),
        symbol: "IBCTFUEL".to_string(),
        decimals: 18,
        initial_balances: vec![],
        mint_cap: Some(Uint128::new(1_000_000_000_000_000_000_000_000)), // 1M tokens
        marketing: None,
        verifier_address: VERIFIER.to_string(),
        rev_splitter_address: REV_SPLITTER.to_string(),
        fee_collector_address: FEE_COLLECTOR.to_string(),
        mock_mode: Some(true), // Enable mock mode for testing
    };

    app.instantiate_contract(
        code_id,
        Addr::unchecked(ADMIN),
        &msg,
        &[],
        "XFuel Minter",
        None,
    )
    .unwrap()
}

fn create_valid_proof(amount: Uint128, recipient: &str) -> ZkProof {
    ZkProof {
        proof_data: "valid_proof_data_12345".to_string(),
        public_inputs: vec![
            amount.to_string(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        ],
        verification_key: "vk_xfuel_v1".to_string(),
    }
}

#[test]
fn test_instantiate() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Query token info
    let token_info: TokenInfoResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::TokenInfo {})
        .unwrap();

    assert_eq!(token_info.name, "IBC Theta Fuel");
    assert_eq!(token_info.symbol, "IBCTFUEL");
    assert_eq!(token_info.decimals, 18);
    assert_eq!(token_info.total_supply, Uint128::zero());

    // Query config
    let config: ConfigResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::Config {})
        .unwrap();

    assert_eq!(config.admin, Addr::unchecked(ADMIN));
    assert_eq!(config.verifier_address, Addr::unchecked(VERIFIER));
    assert_eq!(config.rev_splitter_address, Addr::unchecked(REV_SPLITTER));
    assert!(!config.paused);
}

#[test]
fn test_verify_and_mint() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    let mint_amount = Uint128::new(1_000_000_000_000_000_000); // 1 token
    let proof = create_valid_proof(mint_amount, USER1);

    // Execute verify and mint
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Check events
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "action" && attr.value == "verify_and_mint"
    )));

    // Query balance
    let balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    assert_eq!(balance.balance, mint_amount);

    // Query state
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_minted, mint_amount);
    assert_eq!(state.total_burned, Uint128::zero());
}

#[test]
fn test_verify_and_mint_duplicate_proof() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    let mint_amount = Uint128::new(1_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);

    // First mint should succeed
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof.clone(),
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Second mint with same proof should fail
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Proof already processed"));
}

#[test]
fn test_burn_and_unwrap() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // First mint some tokens
    let mint_amount = Uint128::new(10_000_000_000_000_000_000); // 10 tokens
    let proof = create_valid_proof(mint_amount, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Burn half the tokens
    let burn_amount = Uint128::new(5_000_000_000_000_000_000); // 5 tokens
    let msg = ExecuteMsg::BurnAndUnwrap {
        amount: burn_amount,
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Check burn event
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "action" && attr.value == "burn_and_unwrap"
    )));

    // Verify revenue split in events
    let recycled = burn_amount.multiply_ratio(30u128, 100u128);
    let lp_reinvest = burn_amount.multiply_ratio(70u128, 100u128);

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "recycled_amount" && attr.value == recycled.to_string()
    )));

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "lp_reinvest_amount" && attr.value == lp_reinvest.to_string()
    )));

    // Query remaining balance
    let balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    assert_eq!(balance.balance, mint_amount - burn_amount);

    // Query state
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_burned, burn_amount);
    assert_eq!(state.total_recycled, recycled);
    assert_eq!(state.total_lp_reinvest, lp_reinvest);
}

#[test]
fn test_pause_unpause() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Pause contract
    let msg = ExecuteMsg::Pause {};
    app.execute_contract(Addr::unchecked(ADMIN), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Query config to verify paused
    let config: ConfigResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::Config {})
        .unwrap();
    assert!(config.paused);

    // Try to mint while paused (should fail)
    let mint_amount = Uint128::new(1_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("paused"));

    // Unpause contract
    let msg = ExecuteMsg::Unpause {};
    app.execute_contract(Addr::unchecked(ADMIN), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Query config to verify unpaused
    let config: ConfigResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::Config {})
        .unwrap();
    assert!(!config.paused);
}

#[test]
fn test_set_verifier() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    let new_verifier = "persistence1newverifier";

    // Set new verifier
    let msg = ExecuteMsg::SetVerifier {
        verifier_address: new_verifier.to_string(),
    };

    app.execute_contract(Addr::unchecked(ADMIN), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Query config
    let config: ConfigResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::Config {})
        .unwrap();

    assert_eq!(config.verifier_address, Addr::unchecked(new_verifier));
}

#[test]
fn test_unauthorized_admin_action() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Try to pause as non-admin
    let msg = ExecuteMsg::Pause {};
    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Unauthorized"));
}

#[test]
fn test_cw20_transfer() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens to USER1
    let mint_amount = Uint128::new(10_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Transfer tokens from USER1 to USER2
    let transfer_amount = Uint128::new(3_000_000_000_000_000_000);
    let msg = ExecuteMsg::Transfer {
        recipient: USER2.to_string(),
        amount: transfer_amount,
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Check balances
    let user1_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    let user2_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr,
            &QueryMsg::Balance {
                address: USER2.to_string(),
            },
        )
        .unwrap();

    assert_eq!(user1_balance.balance, mint_amount - transfer_amount);
    assert_eq!(user2_balance.balance, transfer_amount);
}

#[test]
fn test_mint_cap() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Try to mint more than cap
    let mint_amount = Uint128::new(2_000_000_000_000_000_000_000_000); // 2M tokens (exceeds 1M cap)
    let proof = create_valid_proof(mint_amount, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Mint cap exceeded"));
}

#[test]
fn test_burn_insufficient_balance() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Try to burn without any tokens
    let msg = ExecuteMsg::BurnAndUnwrap {
        amount: Uint128::new(1_000_000_000_000_000_000),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Insufficient balance"));
}

#[test]
fn test_multiple_users_minting() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint to USER1
    let amount1 = Uint128::new(5_000_000_000_000_000_000);
    let proof1 = create_valid_proof(amount1, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof1,
        amount: amount1,
        recipient: USER1.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Mint to USER2
    let amount2 = Uint128::new(3_000_000_000_000_000_000);
    let proof2 = ZkProof {
        proof_data: "different_proof_data".to_string(),
        public_inputs: vec![
            amount2.to_string(),
            "different_hash".to_string(),
        ],
        verification_key: "vk_xfuel_v1".to_string(),
    };

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof2,
        amount: amount2,
        recipient: USER2.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER2), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Check total supply
    let token_info: TokenInfoResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::TokenInfo {})
        .unwrap();

    assert_eq!(token_info.total_supply, amount1 + amount2);

    // Check individual balances
    let user1_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    let user2_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr,
            &QueryMsg::Balance {
                address: USER2.to_string(),
            },
        )
        .unwrap();

    assert_eq!(user1_balance.balance, amount1);
    assert_eq!(user2_balance.balance, amount2);
}

#[test]
fn test_delegate_to_validator() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    let validator = "persistencevaloper1abcdef";
    let delegate_amount = Uint128::new(1_000_000_000_000_000_000); // 1 XPRT

    // Delegate tokens to validator (admin only)
    let msg = ExecuteMsg::DelegateToValidator {
        validator: validator.to_string(),
        amount: delegate_amount,
    };

    let res = app
        .execute_contract(Addr::unchecked(ADMIN), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify staking message was created
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "action" && attr.value == "delegate_to_validator"
    )));

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "validator" && attr.value == validator
    )));
}

#[test]
fn test_delegate_unauthorized() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    let validator = "persistencevaloper1abcdef";
    let delegate_amount = Uint128::new(1_000_000_000_000_000_000);

    // Try to delegate as non-admin (should fail)
    let msg = ExecuteMsg::DelegateToValidator {
        validator: validator.to_string(),
        amount: delegate_amount,
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Unauthorized"));
}

#[test]
fn test_initial_xprt_funding() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    let new_user = "persistence1newuser";
    let mint_amount = Uint128::new(1_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, new_user);

    // First mint should trigger XPRT funding
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof.clone(),
        amount: mint_amount,
        recipient: new_user.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(new_user), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Check that initial_xprt_funded attribute is present
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "initial_xprt_funded" && attr.value == "true"
    )));

    // Second mint should NOT trigger funding again
    let proof2 = ZkProof {
        proof_data: "different_proof_12345".to_string(),
        public_inputs: vec![
            mint_amount.to_string(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".to_string(),
        ],
        verification_key: "vk_xfuel_v1".to_string(),
    };

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof2,
        amount: mint_amount,
        recipient: new_user.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(new_user), contract_addr, &msg, &[])
        .unwrap();

    // Check that initial_xprt_funded attribute is NOT present
    assert!(!res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "initial_xprt_funded"
    )));
}

#[test]
fn test_revenue_split_accuracy() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(100_000_000_000_000_000_000); // 100 tokens
    let proof = create_valid_proof(mint_amount, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Burn all tokens
    let msg = ExecuteMsg::BurnAndUnwrap {
        amount: mint_amount,
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify exact revenue split
    let expected_recycled = Uint128::new(30_000_000_000_000_000_000); // 30%
    let expected_lp = Uint128::new(70_000_000_000_000_000_000); // 70%

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "recycled_amount" && attr.value == expected_recycled.to_string()
    )));

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "lp_reinvest_amount" && attr.value == expected_lp.to_string()
    )));

    // Verify state tracking
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_recycled, expected_recycled);
    assert_eq!(state.total_lp_reinvest, expected_lp);
}

#[test]
fn test_full_lifecycle() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // 1. Mint tokens to USER1
    let mint_amount = Uint128::new(50_000_000_000_000_000_000); // 50 tokens
    let proof1 = create_valid_proof(mint_amount, USER1);

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof1,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // 2. Transfer some tokens to USER2
    let transfer_amount = Uint128::new(20_000_000_000_000_000_000); // 20 tokens
    let msg = ExecuteMsg::Transfer {
        recipient: USER2.to_string(),
        amount: transfer_amount,
    };

    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // 3. USER2 burns some tokens
    let burn_amount = Uint128::new(10_000_000_000_000_000_000); // 10 tokens
    let msg = ExecuteMsg::BurnAndUnwrap {
        amount: burn_amount,
    };

    app.execute_contract(Addr::unchecked(USER2), contract_addr.clone(), &msg, &[])
        .unwrap();

    // 4. Check final state
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_minted, mint_amount);
    assert_eq!(state.total_burned, burn_amount);

    // 5. Check token supply
    let token_info: TokenInfoResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::TokenInfo {})
        .unwrap();

    assert_eq!(token_info.total_supply, mint_amount - burn_amount);

    // 6. Check USER1 balance (50 - 20 = 30 tokens)
    let user1_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    assert_eq!(
        user1_balance.balance,
        Uint128::new(30_000_000_000_000_000_000)
    );

    // 7. Check USER2 balance (20 - 10 = 10 tokens)
    let user2_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr,
            &QueryMsg::Balance {
                address: USER2.to_string(),
            },
        )
        .unwrap();

    assert_eq!(
        user2_balance.balance,
        Uint128::new(10_000_000_000_000_000_000)
    );
}

#[test]
fn test_zk_proof_validation() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Test with empty proof data
    let invalid_proof = ZkProof {
        proof_data: "".to_string(),
        public_inputs: vec![],
        verification_key: "".to_string(),
    };

    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: invalid_proof,
        amount: Uint128::new(1_000_000_000_000_000_000),
        recipient: USER1.to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Invalid") || err.to_string().contains("proof"));
}

// ============================================================================
// REVERSE BRIDGE TESTS - execute_burn_for_unwrap
// ============================================================================

#[test]
fn test_burn_for_unwrap_success() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // First mint tokens to user
    let mint_amount = Uint128::new(100_000_000_000_000_000_000); // 100 tokens
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Execute burn_for_unwrap
    let burn_amount = Uint128::new(10_000_000_000_000_000_000); // 10 tokens
    let theta_recipient = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1";
    
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn_amount,
        theta_recipient: theta_recipient.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify fee split: 0.5% fee, 99.5% burned
    let expected_fee = burn_amount.multiply_ratio(50u128, 10000u128);
    let expected_burn = burn_amount.checked_sub(expected_fee).unwrap();

    // Check attributes
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "action" && attr.value == "burn_for_unwrap"
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "amount_burned" && attr.value == expected_burn.to_string()
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "fee_amount" && attr.value == expected_fee.to_string()
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "theta_recipient" && attr.value == theta_recipient
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "1"
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "for_sp1_proof" && attr.value == "burn_for_unwrap"
    )));

    // Query state to verify tracking
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_reverse_burned, expected_burn);
    assert_eq!(state.total_reverse_fees, expected_fee);

    // Check user balance (should be reduced by full amount)
    let balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr,
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    assert_eq!(balance.balance, mint_amount - burn_amount);
}

#[test]
fn test_burn_for_unwrap_invalid_theta_address() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens first
    let mint_amount = Uint128::new(10_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Test invalid addresses
    let invalid_addresses = vec![
        "0x742d35Cc", // Too short
        "742d35Cc6634C0532925a3b844Bc9e7595f0bEb1", // Missing 0x
        "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1XYZ", // Too long
        "not_an_address", // Invalid format
    ];

    for invalid_addr in invalid_addresses {
        let msg = ExecuteMsg::BurnForUnwrap {
            amount: Uint128::new(1_000_000_000_000_000_000),
            theta_recipient: invalid_addr.to_string(),
        };

        let err = app
            .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
            .unwrap_err();

        assert!(err.to_string().contains("Invalid Theta address"));
    }
}

#[test]
fn test_burn_for_unwrap_insufficient_balance() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Try to burn without any tokens
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: Uint128::new(1_000_000_000_000_000_000),
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Insufficient balance"));
}

#[test]
fn test_burn_for_unwrap_nonce_increment() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(100_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // First burn - nonce should be 1
    let burn_amount = Uint128::new(10_000_000_000_000_000_000);
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn_amount,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "1"
    )));

    // Second burn - nonce should be 2
    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "2"
    )));

    // Third burn - nonce should be 3
    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "3"
    )));
}

#[test]
fn test_burn_for_unwrap_paused() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(10_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Pause contract
    let pause_msg = ExecuteMsg::Pause {};
    app.execute_contract(Addr::unchecked(ADMIN), contract_addr.clone(), &pause_msg, &[])
        .unwrap();

    // Try to burn while paused
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: Uint128::new(1_000_000_000_000_000_000),
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("paused"));
}

#[test]
fn test_burn_for_unwrap_zero_amount() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Try to burn zero amount
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: Uint128::zero(),
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };

    let err = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap_err();

    assert!(err.to_string().contains("Invalid") || err.to_string().contains("amount"));
}

#[test]
fn test_burn_for_unwrap_state_updates() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(100_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Initial state check
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::State {})
        .unwrap();
    assert_eq!(state.total_reverse_burned, Uint128::zero());
    assert_eq!(state.total_reverse_fees, Uint128::zero());

    // First burn
    let burn1 = Uint128::new(10_000_000_000_000_000_000);
    let fee1 = burn1.multiply_ratio(50u128, 10000u128);
    let burned1 = burn1.checked_sub(fee1).unwrap();

    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn1,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::State {})
        .unwrap();
    assert_eq!(state.total_reverse_burned, burned1);
    assert_eq!(state.total_reverse_fees, fee1);

    // Second burn - should accumulate
    let burn2 = Uint128::new(20_000_000_000_000_000_000);
    let fee2 = burn2.multiply_ratio(50u128, 10000u128);
    let burned2 = burn2.checked_sub(fee2).unwrap();

    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn2,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::State {})
        .unwrap();
    assert_eq!(state.total_reverse_burned, burned1 + burned2);
    assert_eq!(state.total_reverse_fees, fee1 + fee2);
}

#[test]
fn test_burn_for_unwrap_all_attributes() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(10_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Burn
    let burn_amount = Uint128::new(5_000_000_000_000_000_000);
    let theta_recipient = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1";
    
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn_amount,
        theta_recipient: theta_recipient.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[])
        .unwrap();

    // Verify ALL required attributes are present
    let required_attributes = vec![
        "action",
        "user",
        "amount_burned",
        "fee_amount",
        "theta_recipient",
        "nonce",
        "block_height",
        "timestamp",
        "chain_id",
        "for_sp1_proof",
    ];

    for attr_key in required_attributes {
        assert!(
            res.events.iter().any(|e| e.attributes.iter().any(|attr| attr.key == attr_key)),
            "Missing required attribute: {}",
            attr_key
        );
    }

    // Verify specific values
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "chain_id" && attr.value == "core-1"
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "user" && attr.value == USER1
    )));
}

#[test]
fn test_burn_for_unwrap_minimum_amount() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(1_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Burn minimum amount (should work)
    let min_burn = Uint128::new(10000000000000000); // 0.01 TFUEL equivalent
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: min_burn,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr, &msg, &[]);

    // Should succeed (no minimum check in contract, but testing small amounts work)
    assert!(res.is_ok());
}

// ============================================================================
// INTEGRATION TESTS - Minter + FeeCollector
// ============================================================================
// Note: These tests verify the burn_for_unwrap flow sends fees correctly
// Full integration with actual FeeCollector contract requires adding it as a dev-dependency

#[test]
fn test_burn_for_unwrap_sends_to_fee_collector() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(100_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Execute burn_for_unwrap
    let burn_amount = Uint128::new(10_000_000_000_000_000_000);
    let fee_amount = burn_amount.multiply_ratio(50u128, 10000u128);
    
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn_amount,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify CW20 Send message was created for FeeCollector
    // The execute_send function creates a submessage for the transfer
    assert!(!res.messages.is_empty(), "Should have messages for send and burn");

    // Check that user's balance decreased by full amount (fee + burn)
    let balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    assert_eq!(balance.balance, mint_amount - burn_amount);

    // Verify token total supply decreased by burn amount (not including fee)
    let token_info: TokenInfoResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::TokenInfo {})
        .unwrap();

    let burned_only = burn_amount.checked_sub(fee_amount).unwrap();
    assert_eq!(token_info.total_supply, mint_amount - burned_only);
}

#[test]
fn test_multiple_users_burn_fee_accumulation() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint to USER1
    let mint1 = Uint128::new(50_000_000_000_000_000_000);
    let proof1 = create_valid_proof(mint1, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof1,
        amount: mint1,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Mint to USER2
    let mint2 = Uint128::new(50_000_000_000_000_000_000);
    let proof2 = ZkProof {
        proof_data: "different_proof_user2".to_string(),
        public_inputs: vec![mint2.to_string(), "hash2".to_string()],
        verification_key: "vk_xfuel_v1".to_string(),
    };
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof2,
        amount: mint2,
        recipient: USER2.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER2), contract_addr.clone(), &msg, &[])
        .unwrap();

    // USER1 burns - nonce should be 1
    let burn1 = Uint128::new(10_000_000_000_000_000_000);
    let fee1 = burn1.multiply_ratio(50u128, 10000u128);
    let burned1 = burn1.checked_sub(fee1).unwrap();

    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn1,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };
    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "1"
    )));

    // USER2 burns - nonce should also be 1 (per-user nonce)
    let burn2 = Uint128::new(20_000_000_000_000_000_000);
    let fee2 = burn2.multiply_ratio(50u128, 10000u128);
    let burned2 = burn2.checked_sub(fee2).unwrap();

    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn2,
        theta_recipient: "0xAbC35Cc6634C0532925a3b844Bc9e7595f0bEb2".to_string(),
    };
    let res = app
        .execute_contract(Addr::unchecked(USER2), contract_addr.clone(), &msg, &[])
        .unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "1"
    )));

    // USER1 burns again - nonce should be 2
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn1,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };
    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "nonce" && attr.value == "2"
    )));

    // Verify cumulative state
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr, &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_reverse_burned, burned1 + burned2 + burned1);
    assert_eq!(state.total_reverse_fees, fee1 + fee2 + fee1);
}

// ============================================================================
// MOCK END-TO-END TESTS - Full Flow Simulation
// ============================================================================

#[test]
fn test_mock_e2e_deposit_to_withdrawal() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // 1. Verify contract is in mock mode
    let config: ConfigResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::Config {})
        .unwrap();
    assert!(config.mock_mode);

    // 2. FORWARD FLOW: Mock mint (simulates ZK proof verified deposit)
    let mint_amount = Uint128::new(100_000_000_000_000_000_000); // 100 tokens
    let proof = create_valid_proof(mint_amount, USER1);
    
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify mock mode attributes
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "mock_mode" && attr.value == "true"
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "warning" && attr.value == "ZK_VERIFICATION_SKIPPED"
    )));

    // Verify user received tokens
    let balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();
    assert_eq!(balance.balance, mint_amount);

    // 3. REVERSE FLOW: Mock burn_for_unwrap
    let burn_amount = Uint128::new(50_000_000_000_000_000_000); // 50 tokens
    let theta_recipient = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1";
    
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn_amount,
        theta_recipient: theta_recipient.to_string(),
    };

    let res = app
        .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify mock SP1 event attributes
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "mock_mode" && attr.value == "true"
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "mock_sp1_event" && attr.value == "burn_for_unwrap"
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "for_sp1_proof" && attr.value == "burn_for_unwrap"
    )));

    // Verify fee and burn calculation
    let expected_fee = burn_amount.multiply_ratio(50u128, 10000u128);
    let expected_burn = burn_amount.checked_sub(expected_fee).unwrap();

    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "fee_amount" && attr.value == expected_fee.to_string()
    )));
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "amount_burned" && attr.value == expected_burn.to_string()
    )));

    // 4. Verify final state
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_minted, mint_amount);
    assert_eq!(state.total_reverse_burned, expected_burn);
    assert_eq!(state.total_reverse_fees, expected_fee);

    // 5. Verify user balance after withdrawal
    let final_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr,
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();

    assert_eq!(final_balance.balance, mint_amount - burn_amount);
}

#[test]
fn test_mock_mode_dummy_address_warnings() {
    let mut app = mock_app();
    let code_id = app.store_code(contract_minter());

    // Instantiate with dummy addresses
    let msg = InstantiateMsg {
        name: "IBC Theta Fuel".to_string(),
        symbol: "IBCTFUEL".to_string(),
        decimals: 18,
        initial_balances: vec![],
        mint_cap: Some(Uint128::new(1_000_000_000_000_000_000_000_000)),
        marketing: None,
        verifier_address: VERIFIER.to_string(),
        rev_splitter_address: REV_SPLITTER.to_string(),
        fee_collector_address: FEE_COLLECTOR.to_string(),
        mock_mode: Some(true),
    };

    let res = app.instantiate_contract(
        code_id,
        Addr::unchecked(ADMIN),
        &msg,
        &[],
        "XFuel Minter",
        None,
    )
    .unwrap();

    // Verify dummy address warnings
    let events = &res.events;
    assert!(events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "warning" && attr.value.contains("USING_DUMMY")
    )));

    // Verify mock mode attribute
    assert!(events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "mock_mode" && attr.value == "true"
    )));
}

#[test]
fn test_mock_multiple_users_full_flow() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // USER1: Deposit 100 tokens, withdraw 30 tokens
    let mint1 = Uint128::new(100_000_000_000_000_000_000);
    let proof1 = create_valid_proof(mint1, USER1);
    
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof1,
        amount: mint1,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    let burn1 = Uint128::new(30_000_000_000_000_000_000);
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn1,
        theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // USER2: Deposit 50 tokens, withdraw 20 tokens
    let mint2 = Uint128::new(50_000_000_000_000_000_000);
    let proof2 = ZkProof {
        proof_data: "different_proof_user2".to_string(),
        public_inputs: vec![mint2.to_string(), "hash2".to_string()],
        verification_key: "vk_xfuel_v1".to_string(),
    };
    
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof2,
        amount: mint2,
        recipient: USER2.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER2), contract_addr.clone(), &msg, &[])
        .unwrap();

    let burn2 = Uint128::new(20_000_000_000_000_000_000);
    let msg = ExecuteMsg::BurnForUnwrap {
        amount: burn2,
        theta_recipient: "0xAbC35Cc6634C0532925a3b844Bc9e7595f0bEb2".to_string(),
    };
    app.execute_contract(Addr::unchecked(USER2), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Verify cumulative state
    let state: StateResponse = app
        .wrap()
        .query_wasm_smart(contract_addr.clone(), &QueryMsg::State {})
        .unwrap();

    assert_eq!(state.total_minted, mint1 + mint2);
    
    let fee1 = burn1.multiply_ratio(50u128, 10000u128);
    let burned1 = burn1.checked_sub(fee1).unwrap();
    let fee2 = burn2.multiply_ratio(50u128, 10000u128);
    let burned2 = burn2.checked_sub(fee2).unwrap();

    assert_eq!(state.total_reverse_burned, burned1 + burned2);
    assert_eq!(state.total_reverse_fees, fee1 + fee2);

    // Verify individual balances
    let user1_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr.clone(),
            &QueryMsg::Balance {
                address: USER1.to_string(),
            },
        )
        .unwrap();
    assert_eq!(user1_balance.balance, mint1 - burn1);

    let user2_balance: BalanceResponse = app
        .wrap()
        .query_wasm_smart(
            contract_addr,
            &QueryMsg::Balance {
                address: USER2.to_string(),
            },
        )
        .unwrap();
    assert_eq!(user2_balance.balance, mint2 - burn2);
}

#[test]
fn test_mock_admin_functions_with_dummy_addresses() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Test SetVerifier with dummy address
    let new_verifier = "persistence1newverifier00000000000000000000000000";
    let msg = ExecuteMsg::SetVerifier {
        verifier_address: new_verifier.to_string(),
    };
    let res = app
        .execute_contract(Addr::unchecked(ADMIN), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Should emit warning for dummy address (contains "00000000000")
    assert!(res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "warning" && attr.value.contains("DUMMY")
    )));

    // Test SetMinter with non-dummy address
    let real_minter = "persistence1realcontractaddress1234567890abcdef";
    let msg = ExecuteMsg::SetMinter {
        minter_address: real_minter.to_string(),
    };
    let res = app
        .execute_contract(Addr::unchecked(ADMIN), contract_addr, &msg, &[])
        .unwrap();

    // Should NOT emit dummy warning
    assert!(!res.events.iter().any(|e| e.attributes.iter().any(
        |attr| attr.key == "warning" && attr.value.contains("DUMMY")
    )));
}

#[test]
fn test_burn_for_unwrap_fee_calculation_precision() {
    let mut app = mock_app();
    let contract_addr = setup_contract(&mut app);

    // Mint tokens
    let mint_amount = Uint128::new(1_000_000_000_000_000_000_000);
    let proof = create_valid_proof(mint_amount, USER1);
    let msg = ExecuteMsg::VerifyAndMint {
        zk_proof: proof,
        amount: mint_amount,
        recipient: USER1.to_string(),
    };
    app.execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
        .unwrap();

    // Test various amounts to verify 0.5% fee precision
    let test_amounts = vec![
        Uint128::new(100_000_000_000_000_000_000), // 100 tokens
        Uint128::new(1_000_000_000_000_000_000),   // 1 token
        Uint128::new(123_456_789_012_345_678),     // Odd amount
    ];

    for amount in test_amounts {
        let expected_fee = amount.multiply_ratio(50u128, 10000u128);
        let expected_burn = amount.checked_sub(expected_fee).unwrap();

        let msg = ExecuteMsg::BurnForUnwrap {
            amount,
            theta_recipient: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1".to_string(),
        };

        let res = app
            .execute_contract(Addr::unchecked(USER1), contract_addr.clone(), &msg, &[])
            .unwrap();

        // Verify fee and burn amounts in attributes
        assert!(res.events.iter().any(|e| e.attributes.iter().any(
            |attr| attr.key == "fee_amount" && attr.value == expected_fee.to_string()
        )));
        assert!(res.events.iter().any(|e| e.attributes.iter().any(
            |attr| attr.key == "amount_burned" && attr.value == expected_burn.to_string()
        )));

        // Verify fee + burn = original amount
        assert_eq!(expected_fee + expected_burn, amount);
    }
}

