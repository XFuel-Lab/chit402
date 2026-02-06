#!/usr/bin/env node
// Generate realistic Persistence contract addresses for mock testing

import { toBech32 } from '@cosmjs/encoding';
import { randomBytes } from 'crypto';

function generatePersistenceAddress(label) {
  // Generate 20 random bytes for address
  const addressBytes = randomBytes(20);
  // Convert to bech32 with persistence prefix
  const address = toBech32('persistence', addressBytes);
  return address;
}

console.log('🔧 Generating Mock Persistence Contract Addresses');
console.log('=================================================\n');

const addresses = {
  MINTER_CONTRACT: generatePersistenceAddress('minter'),
  FEE_COLLECTOR_CONTRACT: generatePersistenceAddress('fee-collector'),
  ZK_VERIFIER_CONTRACT: generatePersistenceAddress('zk-verifier'),
};

console.log('Mock Contract Addresses (for testing):');
console.log('');
console.log(`PERSISTENCE_MINTER_CONTRACT=${addresses.MINTER_CONTRACT}`);
console.log(`FEE_COLLECTOR_CONTRACT=${addresses.FEE_COLLECTOR_CONTRACT}`);
console.log(`ZK_VERIFIER_CONTRACT=${addresses.ZK_VERIFIER_CONTRACT}`);
console.log('');
console.log('Code IDs (mock):');
console.log('MINTER_CODE_ID=999');
console.log('FEE_COLLECTOR_CODE_ID=1000');
console.log('ZK_VERIFIER_CODE_ID=998');
console.log('');
console.log('⚠️  These are MOCK addresses for testing only');
console.log('Replace with real addresses after mainnet deployment');
console.log('');

// Save to file
import { writeFile } from 'fs/promises';

const envContent = `# XFuel Reverse Bridge - Mock Configuration
# Generated: ${new Date().toISOString()}
# Status: MOCK - Replace with real addresses after governance approval

# Mock Contract Addresses (Persistence Mainnet)
PERSISTENCE_MINTER_CONTRACT=${addresses.MINTER_CONTRACT}
FEE_COLLECTOR_CONTRACT=${addresses.FEE_COLLECTOR_CONTRACT}
ZK_VERIFIER_CONTRACT=${addresses.ZK_VERIFIER_CONTRACT}

# Mock Code IDs
MINTER_CODE_ID=999
FEE_COLLECTOR_CODE_ID=1000
ZK_VERIFIER_CODE_ID=998

# Deployer Configuration
PERSISTENCE_DEPLOYER=persistence1hpnpvg7ltnd9dht9kuu9qw9m0gp6ghdw3asrmx
PERSISTENCE_MULTISIG=persistence1039mvtpfxzznrush4hpxdwcjm7fs7ph93j2x5e

# Network Configuration
PERSISTENCE_CHAIN_ID=core-1
PERSISTENCE_RPC_URL=https://persistence-rpc.polkachu.com

# Status
DEPLOYMENT_STATUS=MOCK_TESTING
GOVERNANCE_PROPOSAL_STATUS=PENDING
`;

await writeFile('.env.persistence-mock', envContent);
console.log('✓ Saved to: .env.persistence-mock');
