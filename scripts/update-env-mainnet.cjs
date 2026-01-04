const fs = require('fs');
const path = require('path');

/**
 * Update Environment with Mainnet Addresses
 * 
 * Auto-updates .env with verified mainnet addresses from Step 2
 */

const MAINNET_CONFIG = {
  // Theta Mainnet
  THETA_RPC_URL: 'https://eth-rpc-api.thetatoken.org/rpc',
  THETA_CHAIN_ID: '361',
  VAULTFACTORY_ADDRESS: '0xB0a26600074dADC69186632a1B8dFd7c3146Ce56',
  REVSPLITTER_ADDRESS: '0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6',
  TEST_SUBVAULT_ADDRESS: '0x15EA3E50F91F36EFC17B66815451de22251EDAaD',
  
  // Backend Configuration
  BACKEND_POLL_INTERVAL: '2000',
  BACKEND_ZK_PROOF_DELAY: '1500',
  BACKEND_LOG_LEVEL: 'info',
  BACKEND_ENABLE_METRICS: 'true',
  BACKEND_PORT: '3000',
  
  // Ferrari Hybrid Tokenomics
  DEPOSIT_FEE_PERCENT: '0.5',
  YIELD_RECYCLE_PERCENT: '30',
  LP_FUNDING_PERCENT: '70',
  BBB_SPLIT: '30',
  LP_GOVERNANCE_SPLIT: '30',
  VEXF_SPLIT: '25',
  TREASURY_SPLIT: '15',
  
  // Governance Extras
  GOVERNANCE_LP_ALLOCATION_MIN: '5',
  GOVERNANCE_LP_ALLOCATION_MAX: '10',
  VEXF_MAX_MULTIPLIER: '4',
  RXF_VOTER_BONUS: '0.1',
};

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

function updateEnvFile(filePath, config) {
  let content = '';
  
  // Read existing .env if it exists
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf8');
    printInfo(`Found existing ${path.basename(filePath)}`);
  } else {
    printInfo(`Creating new ${path.basename(filePath)}`);
  }
  
  const lines = content.split('\n');
  const existingKeys = new Set();
  const updatedLines = [];
  
  // Update existing keys
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments at the start
    if (!trimmed || trimmed.startsWith('#')) {
      updatedLines.push(line);
      continue;
    }
    
    const [key] = trimmed.split('=');
    if (key && config[key] !== undefined) {
      updatedLines.push(`${key}=${config[key]}`);
      existingKeys.add(key);
      printSuccess(`Updated: ${key}=${config[key]}`);
    } else {
      updatedLines.push(line);
    }
  }
  
  // Add new keys
  const newKeys = Object.keys(config).filter(k => !existingKeys.has(k));
  if (newKeys.length > 0) {
    updatedLines.push('');
    updatedLines.push('# Added by update-env-mainnet.cjs');
    for (const key of newKeys) {
      updatedLines.push(`${key}=${config[key]}`);
      printSuccess(`Added: ${key}=${config[key]}`);
    }
  }
  
  // Write back to file
  fs.writeFileSync(filePath, updatedLines.join('\n') + '\n');
  printSuccess(`${path.basename(filePath)} updated successfully`);
}

async function main() {
  printHeader('🔧 UPDATE ENVIRONMENT WITH MAINNET ADDRESSES');
  
  console.log('Live Mainnet Addresses (Step 2 Verified):');
  console.log(`  VaultFactory: ${MAINNET_CONFIG.VAULTFACTORY_ADDRESS}`);
  console.log(`  RevenueSplitter: ${MAINNET_CONFIG.REVSPLITTER_ADDRESS}`);
  console.log(`  Test SubVault: ${MAINNET_CONFIG.TEST_SUBVAULT_ADDRESS}`);
  console.log('');
  
  try {
    // Update .env
    const envPath = path.join(process.cwd(), '.env');
    printInfo('Updating .env...');
    updateEnvFile(envPath, MAINNET_CONFIG);
    console.log('');
    
    printHeader('✅ ENVIRONMENT UPDATE COMPLETE');
    
    console.log('Next steps:');
    console.log('1. Verify: node scripts/verify-backend-env.cjs');
    console.log('2. Test: node scripts/test-backend-integration.cjs');
    console.log('3. Start: npm run backend:start');
    console.log('');
    
  } catch (error) {
    printError(`Failed to update environment: ${error.message}`);
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

module.exports = { updateEnvFile, MAINNET_CONFIG };

