/**
 * Test Amount Safeguards for Mainnet Deployment
 * 
 * Ensures test amounts do not exceed safe limits:
 * - TFUEL deposits: Max 0.1 TFUEL
 * - XPRT operations: Max 1 XPRT
 * 
 * Usage in deployment scripts:
 *   const { validateTestAmount } = require('./test-amount-guard.cjs');
 *   await validateTestAmount('tfuel', depositAmount);
 */

const { ethers } = require('ethers');

// Maximum allowed amounts for mainnet testing
const MAX_AMOUNTS = {
  tfuel: ethers.parseEther('0.1'),      // 0.1 TFUEL
  xprt: BigInt('1000000'),               // 1 XPRT (6 decimals in uxprt)
  usdc: BigInt('1000000'),               // 1 USDC (6 decimals)
};

/**
 * Check if we're in mainnet/production mode
 */
function isMainnetMode() {
  return (
    process.env.NETWORK === 'mainnet' ||
    process.env.THETA_NETWORK === 'mainnet' ||
    process.env.NODE_ENV === 'production' ||
    process.env.HARDHAT_NETWORK === 'theta-mainnet'
  );
}

/**
 * Check if TEST_MODE is explicitly enabled
 */
function isTestModeEnabled() {
  return process.env.TEST_MODE === 'true' || process.env.TEST_MODE === '1';
}

/**
 * Validate test amount does not exceed limits
 * @param {string} token - Token type: 'tfuel', 'xprt', 'usdc'
 * @param {bigint|string} amount - Amount to validate
 * @param {boolean} throwOnExceed - Whether to throw error or just warn
 * @returns {boolean} - True if valid, false if exceeded
 */
function validateTestAmount(token, amount, throwOnExceed = true) {
  // Skip validation in non-mainnet modes
  if (!isMainnetMode()) {
    return true;
  }

  // Skip validation if TEST_MODE is disabled
  if (!isTestModeEnabled()) {
    console.warn('⚠️  WARNING: TEST_MODE not enabled but on mainnet network');
    console.warn('   Set TEST_MODE=true to enable test amount limits');
    return true;
  }

  const tokenLower = token.toLowerCase();
  const maxAmount = MAX_AMOUNTS[tokenLower];

  if (!maxAmount) {
    throw new Error(`Unknown token type: ${token}. Supported: tfuel, xprt, usdc`);
  }

  // Convert amount to BigInt if needed
  const amountBigInt = typeof amount === 'string' ? BigInt(amount) : amount;

  if (amountBigInt > maxAmount) {
    const message = `🚨 MAINNET TEST LIMIT EXCEEDED!\n` +
      `   Token: ${token.toUpperCase()}\n` +
      `   Requested: ${formatAmount(token, amountBigInt)}\n` +
      `   Maximum: ${formatAmount(token, maxAmount)}\n` +
      `   \n` +
      `   For mainnet testing, please use amounts below the limit.\n` +
      `   To disable this check, set TEST_MODE=false`;

    if (throwOnExceed) {
      throw new Error(message);
    } else {
      console.error(`❌ ${message}`);
      return false;
    }
  }

  console.log(`✅ Test amount valid: ${formatAmount(token, amountBigInt)} ${token.toUpperCase()} (< ${formatAmount(token, maxAmount)})`);
  return true;
}

/**
 * Format amount for display
 */
function formatAmount(token, amount) {
  switch (token.toLowerCase()) {
    case 'tfuel':
      return ethers.formatEther(amount);
    case 'xprt':
    case 'usdc':
      return (Number(amount) / 1e6).toFixed(6);
    default:
      return amount.toString();
  }
}

/**
 * Validate reverse-burn test amount (XPRT)
 * Ensures reverse-burn testing uses <= 1 XPRT
 */
function validateReverseBurnAmount(xprtAmount) {
  if (!isMainnetMode()) {
    return true;
  }

  const amountBigInt = typeof xprtAmount === 'string' ? BigInt(xprtAmount) : xprtAmount;
  const maxXprt = MAX_AMOUNTS.xprt;

  if (amountBigInt > maxXprt) {
    throw new Error(
      `🚨 REVERSE-BURN TEST LIMIT EXCEEDED!\n` +
      `   Requested: ${formatAmount('xprt', amountBigInt)} XPRT\n` +
      `   Maximum: ${formatAmount('xprt', maxXprt)} XPRT\n` +
      `   \n` +
      `   Reverse-burn testing on mainnet is limited to 1 XPRT.\n` +
      `   Please reduce the test amount or use testnet.`
    );
  }

  console.log(`✅ Reverse-burn test amount valid: ${formatAmount('xprt', amountBigInt)} XPRT`);
  return true;
}

/**
 * Wrap async function with test amount validation
 * Usage: validateTestDeposit(async () => { ... }, 'tfuel', amount)
 */
async function validateTestDeposit(fn, token, amount) {
  validateTestAmount(token, amount, true);
  return await fn();
}

/**
 * Print current test limits
 */
function printTestLimits() {
  console.log('\n' + '='.repeat(60));
  console.log('📏 Test Amount Limits (Mainnet)');
  console.log('='.repeat(60));
  console.log(`TFUEL Deposits:    ${ethers.formatEther(MAX_AMOUNTS.tfuel)} TFUEL max`);
  console.log(`XPRT Operations:   ${formatAmount('xprt', MAX_AMOUNTS.xprt)} XPRT max`);
  console.log(`USDC Reverse-Burn: ${formatAmount('usdc', MAX_AMOUNTS.usdc)} USDC max`);
  console.log(`\nMode: ${isMainnetMode() ? '🚨 MAINNET' : '🧪 TESTNET/DEV'}`);
  console.log(`TEST_MODE: ${isTestModeEnabled() ? '✅ ENABLED' : '⚠️  DISABLED'}`);
  console.log('='.repeat(60) + '\n');
}

module.exports = {
  validateTestAmount,
  validateReverseBurnAmount,
  validateTestDeposit,
  isMainnetMode,
  isTestModeEnabled,
  printTestLimits,
  MAX_AMOUNTS,
};
