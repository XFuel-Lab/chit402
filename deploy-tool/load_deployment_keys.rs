#!/usr/bin/env rust-script
//! ```cargo
//! [dependencies]
//! tokio = { version = "1.35", features = ["full"] }
//! aws-config = "1.1"
//! aws-sdk-secretsmanager = "1.12"
//! anyhow = "1.0"
//! serde_json = "1.0"
//! ```

//! # AWS Secrets Manager Key Loader for XFuel Protocol
//! 
//! Retrieves SP1_PRIVATE_KEY and PERSISTENCE_DEPLOYER mnemonic from AWS Secrets Manager
//! 
//! ## Usage:
//! ```bash
//! # Install rust-script
//! cargo install rust-script
//! 
//! # Set AWS credentials
//! export AWS_ACCESS_KEY_ID=your_key
//! export AWS_SECRET_ACCESS_KEY=your_secret
//! export AWS_REGION=us-east-1
//! 
//! # Run script
//! rust-script load_deployment_keys.rs
//! 
//! # Or use as Rust program:
//! cargo run --bin load_deployment_keys
//! ```
//! 
//! ## Environment Variables Set:
//! - SP1_PRIVATE_KEY: Private key for SP1 prover operations
//! - PERSISTENCE_MNEMONIC: Mnemonic for Persistence deployer account

use aws_config;
use aws_sdk_secretsmanager::{Client, Error};
use std::env;

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    println!("🔐 Loading deployment keys from AWS Secrets Manager...\n");

    // Load AWS configuration from environment
    let config = aws_config::load_from_env().await;
    let client = Client::new(&config);

    // AWS ARNs (update ACCOUNT_ID with your AWS account ID)
    let account_id = env::var("AWS_ACCOUNT_ID")
        .unwrap_or_else(|_| "REPLACE_WITH_YOUR_ACCOUNT_ID".to_string());
    let region = env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".to_string());

    let sp1_key_arn = format!(
        "arn:aws:secretsmanager:{}:{}:secret:SP1_PRIVATE_KEY",
        region, account_id
    );
    let persistence_mnemonic_arn = format!(
        "arn:aws:secretsmanager:{}:{}:secret:PERSISTENCE_DEPLOYER",
        region, account_id
    );

    // Retrieve SP1_PRIVATE_KEY
    println!("📥 Retrieving SP1_PRIVATE_KEY...");
    match get_secret(&client, &sp1_key_arn).await {
        Ok(sp1_key) => {
            env::set_var("SP1_PRIVATE_KEY", &sp1_key);
            println!("✅ SP1_PRIVATE_KEY loaded ({}...)", &sp1_key[..min(sp1_key.len(), 16)]);
        }
        Err(e) => {
            eprintln!("❌ Failed to retrieve SP1_PRIVATE_KEY: {}", e);
            eprintln!("   ARN: {}", sp1_key_arn);
            return Err(anyhow::anyhow!("SP1_PRIVATE_KEY retrieval failed"));
        }
    }

    // Retrieve PERSISTENCE_DEPLOYER mnemonic
    println!("\n📥 Retrieving PERSISTENCE_DEPLOYER mnemonic...");
    match get_secret(&client, &persistence_mnemonic_arn).await {
        Ok(mnemonic) => {
            env::set_var("PERSISTENCE_MNEMONIC", &mnemonic);
            // Show first 3 words for verification (safe)
            let words: Vec<&str> = mnemonic.split_whitespace().collect();
            let preview = if words.len() >= 3 {
                format!("{} {} {} ...", words[0], words[1], words[2])
            } else {
                "***".to_string()
            };
            println!("✅ PERSISTENCE_MNEMONIC loaded ({} words)", words.len());
            println!("   Preview: {}", preview);
        }
        Err(e) => {
            eprintln!("❌ Failed to retrieve PERSISTENCE_DEPLOYER: {}", e);
            eprintln!("   ARN: {}", persistence_mnemonic_arn);
            return Err(anyhow::anyhow!("PERSISTENCE_DEPLOYER retrieval failed"));
        }
    }

    println!("\n✅ All deployment keys loaded successfully!");
    println!("\n📝 Export to shell:");
    println!("   export SP1_PRIVATE_KEY=\"$SP1_PRIVATE_KEY\"");
    println!("   export PERSISTENCE_MNEMONIC=\"$PERSISTENCE_MNEMONIC\"");

    println!("\n🔧 Import deployer key to persistenced:");
    println!("   echo \"$PERSISTENCE_MNEMONIC\" | persistenced keys add deployer --recover");

    Ok(())
}

/// Retrieve secret value from AWS Secrets Manager
async fn get_secret(client: &Client, secret_id: &str) -> Result<String, Error> {
    let response = client
        .get_secret_value()
        .secret_id(secret_id)
        .send()
        .await?;

    match response.secret_string() {
        Some(secret) => Ok(secret.to_string()),
        None => Err(Error::Unhandled(Box::from(
            "Secret value is binary, expected string",
        ))),
    }
}

fn min(a: usize, b: usize) -> usize {
    if a < b { a } else { b }
}

// ============================================================================
// ALTERNATIVE: Bash Script for AWS CLI
// ============================================================================
// If you prefer bash over Rust, save this as load_deployment_keys.sh:
//
// ```bash
// #!/bin/bash
// set -e
// 
// echo "🔐 Loading deployment keys from AWS Secrets Manager..."
// echo ""
// 
// # Configuration
// AWS_REGION=${AWS_REGION:-us-east-1}
// AWS_ACCOUNT_ID=${AWS_ACCOUNT_ID:-"REPLACE_WITH_YOUR_ACCOUNT_ID"}
// 
// # ARNs
// SP1_KEY_ARN="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:SP1_PRIVATE_KEY"
// PERSISTENCE_MNEMONIC_ARN="arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:PERSISTENCE_DEPLOYER"
// 
// # Retrieve SP1_PRIVATE_KEY
// echo "📥 Retrieving SP1_PRIVATE_KEY..."
// export SP1_PRIVATE_KEY=$(aws secretsmanager get-secret-value \
//   --secret-id "$SP1_KEY_ARN" \
//   --query SecretString \
//   --output text)
// echo "✅ SP1_PRIVATE_KEY loaded (${SP1_PRIVATE_KEY:0:16}...)"
// 
// # Retrieve PERSISTENCE_DEPLOYER mnemonic
// echo ""
// echo "📥 Retrieving PERSISTENCE_DEPLOYER mnemonic..."
// export PERSISTENCE_MNEMONIC=$(aws secretsmanager get-secret-value \
//   --secret-id "$PERSISTENCE_MNEMONIC_ARN" \
//   --query SecretString \
//   --output text)
// 
// WORD_COUNT=$(echo "$PERSISTENCE_MNEMONIC" | wc -w)
// PREVIEW=$(echo "$PERSISTENCE_MNEMONIC" | awk '{print $1, $2, $3, "..."}')
// echo "✅ PERSISTENCE_MNEMONIC loaded ($WORD_COUNT words)"
// echo "   Preview: $PREVIEW"
// 
// echo ""
// echo "✅ All deployment keys loaded successfully!"
// echo ""
// echo "📝 Keys are now available as environment variables:"
// echo "   \$SP1_PRIVATE_KEY"
// echo "   \$PERSISTENCE_MNEMONIC"
// echo ""
// echo "🔧 Import deployer key to persistenced:"
// echo "   echo \"\$PERSISTENCE_MNEMONIC\" | persistenced keys add deployer --recover"
// ```
//
// Usage: source load_deployment_keys.sh

// ============================================================================
// DEPLOYMENT GUIDE EXCERPT
// ============================================================================

/// # XFuel Protocol Mainnet Deployment with AWS Key Loading
/// 
/// ## Prerequisites
/// 
/// 1. AWS CLI configured with credentials
/// 2. AWS Secrets Manager access (read-only permissions)
/// 3. persistenced binary installed
/// 4. Rust toolchain (if using Rust script)
/// 
/// ## Deployment Values
/// 
/// ```bash
/// # Persistence Core-1 (Mainnet)
/// CHAIN_ID=core-1
/// RPC_URL=https://rpc.persistence.one:443
/// ADMIN_ADDRESS=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
/// 
/// # Theta Mainnet
/// THETA_RECIPIENT=0xD3EED5D4a61Beb3401E10D606f9957500AC9819a
/// 
/// # AWS Secrets ARNs (replace ACCOUNT_ID)
/// SP1_KEY_ARN=arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:SP1_PRIVATE_KEY
/// PERSISTENCE_MNEMONIC_ARN=arn:aws:secretsmanager:us-east-1:ACCOUNT_ID:secret:PERSISTENCE_DEPLOYER
/// ```
/// 
/// ## Step-by-Step Deployment
/// 
/// ### 1. Load Deployment Keys
/// 
/// ```bash
/// # Using Rust script
/// rust-script load_deployment_keys.rs
/// 
/// # OR using Bash script
/// source load_deployment_keys.sh
/// 
/// # Verify keys loaded
/// echo "SP1 key length: ${#SP1_PRIVATE_KEY}"
/// echo "Mnemonic word count: $(echo $PERSISTENCE_MNEMONIC | wc -w)"
/// ```
/// 
/// ### 2. Import Deployer Key to persistenced
/// 
/// ```bash
/// # Add deployer key to keyring
/// echo "$PERSISTENCE_MNEMONIC" | persistenced keys add deployer --recover
/// 
/// # Verify address matches expected admin address
/// persistenced keys show deployer --bech32 acc
/// # Should output: persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e
/// ```
/// 
/// ### 3. Build and Upload CosmWasm Contracts
/// 
/// ```bash
/// cd cosmwasm-contracts/persistence-minter
/// 
/// # Build optimized WASM
/// docker run --rm -v "$(pwd)":/code \
///   --mount type=volume,source="$(basename "$(pwd)")_cache",target=/target \
///   --mount type=volume,source=registry_cache,target=/usr/local/cargo/registry \
///   cosmwasm/optimizer:0.15.0
/// 
/// # Upload ibcTFUEL.wasm
/// TX_HASH=$(persistenced tx wasm store artifacts/persistence_minter.wasm \
///   --from deployer \
///   --chain-id core-1 \
///   --node $RPC_URL \
///   --gas auto \
///   --gas-adjustment 1.3 \
///   --gas-prices 0.025uxprt \
///   --broadcast-mode sync \
///   --yes \
///   --output json | jq -r '.txhash')
/// 
/// echo "Upload TX: $TX_HASH"
/// sleep 6
/// 
/// # Get code ID
/// CODE_ID=$(persistenced query tx $TX_HASH --output json | jq -r '.logs[0].events[] | select(.type=="store_code") | .attributes[] | select(.key=="code_id") | .value')
/// echo "Code ID: $CODE_ID"
/// ```
/// 
/// ### 4. Instantiate ibcTFUEL Contract
/// 
/// ```bash
/// # For Phase C (governance prep): Use mock_mode = true, dummy addresses
/// INIT_MSG='{
///   "name": "IBC Theta Fuel",
///   "symbol": "IBCTFUEL",
///   "decimals": 18,
///   "initial_balances": [],
///   "mint_cap": null,
///   "marketing": null,
///   "verifier_address": "persistence1000000000000000000000000000000000000",
///   "rev_splitter_address": "persistence1111111111111111111111111111111111111",
///   "fee_collector_address": "persistence1feecollector0000000000000000000000000000000000",
///   "mock_mode": true
/// }'
/// 
/// # Instantiate contract
/// persistenced tx wasm instantiate $CODE_ID "$INIT_MSG" \
///   --from deployer \
///   --label "ibcTFUEL-mock-phase-c" \
///   --admin $ADMIN_ADDRESS \
///   --chain-id core-1 \
///   --node $RPC_URL \
///   --gas auto \
///   --gas-adjustment 1.3 \
///   --gas-prices 0.025uxprt \
///   --yes
/// 
/// # Query contract address
/// CONTRACT_ADDR=$(persistenced query wasm list-contract-by-code $CODE_ID --output json | jq -r '.contracts[0]')
/// echo "Contract Address: $CONTRACT_ADDR"
/// ```
/// 
/// ### 5. Verify Mock Mode Configuration
/// 
/// ```bash
/// # Query config
/// persistenced query wasm contract-state smart $CONTRACT_ADDR \
///   '{"config":{}}' \
///   --output json | jq '.'
/// 
/// # Expected output:
/// # {
/// #   "mock_mode": true,
/// #   "verifier_address": "persistence1000000000000000000000000000000000000",
/// #   ...
/// # }
/// ```
/// 
/// ### 6. Run Mock End-to-End Test
/// 
/// ```bash
/// # Mock mint (no ZK proof verification)
/// persistenced tx wasm execute $CONTRACT_ADDR \
///   '{"verify_and_mint":{"zk_proof":{"proof_data":"mock_proof","public_inputs":[],"verification_key":"mock"},"amount":"1000000000000000000","recipient":"'$ADMIN_ADDRESS'"}}' \
///   --from deployer \
///   --chain-id core-1 \
///   --node $RPC_URL \
///   --gas auto \
///   --yes
/// 
/// # Mock burn_for_unwrap
/// persistenced tx wasm execute $CONTRACT_ADDR \
///   '{"burn_for_unwrap":{"amount":"500000000000000000","theta_recipient":"'$THETA_RECIPIENT'"}}' \
///   --from deployer \
///   --chain-id core-1 \
///   --node $RPC_URL \
///   --gas auto \
///   --yes
/// 
/// # Check events for mock mode warnings
/// persistenced query txs --events "execute._contract_address=$CONTRACT_ADDR" --limit 10
/// ```
/// 
/// ### 7. Post-Governance: Update to Production Mode
/// 
/// ```bash
/// # After governance approval, migrate to production mode:
/// # 1. Deploy real ZKVerifier.wasm, FeeCollector.wasm
/// # 2. Update verifier/fee_collector addresses
/// # 3. Disable mock_mode (requires contract migration or new instantiation)
/// 
/// # Update verifier address
/// persistenced tx wasm execute $CONTRACT_ADDR \
///   '{"set_verifier":{"verifier_address":"<real_zkverifier_address>"}}' \
///   --from $ADMIN_ADDRESS \
///   --chain-id core-1 \
///   --node $RPC_URL \
///   --gas auto \
///   --yes
/// 
/// # Update fee collector address
/// persistenced tx wasm execute $CONTRACT_ADDR \
///   '{"set_fee_collector":{"fee_collector_address":"<real_feecollector_address>"}}' \
///   --from $ADMIN_ADDRESS \
///   --chain-id core-1 \
///   --node $RPC_URL \
///   --gas auto \
///   --yes
/// ```
/// 
/// ## Security Best Practices
/// 
/// 1. **Never commit secrets to git**
///    - Always use AWS Secrets Manager or similar
///    - Rotate keys regularly (quarterly)
/// 
/// 2. **Use read-only AWS credentials for retrieval**
///    - Limit IAM policy to `secretsmanager:GetSecretValue`
///    - Restrict to specific secret ARNs
/// 
/// 3. **Verify addresses before deployment**
///    - Double-check ADMIN_ADDRESS matches keyring
///    - Verify THETA_RECIPIENT on block explorer
/// 
/// 4. **Test on testnet first**
///    - Deploy to Persistence testnet (test-core-2)
///    - Run full E2E flow before mainnet
/// 
/// 5. **Enable circuit breakers**
///    - Start with low caps (1 TFUEL Phase C)
///    - Gradually increase after monitoring
/// 
/// ## Monitoring
/// 
/// ```bash
/// # Monitor contract events
/// persistenced query txs --events "execute._contract_address=$CONTRACT_ADDR" --limit 50
/// 
/// # Check contract balance (fees accumulated)
/// persistenced query bank balances $CONTRACT_ADDR
/// 
/// # Query state
/// persistenced query wasm contract-state smart $CONTRACT_ADDR '{"state":{}}'
/// ```
/// 
/// ## Troubleshooting
/// 
/// ### AWS Secrets Not Found
/// ```bash
/// # Verify ARN format
/// aws secretsmanager describe-secret --secret-id <ARN>
/// 
/// # Check IAM permissions
/// aws iam get-user
/// aws iam list-attached-user-policies --user-name <username>
/// ```
/// 
/// ### persistenced Key Import Fails
/// ```bash
/// # Check mnemonic word count (should be 12 or 24)
/// echo "$PERSISTENCE_MNEMONIC" | wc -w
/// 
/// # Try importing without piping
/// persistenced keys add deployer --recover
/// # Then paste mnemonic manually
/// ```
/// 
/// ### Contract Instantiation Fails
/// ```bash
/// # Check gas price
/// persistenced query bank balances $ADMIN_ADDRESS
/// 
/// # Increase gas
/// persistenced tx wasm instantiate $CODE_ID "$INIT_MSG" \
///   --gas 500000 \
///   --gas-prices 0.05uxprt \
///   ...
/// ```
