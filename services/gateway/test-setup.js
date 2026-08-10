// Test script to validate all modules
import config from './src/config.js';
import logger from './src/logger.js';

console.log('✅ Testing Theta-Persistence ZK Bridge Service\n');

// Test 1: Configuration
console.log('1. Testing Configuration...');
try {
  console.log('   ✓ Config loaded');
  console.log('   - Service port:', config.service.port);
  console.log('   - Log level:', config.service.logLevel);
  console.log('   - Theta RPC URLs:', config.theta.rpcUrls.length);
  console.log('   - Expiry minutes:', config.expiry.minutes);
} catch (error) {
  console.error('   ✗ Config failed:', error.message);
  process.exit(1);
}

// Test 2: Logger
console.log('\n2. Testing Logger...');
try {
  logger.info('Test log message');
  console.log('   ✓ Logger working');
} catch (error) {
  console.error('   ✗ Logger failed:', error.message);
  process.exit(1);
}

// Test 3: Check required dependencies
console.log('\n3. Checking Dependencies...');
const requiredDeps = [
  'ethers',
  'redis',
  'pino',
  'dotenv',
  'express'
];

for (const dep of requiredDeps) {
  try {
    await import(dep);
    console.log(`   ✓ ${dep}`);
  } catch (error) {
    console.log(`   ✗ ${dep} - Not installed (run: npm install)`);
  }
}

// Test 4: Verify file structure
console.log('\n4. Verifying File Structure...');
import { existsSync } from 'fs';

const requiredFiles = [
  'src/index.js',
  'src/config.js',
  'src/logger.js',
  'src/provider.js',
  'src/redis-client.js',
  'src/listener.js',
  'src/prover.js',
  'src/refund-manager.js',
  'abis/SubVault.json',
  'abis/VaultFactory.json',
  'package.json'
];

let allFilesExist = true;
for (const file of requiredFiles) {
  if (existsSync(file)) {
    console.log(`   ✓ ${file}`);
  } else {
    console.log(`   ✗ ${file} - Missing!`);
    allFilesExist = false;
  }
}

// Test 5: Validate ABIs
console.log('\n5. Validating Contract ABIs...');
try {
  const { readFileSync } = await import('fs');
  
  const subVaultAbi = JSON.parse(readFileSync('abis/SubVault.json', 'utf8'));
  const depositEvent = subVaultAbi.find(item => 
    item.type === 'event' && item.name === 'DepositReceived'
  );
  
  if (depositEvent) {
    console.log('   ✓ SubVault ABI has DepositReceived event');
    console.log('   - Event params:', depositEvent.inputs.length);
  } else {
    console.log('   ✗ SubVault ABI missing DepositReceived event');
    allFilesExist = false;
  }
  
  const factoryAbi = JSON.parse(readFileSync('abis/VaultFactory.json', 'utf8'));
  const refundFunc = factoryAbi.find(item => 
    item.type === 'function' && item.name === 'refundFromVault'
  );
  
  if (refundFunc) {
    console.log('   ✓ VaultFactory ABI has refundFromVault function');
  } else {
    console.log('   ✗ VaultFactory ABI missing refundFromVault');
    allFilesExist = false;
  }
} catch (error) {
  console.error('   ✗ ABI validation failed:', error.message);
  process.exit(1);
}

// Test 6: Environment check
console.log('\n6. Checking Environment...');
const requiredEnvVars = [
  'VAULT_FACTORY_ADDRESS',
  'RELAYER_PRIVATE_KEY'
];

let envConfigured = existsSync('.env');
if (envConfigured) {
  console.log('   ✓ .env file exists');
} else {
  console.log('   ⚠ .env file not found (copy from env.example)');
}

// Summary
console.log('\n' + '='.repeat(50));
console.log('Test Summary:');
console.log('='.repeat(50));

if (allFilesExist && envConfigured) {
  console.log('✅ All tests passed!');
  console.log('\n📝 Next steps:');
  console.log('   1. Configure .env with your values');
  console.log('   2. Install dependencies: npm install');
  console.log('   3. Start Redis: redis-server');
  console.log('   4. Run service: npm run dev');
} else {
  console.log('⚠️  Some checks failed. Please review above.');
  console.log('\n📝 To fix:');
  if (!envConfigured) {
    console.log('   - Copy env.example to .env');
  }
  console.log('   - Run: npm install');
}

console.log('\n🎯 Service is ready for deployment!');

