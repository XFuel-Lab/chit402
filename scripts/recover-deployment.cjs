#!/usr/bin/env node

/**
 * Emergency Recovery Script
 * Restores deployment configuration from backup
 */

const DEPLOYMENT_DATA = {
  "timestamp": "2026-01-04T00:20:22.883Z",
  "network": {
    "name": "Theta Mainnet",
    "chainId": 361,
    "rpcUrl": "https://eth-rpc-api.thetatoken.org/rpc",
    "explorerUrl": "https://explorer.thetatoken.org"
  },
  "contracts": {
    "vaultFactory": {
      "address": "0xB0a26600074dADC69186632a1B8dFd7c3146Ce56",
      "deploymentTx": "0xc0aae79f61383ef56ffbd4b306b36ce02a8951573ccfafa48dd3c13c2835f6e9",
      "deployer": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c",
      "admin": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c",
      "gasSpent": "7.04 TFUEL",
      "blockNumber": null,
      "compiler": "0.8.20",
      "optimizationRuns": 200
    },
    "revenueSplitter": {
      "address": "0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6",
      "role": "Fee collector for Ferrari hybrid splits"
    },
    "treasury": {
      "address": "0x043d5231651379970d52a13CEfB4e80733DDb989",
      "role": "Innovation fund (15% of fees in Phase 2)"
    }
  },
  "ferrariHybridConfig": {
    "phase": "Phase 2 (Pre-Audit)",
    "depositFee": "0.5%",
    "revenueSplits": {
      "veXFYield": "50%",
      "buybackBurn": "25%",
      "rXFMint": "15%",
      "treasury": "10%"
    },
    "yieldMechanics": {
      "recycleFlag": "30%",
      "lpFunding": "70%"
    },
    "safetyLimits": {
      "maxDepositPerTx": "0.1 TFUEL",
      "dailyCap": "1.0 TFUEL",
      "pauseEnabled": true
    }
  },
  "walletBalances": {
    "deployerPostDeploy": "1214.96 TFUEL",
    "deployerAddress": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c"
  },
  "explorerLinks": {
    "vaultFactory": "https://explorer.thetatoken.org/address/0xB0a26600074dADC69186632a1B8dFd7c3146Ce56",
    "deploymentTx": "https://explorer.thetatoken.org/tx/0xc0aae79f61383ef56ffbd4b306b36ce02a8951573ccfafa48dd3c13c2835f6e9",
    "revenueSplitter": "https://explorer.thetatoken.org/address/0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6"
  },
  "roles": {
    "admin": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c",
    "pauser": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c",
    "zkBridgeRole": "0xDC17Cbd201E7347555e428690f702bbFcAF2d33c"
  },
  "emergencyContacts": {
    "technicalLead": "TBD",
    "securityLead": "TBD",
    "backupWallet": "MetaMask Dev (fallback)"
  }
};

console.log('🔄 Emergency Recovery - Step 2 Deployment');
console.log('=' .repeat(70));
console.log('');
console.log('VaultFactory Address:', DEPLOYMENT_DATA.contracts.vaultFactory.address);
console.log('Deployer Address:', DEPLOYMENT_DATA.contracts.vaultFactory.deployer);
console.log('RevenueSplitter:', DEPLOYMENT_DATA.contracts.revenueSplitter.address);
console.log('');
console.log('Explorer Links:');
console.log('  VaultFactory:', DEPLOYMENT_DATA.explorerLinks.vaultFactory);
console.log('  Deployment TX:', DEPLOYMENT_DATA.explorerLinks.deploymentTx);
console.log('');
console.log('Configuration recovered. Use these addresses to reconnect to deployed contracts.');

module.exports = DEPLOYMENT_DATA;
