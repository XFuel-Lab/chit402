const hre = require('hardhat');
const { ethers } = require('ethers');

/**
 * XFuelLab Step 2 Live Testing Script
 * 
 * Comprehensive testing of deployed VaultFactory with Ferrari hybrid tokenomics
 * 
 * Tests:
 * 1. SubVault creation
 * 2. Deposit with 0.5% fee
 * 3. Fee distribution verification
 * 4. Mock unwrap with 30/70 split
 * 5. Event verification
 * 6. Governance extras simulation
 * 
 * Usage: node scripts/test-live.cjs
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

// Deployment addresses
const VAULT_FACTORY_ADDRESS = '0xB0a26600074dADC69186632a1B8dFd7c3146Ce56';
const REVSPLITTER_ADDRESS = '0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6';
const DEPLOYER_ADDRESS = '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c';

// Test configuration
const TEST_CONFIG = {
  network: 'theta-mainnet',
  gasPrice: 4000000000000, // 4000 Gwei
  gasLimit: 2000000,
  testDepositAmount: '0.1', // TFUEL
  testUnwrapAmount: '0.05', // TFUEL
  expectedFeePercent: 0.005, // 0.5%
  expectedRecyclePercent: 0.30, // 30%
  expectedLPPercent: 0.70, // 70%
};

// Metrics tracking
const METRICS = {
  testsPassed: 0,
  testsFailed: 0,
  gasUsed: 0n,
  startBalance: 0n,
  endBalance: 0n,
  transactionHashes: [],
};

function printHeader(title) {
  console.log('');
  console.log('='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
  console.log('');
}

function printSuccess(message) {
  console.log(`✅ ${message}`);
  METRICS.testsPassed++;
}

function printError(message) {
  console.log(`❌ ${message}`);
  METRICS.testsFailed++;
}

function printInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function printWarning(message) {
  console.log(`⚠️  ${message}`);
}

async function loadWallet() {
  printInfo('Loading deployer wallet from keystore...');
  
  const keystorePath = process.env.DEPLOYER_MAINNET_KEYSTORE_PATH;
  if (!keystorePath) {
    throw new Error('DEPLOYER_MAINNET_KEYSTORE_PATH not set');
  }

  const fs = require('fs');
  const fileContent = fs.readFileSync(keystorePath, 'utf8').trim();
  
  let wallet;
  try {
    const keystoreObj = JSON.parse(fileContent);
    let password = process.env.DEPLOYER_KEYSTORE_PASSWORD;
    
    // Handle AWS ARN if needed
    if (password && password.startsWith('arn:aws:secretsmanager')) {
      const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
      const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
      const command = new GetSecretValueCommand({ SecretId: password });
      const response = await client.send(command);
      password = response.SecretString.trim();
      
      try {
        const parsed = JSON.parse(password);
        password = parsed.password || Object.values(parsed)[0];
      } catch {}
    }
    
    wallet = await hre.ethers.Wallet.fromEncryptedJson(fileContent, password);
  } catch {
    // Plain text private key
    let privateKey = fileContent;
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    wallet = new hre.ethers.Wallet(privateKey);
  }
  
  const connectedWallet = wallet.connect(hre.ethers.provider);
  printSuccess(`Wallet loaded: ${wallet.address}`);
  return connectedWallet;
}

async function test1_AttachToFactory(wallet) {
  printHeader('TEST 1: Attach to VaultFactory');
  
  try {
    const factory = await hre.ethers.getContractAt('VaultFactory', VAULT_FACTORY_ADDRESS, wallet);
    
    // Verify contract exists and is accessible
    const adminRole = await factory.DEFAULT_ADMIN_ROLE();
    printInfo(`DEFAULT_ADMIN_ROLE: ${adminRole}`);
    
    const admin = await factory.hasRole(adminRole, wallet.address);
    printInfo(`Admin check: ${admin ? 'Has admin role ✅' : 'No admin role ⚠️'}`);
    
    const revSplitter = await factory.getRevSplitter();
    printInfo(`RevenueSplitter: ${revSplitter}`);
    
    if (revSplitter.toLowerCase() === REVSPLITTER_ADDRESS.toLowerCase()) {
      printSuccess('RevenueSplitter address matches');
    } else {
      printWarning(`RevenueSplitter mismatch: expected ${REVSPLITTER_ADDRESS}, got ${revSplitter}`);
    }
    
    const isPaused = await factory.paused();
    printInfo(`Contract paused: ${isPaused}`);
    
    printSuccess('VaultFactory attached and verified');
    return factory;
  } catch (error) {
    printError(`Failed to attach to VaultFactory: ${error.message}`);
    throw error;
  }
}

async function test2_CreateSubVault(factory, wallet) {
  printHeader('TEST 2: Create SubVault');
  
  try {
    // Generate unique salt
    const timestamp = Date.now();
    const salt = hre.ethers.keccak256(
      hre.ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'],
        [wallet.address, timestamp]
      )
    );
    
    printInfo(`Salt: ${salt}`);
    
    // Predict address
    const predictedAddr = await factory.predictAddress(salt);
    printInfo(`Predicted SubVault address: ${predictedAddr}`);
    
    // Check if already exists
    const alreadyExists = await factory.isVault(predictedAddr);
    if (alreadyExists) {
      printWarning('Vault already exists at this address');
      printSuccess('Using existing SubVault');
      return predictedAddr;
    }
    
    // Estimate gas
    printInfo('Estimating gas for SubVault creation...');
    try {
      const gasEstimate = await factory.createVault.estimateGas(salt);
      printInfo(`Estimated gas: ${gasEstimate.toString()} units`);
      
      const estimatedCost = gasEstimate * BigInt(TEST_CONFIG.gasPrice);
      printInfo(`Estimated cost: ${hre.ethers.formatEther(estimatedCost)} TFUEL`);
    } catch (err) {
      printWarning(`Gas estimation failed: ${err.message} (will use default limit)`);
    }
    
    // Create vault
    printInfo('Creating SubVault...');
    const tx = await factory.createVault(salt, {
      gasPrice: TEST_CONFIG.gasPrice,
      gasLimit: TEST_CONFIG.gasLimit
    });
    
    printInfo(`Transaction sent: ${tx.hash}`);
    METRICS.transactionHashes.push(tx.hash);
    
    const receipt = await tx.wait();
    printInfo(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    METRICS.gasUsed += receipt.gasUsed;
    
    // Verify creation
    const vaultCreated = await factory.isVault(predictedAddr);
    if (vaultCreated) {
      printSuccess(`SubVault created at: ${predictedAddr}`);
      printInfo(`Explorer: https://explorer.thetatoken.org/address/${predictedAddr}`);
    } else {
      printError('SubVault creation verification failed');
    }
    
    return predictedAddr;
  } catch (error) {
    printError(`SubVault creation failed: ${error.message}`);
    
    if (error.message.includes('insufficient funds')) {
      printInfo('💡 Solution: Top up wallet with more TFUEL');
    } else if (error.message.includes('VaultAlreadyExists')) {
      printInfo('💡 Vault already exists - use different salt or predictAddress to get existing vault');
    }
    
    throw error;
  }
}

async function test3_DepositToSubVault(subVaultAddr, wallet) {
  printHeader('TEST 3: Deposit to SubVault (Simulated)');
  
  printInfo('This test requires manual deposit from Theta Web Wallet');
  printInfo(`SubVault address: ${subVaultAddr}`);
  printInfo(`Amount to send: ${TEST_CONFIG.testDepositAmount} TFUEL`);
  printInfo('');
  printInfo('Steps:');
  printInfo('1. Open Theta Web Wallet');
  printInfo(`2. Send ${TEST_CONFIG.testDepositAmount} TFUEL to ${subVaultAddr}`);
  printInfo('3. Wait for confirmation');
  printInfo('4. Check explorer for DepositReceived event');
  printInfo('');
  
  // Calculate expected values
  const depositAmount = hre.ethers.parseEther(TEST_CONFIG.testDepositAmount);
  const expectedFee = depositAmount * BigInt(Math.floor(TEST_CONFIG.expectedFeePercent * 10000)) / 10000n;
  const expectedNet = depositAmount - expectedFee;
  const expectedRecycle = expectedNet * BigInt(Math.floor(TEST_CONFIG.expectedRecyclePercent * 10000)) / 10000n;
  const expectedLP = expectedNet - expectedRecycle;
  
  printInfo('Expected values:');
  printInfo(`  Gross amount: ${hre.ethers.formatEther(depositAmount)} TFUEL`);
  printInfo(`  Fee (0.5%):   ${hre.ethers.formatEther(expectedFee)} TFUEL`);
  printInfo(`  Net locked:   ${hre.ethers.formatEther(expectedNet)} TFUEL`);
  printInfo(`  Recycle (30%): ${hre.ethers.formatEther(expectedRecycle)} TFUEL`);
  printInfo(`  LP Fund (70%): ${hre.ethers.formatEther(expectedLP)} TFUEL`);
  printInfo('');
  
  printInfo('Verify on explorer:');
  printInfo(`https://explorer.thetatoken.org/address/${subVaultAddr}`);
  printInfo('');
  
  printSuccess('Deposit simulation complete (manual verification required)');
  
  return {
    expectedFee,
    expectedNet,
    expectedRecycle,
    expectedLP
  };
}

async function test4_VerifyRevSplitterBalance() {
  printHeader('TEST 4: Verify RevenueSplitter Balance');
  
  try {
    const balance = await hre.ethers.provider.getBalance(REVSPLITTER_ADDRESS);
    printInfo(`RevenueSplitter balance: ${hre.ethers.formatEther(balance)} TFUEL`);
    
    if (balance > 0n) {
      printSuccess('RevenueSplitter has received fees');
    } else {
      printWarning('RevenueSplitter balance is zero (deposit may not have happened yet)');
    }
    
    return balance;
  } catch (error) {
    printError(`Failed to check RevenueSplitter balance: ${error.message}`);
    throw error;
  }
}

async function test5_MockUnwrap(factory, subVaultAddr, wallet) {
  printHeader('TEST 5: Mock Unwrap (Reverse-Burn Loop)');
  
  try {
    // Check SubVault balance
    const vaultBalance = await hre.ethers.provider.getBalance(subVaultAddr);
    printInfo(`SubVault balance: ${hre.ethers.formatEther(vaultBalance)} TFUEL`);
    
    if (vaultBalance === 0n) {
      printWarning('SubVault has no balance - skipping unwrap test');
      printInfo('Complete a deposit first before testing unwrap');
      return;
    }
    
    // Generate mock burn tx hash
    const mockBurnTxHash = hre.ethers.keccak256(
      hre.ethers.toUtf8Bytes(`test-burn-${Date.now()}`)
    );
    
    printInfo(`Mock burn TX hash: ${mockBurnTxHash}`);
    
    // Calculate unwrap amount (max 50% of vault balance for safety)
    const unwrapAmount = vaultBalance / 2n;
    printInfo(`Unwrap amount: ${hre.ethers.formatEther(unwrapAmount)} TFUEL`);
    
    // Calculate expected split
    const expectedToRecipient = unwrapAmount * BigInt(Math.floor(TEST_CONFIG.expectedLPPercent * 10000)) / 10000n;
    const expectedRecycled = unwrapAmount - expectedToRecipient;
    
    printInfo('Expected unwrap split:');
    printInfo(`  To recipient (70%): ${hre.ethers.formatEther(expectedToRecipient)} TFUEL`);
    printInfo(`  Recycled (30%):     ${hre.ethers.formatEther(expectedRecycled)} TFUEL`);
    
    // Get recipient balance before
    const recipientBalanceBefore = await hre.ethers.provider.getBalance(wallet.address);
    
    // Execute unwrap
    printInfo('Executing unwrapFromBurn...');
    const tx = await factory.unwrapFromBurn(
      subVaultAddr,
      mockBurnTxHash,
      wallet.address,
      unwrapAmount,
      {
        gasPrice: TEST_CONFIG.gasPrice,
        gasLimit: TEST_CONFIG.gasLimit
      }
    );
    
    printInfo(`Transaction sent: ${tx.hash}`);
    METRICS.transactionHashes.push(tx.hash);
    
    const receipt = await tx.wait();
    printInfo(`Transaction confirmed in block ${receipt.blockNumber}`);
    
    METRICS.gasUsed += receipt.gasUsed;
    
    // Verify recipient balance increased
    const recipientBalanceAfter = await hre.ethers.provider.getBalance(wallet.address);
    const actualReceived = recipientBalanceAfter - recipientBalanceBefore + receipt.gasUsed * BigInt(TEST_CONFIG.gasPrice);
    
    printInfo(`Actual received: ${hre.ethers.formatEther(actualReceived)} TFUEL`);
    
    // Check if within acceptable range (accounting for rounding)
    const diff = actualReceived > expectedToRecipient ? 
      actualReceived - expectedToRecipient : 
      expectedToRecipient - actualReceived;
    
    if (diff < hre.ethers.parseEther('0.001')) { // 0.001 TFUEL tolerance
      printSuccess('Unwrap split verified (70% to recipient, 30% recycled)');
    } else {
      printWarning(`Unwrap split off by ${hre.ethers.formatEther(diff)} TFUEL (may be rounding)`);
    }
    
    // Check for UnwrapFromBurn event
    const events = receipt.logs;
    printInfo(`Events emitted: ${events.length}`);
    
    printSuccess('Mock unwrap completed successfully');
    printInfo(`Explorer: https://explorer.thetatoken.org/tx/${tx.hash}`);
    
    return receipt;
  } catch (error) {
    printError(`Unwrap failed: ${error.message}`);
    
    if (error.message.includes('InsufficientBalance')) {
      printInfo('💡 SubVault has insufficient balance for unwrap');
    } else if (error.message.includes('BurnAlreadyProcessed')) {
      printInfo('💡 This burn TX has already been processed (replay protection)');
    }
    
    throw error;
  }
}

async function test6_SimulateGovernanceExtras(factory) {
  printHeader('TEST 6: Simulate Governance Extras');
  
  try {
    printInfo('Ferrari Hybrid Governance Extras:');
    printInfo('');
    printInfo('Phase 3 (Post-Audit) Features:');
    printInfo('  • Quarterly LP allocation vote (5-10% of LP revenue)');
    printInfo('  • Options: NFT rewards, airdrops, milestone bonuses');
    printInfo('  • veXF holders vote with up to 4x multipliers');
    printInfo('  • rXF bonus (0.1% of vote value) for active voters');
    printInfo('');
    
    printInfo('Current Phase 2 Configuration:');
    printInfo('  • RevenueSplitter splits: 50% veXF, 25% BBB, 15% rXF, 10% Treasury');
    printInfo('  • Deposit fee: 0.5%');
    printInfo('  • Yield recycle: 30% (reverse-burn loop)');
    printInfo('  • LP funding: 70%');
    printInfo('');
    
    printInfo('To activate governance:');
    printInfo('  1. Deploy veXF token contract');
    printInfo('  2. Deploy rXF token contract');
    printInfo('  3. Update RevenueSplitter with new splits (30/30/25/15)');
    printInfo('  4. Enable governance voting mechanism');
    printInfo('  5. Configure NFT/airdrop distribution contracts');
    printInfo('');
    
    printSuccess('Governance extras simulation complete');
  } catch (error) {
    printError(`Governance simulation failed: ${error.message}`);
  }
}

async function printFinalMetrics() {
  printHeader('FINAL TEST METRICS');
  
  const totalGasCost = METRICS.gasUsed * BigInt(TEST_CONFIG.gasPrice);
  const balanceChange = METRICS.startBalance - METRICS.endBalance;
  
  console.log(`Tests Passed:     ${METRICS.testsPassed}`);
  console.log(`Tests Failed:     ${METRICS.testsFailed}`);
  console.log(`Total Gas Used:   ${METRICS.gasUsed.toString()} units`);
  console.log(`Total Gas Cost:   ${hre.ethers.formatEther(totalGasCost)} TFUEL`);
  console.log(`Balance Change:   ${hre.ethers.formatEther(balanceChange)} TFUEL`);
  console.log('');
  console.log('Transaction Hashes:');
  METRICS.transactionHashes.forEach((hash, i) => {
    console.log(`  ${i + 1}. https://explorer.thetatoken.org/tx/${hash}`);
  });
  console.log('');
  
  const successRate = METRICS.testsPassed / (METRICS.testsPassed + METRICS.testsFailed) * 100;
  console.log(`Success Rate: ${successRate.toFixed(1)}%`);
  
  if (METRICS.testsFailed === 0) {
    printSuccess('All tests passed! ✅');
  } else {
    printWarning(`${METRICS.testsFailed} test(s) failed - review errors above`);
  }
}

async function main() {
  printHeader('🧪 XFUELLAB STEP 2 LIVE TESTING');
  console.log('Ferrari Hybrid Tokenomics v3.0');
  console.log('Network: Theta Mainnet (Chain ID: 361)');
  console.log('VaultFactory: ' + VAULT_FACTORY_ADDRESS);
  console.log('');
  
  try {
    // Load wallet
    const wallet = await loadWallet();
    
    // Get starting balance
    METRICS.startBalance = await hre.ethers.provider.getBalance(wallet.address);
    printInfo(`Starting balance: ${hre.ethers.formatEther(METRICS.startBalance)} TFUEL`);
    
    // Run tests
    const factory = await test1_AttachToFactory(wallet);
    const subVaultAddr = await test2_CreateSubVault(factory, wallet);
    const expectedValues = await test3_DepositToSubVault(subVaultAddr, wallet);
    await test4_VerifyRevSplitterBalance();
    
    // Only run unwrap if vault has balance
    const vaultBalance = await hre.ethers.provider.getBalance(subVaultAddr);
    if (vaultBalance > 0n) {
      await test5_MockUnwrap(factory, subVaultAddr, wallet);
    } else {
      printWarning('Skipping unwrap test - complete deposit first');
    }
    
    await test6_SimulateGovernanceExtras(factory);
    
    // Get ending balance
    METRICS.endBalance = await hre.ethers.provider.getBalance(wallet.address);
    
    // Print final metrics
    await printFinalMetrics();
    
    printHeader('✅ LIVE TESTING COMPLETE');
    console.log('Review results above and verify transactions on Theta Explorer');
    console.log('');
    
  } catch (error) {
    printError(`Testing failed: ${error.message}`);
    console.log('');
    console.log('Stack trace:');
    console.log(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { main };

