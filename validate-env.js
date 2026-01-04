#!/usr/bin/env node

/**
 * @XFuelLab Environment Validation Script
 * Validates .env configuration including keystore, addresses, and AWS credentials
 */

import dotenv from 'dotenv';
import fs from 'fs';
import { ethers } from 'ethers';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Load .env.local first (for secrets), then .env (for public config)
// This matches the pattern used in hardhat.config.cjs
dotenv.config({ path: '.env.local' });
dotenv.config();

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

const CHECK_MARK = '✅';
const CROSS_MARK = '❌';
const WARNING = '⚠️';

// Validation results tracker
const results = {
  passed: 0,
  failed: 0,
  warnings: 0
};

/**
 * Log a validation result
 */
function logResult(label, success, message = '') {
  const icon = success ? CHECK_MARK : CROSS_MARK;
  const color = success ? colors.green : colors.red;
  const status = success ? 'Valid' : 'Invalid';
  
  console.log(`${color}${label}: ${status} ${icon}${colors.reset}`);
  
  if (message) {
    console.log(`  ${colors.yellow}${message}${colors.reset}`);
  }
  
  if (success) {
    results.passed++;
  } else {
    results.failed++;
  }
  
  return success;
}

/**
 * Log a warning
 */
function logWarning(label, message) {
  console.log(`${colors.yellow}${label}: ${WARNING} ${message}${colors.reset}`);
  results.warnings++;
}

/**
 * Validate that keystore path exists and is a file
 */
function validateKeystorePath() {
  console.log(`\n${colors.bold}${colors.blue}=== Validating Keystore Path ===${colors.reset}`);
  
  const keystorePath = process.env.DEPLOYER_MAINNET_KEYSTORE_PATH;
  
  if (!keystorePath) {
    return logResult('DEPLOYER_MAINNET_KEYSTORE_PATH', false, 'Environment variable not set');
  }
  
  if (!fs.existsSync(keystorePath)) {
    return logResult('DEPLOYER_MAINNET_KEYSTORE_PATH', false, `File does not exist: ${keystorePath}`);
  }
  
  const stats = fs.statSync(keystorePath);
  if (!stats.isFile()) {
    return logResult('DEPLOYER_MAINNET_KEYSTORE_PATH', false, `Path exists but is not a file: ${keystorePath}`);
  }
  
  return logResult('DEPLOYER_MAINNET_KEYSTORE_PATH', true, `File exists: ${keystorePath}`);
}

/**
 * Validate that keystore can be decrypted with password
 */
async function validateKeystoreDecryption() {
  console.log(`\n${colors.bold}${colors.blue}=== Validating Keystore Decryption ===${colors.reset}`);
  
  const keystorePath = process.env.DEPLOYER_MAINNET_KEYSTORE_PATH;
  const password = process.env.DEPLOYER_KEYSTORE_PASSWORD;
  
  if (!keystorePath) {
    return logResult('KEYSTORE_DECRYPTION', false, 'DEPLOYER_MAINNET_KEYSTORE_PATH not set');
  }
  
  if (!password) {
    logWarning('KEYSTORE_DECRYPTION', 'DEPLOYER_KEYSTORE_PASSWORD not set - skipping decryption test');
    return true;
  }
  
  try {
    const keystoreJson = fs.readFileSync(keystorePath, 'utf8');
    const wallet = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
    
    return logResult('KEYSTORE_DECRYPTION', true, `Successfully decrypted wallet: ${wallet.address}`);
  } catch (error) {
    return logResult('KEYSTORE_DECRYPTION', false, `Decryption failed: ${error.message}`);
  }
}

/**
 * Validate EVM address format
 */
function validateAddress(envVarName) {
  const address = process.env[envVarName];
  
  if (!address) {
    return logResult(envVarName, false, 'Environment variable not set');
  }
  
  try {
    const isValid = ethers.isAddress(address);
    
    if (isValid) {
      // Normalize to checksum address
      const checksumAddress = ethers.getAddress(address);
      return logResult(envVarName, true, `Valid address: ${checksumAddress}`);
    } else {
      return logResult(envVarName, false, `Invalid EVM address format: ${address}`);
    }
  } catch (error) {
    return logResult(envVarName, false, `Address validation error: ${error.message}`);
  }
}

/**
 * Validate all EVM addresses
 */
function validateAddresses() {
  console.log(`\n${colors.bold}${colors.blue}=== Validating EVM Addresses ===${colors.reset}`);
  
  const addresses = [
    'DEPLOYER_ADDRESS',
    'RELAYER_ADDRESS',
    'TREASURY_ADDRESS'
  ];
  
  let allValid = true;
  
  addresses.forEach(addr => {
    const valid = validateAddress(addr);
    if (!valid) allValid = false;
  });
  
  return allValid;
}

/**
 * Validate AWS credentials and connection
 */
async function validateAWSCredentials() {
  console.log(`\n${colors.bold}${colors.blue}=== Validating AWS Credentials ===${colors.reset}`);
  
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  
  // Check if credentials are set
  if (!region) {
    logResult('AWS_REGION', false, 'Environment variable not set');
    return false;
  } else {
    logResult('AWS_REGION', true, `Region: ${region}`);
  }
  
  if (!accessKeyId) {
    logResult('AWS_ACCESS_KEY_ID', false, 'Environment variable not set');
    return false;
  } else {
    logResult('AWS_ACCESS_KEY_ID', true, `Key ID set (length: ${accessKeyId.length})`);
  }
  
  if (!secretAccessKey) {
    logResult('AWS_SECRET_ACCESS_KEY', false, 'Environment variable not set');
    return false;
  } else {
    logResult('AWS_SECRET_ACCESS_KEY', true, `Secret set (length: ${secretAccessKey.length})`);
  }
  
  // Test connection by fetching a secret
  console.log(`\n${colors.bold}Testing AWS Secrets Manager connection...${colors.reset}`);
  
  try {
    const client = new SecretsManagerClient({
      region: region,
      credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
      }
    });
    
    const command = new GetSecretValueCommand({
      SecretId: 'deployer-password'
    });
    
    const response = await client.send(command);
    
    return logResult('AWS_SECRETS_MANAGER_CONNECTION', true, 
      `Successfully fetched secret 'deployer-password' from ${region}`);
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return logResult('AWS_SECRETS_MANAGER_CONNECTION', false, 
        `Secret 'deployer-password' not found. Credentials are valid but secret doesn't exist.`);
    } else if (error.name === 'UnrecognizedClientException' || error.name === 'InvalidSignatureException') {
      return logResult('AWS_SECRETS_MANAGER_CONNECTION', false, 
        `Authentication failed: Invalid AWS credentials`);
    } else if (error.name === 'AccessDeniedException') {
      // Credentials work but don't have permission - still a valid connection test
      return logResult('AWS_SECRETS_MANAGER_CONNECTION', true, 
        `Connection successful but insufficient permissions: ${error.message}`);
    } else {
      return logResult('AWS_SECRETS_MANAGER_CONNECTION', false, 
        `AWS connection failed: ${error.name} - ${error.message}`);
    }
  }
}

/**
 * Main validation function
 */
async function main() {
  console.log(`${colors.bold}${colors.blue}`);
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     @XFuelLab Environment Validation Script              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  
  try {
    // Run all validations
    const keystorePathValid = validateKeystorePath();
    
    // Only attempt decryption if path is valid
    let keystoreDecryptionValid = false;
    if (keystorePathValid) {
      keystoreDecryptionValid = await validateKeystoreDecryption();
    }
    
    const addressesValid = validateAddresses();
    const awsValid = await validateAWSCredentials();
    
    // Print summary
    console.log(`\n${colors.bold}${colors.blue}=== Validation Summary ===${colors.reset}`);
    console.log(`${colors.green}Passed: ${results.passed} ${CHECK_MARK}${colors.reset}`);
    console.log(`${colors.red}Failed: ${results.failed} ${CROSS_MARK}${colors.reset}`);
    console.log(`${colors.yellow}Warnings: ${results.warnings} ${WARNING}${colors.reset}`);
    
    // Exit with appropriate code
    if (results.failed > 0) {
      console.log(`\n${colors.red}${colors.bold}❌ Validation FAILED${colors.reset}`);
      console.log(`${colors.red}Please fix the above errors before proceeding.${colors.reset}\n`);
      process.exit(1);
    } else {
      console.log(`\n${colors.green}${colors.bold}✅ All validations PASSED${colors.reset}`);
      console.log(`${colors.green}Environment is properly configured!${colors.reset}\n`);
      process.exit(0);
    }
  } catch (error) {
    console.error(`\n${colors.red}${colors.bold}Unexpected error during validation:${colors.reset}`);
    console.error(`${colors.red}${error.stack}${colors.reset}\n`);
    process.exit(1);
  }
}

// Run validation
main();

export { validateKeystorePath, validateKeystoreDecryption, validateAddresses, validateAWSCredentials };

