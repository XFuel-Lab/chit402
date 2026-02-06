#!/usr/bin/env node
// XFuel Reverse Bridge - Node.js Deployment Script
// No persistenced CLI needed - uses CosmJS directly

import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing';
import { GasPrice } from '@cosmjs/stargate';
import { readFile } from 'fs/promises';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const CONFIG = {
  chainId: 'core-1',
  rpcUrl: 'https://persistence-rpc.polkachu.com', // Try Polkachu RPC
  deployerAddress: 'persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx',
  adminAddress: 'persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e',
  gasPrice: GasPrice.fromString('0.025uxprt'),
};

console.log('==========================================');
console.log('XFuel Reverse Bridge - CosmJS Deployment');
console.log('==========================================\n');

// Get mnemonic from environment variable or AWS Secrets Manager
async function getMnemonic() {
  // Option 1: Check environment variable first (for manual deployment)
  if (process.env.PERSISTENCE_MNEMONIC) {
    console.log('🔑 Using mnemonic from environment variable');
    return process.env.PERSISTENCE_MNEMONIC;
  }
  
  // Option 2: Retrieve from AWS Secrets Manager
  console.log('📥 Retrieving mnemonic from AWS Secrets Manager...');
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const command = new GetSecretValueCommand({ SecretId: 'PERSISTENCE_DEPLOYER' });
  
  try {
    const response = await client.send(command);
    let secretString = response.SecretString;
    
    // Debug output
    console.log(`  Retrieved secret (length: ${secretString.length} chars)`);
    console.log(`  First 20 chars: ${secretString.substring(0, 20)}...`);
    
    // Try to parse as JSON first
    try {
      const secretJson = JSON.parse(secretString);
      console.log('  Secret is JSON format');
      // Check common key names
      if (secretJson.mnemonic) return secretJson.mnemonic.trim();
      if (secretJson.MNEMONIC) return secretJson.MNEMONIC.trim();
      if (secretJson.phrase) return secretJson.phrase.trim();
      if (secretJson.seed) return secretJson.seed.trim();
      console.log('  JSON keys:', Object.keys(secretJson));
    } catch (e) {
      // Not JSON, treat as plain text
      console.log('  Secret is plain text format');
    }
    
    // Return as plain text, trimmed
    return secretString.trim();
  } catch (error) {
    console.error('❌ Failed to retrieve secret:', error.message);
    console.error('\nTry setting mnemonic as environment variable:');
    console.error('  $env:PERSISTENCE_MNEMONIC = "your mnemonic phrase"');
    console.error('  node deploy.js');
    process.exit(1);
  }
}

// Create signing client
async function createClient(mnemonic) {
  console.log('🔑 Creating wallet from mnemonic...');
  
  // Debug: Check mnemonic format
  const words = mnemonic.split(' ').filter(w => w.length > 0);
  console.log(`  Mnemonic has ${words.length} words`);
  
  if (words.length !== 12 && words.length !== 24) {
    console.error(`❌ Invalid mnemonic: expected 12 or 24 words, got ${words.length}`);
    console.error(`  First 3 words: ${words.slice(0, 3).join(' ')}`);
    console.error(`  Last 3 words: ${words.slice(-3).join(' ')}`);
    process.exit(1);
  }
  
  // Check for non-ASCII characters or weird encoding
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!/^[a-z]+$/.test(word)) {
      console.error(`❌ Word ${i+1} has invalid characters: "${word}"`);
      console.error(`  Characters: ${word.split('').map(c => c.charCodeAt(0)).join(',')}`);
      process.exit(1);
    }
  }
  
  console.log('  ✓ All words are lowercase ASCII');
  console.log(`  Sample words (1st, 6th, 12th): ${words[0].substring(0,3)}... ${words[5]?.substring(0,3)}... ${words[11]?.substring(0,3)}...`);
  
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
    prefix: 'persistence',
  });
  
  const [account] = await wallet.getAccounts();
  console.log(`✓ Wallet address: ${account.address}`);
  
  if (account.address !== CONFIG.deployerAddress) {
    console.error('❌ Address mismatch!');
    console.error(`  Expected: ${CONFIG.deployerAddress}`);
    console.error(`  Got: ${account.address}`);
    process.exit(1);
  }
  
  console.log('🌐 Connecting to Persistence mainnet...');
  const client = await SigningCosmWasmClient.connectWithSigner(
    CONFIG.rpcUrl,
    wallet,
    { gasPrice: CONFIG.gasPrice }
  );
  
  return client;
}

async function main() {
  try {
    // Get mnemonic
    const mnemonic = await getMnemonic();
    
    // Create client
    const client = await createClient(mnemonic);
    
    // Check balance
    console.log('\n💰 Checking balance...');
    const balance = await client.getBalance(CONFIG.deployerAddress, 'uxprt');
    const balanceXprt = parseInt(balance.amount) / 1_000_000;
    console.log(`✓ Balance: ${balanceXprt} XPRT`);
    
    if (balanceXprt < 5) {
      console.warn('⚠️  Warning: Balance is low (< 5 XPRT)');
    }
    
    // Upload persistence_minter
    console.log('\n📤 Step 1: Uploading persistence_minter.wasm...');
    const minterWasm = await readFile('../cosmwasm-contracts/artifacts/persistence_minter.wasm');
    console.log(`  Size: ${(minterWasm.length / 1024).toFixed(2)} KB`);
    
    const minterUpload = await client.upload(
      CONFIG.deployerAddress,
      minterWasm,
      'auto',
      'Upload xfuel persistence-minter v1.0.0'
    );
    console.log(`✓ Uploaded! Code ID: ${minterUpload.codeId}`);
    console.log(`  TX: ${minterUpload.transactionHash}`);
    
    // Upload fee_collector
    console.log('\n📤 Step 2: Uploading fee_collector.wasm...');
    const feeWasm = await readFile('../cosmwasm-contracts/artifacts/fee_collector.wasm');
    console.log(`  Size: ${(feeWasm.length / 1024).toFixed(2)} KB`);
    
    const feeUpload = await client.upload(
      CONFIG.deployerAddress,
      feeWasm,
      'auto',
      'Upload xfuel fee-collector v1.0.0'
    );
    console.log(`✓ Uploaded! Code ID: ${feeUpload.codeId}`);
    console.log(`  TX: ${feeUpload.transactionHash}`);
    
    // Instantiate persistence-minter
    console.log('\n🏗️  Step 3: Instantiating persistence-minter...');
    const minterMsg = {
      name: 'iBridge TFUEL',
      symbol: 'ibcTFUEL',
      decimals: 18,
      initial_balances: [],
      mint_cap: null,
      marketing: null,
      verifier_address: 'persistence1000000000000000000000000000000000000000',
      rev_splitter_address: 'persistence1000000000000000000000000000000000000000',
      fee_collector_address: 'persistence1000000000000000000000000000000000000000',
    };
    
    const minterInstantiate = await client.instantiate(
      CONFIG.deployerAddress,
      minterUpload.codeId,
      minterMsg,
      'xfuel-ibcTFUEL-minter-v1.0.0-mainnet',
      'auto',
      { admin: CONFIG.adminAddress }
    );
    console.log(`✓ Instantiated! Address: ${minterInstantiate.contractAddress}`);
    console.log(`  TX: ${minterInstantiate.transactionHash}`);
    
    const minterContract = minterInstantiate.contractAddress;
    
    // PAUSE immediately
    console.log('\n🚨 Step 4: Pausing minter contract...');
    const pauseResult = await client.execute(
      CONFIG.deployerAddress,
      minterContract,
      { pause: {} },
      'auto'
    );
    console.log(`✓ Paused! TX: ${pauseResult.transactionHash}`);
    
    // Instantiate fee-collector
    console.log('\n🏗️  Step 5: Instantiating fee-collector...');
    const feeMsg = {
      admin: CONFIG.adminAddress,
      ibctfuel_token: minterContract,
      minter_contract: minterContract,
      min_burn_amount: '1000000000000000000',
    };
    
    const feeInstantiate = await client.instantiate(
      CONFIG.deployerAddress,
      feeUpload.codeId,
      feeMsg,
      'xfuel-fee-collector-v1.0.0-mainnet',
      'auto',
      { admin: CONFIG.adminAddress }
    );
    console.log(`✓ Instantiated! Address: ${feeInstantiate.contractAddress}`);
    console.log(`  TX: ${feeInstantiate.transactionHash}`);
    
    const feeCollectorContract = feeInstantiate.contractAddress;
    
    // Update fee collector address
    console.log('\n🔧 Step 6: Updating fee_collector address in minter...');
    const updateResult = await client.execute(
      CONFIG.deployerAddress,
      minterContract,
      { set_fee_collector: { fee_collector_address: feeCollectorContract } },
      'auto'
    );
    console.log(`✓ Updated! TX: ${updateResult.transactionHash}`);
    
    // Summary
    console.log('\n==========================================');
    console.log('✅ DEPLOYMENT COMPLETE');
    console.log('==========================================\n');
    console.log('Contract Addresses:');
    console.log(`  persistence-minter: ${minterContract}`);
    console.log(`  fee-collector:      ${feeCollectorContract}`);
    console.log('');
    console.log('Code IDs:');
    console.log(`  persistence-minter: ${minterUpload.codeId}`);
    console.log(`  fee-collector:      ${feeUpload.codeId}`);
    console.log('');
    console.log('Status:');
    console.log('  ✓ Minter is PAUSED');
    console.log('  ✓ FeeCollector configured');
    console.log('  ✓ Ready for testing');
    console.log('');
    console.log('Next: Run test-burn.js to test with 0.05 TFUEL');
    
  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
