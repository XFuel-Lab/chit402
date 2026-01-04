const hre = require('hardhat');

/**
 * Deployment script for ZK Bridge Hybrid - VaultFactory & SubVault
 * 
 * This script deploys:
 * 1. MockRevenueSplitter (or use existing RevenueSplitter address)
 * 2. VaultFactory with Create2 SubVault deployment
 * 3. Grants ZK_BRIDGE_ROLE to specified operator
 */
async function main() {
  console.log('🚀 Starting ZK Bridge Hybrid deployment...\n');

  const [deployer] = await hre.ethers.getSigners();
  console.log('📝 Deploying with account:', deployer.address);
  
  const balance = await deployer.getBalance();
  console.log('💰 Account balance:', hre.ethers.utils.formatEther(balance), 'TFUEL\n');

  if (balance.lt(hre.ethers.utils.parseEther('1'))) {
    console.warn('⚠️  Warning: Low balance. You may need more TFUEL for deployment.\n');
  }

  // Configuration
  const ADMIN_ADDRESS = deployer.address; // Change if needed
  const ZK_BRIDGE_OPERATOR_ADDRESS = deployer.address; // Change to actual operator address
  
  // Option 1: Deploy new MockRevenueSplitter for testing
  // Option 2: Use existing RevenueSplitter address
  const USE_EXISTING_REV_SPLITTER = false;
  const EXISTING_REV_SPLITTER_ADDRESS = '0x0000000000000000000000000000000000000000';

  let revSplitterAddress;

  if (USE_EXISTING_REV_SPLITTER && EXISTING_REV_SPLITTER_ADDRESS !== '0x0000000000000000000000000000000000000000') {
    console.log('📦 Using existing RevenueSplitter:', EXISTING_REV_SPLITTER_ADDRESS);
    revSplitterAddress = EXISTING_REV_SPLITTER_ADDRESS;
  } else {
    console.log('📦 Deploying MockRevenueSplitter...');
    const MockRevenueSplitter = await hre.ethers.getContractFactory('MockRevenueSplitter');
    const revSplitter = await MockRevenueSplitter.deploy();
    await revSplitter.deployed();
    
    revSplitterAddress = revSplitter.address;
    console.log('✅ MockRevenueSplitter deployed to:', revSplitterAddress);
    console.log('   Transaction hash:', revSplitter.deployTransaction.hash);
    console.log('   Block number:', revSplitter.deployTransaction.blockNumber || 'pending\n');
  }

  // Deploy VaultFactory
  console.log('📦 Deploying VaultFactory...');
  const VaultFactory = await hre.ethers.getContractFactory('VaultFactory');
  const vaultFactory = await VaultFactory.deploy(ADMIN_ADDRESS, revSplitterAddress);
  await vaultFactory.deployed();

  console.log('✅ VaultFactory deployed to:', vaultFactory.address);
  console.log('   Transaction hash:', vaultFactory.deployTransaction.hash);
  console.log('   Block number:', vaultFactory.deployTransaction.blockNumber || 'pending');
  console.log('   Admin address:', ADMIN_ADDRESS);
  console.log('   RevenueSplitter:', revSplitterAddress, '\n');

  // Grant ZK_BRIDGE_ROLE to operator
  console.log('📦 Granting ZK_BRIDGE_ROLE to operator...');
  const ZK_BRIDGE_ROLE = hre.ethers.utils.keccak256(
    hre.ethers.utils.toUtf8Bytes('ZK_BRIDGE_ROLE')
  );
  
  const grantTx = await vaultFactory.grantRole(ZK_BRIDGE_ROLE, ZK_BRIDGE_OPERATOR_ADDRESS);
  await grantTx.wait();
  
  console.log('✅ ZK_BRIDGE_ROLE granted to:', ZK_BRIDGE_OPERATOR_ADDRESS);
  console.log('   Transaction hash:', grantTx.hash, '\n');

  // Verify roles
  const DEFAULT_ADMIN_ROLE = hre.ethers.constants.HashZero;
  const PAUSER_ROLE = hre.ethers.utils.keccak256(
    hre.ethers.utils.toUtf8Bytes('PAUSER_ROLE')
  );

  console.log('🔐 Role verification:');
  console.log('   DEFAULT_ADMIN_ROLE:', await vaultFactory.hasRole(DEFAULT_ADMIN_ROLE, ADMIN_ADDRESS) ? '✅' : '❌');
  console.log('   PAUSER_ROLE:', await vaultFactory.hasRole(PAUSER_ROLE, ADMIN_ADDRESS) ? '✅' : '❌');
  console.log('   ZK_BRIDGE_ROLE:', await vaultFactory.hasRole(ZK_BRIDGE_ROLE, ZK_BRIDGE_OPERATOR_ADDRESS) ? '✅' : '❌', '\n');

  // Test Create2 prediction
  console.log('🧪 Testing Create2 vault prediction...');
  const testPersistenceAddr = '0x' + '42'.repeat(20);
  const testNonce = 0;
  const testSalt = await vaultFactory.generateSalt(testPersistenceAddr, testNonce);
  const predictedVaultAddr = await vaultFactory.predictAddress(testSalt);
  
  console.log('   Test persistence address:', testPersistenceAddr);
  console.log('   Test nonce:', testNonce);
  console.log('   Generated salt:', testSalt);
  console.log('   Predicted vault address:', predictedVaultAddr, '\n');

  // Create a test vault (optional)
  const CREATE_TEST_VAULT = false;
  if (CREATE_TEST_VAULT) {
    console.log('📦 Creating test vault...');
    const createTx = await vaultFactory.createVault(testSalt);
    const createReceipt = await createTx.wait();
    
    console.log('✅ Test vault created at:', predictedVaultAddr);
    console.log('   Transaction hash:', createTx.hash);
    console.log('   Gas used:', createReceipt.gasUsed.toString(), '\n');
  }

  // Summary
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    DEPLOYMENT SUMMARY                          ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║ VaultFactory:       ', vaultFactory.address.padEnd(42), '║');
  console.log('║ RevenueSplitter:    ', revSplitterAddress.padEnd(42), '║');
  console.log('║ Admin:              ', ADMIN_ADDRESS.padEnd(42), '║');
  console.log('║ ZK Bridge Operator: ', ZK_BRIDGE_OPERATOR_ADDRESS.padEnd(42), '║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('📋 Next steps:');
  console.log('   1. Update ZK_BRIDGE_OPERATOR_ADDRESS in this script for production');
  console.log('   2. Point to production RevenueSplitter address if needed');
  console.log('   3. Set up ZK bridge relayer to monitor DepositReceived events');
  console.log('   4. Configure relayer to call unwrapFromBurn on verified burns');
  console.log('   5. Test with small amounts first\n');

  console.log('📝 Save these addresses to .env or config:');
  console.log(`   VAULT_FACTORY_ADDRESS=${vaultFactory.address}`);
  console.log(`   REVENUE_SPLITTER_ADDRESS=${revSplitterAddress}`);
  console.log(`   ZK_BRIDGE_OPERATOR_ADDRESS=${ZK_BRIDGE_OPERATOR_ADDRESS}\n`);

  console.log('✨ Deployment complete!\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

