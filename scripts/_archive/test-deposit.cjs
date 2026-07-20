const hre = require('hardhat');

/**
 * Test Deposit to SubVault
 * 
 * Sends 0.1 TFUEL from deployer to SubVault to test deposit flow:
 * - 0.5% fee → RevenueSplitter
 * - 30% recycle flag
 * - 70% LP funding
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

// Addresses from live test
const VAULT_FACTORY_ADDRESS = '0xB0a26600074dADC69186632a1B8dFd7c3146Ce56';
const REVSPLITTER_ADDRESS = '0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6';
const SUBVAULT_ADDRESS = '0x15EA3E50F91F36EFC17B66815451de22251EDAaD'; // From test-live.cjs

// Test amount
const DEPOSIT_AMOUNT = '0.1'; // TFUEL

function printHeader(title) {
  console.log('');
  console.log('='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
  console.log('');
}

function printInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function printSuccess(message) {
  console.log(`✅ ${message}`);
}

function printError(message) {
  console.log(`❌ ${message}`);
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

async function main() {
  printHeader('🧪 TEST DEPOSIT TO SUBVAULT');
  
  console.log('SubVault: ' + SUBVAULT_ADDRESS);
  console.log('Amount: ' + DEPOSIT_AMOUNT + ' TFUEL');
  console.log('');
  
  try {
    // Load wallet
    const wallet = await loadWallet();
    
    // Get balances before
    const deployerBalanceBefore = await hre.ethers.provider.getBalance(wallet.address);
    const subVaultBalanceBefore = await hre.ethers.provider.getBalance(SUBVAULT_ADDRESS);
    const revSplitterBalanceBefore = await hre.ethers.provider.getBalance(REVSPLITTER_ADDRESS);
    
    printInfo(`Deployer balance: ${hre.ethers.formatEther(deployerBalanceBefore)} TFUEL`);
    printInfo(`SubVault balance (before): ${hre.ethers.formatEther(subVaultBalanceBefore)} TFUEL`);
    printInfo(`RevSplitter balance (before): ${hre.ethers.formatEther(revSplitterBalanceBefore)} TFUEL`);
    console.log('');
    
    // Calculate expected values
    const depositAmount = hre.ethers.parseEther(DEPOSIT_AMOUNT);
    const expectedFee = depositAmount * 5n / 1000n; // 0.5%
    const expectedNet = depositAmount - expectedFee;
    const expectedRecycle = expectedNet * 30n / 100n; // 30%
    const expectedLP = expectedNet - expectedRecycle; // 70%
    
    printInfo('Expected values:');
    printInfo(`  Gross deposit: ${hre.ethers.formatEther(depositAmount)} TFUEL`);
    printInfo(`  Fee (0.5%):    ${hre.ethers.formatEther(expectedFee)} TFUEL`);
    printInfo(`  Net locked:    ${hre.ethers.formatEther(expectedNet)} TFUEL`);
    printInfo(`  Recycle (30%): ${hre.ethers.formatEther(expectedRecycle)} TFUEL`);
    printInfo(`  LP Fund (70%): ${hre.ethers.formatEther(expectedLP)} TFUEL`);
    console.log('');
    
    // Get SubVault contract to listen for events
    const subVault = await hre.ethers.getContractAt('SubVault', SUBVAULT_ADDRESS, wallet);
    
    // Send deposit transaction
    printInfo('Sending deposit transaction...');
    const tx = await wallet.sendTransaction({
      to: SUBVAULT_ADDRESS,
      value: depositAmount,
      gasPrice: 4000000000000, // 4000 Gwei
      gasLimit: 200000
    });
    
    printInfo(`Transaction sent: ${tx.hash}`);
    printInfo('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    printSuccess(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log('');
    
    // Get balances after
    const deployerBalanceAfter = await hre.ethers.provider.getBalance(wallet.address);
    const subVaultBalanceAfter = await hre.ethers.provider.getBalance(SUBVAULT_ADDRESS);
    const revSplitterBalanceAfter = await hre.ethers.provider.getBalance(REVSPLITTER_ADDRESS);
    
    // Calculate actual changes
    const gasUsed = receipt.gasUsed * 4000000000000n;
    const deployerChange = deployerBalanceBefore - deployerBalanceAfter - gasUsed;
    const subVaultChange = subVaultBalanceAfter - subVaultBalanceBefore;
    const revSplitterChange = revSplitterBalanceAfter - revSplitterBalanceBefore;
    
    printHeader('📊 RESULTS');
    
    printInfo('Balance changes:');
    printInfo(`  Deployer spent: ${hre.ethers.formatEther(deployerChange)} TFUEL`);
    printInfo(`  SubVault gained: ${hre.ethers.formatEther(subVaultChange)} TFUEL`);
    printInfo(`  RevSplitter gained: ${hre.ethers.formatEther(revSplitterChange)} TFUEL`);
    printInfo(`  Gas used: ${hre.ethers.formatEther(gasUsed)} TFUEL`);
    console.log('');
    
    printInfo('Current balances:');
    printInfo(`  Deployer: ${hre.ethers.formatEther(deployerBalanceAfter)} TFUEL`);
    printInfo(`  SubVault: ${hre.ethers.formatEther(subVaultBalanceAfter)} TFUEL`);
    printInfo(`  RevSplitter: ${hre.ethers.formatEther(revSplitterBalanceAfter)} TFUEL`);
    console.log('');
    
    // Verify expectations
    printHeader('🔍 VERIFICATION');
    
    // Check if fee is close to expected (allowing for rounding)
    const feeDiff = revSplitterChange > expectedFee ? 
      revSplitterChange - expectedFee : 
      expectedFee - revSplitterChange;
    
    if (feeDiff < hre.ethers.parseEther('0.0001')) {
      printSuccess(`Fee split verified: ${hre.ethers.formatEther(revSplitterChange)} TFUEL ≈ ${hre.ethers.formatEther(expectedFee)} TFUEL`);
    } else {
      printError(`Fee mismatch: expected ${hre.ethers.formatEther(expectedFee)}, got ${hre.ethers.formatEther(revSplitterChange)}`);
    }
    
    // Check if net amount is in vault (allowing for rounding)
    const netDiff = subVaultChange > expectedNet ?
      subVaultChange - expectedNet :
      expectedNet - subVaultChange;
    
    if (netDiff < hre.ethers.parseEther('0.0001')) {
      printSuccess(`Net deposit verified: ${hre.ethers.formatEther(subVaultChange)} TFUEL ≈ ${hre.ethers.formatEther(expectedNet)} TFUEL`);
    } else {
      printError(`Net deposit mismatch: expected ${hre.ethers.formatEther(expectedNet)}, got ${hre.ethers.formatEther(subVaultChange)}`);
    }
    
    // Parse events from receipt
    printInfo('');
    printInfo('Events emitted:');
    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === SUBVAULT_ADDRESS.toLowerCase()) {
          const parsed = subVault.interface.parseLog(log);
          printInfo(`  📝 ${parsed.name}: ${JSON.stringify(parsed.args, (key, value) => 
            typeof value === 'bigint' ? value.toString() : value, 2)}`);
        }
      } catch (e) {
        // Skip unparseable logs
      }
    }
    
    console.log('');
    printSuccess('Deposit test complete!');
    printInfo(`Explorer: https://explorer.thetatoken.org/tx/${tx.hash}`);
    
    printHeader('🎯 NEXT STEPS');
    printInfo('The deposit is now in the SubVault.');
    printInfo('To test unwrap:');
    printInfo(`  npx hardhat run scripts/test-live.cjs --network theta-mainnet`);
    printInfo('  (The unwrap test will now run since vault has balance)');
    
  } catch (error) {
    printError(`Test failed: ${error.message}`);
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

