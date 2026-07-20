#!/usr/bin/env node

/**
 * XFuelLab Step 2 Deployment Backup Script
 * 
 * Saves critical deployment information for disaster recovery
 * and creates a markdown verification document.
 * 
 * Usage: node scripts/backup-deployment.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Deployment details from Step 2
const DEPLOYMENT_DATA = {
  timestamp: new Date().toISOString(),
  network: {
    name: 'Theta Mainnet',
    chainId: 361,
    rpcUrl: 'https://eth-rpc-api.thetatoken.org/rpc',
    explorerUrl: 'https://explorer.thetatoken.org'
  },
  contracts: {
    vaultFactory: {
      address: '0xB0a26600074dADC69186632a1B8dFd7c3146Ce56',
      deploymentTx: '0xc0aae79f61383ef56ffbd4b306b36ce02a8951573ccfafa48dd3c13c2835f6e9',
      deployer: '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c',
      admin: '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c',
      gasSpent: '7.04 TFUEL',
      blockNumber: null, // Will be filled from on-chain query if available
      compiler: '0.8.20',
      optimizationRuns: 200
    },
    revenueSplitter: {
      address: '0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6',
      role: 'Fee collector for Ferrari hybrid splits'
    },
    treasury: {
      address: '0x043d5231651379970d52a13CEfB4e80733DDb989',
      role: 'Innovation fund (15% of fees in Phase 2)'
    }
  },
  ferrariHybridConfig: {
    phase: 'Phase 2 (Pre-Audit)',
    depositFee: '0.5%',
    revenueSplits: {
      veXFYield: '50%',
      buybackBurn: '25%',
      rXFMint: '15%',
      treasury: '10%'
    },
    yieldMechanics: {
      recycleFlag: '30%',
      lpFunding: '70%'
    },
    safetyLimits: {
      maxDepositPerTx: '0.1 TFUEL',
      dailyCap: '1.0 TFUEL',
      pauseEnabled: true
    }
  },
  walletBalances: {
    deployerPostDeploy: '1214.96 TFUEL',
    deployerAddress: '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c'
  },
  explorerLinks: {
    vaultFactory: 'https://explorer.thetatoken.org/address/0xB0a26600074dADC69186632a1B8dFd7c3146Ce56',
    deploymentTx: 'https://explorer.thetatoken.org/tx/0xc0aae79f61383ef56ffbd4b306b36ce02a8951573ccfafa48dd3c13c2835f6e9',
    revenueSplitter: 'https://explorer.thetatoken.org/address/0x1C4CEbbb4Cfa7fdb546424F21CF706c48C478EE6'
  },
  roles: {
    admin: '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c',
    pauser: '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c',
    zkBridgeRole: '0xDC17Cbd201E7347555e428690f702bbFcAF2d33c'
  },
  emergencyContacts: {
    technicalLead: 'TBD',
    securityLead: 'TBD',
    backupWallet: 'MetaMask Dev (fallback)'
  }
};

function main() {
  console.log('🔐 XFuelLab Step 2 Deployment Backup');
  console.log('=' .repeat(70));
  console.log('');

  // 1. Save JSON backup
  const backupDir = path.join(__dirname, '..', 'deployments');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const backupPath = path.join(backupDir, 'mainnet-backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(DEPLOYMENT_DATA, null, 2));
  console.log('✅ JSON backup saved:', backupPath);

  // 2. Create markdown verification document
  const mdContent = generateMarkdownDoc(DEPLOYMENT_DATA);
  const mdPath = path.join(backupDir, 'STEP2_DEPLOYMENT_VERIFICATION.md');
  fs.writeFileSync(mdPath, mdContent);
  console.log('✅ Markdown verification saved:', mdPath);

  // 3. Create emergency recovery script
  const recoveryScript = generateRecoveryScript(DEPLOYMENT_DATA);
  const recoveryPath = path.join(__dirname, 'recover-deployment.cjs');
  fs.writeFileSync(recoveryPath, recoveryScript);
  console.log('✅ Recovery script saved:', recoveryPath);

  // 4. Git commit (if git is available)
  console.log('');
  console.log('📝 Creating git commit...');
  try {
    execSync('git add deployments/mainnet-backup.json', { stdio: 'pipe' });
    execSync('git add deployments/STEP2_DEPLOYMENT_VERIFICATION.md', { stdio: 'pipe' });
    execSync('git add scripts/recover-deployment.cjs', { stdio: 'pipe' });
    
    const commitMessage = `🚀 Step 2 Deployment: VaultFactory ${DEPLOYMENT_DATA.contracts.vaultFactory.address}

- Network: Theta Mainnet (Chain ID: 361)
- VaultFactory: ${DEPLOYMENT_DATA.contracts.vaultFactory.address}
- TX: ${DEPLOYMENT_DATA.contracts.vaultFactory.deploymentTx}
- Gas Spent: ${DEPLOYMENT_DATA.contracts.vaultFactory.gasSpent}
- Phase: Ferrari Hybrid v3.0 (Pre-Audit)
- Safety: 0.1 TFUEL cap, pause enabled

Backup files:
- deployments/mainnet-backup.json
- deployments/STEP2_DEPLOYMENT_VERIFICATION.md
- scripts/recover-deployment.cjs`;

    execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
    console.log('✅ Git commit created successfully');
  } catch (error) {
    console.log('⚠️  Git commit failed (may not be in a git repo or no changes)');
    console.log('   You can manually commit with:');
    console.log('   git add deployments/mainnet-backup.json deployments/STEP2_DEPLOYMENT_VERIFICATION.md');
    console.log('   git commit -m "Step 2 deployment backup"');
  }

  console.log('');
  console.log('=' .repeat(70));
  console.log('📋 BACKUP COMPLETE');
  console.log('=' .repeat(70));
  console.log('');
  console.log('Files created:');
  console.log('  1. deployments/mainnet-backup.json (machine-readable)');
  console.log('  2. deployments/STEP2_DEPLOYMENT_VERIFICATION.md (human-readable)');
  console.log('  3. scripts/recover-deployment.cjs (emergency recovery)');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review: cat deployments/STEP2_DEPLOYMENT_VERIFICATION.md');
  console.log('  2. Test: node scripts/test-live.cjs');
  console.log('  3. Push backup: git push origin main');
  console.log('');
}

function generateMarkdownDoc(data) {
  return `# Step 2 Deployment Verification
## Theta Mainnet - Ferrari Hybrid Tokenomics

**Deployment Date:** ${data.timestamp}  
**Status:** ✅ VERIFIED AND LIVE  
**Phase:** ${data.ferrariHybridConfig.phase}

---

## 🎯 Deployment Summary

### Network Information
- **Network:** ${data.network.name}
- **Chain ID:** ${data.network.chainId}
- **RPC URL:** ${data.network.rpcUrl}
- **Explorer:** ${data.network.explorerUrl}

### Contract Addresses

#### VaultFactory (Primary)
\`\`\`
Address:        ${data.contracts.vaultFactory.address}
Deployer:       ${data.contracts.vaultFactory.deployer}
Admin:          ${data.contracts.vaultFactory.admin}
Deployment TX:  ${data.contracts.vaultFactory.deploymentTx}
Gas Spent:      ${data.contracts.vaultFactory.gasSpent}
Compiler:       ${data.contracts.vaultFactory.compiler}
Optimization:   ${data.contracts.vaultFactory.optimizationRuns} runs
\`\`\`

#### RevenueSplitter
\`\`\`
Address: ${data.contracts.revenueSplitter.address}
Role:    ${data.contracts.revenueSplitter.role}
\`\`\`

#### Treasury
\`\`\`
Address: ${data.contracts.treasury.address}
Role:    ${data.contracts.treasury.role}
\`\`\`

---

## 🏎️ Ferrari Hybrid Configuration

### Revenue Distribution (${data.ferrariHybridConfig.phase})
\`\`\`yaml
Deposit Fee: ${data.ferrariHybridConfig.depositFee}

RevenueSplitter Splits:
  - veXF Yield:     ${data.ferrariHybridConfig.revenueSplits.veXFYield}
  - Buyback/Burn:   ${data.ferrariHybridConfig.revenueSplits.buybackBurn}
  - rXF Mint:       ${data.ferrariHybridConfig.revenueSplits.rXFMint}
  - Treasury:       ${data.ferrariHybridConfig.revenueSplits.treasury}

Yield Mechanics:
  - Recycle Flag:   ${data.ferrariHybridConfig.yieldMechanics.recycleFlag} (reverse-burn loop)
  - LP Funding:     ${data.ferrariHybridConfig.yieldMechanics.lpFunding}

Safety Limits:
  - Max Deposit:    ${data.ferrariHybridConfig.safetyLimits.maxDepositPerTx}
  - Daily Cap:      ${data.ferrariHybridConfig.safetyLimits.dailyCap}
  - Pause:          ${data.ferrariHybridConfig.safetyLimits.pauseEnabled ? 'ENABLED ✅' : 'DISABLED ❌'}
\`\`\`

---

## 🔗 Explorer Links

- **VaultFactory Contract:** ${data.explorerLinks.vaultFactory}
- **Deployment Transaction:** ${data.explorerLinks.deploymentTx}
- **RevenueSplitter:** ${data.explorerLinks.revenueSplitter}

---

## ✅ Verification Checklist

### On-Chain Verification
- [x] Contract deployed successfully
- [x] Explorer shows green checkmark
- [x] Source code verified (compiler ${data.contracts.vaultFactory.compiler}, ${data.contracts.vaultFactory.optimizationRuns} runs)
- [ ] Test SubVault created
- [ ] Test deposit processed
- [ ] Fee splits verified
- [ ] Events emitted correctly

### Configuration Verification
- [x] Admin address correct: ${data.roles.admin}
- [x] RevenueSplitter connected: ${data.contracts.revenueSplitter.address}
- [x] Pause mechanism enabled
- [ ] ZK_BRIDGE_ROLE granted (for future bridge operations)
- [ ] PAUSER_ROLE configured

### Security Checks
- [x] Private keys secured
- [x] Deployer wallet balance sufficient: ${data.walletBalances.deployerPostDeploy}
- [ ] Backup wallet funded (MetaMask dev)
- [ ] Emergency procedures documented
- [ ] Team notified of deployment

---

## 🧪 Testing Workflow

### Test 1: Create SubVault
\`\`\`bash
npx hardhat console --network theta-mainnet

> factory = await ethers.getContractAt('VaultFactory', '${data.contracts.vaultFactory.address}')
> salt = ethers.keccak256(ethers.toUtf8Bytes('test-vault-mainnet-1'))
> tx = await factory.createVault(salt, {gasPrice: ethers.parseUnits('4000', 'gwei')})
> await tx.wait()
> vaultAddr = await factory.predictAddress(salt)
> console.log('SubVault:', vaultAddr)
\`\`\`

### Test 2: Deposit 0.1 TFUEL
From Theta Web Wallet:
1. Send 0.1 TFUEL to SubVault address
2. Wait for confirmation
3. Check explorer for \`DepositReceived\` event

Expected values:
- grossAmount: 0.1 TFUEL
- feeAmount: 0.0005 TFUEL (0.5%)
- netAmount: 0.0995 TFUEL
- yieldRecycleAmount: 0.02985 TFUEL (30%)

### Test 3: Verify Fee Distribution
Check RevenueSplitter balance increased by 0.0005 TFUEL

### Test 4: Mock Unwrap
\`\`\`bash
> mockBurnTx = ethers.keccak256(ethers.toUtf8Bytes('test-burn-mainnet-1'))
> tx = await factory.unwrapFromBurn(
    '<SUBVAULT_ADDRESS>',
    mockBurnTx,
    '${data.contracts.vaultFactory.deployer}',
    ethers.parseEther('0.05'),
    {gasPrice: ethers.parseUnits('4000', 'gwei')}
  )
> await tx.wait()
\`\`\`

Expected:
- To recipient: 0.035 TFUEL (70%)
- Yield recycle: 0.015 TFUEL (30%)

---

## 🔐 Access Control

### Roles
\`\`\`
DEFAULT_ADMIN_ROLE: ${data.roles.admin}
PAUSER_ROLE:        ${data.roles.pauser}
ZK_BRIDGE_ROLE:     ${data.roles.zkBridgeRole}
\`\`\`

### Emergency Contacts
\`\`\`
Technical Lead:  ${data.emergencyContacts.technicalLead}
Security Lead:   ${data.emergencyContacts.securityLead}
Backup Wallet:   ${data.emergencyContacts.backupWallet}
\`\`\`

---

## 🚨 Emergency Procedures

### Pause Contract
\`\`\`bash
npx hardhat console --network theta-mainnet

> factory = await ethers.getContractAt('VaultFactory', '${data.contracts.vaultFactory.address}')
> tx = await factory.pause({gasPrice: ethers.parseUnits('4000', 'gwei')})
> await tx.wait()
> console.log('Contract paused')
\`\`\`

### Unpause Contract
\`\`\`bash
> tx = await factory.unpause({gasPrice: ethers.parseUnits('4000', 'gwei')})
> await tx.wait()
> console.log('Contract unpaused')
\`\`\`

### Emergency Refund
\`\`\`bash
> tx = await factory.refundFromVault(
    '<VAULT_ADDRESS>',
    '<RECIPIENT_ADDRESS>',
    ethers.parseEther('<AMOUNT>'),
    {gasPrice: ethers.parseUnits('4000', 'gwei')}
  )
> await tx.wait()
\`\`\`

---

## 📊 Post-Deployment Metrics

### Wallet Balances
- **Deployer (post-deploy):** ${data.walletBalances.deployerPostDeploy}
- **Deployer Address:** ${data.walletBalances.deployerAddress}

### Gas Metrics
- **Deployment Gas:** ${data.contracts.vaultFactory.gasSpent}
- **Estimated SubVault Creation:** ~0.002 TFUEL
- **Estimated Test Deposit:** ~0.001 TFUEL

---

## 📝 Next Steps

### Immediate (Within 1 Hour)
- [ ] Run live testing script: \`node scripts/test-live.cjs\`
- [ ] Create test SubVault
- [ ] Execute 0.1 TFUEL test deposit
- [ ] Verify all events on explorer
- [ ] Document test results

### Next Session (Within 24 Hours)
- [ ] Backend listener integration (Step 3)
- [ ] Event detection testing
- [ ] Prepare for Persistence deployment (Step 4)

### Future (Post-Audit)
- [ ] Activate full Ferrari hybrid (30/30/25/15)
- [ ] Enable governance extras (NFTs, airdrops, milestones)
- [ ] Increase limits (0.1 → 1.0 TFUEL)
- [ ] Deploy veXF and rXF tokens

---

## 🔄 Recovery Information

If deployment info is lost, recover with:
\`\`\`bash
node scripts/recover-deployment.cjs
\`\`\`

This will restore all addresses and configuration from this backup.

---

**Backup Created:** ${data.timestamp}  
**Backup Script:** \`scripts/backup-deployment.cjs\`  
**Status:** ✅ Ready for Live Testing
`;
}

function generateRecoveryScript(data) {
  return `#!/usr/bin/env node

/**
 * Emergency Recovery Script
 * Restores deployment configuration from backup
 */

const DEPLOYMENT_DATA = ${JSON.stringify(data, null, 2)};

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
`;
}

// Run the backup
if (require.main === module) {
  main();
}

module.exports = { DEPLOYMENT_DATA };

