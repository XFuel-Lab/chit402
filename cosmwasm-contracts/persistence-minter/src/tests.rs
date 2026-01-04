use cosmwasm_std::{Addr, Coin, Empty, Uint128};
use cw_multi_test::{App, AppBuilder, Contract, ContractWrapper, Executor};

use crate::contract::{execute, instantiate, query};
use crate::msg::{
    ConfigResponse, ExecuteMsg, InstantiateMsg, QueryMsg, StateResponse, ZkProof,
};
use cw20::{BalanceResponse, TokenInfoResponse};

pub fn contract_minter() -> Box<dyn Contract<Empty>> {
    let contract = ContractWrapper::new(execute, instantiate, query);
    Box::new(contract)
}

const ADMIN: &str = "persistence1admin";
const USER1: &str = "persistence1user1";
const USER2: &str = "persistence1user2";
const VERIFIER: &str = "persistence1verifier";
const REV_SPLITTER: &str = "persistence1revsplitter";

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

