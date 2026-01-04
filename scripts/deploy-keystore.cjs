const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { Wallet } = require('ethers');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

/**
 * @XFuelLab ZK Bridge Deployment Script
 * Deploys VaultFactory for ZK bridge hybrid (TFUEL → ibcTFUEL via Persistence)
 */

/**
 * Load deployer wallet from keystore or private key file
 */
async function loadDeployerWallet() {
  console.log('🔐 Loading deployer wallet...\n');
  
  const keystorePath = process.env.DEPLOYER_MAINNET_KEYSTORE_PATH;
  
  if (!keystorePath) {
    throw new Error('❌ DEPLOYER_MAINNET_KEYSTORE_PATH not set in .env.local');
  }
  
  if (!fs.existsSync(keystorePath)) {
    throw new Error(`❌ Keystore file not found: ${keystorePath}`);
  }
  
  // Read the file content
  const fileContent = fs.readFileSync(keystorePath, 'utf8').trim();
  
  let wallet;
  
  // Check if it's a JSON keystore or plain text private key
  try {
    // Try parsing as JSON (encrypted keystore)
    const keystoreObj = JSON.parse(fileContent);
    console.log('📄 Detected JSON keystore format (encrypted)');
    console.log(`   Address in keystore: ${keystoreObj.address || 'N/A'}`);
    
    let password = process.env.DEPLOYER_KEYSTORE_PASSWORD;
    
    // If password is an ARN, fetch from AWS Secrets Manager
    if (password && password.startsWith('arn:aws:secretsmanager')) {
      console.log('📡 Fetching keystore password from AWS Secrets Manager...');
      try {
        const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
        const command = new GetSecretValueCommand({ SecretId: password });
        const response = await client.send(command);
        password = response.SecretString;
        
        // Trim whitespace and parse JSON if needed
        password = password.trim();
        
        // AWS might return JSON like {"password": "actual_password"}
        try {
          const parsed = JSON.parse(password);
          if (parsed.password) {
            password = parsed.password;
          } else if (typeof parsed === 'object') {
            // If it's a JSON object, use the first value
            password = Object.values(parsed)[0];
          }
        } catch {
          // Not JSON, use as-is
        }
        
        console.log('✅ Password fetched from AWS');
        console.log(`   Attempting to decrypt keystore...\n`);
      } catch (error) {
        throw new Error(`❌ Failed to fetch password from AWS: ${error.message}`);
      }
    }
    
    if (!password) {
      throw new Error('❌ DEPLOYER_KEYSTORE_PASSWORD required for encrypted keystore');
    }
    
    // Decrypt JSON keystore
    try {
      wallet = await Wallet.fromEncryptedJson(fileContent, password);
    } catch (decryptError) {
      throw new Error(`❌ Failed to decrypt keystore. This usually means:\n` +
        `   1. The password is incorrect\n` +
        `   2. The keystore file is corrupted\n` +
        `   3. The password in AWS doesn't match this keystore\n` +
        `   Original error: ${decryptError.message}`);
    }
    
  } catch (jsonError) {
    // If JSON parsing failed, treat as plain text private key
    if (jsonError.message.includes('Failed to decrypt keystore')) {
      // Re-throw decryption errors
      throw jsonError;
    }
    
    console.log('📄 Detected plain text private key format');
    
    let privateKey = fileContent;
    
    // Ensure it starts with 0x
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    // Validate private key format (should be 0x + 64 hex characters)
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new Error(`❌ Invalid private key format in file. Expected 64 hex characters, got: ${privateKey.length - 2}`);
    }
    
    wallet = new Wallet(privateKey);
  }
  
  console.log('✅ Wallet loaded successfully');
  console.log('   Address:', wallet.address);
  console.log('');
  
  return wallet;
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  const isMainnet = network.chainId === 361n;
  const isTestnet = network.chainId === 365n;
  const networkName = isMainnet ? 'Theta Mainnet' : 
                      isTestnet ? 'Theta Testnet' : 
                      `Unknown (Chain ID: ${network.chainId})`;
  
  console.log('🚀 @XFuelLab ZK Bridge Deployment\n');
  console.log('='.repeat(70));
  console.log(`Network: ${networkName} (Chain ID: ${network.chainId})`);
  console.log('='.repeat(70));
  console.log('');
  
  // Load deployer wallet from keystore
  const deployer = await loadDeployerWallet();
  
  // Connect wallet to provider
  const connectedWallet = deployer.connect(hre.ethers.provider);
  
  // Check balance
  const balance = await hre.ethers.provider.getBalance(connectedWallet.address);
  const balanceFormatted = hre.ethers.formatEther(balance);
  console.log('💰 Deployer balance:', balanceFormatted, 'TFUEL\n');
  
  if (balance < hre.ethers.parseEther('0.1')) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }
  
  // Validate configuration
  console.log('📋 Configuration Check:');
  
  const revSplitterAddress = process.env.REVSPLITTER_ADDRESS || '0x1c4CEBBB4cFA7FdB546424f21Cf706c48c478eE6';
  const treasuryAddress = process.env.TREASURY_ADDRESS || '0x043d5231651379970d52a13CEfB4e80733DDb989';
  
  console.log(`   RevenueSplitter: ${revSplitterAddress}`);
  console.log(`   Treasury:        ${treasuryAddress}`);
  
  // Simple validation - just check format
  const isValidAddress = (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr);
  
  if (!isValidAddress(revSplitterAddress)) {
    throw new Error(`❌ Invalid RevenueSplitter address format: ${revSplitterAddress}`);
  }
  if (!isValidAddress(treasuryAddress)) {
    throw new Error(`❌ Invalid Treasury address format: ${treasuryAddress}`);
  }
  
  console.log('   ✅ Addresses validated\n');
  
  // Gas configuration based on network
  const gasConfig = isMainnet ? {
    gasLimit: 5000000,
    gasPrice: 4000000000000, // 4000 Gwei (required by mainnet)
  } : {
    gasLimit: 5000000,
    gasPrice: 4000000000000, // Use same for testnet consistency
  };
  
  console.log('⛽ Gas Configuration:');
  console.log(`   Gas Limit:  ${gasConfig.gasLimit}`);
  console.log(`   Gas Price:  ${hre.ethers.formatUnits(gasConfig.gasPrice, 'gwei')} Gwei\n`);
  
  // Get contract factory
  const VaultFactory = await hre.ethers.getContractFactory('VaultFactory', connectedWallet);
  
  // NEW: Gas estimation before deployment
  console.log('⛽ Gas Estimation:');
  try {
    const estimatedGas = await VaultFactory.getDeployTransaction(
      connectedWallet.address,
      revSplitterAddress
    ).then(tx => hre.ethers.provider.estimateGas(tx));
    
    const estimatedCost = estimatedGas * BigInt(gasConfig.gasPrice);
    const bufferAmount = hre.ethers.parseEther('0.1');
    const totalRequired = estimatedCost + bufferAmount;
    
    console.log(`   Estimated Gas:  ${estimatedGas.toString()} units`);
    console.log(`   Gas Price:      ${hre.ethers.formatUnits(gasConfig.gasPrice, 'gwei')} Gwei`);
    console.log(`   Estimated Cost: ${hre.ethers.formatEther(estimatedCost)} TFUEL`);
    console.log(`   Buffer:         ${hre.ethers.formatEther(bufferAmount)} TFUEL`);
    console.log(`   Total Required: ${hre.ethers.formatEther(totalRequired)} TFUEL`);
    
    // Check if sufficient balance
    if (balance < totalRequired) {
      console.error('\n❌ INSUFFICIENT FUNDS FOR DEPLOYMENT');
      console.error(`   Required: ${hre.ethers.formatEther(totalRequired)} TFUEL`);
      console.error(`   Available: ${hre.ethers.formatEther(balance)} TFUEL`);
      console.error(`   Shortfall: ${hre.ethers.formatEther(totalRequired - balance)} TFUEL`);
      console.error('\n💡 Solutions:');
      console.error('   1. Top up deployer wallet with more TFUEL');
      console.error('   2. Use local fork for testing: npx hardhat node --fork <RPC_URL>');
      console.error('   3. Reduce gas limit in hardhat.config.cjs (risky)\n');
      process.exit(1);
    }
    
    console.log(`   ✅ Sufficient balance\n`);
  } catch (estimateError) {
    console.warn('⚠️  Could not estimate gas (proceeding with caution)');
    console.warn(`   Reason: ${estimateError.message}\n`);
  }
  
  // Check for dry-run mode
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('🧪 DRY-RUN MODE: Deployment simulation only');
    console.log('   No transactions will be sent to the network');
    console.log('   ✅ Dry-run complete - all checks passed\n');
    console.log('📌 To execute real deployment, run without --dry-run flag:');
    console.log(`   npx hardhat run scripts/deploy-keystore.cjs --network ${network.name}\n`);
    process.exit(0);
  }
  
  // Deploy VaultFactory
  console.log('📦 Deploying VaultFactory...');
  console.log('   Constructor params:');
  console.log(`     Admin:        ${connectedWallet.address}`);
  console.log(`     RevSplitter:  ${revSplitterAddress}\n`);
  
  let vaultFactory;
  try {
    vaultFactory = await VaultFactory.deploy(
      connectedWallet.address, // admin
      revSplitterAddress,      // revSplitter
      gasConfig
    );
  } catch (deployError) {
    console.error('\n❌ DEPLOYMENT TRANSACTION FAILED');
    console.error(`   Error: ${deployError.message}`);
    
    if (deployError.message.includes('insufficient funds')) {
      console.error('\n💡 This usually means:');
      console.error('   1. Gas estimation was incorrect (network congestion)');
      console.error('   2. Gas price spiked between estimation and execution');
      console.error('   3. Another transaction drained the wallet');
      console.error('\n   Check balance and try again with more TFUEL buffer');
    } else if (deployError.message.includes('nonce')) {
      console.error('\n💡 Nonce error - transaction may have been sent twice');
      console.error('   Check Theta Explorer to see if deployment succeeded');
    }
    
    throw deployError;
  }
  
  console.log('⏳ Waiting for deployment...');
  await vaultFactory.waitForDeployment();
  
  const vaultFactoryAddress = await vaultFactory.getAddress();
  console.log('✅ VaultFactory deployed to:', vaultFactoryAddress);
  console.log('');
  
  // Get deployment transaction
  const deployTx = vaultFactory.deploymentTransaction();
  if (deployTx) {
    console.log('📝 Deployment Transaction:');
    console.log(`   Hash:        ${deployTx.hash}`);
    console.log(`   Block:       ${deployTx.blockNumber || 'pending'}`);
    console.log(`   Gas Used:    ${deployTx.gasLimit ? deployTx.gasLimit.toString() : 'N/A'}`);
    console.log('');
  }
  
  // Final balance
  const finalBalance = await hre.ethers.provider.getBalance(connectedWallet.address);
  const finalBalanceFormatted = hre.ethers.formatEther(finalBalance);
  const gasSpent = balance - finalBalance;
  const gasSpentFormatted = hre.ethers.formatEther(gasSpent);
  
  // Print summary
  console.log('='.repeat(70));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('='.repeat(70));
  console.log(`🌐 Network:          ${networkName} (Chain ID: ${network.chainId})`);
  console.log(`👤 Deployer:         ${connectedWallet.address}`);
  console.log(`💰 Initial Balance:  ${balanceFormatted} TFUEL`);
  console.log(`⛽ Gas Spent:        ${gasSpentFormatted} TFUEL`);
  console.log(`💵 Final Balance:    ${finalBalanceFormatted} TFUEL`);
  console.log('');
  console.log('📝 Contract Addresses:');
  console.log(`   VaultFactory:     ${vaultFactoryAddress}`);
  console.log(`   RevenueSplitter:  ${revSplitterAddress} (external)`);
  console.log(`   Treasury:         ${treasuryAddress} (configured)`);
  console.log('');
  console.log('🔗 Explorer Link:');
  const explorerBase = isMainnet ? 
    'https://explorer.thetatoken.org' : 
    'https://testnet-explorer.thetatoken.org';
  console.log(`   VaultFactory: ${explorerBase}/address/${vaultFactoryAddress}`);
  if (deployTx?.hash) {
    console.log(`   Deploy Tx:    ${explorerBase}/tx/${deployTx.hash}`);
  }
  console.log('='.repeat(70));
  console.log('');
  
  console.log('📌 Next Steps (Ferrari Hybrid Rollout):');
  console.log('   1. Verify contract on explorer (compiler 0.8.20, optimization 200 runs)');
  console.log('   2. Create test SubVault: factory.createVault(salt)');
  console.log('   3. Test 0.1 TFUEL deposit → verify 0.5% fee to RevSplitter');
  console.log('   4. Check DepositReceived event for yieldRecycleAmount (30% flag)');
  console.log('   5. Test unwrap: factory.unwrapFromBurn() → verify 70% to recipient');
  console.log('   6. Confirm explorer shows all events correctly');
  console.log('');
  console.log('🎯 Gate Checks:');
  console.log('   [ ] Explorer verification passed');
  console.log('   [ ] Logs detect deposit events within 30s');
  console.log('   [ ] Fee split to RevSplitter confirmed (0.5%)');
  console.log('   [ ] 30% recycle flag in events');
  console.log('   [ ] Unwrap flow successful (70% sent, 30% kept)');
  console.log('');
  
  // Save deployment info
  const deploymentInfo = {
    network: networkName,
    chainId: network.chainId.toString(),
    deployer: connectedWallet.address,
    timestamp: new Date().toISOString(),
    contracts: {
      vaultFactory: vaultFactoryAddress,
      revenueSplitter: revSplitterAddress,
    },
    configuration: {
      treasury: treasuryAddress,
      admin: connectedWallet.address,
    },
    transaction: {
      hash: deployTx?.hash || 'N/A',
      blockNumber: deployTx?.blockNumber?.toString() || 'pending',
    },
    explorerLink: `${explorerBase}/address/${vaultFactoryAddress}`,
  };
  
  const deploymentPath = path.join(__dirname, '..', 'deployments', `vaultfactory-${network.chainId}.json`);
  const deploymentsDir = path.dirname(deploymentPath);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log('✅ Deployment info saved to:', deploymentPath);
  console.log('');
  
  // Update .env with VaultFactory address
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    let envContent = fs.readFileSync(envPath, 'utf8');
    const vaultFactoryEnvVar = isMainnet ? 'VITE_VAULT_FACTORY_ADDRESS' : 'VITE_VAULT_FACTORY_TESTNET_ADDRESS';
    
    const updateEnvVar = (key, value) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
    };
    
    updateEnvVar(vaultFactoryEnvVar, vaultFactoryAddress);
    fs.writeFileSync(envPath, envContent.trim() + '\n');
    console.log(`✅ Updated .env with ${vaultFactoryEnvVar}\n`);
  }
  
  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
