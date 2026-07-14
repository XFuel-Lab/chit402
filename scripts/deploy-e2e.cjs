#!/usr/bin/env node

/**
 * Deploy VaultFactory to Theta Mainnet and configure backend
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting E2E Deployment for Theta-Persistence ZK Bridge\n');

// Step 1: Read deployment info
console.log('📖 Reading existing deployments...');
const phase3Mainnet = JSON.parse(
  fs.readFileSync('deployments/phase3-mainnet.json', 'utf8')
);

const revSplitterAddress = phase3Mainnet.phase1.contracts.revenueSplitter;
console.log('✅ RevenueSplitter address:', revSplitterAddress);
console.log('');

// Step 2: Deploy VaultFactory
console.log('📦 Deploying VaultFactory to Theta Mainnet...');
console.log('   Using RevenueSplitter:', revSplitterAddress);
console.log('');

// Set environment variable for deployment
process.env.REV_SPLITTER_ADDRESS = revSplitterAddress;

// Deploy using hardhat
exec('npx hardhat run scripts/deploy-vault-factory.cjs --network theta-mainnet', 
  (error, stdout, stderr) => {
    if (error) {
      console.error('❌ Deployment failed:', error);
      return;
    }
    
    console.log(stdout);
    
    if (stderr) {
      console.error('⚠️  Warnings:', stderr);
    }
    
    // Parse output to get contract address
    const match = stdout.match(/VaultFactory deployed to: (0x[a-fA-F0-9]{40})/);
    if (match) {
      const vaultFactoryAddress = match[1];
      
      // Step 3: Configure backend
      console.log('');
      console.log('⚙️  Configuring backend service...');
      
      const envPath = path.join(__dirname, 'backend', 'theta-bridge', '.env');
      const envExample = fs.readFileSync(
        path.join(__dirname, 'backend', 'theta-bridge', 'env.example'),
        'utf8'
      );
      
      // Update .env with real values
      let envContent = envExample
        .replace('VAULT_FACTORY_ADDRESS=0x1234567890123456789012345678901234567890', 
                 `VAULT_FACTORY_ADDRESS=${vaultFactoryAddress}`)
        .replace('RELAYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE',
                 `# RELAYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE  # TODO: Add relayer key`);
      
      fs.writeFileSync(envPath, envContent);
      console.log('✅ Backend .env configured');
      console.log('');
      
      // Save deployment info
      const bridgeDeployment = {
        network: 'theta-mainnet',
        chainId: '361',
        timestamp: new Date().toISOString(),
        contracts: {
          vaultFactory: vaultFactoryAddress,
          revenueSplitter: revSplitterAddress
        }
      };
      
      fs.writeFileSync(
        path.join(__dirname, 'deployments', 'bridge-mainnet.json'),
        JSON.stringify(bridgeDeployment, null, 2)
      );
      
      console.log('✅ Deployment complete!');
      console.log('');
      console.log('=' .repeat(70));
      console.log('📋 NEXT STEPS FOR E2E TESTING');
      console.log('=' .repeat(70));
      console.log('');
      console.log('1. ADD RELAYER PRIVATE KEY:');
      console.log('   cd services/gateway');
      console.log('   Edit .env and add RELAYER_PRIVATE_KEY');
      console.log('');
      console.log('2. FUND RELAYER WALLET:');
      console.log('   Send TFUEL to relayer for gas');
      console.log('');
      console.log('3. START REDIS:');
      console.log('   redis-server');
      console.log('');
      console.log('4. START BRIDGE SERVICE:');
      console.log('   cd services/gateway');
      console.log('   npm run dev');
      console.log('');
      console.log('5. TEST DEPOSIT:');
      console.log('   - Create vault from frontend');
      console.log('   - Send TFUEL to vault address');
      console.log('   - Watch bridge logs for processing');
      console.log('');
      console.log('=' .repeat(70));
    }
  }
);

