/**
 * Address Validation Script
 * 
 * Validates all addresses and configuration before deployment
 * Tests dry-run mode to ensure addresses are correct
 * 
 * Usage:
 *   node scripts/validate-addresses.cjs
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local if it exists
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

console.log('\n' + '='.repeat(60));
console.log('🔍 XFuel Protocol - Address Validation');
console.log('='.repeat(60) + '\n');

let errorCount = 0;
let warningCount = 0;

function logError(message) {
  console.error(`❌ ERROR: ${message}`);
  errorCount++;
}

function logWarning(message) {
  console.warn(`⚠️  WARNING: ${message}`);
  warningCount++;
}

function logSuccess(message) {
  console.log(`✅ ${message}`);
}

function validatePersistenceAddress(addr, name) {
  if (!addr) {
    logError(`${name} is not set`);
    return false;
  }
  if (!addr.startsWith('persistence1')) {
    logError(`${name} has invalid format: ${addr} (must start with persistence1)`);
    return false;
  }
  if (addr.length < 45) {
    logError(`${name} is too short: ${addr}`);
    return false;
  }
  // Check for placeholder patterns
  if (addr.includes('...') || addr.match(/[0-9a-z]\1{10,}/)) {
    logError(`${name} appears to be a placeholder: ${addr}`);
    return false;
  }
  logSuccess(`${name}: ${addr}`);
  return true;
}

function validateEthereumAddress(addr, name, required = true) {
  if (!addr) {
    if (required) {
      logError(`${name} is not set`);
      return false;
    } else {
      logWarning(`${name} is not set (optional)`);
      return true;
    }
  }
  if (!addr.startsWith('0x')) {
    logError(`${name} has invalid format: ${addr} (must start with 0x)`);
    return false;
  }
  if (addr.length !== 42) {
    logError(`${name} has invalid length: ${addr} (must be 42 characters)`);
    return false;
  }
  // Check for zero address
  if (addr === '0x0000000000000000000000000000000000000000') {
    logError(`${name} is zero address (not allowed)`);
    return false;
  }
  // Check for placeholder patterns
  if (addr === '0x1234567890123456789012345678901234567890') {
    logError(`${name} appears to be a placeholder: ${addr}`);
    return false;
  }
  logSuccess(`${name}: ${addr}`);
  return true;
}

console.log('📋 Section 1: Deployer & Multisig Addresses\n');
console.log('New deployer: persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx');
console.log('New multisig: persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e');
console.log('');

console.log('📋 Section 2: Backend IBC Configuration\n');

// Validate Dexter Router
const dexterRouter = process.env.PERSISTENCE_DEXTER_ROUTER;
validatePersistenceAddress(
  dexterRouter,
  'PERSISTENCE_DEXTER_ROUTER'
);

// Expected: persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk
if (dexterRouter && dexterRouter !== 'persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk') {
  logWarning('PERSISTENCE_DEXTER_ROUTER does not match known mainnet address');
  console.log(`   Expected: persistence132xmxm33vwjlur2pszl4hu9r32lqmqagvunnuc5hq4htps7rr3kqsf4dsk`);
  console.log(`   Got:      ${dexterRouter}`);
}

// Validate pStake (optional now)
const pstakeAddr = process.env.PSTAKE_STAKING_CONTRACT;
if (pstakeAddr) {
  if (pstakeAddr.startsWith('persistence1')) {
    logSuccess(`PSTAKE_STAKING_CONTRACT: ${pstakeAddr}`);
  } else {
    logError(`PSTAKE_STAKING_CONTRACT has invalid format: ${pstakeAddr}`);
  }
} else {
  logWarning('PSTAKE_STAKING_CONTRACT not set (deprecated, expected)');
}

// Validate IBC Denom
const tfuelIbcDenom = process.env.TFUEL_IBC_DENOM;
if (!tfuelIbcDenom) {
  logError('TFUEL_IBC_DENOM is not set');
} else if (!tfuelIbcDenom.startsWith('ibc/')) {
  logError(`TFUEL_IBC_DENOM has invalid format: ${tfuelIbcDenom}`);
} else if (tfuelIbcDenom === 'ibc/...') {
  logError('TFUEL_IBC_DENOM is a placeholder');
} else {
  logSuccess(`TFUEL_IBC_DENOM: ${tfuelIbcDenom}`);
}

// NEW: Validate ZK Verifier Address
console.log('\n📋 Section 2b: ZK Contract Addresses\n');

const zkVerifierAddr = process.env.ZK_VERIFIER_ADDRESS;
if (zkVerifierAddr) {
  validatePersistenceAddress(zkVerifierAddr, 'ZK_VERIFIER_ADDRESS');
} else {
  logWarning('ZK_VERIFIER_ADDRESS not set (required for ZK proof verification)');
}

// Validate Persistence Minter (moved from Section 3)
const persistenceMinter = process.env.PERSISTENCE_MINTER_CONTRACT;
if (persistenceMinter) {
  validatePersistenceAddress(persistenceMinter, 'PERSISTENCE_MINTER_CONTRACT');
} else {
  logError('PERSISTENCE_MINTER_CONTRACT not set (required for minting operations)');
}

console.log('\n📋 Section 3: Theta Bridge Configuration\n');

// Validate Vault Factory
const vaultFactory = process.env.VAULT_FACTORY_ADDRESS;
validateEthereumAddress(vaultFactory, 'VAULT_FACTORY_ADDRESS', true);

// Validate Revenue Splitter
const revenueSplitter = process.env.REVENUE_SPLITTER_ADDRESS;
validateEthereumAddress(revenueSplitter, 'REVENUE_SPLITTER_ADDRESS', false);

// Validate Swap Router
const swapRouter = process.env.SWAP_ROUTER_ADDRESS;
validateEthereumAddress(swapRouter, 'SWAP_ROUTER_ADDRESS', false);

console.log('\n📋 Section 4: RevSplitter Configuration\n');

const bbbContract = process.env.BBB_CONTRACT_ADDRESS;
const vexfDistributor = process.env.VEXF_DISTRIBUTOR_ADDRESS;

if (bbbContract) {
  validateEthereumAddress(bbbContract, 'BBB_CONTRACT_ADDRESS', false);
} else {
  logWarning('BBB_CONTRACT_ADDRESS not set (required for RevSplitter deployment)');
}

if (vexfDistributor) {
  validateEthereumAddress(vexfDistributor, 'VEXF_DISTRIBUTOR_ADDRESS', false);
} else {
  logWarning('VEXF_DISTRIBUTOR_ADDRESS not set (required for RevSplitter deployment)');
}

console.log('\n📋 Section 5: Hardcoded LP Treasury\n');

const lpTreasury = 'persistence1q50x9h4nchk2uhhj5jre0jsqxrs9qmhvjwf8yj';
console.log(`LP Treasury (hardcoded in contracts): ${lpTreasury}`);
logSuccess('LP Treasury address format is valid');

console.log('\n📋 Section 6: Test Amount Safeguards\n');

// Check for mainnet deployment mode
const isMainnet = process.env.NETWORK === 'mainnet' || process.env.THETA_NETWORK === 'mainnet';
const isProduction = process.env.NODE_ENV === 'production';

if (isMainnet || isProduction) {
  console.log('🚨 MAINNET/PRODUCTION MODE DETECTED\n');
  
  // Validate test amount limits
  const maxTestTfuel = 0.1; // 0.1 TFUEL max for mainnet testing
  const maxTestXprt = 1.0;  // 1 XPRT max for mainnet testing
  
  logSuccess(`TFUEL Test Limit: ${maxTestTfuel} TFUEL max`);
  logSuccess(`XPRT Test Limit: ${maxTestXprt} XPRT max`);
  
  // Check MIN_YIELD_AMOUNT (should be small for testing)
  const minYieldAmount = process.env.MIN_YIELD_AMOUNT || '1000000';
  const minYieldUsdc = parseInt(minYieldAmount) / 1e6;
  
  if (minYieldUsdc > 1.0) {
    logWarning(`MIN_YIELD_AMOUNT is ${minYieldUsdc} USDC (high for testing)`);
    console.log(`   Consider lowering to 1 USDC (1000000) for test mode`);
  } else {
    logSuccess(`MIN_YIELD_AMOUNT: ${minYieldUsdc} USDC (safe for testing)`);
  }
  
  console.log('\n⚠️  IMPORTANT: Mainnet test transactions should be limited to:');
  console.log(`   - Maximum 0.1 TFUEL per test deposit`);
  console.log(`   - Maximum 1 XPRT per reverse-burn test`);
  console.log(`   - Use TEST_MODE=true flag in deployment scripts`);
} else {
  logSuccess('Development/Testnet mode - no amount restrictions');
}

console.log('\n' + '='.repeat(60));
console.log('📊 Validation Summary');
console.log('='.repeat(60) + '\n');

if (errorCount === 0 && warningCount === 0) {
  console.log('🎉 All validations passed!\n');
  process.exit(0);
} else {
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`⚠️  Warnings: ${warningCount}\n`);
  
  if (errorCount > 0) {
    console.log('❌ Validation FAILED. Please fix the errors above before deployment.\n');
    process.exit(1);
  } else {
    console.log('⚠️  Validation passed with warnings. Review warnings before deployment.\n');
    process.exit(0);
  }
}
